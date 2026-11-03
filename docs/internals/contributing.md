---
title: 参与贡献与质量门禁
nav_title: 参与贡献
description: 本地安装、影响面检查、质量门禁、测试要求与发布流程。
order: 14
---

# 参与贡献与质量门禁

这份文档说明如何安装、开发、测试和运行质量门禁。目标是让每次改动都能回答：这次改动有没有破坏核心 Coding Agent 工作流？

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
| PR（必需） | `pull_request` | 按影响面选中的确定性 lane，含 `check:agent-flow` | 无模型、无 secret，对外部贡献安全 |
| 全量 | 维护者手动触发 `workflow_dispatch` | 全部确定性 lane、模块图健康度和 `check:desktop-ui-smoke` | 仍无模型、无 secret |
| Release | tag 自动触发 `release-desktop.yml` | 内容门禁、三组验证 job、六平台构建 | live 检查只在获授权的维护者流程运行 |

发布工作流的 `release-contract` 先检查发布面、tag、`desktop/package.json` 版本和发布说明标题；`verify-governance`、`verify-runtime`、`verify-desktop` 并行验证，`release-verify-gate` 汇总结果。构建或验证失败都不会发布。

维护者的 live baseline、签名、打包和真实升级验收属于内部 runbook。

## 影响面检查

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

这两条 lane 不需要 provider、凭据或公网。`agent-browser` 只属于这条已提交的 lane（在 Linux CI 上以 headless 方式运行）以及维护者手动执行的 `desktop/scripts/e2e-*-agent-browser.sh`。临时浏览器检查、截图和探索性 UI 验证使用当前会话实际可用的浏览器自动化手段（浏览器 MCP、浏览器插件或 headless Chrome），不要把仓库里的 `agent-browser` 当成通用工具。

所有会启动真实 server 的 quality-gate lane 都跑在沙箱配置目录里（`scripts/quality-gate/sandbox.ts`），并在结束时校验没有写过开发者真实的 `~/.claude`；写了就判定 lane 失败。

开发时运行 impact report 选中的窄命令即可。需要完整验证时，直接使用统一入口，无需先单独执行其全部 lane：

```bash
bun run verify
```

`bun run verify` 等价于 `bun run quality:pr`，会按改动范围执行被选中的 policy、desktop、server、adapter、native、provider contract、chat contract、persistence、docs 和 coverage lane。它不调用真实大模型。小范围外部贡献者不需要在本机运行无关模块；GitHub CI 会再次执行精确的 path-aware gate。

主质量报告会内嵌当前测试范围、结果矩阵、覆盖率摘要，并链接完整 coverage/JUnit/log artifact：

```text
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/report.json
artifacts/quality-runs/<timestamp>/junit.xml
artifacts/quality-runs/<timestamp>/logs/*.log
artifacts/coverage/<timestamp>/coverage-report.md
artifacts/coverage/<timestamp>/coverage-report.json
```

交付记录里请贴出你实际运行的命令和 summary。`quality:pr` / `quality:verify` 仍然保留为兼容入口，但推荐文档和 AI prompt 都使用 `bun run verify`。

### 轻量验证（维护者日常发版）

发版验证已经搬到 CI 里了，本地不需要再跑全量。日常流程：

1. **开发迭代**：先跑本次行为的定向测试；不要仅凭目录名启动完整 surface gate。检查最终 diff、需要完整验证证据时，再运行 `bun run check:impact`，并按报告选择检查。
2. **打 tag 前**（可选）：手动触发 GitHub Actions 里的 `Quality Check` workflow，确认代码库是绿的。
3. **打 tag**：`release-desktop.yml` 自动跑内容门禁 + 并行验证 + 6 平台构建，全过了才发。

如果确实要在本地跑一遍（比如网络不方便），用下面这组命令，覆盖面和 CI 验证一致：

```bash
bun run check:policy              # policy、dead-imports、module-graph、contract 字节预算
bun run check:server              # src/ 全量
bun run check:desktop             # lint + vitest + vite build
bun run check:provider-contract   # provider/proxy/auth 契约
bun run check:chat-contract       # desktop transport、store、首回合
bun run check:persistence-upgrade # 持久化迁移与旧 fixture
bun run check:agent-flow          # 无模型的 agent 端到端 8 场景
bun run check:adapters            # IM sidecar
bun run check:release-surface     # 发版面：品牌标记、版本/品牌漂移、冲突残留
```

`check:native`（完整 sidecar 构建 + 打包 + package smoke）最慢，仅在触碰 `native/`、`desktop/electron` 打包配置或发版脚本时跑。真正的 Release workflow 会在 6 个平台上重新构建，本机不必重复。

