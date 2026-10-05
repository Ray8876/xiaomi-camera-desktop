# 参与开发

欢迎提交 Issue 和 Pull Request。请说明客户端版本、操作系统、摄像头型号、发生时间和是否与摄像头在同一可互通局域网。只上传客户端导出的脱敏诊断日志，不上传密码、账号、session.enc、camera-names.enc 或旧 go2rtc 配置。

开发环境和启动步骤见 README。提交前运行 `pnpm run check`、`pnpm test`；引擎修改应执行相关 Go 回归，播放修改需执行 `pnpm exec playwright test`。真实摄像头验收单列说明，不以模拟测试代替。

新增依赖须记录来源、固定版本、许可证和版权声明；不要加入 nonfree 组件。用 `node scripts/collect-licenses.cjs` 刷新 Node 运行依赖声明；Go 依赖通过同脚本收集（需要 Go 命令在 PATH 中）。

提交贡献表示你有权提交该代码，并按对应目录现有许可证许可贡献。go2rtc 和第三方组件保持其各自许可证。

普通提交不自动打包；发布 tag 和手动工作流会消耗 Actions 资源，请由维护者安排。
