# 第三方许可正文

客户端自身使用根目录 MIT LICENSE；go2rtc 与 VideoRTC 使用 engine/LICENSE。

`dependencies/manifest.json` 记录安装时的 Node 运行依赖和 go.mod 声明的直接及间接模块（含测试及工具模块）的固定版本、来源及许可正文路径。`scripts/collect-licenses.cjs` 从安装目录和 Go module cache 收集；不会把模块缓存路径或用户环境写入清单。

`eastasianwidth@0.2.0` 的 npm 包声明 MIT 却没有附带许可正文，因此补充上游在固定提交 `1d41951a59d63fb2d77cda021050fc070cae424a` 添加的 MIT 正文；这份正文来自较晚的上游提交，而非该旧 npm 包。

Electron 的 MIT LICENSE 和 Chromium 的 LICENSES.chromium.html 由 electron-builder 保留。FFmpeg 为单独调用的 GPLv3 程序，Mac 的 x264/Opus 正文由构建脚本从固定源码复制。Windows 上游原始构建配置及依赖版本列表见 `FFmpeg-Windows-README.txt`。

仓库的 MIT 许可证不覆盖或替换第三方许可证。下次打包会额外将该目录、第三方声明及 FFmpeg 源码说明复制到安装目录的 resources/licenses 中；本次未重新构建安装包。
