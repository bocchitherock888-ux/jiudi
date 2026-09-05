package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	encoderVersion   = "encoder-0.12.6"
	encoderReadyWait = 18 * time.Second
	downloadTimeout  = 2 * time.Minute
)

var encoderURLs = map[string][]string{
	"js/vendor/ffmpeg/ffmpeg-core.js": {
		"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
		"https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
	},
	"js/vendor/ffmpeg/ffmpeg-core.wasm": {
		"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
		"https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
	},
}

type fetchFunc func(context.Context, string, int64) ([]byte, error)

type encoderStatus struct {
	ready bool
	state string
	err   string
}

func (s encoderStatus) json() []byte {
	state, _ := json.Marshal(s.state)
	errText, _ := json.Marshal(s.err)
	return []byte(fmt.Sprintf(`{"ready": %t, "state": %s, "error": %s}`, s.ready, state, errText))
}

type encoderManager struct {
	mu       sync.Mutex
	status   encoderStatus
	done     chan struct{}
	cacheDir string
	specs    map[string]assetSpec
	urls     map[string][]string
	fetch    fetchFunc
}

func newDefaultEncoderManager() *encoderManager {
	cacheRoot, err := os.UserCacheDir()
	cacheDir := ""
	if err == nil {
		cacheDir = filepath.Join(cacheRoot, "Jiudi", encoderVersion)
	}
	return newEncoderManager(cacheDir, encoderAssetSpecs, encoderURLs, fetchRemote)
}

func newEncoderManager(cacheDir string, specs map[string]assetSpec, urls map[string][]string, fetch fetchFunc) *encoderManager {
	m := &encoderManager{
		status:   encoderStatus{state: "idle"},
		cacheDir: cacheDir,
		specs:    specs,
		urls:     urls,
		fetch:    fetch,
	}
	if m.cacheComplete() {
		m.status = encoderStatus{ready: true, state: "ready"}
		m.done = closedChannel()
	}
	return m
}

func closedChannel() chan struct{} {
	done := make(chan struct{})
	close(done)
	return done
}

func (m *encoderManager) snapshot() encoderStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *encoderManager) start() chan struct{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status.state == "ready" || m.status.state == "preparing" {
		return m.done
	}
	// A new readiness request retries transient network and cache failures.
	m.status = encoderStatus{state: "preparing"}
	m.done = make(chan struct{})
	done := m.done
	go func() {
		err := m.ensure(context.Background())
		m.mu.Lock()
		if err != nil {
			m.status = encoderStatus{state: "failed", err: err.Error()}
		} else {
			m.status = encoderStatus{ready: true, state: "ready"}
		}
		close(done)
		m.mu.Unlock()
	}()
	return done
}

func (m *encoderManager) wait(ctx context.Context, timeout time.Duration) encoderStatus {
	done := m.start()
	if timeout <= 0 {
		select {
		case <-done:
		case <-ctx.Done():
		}
		return m.snapshot()
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	case <-ctx.Done():
	}
	return m.snapshot()
}

func (m *encoderManager) verify(ctx context.Context) encoderStatus {
	return m.wait(ctx, 0)
}

func (m *encoderManager) asset(name string) ([]byte, error) {
	m.mu.Lock()
	ready := m.status.ready
	m.mu.Unlock()
	if !ready {
		return nil, fsNotExist(name)
	}
	data, err := m.readVerified(name)
	if err != nil {
		m.mu.Lock()
		m.status = encoderStatus{state: "failed", err: "cached encoder failed verification"}
		m.mu.Unlock()
		return nil, err
	}
	return data, nil
}

func fsNotExist(name string) error {
	return fmt.Errorf("%s: %w", name, os.ErrNotExist)
}

func (m *encoderManager) cacheComplete() bool {
	if m.cacheDir == "" {
		return false
	}
	for name := range m.specs {
		if _, err := m.readVerified(name); err != nil {
			return false
		}
	}
	return true
}

