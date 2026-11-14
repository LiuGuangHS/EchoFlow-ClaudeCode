---
title: 参与贡献与质量门禁
nav_title: 参与贡献
description: 本地安装、影响面检查、质量门禁、测试要求与 PR 提交流程。
order: 14
---

# 参与贡献与质量门禁

这份文档说明贡献代码前应该如何在本地安装、开发、测试和运行质量门禁。目标是让维护者和贡献者都能在提交 PR 前回答一个问题：这次改动有没有破坏核心 Coding Agent 工作流。

产品能力、执行绑定、持久化和外部输入的长期约束见[执行、数据与信任边界](./execution-boundaries.md)。本页维护检查流程和测试设计；任务进度、审计清单及临时验证记录不作为已实现架构发布。

## 环境准备

验证前由执行者完成 preflight：从根 `package.json` 的 `packageManager` 读取预期 Bun 版本，记录实际解析到的可执行文件、版本，以及从仓库启动的嵌套进程是否解析到同一版本；不能只检查 shell alias。版本管理器安装的真实二进制可用，不按 `mise` / `asdf` 目录名拒绝；保留所选 lane 必需的平台工具路径和测试专用 PATH fixture，不盲目清空 PATH。只核对所选 lane 需要的 Node、Rust 工具链及缓存。

下面的依赖安装、工具与缓存准备是显式 setup，可以需要网络；确定性检查的执行阶段不得隐式下载缺失工具或自动授予信任。现有 `check:docs` 命令包含已声明的隔离依赖安装，应将该准备阶段与后续确定性构建、检查区分。缺少前置条件时，交接标为 `blocked` / `not run` 并说明补齐方式；自动化失败仍须非零退出，不能改报成功。目前尚无覆盖所有验证入口的统一 preflight；这里是执行要求，不代表已新增强制校验。

在项目根目录显式安装依赖：

```bash
bun install
```

如果改动涉及 `desktop/`，也安装桌面端依赖：

```bash
cd desktop
bun install
```

首次运行桌面开发版或 `check:native` 前，在 `desktop/` 运行一次 `bun run prepare:cloudflared`。它下载固定版本的官方连接程序、校验 SHA-256，并放入被 Git 忽略的本机缓存；普通用户的安装包已包含该程序。原生检查只验证和使用已有缓存，不会下载；跨平台构建可传 `--target-triple` 选择目标平台。

下载会显示进度，单次最多 10 分钟，连续 60 秒没有进展会中止，临时网络错误最多尝试 3 次。构建命令使用终端的 `HTTPS_PROXY` / `https_proxy`，不会读取桌面应用内的代理设置；需要代理时，在同一终端设置，例如：

```bash
HTTPS_PROXY=http://127.0.0.1:7890 bun run prepare:cloudflared
```

请将示例地址改为自己的 HTTP 代理地址。如果当前网络无法下载，可以从报错中的官方地址下载对应版本和平台的文件，再用 `CC_HAHA_CLOUDFLARED_ARCHIVE=/绝对路径/下载文件 bun run prepare:cloudflared` 导入。离线导入仍会校验固定的 SHA-256，不接受其他版本或未校验的可执行文件。

如果改动涉及 `adapters/`，或者要运行 `check:adapters` / `check:native`，安装 adapter 依赖：

```bash
cd adapters
bun install
```

不要提交本地运行产物，例如 `artifacts/quality-runs/`、`node_modules/`、`desktop/node_modules/`。

## 四层门禁分工

| 层级 | 触发 | 运行内容 | 约束 |
| --- | --- | --- | --- |
| 本地迭代 | 手动 | 最窄的相关测试；`bun run check:impact` 选中的命令 | 秒级反馈 |
| PR（必过） | `pull_request`，以及合入 `main` 后的 `push` | impact 选中的确定性 lane，含 `check:agent-flow`、`check:agent-e2e`；覆盖率只报告不阻塞 | 无模型、无 provider、无 secret、fork 可跑 |
| 全量 | `nightly-quality.yml` 每天定时（北京时间 03:00）+ 维护者手动触发 | 无路径选择地运行 workflow 列出的确定性检查、独立 macOS Swift 检查和模块图健康度；含 `check:desktop-ui-smoke` | 无模型、无 secret；手动 `skip_coverage` 默认关闭，UI smoke 缺依赖会明确跳过 |
| Release | 维护者手动 `bun run quality:release -- --allow-live --provider-model <selector>:main` | PR checks、baseline catalog/live、native 与当前平台打包 smoke；全量层另行执行，非自动包含其全部检查 | 真实模型需维护者显式授权；不是发布 workflow 本身 |

