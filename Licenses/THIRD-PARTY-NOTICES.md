# Third-Party Notices

Jiudi's packaged web assets include the components listed below. SHA-256 values identify the exact files in the distribution asset manifest. The referenced license files are distributed beside this notice.

## Packaged components

### pdf-lib 1.17.1

- Files: `js/vendor/pdf-lib.min.js`
- SHA-256: `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f`
- License: MIT, `LICENSE-pdf-lib-MIT.txt`
- Copyright: Copyright (c) 2019 Andrew Dillon
- Source: https://github.com/Hopding/pdf-lib/tree/v1.17.1

The standalone browser bundle incorporates the following release dependencies:

- `@pdf-lib/standard-fonts` 1.0.0 — MIT; `LICENSE-pdf-lib-standard-fonts-MIT.txt`
- `@pdf-lib/upng` 1.0.1 — MIT; `LICENSE-pdf-lib-upng-MIT.txt`
- pako 1.0.10 and 1.0.11 — MIT; `LICENSE-pako-MIT.txt`
- tslib 1.11.1 — Apache-2.0; `LICENSE-tslib-Apache-2.0.txt` and `COPYRIGHT-tslib.txt`

### PDF.js (`pdfjs-dist`) 3.11.174

- Files: `js/vendor/pdf.min.js`, `js/vendor/pdf.worker.min.js`
- SHA-256: `5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946`, `feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b`
- License: Apache-2.0, `LICENSE-pdfjs-Apache-2.0.txt`
- Copyright: Copyright 2023 Mozilla Foundation
- Source: https://github.com/mozilla/pdf.js/tree/v3.11.174

### JSZip 3.10.1

- File: `js/vendor/jszip.min.js`
- SHA-256: `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e`
- License selection: MIT from the upstream MIT OR GPL-3.0-or-later choice; `LICENSE-jszip-MIT-or-GPL-3.0.txt`
- Copyright: Copyright (c) 2009–2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso
- Source: https://github.com/Stuk/jszip/tree/v3.10.1

The browser bundle incorporates code from pako, lie, and setimmediate. JSZip also declares readable-stream 2.3.6 for Node use; its browser map replaces that package with JSZip's local stream shim. The readable-stream license remains included as part of the release dependency inventory.

- pako 1.0.5 — MIT; `LICENSE-pako-MIT.txt`
- lie 3.3.0 — MIT; `LICENSE-lie-MIT.txt`
- readable-stream 2.3.6 — MIT, declared Node dependency; `LICENSE-readable-stream-MIT.txt`
- setimmediate 1.0.5 — MIT; `LICENSE-setimmediate-MIT.txt`

### ffmpeg.wasm JavaScript API 0.12.10

- Files: `js/vendor/ffmpeg/ffmpeg.js`, `js/vendor/ffmpeg/814.ffmpeg.js`
- SHA-256: `a4c09a1997ac582a735fc21e20f9913df4af6dde4ebb373f1d714a4b6e7616f1`, `c4702e2f749671b2f9cf07e4738abaf4511fc0d89525ad6a93bc3c2a8ad0822a`
- License: MIT, `LICENSE-ffmpeg-wasm-MIT.txt`
- Copyright: Copyright (c) 2019 Jerome Wu
- Source: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10

## Optional FFmpeg core downloaded on demand

Video encoding downloads the pinned `@ffmpeg/core` 0.12.6 JavaScript and WebAssembly artifacts into Jiudi's per-user cache. These files are external runtime dependencies and are absent from the packaged Jiudi binary.

- `ffmpeg-core.js` SHA-256: `a34873964b0f62aec516bac75e3aa9086ec3535d4d07f0269aa94ea748b6cb71`
- `ffmpeg-core.wasm` SHA-256: `2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61`
- Object downloads: https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ and https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/
- Build recipe reviewed: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10
- FFmpeg source version named by that recipe: https://github.com/FFmpeg/FFmpeg/tree/n5.1.4
- License copy: `LICENSE-ffmpeg-core-GPL-2.0.txt`

The reviewed upstream recipe enables GPL mode and links FFmpeg with x264, x265, libvpx, LAME, Ogg, Theora, Vorbis, Opus, zlib, libwebp, FreeType, FriBidi, HarfBuzz, libass, and zimg. Recipients of the downloaded object code receive the rights and obligations stated by the applicable upstream licenses, including the GPL corresponding-source terms. Exact corresponding source for the published 0.12.6 core artifacts has not been established by this review; see the distribution provenance report before redistributing those core files.

## Go runtime

Jiudi binaries include a Go runtime built with Go 1.27.1. The Go license and patent grant are included in the release as `Go-LICENSE.txt` and `Go-PATENTS.txt`.
