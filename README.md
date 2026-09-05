# 就地

一个在本机处理图片、PDF 和视频的桌面工具。原文件保留，结果另存。

## 下载

在 [最新版下载页面](https://github.com/bocchitherock888-ux/jiudi/releases/latest) 下载：

| 系统 | 文件 |
|---|---|
| 普通 Windows（Intel / AMD） | `Jiudi-1.1.0-Windows-x64.zip` |
| Mac（Apple 芯片 / Intel） | `Jiudi-1.1.0-Mac-Universal.zip` |
| Windows ARM | `Jiudi-1.1.0-Windows-ARM64.zip` |

解压后按包内说明启动，无需安装 Python。Mac 支持 macOS 13+，Windows 支持 Windows 10/11。

## 功能

- 图片：裁切、旋转、格式转换、按体积上限压缩与批量打包。
- PDF：选页、重排、合并、压缩、导出 PDF 或图片。默认压缩保留文字与矢量内容。
- 视频：裁切片段、调整分辨率、声音及体积。首次使用会下载约 32 MB 的固定版本编码器，完整性校验通过后缓存。

图片和 PDF 运行资源内置，可离线使用。文件处理在本机完成。

## 当前验证范围

Mac 已验证独立启动、页面切换、退出清理与程序生成素材的 JPEG/PDF/ZIP/MP4 测试。Windows 已完成交叉编译、架构和分发包完整性检查，尚未在真实 Windows 电脑上运行验收。

Mac 使用本地签名，尚未经 Apple 公证；Windows 未作发布者签名。首次打开可能出现系统开发者确认提示。

发布包包含使用说明、第三方许可证；发布附件的 `SHA256SUMS.txt` 可用于核验下载完整性。

## 许可证

就地原创代码与文档采用 [MIT License](LICENSE)，版权归属 bocchitherock888-ux。许可范围见 [NOTICE.md](NOTICE.md)。第三方组件遵循各自许可，完整清单与文本见 [Licenses/THIRD-PARTY-NOTICES.md](Licenses/THIRD-PARTY-NOTICES.md)。

视频功能按需下载的 FFmpeg 核心含 GPL 组件，具体版本、来源及重新分发说明见第三方清单。本仓库提供分发包、使用说明及许可文件。
