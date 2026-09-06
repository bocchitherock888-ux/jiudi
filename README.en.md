<div align="right"><a href="README.md">中文</a></div>

<img src="apple-touch-icon.png" width="72" height="72" alt="Jiudi icon">

# Jiudi · 就地

[![Latest release](https://img.shields.io/github/v/release/bocchitherock888-ux/jiudi?label=release&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases/latest)
[![MIT License](https://img.shields.io/github/license/bocchitherock888-ux/jiudi?color=3b7457)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/bocchitherock888-ux/jiudi/total?label=downloads&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases)
![macOS 13+](https://img.shields.io/badge/macOS-13%2B-555555?logo=apple)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-555555?logo=windows11)

**Smaller photos, organised PDFs, shorter videos.**

Jiudi is a file tool for Mac and Windows. A registration website might require a photo smaller than 200 KB while yours is several MB. You might need three pages from a long PDF, or thirty seconds from a longer video. Drag the file into Jiudi, adjust it, and save the result.

Images, PDFs, and videos each have their own workspace. Files are processed on your computer, and results are saved as new files. Your original files stay in place. The app interface is in Chinese; the instructions below include the labels to look for.

![Jiudi home, with image, PDF, and video tools](docs/images/home.jpg)

## Download and open

Choose the package for your computer:

| Computer | Download |
|---|---|
| macOS 13 or later, Apple silicon or Intel | [Mac Universal](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.2/Jiudi-1.1.2-Mac-Universal.zip) |
| Windows 10/11, most Intel / AMD PCs | [Windows x64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.2/Jiudi-1.1.2-Windows-x64.zip) |
| Windows 10/11, ARM64 devices | [Windows ARM64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.2/Jiudi-1.1.2-Windows-ARM64.zip) |

**Mac:** Unzip the package and open “就地.app”. You can move it to Applications first. The tools open in the app window.

**Windows:** Extract the whole ZIP, then run `Jiudi.exe` from the extracted folder. It starts a local service and opens the tools in your browser. Keep the launch window open while working; return to it and press Enter when you are finished.

Your system may show a developer verification message on first launch. The Mac app has not been notarised, and the Windows builds are unsigned. Testing on Windows hardware is still pending.

[Other versions and release notes](https://github.com/bocchitherock888-ux/jiudi/releases/latest)

## Images: crop a photo and reduce its size

Choose **图片** on the home page. Drag in a JPG, PNG, WebP, or another supported image, or click **选择文件** to select one. Set the crop, output dimensions, and format. The right panel shows the resulting file size.

For a website that requires a photo under 200 KB, set **体积上限** to `200`. Check the size under **实际导出**, inspect the picture, and click the download button. You can try different dimensions and formats if the picture becomes too small or loses detail.

You can also rotate or flip images, use common ID-photo dimensions, and import several images for batch processing and download.

## PDFs: keep the pages you need

Choose **PDF** and add a document. Each page appears as a thumbnail. Select unwanted pages to delete them, or drag pages to change their order.

To keep pages 1–3, set the range under **按页导出** from `1` to `3`, then click **导出 PDF**. After importing several PDFs, **合并全部并下载** combines them into one file. You can also import images to turn them into PDF pages.

Pages can be saved as images, and PDF files can be compressed. The **转为图片进一步压缩** option converts pages to images and removes searchable text, links, and forms. It suits documents intended mainly for reading or printing.

<table>
  <tr>
    <td width="50%"><a href="docs/images/image.jpg"><img src="docs/images/image.jpg" alt="Image crop, size limit, and output size"></a></td>
    <td width="50%"><a href="docs/images/pdf.jpg"><img src="docs/images/pdf.jpg" alt="PDF thumbnails and page-range export"></a></td>
  </tr>
</table>

## Videos: keep a clip, shrink the file, or remove sound

Choose **视频** and add an MP4, MOV, WebM, or another supported video. Set the start and end times, adjust the picture dimensions, audio, and target size as needed, then click **处理并下载**.

To keep the segment from 10 to 40 seconds, enter `10` for the start and `40` for the end. Save the downloaded clip when processing finishes.

Image and PDF tools come with the package and work offline. Video tools download a processing component of about 32 MB on first use, then reuse the copy cached on your computer.

## Development

With Python 3.10+, run from the repository root:

```sh
python3 serve.py --open
```

See the [development guide](docs/DEVELOPMENT.md) for the project structure, runtime, and Mac build instructions.

## Licence and feedback

Created by **Tipram** (醉步羊).

Original code is licensed under [MIT](LICENSE). See the [third-party notices](Licenses/THIRD-PARTY-NOTICES.md) for bundled components and FFmpeg licensing.

[Report an issue](https://github.com/bocchitherock888-ux/jiudi/issues/new) with your OS version, file type, steps, and what happened.
