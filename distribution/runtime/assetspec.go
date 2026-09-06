package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"strings"
)

type assetSpec struct {
	contentType string
	sha256      string
	minBytes    int64
	maxBytes    int64
	signature   []byte
}

var embeddedAssetSpecs = map[string]assetSpec{
	"index.html":                     pinnedSpec("text/html; charset=utf-8", "fe21a5ef5563fac10592578b83e056e23892f2bc0c4842e743985dec7883bd45"),
	"image.html":                     pinnedSpec("text/html; charset=utf-8", "558e7e3e2ba7eb34341a5a612fd520d26dbd0cb3df09c97e99d5a09291b79048"),
	"pdf.html":                       pinnedSpec("text/html; charset=utf-8", "3beec38755babd0d9045fce1c9d63e913621543fa18f513c5ecc48d2e51aebfa"),
	"video.html":                     pinnedSpec("text/html; charset=utf-8", "71b0e090b99573e3093c0fac3a01b070c2927f384ab62814080794ef88b71f96"),
	"favicon.png":                    pinnedSpec("image/png", "8bb7032943b008674f8efd73fece1bf7b4dfa4ceb5370a6acc954899a7c68085"),
	"apple-touch-icon.png":           pinnedSpec("image/png", "a708344ccade9eb652597f502c809dd7bc6b338e7d0a1cab3aa85a2888b93977"),
	"css/app.css":                    pinnedSpec("text/css; charset=utf-8", "e79f0aaf28a87216b1b7ae4b50599f4faf435be960412b55e8d10eed4e5916cf"),
	"js/common.js":                   pinnedSpec("text/javascript; charset=utf-8", "e7823b61b957fe3326ce15fe1213f14a687ab74358c6fcfda7a761cd73df199d"),
	"js/image.js":                    pinnedSpec("text/javascript; charset=utf-8", "4d799b0a87888555951b3c1fc956fbfd1a4783f9040f34a61e9a2531849c0c79"),
	"js/pdf.js":                      pinnedSpec("text/javascript; charset=utf-8", "48a354ca25b82fd8510e131808d24171e45c302e076e9c3b0678a194e00551e2"),
	"js/video.js":                    pinnedSpec("text/javascript; charset=utf-8", "b96efe208dfd722f1cbf907a55b3c604495476e7c89dfbc49b923a6f1b9398ca"),
	"js/vendor/jszip.min.js":         pinnedSpec("text/javascript; charset=utf-8", "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e"),
	"js/vendor/pdf-lib.min.js":       pinnedSpec("text/javascript; charset=utf-8", "0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f"),
	"js/vendor/pdf.min.js":           pinnedSpec("text/javascript; charset=utf-8", "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946"),
	"js/vendor/pdf.worker.min.js":    pinnedSpec("text/javascript; charset=utf-8", "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b"),
	"js/vendor/ffmpeg/ffmpeg.js":     ffmpegSpec("text/javascript; charset=utf-8", "a4c09a1997ac582a735fc21e20f9913df4af6dde4ebb373f1d714a4b6e7616f1", 64*1024, []byte("FFmpegWASM")),
	"js/vendor/ffmpeg/814.ffmpeg.js": ffmpegSpec("text/javascript; charset=utf-8", "c4702e2f749671b2f9cf07e4738abaf4511fc0d89525ad6a93bc3c2a8ad0822a", 64*1024, []byte("FFmpeg")),
}

var encoderAssetSpecs = map[string]assetSpec{
	"js/vendor/ffmpeg/ffmpeg-core.js":   ffmpegSpec("text/javascript; charset=utf-8", "a34873964b0f62aec516bac75e3aa9086ec3535d4d07f0269aa94ea748b6cb71", 512*1024, []byte("createFFmpegCore")),
	"js/vendor/ffmpeg/ffmpeg-core.wasm": ffmpegSpec("application/wasm", "2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61", 40*1024*1024, []byte("\x00asm")),
}

func pinnedSpec(contentType, digest string) assetSpec {
	return assetSpec{contentType: contentType, sha256: digest}
}

func ffmpegSpec(contentType, digest string, maxBytes int64, signature []byte) assetSpec {
	return assetSpec{
		contentType: contentType,
		sha256:      digest,
		minBytes:    1024,
		maxBytes:    maxBytes,
		signature:   signature,
	}
}

func validateAssets(assetFS fs.FS, specs map[string]assetSpec) error {
	for name, spec := range specs {
		data, err := fs.ReadFile(assetFS, name)
		if err != nil {
			return fmt.Errorf("required asset %s: %w", name, err)
		}
		if err := validateAssetData(name, data, spec); err != nil {
			return err
		}
	}
	return nil
}

func validateExactAssets(assetFS fs.FS, specs map[string]assetSpec) error {
	if err := validateAssets(assetFS, specs); err != nil {
		return err
	}
	return fs.WalkDir(assetFS, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if _, ok := specs[path]; !ok {
			return fmt.Errorf("unexpected embedded asset %s", path)
		}
		return nil
	})
}

func validateAssetData(name string, data []byte, spec assetSpec) error {
	if err := validateAssetSize(name, int64(len(data)), spec); err != nil {
		return err
	}
	if len(spec.signature) > 0 {
		prefix := data
		if len(prefix) > 256 {
			prefix = prefix[:256]
		}
		if !strings.Contains(string(prefix), string(spec.signature)) {
			return fmt.Errorf("asset %s has an invalid signature", name)
		}
	}
	if spec.sha256 != "" {
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != spec.sha256 {
			return fmt.Errorf("asset %s failed SHA-256 verification", name)
		}
	}
	return nil
}

func validateAssetSize(name string, size int64, spec assetSpec) error {
	if size == 0 {
		return fmt.Errorf("required asset %s is empty", name)
	}
	if spec.minBytes > 0 && size < spec.minBytes {
		return fmt.Errorf("asset %s is smaller than %d bytes", name, spec.minBytes)
	}
	if spec.maxBytes > 0 && size > spec.maxBytes {
		return fmt.Errorf("asset %s exceeds %d bytes", name, spec.maxBytes)
	}
	return nil
}

func publicAssetSpec(name string) (assetSpec, bool) {
	if spec, ok := embeddedAssetSpecs[name]; ok {
		return spec, true
	}
	spec, ok := encoderAssetSpecs[name]
	return spec, ok
}
