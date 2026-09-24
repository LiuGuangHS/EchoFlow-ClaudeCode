---
title: 参与贡献与质量门禁
nav_title: 参与贡献
description: 本地安装、影响面检查、质量门禁、测试要求与 PR 提交流程。
order: 14
---

# 参与贡献与质量门禁

这份文档说明贡献代码前应该如何在本地安装、开发、测试和运行质量门禁。目标是让维护者和贡献者都能在提交 PR 前回答一个问题：这次改动有没有破坏核心 Coding Agent 工作流。

## 环境准备

项目根目录使用 Bun：

```bash
bun install
```

如果改动涉及 `desktop/`，也安装桌面端依赖：

```bash
cd desktop
bun install
```

如果改动涉及 `adapters/`，或者要运行 `check:adapters` / `check:native`，安装 adapter 依赖：

```bash
cd adapters
bun install
```

不要提交本地运行产物，例如 `artifacts/quality-runs/`、`node_modules/`、`desktop/node_modules/`。

### 常用开发命令

```bash
bun run start                                   # 或 ./bin/echoflow-code，本地运行 CLI
SERVER_PORT=3456 bun run src/server/index.ts    # desktop/ 使用的本地 API/WebSocket 服务
cd desktop && bun run dev                       # Vite 启动桌面端前端
cd desktop && bun run test                      # 桌面端 Vitest 套件
cd desktop && bun run check:electron            # 校验 Electron host 代码并重建 bundle
cd desktop && bun run build                     # 类型检查 + 生产构建
cd adapters && bun run test                     # 全部 adapter 测试；test:<platform> 只跑单平台
bun run docs:dev                                # 文档站预览；bun run docs:build 构建
```

Windows x64 打包用 `cd desktop && bun run build:windows-x64`，需要 Bun/Bunx 和带「使用 C++ 的桌面开发」工作负载的 Visual Studio 2022 Build Tools。

## 四层门禁分工

| 层级 | 触发 | 运行内容 | 约束 |
| --- | --- | --- | --- |
| 本地迭代 | 手动 | 最窄的相关测试；`bun run check:impact` 选中的命令 | 秒级反馈 |
| PR（必过） | `pull_request` | impact 选中的确定性 lane，含 `check:agent-flow` | 无模型、无 provider、无 secret、fork 可跑 |
| 全量 | 维护者手动触发（`workflow_dispatch`） | 全部确定性 lane（不做路径选择）+ 模块图健康度 + `check:desktop-ui-smoke` | 仍然无模型、无 secret |
| Release | 维护者手动 `bun run quality:release`（**不是** `release-desktop.yml`） | PR + 全量层全部内容 + native/打包 smoke + 维护者授权的真实 provider baseline | 真实模型只在此层，且需显式授权 |

注意：`release-desktop.yml` 按设计**不跑任何质量门禁**——打 tag 不应被 `bun run verify` 阻塞，`scripts/pr/release-workflow.test.ts` 有守卫测试锁定这一点。因此发版前的质量证据来自「合并进来的那些 PR」+ 维护者手动跑的全量层 + `quality:release`。全量层刻意不设定时：跑不跑、什么时候跑由维护者决定，`pr-quality-workflow.test.ts` 会拦住重新加回 `schedule:` 的改动。

分层原则：**PR 只跑改动能影响到的范围**，因此它天然无法覆盖"没有 PR 碰过的检查"和"只有全套一起跑才暴露的问题"——这两个盲区交给手动触发的全量层；**真实模型/额度只出现在 Release 与维护者手动 smoke**，任何贡献者在没有 provider 的情况下都必须能跑通 PR 层的全部门禁。

## 普通 PR 的影响面检查

先让仓库按变更路径列出需要运行的检查：

```bash
bun run check:impact
```

选择是**依赖感知**的：除了改动文件自身的路径前缀，还会把「谁 import 了这些文件」纳入检查范围（`scripts/pr/module-graph.ts`）。这修掉了纯前缀路由的漏检，例如改 `src/shared/modelReasoning.ts` 会选中 `check:desktop`（`desktop/src/lib/runtimeSelection.ts` 直接 import 它），改 `desktop/src/lib/browserSafePort.ts` 会选中 `check:native`（`desktop/electron/services/sidecarManager.ts` import 它，而 `desktop/tsconfig.json` 并不编译 `desktop/electron/`）。报告的 `## Cross-surface impact` 会指名是哪个 importer 触发了额外检查。

依赖图只**放宽检查选择**，不影响 area 标签和任何 blocking 规则——改一个 hub 文件不会因此要求你为没碰过的文件补测试。图构建失败时会选中全部 surface 并打印告警，不会静默退回前缀路由。

