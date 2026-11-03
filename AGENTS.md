# 仓库 Agent 契约

本文是本仓库对 AI 编码 Agent 和人类贡献者的权威操作契约。任何更短的摘要都服从本文；如果二者冲突，以本文为准。

把它当作可执行指南：检查真实代码，进行窄范围改动，验证受影响行为，并留下其他维护者可以信任的交接记录。

## 契约如何维护

本文只描述方向。流程、示例和案例规则放在 `docs/`；本文负责防止这些内容漂移。

只有同时满足以下三点时，规则才属于本文：

1. 它改变方向决策，而不仅是任务执行细节。
2. 违反它会造成不可逆损失：产品身份、用户数据、发布完整性或 CI 契约。
3. 它不能从代码或 `scripts/pr/change-policy.ts` 中直接读出。

否则应放在 `docs/`，并在这里保留一行指针。应移动内容，而不是留下缩短版；过时的摘要比没有摘要更糟，因为它仍然看起来像权威规则。

以下事项发生变化时，必须在同一改动中更新本文：

- 顶层目录、质量门禁或 package script 被新增、删除或重命名。
- `scripts/pr/change-policy.ts` 或 `scripts/pr/area-routing.json` 中的 `ChangeArea` 被新增或修改。
- 发布或迁移工作流发生变化。
- 本文引用的文件被移动或重命名。

本文应保持在 24 KiB 以下。超过该大小说明应把内容移到其他位置，而不是继续压缩措辞。硬上限为 28 KiB，由 `scripts/pr/quality-contract.test.ts` 强制检查。

## 语言规范

- 仓库级 Agent 说明和操作规则使用中文。
- 默认使用中文回复用户。
- 命令、路径、标识符、代码符号和原始错误文本保持不变。
- 受影响代码旁的嵌套指南遵循本规则；唯一已记录的例外是 `desktop/src/components/AGENTS.md`，它是权威组件索引并使用中文维护。应把它当作指南阅读，不要在其他地方重复组件列表。

## Agent 工作规则

- 对目标明确且可逆的任务自主工作。不要为明显的下一步停下来询问；只有破坏性操作、缺少授权或确实存在分叉的产品决策才询问。
- 优先使用当前已安装的 Agent 工具；详细流程位于贡献指南。
- 先识别改动面。规范词汇以 `scripts/pr/change-policy.ts` 中的 `ChangeArea` 联合类型为准：`desktop`、`server`、`adapters`、`docs`、`release`、`mobile`、`cli-core`、`harness`。本文中的文字表面映射为：`native/` 路由到 `desktop`，`site/` 路由到 `docs`，`harness/` 路由到 `harness`，`.github/workflows/**` 选择 policy lane。路径到 area 的路由位于 `scripts/pr/area-routing.json`；`pr-triage.yml` 从 base revision 读取它，而不是从 PR head 读取。不要发明没有 area 和检查支持的 surface 名称。
- `cli-core` 覆盖 `bin/` 和根目录 `src/` runtime 路径。
- 将根目录 `src/` 视为原生 Claude Code runtime；如果可以通过配置、依赖升级或 EchoFlow 自有 surface 实现行为，优先不要直接修改它。
- 编辑前检查 `git status --short`。工作树可能已有用户改动；绝不回退、覆盖、重新暂存或重新格式化无关文件。
- 保持 diff 小且边界明确。只暂存或提交本次任务有意修改的文件。
- 优先使用已有的 utility、store、service、命令模式和测试 harness。除非任务明确要求，否则不要添加依赖。
- 对清理、重构或去除冗余任务，先写清理计划；如果现有行为没有测试保护，先用回归测试锁定它，然后一次只做一轮针对性清理。
- 绝不提交生成产物：`artifacts/`、coverage 报告、`node_modules/`、构建目录或 Rust `target/` 目录。
- `.claude/` 仅供本地使用，绝不能成为 CI 依赖或已提交的事实来源。修改 Agent 指南、质量策略、CI 或 Agent 工具集时运行 `bun run audit:harness`。

## 产品身份与 Provider 策略

