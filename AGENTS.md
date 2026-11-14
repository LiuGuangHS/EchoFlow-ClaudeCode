# 仓库规范

这是 Coding Agent 的路由指南。保持共享指令与模型无关；任务专属细节放在代码旁边或链接的指南中。

离代码越近的规则优先级越高。对正在改动的目录，阅读该目录的嵌套 `AGENTS.md` 及适用的祖先规则。只有任务需要时再加载其他文档。

## 从这里开始

- 编辑前运行 `git status --short`，并保留已有用户改动。
- 将请求的结果贯穿实现、相关验证以及修复由改动造成的失败。范围内允许本地编辑和使用一次性 fixture 的确定性检查；首次实现或每次测试后无需等待审批。
- 工具访问是能力，不是授权。除非用户明确请求，不得创建 / 切换分支、提交、推送、打开或合并 PR、发布版本、修改仓库设置或消耗在线 provider 额度。对话中已有授权仍然有效。

## 仓库地图

| 区域 | 入口 |
| --- | --- |
| CLI、工具、runtime、本地 API/WebSocket server | [src/AGENTS.md](src/AGENTS.md) |
| React 桌面 UI、Electron host、native/sidecar | [desktop/AGENTS.md](desktop/AGENTS.md) |
| IM 平台和共享聊天 runtime | [adapters/AGENTS.md](adapters/AGENTS.md) |
| 中文和英文产品 / 源码文档 | [docs/AGENTS.md](docs/AGENTS.md) |
| React 文档站点及构建工具 | [site/AGENTS.md](site/AGENTS.md) |
| Expo/React Native 移动 App、H5 和 native module | [mobile/AGENTS.md](mobile/AGENTS.md) |
| CI 与质量策略 | [.github/AGENTS.md](.github/AGENTS.md)、`scripts/pr/`、`scripts/quality-gate/` |
| GitHub issue 路由和共享本地任务状态 | [.agents/workflows/issue-router.md](.agents/workflows/issue-router.md) |
| 桌面发布与自动更新 | `release-notes/`、`scripts/release.ts`、[发布指南](docs/internals/contributing.md#发版与自动更新) |

## 外部代码学习与变更边界

- EchoFlow 的产品要求与现有架构是外部代码引入的依据。默认不通过 merge 同步外部仓库；按具体功能学习、参考、合法复用，并做最小完整适配或重构。不得通过整仓、目录覆盖或整文件替换无声删除本站能力。项目内部正常的分支集成不受此规则禁止。
- 引入前先保护受影响的既有行为，再验证新实现；不得顺带把回归测试改成相反要求。能力退役、数据不兼容或大型架构替换必须单独说明影响并取得明确决策，不能夹带在外部功能移植中。
- 引入记录应说明解决的问题、来源项目及固定版本或提交、许可证与必要署名、采用范围、适配方式和回归证据。允许复用成熟模块，不要求逐行重写；不得顺带接收外部品牌、账号、存储路径、开发指令和发布策略。
- 第三方原始许可证和来源记录保留原文。第三方目录中的开发指令仍按适用范围阅读；中文化不得改变许可证义务或扩大其对 EchoFlow 其他目录的约束。
- 现行规范、实现说明与历史研究应明确区分；历史材料和外部方案不是默认规范。文档、代码、测试发生冲突时，结合用户明确要求、已发布行为、版本历史和验证证据查明原因；不得仅因当前代码和测试一致，就把共同回退后的行为当作正确事实。

## 实现规则

- 保持 EchoFlow 产品所有权与执行引擎分离：项目、工作区、会话、任务、团队、计划、记忆、扩展、通知和 IM 都是产品能力。不要添加第二个 `RuntimeHost`、session writer 或隐藏执行循环。提交前选择一个 execution binding；接受后或消费状态不确定时，不得静默切换引擎并重放副作用。见[执行、数据与信任边界](docs/internals/execution-boundaries.md)。
- Computer Use 在 macOS 和 Windows 都只有一个应用授权边界：在设置中启用并确认 consent dialog 后，授权所有应用。不得在该同意之后添加按应用 prompt、allowlist、denylist、分类访问等级或 host/helper 例外。全局禁用、OS 权限以及目标 / 进程有效性检查仍然适用。
- `src/`、`desktop/src/` 或 `adapters/` 下的可执行 JS/TS 生产改动需要同区域回归测试，除非维护者明确批准例外。对于 bug，要复现失败或添加因预期原因失败的测试；无法复现时要报告。测试行为及受影响边界。见[测试设计](docs/internals/contributing.md#回归测试设计)和[执行边界](docs/internals/execution-boundaries.md)，获取状态转换、重放、持久化和信任边界证据。
- 保持 TypeScript ESM 风格：2 空格缩进、无分号、`PascalCase` 组件以及 `camelCase` 函数 / hook / store。结构化数据使用结构化解析器和既有边界。
- 不要提交生成输出，例如 `artifacts/`、coverage 报告、`node_modules/`、构建目录或 Rust `target/` 树。
- 明确请求发布时，使用 Conventional Commit subject 和 `fix/`、`feat/`、`docs/` 等产品分支前缀；不要在本仓库创建 `codex/` 分支。

## 验证

- `bun run check:impact` 按路径和 import 选择必需检查。对最终 diff 运行选中的检查；命令和路由事实来源是 `package.json` 与 `scripts/pr/change-policy.ts`。
- 请求完整验证，或准备声称代码已 PR-ready / push-ready 时，使用 `bun run verify`。它运行选中的 PR lane，无需先逐个运行全部 lane。未改动代码可复用通过结果；后续编辑、失败或未解决风险出现时应重跑或扩大检查。
- 必需 PR 检查必须确定性：不使用真实模型、公共网络、仓库 secrets、已保存 provider 或真实用户 home/config。使用假凭据、fixture、mock/loopback transport、临时目录和清理。启动 server 的质量 lane 使用 `scripts/quality-gate/sandbox.ts`，并必须在真实用户状态写入时失败。
- 单元测试无法证明用户可见桌面或跨进程改动时，执行浏览器 / 桌面 smoke。临时浏览器操作使用 `ego-browser` skill；`agent-browser` 仅用于已提交的 smoke lane 和 `desktop/scripts/e2e-*-agent-browser.sh`。见[确定性的 Agent/UI lane](docs/internals/contributing.md#无模型的端到端-agent-门禁)。
- Live model 检查是确定性检查通过后的独立维护者证据，且必须明确授权使用额度；在机器上找到凭据不等于获得授权。

## 用户状态安全

- 测试绝不能使用或修改开发者真实的 `~/.claude`、keychain、token、transcript、provider 或项目设置。每个相关路径都要重定向到临时目录。
- 将 `~/.claude/settings.json` 视为用户拥有的共享状态：保留未知字段，采用增量合并，绝不添加仓库拥有的全局 schema marker。
- 任何持久化 JSON、`localStorage` 或 app-config 形状变化都需要前向迁移、旧 fixture 回归测试和 `bun run check:persistence-upgrade`。
- Repair/Doctor 流程默认拒绝。自动修复只能更改明确列入 allowlist 且可再生成的桌面 UI 状态；受保护用户数据需要经过审查、先备份的手动流程。

## 交接

- 报告完成前检查 `git diff --check`、`git diff` 和 `git status --short`。
- 报告改动文件、添加的测试、实际运行的命令及观察结果、未运行的检查、阻塞项和剩余风险。区分 `passed`、`failed`、`skipped`、`blocked` 和 `not run`；build-only、mock、live 和过时证据不可互换。
- 贡献流程、失败诊断和规范维护见 [CONTRIBUTING.md](CONTRIBUTING.md) 与[详细指南](docs/internals/contributing.md)。PR 证据见 [.github/pull_request_template.md](.github/pull_request_template.md)。