`release-desktop.yml` 不直接调用 `bun run verify`，但有发布门禁：`verify-governance`（`check:policy`、`check:product-identity`、`check:upstream-content`）、`verify-runtime`（`check:server`、`check:agent-flow`、`check:adapters`）和 `verify-desktop`（`check:desktop`、`check:persistence-upgrade`）汇入 `release-verify-gate`。`publish-release` 同时依赖构建矩阵与该汇总门禁，任一验证组不成功就不能发布。各 job 绑定同一 release SHA；这不是完整 `verify`、全量层或手动 live release gate 的替代品。`scripts/pr/release-workflow.test.ts` 分别守卫不直接调用 `verify` 和实际发布依赖。全量层每天一次的频率由 `pr-quality-workflow.test.ts` 固定，改频率需维护者决定。

分层原则：**PR 只跑改动能影响到的范围**，因此它天然无法覆盖"没有 PR 碰过的检查"和"只有全套一起跑才暴露的问题"——这两个盲区交给每天的全量层；**真实模型/额度只出现在 Release 与维护者手动 smoke**，任何贡献者在没有 provider 的情况下都必须能跑通 PR 层的全部门禁。

## 普通 PR 的影响面检查

先让仓库按变更路径列出需要运行的检查：

```bash
bun run check:impact
```

选择是**依赖感知**的：除了改动文件自身的路径前缀，还会把「谁 import 了这些文件」纳入检查范围（`scripts/pr/module-graph.ts`）。这修掉了纯前缀路由的漏检，例如改 `src/shared/modelReasoning.ts` 会选中 `check:desktop`（`desktop/src/lib/runtimeSelection.ts` 直接 import 它），改 `desktop/src/lib/browserSafePort.ts` 会选中 `check:native`（`desktop/electron/services/sidecarManager.ts` import 它，而 `desktop/tsconfig.json` 并不编译 `desktop/electron/`）。报告的 `## Cross-surface impact` 会指名是哪个 importer 触发了额外检查。

依赖图只**放宽检查选择**，不影响 area 标签和任何 blocking 规则——改一个 hub 文件不会因此要求你为没碰过的文件补测试。图构建失败时会选中全部 surface 并打印告警，不会静默退回前缀路由。

本地 policy 需要例外判定却缺少可信 PR author 和 base branch CODEOWNERS 时，保持 `blocked`；缺上下文不等于已证实缺审批。不得从 `git user` 或工作区 CODEOWNERS 推断维护者身份，也不得伪造 label 或使用 `ALLOW_*` 绕过。保留技术检查结果，等待可核验的 PR/base 上下文后再作治理结论。

## 无模型的端到端 Agent 门禁

```bash
bun run check:agent-flow       # 真实 server + 真实 WebSocket + mock CLI
bun run check:agent-e2e        # 真实 server + 真实 CLI agent 循环 + mock LLM，再跑一遍录制回放
bun run check:agent-replay     # 只跑录制回放
bun run check:desktop-ui-smoke # 真实桌面 UI + 真实权限对话框 + mock CLI
```

三条通道都不需要 provider、凭据或公网。

`check:agent-e2e` 只假一个模型：本机回环起一个 Anthropic 兼容端点（`scripts/quality-gate/mock-llm/`），通过桌面端「新增服务商」同一个 API 注册成 provider，真实 CLI 照常跑 agent 循环、真实工具改真实（临时）磁盘。脚本化模型对自然语言提示做出模型式的反应，所以它和 `check:agent-flow:live` 共用同一份场景（`agent-flow/liveScenarios.ts`）：mock 证明管线，live 证明真模型也落到同样结果。另有只有 mock 能确定性断言的场景——工具输出真的回传给了模型（nonce 核对）、拒绝授权以错误结果回到模型、停止生成真的掐断了上游连接、上游报错后会话还能继续。改 agent 循环、工具、权限、provider 接线时，新增行为优先在这里加场景，而不是只写单元测试。

