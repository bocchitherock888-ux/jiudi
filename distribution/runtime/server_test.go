package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

func testServer(t *testing.T) (*httptest.Server, *runtimeHandler) {
	t.Helper()
	assetFS := fstest.MapFS{
		"index.html":  &fstest.MapFile{Data: []byte("0123456789")},
		"js/video.js": &fstest.MapFile{Data: []byte("video")},
	}
	encoder, _, _ := testEncoder(t)
	if state := encoder.verify(context.Background()); !state.ready {
		t.Fatalf("prepare test encoder: %s", state.err)
	}
	handler := &runtimeHandler{assets: assetFS, encoder: encoder}
	return startTestServer(t, handler), handler
}

func startTestServer(t *testing.T, handler *runtimeHandler) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &httptest.Server{
		Listener: listener,
		Config:   &http.Server{Handler: handler},
	}
	handler.expectedHost = server.Listener.Addr().String()
	server.Start()
	t.Cleanup(server.Close)
	return server
}

func testEncoder(t *testing.T) (*encoderManager, map[string][]byte, *int) {
	t.Helper()
	files := map[string][]byte{
		"js/vendor/ffmpeg/ffmpeg-core.js":   []byte("createFFmpegCore test payload"),
		"js/vendor/ffmpeg/ffmpeg-core.wasm": []byte("\x00asm test payload"),
	}
	specs := make(map[string]assetSpec)
	urls := make(map[string][]string)
	urlData := make(map[string][]byte)
	for name, data := range files {
		digest := sha256.Sum256(data)
		signature := []byte("createFFmpegCore")
		if strings.HasSuffix(name, ".wasm") {
			signature = []byte("\x00asm")
		}
		specs[name] = assetSpec{sha256: hex.EncodeToString(digest[:]), minBytes: 4, maxBytes: 64, signature: signature}
		fakeURL := "memory://" + filepath.Base(name)
		urls[name] = []string{fakeURL}
		urlData[fakeURL] = data
	}
	count := 0
	var countMu sync.Mutex
	fetch := func(_ context.Context, source string, _ int64) ([]byte, error) {
		countMu.Lock()
		count++
		countMu.Unlock()
		data, ok := urlData[source]
		if !ok {
			return nil, errors.New("unexpected test URL")
		}
		return append([]byte(nil), data...), nil
	}
	return newEncoderManager(t.TempDir(), specs, urls, fetch), files, &count
}

func request(t *testing.T, server *httptest.Server, method, path, host string, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, server.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = host
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestStaticRoutingHeadersAndRange(t *testing.T) {
	server, handler := testServer(t)
	response := request(t, server, http.MethodGet, "/", handler.expectedHost, map[string]string{"Range": "bytes=2-5"})
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusPartialContent || string(body) != "2345" {
		t.Fatalf("range response = %d %q", response.StatusCode, body)
	}
	checks := map[string]string{
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Embedder-Policy": "require-corp",
		"Cross-Origin-Resource-Policy": "same-origin",
		"X-Content-Type-Options":       "nosniff",
		"Referrer-Policy":              "no-referrer",
		"Cache-Control":                "no-store",
		"Content-Type":                 "text/html; charset=utf-8",
	}
	for key, want := range checks {
		if got := response.Header.Get(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	if got := response.Header.Get("Content-Range"); got != "bytes 2-5/10" {
		t.Errorf("Content-Range = %q", got)
	}
}

func TestWASMMIMEAndImmutableCache(t *testing.T) {
	server, handler := testServer(t)
	response := request(t, server, http.MethodGet, "/js/vendor/ffmpeg/ffmpeg-core.wasm", handler.expectedHost, nil)
	defer response.Body.Close()
	if got := response.Header.Get("Content-Type"); got != "application/wasm" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := response.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}

func TestReadyContractGETAndHEAD(t *testing.T) {
	server, handler := testServer(t)
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := request(t, server, method, "/__jiudi/encoder-ready", handler.expectedHost, nil)
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s status = %d", method, response.StatusCode)
		}
		if response.Header.Get("Content-Type") != "application/json; charset=utf-8" {
			t.Errorf("%s content type = %q", method, response.Header.Get("Content-Type"))
		}
		if method == http.MethodGet && string(body) != `{"ready": true, "state": "ready", "error": ""}` {
			t.Errorf("GET body = %q", body)
		}
		if method == http.MethodHead && len(body) != 0 {
			t.Errorf("HEAD body = %q", body)
		}
	}
}

func TestRejectsWrongHostMethodsAndPrivatePaths(t *testing.T) {
	server, handler := testServer(t)
	tests := []struct {
		method string
		path   string
		host   string
		status int
	}{
		{http.MethodGet, "/", "localhost:" + strings.Split(handler.expectedHost, ":")[1], http.StatusMisdirectedRequest},
		{http.MethodPost, "/", handler.expectedHost, http.StatusMethodNotAllowed},
		{http.MethodGet, "/serve.py", handler.expectedHost, http.StatusNotFound},
		{http.MethodGet, "/js/../serve.py", handler.expectedHost, http.StatusNotFound},
		{http.MethodGet, "/css/", handler.expectedHost, http.StatusNotFound},
		{http.MethodGet, "/.git/config", handler.expectedHost, http.StatusNotFound},
	}
	for _, tc := range tests {
		response := request(t, server, tc.method, tc.path, tc.host, nil)
		response.Body.Close()
		if response.StatusCode != tc.status {
			t.Errorf("%s %s host %s = %d, want %d", tc.method, tc.path, tc.host, response.StatusCode, tc.status)
		}
	}
}

func TestAssetValidationAndSelfTest(t *testing.T) {
	data := []byte("magic payload")
	digest := sha256.Sum256(data)
	specs := map[string]assetSpec{
		"one.js": {contentType: "text/javascript; charset=utf-8", sha256: hex.EncodeToString(digest[:]), minBytes: 4, maxBytes: 32, signature: []byte("magic")},
	}
	valid := fstest.MapFS{"one.js": &fstest.MapFile{Data: data}}
	if err := validateAssets(valid, specs); err != nil {
		t.Fatalf("valid assets: %v", err)
	}
	withExtra := fstest.MapFS{
		"one.js":   &fstest.MapFile{Data: data},
		"extra.js": &fstest.MapFile{Data: []byte("extra")},
	}
	if err := validateExactAssets(withExtra, specs); err == nil || !strings.Contains(err.Error(), "unexpected embedded asset") {
		t.Fatalf("unexpected asset error = %v", err)
	}
	missing := fstest.MapFS{}
	if err := validateAssets(missing, specs); err == nil || !strings.Contains(err.Error(), "required asset one.js") {
		t.Fatalf("missing asset error = %v", err)
	}
	corrupt := fstest.MapFS{"one.js": &fstest.MapFile{Data: []byte("magic changed")}}
	if err := validateAssets(corrupt, specs); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("corrupt asset error = %v", err)
	}
}

