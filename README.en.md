<div align="right"><a href="README.md">中文</a></div>

<img src="apple-touch-icon.png" width="72" height="72" alt="Jiudi icon">

# Jiudi · 就地

Crop and compress images, organise PDFs, and trim video. Files are processed on your computer and results are saved separately.

![Jiudi home](docs/images/home.jpg)

## Download

| Platform | Download |
|---|---|
| macOS 13+, Apple silicon / Intel | [Mac Universal](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.1/Jiudi-1.1.1-Mac-Universal.zip) |
| Windows 10/11, Intel / AMD | [Windows x64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.1/Jiudi-1.1.1-Windows-x64.zip) |
| Windows 10/11, ARM64 | [Windows ARM64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.1/Jiudi-1.1.1-Windows-ARM64.zip) |

[Release notes and checksums](https://github.com/bocchitherock888-ux/jiudi/releases/latest)

**Mac:** Unzip and open “就地.app”. **Windows:** Extract the archive and run `Jiudi.exe`. The interface opens in your browser; press Enter in the program window to quit.

The Mac app uses an ad-hoc signature and has not been notarised. Windows builds are unsigned. Your system may show a confirmation on first launch. Windows packages have passed cross-compilation and integrity checks; testing on Windows hardware is pending.

## Features

- **Images:** crop, rotate, convert, compress to a size cap, and export batches.
- **PDFs:** select and reorder pages, merge, compress, and export PDFs or images.
- **Video:** trim clips and adjust resolution, audio, and target size.

Image and PDF tools work offline. Video tools download an encoder of about 32 MB on first use, then reuse the local cache. The app interface is in Chinese.

<table>
  <tr>
    <td width="50%"><a href="docs/images/image.jpg"><img src="docs/images/image.jpg" alt="Image tools"></a></td>
    <td width="50%"><a href="docs/images/pdf.jpg"><img src="docs/images/pdf.jpg" alt="PDF tools"></a></td>
  </tr>
</table>

## Development

With Python 3.10+, run from the repository root:

```sh
python3 serve.py --open
```

See the [development guide](docs/DEVELOPMENT.md) for the project structure, Go runtime, and Mac build instructions.

## Licence and feedback

Original code is licensed under [MIT](LICENSE). See the [third-party notices](Licenses/THIRD-PARTY-NOTICES.md) for bundled components and FFmpeg licensing.

[Report an issue](https://github.com/bocchitherock888-ux/jiudi/issues/new) with your OS version and steps to reproduce it.