手写的 mock 只能流出作者想象中的模型输出：用量固定、工具参数一次给全、没有 thinking、没有 OpenAI 格式。所以 `check:agent-e2e` 还会跑流量回放（`scripts/quality-gate/replay/`）：维护者用真实的 DeepSeek Flash 把场景跑一遍，把上游流量录制成 `cassettes/*.json` 提交进仓库；CI 用回放服务器把这些录制流量原样喂给真实 server 和真实 CLI，不联网、不需要凭据。录制下来的是真实形态：thinking 和签名、切成很多片的工具参数（Grep/Read/Edit/Bash）、一轮并行调用多个工具、工具失败后模型自行纠正、大段命令输出、子 Agent 自己的工具循环（含两个子 Agent 并行）、项目 MCP 服务器的工具、图片附件（用 DeepSeek Flash 的视觉版录制）、Agent Teams 从队长出方案、批准、两个成员先后干活到汇报和收尾的完整流程、长对话里的自动压缩和手动 `/compact`、用户停止时截断的流、中文对话，以及经过 server 代理转换的 OpenAI Chat 流（含 reasoning 和中断）。

- **匹配规则**：请求按队列依次对应录制流量。每个 agent 循环（主 agent、子 Agent、团队成员）按启动它的第一条用户消息各自成一个队列，严格比对模型、stream、最后一条消息的角色、用户输入文本，以及工具结果是否正好回应上一轮的工具调用（并行工具按完成顺序回传，只比对集合）；对不上就返回 400 `replay_mismatch`，并在 `artifacts/agent-e2e/replay/<format>/<id>.report.json` 写出字段级差异。标题这类不带工具的旁路请求尽量回放，录制流量里没有就给占位回复，不判失败。
- **运行时差异**：临时工作目录、沙箱配置目录、项目目录名、会话 ID、日期和临时目录在录制流量里存成 `{{WORK_ROOT}}` 这类占位符，回放时换成本次运行的值；路径被切进多个分片也能正确还原。应用按时钟现生成、回复又必须原样引用的值（例如团队成员关停请求的 ID）存成 `{{V1}}` 这类学习位，回放时从第一个带它的请求里学到本次的值，再填进后面的回复。Agent Teams 的消息合并依赖时序，这个场景按录制时的模型延迟和流速回放，其余场景压缩回放节奏。
- **漂移**：工具列表或 `max_tokens` 变了但流程仍能对上时，只写进 `drift.md` 提醒，不判失败。系统提示词和工具 schema 带操作系统、shell 和日期，录制机器和 CI 本来就不同，不参与比对。
- **重录**：行为确实变了（例如改了 prompt 导致模型走了不同的工具路径），在本机运行 `bun run quality:record-cassettes -- --allow-live --only <id>`。它从桌面端已保存的 DeepSeek provider 读取 key，只放在录制代理的内存里，沙箱拿到的是假 key；录完会立刻回放一次自检，录制流量里出现 key、真实 home 路径或临时目录路径会直接拒收。录制需要真实额度，永远不进 CI。

`check:agent-flow` 覆盖新建 Session → 选运行时 → 首轮流式 → 工具调用 → 权限批准/拒绝 → 工具失败 → API 错误 → 中断 → 断线重连权限重放 → 会话恢复。`check:desktop-ui-smoke` 在真实浏览器里点真实的 Allow 按钮，需要 `agent-browser` 与已安装的 desktop 依赖，缺失时会打印原因并跳过。

`agent-browser` 只属于这条已提交的 lane（在 Linux CI 上以 headless 方式运行）以及维护者手动执行的 `desktop/scripts/e2e-*-agent-browser.sh`。临时的浏览器操作（手动验证、截图、探索性 UI 检查）请走 `ego-browser` skill，不要因为仓库里出现 `agent-browser` 就把它当通用浏览器工具。

所有会启动真实 server 的 quality-gate lane 都跑在沙箱配置目录里（`scripts/quality-gate/sandbox.ts`），并在结束时校验没有写过开发者真实的 `~/.claude`；写了就判定 lane 失败。

