# Mac 首次运行

0.1.0 的 Mac 应用资源签名不完整，请改用 0.1.1。0.1.1 对应用、辅助进程、框架和两个播放引擎进行 ad-hoc 签名，并在构建中验证解压后签名完整性。

ad-hoc 签名不等于 Apple Developer ID 签名或公证。浏览器下载后，macOS 仍可能阻止首次运行。

1. 下载对应芯片的新版 DMG，将 `Mi Camera Desktop.app` 拖入“应用程序”，替换旧版。
2. 在“系统设置 → 隐私与安全性”中选择“仍要打开”（如出现该选项）。
3. 如果仍提示“已损坏”，确认安装的是本项目发布的新版，在终端执行：

```sh
codesign --verify --deep --strict "/Applications/Mi Camera Desktop.app" && xattr -dr com.apple.quarantine "/Applications/Mi Camera Desktop.app"
```

该命令先验证签名完整性，成功后只清除本应用的下载隔离标记；不关闭系统 Gatekeeper。然后重新打开应用。

如果签名校验失败，请保留错误信息并反馈，不能用清除隔离代替修复损坏的签名。替换应用不会删除已有登录缓存和设置。