- 公开/发布品牌：`EchoFlow Code`；可执行文件和文档使用：`echoflow-code`。
- 接触旧产品标识时，将 `cc-haha` → `echoflow`、`Claude-Code-Haha` → `EchoFlow-Code`、`CC_HAHA_*` → `ECHOFLOW_*`。只有在明确兼容、署名、迁移 fixture 或受支持变量的场景保留历史名称。
- 保留 `Claude Code`、`Claude CLI`、`claude-code-*` 和 `CLAUDE_CODE_*` 术语：它们指 Claude Code runtime 及其环境契约，重命名会破坏集成。
- 行动号召和服务链接使用 EchoFlow surface，包括 `https://code.echoflow.cn/` 和 `https://api.echoflowai.cc/`。
- `src/server/config/providerPresets.json` 只包含官方 vendor API、官方本地集成、官方订阅/API 集成（例如 OpenCode Go、EchoFlow API）和 custom。按规则判断候选 preset，而不是按 id 列表判断：拒绝 vendor 标记为 deprecated 的内容，拒绝包含推广或跟踪参数（`utm_`、`invite`、`referral`、`?code=`）的 URL，拒绝第三方 relay 或赞助/推荐网关，以及推广性文案。当前拒绝列表由 `src/server/__tests__/provider-presets.test.ts` 和 `desktop/src/config/providerPresets.test.ts` 强制执行；不要在本文重复它。
- 官方 vendor API 和官方 OAuth 集成（包括 Grok Official）可以依据 vendor 自己的文档采用；私有网关使用 custom。新的 provider 或 preset 默认拒绝，直到通过上述规则。

## 工程行为约束

- 在编辑前定义最小行为变化和证明方式。保持改动手术式精确，使用已有 utility，避免依赖和推测性抽象，只删除本次改动造成的过时内容。`ponytail` 强制执行这套阶梯；如果 diff 超出证明范围，运行 `/ponytail-review`。
- 每一行改动都必须能追溯到用户请求、失败测试、已验证 bug 或兼容性约束。如果 diff 超出这些证据，停止并简化。
- 绝不整体使用 `--ours` 或 `--theirs`。按 hunk 逐个解决：冲突同时包含两个决策，整体选择一侧会保留其中错误的部分。
- 迭代时运行最窄的相关测试。只有用户要求完整验证，或准备声明完整验证/可推送状态时，才运行 `bun run verify`。
- 编码风格：TypeScript 使用 2 空格缩进、ESM import、不使用分号；组件使用 `PascalCase`，文件名使用描述性命名，例如 `teamWatcher.ts` 或 `AgentTranscript.tsx`；函数、hook 和 store 使用 `camelCase`。
- 对结构化数据使用结构化 parser 或已有 helper，不要使用临时字符串处理。只在说明非显然控制流或外部约束时添加简洁注释。

## 验证与质量归属

- 迭代时使用最窄且有意义的检查。`docs/internals/contributing.md` 负责贡献流程、测试设计、质量门禁、coverage 策略和 Agent flow 案例规则；英文镜像位于 `docs/en/internals/contributing.md`。
- `docs/internals/structure.md` 负责目录地图和模块职责。各区域指南放在代码旁的 `desktop/AGENTS.md`、`adapters/AGENTS.md`、`src/AGENTS.md`、`mobile/AGENTS.md` 和 `docs/AGENTS.md`。
- `scripts/pr/change-policy.ts` 负责路径路由、同区域测试要求、label、阻断策略和必需检查，不要在报告或文案中重复这些判定。`bun run check:impact` 是最低限度的改动面报告；选择检查前必须先阅读它的结果，依赖感知的扩大范围会在 `## Cross-surface impact` 中报告。
- 必需检查必须确定且对外部贡献安全：不得调用真实模型、live provider、公网、仓库 secrets、已保存 provider 或开发者真实 home/config。Provider/auth/proxy/runtime 以及桌面 chat/session 改动可能增加离线契约检查。
- `bun run verify` 是完整验证、推送和发布就绪检查的入口。没有必需证据时不要声称该状态；live provider 和仅限维护者的 lane 需要明确授权。

