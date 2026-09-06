# 开发 / Development

[中文首页](../README.md) · [English overview](../README.en.md)

## 在浏览器中运行 / Run locally

准备 Python 3.10 或更新版本，在仓库根目录运行：

With Python 3.10 or later, run from the repository root:

```sh
python3 serve.py --open
```

Windows 也可以使用 `py -3 serve.py --open`。服务只监听本机地址，并提供视频 WebAssembly 所需的隔离响应头。终端会显示实际访问地址，按 Ctrl+C 退出。页面可以直接修改后刷新。

On Windows, use `py -3 serve.py --open`. The server binds to loopback and supplies the isolation headers needed by the video engine. It prints the local URL; press Ctrl+C to stop it. Refresh the browser after editing the frontend.

图片和 PDF 所需的库已经随源码附带。视频核心在首次使用时从固定的上游地址下载，按 SHA-256 校验。源码模式将这些依赖缓存在 `js/vendor/ffmpeg/`，相关文件已在 `.gitignore` 中排除。

Image and PDF libraries are included. On first video use, the development server downloads pinned upstream encoder files and verifies their SHA-256 hashes. Source mode caches them under `js/vendor/ffmpeg/`; those downloaded files are gitignored.

## Go 独立服务 / Standalone Go server

Go 模块要求 Go 1.24+；v1.1.1 分发包使用 Go 1.27.1 构建。Go 服务将界面资源嵌入可执行文件，运行时无需 Python。

The module requires Go 1.24+; the v1.1.1 binaries were built with Go 1.27.1. The Go server embeds the frontend and runs without Python.

```sh
python3 tools/prepare_runtime.py
cd distribution/runtime
go test ./...
go run . --self-test
go run .
```

`prepare_runtime.py` 会核对发布版本的资源清单，然后生成被 Git 忽略的 `assets/`。修改前端后，可以先用 Python 服务开发；重新构建嵌入资源时，需要同步更新 `distribution/assets-manifest.json` 和 `distribution/runtime/assetspec.go` 中的校验值。

`prepare_runtime.py` verifies the release manifest before populating the gitignored `assets/` directory. Use the Python server while editing the frontend. To embed changed assets, update their hashes in both `distribution/assets-manifest.json` and `distribution/runtime/assetspec.go`.

例如，在 macOS/Linux 中交叉编译 Windows x64 服务：

For example, cross-compile the Windows x64 server from macOS/Linux:

```sh
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -o Jiudi.exe .
```

## macOS 窗口 / macOS shell

`macos/JiudiApp.swift` 提供 Cocoa/WebKit 窗口、本机保存及菜单支持。安装 Xcode Command Line Tools 后，在仓库根目录执行 `bash macos/build.sh` 可构建本机开发窗口；这个开发版本使用旁边的源码与 Python 服务。GitHub Release 提供的通用 Mac 包内置 Go 服务。

`macos/JiudiApp.swift` provides the Cocoa/WebKit window, native saving and menus. With Xcode Command Line Tools installed, run `bash macos/build.sh` from the repository root to build a local development shell. That development shell uses the adjacent source tree and Python server. The universal Mac download on Releases includes the Go server.

## 目录 / Layout

| Path | Purpose |
|---|---|
| `*.html`, `css/`, `js/` | 界面与媒体处理 / UI and media processing |
| `serve.py` | Python 本机开发服务 / Python development server |
| `distribution/runtime/` | Go 独立服务与测试 / Go server and tests |
| `macos/` | Swift 窗口与开发构建脚本 / Swift shell and development build |
| `Licenses/` | 第三方许可、版本和来源 / Third-party licenses and provenance |
| `docs/images/` | 真实界面截图，使用程序生成素材 / Real screenshots with generated samples |

## 语言统计 / Language statistics

GitHub 根据仓库实际源码生成语言比例。`.gitattributes` 将第三方库标为 vendored，将截图、许可及文档排除出代码统计，生成的嵌入资源通过 `.gitignore` 排除。

GitHub computes language proportions from the source. `.gitattributes` marks third-party libraries as vendored and documentation as documentation; generated embedded copies are gitignored.

## 反馈 / Contributing

欢迎提交 Issue 或 Pull Request。涉及媒体处理时，请使用自行生成或获得授权的样例，附上系统、复现步骤、预期结果与实际结果。修改第三方依赖时，一并更新校验值、版本及许可记录。

Issues and pull requests are welcome. For media bugs, use generated or appropriately licensed samples and include the OS, steps to reproduce, expected behavior and actual result. Dependency changes should include updated hashes, versions and license records.
