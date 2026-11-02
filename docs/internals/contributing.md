---
title: 参与贡献与质量门禁
nav_title: 参与贡献
description: 本地安装、影响面检查、质量门禁、测试要求与 PR 提交流程。
order: 14
---

# 参与贡献与质量门禁

这份文档说明贡献代码前如何安装、开发、测试和运行质量门禁。目标是让维护者和贡献者在提交 PR 前都能回答：这次改动有没有破坏核心 Coding Agent 工作流？

## 环境准备

项目根目录使用 Bun：

```bash
bun install
```

改动涉及 `desktop/` 或 `adapters/` 时，分别安装对应依赖：

```bash
cd desktop && bun install
cd adapters && bun install
```

不要提交 `artifacts/quality-runs/`、`node_modules/`、`desktop/node_modules/` 等本地产物。

常用开发入口：

```bash
bun run start                                   # 本地运行 CLI
SERVER_PORT=3456 bun run src/server/index.ts    # desktop/ 使用的 API/WebSocket 服务
cd desktop && bun run electron:dev              # 完整 Electron 应用、sidecar 与热更新
cd desktop && bun run electron:build            # 构建 sidecar、renderer 和 Electron bundle，不生成安装包
cd desktop && bun run electron:package           # 用 electron-builder 生成本机安装包（--publish never）
cd desktop && bun run test                      # 桌面端 Vitest
cd adapters && bun run test                     # adapter 测试
bun run docs:dev                                # 文档站预览
```

桌面仓库位于 WSL 时，开发和验证命令统一在 WSL 中执行。`desktop` 的 Vite-only `bun run dev` 只用于隔离的前端调试；用户可见的桌面改动优先启动完整 Electron 应用并操作受影响流程。Windows x64 原生打包入口是 `cd desktop && bun run build:windows-x64`。

## 四层门禁分工

| 层级 | 触发 | 运行内容 | 约束 |
| --- | --- | --- | --- |
| 本地迭代 | 手动 | 最窄的相关测试和 `check:impact` 选中的命令 | 快速反馈 |
| PR（必过） | `pull_request` | impact 选中的确定性 lane，含 `check:agent-flow` | 无模型、无 provider、无 secret，外部贡献可运行 |
| 全量 | 维护者手动触发 `workflow_dispatch` | 全部确定性 lane、模块图健康度和 `check:desktop-ui-smoke` | 仍无模型、无 secret |
| Release | tag 自动触发 `release-desktop.yml` | 内容门禁、三组验证 job、六平台构建 | live 检查只在获授权的维护者流程运行 |

Release workflow 的 `release-contract` 先检查发布面、tag、`desktop/package.json` 版本和 release notes 标题；`verify-governance`、`verify-runtime`、`verify-desktop` 并行验证，`release-verify-gate` 汇总结果。构建或验证失败都不会发布。

每个启动真实 server 的质量 lane 都使用沙箱配置目录，并在结束时检查没有写入开发者真实的 `~/.claude`。维护者的 live baseline、签名、打包和真实升级验收是内部 runbook，不是普通 PR 的必需步骤。

## 普通 PR 的影响面检查

先让仓库按改动路径和 import 图列出需要运行的检查：

```bash
bun run check:impact
```

`scripts/pr/change-policy.ts` 是路径路由、area、同区域测试要求、label 和阻断规则的唯一 owner。`scripts/pr/module-graph.ts` 只扩大检查选择：报告的 `## Cross-surface impact` 会说明哪个 importer 触发了额外检查；它不会扩大 area、label 或缺测阻断范围。依赖图构建失败时会安全选择所有 surface check 并打印原因。

最常见的入口：

```bash
bun run check:server
bun run check:desktop
bun run check:adapters
bun run check:docs
```

移动端、native、provider/chat contract、持久化和 coverage 的入口以 `package.json` 的 `check:*` 脚本为准，不在本文复制第二份路由表。

## 无模型的端到端 Agent 门禁

```bash
bun run check:agent-flow
bun run check:desktop-ui-smoke
```

`check:agent-flow` 使用真实 server、真实 WebSocket 和 mock CLI，覆盖 Session 创建、运行时选择、首轮流式、工具调用、权限批准/拒绝、工具失败、API 错误、中断、重连权限重放和会话恢复。`check:desktop-ui-smoke` 在真实桌面 UI 中点击真实权限按钮；缺少 `agent-browser` 或桌面依赖时会打印原因。

这两条 lane 不需要 provider、凭据或公网。临时浏览器检查、截图和探索性 UI 验证使用当前会话实际可用的浏览器自动化，不要把仓库里的 `agent-browser` 当成通用工具。

## AI Coding Agent 修复循环

1. 先运行 `bun run check:impact`，确定当前 diff 的检查范围。
2. 先写能复现行为的测试，观察它因预期缺陷失败，再做最小修复。
3. 修复期间重跑受影响的窄检查；最后一次编辑后重新运行最终所需检查。
4. 只修复本次改动造成的失败；无关的既有失败或环境阻塞要如实报告，不要擅自扩大范围。
5. 只有最终 diff 的 `bun run verify` 通过，才能声明 PR-ready 或 full validation。

诊断 lane 失败时，先看 `artifacts/quality-runs/<timestamp>/report.md` 的 Summary / Result Matrix 和对应 `logs/<lane>.log`。coverage 失败看 `artifacts/coverage/<timestamp>/coverage-report.md` 或 `.json`，不要降低 baseline、threshold 或改写测试预期来掩盖失败。

