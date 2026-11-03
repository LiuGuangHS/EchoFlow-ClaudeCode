# CLI 与运行时说明

这些规则适用于 `src/` 下的改动，并叠加根目录规则。

- CLI/runtime 行为应保留在既有的 `entrypoints`、`commands`、`services`、`tools`、`utils` 和 `server` 边界内。优先使用最近的既有接缝，不要新增跨领域 helper。
- 在受影响区域旁添加定向 `*.test.ts` 回归测试。先运行它，再执行 `bun run check:impact`；普通 `src/` 改动通常会选择 `bun run check:server`。
- Provider preset、认证、托管环境变量、模型元数据、proxy 转换或 streaming 改动在被选中时还需要离线 `bun run check:provider-contract`。
- 保持测试隔离：使用 fake 凭据、拦截请求或 loopback server、临时 `HOME`/`CLAUDE_CONFIG_DIR`，并恢复环境变量和全局状态。
- 绝不修改用户真实配置或 transcript。持久化格式变化需要前向迁移、未知字段保留、旧 fixture 和 `bun run check:persistence-upgrade`。
- Agent loop、工具执行、provider 路由、权限、resume 和文件编辑行为，在单独授权的 live smoke 前必须有确定性的 mock/fixture 覆盖。
