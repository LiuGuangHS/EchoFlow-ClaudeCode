---
title: 参与贡献与质量门禁
nav_title: 参与贡献
description: 本地安装、影响面检查、质量门禁、测试要求与 PR 提交流程。
order: 14
---

# 参与贡献与质量门禁

这份文档说明本地安装、开发与模块验证，以及 GitHub Actions 上的 PR 和全量门禁。目标是让维护者和贡献者用对应候选的证据回答：这次改动有没有破坏核心 Coding Agent 工作流。

日常工作、授权、安全和验证基本规则统一见[根 AGENTS.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/AGENTS.md)，桌面设计见 [DESIGN.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/DESIGN.md)。产品能力、执行绑定、持久化和外部输入的长期约束见[执行、数据与信任边界](./execution-boundaries.md)。本页维护检查流程和测试设计；任务进度、审计清单及临时验证记录不作为已实现架构发布。

## 环境准备

验证前由执行者完成 preflight：从根 `package.json` 的 `packageManager` 读取预期 Bun 版本，记录实际解析到的可执行文件、版本，以及从仓库启动的嵌套进程是否解析到同一版本；不能只检查 shell alias。版本管理器安装的真实二进制可用，不按 `mise` / `asdf` 目录名拒绝；保留所选 lane 必需的平台工具路径和测试专用 PATH fixture，不盲目清空 PATH。只核对所选 lane 需要的 Node、Rust 工具链及缓存。

依赖安装、工具与缓存准备须在授权范围内显式进行，可以需要网络；确定性检查的执行阶段不得隐式下载缺失工具或自动授予信任。现有 `check:docs` 命令包含已声明的隔离依赖安装，应将该准备阶段与后续确定性构建、检查区分。缺少前置条件时，交接标为 `blocked` / `not run` 并说明补齐方式；自动化失败仍须非零退出，不能改报成功。目前尚无覆盖所有验证入口的统一 preflight；这里是执行要求，不代表已新增强制校验。

根目录运行 `bun install`；涉及 `desktop/` 时在该目录安装依赖。涉及 `adapters/` 或运行 `check:adapters` / `check:native` 时，也在 `adapters/` 安装依赖。CI 的必需 PR job 使用匹配的 Bun 和 `bun install --frozen-lockfile`，不更新锁文件。

