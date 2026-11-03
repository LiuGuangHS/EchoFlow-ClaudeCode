# Adapter 说明

这些规则适用于 `adapters/` 下的改动，并叠加根目录规则。

- 复用共享 adapter 工具，并将平台特有行为保留在对应的平台包中。
- 新的文本聊天平台基于 `common/chat-runtime.ts` 构建并提供 `ChatPort`；不要在各平台重复实现配对、命令路由或 server 流转换。
- 在全新检出中，把 adapter 依赖安装在 `adapters/`；没有经过验证的必要性，不要为仅涉及 adapter 的任务修改根依赖。
- 为受影响的 adapter 添加定向测试，然后执行 `bun run check:impact`；adapter 改动通常会选择 `bun run check:adapters`。
- 必需测试不得调用真实消息平台，也不得使用已保存的账号或 token。使用 fixture、mock transport 和临时 session/config 路径。
- 测试期间不得读取或修改用户真实的 adapter 绑定或 session 文件。