## 持久化存储兼容性

- 修改本地 JSON、`localStorage` 或应用配置持久化格式时，必须同时提供前向迁移、旧 fixture 回归测试和持久化升级门禁。
- 对存储结构变化运行 `bun run check:persistence-upgrade`。迁移测试、旧 fixture、备份行为和未知字段保留全部通过后，改动才可继续。
- `~/.claude/settings.json` 是用户拥有的共享状态：读写时保留未知字段，采用增量合并，绝不向其中写入仓库拥有的全局 `schemaVersion`。
- Desktop Doctor 和任何自动修复路径必须默认拒绝。单击修复只能修改允许列表中的、可重新生成的桌面 UI 状态，例如 `echoflow-code-*` `localStorage` key 或 native window state。
- `echoflow-code-*` `localStorage` key 和 `echoflow-code` 内部目录是活跃的持久化契约。解析后的 config root 来自 `CLAUDE_CONFIG_DIR` 或平台数据目录；`~/.claude/echoflow-code/**` 仍是受支持的旧迁移来源。没有迁移任务、前后兼容测试和明确的用户数据保留保证，不得重命名这些 surface。
- 默认保留 EchoFlow 迁移来源，除非用户明确说明迁移窗口已关闭。
- Windows AppUserModelID 必须等于 `desktop/package.json` 的 `build.appId`；它控制 toast 归属和任务栏身份。品牌改动必须更新 Electron 身份测试。
- Doctor 和修复流程绝不能修改 chat transcript、model/provider 配置、Skills、MCP 配置、plugin 状态、IM 绑定、adapter session、OAuth token 或 team/session 记录，除非未来任务明确增加经过评审且先备份的手动修复流程。
- 受保护文件包括 `~/.claude/projects/**/*.jsonl`、`~/.claude/settings.json`、解析后的 EchoFlow config root 或旧路径 `~/.claude/echoflow-code/` 下的 provider/settings/OAuth 文件、`~/.claude/adapters.json`、`~/.claude/adapter-sessions.json`、`~/.claude/skills`、项目 `.claude/skills`、`.mcp.json`、托管 MCP 配置、`~/.claude/plugins/**` 和 `~/.claude/teams/**`。默认只做脱敏诊断。
- 如果持久化结构不能原地升级，必须先明确并测试升级路径，否则阻塞实现。

## 发布完整性

- 桌面发布使用与 `desktop/package.json` 匹配的纯 `vX.Y.Z` tag；release notes、`scripts/release.ts` 和 `.github/workflows/release-desktop.yml` 必须一致。`desktop/package.json` 是发布版本事实来源，EchoFlow 保留自己的版本线。
- 在发布工作流和公开资源得到验证前，不要移动 tag、上传本地产物或宣布发布。详细发布流程位于 `docs/_internal/release-windows.md` 及其英文镜像。
- `bun run check:release-surface` 是固定的内容和身份门禁；它检查发布说明版本/品牌、未解决冲突和公开身份 surface 上的旧产品名。

## 产品身份与许可

- 在 README、文档、release notes、package metadata、诊断导出、签名/隐私页、更新链接和桌面 About/profile 默认值中保持 EchoFlow 的署名、维护者、联系方式和产品身份一致。
- 第三方版权和许可声明必须保留在它们覆盖的代码旁。若文件需要单独携带许可，将它们移动到 `THIRD_PARTY_LICENSES.md`；绝不删除许可证要求保留的声明。
## 提交边界

- 使用 Conventional Commit 前缀和正常的产品分支前缀，例如 `fix/xxx`、`feat/xxx` 或 `docs/xxx`；不要创建 `codex/` 前缀的分支。
- 将非显然决策记录在 git-native trailer 和本地交接记录中。

## 深入指南

- 安装、测试或准备贡献时，从 `CONTRIBUTING.md` 开始；其余文档归属见“质量与验证边界”和“发布完整性”。
- 选择命令或判断改动需要哪些检查时，参考 `package.json` 和 `scripts/pr/change-policy.ts`。
