<div align="right"><a href="README.en.md">English</a></div>

<div align="center">
  <img src="apple-touch-icon.png" width="88" height="88" alt="就地图标">
  <h1>就地 Jiudi</h1>
  <p>图片、PDF 与视频，就地处理，结果另存。</p>

  [![最新版本](https://img.shields.io/github/v/release/bocchitherock888-ux/jiudi?label=release&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases/latest)
  [![MIT License](https://img.shields.io/github/license/bocchitherock888-ux/jiudi?color=3b7457)](LICENSE)
  [![总下载量](https://img.shields.io/github/downloads/bocchitherock888-ux/jiudi/total?label=downloads&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases)
  ![macOS 13+](https://img.shields.io/badge/macOS-13%2B-555555?logo=apple)
  ![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-555555?logo=windows11)
</div>

![就地主页](docs/images/home.jpg)

就地是一款轻量桌面工具，在本机完成日常媒体文件处理。原文件会保留，结果另存；图片与 PDF 所需资源已经内置，断网时也能使用。界面目前为中文，项目文档提供中英文版本。

## 下载

当前版本为 **v1.1.0**。桌面包可直接运行，无需安装 Python。

| 系统 | 下载 | 大小 | 适用设备 |
|---|---|---:|---|
| macOS | [Jiudi-1.1.0-Mac-Universal.zip](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/Jiudi-1.1.0-Mac-Universal.zip) | 8.6 MB | macOS 13+，Apple 芯片 / Intel |
| Windows x64 | [Jiudi-1.1.0-Windows-x64.zip](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/Jiudi-1.1.0-Windows-x64.zip) | 3.9 MB | Windows 10/11，Intel / AMD |
| Windows ARM64 | [Jiudi-1.1.0-Windows-ARM64.zip](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/Jiudi-1.1.0-Windows-ARM64.zip) | 3.6 MB | Windows 10/11，ARM64 |

完整性校验值见发布附件 [SHA256SUMS.txt](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.0/SHA256SUMS.txt)。

## 可以做什么

- **图片**：裁切、旋转、格式转换、按体积上限压缩，并将多个结果打包。
- **PDF**：选页、重排、合并、压缩，导出 PDF 或图片；默认压缩会保留文字与矢量内容。
- **视频**：截取片段、调整分辨率、声音与目标体积。

图片与可选 PDF 体积上限以最终文件的字节数判断，`1 KB = 1000 bytes`。工具会在上限内尽量保留质量，实际结果取决于内容；信息量较高的文件可能无法达到很小的目标体积。

视频功能首次使用时会下载约 32 MB 的固定上游 FFmpeg 核心，通过完整性校验后缓存。后续可直接复用该缓存。

<table>
  <tr>
    <td width="50%"><a href="docs/images/image.jpg"><img src="docs/images/image.jpg" alt="图片处理界面"></a></td>
    <td width="50%"><a href="docs/images/pdf.jpg"><img src="docs/images/pdf.jpg" alt="PDF 处理界面"></a></td>
  </tr>
  <tr><td align="center">图片处理</td><td align="center">PDF 处理</td></tr>
</table>

截图中的示例素材均由程序生成，不含个人照片或私人文件。

## 开始使用

**Mac：** 下载并解压 Universal 包，将“就地.app”移到合适位置后打开。应用采用 ad-hoc 本地签名，尚未经过 Apple 公证；首次启动时请按 macOS 提供的开发者确认流程操作。

**Windows：** 下载对应架构的压缩包，完整解压后运行其中的 `.exe`。程序会在默认浏览器打开界面；回到程序窗口按 Enter 即可退出。Windows 包尚未进行发布者签名，首次运行时系统可能显示安全确认。

Mac 版本已验证独立启动、页面切换、退出清理，以及程序生成素材的 JPEG、PDF、ZIP 和 MP4 流程。Windows 版本已完成交叉编译、架构与分发包完整性检查，尚未在真实 Windows 设备上验收。

## 源码与开发

仓库包含 HTML/CSS/JavaScript 前端、Go 独立运行时、Swift Mac 外壳，以及 Python 开发服务器与运行时准备工具。使用 Python 3.10+ 即可启动本地预览：

```bash
python3 serve.py --open
```

Go 构建与项目结构见 [开发说明](docs/DEVELOPMENT.md)。

<p>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=111" alt="JavaScript">
  <img src="https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Swift-F05138?logo=swift&logoColor=white" alt="Swift">
  <img src="https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white" alt="Python">
</p>

## 许可与反馈

就地原创代码与文档采用 [MIT License](LICENSE)，版权归 bocchitherock888-ux；许可范围见 [NOTICE.md](NOTICE.md)。第三方组件保留各自许可，版本、来源与文本见 [第三方许可清单](Licenses/THIRD-PARTY-NOTICES.md)。视频功能按需下载的 FFmpeg 核心包含 GPL 组件，并单独遵循其上游许可。

遇到问题请[新建 Issue](https://github.com/bocchitherock888-ux/jiudi/issues/new)，写明操作系统版本、CPU 架构和复现步骤即可，无需上传个人文件。
