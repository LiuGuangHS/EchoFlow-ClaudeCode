# 贡献指南

提交 PR 前请先确认改动影响面，再运行对应的确定性检查。外部贡献者不需要提供真实模型账号或额度。

跨目录的长期不变量见[执行、数据与信任边界](docs/internals/execution-boundaries.md)：EchoFlow 产品能力与执行引擎分离；一次操作只有一个执行 owner；持久化、平台回调、文件外发和 Electron 导航都必须在各自的信任边界内验证。原生运行时迁移不因修复或接入某个 sidecar 而自动开始。

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

只改了某个模块时可以用窄命令快速迭代：

| 改动范围 | 快速验证 |
| --- | --- |
| CLI / Server / 工具 | `bun run check:server` |
| 桌面端 | `bun run check:desktop` |
| 移动端 App / H5 | `bun run check:mobile` |
| IM Adapter | `bun run check:adapters` |
| 桌面 Electron / 原生打包 | `bun run check:native` |
| Provider / runtime / proxy | `bun run check:provider-contract` |
| 桌面聊天 / WebSocket / 会话 | `bun run check:chat-contract` |
| 持久化格式与迁移 | `bun run check:persistence-upgrade` |
| 文档 | `bun run check:docs` |

门禁失败时，查看最新质量报告和对应 lane 日志定位问题：

```
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/logs/<lane>.log
```

## 2. 用户可见或跨进程桌面改动需要手工测试

改动涉及用户可见 UI、跨 WebSocket/进程流程、Electron host 或 native/packaging 时，除了自动门禁外，还应在真机上验证相关流程。纯样式、纯工具或已有组件单元测试能够完整证明的改动，不要求重复无关流程：

- 优先使用 `bun run check:desktop-ui-smoke` 的隔离 mock runtime 验证真实桌面 UI
- 需要手动启动服务和桌面端时，复用 `scripts/quality-gate/sandbox.ts` 的临时配置和测试环境，避免服务读写真实 `~/.claude`；临时浏览器操作使用 `ego-browser` skill
- 验证改动涉及的交互流程：页面渲染、按钮/表单行为、弹窗、快捷键、多窗口等
- 必要时打本地 macOS 包 `desktop/scripts/build-macos-arm64.sh` 做完整验证

## 3. PR 必须附上影响范围和测试说明

每个 PR 的描述里必须包含：

- **影响范围**：改了哪些模块（desktop / server / adapter / native / docs / provider / agent-loop）
- **测试说明**：跑了哪些测试、覆盖率情况、手工测试了哪些流程（用户可见或跨进程桌面改动需有真机记录）
- **剩余风险**：已知未覆盖的边界或需要后续跟进的点

provider/runtime、agent-loop、文件编辑、权限、session 等核心路径必须先通过离线 mock/fixture/contract 测试。真实模型验证只由拥有可信 secrets 和额度的维护者在高风险合并或发版前运行：

```bash
bun run quality:providers
bun run quality:smoke --provider-model <provider:model>
```

来自 fork 的 PR 不会获得仓库 secrets，也不应被要求运行真实模型。贡献者只需在 PR 中明确写 `live model: not run (untrusted fork / no provider)`；这不是确定性 PR gate 的失败理由。

## 贡献的许可边界

贡献前请阅读 [LICENSE](LICENSE) 和[第三方许可声明](THIRD_PARTY_LICENSES.md)。根许可证只保留 EchoFlow 原创内容的权利，不授予第三方代码的许可。提交新贡献时，请在 PR 中明确新增内容的来源及你有权提供的授权，由维护者在合入前确认；此说明不变更既有授权，也不转移版权或授予维护者重新许可权。

引入或修改第三方代码时，保留原许可及版权通知，并说明来源。不要把已有第三方许可改成项目当前许可。

## 规范入口与外部参考

完整质量门禁、覆盖率、回归测试和跨边界安全规范见 [贡献指南](docs/internals/contributing.md) 与[执行、数据与信任边界](docs/internals/execution-boundaries.md)；`AGENTS.md` 仅保留 Agent 的高信号入口与路由。目录级规则从根 [AGENTS.md](AGENTS.md) 进入，再按改动区域阅读 `src/`、`desktop/`、`adapters/`、`mobile/`、`site/`、`docs/` 和 `.github/` 下的适用文件；Issue 路由流程见 [.agents/workflows/issue-router.md](.agents/workflows/issue-router.md)。

外部代码、上游实现和示例按根规范学习、参考、合法复用并适配，必须核对来源、许可证、适配范围和回归证据，不默认通过 merge 同步外部仓库；项目内部正常分支集成仍允许。文档、代码和测试冲突时，应结合用户明确要求、已发布行为、版本历史和验证证据查明原因，不能仅以当前代码和测试一致作为正确依据。

`native/agent-desktop/AGENTS.md` 是本仓维护的第三方模块开发指导，可在保留来源、归属、链接、标识符和许可证义务的前提下等义中文化；修改记录见其文件说明和 `native/agent-desktop/PATCHES.md`。Apache-2.0 第 2 条允许制作衍生作品，第 4 条要求随附许可证、显著标注修改并保留相关通知，并未要求开发指导永远保持英文。第三方原始许可证、NOTICE 和来源记录保留原文，不因指导文档翻译而改写。

现行规范还包括[移动端发布](mobile/RELEASING.md)、[桌面组件规范](desktop/src/components/AGENTS.md)、[桌面设计规范](DESIGN.md)，以及 [Harness 开发与升级](harness/README.md)和[运行时层契约与扩展](src/server/runtime/README.md)中的适用约定；设计快照和历史审计不是默认现行规则。`docs/en/` 的英文产品镜像、历史发布资料和第三方许可证不属于规范中文化范围。
