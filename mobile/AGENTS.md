# 移动端规则

本目录是 Expo / React Native App 与 H5 的共享实现，叠加根目录规则。

- 触及 Expo、EAS 或 React Native API 前，按 `package.json` 锁定版本查阅对应官方文档；Expo 版本入口为 `https://docs.expo.dev/versions/v<major>.0.0/`，索引为 <https://docs.expo.dev/llms.txt>。
- 使用 Bun / `bunx`；新增 Expo 依赖通过 `bunx expo install <package>` 解析兼容版本，不直接 `bun add`。
- 使用 Expo Router，路由只放 `src/app/`；组件、hooks 和其他非路由代码放在该目录之外。
- 生成的 `ios/`、`android/` 不手工创建或编辑；原生配置通过 app config 和 config plugins 维护。

## 验证与发布

从仓库根目录运行 `bun run check:mobile`。它通过 `scripts/pr/run-mobile-checks.ts` 执行 typecheck、lint、测试和离线 H5 导出；迭代时可用定向测试。

缺少依赖或平台工具应报告为 blocked；native build 和设备证据不能用 H5 / mock 结果替代。新增 native module 需要 development build，不能只在 Expo Go 验证。

安装依赖、EAS build/submit/update、签名和发布需要明确授权。独立移动版本、构建与发布流程见 [RELEASING.md](RELEASING.md)，推送交付见 [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md)。
