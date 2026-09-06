<div align="right"><a href="README.en.md">English</a></div>

<img src="apple-touch-icon.png" width="72" height="72" alt="就地图标">

# 就地 Jiudi

[![最新版本](https://img.shields.io/github/v/release/bocchitherock888-ux/jiudi?label=release&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases/latest)
[![MIT License](https://img.shields.io/github/license/bocchitherock888-ux/jiudi?color=3b7457)](LICENSE)
[![下载量](https://img.shields.io/github/downloads/bocchitherock888-ux/jiudi/total?label=downloads&color=3b7457)](https://github.com/bocchitherock888-ux/jiudi/releases)
![macOS 13+](https://img.shields.io/badge/macOS-13%2B-555555?logo=apple)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-555555?logo=windows11)

**把照片压小、把 PDF 整理好、把视频剪短。**

就地是一款适用于 Mac 和 Windows 的文件处理工具，可以裁切和压缩图片、拆分与合并 PDF、截取和压缩视频。把文件拖进对应页面，调整后下载结果。

报名照片需要压到 200 KB 以内、一份几十页的 PDF 只想交其中几页、一段视频只需要中间的几十秒，都可以用就地完成。

文件在你的电脑上处理，结果保存为新文件，电脑上的原文件继续保留。

[下载安装](#下载与打开) · [使用方法](#使用方法) · [反馈问题](https://github.com/bocchitherock888-ux/jiudi/issues/new)

![就地首页：图片、PDF 和视频三个入口](docs/images/home.jpg)

## 下载与打开

按自己的电脑选择一个安装包：

| 电脑 | 安装包 |
|---|---|
| macOS 13 及以上，Apple 芯片或 Intel | [Mac Universal](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.2/Jiudi-1.1.2-Mac-Universal.zip) |
| Windows 10/11，大多数 Intel / AMD 电脑 | [Windows x64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.2/Jiudi-1.1.2-Windows-x64.zip) |
| Windows 10/11，ARM64 设备 | [Windows ARM64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.2/Jiudi-1.1.2-Windows-ARM64.zip) |

**Mac：** 解压后打开「就地.app」，也可以先把它拖到「应用程序」文件夹。处理页面会出现在应用窗口中。

**Windows：** 将 ZIP 完整解压，再运行文件夹里的 `Jiudi.exe`。程序会启动本机服务，并自动在浏览器中打开处理页面。使用时保留启动窗口；结束后回到这个窗口按 Enter 退出。

首次打开可能出现系统的开发者验证提示：Mac 版本尚未经 Apple 公证，Windows 版本未签名。Windows 实机运行验证仍待补充。

[所有版本与更新记录](https://github.com/bocchitherock888-ux/jiudi/releases)

## 使用方法

### 图片：裁切与压缩

在首页点击「图片」，拖入 JPG、PNG、WebP 等图片，也可以点击「选择文件」。选定裁切范围、输出尺寸和格式后，右侧会显示处理结果的大小。

例如，报名网站要求照片不超过 200 KB：把「体积上限」设为 `200`，查看「实际导出」的大小和画面效果，再点击下载按钮保存。压缩后画面过小或细节不足时，可以调整尺寸和格式重新尝试。

还可以旋转、翻转图片，使用常用证件照尺寸，或一次导入多张图片，处理后打包下载。

### PDF：提取页面与合并文件

在首页点击「PDF」，拖入文件后，每一页都会显示为缩略图。可以选中多余的页删除，也可以拖动页面调整顺序。

例如，只需要一份 PDF 的第 1 至第 3 页：在右侧「按页导出」中将范围设为从 `1` 到 `3`，再点击「导出 PDF」。导入多个 PDF 后，还可以用「合并全部并下载」把它们合为一个文件。图片也可以导入后收成 PDF 页面。

PDF 页面可以另存为图片，PDF 文件也可以压缩。开启「转为图片进一步压缩」会让文字搜索、链接和表单失效，适合主要用于阅读或打印的文件。

<table>
  <tr>
    <td width="50%"><a href="docs/images/image.jpg"><img src="docs/images/image.jpg" alt="图片页面：裁切范围、体积上限与实际导出大小"></a></td>
    <td width="50%"><a href="docs/images/pdf.jpg"><img src="docs/images/pdf.jpg" alt="PDF 页面：页面缩略图与按页导出"></a></td>
  </tr>
</table>

### 视频：截取、压缩与静音

在首页点击「视频」，拖入 MP4、MOV、WebM 等视频。设置需要保留的起点和终点，按需要调整画面尺寸、声音和目标体积，再点击「处理并下载」。

例如，只想保留第 10 秒到第 40 秒，就把起点设为 `10`、终点设为 `40`。处理完成后，保存下载的片段即可。

## 离线使用

图片和 PDF 的处理资源已经随安装包提供，可以离线使用。视频首次使用会联网下载约 32 MB 的处理组件，之后会使用电脑上的缓存。

## 开发

使用 Python 3.10+ 在仓库根目录启动预览：

```sh
python3 serve.py --open
```

项目结构、运行方式和 Mac 构建说明见 [开发说明](docs/DEVELOPMENT.md)。

## 许可与反馈

作者：**醉步羊**（Tipram）。

原创代码采用 [MIT](LICENSE)。第三方组件及 FFmpeg 的许可见 [许可清单](Licenses/THIRD-PARTY-NOTICES.md)。

[反馈问题](https://github.com/bocchitherock888-ux/jiudi/issues/new)时，请附上系统版本、文件类型、操作步骤和实际出现的情况。