开发时运行 impact report 选中的窄命令即可。需要声明 PR-ready 或完整验证时，直接使用统一入口，无需先单独执行其全部 lane：

```bash
bun run verify
```

`bun run verify` 等价于 `bun run quality:pr`，会按改动范围执行被选中的 policy、desktop、mobile、server、adapter、native、provider contract、chat contract、persistence、docs 和 coverage lane。它不调用真实大模型。小范围外部贡献者不需要在本机运行无关模块；GitHub CI 会再次执行精确的 path-aware gate。

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

本地 `bun run verify` 的 coverage lane 被选中时是阻塞项，失败会使本地验证失败；不要把托管 PR 的提示性策略套用于本地。托管覆盖率在 PR 上只报告、不阻塞合并：`coverage-checks` 作为独立 check 显示结果，不在 `pr-quality-gate` 的 `needs` 里，必过状态不等它跑完（它约 25 分钟）；它仍然执行四件事：按源码口径统计覆盖率、执行 baseline ratchet、报告 75-80%+ 的目标差距，并对新增/变更的可执行生产代码行执行 changed-line coverage。当前 baseline 记录在 `scripts/quality-gate/coverage-baseline.json`，CI 会优先对比 base branch 的 baseline，新增 PR 不允许覆盖率下降超过允许窗口。`coverage-baseline.json` 或 `coverage-thresholds.json` 变更必须由维护者加 `allow-coverage-baseline-change` 后才能合并。Quarantine 只用于维护者的 baseline/release 追踪，不得隐藏确定性的 provider/chat 契约测试；当前普通 PR gate 不依赖 quarantine 才能通过。

## AI Coding Agent 修复循环

任务的完成标准是实现目标行为、运行当前 diff 必需的验证，并修复由本次改动造成的失败。任务范围内的本地编辑、隔离 fixture 检查和相关失败修复无需逐步请求批准；提交、推送、发布、仓库设置及真实模型额度仍遵循根 `AGENTS.md` 的授权边界。

共享 checkout 中，同一文件同一时间只有一个写入者；依赖安装、构建和完整门禁只由一个执行者串行运行，读者不重复已委派的调查。恢复任务时先核对已有后台任务及其状态、当前候选和已有证据；副作用是否完成不明时，不盲目重放命令。

模块迭代先理解问题，再决定改法：对照预期行为与实际结果，阅读模块、调用方、已有测试和相关日志，沿真实调用链定位原因；把已观察到的证据、待验证的推测和未知项分开，不从文件名或代码外观推断缺陷。

改动前明确契约与边界：输入、输出和错误如何传递；状态由谁持有、何时迁移和持久化；资源由谁创建、取消和释放；权限在哪个信任边界校验；哪些调用方、旧数据、协议与用户行为必须兼容。涉及跨进程或执行引擎时，对照[执行、数据与信任边界](execution-boundaries.md)，沿调用链完成必要修改，不另建隐藏执行路径。

根据证据选择保留、修复、合并、重设计或验证后退役：保留行为正确且职责清晰的实现；修复已定位的缺陷；合并重复职责但保留原有校验和错误处理；只有现有契约无法满足目标时才重设计。退役前确认调用方和入口已迁移或不再使用，验证旧数据兼容、状态交接与资源清理，不能仅因命名陈旧或实现复杂就删除。

质量看目标行为、边界是否清晰以及回归证据，不以机械改名、拆文件或代码行数衡量。重构服务于已确认的问题，不把与目标无关的结构调整混入修复。

`bun run check:impact` 只选择检查范围，不证明行为正确；普通任务运行选中的检查，需要 PR-ready/full validation 时直接使用 `bun run verify`，不必先单独重复执行其全部 lane。修复期间先重跑受影响的窄检查，交付时补齐最终 diff 的所需证据。没有后续改动或未解决风险时，不要反复运行已经通过的检查。无关的现有失败或环境阻塞应准确报告，而不是为了让结果变绿擅自扩大修改范围。

验证证据须绑定候选：完整 Git SHA、dirty diff 及相关未跟踪源码的内容指纹，并记录环境（OS/架构、工具版本与路径）、实际命令、退出状态、最终 summary 和日志；发布产物还须记录 SHA-256。相关源码、依赖或环境变化会使受影响的旧证据失效。运行未完成、缺最终 summary 或后台任务状态不明均不是 `passed`。

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

