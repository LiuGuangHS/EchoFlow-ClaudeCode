# 仓库规范

这是 EchoFlow 第一方代码的统一 Agent 规则入口：全仓底线在此维护，领域契约按任务读取下列链接，不复制规则。第三方目录保留自己的来源与局部规则，修改前阅读该目录的嵌套 `AGENTS.md` 及适用的祖先规则。

## 从这里开始

- 编辑前运行 `git status --short`，保留已有用户改动；先阅读实际实现、调用方和相关测试，再做范围内的最小完整修改。
- 任务完成包括目标行为、相关验证和修复本次改动造成的失败。范围内的本地编辑、隔离 fixture 检查和修复无需逐步审批；子任务完成不等于整个请求完成。
- 工具访问是能力，不是授权。创建或切换分支、提交、推送、打开或合并 PR、发布、修改仓库设置或使用在线 provider 额度，须有用户明确授权；已有授权覆盖的同一范围不重复确认。普通本地修复不要求建分支或提交。
- 使用 `package.json#packageManager` 指定的 Bun，先核对实际版本和路径。发现版本不符或缺依赖，明确报告要求和修复方式；在授权范围内完成环境准备后验证默认入口。临时指定版本只是诊断或一次性验证，不能声称默认环境已修好。需要网络的依赖准备与离线检查分开。
- 跨会话协作由一个负责人统一分派任务和文件，同一文件同一时间只有一个写入者。负责人汇总各会话结果、集中安排验证，并统一执行已获授权的提交和推送。依赖安装、构建和完整门禁由一个执行者串行运行。恢复工作先收集已有后台结果，副作用状态不明时不盲目重放，不重复启动等价检查。

## 仓库地图

| 区域 | 实现与按需参考 |
| --- | --- |
| CLI、工具、runtime、API/WebSocket | `src/`；[执行、数据与信任边界](docs/internals/execution-boundaries.md) |
| Electron、React、sidecar | `desktop/`；[桌面开发](desktop/README.md)、[设计与组件规范](DESIGN.md) |
| IM adapter | `adapters/`，共享入口 `common/chat-runtime.ts` |
| Expo / React Native / H5 | `mobile/`；[移动发布](mobile/RELEASING.md)、[推送](mobile/PUSH_NOTIFICATIONS.md) |
| 产品文档与 React 站点 | `docs/`、`site/`；[文档与站点维护](docs/_internal/site-maintenance.md) |
| CI、测试、贡献与发布 | `.github/`、`scripts/pr/`、`scripts/quality-gate/`；[贡献指南](docs/internals/contributing.md) |
| Issue 路由 | [.agents/workflows/issue-router.md](.agents/workflows/issue-router.md) |
| 第三方原生代码 | [native/agent-desktop/AGENTS.md](native/agent-desktop/AGENTS.md)，保留来源和局部契约 |

## 实现与兼容边界

- 保持产品所有权与执行引擎分离：项目、工作区、会话、任务、团队、计划、记忆、扩展、通知和 IM 属于产品。不要新增第二个 `RuntimeHost`、session writer 或隐藏执行循环；提交执行前选择一个 execution binding，已接受或消费状态不明时不得静默切换并重放副作用。
- 存储目录通过已有集中解析入口；旧路径兼容集中在迁移层，不在业务代码散落路径优先级补丁。能力退役、数据不兼容或大型架构替换须单独说明影响并取得明确决策。
- 修改前核对输入输出、错误、状态所有权与持久化、资源创建/取消/释放、权限和调用方兼容；按证据保留、修复、合并或退役，不以改名、拆文件或行数衡量质量。退役前确认入口已迁移或不再使用，并验证旧数据、状态交接和资源清理。
- 复用现有模块与组件，遵循 TypeScript ESM、2 空格、无分号、组件 `PascalCase`、函数/hook/store `camelCase`；结构化数据使用结构化解析器。
- 不提交 `node_modules/`、构建目录、coverage、`artifacts/` 或 Rust `target/` 等生成输出。发布相关提交使用 Conventional Commit，产品分支使用 `fix/`、`feat/`、`docs/` 等前缀，不创建 `codex/` 分支。
- 外部代码按 EchoFlow 的具体功能需求适配，默认不通过 merge 同步外部仓库；内部正常分支集成不受此限制。不得用整仓、目录或整文件覆盖无声删除本站能力，也不得把回归测试改成相反要求。
- 引入记录须说明问题、来源与固定版本/提交、许可证及署名、采用范围、适配和回归证据；不带入外部品牌、账号、存储路径、开发指令或发布策略。第三方原始许可证和来源记录保留原文，局部指令不得扩大作用域。
- 区分现行规范、实现说明与历史研究。代码、测试、文档冲突时结合用户要求、已发布行为和历史证据调查，不把共同回退后的代码与测试当作正确事实。

## 用户状态安全