跑 `check:server` 时它与动态端口测试不可与其他 server lane 并发，串行执行。

覆盖率门禁按本次改动的源码区域运行 root、desktop、adapters 对应套件，并执行 baseline ratchet、报告目标差距和检查变更行覆盖率；未改动区域不重复跑。没有可识别的源码区域变更，或覆盖率策略及依赖清单变化时会运行全部区域。当前 baseline 记录在 `scripts/quality-gate/coverage-baseline.json`，CI 会优先对比 base branch 的 baseline，改动区域的覆盖率不得低于允许窗口。`coverage-baseline.json` 或 `coverage-thresholds.json` 变更必须由维护者加 `allow-coverage-baseline-change` 后才能合并。Quarantine 只用于维护者的 baseline/release 追踪，不得隐藏确定性的 provider/chat 契约测试；当前普通 PR gate 不依赖 quarantine 才能通过。

## AI Coding Agent 修复循环

1. 先运行 `bun run check:impact`，确定当前 diff 的检查范围。
2. 先写能复现行为的测试，观察它因预期缺陷失败，再做最小修复。
3. 修复期间重跑受影响的窄检查；最后一次编辑后重新运行最终所需检查。
4. 只修复本次改动造成的失败；无关的既有失败或环境阻塞要如实报告，不要擅自扩大范围。
5. 只有最终 diff 的 `bun run verify` 通过，才能声明 full validation。

诊断 lane 失败时，先看 `artifacts/quality-runs/<timestamp>/report.md` 的 Summary / Result Matrix 和对应 `logs/<lane>.log`。coverage 失败看 `artifacts/coverage/<timestamp>/coverage-report.md` 或 `.json`，不要降低 baseline、threshold 或改写测试预期来掩盖失败。`bun run check:impact` 用于确定最终 diff 的检查范围；必须先读取 impact 结果，再启动它选中的检查，不得与 impact 分析并行抢跑。`check:native` 包含 sidecar 构建、打包和 package smoke，成本较高，仅在报告选中且交付证据需要时运行。检查失败或输出不完整时，先查看已有日志和进程；只有出现新的诊断依据时才重跑同一检查。没有后续改动或未解决风险时，不要反复运行已经通过的检查。无关的现有失败或环境阻塞应准确报告，而不是为了让结果变绿擅自扩大修改范围。

合并时必须对冲突逐 hunk 裁决，不能整体套用 `--ours` 或 `--theirs`；发布前还要运行 `bun run check:release-surface` 审计公开身份。

## Agent 工具链

已安装的 workflow skill 和代码导航工具可辅助设计、计划、评审与最小实现，但不能替代 `check:impact`、surface check、`check:policy` 或 `verify`。使用仓库当前的 skill registry，不要假设不存在的命令或 Agent 名称。

Agent 分级以能证明任务为准：局部且可逆的改动用单个 Agent；跨 surface 不确定时用独立探索或专项评审；只有高风险或架构级工作才拆分探索、实现和对抗性复核。不要默认所有子 Agent 都用最高模型档位，也不要让并行 Agent 在同一工作树中修改相互冲突的内容。

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
- 交付记录应记录 changed files、tests added or updated、coverage evidence、E2E/live evidence 或 blocker，以及 known risk / rollback。

## 本机 Push 前提醒

push 不再自动运行本地质量门禁，需要时手动运行：

```bash
bun run quality:push
```

它复用 impact、policy 和路径检查，默认跳过耗时 coverage。`bun run hooks:install` 只安装非阻塞提醒，不会卡住 push。

`bun run audit:harness` 的 required contract 失败会非零退出；兼容窗口内的历史命名等其他 rubric 发现只报告、不阻断。仓库设置、ruleset、secret 和 required-check 变更必须经过明确授权。

## 交付证据

`bun run verify` 的范围见上文“无模型的端到端 Agent 门禁”。只有维护者授权的 live provider / baseline 不属于普通贡献者必跑项。

交付记录请写：

- 用户影响和 changed surface；
- changed files、tests added or updated；
- 实际运行的命令和质量/coverage 报告路径；
- E2E 或 live evidence，或者明确 blocker；
- 已知风险、回滚方式和未运行的检查。

## 维护者验证与发布

真实模型 baseline、provider 配置、签名和真实升级验收属于维护者流程，不是日常改动的要求。需要执行这些流程时，维护者应查阅 `docs/_internal/release-windows.md` 及其他 `_internal/` runbook；不要在公开贡献指南中记录本机 provider、凭据或真实升级步骤。

公开发布契约仅要求版本号、Git tag 与 `release-notes/vX.Y.Z.md` 一致，并通过 `bun run check:release-surface`。