func (m *encoderManager) readVerified(name string) ([]byte, error) {
	spec, ok := m.specs[name]
	if !ok || m.cacheDir == "" {
		return nil, fsNotExist(name)
	}
	cachePath := filepath.Join(m.cacheDir, filepath.Base(name))
	entry, err := os.Lstat(cachePath)
	if err != nil {
		return nil, err
	}
	if !entry.Mode().IsRegular() {
		return nil, fmt.Errorf("cached asset %s is not a regular file", name)
	}
	if err := validateAssetSize(name, entry.Size(), spec); err != nil {
		return nil, err
	}
	file, err := os.Open(cachePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() {
		return nil, fmt.Errorf("cached asset %s is not a regular file", name)
	}
	if err := validateAssetSize(name, opened.Size(), spec); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, spec.maxBytes+1))
	if err != nil {
		return nil, err
	}
	if err := validateAssetData(name, data, spec); err != nil {
		return nil, err
	}
	return data, nil
}

func (m *encoderManager) ensure(ctx context.Context) error {
	if m.cacheDir == "" {
		return errors.New("user cache directory is unavailable")
	}
	if err := os.MkdirAll(m.cacheDir, 0700); err != nil {
		return fmt.Errorf("create encoder cache: %w", err)
	}
	if err := os.Chmod(m.cacheDir, 0700); err != nil {
		return fmt.Errorf("secure encoder cache: %w", err)
	}
	for name, spec := range m.specs {
		if _, err := m.readVerified(name); err == nil {
			continue
		}
		data, err := m.download(ctx, name, spec)
		if err != nil {
			return err
		}
		if err := m.install(name, data, spec); err != nil {
			return err
		}
	}
	if !m.waitForComplete(500 * time.Millisecond) {
		return errors.New("encoder cache verification failed")
	}
	return nil
}

func (m *encoderManager) waitForComplete(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if m.cacheComplete() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func (m *encoderManager) download(ctx context.Context, name string, spec assetSpec) ([]byte, error) {
	var last error
	for attempt := 0; attempt < 2; attempt++ {
		for _, sourceURL := range m.urls[name] {
			data, err := m.fetch(ctx, sourceURL, spec.maxBytes)
			if err == nil {
				err = validateAssetData(name, data, spec)
			}
			if err == nil {
				return data, nil
			}
			last = err
		}
	}
	return nil, fmt.Errorf("download %s: %w", filepath.Base(name), last)
}

func (m *encoderManager) install(name string, data []byte, spec assetSpec) error {
	tmp, err := os.CreateTemp(m.cacheDir, ".encoder-*.part")
	if err != nil {
		return fmt.Errorf("create encoder temporary file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	written, err := os.ReadFile(tmpName)
	if err != nil {
		return err
	}
	if err := validateAssetData(name, written, spec); err != nil {
		return err
	}
	destination := filepath.Join(m.cacheDir, filepath.Base(name))
	if _, err := m.readVerified(name); err == nil {
		return nil
	}
	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tmpName, destination); err != nil {
		// Another Jiudi process may have installed the same pinned file after
		// our remove. A fully verified winner is equivalent to our candidate.
		if _, verifyErr := m.readVerified(name); verifyErr == nil {
			return nil
		}
		return err
	}
	return nil
}

func fetchRemote(ctx context.Context, sourceURL string, maxBytes int64) ([]byte, error) {
	parsed, err := url.Parse(sourceURL)
	if err != nil || parsed.Scheme != "https" || !allowedEncoderURL(sourceURL) {
		return nil, errors.New("encoder URL is outside the allowlist")
	}
	client := &http.Client{
		Timeout: downloadTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Jiudi/1.0")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxBytes {
		return nil, errors.New("encoder response exceeds size limit")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, errors.New("encoder response exceeds size limit")
	}
	return data, nil
}

func allowedEncoderURL(candidate string) bool {
	for _, urls := range encoderURLs {
		for _, allowed := range urls {
			if candidate == allowed {
				return true
			}
		}
	}
	return false
}