## 无模型的端到端 Agent 门禁

```bash
bun run check:agent-flow       # 真实 server + 真实 WebSocket + mock CLI
bun run check:desktop-ui-smoke # 真实桌面 UI + 真实权限对话框 + mock CLI
```

两条通道都不需要 provider、凭据或公网。`check:agent-flow` 覆盖新建 Session → 选运行时 → 首轮流式 → 工具调用 → 权限批准/拒绝 → 工具失败 → API 错误 → 中断 → 断线重连权限重放 → 会话恢复。`check:desktop-ui-smoke` 在真实浏览器里点真实的 Allow 按钮，需要 `agent-browser` 与已安装的 desktop 依赖，缺失时会打印原因并跳过。

`agent-browser` 只属于这条已提交的 lane（在 Linux CI 上以 headless 方式运行）以及维护者手动执行的 `desktop/scripts/e2e-*-agent-browser.sh`。临时的浏览器操作（手动验证、截图、探索性 UI 检查）请走 `ego-browser` skill，不要因为仓库里出现 `agent-browser` 就把它当通用浏览器工具。

所有会启动真实 server 的 quality-gate lane 都跑在沙箱配置目录里（`scripts/quality-gate/sandbox.ts`），并在结束时校验没有写过开发者真实的 `~/.claude`；写了就判定 lane 失败。

开发时运行 impact report 选中的窄命令即可。需要声明 PR-ready 或完整验证时，直接使用统一入口，无需先单独执行其全部 lane：

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

PR 描述里请贴出你实际运行的命令和 summary。`quality:pr` / `quality:verify` 仍然保留给习惯显式质量命名的用户，但推荐文档和 AI prompt 都使用 `bun run verify`。

覆盖率门禁同时执行四件事：按源码口径统计覆盖率、执行 baseline ratchet、报告 75-80%+ 的目标差距，并对新增/变更的可执行生产代码行执行 changed-line coverage。当前 baseline 记录在 `scripts/quality-gate/coverage-baseline.json`，CI 会优先对比 base branch 的 baseline，新增 PR 不允许覆盖率下降超过允许窗口。`coverage-baseline.json` 或 `coverage-thresholds.json` 变更必须由维护者加 `allow-coverage-baseline-change` 后才能合并。Quarantine 只用于维护者的 baseline/release 追踪，不得隐藏确定性的 provider/chat 契约测试；当前普通 PR gate 不依赖 quarantine 才能通过。

## AI Coding Agent 修复循环

任务的完成标准是实现目标行为、运行当前 diff 必需的验证，并修复由本次改动造成的失败。任务范围内的本地编辑、隔离 fixture 检查和相关失败修复无需逐步请求批准；提交、推送、发布、仓库设置及真实模型额度仍遵循根 `AGENTS.md` 的授权边界。

`bun run check:impact` 用于确定检查范围；普通任务运行选中的检查，需要 PR-ready/full validation 时直接使用 `bun run verify`，不必先单独重复执行其全部 lane。修复期间先重跑受影响的窄检查，交付时补齐最终 diff 的所需证据。没有后续改动或未解决风险时，不要反复运行已经通过的检查。无关的现有失败或环境阻塞应准确报告，而不是为了让结果变绿擅自扩大修改范围。

需要诊断失败时，按失败类型查阅相应证据：

| 失败类型 | 证据与处理 |
| --- | --- |
| Lane 失败 | `artifacts/quality-runs/<timestamp>/report.md` 的 Summary / Result Matrix，以及 `logs/<lane>.log` |
| Path-aware PR checks | 核对同区域测试、CLI core 和 coverage policy；维护者 override 需要明确决定 |
| Coverage gate | `artifacts/coverage/<timestamp>/coverage-report.md` 或 `.json`；修复 `changedLines.failures` / `failures`，`targetGaps` 是技术债提示 |
| 构建、类型、lint、文档或 native | 修复对应日志指出的本次变更问题，重跑受影响检查 |

只有最终 diff 的 `bun run verify` 报告通过，才能声明 PR-ready/full validation。不要通过降低 coverage baseline/threshold 或改写测试预期掩盖失败。

## Agent 工具链

本仓库的默认工具链是五个插件，覆盖设计、规划、评审与最小化实现。它们加速流程，但**不替代门禁**：`bun run check:impact`、各 surface 检查、`bun run check:policy` 与 `bun run verify` 仍然是唯一裁判。插件与本仓库约定冲突时，以 `AGENTS.md` 和本文档为准。

