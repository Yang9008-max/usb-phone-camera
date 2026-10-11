# USB 手机摄像头本地网页

把安卓手机通过 USB 接到当前 Windows 电脑，在这台电脑的 `http://127.0.0.1:9890/` 查看手机摄像头画面。手机连接哪台电脑，就在那台电脑运行，不需要另一台电脑转发或公网隧道。

## 下载使用

从本仓库 Releases 下载 `usb-phone-camera-windows-x64.zip`，完整解压。包内已附带 Node.js 和手机端 Android IP Camera APK，无须另找手机安装包或安装开发环境。

1. 将手机通过 USB 数据线接到要使用的 Windows x64 电脑。
2. 首次使用时，打开解压后的 **手机端** 文件夹，将其中的 `androidipcamera-0.14.0-universal-release.apk` 复制到手机 Download 文件夹，在手机文件管理器中点 APK 安装并允许相机权限。复制文件时可将 USB 用途切为文件传输；已安装的手机不需要重新安装。
3. 文件复制完成后，在手机设置中开启 **USB 网络共享**，打开 Android IP Camera。手机也可从本仓库 Release 单独下载 APK 安装。
4. 手机 App 设置：**TLS Version → TLS Disabled (HTTP only)**；关闭 **Enable Authentication**；端口使用默认 **4444**。若保留认证，在电脑网页的“手机连接设置”中填写账号密码。
5. 双击 **启动USB摄像头.cmd**。程序识别本机 USB 网卡的手机网关，打开 `http://127.0.0.1:9890/`。

手机 App 保持在首页，USB 网络共享保持开启。关闭网页后接收程序仍在后台；双击 **关闭USB摄像头.cmd** 可停止接收。

换电脑、换手机或重新插拔后，重新双击启动即可识别当前手机地址。若此前运行其他本地接收工具，请先关闭它，避免占用 9890 端口。程序会提示端口冲突，不会关闭其他程序。

## 功能

- 本机接收手机 MJPEG 视频，保留原始 JPEG，不经过公网中转。
- 预览、纯画面窗口、保存图片、复制图片到剪贴板。
- 断线自动重连；断线后清除旧画面，禁止把旧图当成实时快照导出。
- 仅监听本机 `127.0.0.1`，不需要开启局域网入站共享。
- 不需要 ADB 或 USB 调试。

可以将图片粘贴或上传到豆包、ChatGPT 等应用，也可以在支持窗口共享的应用中共享纯画面窗口。本工具提供网页画面，不安装系统虚拟摄像头。

## 源码运行与打包

电脑安装 Node.js 后，运行 `app/启动USB摄像头.cmd` 前需要将 Node 可执行文件放到 `app/node.exe`。也可以自行启动服务，手机地址使用 USB 网卡的网关：

```powershell
node app/server.js --phone http://手机USB网关:4444
```

重新生成免安装包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1 -NodeExe "C:\Program Files\nodejs\node.exe"
```

当前发布包采用 Node.js **24.18.0**，构建脚本要求该版本，以匹配随包附带的完整第三方许可证。构建产物位于 `artifacts/usb-phone-camera-windows-x64.zip`。

## 验证与限制

```powershell
node tests/receiver.test.js
```

测试使用明确标注的模拟 JPEG 和模拟手机 MJPEG 服务，验证直接接收、原尺寸截图、纯画面及独立运行。启动/关闭 PowerShell 脚本已通过语法检查；目标电脑的 USB 网卡识别和真实手机画面仍需在实际设备验证。

需要手机摄像头 App 和 USB 网络共享，并非只靠浏览器就能读取外接手机摄像头。实际延迟由手机采集、USB 传输和显示决定；本机读取已接收图片的耗时不等于完整拍摄延迟。

Node.js 许可证在 `third-party/NODE-LICENSE.txt`，免安装包也附带同一许可证。

手机 App 来自 [DigitallyRefined/android-ip-camera v0.14.0](https://github.com/DigitallyRefined/android-ip-camera/releases/tag/v0.14.0)，随包提供未经修改的官方通用 APK，其 MIT 许可证与安装说明位于 `mobile/` 和安装包的 **手机端** 文件夹。APK SHA-256：`79e5ef172011b9c3e4c4f0ee1b951601cbe6d2cbff02677b67e718812d39db00`。
