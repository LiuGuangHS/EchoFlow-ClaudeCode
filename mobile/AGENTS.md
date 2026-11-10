这是一个 Expo/React Native 移动应用。优先采用移动端模式、性能和跨平台兼容性。

## Expo 已发生变化——不要相信训练数据

Expo 每个 SDK 版本都可能有破坏性变更。你记得的 API 可能已重命名、移动或删除。编写触及 Expo、EAS 或 React Native API 的代码前：

1. 阅读 `package.json` 中 `expo` 包的 major 版本。
2. 获取匹配的版本文档：`https://docs.expo.dev/versions/v<major>.0.0/`
3. 其他内容获取 https://docs.expo.dev/llms.txt——这是包含常见 LLM 误解修正的 Expo 文档索引。沿链接阅读具体页面；绝不要凭记忆回答。

## 命令

如果项目使用 Bun（存在 `bun.lock`），使用 `bunx` 而不是 `npx`。

```bash
npx expo install <package>  # 必须使用，而非 npm/yarn/pnpm/bun add；它会解析 SDK 兼容版本
npx expo start              # 启动开发 server
npx expo lint               # lint
npx tsc --noEmit            # 类型检查
npx expo-doctor             # 诊断依赖和配置问题
npx expo install --fix      # 修复不兼容的包版本
```

从仓库根目录为移动端改动运行 `bun run check:mobile`。它通过 `scripts/pr/run-mobile-checks.ts` 运行 typecheck、lint、测试和离线 H5 导出；迭代期间可使用定向测试。缺少依赖或平台工具必须报告为 blocked，不得当作通过。native build 和设备证据独立于 H5 与 mock 测试。安装依赖、EAS build/submit/update、签名和发布需要明确授权。

## 导航与路由

- 所有导航使用 **Expo Router**。路由位于 `src/app/`，其中每个文件都是 screen，`_layout.tsx` 文件定义 navigator。非路由代码（组件、hooks、utils）放在 `src/app/` 之外。
- 从 `expo-router` 导入 `Link`、`router` 和 `useLocalSearchParams`。
- 文档：https://docs.expo.dev/router/introduction.md

## 使用 EAS 构建

使用 EAS 在云端构建、签名和提交 App（`eas build`、`eas submit`），并通过 OTA 更新发布（`eas update`），无需本地 Xcode 或 Android Studio。Bun 项目用 `bunx eas-cli <command>`，否则用 `npx eas-cli@latest <command>`；文档示例中的裸 `eas` 都替换为对应命令。
文档：https://docs.expo.dev/eas/index.md

## 规则

- 如果不存在 `ios/` 和 `android/` 目录，它们是生成目录（Continuous Native Generation）。绝不要手工创建或编辑；在 `app.json` 和 config plugin 中配置 native 行为。
- Expo Go 只包含其自带的 native module。添加含 native code 的库后，App 需要 development build：本地运行 `npx expo run:ios|android`，或运行 `eas build --profile development`。
- 优先选择 Expo 推荐模块而非第三方库；添加依赖前检查可用 skills。文档：https://docs.expo.dev/versions/latest/index.md