合并时必须对冲突逐 hunk 裁决，不能整体套用 `--ours` 或 `--theirs`；发布前还要运行 `bun run check:release-surface` 审计公开身份。

## Agent 工具链

已安装的 workflow skill 和代码导航工具可辅助设计、计划、评审与最小实现，但不能替代 `check:impact`、surface check、`check:policy` 或 `verify`。使用仓库当前的 skill registry，不要假设不存在的命令或 Agent 名称。

Agent 分级以能证明任务为准：局部且可逆的改动用单 Agent；跨 surface 不确定时用独立探索或专项评审；只有高风险或架构级工作才拆分探索、实现和对抗性复核。不要默认所有 sub-agent 都用最高模型档位，也不要让并行 Agent 在同一工作树中修改相互冲突的内容。

## 回归测试设计

同区域测试文件只是门禁的最低信号，测试还必须证明行为：

- **驱动状态迁移。** 用 `handleServerMessage`、真实 store action 或用户事件产生状态，不要直接 `setState` 写出本应由迁移生成的结果；初始化 fixture 可以直接设置状态。
- **断言行为不变量。** 断言用户应看到哪个会话或模型的数据，不要抄当前屏幕文本；不要为了过门禁修改既有测试输入或预期。
- **覆盖丢弃与保留两个方向。** replay 要被丢弃，真实重复要被保留；透传 `uuid`、`toolUseId` 等上游身份，不要用文本猜身份。
- **测试跨边界连接点。** server、store、component 各自通过不等于消息真的驱动了 UI；通过真实入口测试连接，不 mock 被测模块本身。
- **先判断脆弱还是缺陷。** 在干净的 `main` worktree 上复现疑似既有脆测试；修改等待方式前，先确认断言测的是行为而不是机器速度。
- **外部服务替身从真实响应出发。** 给网关、OAuth、令牌接口写替身前，先抓一次真实请求和响应（脱敏）再建模。SiHub 令牌链路曾有 695 条离线测试通过，但真实调用因未写进文档的 `New-Api-User` 表头和分组字段全部失败；实机路径没跑过之前，只能报「离线测试通过、实机未验证」，不能说「修好了」。

覆盖率也有边界：`desktop/vitest.config.ts` 只采集 `src/**`，不包含 Electron main process；Bun coverage baseline 当前没有 branch records，`0/0` 显示为 100% 不代表所有分支都测到。以当前配置和报告为证据。

## Feature Quality Contract

所有功能、bugfix 和行为变化都必须带可验证证据：

- 先声明变更面，并为可执行 JS/TS 生产代码补同区域测试；具体 area 和阻断判定由 `scripts/pr/change-policy.ts` 执行。
- 纯逻辑写单元测试；server/API/provider/runtime 写 API 或 request-shape 测试；桌面 UI/store/API 写 Vitest 或 Testing Library；跨 UI、WebSocket、provider proxy、native sidecar 和发布打包的流程补 E2E 或 smoke。
- agent loop、工具调用、provider 路由、模型选择、文件编辑、权限、会话恢复和桌面聊天改动必须有 mock/fixture 测试。live smoke 或 baseline 只在确定性检查通过且维护者明确授权后运行。
- 新增或变更的可执行生产代码行必须满足 `coverage-thresholds.json` 的 changed-line coverage 门槛。修改 coverage baseline/threshold 需要维护者授权和 `allow-coverage-baseline-change`。
- PR 描述必须记录 changed files、tests added or updated、coverage evidence、E2E/live evidence 或 blocker，以及 known risk / rollback。

## 本机 Push 前提醒

push 不再自动运行本地质量门禁，需要时手动运行：

```bash
bun run quality:push
```

它复用 PR gate 的 impact、policy 和路径检查，默认跳过耗时 coverage。`bun run hooks:install` 只安装非阻塞提醒，不会卡住 push。

## PR CI 合并门禁

`.github/workflows/pr-quality.yml` 在 PR 更新时运行。`scope-plan` 生成稳定的影响面计划，`policy-enforcement` 独立执行 policy，产品 job 按路径选择 desktop、server、adapter、native、provider contract、chat contract、persistence、docs 和 coverage lane。最终的 `pr-quality-gate` 要求选中的 job 成功、未选中的明确 skipped，不能把 cancelled 或缺失结果误判为通过。

`bun run audit:harness` 的 required contract 失败会非零退出；兼容窗口内的历史命名等其他 rubric 发现只报告、不阻断。仓库设置、ruleset、secret 和 required-check 变更必须经过明确授权。

## 统一验证入口与 PR 证据

```bash
bun run verify
```

`bun run verify` 等价于 `bun run quality:pr`，按当前 diff 运行选中的 policy、surface、contract、persistence、docs 和 coverage lane，不调用真实模型。只有维护者授权的 live provider / baseline 不属于普通贡献者必跑项。

PR 描述请写：

- 用户影响和 changed surface；
- changed files、tests added or updated；
- 实际运行的命令和质量/coverage 报告路径；
- E2E 或 live evidence，或者明确 blocker；
- 已知风险、回滚方式和未运行的检查。

## 维护者验证与发布

真实模型 baseline、provider 配置、签名和真实升级验收属于维护者流程，不是普通贡献者或公开 PR 的要求。需要执行这些流程时，维护者应查阅 `docs/_internal/release-windows.md` 及其他 `_internal/` runbook；不要在公开贡献指南中记录本机 provider、凭据或真实升级步骤。

公开发布契约仅要求版本号、Git tag 与 `release-notes/vX.Y.Z.md` 一致，并通过 `bun run check:release-surface`。
