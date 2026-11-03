# 移动端说明

这些规则适用于 `mobile/` 下的改动，并叠加根目录规则。

`mobile/` 是自包含的 Kotlin Android 应用。它连接 EchoFlow server，验证 H5 token，并在 Android WebView 中渲染现有 H5 UI。业务功能保留在 H5 应用中；native 代码只用于设备集成和移动端特有的展示。优先使用 Android 平台 API。

- 运行 `cd mobile && bun run check`；从仓库根目录运行同一门禁使用 `bun run check:mobile`。该检查验证移动端元数据和 Android 集成契约。在具备 JDK 25 和 Android SDK 时，使用 `cd mobile && bun run android` 构建。
- 使用 Android Keystore AES-GCM 加密凭据。绝不记录 secrets。
- 明文 HTTP 支持可信 LAN 使用。保持 `app.json` 与 Android manifest 中的明文支持一致；不要把 HTTP 描述成在不可信网络上安全。
- `mobile/package.json` 和 `mobile/app.json` 都记录版本，移动端发布工作流会检查二者一致。升级版本时必须同时修改。
- JDK 25 LTS、Android Gradle Plugin 9.4.0 和 Gradle 9.8.0 是固定的 Android 构建工具链。升级时保持这些版本兼容。
- WebView 仍是聊天、工具和 session 的兼容层。逐步增加移动端特有流程，并保留 H5 导航和文件输入能力。
