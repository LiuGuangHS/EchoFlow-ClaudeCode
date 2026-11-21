---
title: 上游学习与后续功能台账
nav_title: 上游学习台账
description: 记录原上游、同类 Agent、值得跟踪的机制和下一版发布范围。
order: 10
---

# 上游学习与后续功能台账

始于 2026-11-19，更新于 2026-11-21。这里记录第一方仓库、版本与产品说明、本地实现和维护者建议，后续可按日期核对差异。

## 1. 版本锚点与同步状态

| 来源 | 已核实锚点 | 与本地代码的关系 |
| --- | --- | --- |
| [NanmiCoder/cc-haha](https://github.com/NanmiCoder/cc-haha) | `HEAD=bb873bb00ad18a37fc64ef84d87cfecb0704e90e`（提交时间 2026-11-18 19:37 UTC）；[v0.7.8](https://github.com/NanmiCoder/cc-haha/releases/tag/v0.7.8) tag `98c9c08ce5d7e50b4314d99280b57376e8cfe513`（2026-11-10 发布） | 本地保存的 `refs/remotes/cc-haha/main` 停在 `f0df5ae36e5653909bbd4fd20a088a3f99c74a5d`（2026-11-08）。当前分支包含 v0.7.7 的 tag 提交，但不含 v0.7.8 tag 提交；两条 ref 都不是当前 HEAD 的祖先。原 HEAD 相对 v0.7.8 有 106 个提交。仓库已在 2026-11-09 经 `c32668dff`、`a1cf55542` 等提交合并运行时/桌面覆盖层，因此不能只按 commit number 判断功能是否缺失。 |
| [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) | vendored 来源固定在 [`9eb9b296`](https://github.com/vercel-labs/agent-desktop/tree/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d)、版本 1.0.2；当前公共 `HEAD=e8934a5e95e1d212c74ead95cd3e4701c04eca31`，[v1.3.1](https://github.com/vercel-labs/agent-desktop/releases/tag/v1.3.1) tag `b0b7277bea09b770ef9d1fb45aad667bc432cd57`（2026-11-13 发布） | `v1.0.2..v1.3.1` 有 44 个上游提交、569 个文件变化。本地 vendored 代码有大量 EchoFlow 适配，不能整目录覆盖；应只挑有回归证据的增量。来源、许可证与本地改动见 [PATCHES.md](../../native/agent-desktop/PATCHES.md)。 |
| [EchoFlow 原仓库](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode) | 本地 tag 包含 v0.5.1、v0.5.5、v0.5.6、v0.7.1–v0.7.4、v0.7.7 | 与 cc-haha 的 tag 编号和提交日期并不完全一致。发布判断使用本地 tag 和第一方说明，不用编号推断当前分支包含什么。 |

术语：`原上游` 指 `NanmiCoder/cc-haha`；`原生上游` 指 `vercel-labs/agent-desktop`；`同类项目` 指其他第一方项目。下文“差距”只描述本次采样证据，后续开发中需先逐项确认当前分支实现。

## 2. 原上游原样学习：v0.7.8 发布说明

[v0.7.8 release](https://github.com/NanmiCoder/cc-haha/releases/tag/v0.7.8) 明确写了以下能力。优先级是维护者建议，不是原上游承诺：

v0.7.8 的多数修复在本地其他 ref 中存在，但逐条 `git merge-base --is-ancestor <sha> HEAD` 显示以下提交都不在当前 HEAD：`1e216917d`(P2P)、`23dbacfbf`(打包 P2P)、`b5a8fa8bd`(外出连接)、`a8a288c18`(运行中权限切换)、`4334dc0ec`(长思考)、`b0f21b983`(跨会话串台)、`618105e09`(超大消息)、`525f82b7c`(provider 隔离)、`763cd86f2`(微信媒体)、`2f4257afc`(Fable 5.2) 以及错误分类 `a12ec2763`/`d87341a56`/`547955ab4`。因此下表是**分支落地/回归确认清单**，不能直接当作“功能尚未实现”。先确认当前 HEAD 是否有等价的自研实现，再决定是否 cherry-pick；不要整仓 merge。

| 功能点 | 适合 EchoFlow 的下一步 | 初步优先级 | 本地核对 |
| --- | --- | --- | --- |
| 外出连接期间保持电脑唤醒；屏幕仍可睡眠 | 已有通用 `preventSleepWhileRunning` 与 `desktop/electron/services/preventSleep.ts`；不要新增第二个电源控制入口。待定的是外出连接开关是否复用现有服务。 | P1 | `desktop/src/stores/powerSettingsStore.ts`、`desktop/electron/services/preventSleep.ts` |
| 桌面服务重启后沿用 cloudflared 地址；地址真变化时手机自动找回 | 先核对现有 cloudflared 生命周期与手机端地址刷新是否有幂等保护和可观测状态，再决定是否补地址迁移。 | P0 | `desktop/electron/services/cloudflareTunnel.ts`、`mobile/` |
| 手机 P2P 直连；打包版可用；后台回前台续会话只补增量 | 本地其他 ref 已有 `#1844`/`#1859`/`#1862` 提交，当前 HEAD 未包含。先以真包验证“打包版可用”和增量恢复，别只复用单测。 | P0 | `desktop/electron/p2p/hostPage.ts`、`mobile/app.json`（观测版本 `0.1.3`，原上游说明要求手机 0.1.4） |
| 回合运行中切换 ask/skip permissions，已显示审批卡不自动批准 | 检查权限模式是否只作用于之后的工具调用，且切换本身不消费已有审批；这是用户状态安全边界。 | P0 | `desktop/src/`、`src/server/`、`adapters/common/` 的权限路径 |
| Fable 5.2 模型与别名 | `#1874` 在其他 ref，当前 HEAD 的 `src/constants/prompts.ts:122`、`desktop/src/constants/modelCatalog.ts:7`、`src/utils/usageAccounting.ts:61` 仍固定/只会计 `claude-fable-5-1`。这是可直接对齐的小改动。 | P1 | 上述三个文件 |
| ChatGPT Official 按模型设置可选上下文窗口 | 只在已有 provider/model 映射面板中扩字段；空值走官方默认，超限拒绝，压缩读取新值，必须做旧配置兼容。 | P2 | provider 设置与压缩设置 |
| 微信通道状态面板、媒体投递与 `/delivery`、`/retry` | 其他 ref 已有 `#1819` 合入提交但当前 HEAD 未包含；应先做跨 adapter 的状态/重试契约，不要为微信单独复制一套。 | P2 | `adapters/common/`、`adapters/wechat/` |
| 长思考流式增量解析、图片附件即时出现、Markdown 表格/嵌套引用/四反引号稳定 | `#1858` 不在当前 HEAD。以流式 fixture 验证“中间帧正确、最终帧一致”，避免只测最终文本。 | P0 | `desktop/src/` 消息渲染组件 |
| 并发消息序号冲突导致跨会话串台；超过 16 MB 消息静默丢失 | `#1843`、`#1811` 不在当前 HEAD。两者都是数据/状态安全问题：消息 key 应会话内稳定，超限应保留草稿并明确报错。 | P0 | chat store、输入组件与测试 |
| 编辑供应商影响运行中会话；无效 key 反复重试；额度/余额耗尽被误判为认证失败 | `#1835` 与三个错误分类提交不在当前 HEAD。会话开始时固定 binding，不改变已接受或已消费状态；错误分类保留厂商原文。 | P0 | provider 设置、OAuth、provider 错误分类 |
| `/v3`、`/v4` 结尾的 OpenAI 兼容 Base URL 不再追加 `/v1` | 小改动但需要 fixture 覆盖带版本路径和旧无版本路径。 | P1 | provider URL 归一化工具 |
| 历史坏图导致后续每轮请求失败；Memory/plan 相关修复 | 坏图应降级为文字说明而不阻塞会话；其余条目见原 release 全文再拆票。 | P2 | 消息规范化与上下文组装 |

## 3. 原上游 v0.7.8 之后的 HEAD 采样

`v0.7.8..HEAD` 共 106 个提交；这里只记录已逐字核对的 `feat`/`fix`/`perf`/`security` 主题，作为后续逐项验证池，不表示当前 EchoFlow 一定缺少这些能力：

- 团队：staged team member 向 lead 报告而非直接失败；durable pause 与显式 team resume。
- Provider/运行时：保留 cc-switch usage scripts、显式 subagent model env；输出 token 上限 tri-state 与有界自动升级；plan mode/review 中 honoring model change；Codex stalled tool input 重试有界。
- 桌面/体验：宽窗口的工作区分栏宽度；中性深灰主题；订阅使用额度显示；workspace split 与图像上下文压缩。
- 远程/诊断：H5 control-plane 授权路径规范化；保留连接失败诊断到导出文件；Expo push credential 错误与代理失败区分。
- 安全/正确性：OAuth stale generation 不再刷新；后台任务通知不进入对话；显式创建的嵌套项目保持独立；worktree 变更在 active turn 内同步；压缩计数不会回退旧摘要。

这些条目里有的是原上游品牌环境下的修复，迁移前必须查 EchoFlow 当前代码和已有测试；例如计划使用额度显示一类能力可能与本地已有统计重复，先做 gap review 再开票。

## 4. 原生上游 agent-desktop：v1.0.2 → v1.3.1

固定版本比对来自 `git log v1.0.2..v1.3.1` 与第一方 release notes。按适配成本排序：

1. **状态机与 ref 安全（优先）**：上游 `ab7dfb218` 关闭 sessions、refs、trace、MCP、wait 中可达的非法状态转换；`b4926b567`、`0dd484fb2` 重写 macOS/Windows/Linux ref 重识别。EchoFlow 的 Computer Use 是产品核心路径，先在本地对应代码上审查这些边界，再决定单列迁移票。证据：release notes 与 `native/agent-desktop/AGENTS.md` 的 ref 语义。
2. **MCP 入口**：`v1.2.0` 引入 `agent-desktop mcp`，`v1.3.1` 修复 started sandbox 在 launcher 退出后存活问题。先确认产品是否需要让外部 agent 直接接入；若需要，必须按 EchoFlow 的权限与单授权边界适配，不能照搬。
3. **sandbox 命令与 macOS VM sandbox**：`v1.3.0` 新增，属于 P2 研究项；不要为了追平上游立刻引入新的执行边界。
4. **部分快照**：`53e072dc6` 保留观察超时的 partial snapshot；本地 vendored 代码已有 truncated 语义，先核对差异，避免重复开发。
5. **macOS 平台细节**：接入 Dock、菜单栏状态项和系统面板；光标覆盖系统菜单；列行选择；退出进程过滤；`libproc` 替代 `ps` 的性能改动。每一项都需要各 OS 的真实应用回归，不能由 Linux 单测证明。
6. **进程模型**：上游 v1.1 系列移除长期 macOS command host，每次 CLI 调用独立进程，并处理升级残留 host。EchoFlow vendored 的调用架构若不同，应仅借鉴其升级清理与进程隔离测试，不通货式替换。
7. **依赖安全**：`rustix` 升级到 1.1.6（RUSTSEC-2026-0486）。这是可直接处理的升级项；先核对 vendored `Cargo.lock` 是否受影响，再按原生模块规则运行 host-package 检查。
8. **stdin 文本命令**：`97125f6ac` 允许文本命令读 stdin。小功能，若产品侧有明确使用路径才开票。

## 5. 同类项目：值得长期跟踪的来源

版本只记录已查到的固定 ref。持续更新的产品文档记录采样日期，版本待核实的项目保留第一方链接。

| 项目 | 本次锚点 | 值得学习的能力 | 可靠性/边界 |
| --- | --- | --- | --- |
| [OpenCode](https://github.com/sst/opencode) | [v1.19.6](https://github.com/anomalyco/opencode/releases/tag/v1.19.6)（2026-11-17） | 终端 agent 的会话恢复、多模型/多 provider、TUI 交互与扩展模型 | 需读 release body/代码再拆具体票；本次仅确认版本锚点 |
| [Aider](https://github.com/Aider-AI/aider) | [v0.86.0](https://github.com/Aider-AI/aider/releases/tag/v0.86.0)（2025-08-09） | 代码库映射、git-aware 变更、明确变更说明 | 版本较旧，适合看稳定机制，不把 version 当活跃度结论 |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | [v0.43.0](https://github.com/vercel-labs/agent-browser/releases/tag/v0.43.0)（2026-11-12） | snapshot hints（空/重名可访问名附图标、testid、id、邻近行文本）、大页面只解析一次 accessibility tree、按平台分发原生包 | 已核实 release notes；适合转化为浏览器可读性与性能验收项 |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | [v0.0.86](https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.86)（2026-11-18） | 扩展 tab group 断点续连、客户端命名/着色与所有权、同名下载不覆盖 | 已核实 release notes；适合借鉴多代理共享浏览器时的会话归属模型 |
| [Codex CLI / OpenAI Codex](https://github.com/openai/codex) | 仅仓库链接；本次 API 查询超时 | worktree、审批、会话恢复的参考实现 | 暂无固定版本，不据此下结论 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 仅仓库链接；本次 API 查询超时 | 终端交互与工具权限提示 | 暂无固定版本，不据此下结论 |
| [Cline](https://github.com/cline/cline) | 仅仓库链接；本次 API 查询超时 | 人工审批闭环与任务计划展示 | 暂无固定版本，不据此下结论 |
| [browser-use](https://github.com/browser-use/browser-use) | 仅仓库链接；本次 API 查询超时 | 面向任务的浏览器自动化观察/行动循环 | 暂无固定版本，不据此下结论 |
| [Claude Code 官方仓库](https://github.com/anthropics/claude-code) | 仅仓库链接；本次 API 查询超时 | CLI 行为、技能与权限语义的第一方参考 | 仅作参考，不复制未授权资产 |

### 2026-11-21 同行对照

EchoFlow 的对照基线是电脑执行、手机/H5 和 IM 接回会话、桌面 Diff 审查、独立 worktree 与团队分派。原上游 v0.7.8 的 P2P、前台增量恢复和运行中权限切换，在 EchoFlow 当前代码里已有对应路径。安装包仍需按候选版本验证。[外出连接](../desktop/remote.md#直连与回到前台) · [会话分派](../desktop/sessions.md#引用历史会话与分派工作) · [权限切换](../../src/server/ws/handler.ts#L2415)

| 项目 | 对照点 | 第一方资料 |
| --- | --- | --- |
| HAPI | 用户电脑执行、自托管 Hub 保存会话，终端与手机可接回同一条运行。已停止会话的恢复按引擎支持。 | [架构](https://hapi.run/docs/guide/how-it-works) · [Codex 共享会话](https://hapi.run/docs/guide/codex-shared-sessions) |
| Happier（源自 Happy） | 可把会话 ID、历史和执行归属交给另一台电脑，可选转移工作区文件。Codex 交接为实验支持。 | [跨机器交接](https://docs.happier.dev/sessions/session-handoff) |
| OpenClaw | Gateway 决定多个交互入口是否汇入同一会话，也能按渠道和发送者隔离。对照 EchoFlow 的项目与工作目录绑定。 | [会话路由](https://docs.openclaw.ai/session) |
| Codex | 从手机在已连接的开发机启动或引导任务，可选现有 checkout 或独立 worktree。 | [Codex Remote](https://developers.openai.com/blog/mastering-codex-remote-for-engineering) |
| Cursor Cloud Agents | 桌面、Web、手机接入同一云任务。转云端时带对话上下文，云端从远端仓库的干净状态执行。 | [云端能力](https://cursor.com/docs/cloud-agent/capabilities) · [本地转云端](https://prod.cursor.com/help/ai-features/cloud-agents) |
| OpenHands Agent Canvas | 由 Agent Server 持久化并执行。执行环境离线时仍可查看已保存历史，继续执行需要可用的运行环境。Canvas、ACP、Slack 的同一活跃会话互通待核实。 | [Canvas 会话](https://github.com/OpenHands/docs/blob/main/openhands/usage/agent-canvas/conversations.mdx) |
| Conductor | 同一工作区的多条聊天共享分支与 checkout，Checks 面板跟踪 CI 和 PR 评审。与 EchoFlow 的工作会话独立 worktree 对照。 | [工作区](https://www.conductor.build/docs/first-workspace) · [Checks](https://www.conductor.build/docs/reference/checks) |
| Paradev（原 Superset） | 每任务一个 worktree，PR 面板可把选中的 Diff 和评审反馈交给 Agent。 | [仓库](https://github.com/paradevai/paradev) · [PR 反馈](https://docs.paradev.com/pull-requests#comment-straight-to-an-agent) |
| Agent Orchestrator | CI 失败、评审意见、合并冲突回到负责该分支的 worker。 | [仓库](https://github.com/OrchestratorInc/agent-orchestrator) |
| cmux | 用统一侧栏观察多个终端 Agent 的分支、PR、端口和待处理通知。 | [仓库](https://github.com/manaflow-ai/cmux) |
| T3 Code | 可新建或复用 worktree。区分符合条件的 Codex 原生分叉和跨 provider 上下文交接。 | [线程与上下文](https://github.com/pingdotgg/t3code/blob/main/docs/orchestration-v2/thread-lineage-and-context-transfer.md#current-implementation-boundary) |
| Qoder 桌面版 | 新建时选择 Local 或 Worktree，计划展示影响文件与验证，审查可按文件暂存、撤回。 | [新建任务](https://docs.qoder.com/qoder/new-task) · [计划](https://docs.qoder.com/qoder/plan-driven) · [审查](https://docs.qoder.com/qoder/review-and-commit) |
| OpenCode / Zed | OpenCode 区分加载、恢复、分叉及原工作目录约束。Zed 通过 ACP Registry 发现和接入外部引擎。分别对照会话能力和宿主职责。 | [OpenCode ACP](https://opencode.ai/docs/cli/acp/) · [Zed 外部 Agent](https://zed.dev/docs/ai/external-agents) |
| Pi / Qwen Code | Pi 在同一会话里切换历史分支。Qwen Code 区分代码、对话、两者的回退，并提供工具调用粒度的检查点。 | [Pi 会话树](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md) · [Qwen 检查点](https://qwenlm.github.io/qwen-code-docs/en/users/features/checkpointing/) |
| goose | Recipe 把指令和参数封成可共享、可定时运行的流程。对照 EchoFlow 定时任务和 Dynamic Workflow 的参数复用。 | [Recipes](https://goose-docs.ai/docs/guides/recipes/) |

优先跟踪 HAPI/Happier 的接力、Paradev/Agent Orchestrator 的任务交付、T3 Code/OpenCode/Zed 的引擎与会话边界。本次是公开资料和本地实现对照，延迟、可靠性及原生安装效果待实测。

## 6. 内部现状与发布证据

不要重复排期以下已做方向：审批全表面、移动配对与单一 Expo 实现、ModelConfig 与运行时解耦、定时任务与 Team CLI 继承、独立 worktree 与并发限制、全局搜索、Provider OAuth/搜索/导入。依据见 `release-notes/v0.7.1.md`、`v0.5.6.md` 等第一方发布说明和 `docs/_internal/archive/planning/README.md`（归档计划不是待执行清单，也不是完成证明）。

发布事实仍需谨慎：

- 本地 tag `v0.7.7` 指向 `f144d845b`，而发布审计使用 GitHub v0.7.7 的 `a577f7c0`；两者不同。继续用 commit SHA 与 release note 对齐，不把 tag 名单独当完成证据。
- `release-notes/v0.7.7.md` 明示“最终候选待验收”：桌面原生安装、旧版升级与数据保留、EAS 构建签名、Android APK 实投、线上登录与模型请求当时尚未完成；创建 tag 不代表安装包已构建、签名或发布。
- 当前工作树存在大量未提交路径（本次观察 331 个，含 200 个 tracked diff 与约 130 个未跟踪文件）。所有未提交改动一律不算 released。
- [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md) 记录派生代码来源与未关闭的法律复核项；README 保留 cc-haha 署名。功能学习不等于代码复制许可，尤其分发前需按现有来源记录复核。

## 7. 建议的后续开发清单

按依赖顺序；每条都应先写复现/验收，再改代码。状态列预留给后续维护者更新。

| ID | 功能/修复 | 验收 | 建议优先级 | 状态 |
| --- | --- | --- | --- | --- |
| U-01 | 先做版本落地 triage：核对当前 HEAD 是否已有上述 v0.7.8 等价实现；没有才补 Fable 5.2、URL 版本路径等精确提交 | 每个 SHA 用 `merge-base --is-ancestor` 与行为测试双重确认；不把其他 ref 算作已发布 | P0 | 待确认 |
| U-02 | 端对端发布验收：以 GitHub 正式 `v0.7.7` 为升级起点，按本版范围完成安装、升级和线上验证 | 新版本、发布说明、候选 commit 与产物 SHA-256 能相互对应。Android 按独立交付范围验收 | P0 | 待确认 |
| U-03 | 审批决策 owner 落地到下一个正式包：复用 `93a75fdd4`、`c668591a6` 等已提交修复 | 跨桌面、H5、移动和八个 IM adapter 回归；已接受/已拒绝决策不丢失 | P0 | 待确认 |
| U-04 | 存储归并验收：旧 profile 所有权、共享顶层数据、writer 停写与 Windows 原生证据 | 已有恢复入口与小范围 Doctor 修复可用；不用真实用户状态验证 | P0 | 待确认 |
| U-05 | 流式消息稳定性专项：跨会话串台、16 MB 超限保留草稿、长思考增量 Markdown、坏图降级 | 每项有并发/截断/坏输入的失败测试；最终渲染与整块解析一致 | P1 | 待确认 |
| U-06 | 权限切换与外出连接：运行中切换 ask/skip 只影响后续工具调用；cloudflared 地址、P2P 打包版与前台增量恢复 | 已显示审批卡不自动批准；桌面重启、手机切后台真机场景可验证 | P1 | 待确认 |
| U-07 | Provider binding 与错误分类：编辑设置不覆盖运行中会话；无效 key/额度不足不再误重试 | 配置变更前后会话 binding 不变；错误卡重载后仍存在且保留厂商原文 | P1 | 待确认 |
| U-08 | 原上游 HEAD 增量 triage：团队暂停/恢复、输出上限升级、plan mode 模型变更、staged member 报告 | 先产出逐项“已有/缺失/不适用”的 gap review，不直接照搬补丁 | P1 | 待确认 |
| U-09 | agent-desktop ref/状态机安全复核与选择性回移 | 对照 `v1.1.0`、`v1.2.0`、`v1.3.0` release 和本地对应测试，记录每项取舍 | P1 | 待确认 |
| U-10 | agent-desktop 依赖安全：核对 rustix 与 RUSTSEC-2026-0486 | `cargo tree` 确认实际版本；按 `native/agent-desktop/AGENTS.md` 的 host package 检查 | P1 | 待确认 |
| U-11 | Provider/凭据候选修复纳入验证：复用版本化偏好、凭据提交串行化与本地脱敏提交 | 旧配置迁移、并发回调和登录恢复有离线回归；不使用真实 token | P1 | 待确认 |
| U-12 | browser snapshot hints 与可读性验收 | 空/重名 accessible name 元素可定位；大页面快照性能有前后数据 | P2 | 待确认 |
| U-13 | MCP / sandbox 调研：先判断是否进入产品，再决定是否引入 | 形成权限边界与资源生命周期设计；不得先实现后评估 | P2 | 待确认 |
| U-14 | 任务、worktree/review、搜索与 benchmark 收口：复用已有实现，完善确定性报告 | `perf:local-index` 可复现且离线；live 需单独授权 | P2 | 待确认 |

## 8. 下一版范围与执行顺序（2026-11-21）

建议下一版作为桌面稳定性补丁，暂拟 `v0.7.8`。GitHub 正式 `v0.7.7` 指向 `a577f7c0`，用于安装和升级测试。本地同名 tag `f144d845` 是历史差异。本次核对时远端 `main` 为 `af833bb4f`，工作分支本地 `HEAD` 为 `24e5778fa`，有 361 个改动路径，其中 86 个未跟踪。已提交差异也涉及 180 个路径，包括统一存储根的公开文档。基于重新核对的 `origin/main` 组装选定修复，并逐组核对依赖与版本文档。[GitHub 正式版](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/tag/v0.7.7)

| 建议纳入 | 已有提交或行为依据 | 候选验收 |
| --- | --- | --- |
| 审批恢复与 IM 状态 | `93a75fdd4`、`c668591a6` | 桌面、H5、移动和 IM 的允许/拒绝、断线重连、重复或过期决定，以及最终权威状态。 |
| 登录与凭据保存 | `9246d5c2d`、`18f6da7dc` | 隔离账号回调验证并发时保留最新登录，错误和日志脱敏。获授权后补线上登录及真实模型回合。 |
| 会话、Teams 与定时任务的 CLI 选择 | `5f6400555`、`2efb9f616`、`8a0be335b`、`40670f22d` | 新建、重开、复用已有会话分别验证 launcher，Team 和定时任务继承正确选择。使用现有真实入口 fixture。 |
| 桌面偏好与已发布连接器兼容 | `4d0215d84`、`ec70fbf74` | 从旧版保留偏好、插件标识、注册信息和未知字段。按依赖审计结果整体纳入，分别跑升级 fixture。 |

**后续版内容**包括物理存储归并、安装器迁移改造、跨机执行交接和其他同行功能。归并仍缺完整旧 profile 所有权、真正独立外置来源的产品入口，以及 Windows 原生停写和冷升级证据。候选公开文档需按发布时实际生效的路径编写，核对 `1e44953df` 与 `24e5778fa` 的相关说明。Android 按独立版本和签名身份交付，建议单独验收 APK、配对、会话恢复和通知。 [存储归并进度](storage-convergence.md#实施与证据状态) · [Android 发布操作](mobile-maintenance.md#mobile-release)

1. **组装候选**。以当前远端 `main` 为基准，按上表复核提交依赖，逐组查看最终 diff。对照现有版本的存储行为编写发布说明，按项目流程准备版本变更，保留发布前的源码 SHA。
2. **本地定向复验**。使用声明的 Bun `1.4.3`，先跑 `bun run check:impact` 和上述组的回归，再执行实际受影响的模块。偏好或持久化形状进入候选时运行 `bun run check:persistence-upgrade`。WSL 按范围验证。
3. **候选 PR Actions**。已推送的 `5f6400555` 上，CLI 核心改动缺少策略要求的标签和维护者审批，移动真实服务 fixture、server、desktop/native 等检查也失败。先在新候选跑对应 PR 门禁，失败时从最早报错定位，并保留实际测试的 checkout SHA。按既有策略完成维护者审批。[失败运行](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/actions/runs/44507569676)
4. **验收待发的包**。按现有平台矩阵和选定签名模式，验证原生启动、全新安装、从 GitHub `v0.7.7` 升级及会话和设置保留。主链路覆盖启动、登录、发送一轮、处理审批、重启后恢复。兼容范围内的移动客户端补配对、会话恢复与审批互通。记录候选、平台与安装包 SHA-256。现行官方工作流会重建、替换草稿资产并公开发布。建议在可信发布流程中保留最终草稿供原生验收，核对资产哈希后再公开同一批文件。[产物证据](../internals/contributing.md#release-门禁) · [官方发布实现](../../.github/workflows/release-desktop.yml#L1320)
5. **正式发布与线上复核**。确认既有分发许可复核记录后，按可信 Release Please 路径发布已验收产物。上线后核对下载页、目标平台更新 metadata、产物哈希，并从已安装旧版验证一次真实更新。未签名 macOS 按手动安装、升级与保留数据的模式验收。[来源与许可记录](../../THIRD_PARTY_LICENSES.md#open-item) · [发版流程](../internals/contributing.md#发版步骤) · [真实更新链路](../internals/contributing.md#验证一条真实更新链路)

当前证据为旧推送 SHA 的 PR 检查失败。新候选尚未组装，候选回归、原生安装与升级及适用的 live 目前为 `not run`。

## 9. 维护方法

1. 每次更新先记录查询时间、`git ls-remote HEAD`、release/tag URL 和固定 commit SHA；不要写“当前最新”。
2. 在 `docs/_internal/` 保留本次台账；可从 release notes 提炼需求，但不复制整篇第三方内容、许可证或外部指令。
3. 拿新 upstream commit 与本地代码逐项比对：已有相同行为标“已覆盖”，品牌/路径差异标“不适用”，真实行为差异才开实现票。
4. 每次只迁移一个可验证切片；桌面/移动/IM/native 的验证遵循根 `AGENTS.md`，真机行为不能用 renderer 单测替代。
5. 保持本表状态列和版本锚点更新；过期的“建议优先级”要重新评估，历史记录归档而不删除。