| 插件 | 用途 | 入口 |
| --- | --- | --- |
| `superpowers` | 需求澄清 → 实现计划 → 分批执行的主流程，带评审检查点 | `/superpowers:brainstorm`、`/superpowers:write-plan`、`/superpowers:execute-plan`；评审用 `@code-reviewer` |
| `ponytail` | 最小实现阶梯：先问需不需要写，再复用既有代码、标准库、原生能力，最后才写最少可用代码 | `/ponytail-review` 审查当前 diff；`/ponytail-audit` 审查整个仓库 |
| `frontend-design` | 桌面端与文档站的界面设计质量，避免通用化观感 | 涉及 UI 设计时按需触发 |
| `typescript-lsp` | TypeScript/JavaScript 的跳转定义、查找引用与错误检查 | 自动生效 |
| `claude-model-router-hook` | 按任务类别路由模型档位，并约束子代理生成时的模型选择 | 自动生效；配置见 `.claude/model-router.json` |

`superpowers`、`typescript-lsp`、`frontend-design` 由 Claude Code 官方市场提供；另外两个需要先添加各自的市场：

```bash
/plugin marketplace add tzachbon/claude-model-router-hook
/plugin install claude-model-router-hook@claude-model-router-hook
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

任务类别（机械操作、实现、调试、架构、跨系统改造）到模型档位的映射由 `claude-model-router-hook` 自己定义和维护——**不要**在仓库文档里复制这张表，也不要改写插件的判定逻辑。调用 Agent 工具时按任务类别设置 `model`，不要把每个子代理都设为最高档。

`ponytail` 是 Engineering Behavior Guardrails 中"最小改动"那条的执行手段：diff 超出自身证明范围时用 `/ponytail-review` 找出可删的部分。它的 `ultra` 档会挑战需求本身，而 fork 身份、provider 政策、持久化兼容与发布链路是 `AGENTS.md` 规定的不可协商项——不要用任何档位去挑战它们。

## 回归测试设计

同区域测试文件是门禁的最低信号，测试还需要证明实际行为：

- **驱动状态迁移。** 需要验证迁移时，通过 `handleServerMessage`、真实 store action 或用户事件产生状态，避免直接 `setState` 写出本应由迁移生成的结果。初始化 fixture 仍可直接设置状态。
- **断言行为不变量。** 断言用户应看到哪个会话或模型的数据，而不是抄下当前屏幕的字符串；测试输入和预期应由预期行为契约支撑，不为掩盖失败而修改。
- **覆盖丢弃与保留两个方向。** 验证去重、合并和过滤规则应丢弃及应保留的情况。消息去重尤其要拦住 replay、保留真实重复；透传上游 `uuid` / `toolUseId` 等身份，避免用文本猜测身份。
- **跨边界测试连接点。** server、store、component 分别通过并不能证明消息真正驱动了 UI；通过真实入口验证有风险的连接，避免 mock 被测模块本身。

覆盖率报告也有边界：`desktop/vitest.config.ts` 只采集 `src/**`，不包含 Electron main process。仓库现有 Bun coverage baseline 中分支总数为 0，`coverage.ts` 把 `0/0` 显示为 100%；这不代表测到了全部分支。查看当前配置和报告，不把历史覆盖率数字当作新改动的证明。

### 真实回归判例

上面是方向，以下是已经发生过的回归。保留具体证据，用来判断"这次是不是同一类问题"。

- **驱动状态迁移，不要手写迁移产出的状态。** `desktop/src` 的组件测试里 `setState` 出现 744 次，真实 store action 只有 3 次。手写状态在构造上自洽，因此暴露不出"迁移 A 没有更新 B"——而这正是这类 bug 的所在。改用 `handleServerMessage`、store action 和真实用户事件。
- **断言不变量，不要断言今天的输出。** `2262973a4` 提交了 `expect(getByText('deepseek-reasoner'))`，而当时屏幕上显示的是另一个模型的数字：它把 bug 写成了通过的断言，下一个修复不得不反转同一行。要问的是"这一步之后必须为真的是什么"，不是"它现在打印什么"。
- **丢弃与保留两个方向都要覆盖。** replay 防护只测了"replay 必须被丢弃"，没测"真实重复必须保留"，于是上线后把真实回复丢掉了。
- **测连接点，不要只测两端。** server、store、component 各自都有 `runtime_config_applied` 的测试，但没有任何一个跨越三者；删掉连接它们的 `ChatInput.tsx` 中的 `refreshNonce`，314 个测试依然全绿。
- **不要为了保持绿灯而重调既有测试的输入。** `128f75ab5` 把五个测试的 props 从 `messageCount={0}` 改成 `{1}`，而不是承认它们描述的是真实会话到不了的状态。如果一个测试只有在你改完输入后才通过，那它描述的是实现，不是行为。

### 覆盖率参考

外部参考口径：

- [Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html)：60% acceptable、75% commendable、90% exemplary；changed/per-commit coverage 90% 是合理下限。
- [Microsoft Visual Studio / Azure DevOps 文档](https://learn.microsoft.com/en-us/visualstudio/test/using-code-coverage-to-determine-how-much-code-is-being-tested)：团队通常以约 80% 为目标，典型项目要求可为 75%，生成代码可以放宽。
- [ChromiumOS EC](https://chromium.googlesource.com/chromiumos/platform/ec/+/main/docs/code_coverage.md)：新增或变更行要求至少 80% 覆盖。

## 维护 Agent 指导

根 `AGENTS.md` 保留项目约束与入口，专项规则留在对应目录，解释和示例按需放到文档。共享指导应适用于贡献者使用的不同模型；能力升级后重新核对重复流程和宽泛停止条件，不能据此跳过现行安全或 CI 契约。这次整理参考了 Eric Provencher 的 [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862)（2026-09-04）。

`AGENTS.md` 的 "How This Contract Is Maintained" 一节把这条原则变成了可执行规则：一条规则只在同时满足三条时才留在根契约——改变方向判断、违反造成不可逆损失、无法从代码读出；否则外移到本文档并只留一行指针。触发条件（顶层目录或 gate 增删、`ChangeArea` 变更、流程变更、被引用文件移动）出现时，必须在**同一次提交**里修正。`scripts/pr/quality-contract.test.ts` 校验字节预算，并校验根契约的指针仍指向真实存在的内容——外移后又在根契约里重新写一份副本，会被这条断言拦住。

仓库技能的描述只写适用任务和必要的区分信息，操作细节放正文或引用文件。多工作流技能用短入口路由；避免为了覆盖更多关键词而扩大触发范围。模型默认值、工具格式和压缩行为属于产品实现，更新相关文档前应先核对源码。

## Feature Quality Contract

所有新功能、bugfix 和行为变化都必须带着可验证证据交付。这条规则同时约束人和 AI Coding Agent：

- 先声明变更面：`desktop`、`server`、`adapter`、`native`、`docs`、`provider/runtime`、`agent-loop` 或 `release`。
- 可执行 JS/TS 生产代码变更必须同 PR 带同区域测试；`scripts/pr/change-policy.ts` 分别检查 `desktop/src/`、`src/server/`、其余 `src/` 和 `adapters/` 四个区域，除非维护者显式加 `allow-missing-tests`。文案或 CSS 等非可执行文件不因这一规则单独要求新增测试，仍需完成 impact 选中的检查。
- 纯逻辑写单元测试；server/API/provider/runtime 写 API 或 request-shape 测试；桌面 UI/store/API 写 Vitest/Testing Library；跨 UI、WebSocket、provider proxy、native sidecar、发布打包的用户流程要补 E2E 或桌面 UI smoke。
- agent loop、工具调用、provider 路由、模型选择、文件编辑、权限、会话恢复、桌面聊天改动，PR 内必须有 mock/fixture 测试；live smoke 或 baseline 仅在确定性检查通过且维护者明确授权额度后运行。发现本机 provider 不代表获得授权，未运行时如实说明。
- 覆盖率是功能的一部分。本项目按 Google/Microsoft 风格执行：生成物/构建产物不计入产品覆盖率，维护中的产品区域要逐步达到 75-80%+，新增或变更的可执行生产代码行必须满足 `coverage-thresholds.json` 里的 changed-line coverage 门槛。
- 不要为了过门禁随便降低 `coverage-baseline.json` 或 `coverage-thresholds.json`；确实要改时必须有 `allow-coverage-baseline-change` 和原因。历史低覆盖区域是技术债，新 PR 至少要让触达区域更好。
- PR 描述必须写清楚：改了哪些文件、补了哪些测试、coverage 报告路径、E2E/live 报告路径或 blocker、剩余风险。

## 本机 Push 前提醒

push 不再自动运行本地质量门禁。需要质量检查时，请手动运行：

```bash
bun run quality:push
```

`bun run quality:push` 复用 PR gate 的 impact/policy/路径检查，但默认跳过耗时的 coverage lane；完整覆盖率仍保留在 `bun run verify`、`bun run quality:pr` 和 CI。

仍然可以安装本机 pre-push hook，但它只打印非阻塞提醒，不会卡住 `git push`：

```bash
bun run hooks:install
```

拥有可信仓库环境和模型额度的维护者可以手动运行真实 provider smoke 和桌面 agent-browser smoke：

```bash
bun run quality:providers
bun run quality:smoke -- --provider-model minimax:main:minimax-main
```

需要完整 live baseline 时使用：

```bash
bun run quality:gate --mode baseline --allow-live --provider-model minimax:main:minimax-main
```

## PR CI 合并门禁

`.github/workflows/pr-quality.yml` 会在 PR `opened`、`synchronize`、`reopened`、`ready_for_review`、`labeled`、`unlabeled` 时触发。`scope-plan` 不安装依赖，只负责稳定地产生影响面计划；`policy-enforcement` 独立安装锁定依赖并执行 policy，因此 policy 失败也不会吞掉产品测试结果。产品 job 只依赖 `scope-plan`，按路径选择 desktop、server、adapter、native、provider contract、chat contract、persistence、docs 和 coverage lane。最后的 `pr-quality-gate` 会严格核对每个 job：选中的必须 success，未选中的必须 skipped，cancelled 或缺失结果都不能误判为通过。

仓库侧应在 GitHub branch protection / ruleset 中保护 `main`，并把 `pr-quality-gate` 设为 required status check。CODEOWNERS 要求维护者审查 workflow、quality policy 以及 provider/WebSocket 等高风险边界；本机 hook 只做提醒，真正阻止低质量 merge 的是 PR gate。

## 按改动范围补充测试

根据你改动的区域补充运行：

```bash
bun run check:server      # 服务端 API、WebSocket、provider、会话等测试
bun run check:desktop     # 桌面端 lint、Vitest、生产构建
bun run check:adapters    # IM adapter 测试
bun run check:mobile      # Expo 移动端外壳：类型检查、测试类型检查与 bun test
bun run check:native      # 桌面 sidecar、Electron host 与 package-smoke 检查
bun run check:provider-contract # Provider/runtime/proxy 的离线契约测试
bun run check:chat-contract     # WebSocket、会话与桌面 chat store 契约测试
bun run check:persistence-upgrade # 持久化迁移和旧 fixture 兼容性
bun run check:docs        # 独立安装、构建并检查 site/ React 文档站
bun run check:quarantine  # 维护者 baseline/release quarantine 审计
bun run check:coverage    # root、desktop、adapters 覆盖率报告和 ratchet 门禁
```

如果只改了很窄的文件，先跑对应的定向测试即可；只有在声明 PR-ready/full validation 时才需要本地再跑 `bun run verify`，托管 CI 仍会执行所有被选中的必需 lane。

可执行 JS/TS 生产代码改动必须带对应测试文件；同区域划分见上文 Feature Quality Contract 和 `scripts/pr/change-policy.ts`，缺失时会触发阻断。只有维护者确认不适合自动化测试时，才能使用 `allow-missing-tests`。覆盖率 baseline/threshold 变更同样需要维护者确认并加 `allow-coverage-baseline-change`。

## 真实模型 Baseline

`quality:baseline` 用来跑真实 Coding Agent 任务：启动本地服务端、创建隔离 fixture、让模型通过聊天修代码、跑测试，并保存 transcript、diff、verification log 和报告。它还会对 provider 进行 live smoke：已保存或当前激活的 OpenAI-compatible provider 会验证连通性、proxy 转换和流式 proxy 结果；env-only provider smoke 只验证上游连通性和转换管线。

默认命令不会调用真实模型：

```bash
bun run quality:baseline
```

要真正跑模型，必须显式加 `--allow-live` 并选择本机 provider。

先列出本机可用 provider 和可复制参数：

```bash
bun run quality:providers
```

输出示例：

```text
Saved providers:
  MiniMax
    selector: minimax
    main: MiniMax-M2.7-highspeed
      --provider-model minimax:main:minimax-main
```

复制输出里的参数运行 baseline：

```bash
bun run quality:gate --mode baseline --allow-live --provider-model minimax:main:minimax-main
```

如果只需要跑 provider smoke 和桌面 agent-browser smoke，而不跑全部 baseline case，可以使用：

```bash
bun run quality:smoke --provider-model minimax:main:minimax-main
```

可以一次跑多个模型：

```bash
bun run quality:gate --mode baseline --allow-live \
  --provider-model codingplan:main:codingplan-main \
  --provider-model minimax:main:minimax-main
```

`provider` selector 来自桌面端「设置 → 模型配置」里保存的本机配置。别人 clone 代码后不需要知道你的 provider UUID，也不需要复用你的模型配置；他们可以在自己的桌面端添加 provider 后运行 `bun run quality:providers` 选择自己的模型。

如果没有保存 provider，也可以用环境变量跑一条 unsaved provider smoke：

```bash
QUALITY_GATE_PROVIDER_BASE_URL=https://example.com \
QUALITY_GATE_PROVIDER_API_KEY=... \
QUALITY_GATE_PROVIDER_MODEL=model-id \
QUALITY_GATE_PROVIDER_API_FORMAT=openai_chat \
bun run quality:gate --mode baseline --allow-live
```

## 什么时候必须跑 Baseline

以下改动在确定性 contract/E2E 通过后，建议由可信维护者补跑 live baseline：

- 桌面聊天、会话恢复、WebSocket、CLI bridge
- provider/model/runtime 选择
- 权限、工具调用、文件编辑、任务执行
- agent-browser smoke、Computer Use、Skills、MCP
- release 前或风险较大的跨模块重构

来自 fork 的外部 PR 不会获得仓库 secrets，也不要求贡献者自费调用模型。请在 PR 里写明 `live model: not run (untrusted fork / no provider)`；高风险变更由维护者在合并或发版前补跑 live baseline。没有 live 证据不应让确定性 PR lane 产生随机失败。

## Release 门禁

发版前使用 release 模式：

```bash
bun run quality:gate --mode release --allow-live --provider-model <selector>:main
```

release 模式会组合 PR checks、baseline catalog、live baseline、native checks，并用当前平台 canonical release artifact 跑 `package-smoke --package-kind release`。发版报告同样写入 `artifacts/quality-runs/<timestamp>/`。`release-desktop.yml` 只负责构建与发布，不运行 `bun run verify`；发版前质量证据来自 PR 门禁及维护者显式运行的全量检查和 release gate。

release 模式下 live lane 不允许静默跳过。缺少 provider、真实模型额度或外部账号时，门禁会失败，并要求在发版记录里明确 blocker。

## 发版与自动更新

桌面端版本号的唯一来源是 `desktop/package.json`。正式发布要求版本号、Git tag 和 `release-notes/vX.Y.Z.md` 三者严格一致。

应用内更新由 `electron-updater` 驱动，产物托管在 GitHub Releases：

| 平台 | 安装/更新目标 | Metadata |
|---|---|---|
| macOS arm64 / x64 | `dmg` 首次安装，`zip` 供 Squirrel.Mac 更新 | `latest-mac.yml` |
| Windows x64 / ARM64 | NSIS `.exe` | `latest.yml` |
| Linux x64 | `.AppImage` 自动更新，`.deb` 供手动安装 | `latest-linux.yml` |
| Linux arm64 | `.AppImage` 自动更新，`.deb` 供手动安装 | `latest-linux-arm64.yml` |

Release workflow 先在各平台 matrix 里生成 `latest*.yml`，把同名 metadata 临时改名为 `latest-<platform>.yml`，最后由 `scripts/release-update-metadata.ts` 合并回 electron-updater 期望的标准文件名。不要改成各 matrix job 直接发布 GitHub Release，否则 metadata 会互相覆盖。

### 签名 Secrets

macOS 的签名与公证依赖以下 GitHub Actions repository secrets：

```text
MACOS_CERTIFICATE
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`MACOS_CERTIFICATE` 是 Developer ID Application `.p12` 的 base64 内容。项目不发布 `.pkg`，不需要 Developer ID Installer 证书。

Windows 签名是可选项：

```text
WINDOWS_CERTIFICATE
WINDOWS_CERTIFICATE_PASSWORD
```

缺少 Windows 签名时自动更新仍然可用，只是用户可能看到 SmartScreen 提示。

### 发版前检查

```bash
bun run scripts/release.ts <version> --dry
bun test scripts/pr/release-workflow.test.ts scripts/release-update-metadata.test.ts scripts/quality-gate/package-smoke/index.test.ts
bun run check:policy
```

正式执行 `bun run scripts/release.ts <version>` 前，先确认对应的 `release-notes/v<version>.md` 已经存在。

### 验证一条真实更新链路

每次发版至少验证一次从上一个正式版升上来的完整路径：

1. 安装 GitHub Release 里的上一个正式版。
2. 推 tag，让 `Release Desktop` workflow 完整通过。
3. 打开旧版本，等待启动后的自动检查，或在设置里手动检查更新。
4. 确认提示新版本，下载完成后安装并重启。
5. 重启后确认「关于」里的版本号正确，且服务商、会话、Skills、Agents、记忆、自定义宠物和自定义数据目录仍然可用。
6. 确认历史附件上下文、子 Agent 详情和任务状态可以恢复；打开桌宠，验证悬浮窗口与当前会话导航。

各平台的重点不同：macOS 要确认 release job 走的是签名产物且启动策略检查通过；Windows 要确认 `latest.yml`、`.exe`、`.exe.blockmap` 都在 Release 资产里，未签名时的 SmartScreen 提示不代表 updater 失败；Linux 优先用 AppImage 验证自动更新，`.deb` 只作手动安装包发布。

## 上游同步（维护者）

fork 跟踪上游的**发布**，而不是上游 `main` 的移动顶端：上游 `main` 是开发分支，只有 release tag 才是 fork 能对齐的版本。同步是高风险操作，不可协商的约束写在根 `AGENTS.md` 的 "Upstream Sync Direction"；本节是完整流程。

### 三条命令

| 命令 | 作用 |
| --- | --- |
| `bun run upstream:check` | 只读探测，报告判定结果，不改动任何东西 |
| `bun run upstream:resolve` | 拉取同步分支并在本地把 `main` 合入，冲突留在工作区、不提交 |
| `bun run upstream:sync` | 推送同步分支，便于开 PR |

三条命令都要 bun（`packageManager: bun@1.3.14`）：脚本用了 `import.meta.dir`，Node 跑不了。

能丢东西的两条约束：

- `upstream:resolve` 内部是 `git switch --track --force-create <分支> origin/<分支>` —— **会切换分支并覆盖同名本地分支**，且工作区必须干净，有未提交改动会直接报错退出。
- `upstream:sync` 用 `git push --force-with-lease`；远端同名分支内容不同时拒绝推送，不会覆盖人工解决过的冲突。

`upstream:check` 的可选参数：`--strict`（有冲突时退出码为 1，默认始终 0）、`--base <分支>`（默认 `main`）。

**"是否已同步"按提交图判定**，不比较版本号：逐个检查 release commit 是否已是 base 分支的祖先，取最新的一个未合入项。fork 的版本线（`0.5.x`）与上游（`0.6.x`）本就不可比，用版本号判断会在 fork 版本号超过上游时静默漏掉同步。同理，**同步分支上存在某个 release 不等于该 release 已合入 `main`** —— 判定只看 base 分支。

### 自动化路径（已移除）

此前由 `.github/workflows/upstream-sync.yml` 每三天探测上游 release，并创建 `sync/upstream-vX.Y.Z` 分支与 PR。它实际没有产出可合并的 PR：同步分支的冲突面很大，而用默认 `GITHUB_TOKEN` 开的 PR 不会触发 `pull_request` 工作流，拿不到 CI 结果，于是长期停在未合入状态。该工作流已删除，release 探测改为手工执行上面的三条命令。

### 手工路径

每个上游 release 都按这条路径同步：

1. 从干净的 `main` 工作区开始，先检查已配置的 remote。
2. 正常拉取 `origin`。拉上游分支时不带 tag：`git fetch upstream +refs/heads/*:refs/remotes/upstream/* --prune`；上游 release tag 可能与 fork 的 release tag 重名。
3. 合并前先比较 `main...origin/main` 与 `main...upstream/main`。
4. 用 merge commit 合并上游；**不要** rebase 公开的 `main`。
5. 用 `/superpowers:brainstorm` 与 `/superpowers:write-plan` 规划这次合并（"合并上游，保留修复，替换品牌名"）；对冲突、高风险文件以及 provider 政策决策用 `@code-reviewer`。
6. **动手前先写出完整的冲突矩阵**（见下），然后一轮把所有冲突解决完；不要逐个发现、逐个修补。
7. 有意地解决文件内容，**绝不**整体套用 `--ours` 或 `--theirs`。保留 fork 身份与 provider 政策、无赞助的公开文档、持久化兼容、Electron 发布链路和质量门禁。
8. 每次合并后审计公开身份：README、文档、release notes、包元数据、诊断导出、签名/隐私页面、更新链接，以及桌面端「关于」/个人资料默认值，都不能把 NanmiCoder/阿江 或 `cc-haha` 写成当前 EchoFlow 的作者、维护者、联系人或产品。
9. 冲突分析与工作区编辑可以自动化，但 `git add` 和 `git commit` 必须由开发者显式确认。**绝不**自动暂存或提交冲突解决结果。
10. 写完冲突解决后，让 `@code-reviewer` 审阅这些结果并运行 `bun run check:policy`，再请开发者暂存/提交。构建或类型检查失败时，按 `AI Coding Agent 修复循环` 一节定位并修复，重跑失败的窄检查，并在声称可推送前运行 `bun run verify`。
11. 先推 `main`（或与 release tag 一起推），然后核对远端分支与 tag 指向。

### 冲突矩阵模板

一条一行，编辑前一次性写完：

| 文件 | base / ours / theirs 行为 | 最终决策 | 验证命令 |
| --- | --- | --- | --- |
| `package.json` | 上游改版本与依赖，ours 是 fork 元数据 | `ours` | `bun run check:policy` |
| `LICENSE` | 上游改版权行 | `ours` | 人工核对 |
| `providerPresets.json` | 上游新增 provider 预设 | `manual`，逐条按规则裁定 | `bun run check:provider-contract` |
| `desktop/src/stores/chatStore.ts` | 上游改会话标题逻辑，ours 是品牌文案 | 逐字段取舍：`title` 保 fork 品牌，`body` 吸上游逻辑 | `cd desktop && bun run test` |

`providerPresets.json` 永远判 `manual`；品牌类文件（`package.json`、`LICENSE`、`README.md`、`desktop/package.json`、`AGENTS.md`）判 `ours`，并单独确认上游逻辑是否需要一并带走。

### 参考案例：v0.6.4 的选择性采纳

这次合并走四阶段流程，是"选择性采纳"的范例。分支 `merge/upstream-v0.6.4-selective`，快照 tag `pre-merge-v0.6.4-snapshot`，预估 12–18 小时。

- **策略**：Cherry-pick + 手动合并，而不是整包 merge。
- **Phase 2 选中 6 个上游提交**（全部落地 `main`，cherry-pick 后生成新哈希）：Agent Teams 继承 lead model；队友权限提示路由；会话列表不再扫描全部 JSONL；恢复窗口拖拽；修复测试连接按钮塌陷；折叠控件与上下文表。
- **唯一一处品牌冲突的解法**（`desktop/src/stores/chatStore.ts`）既不是 `--ours` 也不是 `--theirs`，而是逐字段取舍——`title` 保 EchoFlow 品牌，`body` 吸上游逻辑。这是整条同步哲学最凝练的体现。
- **Phase 3 provider 决策**：上游 v0.6.4 新增的 7 个 provider 预设**全部拒绝**（5 个上游自己标了 `deprecated`，`atlascloud` 的链接带 `utm_campaign=cc-haha`，`apismart` 是赞助商），并恢复了上游删掉的 EchoFlow API。结论是 `providerPresets.json` **完全不改**。
- **最终只落 1 个文件**：`desktop/build/getProcessInfo.nsh`。

### 版本合并

上游同步包含多个上游 release 时，不要把上游的 release note 文件或版本号原样带进 fork。fork 的 `desktop/package.json` 是版本唯一事实源：

1. 下一个 fork 版本号由**最新的 fork 发布/tag** 决定，不由上游 tag 决定。
2. 把与用户相关的上游改动合并进下一个 fork release note，挂 fork 的版本号。
3. 每个 fork 发布只递增一次 patch 版本；**不要**因为合并了上游 `v0.6.4` / `v0.6.5` 就创建同名 tag。
4. 上游专用 release note 的内容归并完成后删除，除非维护者明确要求保留。
5. 提交前确认 `desktop/package.json`、合并后的 release note、发布脚本和 tag 计划用的是同一个 fork 版本。如果目标版本或待删文件有歧义，先问维护者再删。

例如：如果 fork 还没发布 `v0.5.6`，就把上游改动并进 fork 的 `v0.5.6` release note，不要引入上游 `v0.6.x` 的 release note 或 tag。

## PR 提交流程

1. 新建普通产品分支，例如 `fix/session-reconnect` 或 `feat/provider-quality-gate`。
2. 安装依赖并完成改动。
3. 为行为变化补测试。
4. 运行相关定向测试。
5. 可选：运行 `bun run hooks:install`，让后续 push 显示非阻塞提醒。
6. 如果要声明 PR-ready/full validation，运行 `bun run verify`。
7. 高风险改动由可信维护者运行 live baseline；外部贡献者记录未运行原因即可。
8. 在 PR 描述里写清楚用户影响、测试命令、覆盖率/质量报告 summary、已知风险。

## 常见问题

### 没有 provider 可以跑吗？

可以。运行影响面检查和它选中的确定性命令：

```bash
bun run check:impact
```

`bun run verify` 也不需要真实模型；只有 live baseline 需要。维护者可以先在桌面端 设置 → 模型配置 添加自己的 provider，再运行：

```bash
bun run quality:providers
```

### provider selector 冲突怎么办？

如果两个 provider 名称生成了相同 selector，`quality:providers` 会退回输出 provider ID。直接复制它给出的 `--provider-model ...` 即可。

### 模型 ID 里带冒号怎么办？

优先使用角色选择，例如：

```bash
--provider-model custom:haiku:custom-haiku
```

脚本会把 `haiku` 解析成本机 provider 配置里的真实模型 ID。
