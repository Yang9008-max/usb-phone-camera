安装包已包含电脑端和手机端 APK。手机通过 USB 接到哪台 Windows 电脑，就在那台电脑直接查看本地摄像头网页，不需要原电脑或公网转发。

下载 `usb-phone-camera-windows-x64.zip`，完整解压。首次使用时，将“手机端”文件夹中的 APK 复制到手机上安装；也可用手机直接下载本 Release 的独立 APK。之后开启手机 USB 网络共享并打开 Android IP Camera，双击 `启动USB摄像头.cmd`，自动识别手机地址并打开 `http://127.0.0.1:9890/`。已安装手机 App 的用户不用重装。

包含 Node.js 24.18.0 和 Android IP Camera 0.14.0 官方通用 APK（未经修改），同时附带第三方许可证和手机安装说明。支持预览、纯画面、复制/保存图片与断线重连。提供网页画面，不安装虚拟摄像头。

APK SHA-256：`79e5ef172011b9c3e4c4f0ee1b951601cbe6d2cbff02677b67e718812d39db00`。上游来源：https://github.com/DigitallyRefined/android-ip-camera/releases/tag/v0.14.0

验证：打包后已检查手机 APK、安装说明及 MIT 许可证，并核对包内 APK 的 SHA-256。已有独立服务模拟手机视频测试通过。目标电脑真实 USB 连接仍需实际设备验证。
