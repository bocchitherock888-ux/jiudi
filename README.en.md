<div align="right"><a href="README.md">中文</a></div>

<div align="center">
  <img src="apple-touch-icon.png" width="88" height="88" alt="Jiudi icon">
  <h1>Jiudi · 就地</h1>
  <p>Handle images, PDFs, and video locally. Save every result as a new file.</p>

  [![Latest release](https://img.shields.io/github/v/release/bocchitherock888-ux/jiudi?label=release&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases/latest)
  [![MIT License](https://img.shields.io/github/license/bocchitherock888-ux/jiudi?color=3b7457)](LICENSE)
  [![Total downloads](https://img.shields.io/github/downloads/bocchitherock888-ux/jiudi/total?label=downloads&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases)
  ![macOS 13+](https://img.shields.io/badge/macOS-13%2B-555555?logo=apple)
  ![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-555555?logo=windows11)
</div>

![Jiudi home screen](docs/images/home.jpg)

Jiudi is a lightweight desktop utility for everyday media work. It processes files on your computer, keeps the originals, and saves results separately. Everything required for image and PDF tasks is bundled, so those tools also work offline. The current app interface is in Chinese, while the project documentation is available in Chinese and English.

## Download

The current release is **v1.1.0**. Desktop builds run without a Python installation.

| Platform | Download | Size | Compatibility |
|---|---|---:|---|
| macOS | [Jiudi-1.1.0-Mac-Universal.zip](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/Jiudi-1.1.0-Mac-Universal.zip) | 8.6 MB | macOS 13+, Apple silicon / Intel |
| Windows x64 | [Jiudi-1.1.0-Windows-x64.zip](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/Jiudi-1.1.0-Windows-x64.zip) | 3.9 MB | Windows 10/11, Intel / AMD |
| Windows ARM64 | [Jiudi-1.1.0-Windows-ARM64.zip](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/Jiudi-1.1.0-Windows-ARM64.zip) | 3.6 MB | Windows 10/11, ARM64 |

Release checksums are available in [SHA256SUMS.txt](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/SHA256SUMS.txt).

## What you can do

- **Images:** crop, rotate, convert formats, compress to a size cap, and bundle multiple results.
- **PDFs:** select and reorder pages, merge and compress documents, or export a PDF or images. Default compression preserves text and vector content.
- **Video:** trim a segment and adjust resolution, audio, and target size.

Image size caps and the optional PDF cap apply to the final output byte count, using `1 KB = 1000 bytes`. Jiudi seeks the highest practical quality within that cap. The achievable result depends on the content, and information-dense files may exceed very small targets.

On first use, video tools download about 32 MB of a pinned upstream FFmpeg core. Jiudi verifies its integrity and caches it for later use.

<table>
  <tr>
    <td width="50%"><a href="docs/images/image.jpg"><img src="docs/images/image.jpg" alt="Image tools"></a></td>
    <td width="50%"><a href="docs/images/pdf.jpg"><img src="docs/images/pdf.jpg" alt="PDF tools"></a></td>
  </tr>
  <tr><td align="center">Image tools</td><td align="center">PDF tools</td></tr>
</table>

All sample media shown here was generated programmatically. The screenshots contain no personal photos or private files.

## Getting started

**Mac:** Download and unpack the Universal build, then move “就地.app” to a convenient location and open it. The app has an ad-hoc signature and has not been notarized by Apple. On first launch, follow the developer-confirmation steps provided by macOS.

**Windows:** Download the archive for your CPU and extract it completely. Run the included `.exe`; Jiudi opens its interface in your default browser. Return to the program window and press Enter to quit. The Windows builds are unsigned, so Windows may show a security confirmation on first launch.

The Mac build has been tested for standalone launch, navigation, exit cleanup, and JPEG, PDF, ZIP, and MP4 flows using generated media. Windows builds have passed cross-compilation, architecture, and package-integrity checks. They have not yet been tested on physical Windows devices.

## Source and development

The repository includes the HTML/CSS/JavaScript frontend, standalone Go runtime, Swift Mac shell, and Python development server and runtime-preparation helper. Start a local preview with Python 3.10 or later:

```bash
python3 serve.py --open
```

See the [development guide](docs/DEVELOPMENT.md) for Go build instructions and the project layout.

<p>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=111" alt="JavaScript">
  <img src="https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Swift-F05138?logo=swift&logoColor=white" alt="Swift">
  <img src="https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white" alt="Python">
</p>

## Licensing and feedback

Jiudi's original code and documentation are available under the [MIT License](LICENSE), with copyright held by bocchitherock888-ux. [NOTICE.md](NOTICE.md) explains the license scope. Third-party components retain their own licenses; versions, sources, and license texts are listed in the [third-party notices](Licenses/THIRD-PARTY-NOTICES.md). The FFmpeg core downloaded for video work contains GPL components and remains subject to its upstream license.

To report a problem, [open an issue](https://github.com/bocchitherock888-ux/jiudi/issues/new) with your operating-system version, CPU architecture, and reproduction steps. Personal files are unnecessary.
