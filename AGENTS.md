# 仓库规范

这是 EchoFlow 第一方代码的统一 Agent 规则入口：全仓底线在此维护，领域契约按任务读取下列链接，不复制规则。第三方目录保留自己的来源与局部规则，修改前阅读该目录的嵌套 `AGENTS.md` 及适用的祖先规则。

## 从这里开始

- 编辑前运行 `git status --short`，保留已有用户改动；先阅读实际实现、调用方和相关测试，再做范围内的最小完整修改。
- 任务完成包括目标行为、相关验证和修复本次改动造成的失败。范围内的本地编辑、隔离 fixture 检查和修复无需逐步审批；子任务完成不等于整个请求完成。
- 工具访问是能力，不是授权。创建或切换分支、提交、推送、打开或合并 PR、发布、修改仓库设置或使用在线 provider 额度，须有用户明确授权；已有授权覆盖的同一范围不重复确认。普通本地修复不要求建分支或提交。
- 使用 `package.json#packageManager` 指定的 Bun，先核对实际版本和路径。发现版本不符或缺依赖，明确报告要求和修复方式；在授权范围内完成环境准备后验证默认入口。临时指定版本只是诊断或一次性验证，不能声称默认环境已修好。需要网络的依赖准备与离线检查分开。
- 同一文件同一时间只有一个写入者；依赖安装、构建和完整门禁由一个执行者串行运行。恢复工作先收集已有后台结果，副作用状态不明时不盲目重放，不重复启动等价检查。

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

- `scripts/pr/change-policy.ts` 是路径到检查路由的唯一事实来源；路径前缀决定区域和阻塞规则，导入图只扩大检查范围，图失败则选择全部范围。工作流修改运行 policy，有 `actionlint` 时同时运行。
- `pr-quality-gate` 保持稳定必需状态：选中 job 必须成功，未选中必须明确跳过；不得将失败改报成功。提示性的 `coverage-checks` 不加入 gate 的 `needs`；分片总和仍跑完整检查，不为提速缩减覆盖。
- nightly 每日 19:00 UTC 及手动触发，运行全部确定性 lane 和模块图检查；不移入必需 PR 门禁，改频率须维护者决定。runtime job 先安装 ripgrep。
- 必需 PR 检查必须确定性、离线、无 provider 凭据或付费服务，使用匹配 Bun 与 frozen lockfile，不依赖真实模型、公共网络、仓库 secrets 或已保存用户状态。`pull_request_target` 只能用可信 base 检查元数据，不执行 PR head、不安装 PR 控制的依赖、不向其暴露 secrets。
- 不削弱覆盖率、测试路由、CODEOWNERS 或分支保护；override 须维护者明确留档。个人 CODEOWNER 的 PR 可免 `allow-cli-core-change`，身份与 CODEOWNERS 取可信 base，其他例外不变。
- 失败重跑用于诊断；`check:server` 的 `FLAKY` 和 `FAILED` 均保持失败，不放宽断言或超时掩盖问题。仅最后手段才带原因和 owner 隔离。修改 workflow 不等于获准修改仓库设置、ruleset、secrets 或必需检查。

## 验证

- `src/`、`desktop/src/`、`adapters/` 的可执行生产改动需要同区域回归测试，维护者明确批准的例外除外。Bug 先复现或添加因目标缺陷失败的测试，无法复现如实说明；测试行为和受影响边界，不复制实现或改预期掩盖失败。
- WSL 本地只做定向回归、`bun run check:impact` 和受影响模块验证；全量留给 GitHub Actions，不要求本地重复全量，也不将 `bun run verify` 作为默认动作。`verify` 保留显式运行的原有语义；相关代码与环境未变的本地证据可复用，不默认手动触发云端全量代替本地模块检查。
- PR-ready/push-ready 须区分本地模块验证完成与候选 SHA 对应的 PR Actions 门禁通过；未提交工作区不能复用旧 CI 绿灯。full validation 须注明范围和对应 Actions 证据，nightly 全量不等于 release 验收；具体证据要求见贡献指南。
- Live model 证据仅在确定性检查之后、明确授权额度时补充；在机器上找到凭据不等于获得授权。
- 单测不能证明用户可见布局或跨进程行为时补浏览器/桌面 smoke。临时浏览器操作用 `ego-browser` skill；`agent-browser` 仅用于既有已提交 smoke lane 和 `desktop/scripts/e2e-*-agent-browser.sh`。
- 缺依赖先按授权完成准备并验证；需要新增权限或无法解决时明确阻塞。无关既有失败须调查并报告，不擅自扩展产品改动。命令细节、证据格式和发布门禁见[贡献指南](docs/internals/contributing.md)。

## 交接

- 有代码/文档改动时，交付前检查 `git diff --check`、最终 `git diff` 和 `git status --short`。只读分析报告发现与证据，不套构建交接清单。
- 最终说明改了什么、验证结果和真实缺口，附实际运行的命令及观察结果或报告位置；区分 `passed`、`failed`、`skipped`、`blocked`、`not run`，不混淆 build、mock、live 或过时证据。
- 进度更新只说新增发现、下一步或阻塞，不重复最终矩阵。以当前用户目标核对是否完成；不把尚可处理的环境问题或一个阶段完成当成整个任务结束。
