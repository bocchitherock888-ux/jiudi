#!/usr/bin/env python3
"""Serve 就地 on loopback with the isolation headers required by ffmpeg.wasm."""

from __future__ import annotations

import hashlib
import json
import os
import webbrowser
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Optional

ROOT = Path(__file__).resolve().parent
FFMPEG_DIR = ROOT / "js" / "vendor" / "ffmpeg"
DOWNLOAD_TIMEOUT = 12
READY_WAIT_SECONDS = 18
ROOT_FILES = {
    "index.html", "image.html", "pdf.html", "video.html",
    "favicon.png", "apple-touch-icon.png", "icon-1024.png",
}
FFMPEG_FILES = {
    "ffmpeg.js": {
        "sha256": "a4c09a1997ac582a735fc21e20f9913df4af6dde4ebb373f1d714a4b6e7616f1",
        "max_bytes": 64 * 1024,
        "signature": b"FFmpegWASM",
        "urls": [
            "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js",
            "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js",
        ],
    },
    "814.ffmpeg.js": {
        "sha256": "c4702e2f749671b2f9cf07e4738abaf4511fc0d89525ad6a93bc3c2a8ad0822a",
        "max_bytes": 64 * 1024,
        "signature": b"FFmpeg",
        "urls": [
            "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js",
            "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js",
        ],
    },
    "ffmpeg-core.js": {
        "sha256": "a34873964b0f62aec516bac75e3aa9086ec3535d4d07f0269aa94ea748b6cb71",
        "max_bytes": 512 * 1024,
        "signature": b"createFFmpegCore",
        "urls": [
            "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
        ],
    },
    "ffmpeg-core.wasm": {
        "sha256": "2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61",
        "max_bytes": 40 * 1024 * 1024,
        "signature": b"\x00asm",
        "urls": [
            "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
        ],
    },
}

_encoder_lock = threading.Lock()
_encoder_done = threading.Event()
_encoder_started = False
_encoder_ready = False
_encoder_error = ""


def _valid_asset(path: Path, name: str) -> bool:
    spec = FFMPEG_FILES[name]
    try:
        size = path.stat().st_size
        if size < 1024 or size > spec["max_bytes"]:
            return False
        hasher = hashlib.sha256()
        with path.open("rb") as handle:
            prefix = handle.read(256)
            hasher.update(prefix)
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        digest = hasher.hexdigest()
        if digest != spec["sha256"]:
            return False
        if name.endswith(".wasm"):
            return prefix.startswith(spec["signature"])
        return spec["signature"] in prefix.lstrip()
    except OSError:
        return False


def _download_asset(name: str) -> None:
    spec = FFMPEG_FILES[name]
    dest = FFMPEG_DIR / name
    if _valid_asset(dest, name):
        return
    last_error: Optional[Exception] = None
    for attempt in range(2):
        for url in spec["urls"]:
            tmp_name: Optional[str] = None
            try:
                print(f"下载编码器 {name}（第 {attempt + 1} 次）…", flush=True)
                request = urllib.request.Request(url, headers={"User-Agent": "Jiudi/1.0"})
                with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT) as response:
                    if response.status != HTTPStatus.OK:
                        raise RuntimeError(f"HTTP {response.status}")
                    length = response.headers.get("Content-Length")
                    if length and int(length) > spec["max_bytes"]:
                        raise RuntimeError("文件大小异常")
                    with tempfile.NamedTemporaryFile(
                        prefix=f".{name}.", suffix=".part", dir=FFMPEG_DIR, delete=False
                    ) as tmp:
                        tmp_name = tmp.name
                        total = 0
                        while True:
                            chunk = response.read(256 * 1024)
                            if not chunk:
                                break
                            total += len(chunk)
                            if total > spec["max_bytes"]:
                                raise RuntimeError("下载超过大小上限")
                            tmp.write(chunk)
                        tmp.flush()
                        os.fsync(tmp.fileno())
                candidate = Path(tmp_name)
                if not _valid_asset(candidate, name):
                    raise RuntimeError("编码器校验失败")
                os.replace(candidate, dest)
                return
            except Exception as exc:
                last_error = exc
                if tmp_name:
                    try:
                        Path(tmp_name).unlink()
                    except OSError:
                        pass
    raise RuntimeError(f"{name}: {last_error}")


def ensure_ffmpeg() -> None:
    global _encoder_ready, _encoder_error
    try:
        FFMPEG_DIR.mkdir(parents=True, exist_ok=True)
        for name in FFMPEG_FILES:
            _download_asset(name)
        _encoder_ready = True
    except Exception as exc:
        _encoder_error = str(exc)
        print(f"编码器准备失败：{exc}（视频可使用实时重录）", flush=True)
    finally:
        _encoder_done.set()


def start_encoder_once() -> None:
    global _encoder_started
    with _encoder_lock:
        if _encoder_started:
            return
        _encoder_started = True
        threading.Thread(target=ensure_ffmpeg, name="ffmpeg-download", daemon=True).start()


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
    }

    def _encoder_response(self, include_body: bool) -> None:
        start_encoder_once()
        _encoder_done.wait(READY_WAIT_SECONDS)
        payload = json.dumps({
            "ready": _encoder_ready,
            "state": "ready" if _encoder_ready else ("failed" if _encoder_done.is_set() else "preparing"),
            "error": _encoder_error if _encoder_done.is_set() else "",
        }, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if include_body:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_GET(self) -> None:
        if urllib.parse.urlsplit(self.path).path == "/__jiudi/encoder-ready":
            self._encoder_response(True)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if urllib.parse.urlsplit(self.path).path == "/__jiudi/encoder-ready":
            self._encoder_response(False)
            return
        super().do_HEAD()

    def translate_path(self, path: str) -> str:
        raw_path = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        if raw_path == "/":
            raw_path = "/index.html"
        relative = PurePosixPath(raw_path.lstrip("/"))
        parts = relative.parts
        allowed = (
            len(parts) == 1 and parts[0] in ROOT_FILES
        ) or (
            len(parts) >= 2 and parts[0] == "css" and relative.suffix == ".css"
        ) or (
            len(parts) >= 2 and parts[0] == "js" and relative.suffix in {".js", ".wasm"}
        )
        if not allowed or any(part in {"", ".", ".."} or part.startswith(".") for part in parts):
            return str(ROOT / "__denied__")
        candidate = ROOT.joinpath(*parts)
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(ROOT)
        except (OSError, ValueError):
            return str(ROOT / "__denied__")
        if not resolved.is_file():
            return str(ROOT / "__denied__")
        return str(resolved)

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if urllib.parse.urlsplit(self.path).path.startswith("/js/vendor/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s\n" % (fmt % args))


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--open"]
    want_open = "--open" in sys.argv[1:]
    host = "127.0.0.1"
    port = int(args[0]) if args else 0
    httpd = ThreadingHTTPServer((host, port), Handler)
    actual_port = httpd.server_address[1]
    url = f"http://{host}:{actual_port}/"
    print(f"就地  {url}", flush=True)
    if want_open:
        def _open() -> None:
            time.sleep(0.15)
            try:
                webbrowser.open(url)
            except OSError:
                pass
        threading.Thread(target=_open, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