只有最终 diff 的 `bun run verify` 报告通过，才能声明 PR-ready/full validation。不要通过降低 coverage baseline/threshold 或改写测试预期掩盖失败。

## 回归测试设计

缺陷修复遵循 **RED → GREEN → 重构**：先补能通过真实入口复现缺陷的最小回归测试，运行并确认它因目标缺陷失败（RED），而不是因环境或 fixture 错误失败；再做最小修复让它通过（GREEN），最后在测试保持通过的前提下重构。无法复现时，如实记录尝试过的输入、环境、观察结果和证据缺口；不要把一直通过的测试说成已复现，也不要据此宣称缺陷已被证实修复。

同区域测试文件是门禁的最低信号，测试还需要证明实际行为：

- **驱动状态迁移。** 需要验证迁移时，通过 `handleServerMessage`、真实 store action 或用户事件产生状态，避免直接 `setState` 写出本应由迁移生成的结果。初始化 fixture 仍可直接设置状态。
- **断言行为不变量。** 断言用户应看到哪个会话或模型的数据，而不是抄下当前屏幕的字符串；测试输入和预期应由预期行为契约支撑，不为掩盖失败而修改。
- **覆盖丢弃与保留两个方向。** 验证去重、合并和过滤规则应丢弃及应保留的情况。消息去重尤其要拦住 replay、保留真实重复；透传上游 `uuid` / `toolUseId` 等身份，避免用文本猜测身份。
- **跨边界测试连接点。** server、store、component 分别通过并不能证明消息真正驱动了 UI；从真实入口经过调用方和依赖，断言最终可观察行为，避免 mock 被测模块本身。
- **验证失败与恢复。** 按改动风险覆盖错误、超时、取消、重试或重连；断言失败后的状态和资源清理、恢复后的可继续使用，以及不会重复执行已接受的副作用或越过权限边界。
- **行为变化时保护旧兼容。** 仅当改动影响旧 key、路径或 marker 的行为时补兼容证据，不因命名陈旧就删除。涉及迁移时，用旧 fixture 验证部分失败后的重试，以及迁移成功后用户主动清除偏好、再次启动也不会被旧数据恢复；这是测试要求，不是已修复产品缺陷的声明。

覆盖率报告也有边界：`desktop/vitest.config.ts` 只采集 `src/**`，不包含 Electron main process。仓库现有 Bun coverage baseline 中分支总数为 0，`coverage.ts` 把 `0/0` 显示为 100%；这不代表测到了全部分支。查看当前配置和报告，不把历史覆盖率数字当作新改动的证明。

### 覆盖率参考

外部参考口径：