- 测试使用临时 `HOME`/`CLAUDE_CONFIG_DIR`、假凭据、fixture、mock/loopback transport，结束恢复环境与全局状态；不得使用或修改真实用户的配置、keychain、token、transcript、provider、adapter 绑定或 session。启动 server 的质量 lane 使用已有 sandbox 和真实状态写入检测。
- 将 `~/.claude/settings.json` 视为用户拥有的共享状态：保留未知字段、增量合并，不添加仓库拥有的全局 schema marker。
- 持久化 JSON、`localStorage`、app-config 形状变化须保留未知字段和未涉及设置，提供前向迁移、旧 fixture 回归并运行 `bun run check:persistence-upgrade`；保护旧数据、失败恢复与已接受副作用，不因精简删除校验。
- Repair/Doctor 自动修复默认拒绝；只允许改明确 allowlist 内可再生成的桌面 UI 状态。受保护数据走已审查、先备份的手动流程。
- Computer Use 在 macOS/Windows 只有一个应用授权边界：设置启用并确认 consent dialog 后授权所有应用，不再增加按应用 prompt、allowlist、denylist、分类等级或 host/helper 例外；全局禁用、OS 权限、目标和进程有效性检查仍适用。

## 区域约束

### CLI 与 IM

- `src/` 沿用 `entrypoints`、`commands`、`services`、`tools`、`utils`、`server` 的既有边界，不新增横切 helper。Agent loop、工具、权限、provider 与跨回合行为需真实入口的离线 mock/fixture 契约覆盖；必要场景放既有 `scripts/quality-gate/mock-llm/`。
- Adapter 平台行为留在对应包；新文本聊天平台实现共享 `common/chat-runtime.ts` 的 `ChatPort`，不重做配对、命令路由和流式转换。依赖安装到 `adapters/`，没有实际需要不改根依赖。

### 桌面

- UI 改动前必须阅读 [DESIGN.md](DESIGN.md)，组件归属、复用、可达性、五语言与测试契约只在那里维护；开发与构建入口见[桌面说明](desktop/README.md)。
- `desktop/electron/**` 不在 renderer 的 tsconfig 内；Electron/sidecar/打包按 impact 运行 native 检查，聊天与审批验证真实协议和 UI，不用 renderer 编译或单测替代 host 与跨进程证据。

### 移动端

- Expo、EAS、React Native API 按锁定版本查官方文档（[Expo 索引](https://docs.expo.dev/llms.txt)）；用 Bun / `bunx`，Expo 依赖通过 `bunx expo install` 解析兼容版本。
- 使用 Expo Router，只有路由放 `mobile/src/app/`；生成的 `ios/`、`android/` 不手工创建或编辑，原生配置使用 app config 和 config plugins。
- 安装移动依赖、EAS build/submit/update、签名和发布须明确授权。新增 native module 使用 development build，Expo Go、H5 或 mock 不能替代原生设备证据；独立版本和交付按上表发布文档执行。

### 文档与站点

- 修改 `docs/` 或 `site/` 前必须阅读[文档与站点维护规范](docs/_internal/site-maintenance.md)：内容格式、路由兼容、截图、Wandor 视觉与加载策略只在那里维护。
- `docs/` 是产品文档事实来源；维护者材料放 `docs/_internal/`，所有发布产物必须排除，公开页不链接它。站点不得包含私有状态、凭据或本地路径。

### CI 与仓库策略

- `scripts/pr/change-policy.ts` 是路径到检查路由的唯一事实来源。改 workflow 跑 `bun run check:policy`，有 `actionlint` 时同时运行。路由、门禁和失败处理见[贡献指南](docs/internals/contributing.md#pr-ci-合并门禁)。
- `pr-quality-gate` 是必需门禁。必需 PR 检查必须确定性、离线、无真实凭据或付费调用，使用匹配 Bun 与 frozen lockfile。`pull_request_target` 只用可信 base 检查元数据，不执行 PR head、不安装 PR 控制的依赖、不暴露 secrets。
- 不削弱覆盖率、测试路由、CODEOWNERS 或分支保护。Override 须维护者明确留档，nightly 改频率须维护者决定。修改 workflow 不等于获准修改仓库设置、ruleset、secrets 或必需检查。
- 同一交付范围先汇总改动和本地验证结果，避免分批推送反复触发 CI。PR 按改动范围运行必需检查，全量检查由发版候选或维护者手动触发。

## 验证与交接

- `src/`、`desktop/src/`、`adapters/` 的可执行生产改动需要同区域回归测试，维护者明确批准的例外除外。Bug 先复现或添加因目标缺陷失败的测试，无法复现如实说明；测试行为和受影响边界，不复制实现或改预期掩盖失败。
- 日常运行覆盖改动的定向测试，可用 `bun run check:impact` 确认受影响模块。相关代码和环境未变时复用已有结果。WSL 的全量验证交给 GitHub Actions，`bun run verify` 供显式运行。
- 定向测试无法覆盖布局或跨进程行为时，补浏览器或桌面 smoke。Live model 检查须先通过确定性检查并取得额度授权。
- 交付前检查 `git diff --check`、`git diff` 和 `git status --short`，说明改动、实际验证结果和剩余缺口。跨会话交接注明待办由谁接手。
- PR 门禁结果对应当前候选 SHA，发布另按[贡献指南](docs/internals/contributing.md)验收。