选中 harness 检查时，还需 Node `>= 24.9.0`，并单独用 `npm --prefix harness ci` 按独立锁文件准备依赖（可能联网）。准备后运行 `npm --prefix harness test`（现有 Bun 调度不改变 Node 运行时）及独立的 `bun run audit:harness`；必需 audit 失败必须传播。`bun run check:harness` 包含安装与 suite，不含 audit。详见 [harness 工具链说明](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/harness/README.md#工具链)。

首次运行桌面开发版或 `check:native` 前，在 `desktop/` 运行一次 `bun run prepare:cloudflared`。它下载固定版本的官方连接程序、校验 SHA-256，并放入被 Git 忽略的本机缓存；普通用户的安装包已包含该程序。原生检查只验证和使用已有缓存，不会下载；跨平台构建可传 `--target-triple` 选择目标平台。

下载会显示进度，单次最多 10 分钟，连续 60 秒没有进展会中止，临时网络错误最多尝试 3 次。构建命令使用终端的 `HTTPS_PROXY` / `https_proxy`，不会读取桌面应用内的代理设置；需要代理时，在同一终端设置，例如：

```bash
HTTPS_PROXY=http://127.0.0.1:7890 bun run prepare:cloudflared
```

请将示例地址改为自己的 HTTP 代理地址。如果当前网络无法下载，可以从报错中的官方地址下载对应版本和平台的文件，再用 `CC_HAHA_CLOUDFLARED_ARCHIVE=/绝对路径/下载文件 bun run prepare:cloudflared` 导入。离线导入仍会校验固定的 SHA-256，不接受其他版本或未校验的可执行文件。

不要提交本地运行产物，例如 `artifacts/quality-runs/`、`node_modules/`、`desktop/node_modules/`。

## 四层门禁分工

| 层级 | 触发 | 运行内容 | 约束 |
| --- | --- | --- | --- |
| 本地迭代 | 手动 | 最窄的相关测试；`bun run check:impact` 选中的模块检查 | WSL 只做定向/模块验证，不重复云端全量 |
| PR（必过） | `pull_request`，以及合入 `main` 后的 `push` | impact 选中的确定性 lane，含 `check:agent-flow`、`check:agent-e2e`；覆盖率只报告不阻塞 | 无模型、无 provider、无 secret、fork 可跑 |
| 全量 | `nightly-quality.yml` 每天定时（北京时间 03:00）+ 维护者手动触发 | 无路径选择地运行 workflow 列出的确定性检查、独立 macOS Swift 检查和模块图健康度；含 `check:release-surface`、`check:desktop-ui-smoke` | 无模型、无 secret；手动 `skip_coverage` 默认关闭，UI smoke 缺依赖会明确跳过 |
| Release | 维护者手动 `bun run quality:release -- --allow-live --provider-model <selector>:main` | PR checks、baseline catalog/live、native 与当前平台打包 smoke；全量层另行执行，非自动包含其全部检查 | 真实模型需维护者显式授权；不是发布 workflow 本身 |

手动全量统一使用 `nightly-quality.yml`；原 `push-quality.yml` 入口退役，本地 `quality:push` 语义不变。PR 按影响面选择检查；无人触达的检查和整套组合问题交给每日全量层。频率由 `pr-quality-workflow.test.ts` 固定，改频率须维护者决定。真实模型只用于 Release 与明确授权额度的维护者手动 smoke；普通贡献者无需 provider 即可运行 PR 层。

## AI Coding Agent 修复循环

日常诊断、协作及授权以[根规则](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/AGENTS.md)为准；以下是从改动到交付的统一流程。沿真实调用链核对预期、实际结果和日志，区分观察、推测与未知，不从命名推断缺陷；保留校验与错误处理，现有契约不能满足目标时才重设计。

### PR 提交流程

1. 核对已有明确授权是否覆盖将要进行的分支、提交、推送、PR 或合并操作；同范围不重复确认，未覆盖的操作先取得授权。获授权时使用 `fix/session-reconnect` 等普通产品分支。
2. 声明变更面（`desktop`、`mobile`、`server`、`adapter`、`native`、`docs`、`provider/runtime`、`agent-loop` 或 `release`），按[功能质量契约](#功能质量契约)补回归并完成最小修复。
3. WSL 本地先做定向回归，再按[影响面检查](#普通-pr-的影响面检查)运行受影响模块；全量留给 GitHub Actions，不在本地重复，也不默认手动触发云端全量。需要 live 或发布证据时，再满足[Baseline](#真实模型-baseline)或[Release](#release-门禁)的专用前提。
4. 按[证据与失败诊断](#证据与失败诊断)记录候选、命令、summary、报告路径和缺口；用 [PR 模板](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/.github/pull_request_template.md)交付用户影响、变更文件、所补测试、coverage/E2E/live 报告或 blocker、剩余风险，再执行已获授权的提交、推送和 PR 操作。
5. 收集候选对应的 PR Actions 结果。PR-ready/push-ready 须区分「本地模块验证完成，可提交/推送供 CI 验证」与「候选 PR Actions 门禁已通过」；前者不证明可合并，也不授予操作权限。

PR 门禁通过须有候选完整 SHA 对应的 Actions run 链接、最终 `pr-quality-gate` 和所选 job 结果，并记录实际测试的 checkout/merge SHA 与 PR head/base 的对应关系。未提交工作区、后续修改或其他 SHA 不能复用旧 CI 绿灯；尚无对应运行时标为 `not run` / pending。full validation 必须注明范围及 Actions 证据；nightly 只证明该 SHA 的确定性全量，不替代 PR 门禁或 release 的 live、各平台产物、安装/升级及发布验收。

### 普通 PR 的影响面检查

```bash
bun run check:impact
```

`check:impact` 只选范围，不证明行为正确。`scripts/pr/change-policy.ts` 是路由事实来源；路径前缀决定 area 和 blocking 规则，`scripts/pr/module-graph.ts` 的 importer 图只扩大检查选择，不要求为未触达区域补测试。报告的 `## Cross-surface impact` 指明额外检查的 importer。例如 renderer 的工具被 Electron host 引用时会选中 `check:native`，因为 renderer tsconfig 不编译 `desktop/electron/`。图构建失败则告警并选择全部 surface，不静默退回前缀路由。

本地 policy 需要例外判定却缺少可信 PR author 和 base branch CODEOWNERS 时，保持 `blocked`；缺上下文不等于已证实缺审批。不得从 `git user` 或工作区 CODEOWNERS 推断身份、伪造 label 或用 `ALLOW_*` 绕过；保留技术结果，等待可核验的 PR/base 上下文。

### 按改动范围补充测试

运行 impact 输出的模块命令，不逐个运行所有 lane。完整命令以[根 package.json](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/package.json)的 `scripts` 为准，组合与选择见 [modes.ts](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/scripts/quality-gate/modes.ts)；涉及持久化升级须运行 `bun run check:persistence-upgrade`，Electron/sidecar/打包须按 impact 跑 `check:native`，不能用 renderer 检查替代。移动端 `check:mobile` 包含类型、lint、测试及离线 H5 导出，H5/mock 不能替代原生设备证据。

### 本机 Push 前提醒

push 不再自动运行本地质量门禁；`bun run verify` 不是 WSL 默认动作，也不是提交或推送前置条件。只有明确选择额外的本地 PR 验证时才使用下列入口：

| 命令 | 语义 |
| --- | --- |
| `bun run verify` | 等价于 `quality:pr` / `quality:verify`，按 impact 运行 PR lane；所选 coverage 阻塞本地验证，无真实模型，不等于 nightly 全量或 release 验收 |
| `bun run quality:push` | 可选快捷检查，复用 PR impact/policy/路径检查但跳过 coverage，不能替代完整验证 |
| `bun run hooks:install` | 可选安装本机 pre-push hook，只打印非阻塞提醒，不阻止 `git push` |

### PR CI 合并门禁

`pr-quality.yml` 在 PR 的 `opened`、`synchronize`、`reopened`、`ready_for_review`、`labeled`、`unlabeled` 及合入 `main` 后的 push 触发。`scope-plan` 不安装依赖，只生成计划；`policy-enforcement` 独立安装锁定依赖并执行 policy，产品 job 只依赖 `scope-plan`，避免 policy 失败吞掉产品结果。标签例外只在 PR 判断，不在 main 上重复阻塞。

`pr-quality-gate` 要求 `scope-plan`、`policy-enforcement` 成功，并逐项核对阻塞 job：选中的必须 success，未选中的必须 skipped，cancelled 或缺失都失败。提示性的 `coverage-checks` 独立报告，不在 gate 的 `needs` 内，也不等待它结束（见[覆盖率策略](#覆盖率策略)）。server/desktop 的 `--shard=<i>/<n>` 合起来仍跑完整检查，desktop 第一片 lint、最后一片 build；任一分片失败即 job 失败，本地和每日全量不分片。

`main` 的分支保护要求 `pr-quality-gate`，管理员同样适用，发布也走 PR。个人 CODEOWNER 作者可免 `allow-cli-core-change`；作者身份和 CODEOWNERS 必须取可信 PR/base，其他贡献者改 CLI 核心仍需维护者标签，其他例外不变。必需 PR job 离线、无 provider/secret/付费服务、fork 可跑；`pull_request_target` 只用可信 base 检查元数据，不执行 PR head、不安装其依赖或向其暴露 secrets。更改 workflow 不授权更改分支保护或仓库设置。

## 功能质量契约

新功能、bugfix 和行为变化均须交付可验证证据，人和 AI Coding Agent 同样适用：

- 可执行 JS/TS 生产改动同 PR 带同区域测试。`change-policy.ts` 分别检查 `desktop/src/`、`src/server/`、其余 `src/` 和 `adapters/`；只有维护者确认不适合自动化并显式加 `allow-missing-tests` 才可例外。文案/CSS 不单独要求新增测试，仍须完成 impact 检查。
- 纯逻辑用单测；server/API/provider/runtime 用 API 或 request-shape 测试；桌面 UI/store/API 用 Vitest/Testing Library；跨 UI、WebSocket、provider proxy、native sidecar 或发布打包的用户流程补 E2E/桌面 smoke。
- agent loop、工具、provider 路由、模型选择、文件编辑、权限、恢复及桌面聊天必须在 PR 中有 mock/fixture 契约（见[无模型门禁](#无模型的端到端-agent-门禁)）；不能用 live 替代确定性回归。

### 回归测试设计

缺陷先 **RED → GREEN → 重构**：通过真实入口补最小回归，确认因目标缺陷而非环境/fixture 失败，再最小修复；通过后才能重构。无法复现就记录输入、环境、观察与缺口，不把一直通过的测试称为复现或已证实修复。同区域测试文件只是最低信号，还须证明行为：

- **驱动状态迁移。** 用 `handleServerMessage`、真实 store action 或用户事件产生状态，不用 `setState` 写出迁移结果；初始化 fixture 仍可直接设置。
- **断言行为不变量。** 验证数据属于哪个会话/模型，不抄当前屏幕字符串；输入和预期来自行为契约，不为掩盖失败改预期。
- **覆盖丢弃与保留。** 去重、合并、过滤均验证两个方向；消息拦截 replay、保留真实重复，透传 `uuid` / `toolUseId` 等上游身份，不靠文本猜测。
- **验证跨边界连接。** 从真实入口经调用方和依赖断言最终可观察行为，不 mock 被测模块；server/store/component 各自通过不等于消息驱动 UI。
- **验证失败与恢复。** 按风险覆盖错误、超时、取消、重试/重连，断言失败状态、资源清理与恢复可用，且不重复已接受副作用、不越过权限。
- **保护旧兼容。** 旧 key/路径/marker 行为受影响时补证据，不因名字陈旧删除；迁移用旧 fixture 验证部分失败重试，以及成功后用户主动清除偏好、重启不再被旧数据恢复。这是测试要求，不是修复声明。

### 覆盖率策略

生成物/构建产物不计产品覆盖率，维护区域逐步达到 75-80%+，新增/变更可执行生产行满足 `coverage-thresholds.json` 的 changed-line 门槛。baseline 在 `scripts/quality-gate/coverage-baseline.json`；CI 优先比较 base branch baseline，不允许下降超出窗口。修改 baseline/threshold 必须有维护者 `allow-coverage-baseline-change` 和原因，不为过门禁降标准；历史低覆盖是技术债，新 PR 至少要让触达区域更好。

本地 `bun run verify` 的所选 coverage lane 是阻塞项，失败即本地验证失败；托管 PR 的 `coverage-checks` 则是提示项，不阻塞合并。它仍执行源码覆盖率统计、baseline ratchet、75-80%+ 目标差距报告及 changed-line coverage，提示性不等于可忽略失败。采集边界和诊断见[证据与失败诊断](#证据与失败诊断)。

#### 覆盖率参考

- [Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html)：60% acceptable、75% commendable、90% exemplary；changed/per-commit 90% 是合理下限。
- [Microsoft Visual Studio / Azure DevOps](https://learn.microsoft.com/en-us/visualstudio/test/using-code-coverage-to-determine-how-much-code-is-being-tested)：通常目标约 80%，典型要求可为 75%，生成代码可放宽。
- [ChromiumOS EC](https://chromium.googlesource.com/chromiumos/platform/ec/+/main/docs/code_coverage.md)：新增/变更行至少 80%。

### 无模型的端到端 Agent 门禁

```bash
bun run check:agent-flow       # 真实 server + 真实 WebSocket + mock CLI
bun run check:agent-e2e        # 真实 server + 真实 CLI agent 循环 + mock LLM，再跑一遍录制回放
bun run check:agent-replay     # 只跑录制回放
bun run check:desktop-ui-smoke # 真实桌面 UI + 真实权限对话框 + mock CLI
```

四条通道都不需要 provider、凭据或公网。

`check:agent-e2e` 只假一个模型：本机回环起一个 Anthropic 兼容端点（`scripts/quality-gate/mock-llm/`），通过桌面端「新增服务商」同一个 API 注册成 provider，真实 CLI 照常跑 agent 循环、真实工具改真实（临时）磁盘。脚本化模型对自然语言提示做出模型式的反应，所以它和 `check:agent-flow:live` 共用同一份场景（`agent-flow/liveScenarios.ts`）：mock 证明管线，live 证明真模型也落到同样结果。另有只有 mock 能确定性断言的场景——工具输出真的回传给了模型（nonce 核对）、拒绝授权以错误结果回到模型、停止生成真的掐断了上游连接、上游报错后会话还能继续。改 agent 循环、工具、权限、provider 接线时，新增行为优先在这里加场景，而不是只写单元测试。

手写 mock 不能代表全部上游形态，因此 `check:agent-e2e` 还会跑流量回放（`scripts/quality-gate/replay/`）：维护者用真实的 DeepSeek Flash 把场景跑一遍，把上游流量录制成 `cassettes/*.json` 提交进仓库；CI 用回放服务器把这些录制流量原样喂给真实 server 和真实 CLI，不联网、不需要凭据。录制保留 thinking/签名、工具参数分片与并行、失败恢复、大输出、子 Agent/Teams、MCP、图片、自动/手动压缩、中断、中文和经 proxy 转换的 OpenAI Chat 流；具体场景由 `scripts/quality-gate/replay/` 的 catalog 维护。

- **匹配规则**：请求按队列依次对应录制流量。每个 agent 循环（主 agent、子 Agent、团队成员）按启动它的第一条用户消息各自成一个队列，严格比对模型、stream、最后一条消息的角色、用户输入文本，以及工具结果是否正好回应上一轮的工具调用（并行工具按完成顺序回传，只比对集合）；对不上就返回 400 `replay_mismatch`，并在 `artifacts/agent-e2e/replay/<format>/<id>.report.json` 写出字段级差异。标题这类不带工具的旁路请求尽量回放，录制流量里没有就给占位回复，不判失败。
- **运行时差异**：临时工作目录、沙箱配置目录、项目目录名、会话 ID、日期和临时目录在录制流量里存成 `{{WORK_ROOT}}` 这类占位符，回放时换成本次运行的值；路径被切进多个分片也能正确还原。应用按时钟现生成、回复又必须原样引用的值（例如团队成员关停请求的 ID）存成 `{{V1}}` 这类学习位，回放时从第一个带它的请求里学到本次的值，再填进后面的回复。Agent Teams 的消息合并依赖时序，这个场景按录制时的模型延迟和流速回放，其余场景压缩回放节奏。
- **漂移**：工具列表或 `max_tokens` 变了但流程仍能对上时，只写进 `drift.md` 提醒，不判失败。系统提示词和工具 schema 带操作系统、shell 和日期，录制机器和 CI 本来就不同，不参与比对。
- **重录**：行为确实变了（例如改了 prompt 导致模型走了不同的工具路径），在本机运行 `bun run quality:record-cassettes -- --allow-live --only <id>`。它从桌面端已保存的 DeepSeek provider 读取 key，只放在录制代理的内存里，沙箱拿到的是假 key；录完会立刻回放一次自检，录制流量里出现 key、真实 home 路径或临时目录路径会直接拒收。录制需要真实额度，永远不进 CI。

`check:agent-flow` 覆盖新建 Session → 选运行时 → 首轮流式 → 工具调用 → 权限批准/拒绝 → 工具失败 → API 错误 → 中断 → 断线重连权限重放 → 会话恢复。`check:desktop-ui-smoke` 在真实浏览器里点真实的 Allow 按钮，需要 `agent-browser` 与已安装的 desktop 依赖，缺失时会打印原因并跳过。

`agent-browser` 只属于这条已提交的 lane（在 Linux CI 上以 headless 方式运行）以及维护者手动执行的 `desktop/scripts/e2e-*-agent-browser.sh`。临时的浏览器操作（手动验证、截图、探索性 UI 检查）请走 `ego-browser` skill，不要因为仓库里出现 `agent-browser` 就把它当通用浏览器工具。

所有会启动真实 server 的 quality-gate lane 都跑在沙箱配置目录里（`scripts/quality-gate/sandbox.ts`），并在结束时校验没有写过开发者真实的 `~/.claude`；写了就判定 lane 失败。

## 证据与失败诊断

验证证据须绑定候选：完整 Git SHA、dirty diff 及相关未跟踪源码的内容指纹，并记录环境（OS/架构、工具版本与路径）、实际命令、退出状态、最终 summary 和日志；发布产物还须记录 SHA-256。相关源码、依赖或环境变化会使受影响的旧证据失效。交接明确区分 `passed`、`failed`、`skipped`、`blocked`、`not run`；运行未完成、缺最终 summary 或后台任务状态不明均不是 `passed`。共享证据须脱敏，不暴露凭据、用户配置、完整 transcript 或上游响应体。

主报告 `artifacts/quality-runs/<timestamp>/report.md` / `report.json` 内嵌范围、结果矩阵和 coverage 摘要，链接同目录的 `junit.xml`、`logs/*.log` 及 `artifacts/coverage/<timestamp>/coverage-report.md` / `.json`。

当前 quality runner 在 lane 执行前后采集 `candidate.before` / `candidate.after`：完整 HEAD、HEAD→index 的 `indexDiffSha256`、index→worktree 的 `worktreeDiffSha256`，以及非 ignored 未跟踪文件的 `untrackedSha256`（按原始文件名字节排序，包含路径、权限、类型及内容身份；符号链接只记录链接目标字节，不跟随读取）。读取或 Git 失败的端点标记为 `unknown`，不是干净候选。`candidate.status` 为 `stable`、`changed` 或 `invalid`；`candidate.failures` 独立于 lane 计数，候选变化或未知会使总体 `status` 与 CLI 退出失败，JSON、Markdown 和 JUnit 也保留此失败，即使所有 lane 通过。

这些字段在 schema version `1` 中为兼容旧报告而可选；旧报告没有字段不代表已证明候选稳定。`runtime` 记录 runner 自身的名称、版本、可执行文件、`argv`、平台与架构，不推断子工具版本。端点相等不能发现中途修改后恢复，采集也不是原子快照。没有自动跨运行缓存或覆盖所有入口的强制 preflight；额外工具版本、包哈希和平台证据仍需执行者记录。

Lane 的 `signalCode` 会写入日志和报告。executor 抛错时追加错误证据、保留已有部分日志、记录失败 lane，并继续后续 lane；不要仅凭“有日志”判断已完成。runner 本身强制终止或产物写入失败时，不保证能生成最终报告。

需要诊断失败时，按失败类型查阅相应证据：

| 失败类型 | 证据与处理 |
| --- | --- |
| Lane 失败 | `artifacts/quality-runs/<timestamp>/report.md` 的 Summary / Result Matrix，以及 `logs/<lane>.log` |
| Path-aware PR checks | 核对同区域测试、CLI core 和 coverage policy；维护者 override 需要明确决定 |
| Coverage gate | `artifacts/coverage/<timestamp>/coverage-report.md` 或 `.json`；修复 `changedLines.failures` / `failures`，`targetGaps` 是技术债提示。缺少测试发现结果、最终 summary 或预期 LCOV 属于采集失败，不据此推断产品缺陷或覆盖率不足；查日志定位，不改变现有 blocking 策略 |
| 构建、类型、lint、文档或 native | 修复对应日志指出的本次变更问题，重跑受影响检查 |

Coverage 控制台以 `[coverage]` JSON 输出阶段开始/结束。开始事件给出执行中的隔离 `capturePath`；结束后读持久化 `logPath` 和 `${logPath}.process.json`，临时 capture 通常会被清理。process JSON 记录命令、cwd、起止时间、耗时、实际 `exitCode`（未知为 `null`）、`signalCode`、可选 `error` 及 runner 自身 runtime。spawn/wait 异常先保留部分输出和诊断再清理、抛回原异常；不要因长时间没有最终摘要就重复启动同一检查。

Root coverage 保留既有 instrumentation 例外：普通非零 assertion exit 只有在测试文件发现/完成、最终 summary 和单进程 LCOV 完整可用时，才接受覆盖率并记录 note；原始断言失败并未消失，correctness 仍由独立 `check:server` 保证。signal、执行异常或未知退出不适用该例外；signal 即使伴随 exit 0 或 `lcovAvailable: true` 仍失败。`lcovAvailable` 对 root 独立记录，不等于 suite 成功；adapters/desktop 不评估此字段。

Changed-line 数字必须连同 `changedLines.scope` 阅读：它记录 `strategy`、可选 `baseRef` / `diffArgs`、`includes`（committed/staged/unstaged/untracked）和可选 `error`，不改变选择或评分。

| Strategy | 实际比较 | 包含 | 不包含 |
| --- | --- | --- | --- |
| `explicit-base` | `<base>...HEAD` | 已提交差异 | 暂存、未暂存、未跟踪 |
| `dirty-worktree` | `HEAD` | 暂存和未暂存差异 | 分支已提交差异、未跟踪 |
| `branch-fallback` | `origin/main...HEAD` | 已提交差异 | 暂存、未暂存、未跟踪 |
| `none` | 未选择 diff | 无 | 所有变更类型 |

Dirty fallback 仍只在存在未暂存 tracked 改动时触发；staged-only 可能选择 branch fallback，或在 main 上没有 diff。dirty coverage 不是整条分支覆盖率。diff/scope 采集失败会注明 unknown，但现有 empty-fallback 评分未改变；此时零行不证明没有变更，也不能宣称全分支达标。

覆盖率采集还有边界：`desktop/vitest.config.ts` 只采集 `src/**`，不包含 Electron main process。仓库现有 Bun coverage baseline 中分支总数为 0，`coverage.ts` 把 `0/0` 显示为 100%；这不代表测到了全部分支。查看当前配置和报告，不把历史覆盖率数字当作新改动的证明。

### 门禁红了怎么办

- **本次行为变化导致失败**：先修复回归；只有预期行为确实改变才在同 PR 更新断言并说明原因，不改预期掩盖缺陷。
- **无关既有失败**：对照 `main` 最近的 PR Quality（push）和全量；另开修复 PR 须获授权，不能立即修复就报告 blocker，不绕过必需 lane。Quarantine 仅供维护者 baseline/release 追踪，`check:quarantine` 审计 owner/到期日，不豁免普通 PR，也不隐藏确定性 provider/chat 契约。
- **偶发失败**：`check:server` 单独重跑失败文件，`FLAKY`（重跑过）和 `FAILED`（仍失败）都使门禁失败；重跑用于诊断，修复竞态，不加长超时或放宽断言掩盖。隔离是最后手段，须记录原因和 owner。
- **门禁需调整**：同步修改 `change-policy.ts`、workflow 和对应测试，运行 `check:policy`，有 `actionlint` 时也运行；保持 `pr-quality-gate` 名称和 blocking 语义，不擅改仓库保护。

## 维护 Agent 指导

第一方规则从[根 AGENTS.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/AGENTS.md)按领域链接；个人偏好放用户级指导，不覆盖仓库约束。共享指导适配不同模型，能力升级后核对重复流程和宽泛停止条件，但不跳过安全/CI 契约。领域规则、实现和示例只维护最近的一处权威来源；复杂操作用 skill，描述仅说明适用任务和必要区分，多工作流用短路由，细节放正文/引用，不堆触发关键词。

模块 README 说明职责/非职责、入口、依赖、数据归属和开发验证命令，链接设计而不复制总仓规则或保存任务日志；触达时核对实现并修范围内缺口，不批量重写无关模块。模型默认值、工具格式、压缩行为等实现说明先核对源码。

可复现失败/规则冲突按有界闭环处理：最小行为回归 → 共享实现修复 → 选中检查 → 最近一处权威规则；文档字符串测试不能替代行为证据。区分要求、已实现的权限/hook/CI 强制检查及待做工程；必须零例外执行的规则应由适用权限、hook 或 CI 落实，自然语言不是强制门禁，新增自动化仍须遵守配置与授权边界。只改用户请求的范围，不自主扩权限、降门槛、退役行为、改全局配置或新增无止境循环/任务账本。

## 真实模型 Baseline

`quality:baseline` 用来跑真实 Coding Agent 任务：启动本地服务端、创建隔离 fixture、让模型通过聊天修代码、跑测试，并保存 transcript、diff、verification log 和报告。它还会对 provider 进行 live smoke：已保存或当前激活的 OpenAI-compatible provider 会验证连通性、proxy 转换和流式 proxy 结果；env-only provider smoke 只验证上游连通性和转换管线。

普通 PR 不要求 live。维护者运行真实 smoke/baseline 前，须先通过确定性检查；本节专用前提还包括显式 `bun run verify` 通过（含所选阻塞 coverage）、provider 使用范围明确及额度授权，不能将它推广为普通提交/推送前提。机器上找到 provider 不等于获授权。默认命令不会调用真实模型：

```bash
bun run quality:baseline
```

要真正跑模型，必须显式加 `--allow-live` 并选择本机 provider。

先列出本机可用 provider 和可复制参数：

```bash
bun run quality:providers
```

复制输出中的 `--provider-model` 参数（不要猜 UUID/模型 ID）：

```bash
bun run quality:gate --mode baseline --allow-live --provider-model <provider>:<model-or-role>:<label>
```

如果只需要跑 provider smoke 和桌面 agent-browser smoke，而不跑全部 baseline case，可以使用：

```bash
bun run quality:smoke --provider-model <provider>:<model-or-role>:<label>
```

一次运行多个模型时重复 `--provider-model`。selector 来自桌面「设置 → 服务商」的本机配置，贡献者可用自己的 provider，无需维护者 UUID 或供应商。名称冲突时 `quality:providers` 输出 provider ID；模型 ID 含冒号时优先用角色，例如 `--provider-model custom:haiku:custom-haiku`，由脚本解析实际 ID。

未保存 provider 时可用一次性环境变量跑 unsaved provider smoke；不得把真实 key 写入命令历史、日志或共享报告：

```bash
QUALITY_GATE_PROVIDER_BASE_URL=https://example.com \
QUALITY_GATE_PROVIDER_API_KEY=... \
QUALITY_GATE_PROVIDER_MODEL=model-id \
QUALITY_GATE_PROVIDER_API_FORMAT=openai_chat \
bun run quality:gate --mode baseline --allow-live
```

### 什么时候必须跑 Baseline

以下改动在满足上述专用前提后，建议由可信维护者补跑 live baseline：

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

`quality:release` 是 release 模式的别名，真实调用仍需显式 `--allow-live` 和维护者额度授权。release 模式会组合 PR checks、baseline catalog、live baseline、native checks，并用当前平台 canonical release artifact 跑 `package-smoke --package-kind release`，但不等于运行全量层的全部检查。发版报告同样写入 `artifacts/quality-runs/<timestamp>/`。发布 workflow 另有下列确定性门禁，不自动调用手动 live release gate。

`release-desktop.yml` 不直接调用 `bun run verify`，但有发布门禁：`verify-governance`（`check:policy`、`check:product-identity`、`check:upstream-content`）、`verify-runtime`（`check:server`、`check:agent-flow`、`check:adapters`）和 `verify-desktop`（`check:desktop`、`check:persistence-upgrade`）汇入 `release-verify-gate`。`publish-release` 同时依赖构建矩阵与该汇总门禁，任一验证组不成功就不能发布。各 job 绑定同一 release SHA；这不是完整 `verify`、全量层或手动 live release gate 的替代品。`scripts/pr/release-workflow.test.ts` 分别守卫不直接调用 `verify` 和实际发布依赖。

发布证据应按目标 OS/架构区分以下层次，不能互相替代：

| 证据层 | 证明范围 |
| --- | --- |
| 源码 / 构建 | 指定候选的测试、类型检查与构建；不证明分发包可运行 |
| 包结构 | 指定产物的 metadata、资源、sidecar 与更新文件；静态或跨平台检查不证明原生启动 |
| 原生打包运行 | 在匹配 OS/架构上运行真实分发包，验证主程序、sidecar 和关键用户路径；mock 或本地 Electron 开发 smoke 不替代 |
| 安装 / 升级 / 数据保留 | 真实安装及从受支持旧版本升级，验证用户数据、自定义目录和设置保留 |
| 签名 / 公证 / 启动策略 | 按平台及明确选择的发布模式验证签名、公证和 Gatekeeper；允许注明限制的未签名 macOS / Windows 包，未签名不等于签名验收通过 |

每层按[通用证据要求](#证据与失败诊断)记录候选、目标和产物 SHA-256，关联到实际发布的同一产物；重建或签名改变字节后须重新关联并验证受影响证据。下方平台矩阵仍全部受支持，不能用单一平台结果代替其他目标，也不能静默移除目标。`skipped`、`UNEXERCISED`、`blocked` / `not run` 不证明相应路径已覆盖；合法的不相关 skip 仍允许，这不改变 lane 状态或现有 blocking 规则。

发布前用待发布的同一产物完成适用的原生启动、安装、旧版升级/数据保留及签名/公证验证；不要求尚未发布的候选已经出现在正式更新源中。正式发布后再验证旧版经线上 metadata、下载、安装和重启的真实更新链路（见下文），这项发布后证据不能倒写成发布前已经通过。

当前 release workflow 不是按目标汇总全部原生运行、安装和升级证据的总门禁；文档要求不代表已新增此自动化，也不改变发布策略或授权。release 模式下 live lane 不允许静默跳过。缺少 provider、真实模型额度或外部账号时，门禁会失败，并要求在发版记录里明确 blocker。

## 发版与自动更新

桌面端版本号的唯一来源是 `desktop/package.json`。正式发布要求版本号、Git tag 和 `release-notes/vX.Y.Z.md` 三者严格一致。移动端使用独立版本线，`mobile/package.json` 与 `mobile/app.json` 的版本必须彼此一致，不要求与桌面端相同。

应用内更新由 `electron-updater` 驱动，产物托管在 GitHub Releases：

| 平台 | 安装/更新目标 | Metadata |
|---|---|---|
| macOS arm64 / x64 | `dmg` 安装；signed 模式的 `zip` 供 Squirrel.Mac 更新，unsigned 模式手动更新 | 仅 signed 模式发布 `latest-mac.yml` |
| Windows x64 / ARM64 | NSIS `.exe` | `latest.yml` |
| Linux x64 | `.AppImage` 自动更新，`.deb`、`.rpm` 供手动安装 | `latest-linux.yml` |
| Linux arm64 | `.AppImage` 自动更新，`.deb`、`.rpm` 供手动安装 | `latest-linux-arm64.yml` |

Release workflow 先在各平台 matrix 里生成 `latest*.yml`，把同名 metadata 临时改名为 `latest-<platform>.yml`，最后由 `scripts/release-update-metadata.ts` 合并回 electron-updater 期望的标准文件名。不要改成各 matrix job 直接发布 GitHub Release，否则 metadata 会互相覆盖。

### 产物命名

文件名以 `desktop/package.json` 的 `build.artifactName` 和 release workflow 的逐平台资产清单为准，前缀为 `EchoFlow-Code-<版本>`。macOS 使用 `-mac-arm64` / `-mac-x64` 加 `.dmg` 或自动更新用的 `.zip`；Windows 使用 `-win-x64.exe` / `-win-arm64.exe`。Linux x64 按格式分别使用 `-linux-x86_64.AppImage`、`-linux-amd64.deb`、`-linux-x86_64.rpm`；Linux ARM64 分别使用 `-linux-arm64.AppImage`、`-linux-arm64.deb`、`-linux-aarch64.rpm`。不要假定 electron-builder 的 `${arch}` 在不同 Linux 格式中拼写相同。

改名时有三条硬约束，`scripts/pr/release-workflow.test.ts` 会按 electron-updater 的挑包逻辑逐一验证：

- `latest.yml`、`latest-mac.yml`、`latest-linux.yml`、`latest-linux-arm64.yml` 是已安装客户端写死请求的文件名，不能改。
- Mac zip 名里，Apple 芯片的必须含 `arm64`，Intel 的不能含 `arm64`；否则 Apple 芯片的机器会被「更新」成 Intel 版。
- 两个 Windows 安装包共用一份 `latest.yml`，updater 按名字里的 `x64` / `arm64` 选包；少了这两个词，ARM 设备会装上 x64 版。

`.blockmap` 随 macOS 和 Windows 产物一起作为 Release 资产发布，构建机上也会用它跑 package-smoke。差分下载默认关闭；只有显式启用且下载源通过差分契约验证时才使用，否则完整下载，具体判定见 `desktop/electron/services/updater.ts`。Windows 安装包签名后由 `scripts/refresh-windows-update-metadata.ts` 重建 blockmap 并校验其结构与最终安装包一致，发布流程会核对各架构 blockmap 与 `latest*.yml` 的版本一致性。Release 不附 `install-macos-unsigned.sh`，不通过脚本移除隔离属性或关闭系统保护。unsigned macOS 包仍生成更新文件用于包结构检查，但不向公开更新源发布 macOS channel metadata；保留的 ZIP / blockmap 不是自动更新可用的证明。

### 签名 Secrets

macOS 通过 `macos_signing` 明确选择 `unsigned` 或 `signed`，默认 `unsigned`；Release Please 调用时采用仓库变量 `MACOS_SIGNING_MODE`（未设置时为 `unsigned`）。不按凭据是否存在静默降级。unsigned 不包含 Developer ID 签名与 Apple 公证，系统可能提示或阻止安装、启动；现有原生组件验签保持不变，因此 Computer Use 不可用，更新须手动下载安装。发布说明必须披露这些限制。

选择 signed 时，保留完整签名、公证及启动策略门禁，缺少配置直接失败。macOS 的签名与公证依赖以下 GitHub Actions repository secrets：

```text
MACOS_CERTIFICATE
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`MACOS_CERTIFICATE` 是 Developer ID Application `.p12` 的 base64 内容。项目不发布 `.pkg`，不需要 Developer ID Installer 证书。

Windows 签名走 SignPath，审批通过前默认关闭：tag 推送、手动正式发布和手动草稿都会产出未签名的 Windows 安装包，自动更新照常可用，只是用户可能看到 SmartScreen 提示。开关是仓库变量 `WINDOWS_SIGNING_ENABLED`：

- 未设置或不为 `true`：Windows 不签名，preflight 只打一条 notice。
- 设为 `true`：要求 `SIGNPATH_*` 变量和 `SIGNPATH_API_TOKEN` 齐全，非草稿发布缺配置时拒绝发布。
- 手动运行 `Release Desktop` 时，`windows_signing` 输入可以临时改写：`auto` 跟随变量，`unsigned` 本次不签，`signed` 本次一定签（配置不全直接失败），用来在打开变量前先拿草稿试签。

打开签名前，先把 SignPath 后台的 installer artifact configuration 改成和 `.github/signpath/windows-installer.xml` 一致（匹配 `EchoFlow-Code-*-win-*.exe`），再用草稿试签一次。只要还可能发布未签名的 Windows 包，就不要在 `desktop/package.json` 里加 `publisherName` 或 `verifyUpdateCodeSignature`：加了之后，用该配置构建的客户端会拒收之后所有未签名的更新，而且无法自愈。

application artifact configuration 也须与 `.github/signpath/windows-application.xml` 同步：除主程序与 sidecar，还包含从源码构建的 `agent-desktop.exe`。签名开启时，工作流会送签、恢复并验证这三个可执行文件后再制作安装包。添加原生运行组件后，应先同步 SignPath 后台配置并进行草稿试签；仅签安装包不会给内部的运行组件补签。

### 发版前检查

```bash
bun run scripts/release.ts <version> --dry
bun test scripts/pr/release-workflow.test.ts scripts/release-update-metadata.test.ts scripts/quality-gate/package-smoke/index.test.ts
bun run check:policy
```

正式执行 `bun run scripts/release.ts <version>` 前，先确认对应的 `release-notes/v<version>.md` 已经存在，并核对当前已有授权是否覆盖创建分支和提交的副作用；只有未覆盖时才补充确认。非 dry-run 会创建 `release/vX.Y.Z` 分支并提交版本与 release notes，不创建 tag、不推送、不发布；默认只更新桌面版本，只有显式传入 `--mobile <patch|minor|major|x.y.z>` 才同时递增独立的移动版本。

### 发版步骤

`main` 受分支保护：`pr-quality-gate` 必须通过，管理员也不例外。正式发布只由可信的 `Release Please` 工作流授权：它验证 tag 和 commit 后，以 `official_release: true` 调用 `Release Desktop`。不要把直接推送 tag 当作正式发布流程。

1. 按当前 Release Please 配置准备版本变更，并通过 PR 合入 `main`。如使用 `bun run scripts/release.ts <version>` 辅助更新版本，需先准备对应的 release notes；脚本会创建版本更新分支并提示如何提交 PR。
2. `Release Please` 在 `main` 更新后生成/验证正式 release tag，并调用 `Release Desktop` 构建与发布。需要确认实际运行的是 `.github/workflows/release-please.yml` 发起的 official release，而不是仅由 tag push 触发的构建。
3. `bun run scripts/release.ts --tag <version>` 只会在本地创建 tag，不会发布正式版本；即使推送该 tag，也不会替代 Release Please 的官方发布授权。只有 Release Please 发起的发布在发布前失败时，才按维护者流程重跑并保留授权边界。Release 一旦发布，任何运行都会在 preflight 被拒绝，避免覆盖用户正在下载的安装包。

### 验证一条真实更新链路

这是正式发布后的更新链路验收，不是要求候选先发布才能运行的发布前门禁；发布前的包和安装/升级验证仍按上文执行。每次发版至少验证一次从上一个正式版升上来的完整路径：

1. 安装 GitHub Release 里的上一个正式版。
2. 按上述 Release Please 正式发布流程发布候选版本，并确认其授权调用的 `Release Desktop` workflow 完整通过；不要直接推 tag 替代正式发布授权。
3. 打开旧版本，等待启动后的自动检查，或在设置里手动检查更新。
4. 确认提示新版本，下载完成后安装并重启。
5. 重启后确认「关于」里的版本号正确，且服务商、会话、Skills、Agents、记忆、自定义宠物和自定义数据目录仍然可用。
6. 确认历史附件上下文、子 Agent 详情和任务状态可以恢复；打开桌宠，验证悬浮窗口与当前会话导航。

各平台的重点不同：macOS signed 模式要确认 release job 走的是签名产物且启动策略检查通过；unsigned 模式不验收自动更新，而应验证手动安装升级及数据保留，记录系统提示和 Computer Use 不可用的限制；Windows 要确认 `latest.yml` 和 `-win-x64.exe` / `-win-arm64.exe` 两个安装包都在 Release 资产里，未签名时的 SmartScreen 提示不代表 updater 失败；Linux 优先用 AppImage 验证自动更新，`.deb`、`.rpm` 只作手动安装包发布。

## 常见问题

### 没有 provider 可以跑吗？

可以，按[影响面检查](#普通-pr-的影响面检查)运行确定性命令；`verify` 也不调用真实模型。只有明确授权的 live 才需要 provider，见[真实模型 Baseline](#真实模型-baseline)。

### provider selector 冲突怎么办？

复制 `quality:providers` 的输出，不手工猜 selector；冲突回退和角色选择见[Baseline 参数说明](#真实模型-baseline)。

### 模型 ID 里带冒号怎么办？

使用 [Baseline](#真实模型-baseline) 中的角色 selector 示例。