- [Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html)：60% acceptable、75% commendable、90% exemplary；changed/per-commit coverage 90% 是合理下限。
- [Microsoft Visual Studio / Azure DevOps 文档](https://learn.microsoft.com/en-us/visualstudio/test/using-code-coverage-to-determine-how-much-code-is-being-tested)：团队通常以约 80% 为目标，典型项目要求可为 75%，生成代码可以放宽。
- [ChromiumOS EC](https://chromium.googlesource.com/chromiumos/platform/ec/+/main/docs/code_coverage.md)：新增或变更行要求至少 80% 覆盖。

## 维护 Agent 指导

根 `AGENTS.md` 保留项目约束与入口，专项规则留在对应目录，解释和示例按需放到文档。共享指导应适用于贡献者使用的不同模型；能力升级后重新核对重复流程和宽泛停止条件，不能据此跳过现行安全或 CI 契约。这次整理参考了 Eric Provencher 的 [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862)（2026-09-04）。

长期个人偏好放用户级指导，不覆盖仓库约束；模块规则放最近的 `AGENTS.md` 或适用的目录规则，复杂操作流程放 skill。必须零例外执行的规则应由适用的权限、hook 或 CI 检查落实；自然语言指导不是已实现的强制门禁，新增自动化仍须遵守配置与授权边界。

模块 README 应说明模块功能、职责与非职责、主要入口、依赖和数据归属，以及开发与验证命令；详细设计按需链接，不复制总仓库规则或保存临时任务日志。触达模块时主动核对说明与实现是否一致，报告实际缺口并修正范围内文档，不为凑齐模板批量重写无关模块。

仓库技能的描述只写适用任务和必要的区分信息，操作细节放正文或引用文件。多工作流技能用短入口路由；避免为了覆盖更多关键词而扩大触发范围。模型默认值、工具格式和压缩行为属于产品实现，更新相关文档前应先核对源码。

把可复现失败或规则冲突收敛为有界反馈：代码变化时先补最小行为回归，修复实际共享实现，运行选中的检查，再只更新最近的一处既有权威规则；不复制多份说明，也不以只匹配文档字符串的测试代替行为证据。分别写明要求、当前已实现的强制检查和待做工程。可按用户请求修改范围内指导，但不得自主扩权限、降门槛、退役行为或改未请求的全局配置，也不新增无止境循环或任务账本。

## 功能质量契约

所有新功能、bugfix 和行为变化都必须带着可验证证据交付。这条规则同时约束人和 AI Coding Agent：

- 先声明变更面：`desktop`、`mobile`、`server`、`adapter`、`native`、`docs`、`provider/runtime`、`agent-loop` 或 `release`。
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

`.github/workflows/pr-quality.yml` 会在 PR `opened`、`synchronize`、`reopened`、`ready_for_review`、`labeled`、`unlabeled` 时触发，合入 `main` 后还会按这次 push 的改动范围再跑一次（标签类例外只在 PR 上判定，不会在 main 上重新阻塞）。`scope-plan` 不安装依赖，只负责稳定地产生影响面计划；`policy-enforcement` 独立安装锁定依赖并执行 policy，因此 policy 失败也不会吞掉产品测试结果。产品 job 只依赖 `scope-plan`，按路径选择 desktop、mobile、server、adapter、native、provider contract、chat contract、persistence、docs 和 coverage lane。最后的 `pr-quality-gate` 会严格核对每个 job：选中的必须 success，未选中的必须 skipped，cancelled 或缺失结果都不能误判为通过。server 和 desktop 两条最长的 lane 在 CI 里用 `--shard=<i>/<n>` 拆到多个 runner 并行，只为缩短墙钟时间：分片合起来恰好跑完整套检查（desktop 第一片顺带 lint、最后一片顺带 build），任一分片失败该 job 即失败；本地和每日全量不分片。

`main` 的分支保护把 `pr-quality-gate` 设为 required status check，并且对管理员同样生效：红的 PR 谁都合不进去，所以发版也走 PR（见「发版步骤」）。CODEOWNER 自己提的 PR 不需要 `allow-cli-core-change` 标签，外部贡献者改 CLI 核心路径仍需维护者加标签。本机 hook 只做提醒，真正阻止低质量 merge 的是 PR gate。

### 门禁红了怎么办

门禁只有在「绿 = 可以合」时才有用，所以 `main` 必须一直是绿的：

- **你改了行为，测试红了**：门禁在正常工作。在同一个 PR 里更新测试，说明为什么旧断言不再成立。
- **红的不是你的改动造成的**：先看 `main` 上最近一次 PR Quality（push）和全量是否也红。是的话单独开 PR 修；不能立即修复就报告 blocker，不绕过必需的确定性 lane 合并。`scripts/quality-gate/quarantine.json` 仅供维护者 baseline/release 追踪（负责人、到期日由 `check:quarantine` 审计），不是 PR 必需门禁的豁免。
- **偶发失败（flaky）**：`check:server` 会把失败的文件单独重跑一次，日志里标成 `FLAKY`（单独跑能过）或 `FAILED`（单独跑也挂），但两种情况门禁都是红的。`FLAKY` 说明是竞态，去修竞态本身（常见原因是断言了「最后一个请求」或依赖墙钟时间），不要给测试加长超时或放宽断言来掩盖。
- **门禁本身要调整**：改 `scripts/pr/change-policy.ts`、workflow 和对应测试（`check:policy`），保持 `pr-quality-gate` 这个汇总检查名不变，分支保护就不用动。

## 按改动范围补充测试

根据你改动的区域补充运行：

```bash
bun run check:server      # 服务端 API、WebSocket、provider、会话等测试
bun run check:desktop     # 桌面端 lint、Vitest、生产构建
bun run check:mobile      # 移动端类型、lint、测试与离线 H5 导出
bun run check:adapters    # IM adapter 测试
bun run check:native      # 桌面 sidecar、Electron host 与 package-smoke 检查
bun run check:provider-contract # Provider/runtime/proxy 的离线契约测试
bun run check:chat-contract     # WebSocket、会话与桌面 chat store 契约测试
bun run check:persistence-upgrade # 持久化迁移和旧 fixture 兼容性
bun run check:docs        # 独立安装、构建并检查 site/ React 文档站
bun run check:quarantine  # 维护者 baseline/release quarantine 审计
bun run check:coverage    # root、desktop、adapters 覆盖率报告和 ratchet 门禁
```

如果只改了很窄的文件，先跑对应的定向测试即可；只有在声明 PR-ready/full validation 时才需要本地再跑 `bun run verify`，托管 CI 仍会执行所有被选中的必需 lane。

可执行 JS/TS 生产代码改动必须带对应测试文件；同区域划分见上文 功能质量契约 和 `scripts/pr/change-policy.ts`，缺失时会触发阻断。只有维护者确认不适合自动化测试时，才能使用 `allow-missing-tests`。覆盖率 baseline/threshold 变更同样需要维护者确认并加 `allow-coverage-baseline-change`。

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

`provider` selector 来自桌面端「设置 → 服务商」里保存的本机配置。别人 clone 代码后不需要知道你的 provider UUID，也不需要使用你的供应商；他们可以在自己的桌面端添加 provider 后运行 `bun run quality:providers` 选择自己的模型。

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

`quality:release` 是 release 模式的别名，真实调用仍需显式 `--allow-live` 和维护者额度授权。release 模式会组合 PR checks、baseline catalog、live baseline、native checks，并用当前平台 canonical release artifact 跑 `package-smoke --package-kind release`，但不等于运行全量层的全部检查。发版报告同样写入 `artifacts/quality-runs/<timestamp>/`。发布 workflow 的三组验证及汇总依赖见上文「四层门禁分工」；它们不直接调用 `bun run verify`，也不自动调用手动 live release gate。

发布证据应按目标 OS/架构区分以下层次，不能互相替代：

| 证据层 | 证明范围 |
| --- | --- |
| 源码 / 构建 | 指定候选的测试、类型检查与构建；不证明分发包可运行 |
| 包结构 | 指定产物的 metadata、资源、sidecar 与更新文件；静态或跨平台检查不证明原生启动 |
| 原生打包运行 | 在匹配 OS/架构上运行真实分发包，验证主程序、sidecar 和关键用户路径；mock 或本地 Electron 开发 smoke 不替代 |
| 安装 / 升级 / 数据保留 | 真实安装及从受支持旧版本升级，验证用户数据、自定义目录和设置保留 |
| 签名 / 公证 / 启动策略 | 按平台及明确选择的发布模式验证签名、公证和 Gatekeeper；允许注明限制的未签名 macOS / Windows 包，未签名不等于签名验收通过 |

每层记录所用候选（完整 SHA、dirty diff 和相关未跟踪源码指纹）、目标、命令、退出状态、summary、日志及产物 SHA-256，关联到实际发布的同一产物；重建或签名改变字节后须重新关联并验证受影响证据。下方平台矩阵仍全部受支持，不能用单一平台结果代替其他目标，也不能静默移除目标。`skipped`、`UNEXERCISED`、`blocked` / `not run` 不证明相应路径已覆盖；合法的不相关 skip 仍允许，这不改变 lane 状态或现有 blocking 规则。

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

正式执行 `bun run scripts/release.ts <version>` 前，先确认对应的 `release-notes/v<version>.md` 已经存在，并单独取得创建分支和提交的授权。非 dry-run 会创建 `release/vX.Y.Z` 分支并提交版本与 release notes，不创建 tag、不推送、不发布；默认只更新桌面版本，只有显式传入 `--mobile <patch|minor|major|x.y.z>` 才同时递增独立的移动版本。

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

`bun run verify` 也不需要真实模型；只有 live baseline 需要。维护者可以先在桌面端 设置 → 服务商 添加自己的 provider，再运行：

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
