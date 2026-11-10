# CLI 与 Runtime 规范

这些规则适用于 `src/` 改动，并叠加根目录规则。

- 将 CLI/runtime 行为保留在既有的 `entrypoints`、`commands`、`services`、`tools`、`utils` 和 `server` 边界内。优先使用最近的既有接缝，不要新增横切 helper。
- 在受影响区域旁添加定向 `*.test.ts` 回归测试。先运行它，再执行 `bun run check:impact`；普通 `src/` 改动通常会选中 `bun run check:server`。
- Agent loop、tool、permission 或 provider wiring 改动由 `bun run check:agent-e2e` 端到端验证（真实 CLI 对脚本化 mock LLM，无凭据）；行为跨回合对用户可见时，在 `scripts/quality-gate/mock-llm/` 添加场景。
- Provider preset、认证、托管环境变量、模型元数据、proxy transform 或 streaming 改动，在选中时还需要离线 `bun run check:provider-contract`。
- 保持测试自包含：使用假凭据、拦截请求或 loopback server、临时 `HOME`/`CLAUDE_CONFIG_DIR`，并恢复环境 / 全局状态。
- 绝不修改真实用户配置或 transcript。持久化格式变化需要前向迁移、未知字段保留、旧 fixture 和 `bun run check:persistence-upgrade`。
- Agent-loop、工具执行、provider 路由、权限、恢复和文件编辑行为，在任何单独授权的 live smoke 之前，都需要确定性的 mock/fixture 覆盖。
