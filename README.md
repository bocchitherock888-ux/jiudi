<div align="right"><a href="README.en.md">English</a></div>

<img src="apple-touch-icon.png" width="72" height="72" alt="就地图标">

# 就地 Jiudi

图片裁切压缩、PDF 整理和视频剪辑。在本机处理，结果另存。

![就地主页](docs/images/home.jpg)

## 下载

| 系统 | 安装包 |
|---|---|
| macOS 13+，Apple 芯片 / Intel | [Mac Universal](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.1/Jiudi-1.1.1-Mac-Universal.zip) |
| Windows 10/11，Intel / AMD | [Windows x64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.1/Jiudi-1.1.1-Windows-x64.zip) |
| Windows 10/11，ARM64 | [Windows ARM64](https://github.com/bocchitherock888-ux/jiudi/releases/download/v1.1.1/Jiudi-1.1.1-Windows-ARM64.zip) |

[更新记录与校验文件](https://github.com/bocchitherock888-ux/jiudi/releases/latest)

**Mac：** 解压后打开「就地.app」。**Windows：** 完整解压后运行 `Jiudi.exe`，界面会在浏览器中打开；回到程序窗口按 Enter 退出。

Mac 使用本地签名，尚未经 Apple 公证；Windows 版本未签名，首次打开可能显示系统确认。Windows 包已完成交叉编译与完整性检查，实机验证待补充。

## 功能

- **图片**：裁切、旋转、转换格式、按体积上限压缩、批量打包。
- **PDF**：选页、重排、合并、压缩，导出 PDF 或图片。
- **视频**：截取片段，调整分辨率、声音与目标体积。

图片和 PDF 可离线使用。视频首次使用会下载约 32 MB 的编码器，之后使用本机缓存。

<table>
  <tr>
    <td width="50%"><a href="docs/images/image.jpg"><img src="docs/images/image.jpg" alt="图片处理"></a></td>
    <td width="50%"><a href="docs/images/pdf.jpg"><img src="docs/images/pdf.jpg" alt="PDF 处理"></a></td>
  </tr>
</table>

## 开发

使用 Python 3.10+ 在仓库根目录启动预览：

```sh
python3 serve.py --open
```

项目结构、Go 运行时和 Mac 构建方式见 [开发说明](docs/DEVELOPMENT.md)。

## 许可与反馈

原创代码采用 [MIT](LICENSE)。第三方组件及 FFmpeg 的许可见 [许可清单](Licenses/THIRD-PARTY-NOTICES.md)。

[反馈问题](https://github.com/bocchitherock888-ux/jiudi/issues/new)时，请附上系统版本与复现步骤。
