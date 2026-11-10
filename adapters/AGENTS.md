# Adapter 规范

这些规则适用于 `adapters/` 改动，并叠加根目录规则。

- 复用共享 adapter 工具，把平台专用行为保留在对应平台包内。
- 新的文本聊天平台基于 `common/chat-runtime.ts` 并提供 `ChatPort`；不要按平台重新实现配对、命令路由或 server 流式转换。
- 在全新 checkout 中将 adapter 依赖安装到 `adapters/`；没有经过验证的需要时，不要为仅限 adapter 的任务改动根依赖。
- 为受影响的 adapter 添加定向测试，然后执行 `bun run check:impact`；adapter 改动通常会选中 `bun run check:adapters`。
- 必需测试不得调用真实消息平台或使用保存的账号 / token。使用 fixture、mock transport 和临时 session/config 路径。
- 测试期间不得读取或修改用户真实的 adapter 绑定或 session 文件。