func TestPublicAssetMapUsesSafeFileNames(t *testing.T) {
	for _, specs := range []map[string]assetSpec{embeddedAssetSpecs, encoderAssetSpecs} {
		for name := range specs {
			if !fs.ValidPath(name) || strings.HasPrefix(name, ".") {
				t.Errorf("unsafe public asset name %q", name)
			}
		}
	}
}

func TestEncoderDownloadsOnceCachesAndVerifiesOnRead(t *testing.T) {
	encoder, files, fetchCount := testEncoder(t)
	state := encoder.verify(context.Background())
	if !state.ready || state.state != "ready" {
		t.Fatalf("encoder state = %+v", state)
	}
	if *fetchCount != len(files) {
		t.Fatalf("fetch count = %d, want %d", *fetchCount, len(files))
	}
	for name, want := range files {
		got, err := encoder.asset(name)
		if err != nil || string(got) != string(want) {
			t.Fatalf("cached %s = %q, %v", name, got, err)
		}
		info, err := os.Stat(filepath.Join(encoder.cacheDir, filepath.Base(name)))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0077 != 0 {
			t.Errorf("cache permissions for %s = %o", name, info.Mode().Perm())
		}
	}

	second := newEncoderManager(encoder.cacheDir, encoder.specs, encoder.urls, func(context.Context, string, int64) ([]byte, error) {
		return nil, errors.New("cache should avoid downloads")
	})
	if !second.snapshot().ready {
		t.Fatal("verified cache was not accepted at startup")
	}
	corruptName := "js/vendor/ffmpeg/ffmpeg-core.js"
	if err := os.WriteFile(filepath.Join(encoder.cacheDir, filepath.Base(corruptName)), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := second.asset(corruptName); err == nil {
		t.Fatal("corrupted cached encoder was served")
	}
}

func TestEncoderRejectsInvalidDownloadWithoutFinalFile(t *testing.T) {
	data := []byte("expected magic")
	digest := sha256.Sum256(data)
	name := "js/vendor/ffmpeg/ffmpeg-core.js"
	specs := map[string]assetSpec{name: {
		sha256: hex.EncodeToString(digest[:]), minBytes: 4, maxBytes: 64, signature: []byte("magic"),
	}}
	encoder := newEncoderManager(t.TempDir(), specs, map[string][]string{name: {"memory://bad"}}, func(context.Context, string, int64) ([]byte, error) {
		return []byte("invalid payload"), nil
	})
	state := encoder.verify(context.Background())
	if state.ready || state.state != "failed" || !strings.Contains(state.err, "invalid signature") {
		t.Fatalf("invalid download state = %+v", state)
	}
	if _, err := os.Stat(filepath.Join(encoder.cacheDir, filepath.Base(name))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid final cache file exists: %v", err)
	}
}

func TestConcurrentReadinessUsesOneSharedWorker(t *testing.T) {
	encoder, files, fetchCount := testEncoder(t)
	var waiters sync.WaitGroup
	waiters.Add(2)
	for i := 0; i < 2; i++ {
		go func() {
			defer waiters.Done()
			if state := encoder.wait(context.Background(), time.Second); !state.ready {
				t.Errorf("readiness state = %+v", state)
			}
		}()
	}
	waiters.Wait()
	if *fetchCount != len(files) {
		t.Fatalf("fetch count = %d, want %d", *fetchCount, len(files))
	}
}

func TestWrongHostCannotTriggerEncoderDownload(t *testing.T) {
	encoder, _, fetchCount := testEncoder(t)
	handler := &runtimeHandler{assets: fstest.MapFS{}, encoder: encoder}
	server := startTestServer(t, handler)
	response := request(t, server, http.MethodGet, "/__jiudi/encoder-ready", "localhost:1", nil)
	response.Body.Close()
	if response.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if *fetchCount != 0 || encoder.snapshot().state != "idle" {
		t.Fatalf("wrong Host triggered encoder: count=%d state=%s", *fetchCount, encoder.snapshot().state)
	}
}

func TestEncoderWaitReportsPreparingWhileSharedWorkerContinues(t *testing.T) {
	name := "js/vendor/ffmpeg/ffmpeg-core.js"
	data := []byte("createFFmpegCore payload")
	digest := sha256.Sum256(data)
	specs := map[string]assetSpec{name: {
		sha256: hex.EncodeToString(digest[:]), minBytes: 4, maxBytes: 64, signature: []byte("createFFmpegCore"),
	}}
	release := make(chan struct{})
	encoder := newEncoderManager(t.TempDir(), specs, map[string][]string{name: {"memory://slow"}}, func(context.Context, string, int64) ([]byte, error) {
		<-release
		return data, nil
	})
	state := encoder.wait(context.Background(), time.Millisecond)
	if state.ready || state.state != "preparing" || string(state.json()) != `{"ready": false, "state": "preparing", "error": ""}` {
		t.Fatalf("preparing state = %+v, json=%s", state, state.json())
	}
	close(release)
	if state = encoder.verify(context.Background()); !state.ready {
		t.Fatalf("eventual state = %+v", state)
	}
}

func TestEncoderRetriesAfterTransientFailure(t *testing.T) {
	name := "js/vendor/ffmpeg/ffmpeg-core.js"
	data := []byte("createFFmpegCore retry payload")
	digest := sha256.Sum256(data)
	specs := map[string]assetSpec{name: {
		sha256: hex.EncodeToString(digest[:]), minBytes: 4, maxBytes: 64, signature: []byte("createFFmpegCore"),
	}}
	calls := 0
	encoder := newEncoderManager(t.TempDir(), specs, map[string][]string{name: {"memory://retry"}}, func(context.Context, string, int64) ([]byte, error) {
		calls++
		if calls <= 2 {
			return nil, errors.New("temporary outage")
		}
		return data, nil
	})
	if first := encoder.verify(context.Background()); first.state != "failed" {
		t.Fatalf("first state = %+v", first)
	}
	if second := encoder.verify(context.Background()); !second.ready {
		t.Fatalf("retry state = %+v", second)
	}
}

func TestCacheReadChecksSizeBeforeLoading(t *testing.T) {
	name := "js/vendor/ffmpeg/ffmpeg-core.wasm"
	cacheDir := t.TempDir()
	specs := map[string]assetSpec{name: {minBytes: 4, maxBytes: 64, signature: []byte("\x00asm")}}
	if err := os.WriteFile(filepath.Join(cacheDir, filepath.Base(name)), bytes.Repeat([]byte{'x'}, 65), 0600); err != nil {
		t.Fatal(err)
	}
	encoder := newEncoderManager(cacheDir, specs, nil, nil)
	if _, err := encoder.readVerified(name); err == nil || !strings.Contains(err.Error(), "exceeds 64 bytes") {
		t.Fatalf("oversized cache error = %v", err)
	}
}

func TestEncoderDownloadTimeoutAllowsSlowCoreTransfer(t *testing.T) {
	if downloadTimeout < 2*time.Minute {
		t.Fatalf("download timeout = %s", downloadTimeout)
	}
}
