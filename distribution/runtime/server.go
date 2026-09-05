package main

import (
	"bytes"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

type runtimeHandler struct {
	assets       fs.FS
	expectedHost string
	encoder      *encoderManager
}

func (h *runtimeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.setHeaders(w, r.URL.Path)
	if r.Host != h.expectedHost {
		http.Error(w, "misdirected request", http.StatusMisdirectedRequest)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/__jiudi/encoder-ready" {
		h.serveReady(w, r)
		return
	}

	name, ok := publicAssetName(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	spec, _ := publicAssetSpec(name)
	var data []byte
	var err error
	if _, dynamic := encoderAssetSpecs[name]; dynamic {
		data, err = h.encoder.asset(name)
	} else {
		data, err = fs.ReadFile(h.assets, name)
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", spec.contentType)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func publicAssetName(requestPath string) (string, bool) {
	if requestPath == "/" {
		return "index.html", true
	}
	if requestPath == "" || requestPath[0] != '/' || strings.Contains(requestPath, "\\") {
		return "", false
	}
	name := strings.TrimPrefix(requestPath, "/")
	_, ok := publicAssetSpec(name)
	return name, ok
}

func (h *runtimeHandler) serveReady(w http.ResponseWriter, r *http.Request) {
	state := h.encoder.wait(r.Context(), encoderReadyWait)
	payload := state.json()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(payload)
	}
}

func (h *runtimeHandler) setHeaders(w http.ResponseWriter, requestPath string) {
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if strings.HasPrefix(requestPath, "/js/vendor/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
}
