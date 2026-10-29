# 贡献指南

感谢你帮助改进 EchoFlow Code。提交 PR 前请先确认改动影响面，再运行对应的确定性检查。外部贡献者不需要提供真实模型账号或额度。

## 1. 按影响面运行本地检查

```bash
bun run check:impact
```

`check:impact` 会列出这次改动选中的检查。普通任务运行这些检查；准备声明 PR-ready 或需要完整验证时，直接运行统一入口，不必先单独重复执行其全部检查：

```bash
bun run verify
```

`bun run verify` 会按改动路径执行被选中的 policy、产品、契约、持久化和 coverage lane，但不会调用真实模型。小范围贡献无需在本机重复所有无关模块；GitHub PR gate 会再次执行并严格核对 selected / skipped 状态。

修复期间重跑受影响的窄检查，交付时补齐最终 diff 的验证证据；没有后续改动或未解决风险时，已通过的检查无需重跑。

`git push` 不再自动运行本地质量门禁。需要质量检查时请手动运行 `bun run quality:push` 或 `bun run verify`；完整覆盖率仍以 `bun run verify` 为准。

需要窄范围迭代时，直接跑 `bun run check:impact`，按输出的 `## Required local checks` 执行。最常用的入口是 `bun run check:server`、`bun run check:desktop`、`bun run check:adapters` 和 `bun run check:docs`；完整清单以 `package.json` 和 impact 输出为准，不在文档里维护第二份。

门禁失败时，查看最新质量报告和对应 lane 日志定位问题：

```
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/logs/<lane>.log
```

## 2. 用户可见或跨进程桌面改动需要手工测试

改动涉及用户可见 UI、跨 WebSocket/进程流程、Electron host 或 native/packaging 时，除了自动门禁外，还应在真机上验证相关流程。纯样式、纯工具或已有组件单元测试能够完整证明的改动，不要求重复无关流程：

- 优先使用 `bun run check:desktop-ui-smoke` 的隔离 mock runtime 验证真实桌面 UI
- 需要手动启动服务和桌面端时，复用 `scripts/quality-gate/sandbox.ts` 的临时配置和测试环境，避免服务读写真实 `~/.claude`；临时浏览器操作使用已安装的 `playwright` 插件或 `browser` 工具
- 验证改动涉及的交互流程：页面渲染、按钮/表单行为、弹窗、快捷键、多窗口等
- 必要时打本地 macOS 包 `desktop/scripts/build-macos-arm64.sh` 做完整验证

## 3. PR 必须附上影响范围和测试说明

每个 PR 的描述按 [`.github/pull_request_template.md`](.github/pull_request_template.md) 填写：变更面、测试、覆盖率证据、E2E/live 证据、剩余风险与回滚。模板是提交时的强制清单，这里不再重复。

provider/runtime、agent-loop、文件编辑、权限、session 等核心路径必须先通过离线 mock/fixture/contract 测试。真实模型验证只由拥有可信 secrets 和额度的维护者在高风险合并或发版前运行：

```bash
bun run quality:providers
bun run quality:smoke --provider-model <provider:model>
```

来自 fork 的 PR 不会获得仓库 secrets，也不应被要求运行真实模型。贡献者只需在 PR 中明确写 `live model: not run (untrusted fork / no provider)`；这不是确定性 PR gate 的失败理由。

## 更多

完整质量门禁和覆盖率说明见 [贡献指南](docs/internals/contributing.md)；`AGENTS.md` 仅保留 Agent 的高信号入口与路由。
