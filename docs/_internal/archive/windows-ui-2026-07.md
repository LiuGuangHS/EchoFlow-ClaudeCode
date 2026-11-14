# Windows UI 验证历史（2026-07）

合并原 `tests/manual/` 下的 `v0.4.10-to-head-ui-functional-checklist.md` 与 `v0.4.10-to-head-ui-errors.md`。范围仍为 `v0.4.10..91829e91`，不是当前版本的验收清单；原始通过、失败、partial、blocked 和未执行项全部保留，不因迁移变更结论或重新授予真实模型额度。

原文只调整标题层级。代码、日志和产物路径相对仓库根目录；记录中的旧路径、行号和“当前”指当时现场，不能作为现行实现或新候选证据。

- [功能清单与执行记录](#functional-checklist)
- [缺陷、修复与验证限制](#defects-and-evidence)

<a id="functional-checklist"></a>

## v0.4.10 之后的人工界面功能测试 Checklist

> 分析范围：`v0.4.10..91829e91`（2026-07-20 至 2026-07-21）
>
> 基线：`v0.4.10`；候选：`91829e91`；共 11 个非合并提交
>
> 差异规模：233 files，+22,673 / -1,317
>
> 本清单只覆盖该范围新增或修复的用户可观察行为，不代替 v0.4.10 全量回归。

### 1. 测试记录

| 项目 | 填写内容 |
|---|---|
| 测试人 / 日期 | Codex + Computer Use / 2026-07-21 |
| 安装包版本 / commit | `91829e91a41d0c4dcba2680e82f889ed7220e332` |
| 操作系统 / 架构 | Windows 11 / x64 |
| 安装方式 | 隔离开发构建；缓存 Electron 42.3（声明的 42.4 本地二进制不可用） |
| 测试 Provider / 模型 | 真实 DeepSeek / `deepseek-v4-pro`（179 ms）；真实 MiniMax / `MiniMax-M3`（1,349 ms）；均已取得真实回复 |
| 测试配置目录 | `artifacts/manual-ui-91829e91/config`；独立 Electron user-data-dir |
| 总体结论 | executed with recorded limits：DeepSeek、MiniMax 真实编程任务、附件恢复、多模态、SubAgent、Task 并发和 Windows 长空闲恢复主链路已通过；BUG-001～BUG-011 均已修复并取得聚焦或真实 UI 证据。最新完整质量门禁全部通过，但仍有宠物本体拖动/多显示器、代理/PAC、IM/H5 故障注入、CLI/TUI 等未执行或仅部分执行项，不能表述为“所有功能无条件通过” |

结果标记约定：完成每项后在复选框后追加 `passed`、`failed`、`blocked` 或 `skipped`，并附截图、录屏、日志位置或缺陷编号。`blocked` 与 `skipped` 不计为通过。

### 2. 提交分析与覆盖映射

| 提交 | 更新类型 | 用户可观察变化 | 对应用例 |
|---|---|---|---|
| `36560c09` | 功能 | 新增可交互桌面宠物、任务状态面板、自定义宠物导入 | PET-01～PET-10 |
| `71dc2fd4` | 修复 | Kimi Code 预设升级到 K3、API Key 鉴权和 262K 上下文 | PRO-02～PRO-03 |
| `8995f56d` | 修复 | Provider 返回空/零 usage 时仍从会话记录估算上下文 | CTX-01 |
| `bf128cb9` | 修复 | 服务端回放带附件的用户消息时不再重复显示 | ATT-01～ATT-02 |
| `6b725a0b` | 修复 | 运行中的 SubAgent 可打开详情并持续显示新记录 | SUB-01～SUB-03 |
| `7d272e0f` | 修复 | 拒绝工具权限后当前轮正确中断并回到可输入状态 | DENY-01～DENY-02 |
| `ba8917f1` | 修复 | Provider 创建入口不再依赖运行时 presets 请求 | PRO-01、PRO-03 |
| `727bcea0` | 修复 | Windows Renderer、终端、代理及 IM WebSocket 生命周期恢复 | WIN-01～WIN-05 |
| `1270ced4` | 修复 | Task V2 工具常驻、任务读写串行、桌面任务状态抗乱序/抖动 | TASK-01～TASK-03 |
| `7f6fdada` | 功能 | 桌面 Agent CRUD、作用域、逐 Agent 模型与 effort、热重载，以及 CLI/TUI Agent effort 与编辑字段保真 | AGT-01～AGT-08、CLI-01～CLI-03 |
| `91829e91` | 修复 | 桌面会话恢复时保留文件/目录/PDF 内容，同时过滤终端反馈分享内容 | ATT-03～ATT-05 |

### 3. 测试准备与安全边界

- [x] 使用专用测试账号、临时工作区和独立 `CLAUDE_CONFIG_DIR`，不得读取或改写开发者真实的 `~/.claude`、凭据、会话及 Agent 定义。 — passed：配置、会话与 Electron user-data 均在 `artifacts/manual-ui-91829e91/`。
- [x] 准备一个可安全写入的 Git 测试项目，包含一份带唯一 canary 文本的小文件、一个目录和一个小型 PDF。 — passed：文本、目录和 PDF canary 已创建；PDF 已渲染目检。
- [ ] 准备透明背景 PNG/WebP（32～4096 px、8 MB 内）以及一份不合规图片；动画图集测试另准备 1536×2288、8 列×11 行的 v2 PNG/WebP。
- [x] 准备至少两个测试 Provider；Kimi 实际请求和任何 live model 测试仅在维护者明确授权额度后执行。 — passed：隔离配置中 DeepSeek 与 MiniMax 均完成真实连接测试；维护者已明确授权额度。
- [ ] Windows 故障注入只对专用测试构建执行；提前保存工作并记录主进程、Renderer、Sidecar 的 PID。
- [ ] 若测试代理/PAC，使用受控代理和测试地址；测试结束后恢复系统代理设置。

### 4. P0 核心流程

#### 桌面宠物

- [x] **PET-01｜入口、开关与持久化** — passed：确认 4 个内置宠物和独立透明宠物窗口；完整结束隔离 Electron/Sidecar 并用新构建重启后，显示开关、当前内置宠物、192px 大小和动画偏好均保持。当前显示的 Dada 机器人来自仓库内置 `dada-code` 资源，不是缺图 fallback；另一台电脑自行导入的猫/狗包属于 `${CLAUDE_CONFIG_DIR}/cc-haha/pets` 本地用户状态，不会随 Git 自动同步。
- [ ] **PET-02｜窗口交互与位置恢复**：分别验证短按宠物触发挥手、悬停/移动鼠标触发视线或动作、拖动宠物移动窗口；拖动不能误触单击动作，透明非宠物区域应允许点击下层窗口。将宠物拖到屏幕边缘和第二显示器后重启，位置应恢复且保持在可见工作区；拔除显示器或改变分辨率后窗口被钳制回可见区域。 — partial：BUG-010 修复后 Win32 `topmost=True`；BUG-011 修复后 Computer Use 已能真实鼠标命中任务圆点和关闭按钮，并完成两轮展开/关闭。宠物本体短按、悬停、拖动、透明区透传和多显示器恢复仍未完成。
- [ ] **PET-03｜任务状态与导航**：同时制造“工作中、等待用户处理、失败/需关注、等待审阅”状态，确认宠物动作/提示匹配且优先级为“等待处理 → 失败 → 等待审阅 → 工作中”；有多个非空闲会话时展开面板最多列出最近 9 个任务，点击整行聚焦主窗口及对应会话。
- [ ] **PET-04｜任务卡隐藏与关闭宠物**：默认不展示任务卡；有活跃任务时只显示宠物右上角数字圆点，点击圆点展开任务卡，点击下箭头隐藏卡片且不能改变任务状态。右键菜单关闭宠物后设置页开关立即同步为关闭，正在执行的任务不能被停止。 — partial：真实 Windows Electron + DeepSeek 编程任务中，Computer Use 已完成两轮“数字圆点展开 → 下箭头隐藏 → 数字圆点恢复”，最终 `showTaskPanel: false` 已落盘；隐藏卡片后任务继续执行 Bun 测试并返回 `2 pass / 0 fail`、`PET_CLOSE_SMOKE_OK`。右键关闭整个宠物及设置页同步本轮未复测。

#### 附件与会话连续性

- [x] **ATT-01｜图片消息回放去重**：发送“检查这张截图”并附带本地图片，等待服务端回放/重连；界面始终只有一个用户消息气泡和一个附件预览，不显示 `[Image source: ...]` 或内部绝对路径文本。 — passed：在首轮即选用 MiniMax-M3 的全新会话中只附加一张 `canary.png`，UI 仅出现一个用户气泡和一个附件，真实模型准确返回第二行标识 `PDF_CANARY_91829E91`。trace 显示 Anthropic `/v1/messages` 请求只有 1 个 image block、HTTP 200，且请求/响应均无 `[Unsupported Image]`。此前失败来自复用曾由 DeepSeek 生成 `[Unsupported Image]` 的跨 Provider 历史且同图被重复附加，不是 MiniMax 多模态接口限制，详见 PROVIDER-001。
- [x] **ATT-02｜多文件物化路径去重**：一次发送两个仅含 data 的不同类型文件，确认上传后仍只有一个用户气泡、两个名称正确的附件 chip；UUID 前缀的服务端上传路径不能出现在正文。随后发送同提示但不同附件，不能被误判为重复消息。 — passed：在全新 MiniMax-M3 会话中通过系统文件选择器一次选择 `canary.txt` 与 `resume-secret.txt`；UI 只有一个用户气泡和两个名称正确的附件 chip，正文未暴露物化路径，真实模型不调用工具即准确返回两个文件各自的 canary。
- [x] **ATT-03｜完全退出后恢复附件上下文**：在桌面端发送带唯一 canary 的文件，等待回复和持久化后完全退出应用；重启恢复同一会话，不重新附加文件，追问 canary。模型应能依据原附件内容回答，而不只是看到 `@路径`。 — passed：发送 `resume-secret.txt` 后完整退出并重启 Electron/Sidecar，恢复同一会话且不重新附加；真实模型仍回答 `HARBOR-PLUM-7319`，附件 chip 与用户消息未重复。
- [x] **ATT-04｜目录与 PDF 恢复**：分别用目录和 PDF 重复 ATT-03；历史中附件引用应正常显示，重启后的追问仍能使用原内容，且用户消息不重复。 — passed：完整退出并重启后，真实模型从已恢复的 PDF 回答 `PDF_CANARY_91829E91`，从目录回答 `FOLDER_CANARY_91829E91`；历史附件结构保持且用户消息未重复。

#### SubAgent、权限拒绝与 Task

- [x] **SUB-01｜运行中详情**：启动一个持续至少 10 秒且会调用工具的 SubAgent，立即从活动面板点击运行项。详情标签应在任务完成前打开，显示“运行中”、Agent/来源/任务信息、提示词和已产生的运行记录。 — passed：真实 MiniMax 编程会话启动 SubAgent 后，在运行中从 Activity 打开详情；页面显示 prompt、source、agent、task、token 和已产生的 Read/Bash 记录。首次因隔离项目尚无 HEAD 导致 worktree 启动失败，用户选择不使用 worktree 后重新运行成功。
- [x] **SUB-02｜实时刷新与完成**：保持详情页打开，确认新增文本和工具调用约每 2 秒出现；task id 晚到时页面自动接入实时记录。完成后状态、结果、更新时间和可用的 token usage 正确，且不需要关闭重开。 — passed：详情保持打开直至完成，后续 Read/Bash 与结果可见；完成态显示完整 transcript、报告及 11,473 tokens，点击刷新后约 2 秒重新载入且无需关闭标签。
- [x] **DENY-01｜拒绝普通工具** — passed：真实 DeepSeek 请求 Write `denied.txt`，Computer Use 点击 Deny；工具卡显示 `User denied via UI error`，Shell 确认目标文件不存在，输入框恢复可用。
- [x] **DENY-02｜拒绝后继续聊天** — passed：拒绝后立即发送无工具追问，真实模型返回 `CHAT_CONTINUES`；没有残留 pending 权限、持续运行态或缺少 tool result 错误。计划确认拒绝仍待其他用例覆盖。
- [x] **TASK-01｜跨 Provider 完整生命周期与并发读写**：分别在至少两个 Provider 下让模型创建、读取、列出、更新并完成 Task V2；另让真实 Provider 在同一 assistant turn 并发发出两个 create/update，再紧随 get/list，确认写操作串行且读取不会看到中间态或丢失态。工具无需 ToolSearch 即可调用，任务栏状态与工具结果一致，消息结束时未完成的工具状态会再刷新一次。 — passed：真实 MiniMax-M3 与 DeepSeek 编程会话均调用 TaskCreate/List/Get/Update，分别将 3 个任务更新为 completed；任务栏同步显示 3 项绿色完成。两条流程均执行真实 `bun test`，各为 2 passed / 0 failed，最终分别返回 `REAL_TASK_AGENT_FLOW_OK` 与 `DEEPSEEK_TASK_V2_OK`。随后在修复版 Windows sidecar 上，真实 MiniMax 在同一轮并发执行 2 个 TaskCreate、TaskList + 2 个 TaskGet、并发 2 个 TaskUpdate 和最终 TaskList；两项均完整且为绿色 completed，返回 `TASK_PARALLEL_IDLE0_OK`。
- [ ] **TASK-02｜切换会话与完成后收起**：任务运行时切换到另一会话，上一会话任务应立即消失且不串入新会话；回到原会话状态恢复。关闭已完成任务列表后，后续轮询不能让它再次弹出。

#### Agent 管理及逐 Agent 配置

- [ ] **AGT-01｜浏览与来源优先级**：打开“设置 → Agents”，确认总数、生效数和来源分组正确；创建同名用户级与项目级 Agent，二者均可见，项目级显示为生效、用户级显示被项目来源覆盖。对可用来源抽查完整优先级：policy → CLI flag → project → user → plugin → built-in。
- [x] **AGT-02｜用户级创建**：创建名称含下划线的用户 Agent，填写描述、system prompt、模型、effort、工具模式和颜色；保存后自动选中刷新后的定义，详情值正确，文件写入隔离测试配置的 `agents` 目录。 — passed：在隔离配置创建 `configured_probe`，设置 fable、high、Read/Grep/Bash 与紫色；保存后自动进入详情且文件只写入隔离 `agents` 目录，随后从 UI 删除。
- [ ] **AGT-03｜项目级创建**：没有活动项目时项目范围必须禁用；打开项目会话后创建项目 Agent，目标路径显示当前项目，文件只写入该项目 `.claude/agents/`，其他项目不可见或不生效。
- [ ] **AGT-04｜模型、effort 与工具模式**：逐项确认模型包含继承、fable、opus、sonnet、haiku、自定义模型 ID；effort 包含继承、low、medium、high、xhigh、max；工具支持全部继承、禁用全部、自定义列表。缺少自定义模型 ID 或自定义工具时不能保存。 — partial：已真实保存并回读 fable、high、自定义 Read/Grep/Bash；其余模型/effort 枚举和缺失自定义值拦截尚未逐项执行。
- [ ] **AGT-05｜热重载并执行**：在活动会话中保存 Agent 后立即 spawn，不重启应用；新定义应可被发现并完成任务。修改 system prompt、模型或 effort 后再次 spawn，下一次运行使用新定义；从真实 Provider trace/运行详情核验 definition 的 model 与 effort 已实际应用，而不只核对表单值。
- [ ] **AGT-06｜编辑回继承与字段保真**：把模型、effort、颜色和工具改回继承/默认；重新打开详情确认对应配置显示为继承，frontmatter 中相应字段被删除。编辑描述时不得破坏未知高级 frontmatter、空 tools、带括号/逗号的工具名或原 system prompt。
- [ ] **AGT-07｜只读与删除**：内置、插件、托管策略、CLI 参数等来源只允许查看且没有可执行的编辑/删除；用户级和项目级可删除，确认弹窗展示准确目标，删除后列表刷新且文件消失。 — partial：内置 Agent 详情确认只读；用户级 `configured_probe` 已通过 UI 删除并从列表消失。插件/托管策略/CLI 来源及项目级删除尚未覆盖。

### 5. P1 功能与边界流程

#### 桌面宠物高级用例

- [ ] **PET-05｜外观与无动画**：将大小从 96 调到 192 px，悬浮窗实时反映且不裁切；关闭“播放动画”后内置与自定义宠物均静止但仍可点击、拖动和导航任务。
- [x] **PET-06｜单图创建轻动画宠物**：选择“添加宠物 → 用一张图片制作轻动画”，填写合法 ID、名称和描述，导入合规 PNG/WebP；创建后出现在“你的宠物”、自动选中并可显示。确认整个过程不调用当前聊天模型。 — passed：在隔离 Electron 中用仓库真实 `icon.png`（46,061 bytes，SHA-256 `26D6DCC091FB0971ACB78A3A42526F55CCDD58E812C2D15EE09458CFE0E7C2C7`）创建 `manual-canary`；列表立即出现并自动选中，隔离配置生成 `pet.json` + `pet.png`，manifest 为 single-image v1 / `soft-spring-v1`，会话时间戳及聊天内容未变化。
- [ ] **PET-07｜专业图集导入**：导入合法 1536×2288、8×11 v2 图集；确认逐帧动作、左右跑动、失败、等待、工作、复核及视线方向没有错格、漂移或透明背景异常。
- [ ] **PET-08｜输入校验与损坏包**：非法 ID、超 8 MB、尺寸越界、错误图集尺寸/格式均应在对话框中给出错误且不创建半成品。向自定义目录放入无效包后刷新，应跳过并显示无效数量；“打开文件夹”打开隔离配置下的正确目录。 — partial：非法下划线 ID 时提交按钮保持 disabled；选择真实损坏的 79-byte `.png` 后对话框保留并显示 `The pet image header is invalid`，未生成半成品。超限、错误图集、损坏包刷新和打开目录仍待执行。
- [ ] **PET-09｜非桌面能力边界**：在浏览器/H5 打开同一设置页，宠物启停、创建和打开本地目录等桌面专属操作应禁用或不可用，不应调用 Electron IPC、白屏或影响桌面端已保存偏好。
- [ ] **PET-10｜加载/保存/原生调用失败恢复**：让 preferences 或自定义宠物目录首次加载失败，页面应保留已有内容并提供 Retry；保存失败时开关和选择应回滚；原生 show/hide/context-menu 失败时宠物窗口与设置开关恢复到一致状态且显示可重试错误。

#### Provider 与上下文

- [x] **PRO-01｜内置 presets 与创建入口**：首次进入 Provider 设置时“添加 Provider”立即可用，弹窗展示随桌面包内置的预设；确认页面不需要先成功请求 `/api/providers/presets` 才能打开创建界面。 — passed：Computer Use 反复打开成功，DeepSeek、Zhipu GLM、Kimi、MiniMax、LM Studio、Ollama、Custom、接口AI、胜算云、TeamoRouter 均可见。
- [ ] **PRO-02｜Kimi K3 预设**：选择 Kimi，确认 Base URL 为 `https://api.kimi.com/coding/`，主模型及 Haiku/Sonnet/Opus 均为 `k3`，鉴权为 API Key，官网/密钥入口指向 Kimi Code，上下文上限识别为 262,144，并可选择到 `max` effort。已保存的旧 Kimi URL、模型和 auth token 配置在编辑时不得被静默覆盖。 — partial：Computer Use 确认新建预设的 Base URL、API Key 鉴权、四个 `k3` 模型、`k3: 262,144`，以及 capability preview 包含 `effort,max_effort`；旧配置保真和密钥官网跳转仍待执行。
- [ ] **PRO-03｜旧/未知 preset 编辑回退**：打开一个 presetId 已不存在或 presets 加载异常的旧 Provider，编辑表单仍应显示已有 Base URL、模型和鉴权值，不白屏、不丢配置；保存失败与“弹窗可打开”分别记录。
- [ ] **CTX-01｜空/零 usage 的上下文估算**：用真实且确实返回 `{}` 或全零 usage 的 Provider/现场 transcript 建立有明显长度的会话，关闭并恢复；上下文指示器不得空白或归零，应按 transcript 和实际运行模型窗口给出合理非零估算。继续对话后估算应单调合理变化，不能错误显示已满。找不到这种真实 Provider 证据时标记 blocked，不能用 mock 结果冒充人工通过。

#### SubAgent 与任务异常边界

- [ ] **SUB-03｜错误、切换与空记录**：运行中详情刷新临时失败时标签保持打开、已有内容保留并可重试；快速切换两个 SubAgent 时旧响应不能覆盖当前页；确实无本地记录时显示明确空状态而非崩溃。
- [ ] **TASK-03｜轮询抖动与乱序**：在测试代理中延迟旧请求并让新请求先返回，界面不得被旧状态回滚；临时任务轮询失败时保留最后已知任务且不闪空，首次进入新会话请求失败则保持空列表而非带入旧任务。

#### Agent 管理边界

- [ ] **AGT-08｜校验、错误与非阻塞警告**：名称超过 64 位或格式非法、描述为空、新建时 system prompt 为空均应前端拦截。模拟保存失败时表单保持打开并显示错误；模拟定义已写入但热重载/刷新失败时显示非阻塞警告和重试，已保存文件不得回滚。

### 6. P1 Windows / Electron 稳定性专项

- [x] **WIN-01｜Renderer 异常退出自动恢复**：在 Windows 专用测试构建中仅终止 Renderer 子进程。主窗口应自动 reload 一次并恢复可操作，不应长期白屏、退出主进程或重复 reload；会话标签、设置和历史从持久状态恢复。隔离配置的 `cc-haha/diagnostics/electron-host.log` 应记录 process-gone、recovery-started 和 recovery-loaded。 — passed：关闭宠物窗口后确认隔离 Electron 仅有一个主 Renderer（PID 40812），只终止该子进程；3 秒内新 Renderer（PID 5696）启动，Settings/Pets 页面、两个会话标签、Huhu/192px 与关闭状态均恢复且可操作。日志依次记录 `process-gone`、`recovery-started`、`recovery-loaded`。
- [ ] **WIN-02｜短暂与持续无响应**：制造短于 10 秒的 Renderer 卡顿后恢复，应用不应误 reload；再制造持续超过约 10 秒的无响应，应只自动恢复一次。若再次故障，显示“界面恢复失败 / Interface Recovery Failed”双语错误框并留下诊断记录。
- [ ] **WIN-03｜终端与窗口销毁竞态**：让内置终端持续输出，同时关闭终端标签、reload Renderer、关闭主窗口各一次；不得出现 `Object has been destroyed`、主进程崩溃、幽灵输出或无法再次打开终端。
- [ ] **WIN-04｜系统代理/PAC 波动**：启用受控系统代理或 PAC，聊天请求建立期间切换节点、断开 CONNECT、短暂断网再恢复；应用不得弹出主进程 JavaScript 异常，恢复网络后无需重启即可再次请求，代理认证失败不得静默回退 DIRECT。
- [ ] **WIN-05｜IM WebSocket 握手中销毁**：启动 IM/H5 连接后，在 WebSocket 尚处于 CONNECTING 时切换会话、重置或退出适配器；不得产生未处理 `error`、主进程退出或残留连接，重连后新会话可正常收发。
- [x] **WIN-06｜Context 超时不能拖垮本地 REST** — passed：Chromium netlog 将故障精确定位为复用已空闲约 104 秒、但 Bun 已按 60 秒 `idleTimeout` 停止处理的 HTTP/1.1 socket；`GET /api/tasks/lists/<session>` 写入后等待响应头 120,011 ms，turn-checkpoints/workspace-status 同期超时。改为 `idleTimeout: 0` 后重建真实 Windows sidecar，并合并同一会话任务轮询；应用空闲 85 秒后执行 MiniMax 并发 Task 全流程，task-list 请求最慢 235 ms，所有本地 API 最慢 578 ms。运行 137 秒后仍为 0 `CloseWait` / 0 `FinWait2`、无新增 timeout。再用项目声明版本的官方 Bun 1.3.14 Windows binary 编译 sidecar，空闲 106 秒后真实 MiniMax 返回 `IDLE0_BUN1314_OK`，运行 131 秒仍为 0 / 0 且无新增 timeout，详见 BUG-009。

### 7. P2 可访问性、隐私与兼容性

- [ ] **A11Y-01｜Reduced Motion**：系统开启 reduced-motion 后，内置和自定义宠物都不播放动画；运行中的 SubAgent 状态仍可通过文字/非动画标记识别。
- [ ] **I18N-01｜新增界面语言**：依次切换简中、繁中、英文、日文、韩文，抽查宠物、Agent 管理和 SubAgent 详情；不得显示原始 i18n key、截断关键按钮或出现不可读混排。
- [ ] **ATT-05｜终端 FeedbackSurvey 转录分享隐私**：从 CLI/Ink 的 FeedbackSurvey 入口在隔离环境中提交包含附件的反馈分享，检查测试接收端或抓包证据；结构化消息和原始 JSONL 均不得包含 `type: attachment` 记录、附件正文或本地敏感路径，普通对话和 SubAgent 信息仍可提交。此项不是桌面 Settings/聊天反馈入口。

#### CLI / TUI Agent 行为

- [ ] **CLI-01｜effort 参数与 model-info**：在终端真实运行 `--effort xhigh`、`--effort max` 和合法整数，并验证非法值被明确拒绝；headless/model-info 应只展示当前模型实际支持的 effort levels。
- [ ] **CLI-02｜Agent effort 启动与恢复**：用 `--agent` 启动真实 Provider 编程任务，核验 Agent effort 生效；显式 CLI `--effort` 应按约定优先。退出并 resume 后从 trace 再次确认 model/effort 不丢失。
- [ ] **CLI-03｜TUI Agent 编辑字段保真**：在终端 AgentEditor 中编辑含 Markdown tools、system prompt 和未知高级 frontmatter 的 Agent；保存并重开后字段和值保持，不被简化或损坏。

### 8. 已知风险与待确认项

- [ ] **RISK-01｜Agent effort 优先级契约**：当前实现及测试允许“标记为 request-scoped 的 Agent effort”覆盖 `CLAUDE_CODE_EFFORT_LEVEL`，但 `docs/agent/01-usage-guide.md` 写的是环境变量优先。使用同一支持 effort 的模型设置会话 `high`、Agent `xhigh`，记录实际请求值；发布前由维护者确认期望契约并统一代码、测试和中英文文档。本清单不把存在冲突的任一结果直接判为通过。
- [ ] **RISK-02｜live-provider 证据**：配置值检查、mock 或本地契约测试不等同真实 Kimi/Provider 请求。没有额度授权时标记 `blocked` 或 `skipped`，不得写成 passed。
- [ ] **RISK-03｜平台证据**：Renderer、系统代理、终端 native 模块的自动化结果不等同 Windows 实机；没有 Windows 安装包实测时 WIN 项不得写成 passed。

### 9. 通常不需要普通 UI 人工执行的内部变化

- CI/release workflow、Electron 输出目录 guard、Pet atlas 组装脚本和构建清理。
- SDK schema、模型 alias、Provider capability 环境变量等内部协议传播；Task `alwaysLoad`/并发标记和 CLI effort 的用户可见结果已分别纳入 TASK-01、CLI-01～CLI-03。
- WebSocket teardown error sink、代理 socket 清理和销毁后 terminal IPC 防护已合并到 WIN-03～WIN-05，不在日常跨平台冒烟中重复拆项。
- 自动化测试本身不是人工通过证据；人工结论只记录本清单实际执行结果。

### 10. 完成判定

- [ ] 所有适用于发布平台的 P0 项为 `passed`，没有未解释的 failed/blocked。
- [ ] P1/P2 的 failed、blocked、skipped 均有缺陷编号、风险接受人或明确后续计划。
- [ ] 每个提交至少有一条人工证据，或在第 9 节明确归为内部变化。
- [ ] 回归后重新核对 commit；若 HEAD 已超过 `91829e91`，先补做新增提交分析再沿用本清单。

### 11. 本轮执行收口

- [x] 回归结束时 HEAD 仍为 `91829e91`，提交分析范围未漂移。
- [x] 真实 Provider 证据来自 DeepSeek 与 MiniMax；图片、多附件、恢复、权限拒绝、SubAgent、Task V2 与真实代码测试均未使用 mock。
- [x] 完整重跑 `check:desktop`、`check:server`、`check:provider-contract`、`check:chat-contract`、`check:adapters`、`check:native`、`check:coverage`，均通过；`check:impact` 仅因 CLI core 变更需要 PR 标签和维护者批准而处于 policy blocked，不是测试失败。
- [ ] 发布签字仍需处理本清单未勾选/partial 项；尤其 PET-02～05/07/09/10、WIN-02～05、CLI-01～03 和 H5 长连接资源风险不能从本轮证据外推为 passed。

<a id="defects-and-evidence"></a>

## v0.4.10 之后人工界面测试缺陷与修复记录

> 测试范围：`v0.4.10..91829e91`
>
> 平台：Windows 11 x64；隔离 `CLAUDE_CONFIG_DIR` 与 Electron `user-data-dir`
>
> 状态：本轮执行已收口。DeepSeek、MiniMax 真实编程任务、附件恢复、多模态、SubAgent、Task 并发与 Windows 长空闲恢复均有真实 UI 证据；BUG-001～BUG-011 已修复并验证。未执行或仅部分执行的硬件、故障注入、CLI/TUI 用例仍按限制保留，不冒充 passed。

### BUG-001｜React StrictMode 下内置终端首次打开为空白

- 严重程度：P0
- 状态：fixed / verified
- 对应用例：WIN-03、终端基础冒烟
- 测试场景：开发构建中打开顶部内置终端标签。
- 实际结果：终端区域为空白且没有可用会话；刷新设置页不能恢复。
- 期望结果：终端只创建一个 runtime，显示 `Running`、shell、cwd 和可交互提示符。
- 根因：React StrictMode 首次挂载会重放 effect。第一次 cleanup 立即销毁共享 terminal runtime，第二次 effect 继续持有已经失效的对象，因而无法重新启动。
- 修复：为组件 effect 增加生命周期版本；普通真实卸载仍在 microtask 中销毁 runtime，StrictMode replay 的过期 cleanup 则不再销毁当前 runtime。
- 变更文件：
  - `desktop/src/pages/TerminalSettings.tsx`
  - `desktop/src/pages/TerminalSettings.test.tsx`
- 验证证据：
  - 聚焦 Vitest：17/17 passed。
  - TypeScript `tsc --noEmit` passed。
  - Computer Use 复验：顶部终端显示 `Running`、`C:\WINDOWS\system32\cmd.exe` 和隔离配置目录提示符；Restart 后仍为 `Running`。
  - 完整 `bun run check:desktop`：2430 passed、2 skipped、0 failed，production build passed。

### BUG-002｜切换语言后 Settings 顶部标签仍保留旧中文标题

- 严重程度：P1
- 状态：fixed / verified
- 对应用例：I18N-01
- 测试场景：应用最初为简体中文，打开设置标签后切换到 English。
- 实际结果：设置页正文已经变为英文，但顶部标签仍显示持久化的“设置”。
- 期望结果：顶部标签与当前 locale 同步显示 `Settings`，关闭按钮的无障碍名称也同步更新。
- 根因：设置标签直接渲染创建标签时保存的 `tab.title`，没有根据当前 locale 重新读取 `settings.title`。
- 修复：设置类型标签动态渲染当前 `t('settings.title')`，同时用于 close button 的 aria-label；普通会话标签仍保留原标题。
- 变更文件：
  - `desktop/src/components/layout/TabBar.tsx`
  - `desktop/src/components/layout/TabBar.test.tsx`
- 验证证据：
  - 聚焦 Vitest：40/40 passed。
  - TypeScript `tsc --noEmit` passed。
  - Computer Use 复验：切换 English 后顶部显示 `Settings`，关闭按钮为 `Close Settings`。
  - 完整 `bun run check:desktop`：passed。

### QA-001｜Windows 完整桌面门禁的跨平台测试夹具失败

- 严重程度：测试基础设施
- 状态：fixed / verified
- 首次结果：`bun run check:desktop` 为 12 failed、2418 passed，因测试失败未进入最终 build。
- 分类：
  - 7 个稳定失败来自测试夹具把 POSIX/macOS 路径、权限位或 `PATH` 大小写写死到 Windows。
  - 2 个 `petWindow` 失败来自源码字符串断言写死 LF，不能处理 Windows CRLF。
  - 3 个 Workspace 测试在全量并发下渲染约 5001、1996、2300 个 DOM 行，触发 5/20 秒超时；聚焦运行均通过。
- 修复原则：没有发现对应生产逻辑错误，因此只修正测试的跨平台构造和无必要的大规模 DOM 夹具，没有改生产代码，也没有简单扩大超时。
- 变更文件：
  - `desktop/scripts/electron-output-guard.test.ts`
  - `desktop/electron/services/pets.test.ts`
  - `desktop/electron/services/sidecarManager.test.ts`
  - `desktop/electron/services/terminal.test.ts`
  - `desktop/electron/services/petWindow.test.ts`
  - `desktop/src/components/workspace/WorkspaceDiffSurface.test.tsx`
  - `desktop/src/components/workspace/WorkspacePanel.test.tsx`
- 验证证据：
  - 路径/权限聚焦测试：98 passed、1 macOS-only skipped。
  - petWindow/Workspace 聚焦测试：95/95 passed；同组 coverage 运行 95/95 passed。
  - 修复后完整 `check:desktop`：2430 passed、2 skipped、0 failed；最终 `tsc -b` 与 Vite production build passed。
  - 紧接着的全量 JSON 复跑：524/524 suites passed，2430 passed、2 skipped。

### 排除的环境误报

#### ENV-001｜旧 Sidecar 导致 Pets 无法加载

- 初始现象：设置页显示“无法加载宠物”。
- 结论：不是候选代码缺陷。Electron 主进程使用当前源码，但启动时加载的是 2026-07-18 的旧 `claude-sidecar` 二进制，早于测试范围内的服务端改动。
- 处置：备份旧二进制后执行 `bun run build:sidecars`，仅在隔离测试实例中换入当前 Sidecar。
- 复验：4 个内置宠物 Dada、Huhu、Bubu、Huihui 正常出现；桌面宠物窗口可打开。

#### ENV-002｜旧 Sidecar 导致 Agent 保存后前端读取 `agentType` 报错

- 初始现象：创建 Agent 后弹出 `Cannot read properties of undefined (reading 'agentType')`。
- 结论：不是候选代码缺陷。旧 Sidecar 的 `POST /api/agents` 返回 `{ok:true}`，当前桌面端期望 `{agent: ...}`。
- 处置：同 ENV-001，重建当前 Sidecar。
- 复验：用户 Agent `manual_reviewer` 可创建、查看、编辑回继承；内置 Agent 保持只读。

### BUG-003｜权限模式控制请求被拒绝后遗留 pending confirmation

- 严重程度：P1
- 状态：fixed / verified
- 对应用例：DENY-01、DENY-02、权限模式切换
- 发现方式：Windows `check:coverage` 在连续执行“确认成功 → CLI 拒绝 → 确认超时”三个权限模式测试时稳定不退出。
- 根因：`ConversationService.setPermissionMode()` 在创建 confirmation Promise 后调用 `requestControl()`；CLI 拒绝 control request 时，catch 只清理 timer/callback，没有 settle 已创建的 confirmation Promise。在 coverage 异步跟踪下，该 pending Promise 会让后续计时测试进入持续 CPU 状态。
- 修复：保存 confirmation reject 句柄，引入 settled guard 和显式 `cancelConfirmation(reason)`；control request 失败时清理 callback/timer、拒绝 confirmation，并原样重新抛出原始 CLI 错误。确认超时计时器只在 control request 成功后按总预算剩余时间启动。
- 变更文件：
  - `src/server/services/conversationService.ts`
  - `src/server/__tests__/conversations.test.ts`
- 验证证据：
  - 三个权限模式顺序回归：3 passed、0 failed。
  - 同组三用例 coverage：3 passed、0 failed，不再挂起。
  - 完整 `conversations.test.ts` coverage：96 个具名测试全部完成并通过；Windows afterAll 临时目录清理另有一次 `EBUSY`，不属于行为断言失败。
  - 回归额外断言 CLI 拒绝后 `outputCallbacks` 为空、`pendingPermissionModeChanges` 为空。

### QA-002｜Windows `check:coverage` 的 root-server 阶段异常慢

- 严重程度：测试基础设施
- 状态：fixed / verified
- 实际结果：单次 `bun run check:coverage` 在第一个 `root-server` 覆盖率套件持续 22 分钟，没有生成 `coverage.log` 或 lcov 产物；Bun 进程保持约单核满载、约 500 MB working set 且响应正常。
- 历史对照：同机历史 coverage 报告中 root-server 阶段约为 135、151、190 秒。
- runner 限制：`scripts/quality-gate/coverage.ts` 会把整个子进程 stdout/stderr 缓冲到退出后再写日志，且没有套件级 timeout，所以执行中没有可用于定位最后用例的进度产物。
- 处置：确认 PID、父子关系和完整 command line 后，仅终止本次 `check:coverage` 的三个 Bun 进程；没有启动重复运行，也没有影响 Vite、Electron 或其他测试。
- 根因定位：连续权限模式用例会触发 BUG-003 的 pending confirmation 泄漏；定向 coverage 修复后不再挂起。
- 结论：首次覆盖率门禁记为 blocked/timeout；修复后完整重跑在 130.2 秒内完成，5/5 suites passed，changed lines 95.56%（43/45）。

### BUG-004｜Bun 下销毁 CONNECTING WebSocket 会永久停在 CLOSING

- 严重程度：P1
- 状态：fixed / verified
- 对应用例：WIN-05
- 发现方式：修复 BUG-003 后，完整 coverage 的 adapters 阶段为 405 passed、1 failed；`WsBridge > destroy cleans up all sessions without leaking connecting-socket errors` 在 20ms 后仍保留一个 error listener。
- 根因：Bun 1.3.11 会把 bare `ws` 导入替换为 BunWebSocket 兼容层。对仍为 CONNECTING 的不可达连接立即调用 `close()` 或 `terminate()`，socket 会永久停在 CLOSING，且不再触发 error/close；原临时 error sink 和 close listener 因而永久保留。
- 修复：CONNECTING 状态不再调用会毒化状态的 close/terminate。移除业务 listener 后只挂 teardown listener：自然 error 被消费并清理；若 open 先发生，则再正常 close，并在 close/error 时清理。OPEN/CLOSING/CLOSED 的原关闭路径保持不变；生产代码没有新增任意超时。
- 变更文件：
  - `adapters/common/ws-bridge.ts`
  - `adapters/common/__tests__/ws-bridge.test.ts`
- 验证证据：
  - 聚焦测试：13 passed、0 failed。
  - 聚焦 coverage：13 passed、0 failed；`ws-bridge.ts` lines 85.59%、functions 73.68%。
  - 回归按条件等待 CLOSED，并断言 open/error/close listeners 全部为 0。
  - `bun run check:adapters`：406 passed、0 failed。
  - 修复后完整 `bun run check:coverage`：5/5 suites passed。

### BUG-005｜Trace abort backstop timer 被 unref 后在 Bun/Windows 单核自旋

- 严重程度：P1
- 状态：fixed / verified
- 对应用例：Trace/诊断稳定性、server 质量门禁
- 发现方式：`check:server` 卡在 `trace-capture.test.ts`；拆分单文件后，在任何测试结果输出前持续占满一个 CPU 核心。
- 根因：`captureResponseTraceSnapshot` 对无法被 cancel 唤醒的永久 pending `reader.read()` 使用 grace backstop timer，但该 timer 随即 `unref()`。Bun 1.3.11 Windows 在 `Promise.race` 只剩 pending read 与 unref timer 时会同步忙循环，timer 不触发。
- 修复：保留 backstop timer 的 event-loop 引用，并注释说明它是当前函数正在等待的正确性兜底，不能 unref。
- 变更文件：`src/services/api/traceCapture.ts`
- 验证证据：
  - 原挂起用例：1/1 passed，63ms。
  - 完整 `trace-capture.test.ts`：61/61 passed、281 assertions，Bun 2.67 秒，自然退出。
  - `bun run check:server`：219 files、2248 passed、0 failed。
  - `bun run check:chat-contract`：5 files、299 passed、0 failed。

### QA-003｜Reconciliation safety sweep 测试等待 unref interval 时忙循环

- 严重程度：测试基础设施
- 状态：fixed / verified
- 实际结果：前 5 个测试显示 passed 后进程持续单核满载，没有最终汇总；定位到第 6 个 low-frequency safety sweep 用例。
- 根因：测试 `await` 的 Promise 只能由 production 中已 `unref()` 的 safety interval resolve；pending Promise 不保持事件循环活跃，在没有 referenced timer 时 Bun runner 忙等，测试也无法走到 `watcher.stop()`。
- 修复：用已有带 referenced `Bun.sleep` 的 `waitFor` 等待首个 batch，并用 `try/finally` 始终释放被阻塞的首批次、停止 watcher。
- 变更文件：`src/server/services/localIndex/reconciliationWatcher.test.ts`
- 验证证据：单用例 1/1 passed、191ms；完整文件 7/7 passed、570ms，自然输出汇总并退出。

### BUG-006｜Windows 下停止系统代理时 CONNECT 连接使 Electron 测试超时

- 严重程度：P1 / Windows 资源生命周期
- 状态：fixed / verified
- 触发用例：WIN-04；`check:native` 内的 `SystemProxyBridge > closes active CONNECT clients and outbound routes during stop`。
- 实际结果：Vitest 单文件通过，但 native 使用的 Bun test runner 中 `bridge.stop()` 稳定超过 500ms。
- 根因：Bun/Windows 对已升级的 CONNECT socket，仅销毁桥接层跟踪的 socket 不足以让 `http.Server.close()` callback 完成。
- 修复：先销毁已跟踪的 client/outbound sockets；仅在 server 仍处于 listening 时调用 `closeAllConnections()`，然后调用并等待 `server.close()`。保留 listening guard，避免破坏 startup/stop 竞态。
- 变更文件：`desktop/electron/services/systemProxyBridge.ts`
- 验证证据：Bun 聚焦测试 18/18 passed；Electron TypeScript passed；完整 `check:native` 中 Electron 310 passed、1 skipped、0 failed，目录打包与 current package smoke passed。

### QA-004｜Tray 测试与 Menu 测试共享 Electron 模块 mock

- 严重程度：测试基础设施
- 状态：fixed / verified
- 触发用例：`check:native` 内 `tray.test.ts` 的未处理错误 `Electron tray mocks were not initialized for this test`。
- 实际结果：tray 单文件 4/4 passed；与 menu 测试联跑时稳定失败，证明是测试加载顺序相关污染。
- 根因：Bun 整套 Electron 测试共享 `electron` 模块 mock 注册表，`menu.test.ts` 与 `tray.test.ts` 会互相覆盖模块级 mock。
- 修复：`installTray` 接受可选且类型受限的 Electron runtime 注入，生产默认仍动态导入 Electron；tray 测试改为注入本地 mocks，不再注册全局 `vi.mock('electron')`。
- 变更文件：`desktop/electron/services/tray.ts`、`desktop/electron/services/tray.test.ts`
- 验证证据：tray 4/4 passed；menu + tray 15/15 passed；Electron TypeScript passed；完整 `check:native` passed。

### BUG-007｜项目 Agent 保存被可选热重载阻塞 120 秒

- 严重程度：P1 / Agent 管理可用性
- 状态：fixed / verified
- 触发用例：AGT-03、AGT-08。
- 实际结果：Project Agent 的文件和列表刷新已完成，但 Create Agent 对话框仍保持 Save/Cancel disabled 与 loading；120 秒后才关闭并显示 `The change was saved, but the latest agent configuration could not be fully applied. Request timed out after 120s`。
- 现场证据：首次隔离工作区位于外层 Git 仓库内，服务端按既有 Git-root 规则将文件写到仓库 `.claude/agents/project_reviewer.md`；该测试文件及本轮创建的空 `agents` 目录已精确清理。随后在 `artifacts/manual-ui-91829e91/workspace` 内初始化独立 Git 根，后续复测不会写入产品仓库。
- 根因：`desktop/src/stores/agentStore.ts` 在已成功 create/list 后仍等待 `agentsApi.reload()`；reload 请求使用 120 秒 timeout，并在结束前保持全局 `isMutating=true`。热重载本应是保存后的非阻塞增强，失败只需 warning + Retry。
- 修复：create/update/delete 在持久化和列表刷新成功后立即结束 mutation；session reload 改为后台 warning，并用 request id 隔离项目切换后的迟到结果。
- 验证证据：AgentManager + agentStore 44/44 passed，desktop lint passed；Computer Use 复测点击 Save 后约 1.2 秒进入 Agent 详情页，提示“active CLI session is not running”但 Save/Cancel 不再阻塞。

### BUG-008｜Agent Git 根缓存未感知运行中新增的嵌套仓库

- 严重程度：P1 / 项目隔离与数据安全
- 状态：fixed / verified
- 触发用例：AGT-03。
- 实际结果：Create Agent 表单显示目标为 `artifacts/manual-ui-91829e91/workspace`，且该目录已通过 `git init` 成为独立 Git 根；保存后文件仍被写入外层产品仓库 `.claude/agents/project_reviewer_fixed.md`。
- 现场证据：`git -C artifacts/manual-ui-91829e91/workspace rev-parse --show-toplevel` 返回隔离工作区；隔离目录无 Agent 文件，外层文件的创建时间与本轮保存一致。已读取并核对内容后精确删除该测试文件。
- 根因：Agent 服务首次解析隔离目录时它尚未初始化为仓库，`findGitRoot(realCwd)` 的全局缓存记录了外层仓库；运行中 `git init` 后 Agent CRUD 仍复用旧缓存，且 `clearAgentDefinitionsCache()` 不会清理 Git-root 缓存。
- 修复：项目 Agent 路径解析前按 `realCwd` 刷新 Git-root 缓存；新增“先预热父仓库、再创建嵌套 `.git`”的 API 回归测试。
- 验证证据：新增用例在临时撤掉修复时按预期失败，恢复后 `agents-api.test.ts` 17/17 passed、260 assertions。重建 Sidecar 并重启隔离 Electron 后，Computer Use 创建 `project_reviewer_fixed2`，约 1.5 秒进入详情页且目标显示隔离工作区；Shell 确认文件只存在于 `artifacts/manual-ui-91829e91/workspace/.claude/agents/`，外层产品仓库同名文件不存在。

### BUG-009｜Windows 本地半关闭连接堆积并拖垮 Session 列表

- 严重程度：P0 / Windows 桌面核心可用性
- 状态：fixed / focused + live Windows verified
- 触发用例：WIN-06、CTX-01、会话列表与 Scheduled 冒烟。
- 实际结果：左侧短暂显示 `Session list failed to load` / `Request timed out after 120s`，稍后刷新又自行消失。同期并非只有 Session：16:59:19 的 Task list 与 turn-checkpoints 同时 120 秒超时；17:04:01 的 `/api/sessions?limit=400` 与 `/api/scheduled-tasks` 同时 120 秒超时，之前分别有两次 context inspection 20 秒超时。
- Windows 现场证据：Sidecar 和 CLI 进程始终存活，故障窗口无 Electron/Bun crash；端口 51529 残留 9 对异常连接，Electron 侧为 `FinWait2`、Sidecar 侧为 `CloseWait`。Session 目录只有 3 个小 JSONL，本地 SQLite 也很小，不支持“400 条 Session 扫描过慢”的解释。
- 首轮根因假设：`ContextUsageIndicator` 的 HTTP deadline 与服务端 `get_context_usage` control budget 同为 20,000 ms，客户端 abort 与服务端 timeout 同刻竞速，使 localhost keep-alive socket 未及时收尾。该假设只能解释早期相关性，不是最终根因。
- 最终根因：Electron/Chromium 会长期池化 HTTP/1.1 本地连接，而 `Bun.serve` 配置 `idleTimeout: 60`。Chromium netlog 证明失败的 source 4974 在 socket #1319 空闲约 104 秒后复用：此前该 socket 多次正常收发，复用时客户端成功写入 684 bytes，服务端却不再返回响应头，120,011 ms 后 Chromium 取消。Windows 上 Bun 超时后的 socket 没有被客户端识别为已关闭，形成 stale keep-alive；任务、turn-checkpoints、workspace-status 等任意复用该连接的 REST 都会受影响。
- 修复：保留客户端/abort/health 的正确生命周期修复，并将本地 `Bun.serve` HTTP `idleTimeout` 设为 `0`，让 Chromium 客户端拥有池化连接生命周期，避免 server 先静默失效而 client 继续复用。曾尝试给所有 REST 响应加 `Connection: close`，但 12 次导航制造 403 个 `TIME_WAIT`，已撤回该全局策略。
- 变更文件：
  - `desktop/src/components/chat/ContextUsageIndicator.tsx`
  - `desktop/src/components/chat/ContextUsageIndicator.test.tsx`
  - `desktop/src/api/client.ts`
  - `desktop/src/api/client.test.ts`
  - `desktop/src/stores/cliTaskStore.ts`
  - `desktop/src/stores/cliTaskStore.test.ts`
  - `desktop/electron/services/sidecarManager.ts`
  - `desktop/electron/services/sidecarManager.test.ts`
  - `src/server/index.ts`
  - `src/server/__tests__/server-options.test.ts`
  - `src/server/requestLifecycle.ts`
  - `src/server/api/sessions.ts`
  - `src/server/services/conversationService.ts`
  - `src/server/__tests__/conversations.test.ts`
- 验证证据：
  - 服务端 abort callback 清理：1/1 passed；服务端 timeout listener 清理：1/1 passed。
  - ContextUsageIndicator 聚焦 Vitest：7/7 passed。
  - 重建 Sidecar、重启同一隔离 Electron 后，真实 DeepSeek 返回 `WINDOWS_TIMEOUT_FIX_ACTIVE`，会话列表与 context 2% 正常。
  - 修复版基线为 0 `CloseWait` / 0 `FinWait2`；Computer Use 连续手动刷新 context 10 次后仍为 0 / 0，仅有正常 `Established` 和短期 `TimeWait`。
  - 随后会话列表手动刷新约 1.3 秒，Scheduled 页面约 1.3 秒打开，均无 timeout；这只证明了短时场景。
  - 最终定位前的重启复现中，真实 MiniMax 多模态会话跨过 120 秒后再次出现 `CloseWait/FinWait2`，并在稍后明确写入 3 条新的 120 秒诊断：task-list、turn-checkpoints、workspace-status；这批证据用于否定“只是 context 计算慢”。
  - `server-options.test.ts`、request-lifecycle 与 tasks 聚焦回归合计 14 passed / 0 failed / 27 expects；Sidecar 重新编译成功。
  - 修复版真实 Electron 启动后先空闲 85 秒，随后 MiniMax 在同一轮并发执行 2 个 TaskCreate、TaskList + 2 个 TaskGet、2 个 TaskUpdate 和最终 TaskList，UI 两项均为绿色 completed，模型返回 `TASK_PARALLEL_IDLE0_OK`。
  - 修复版 netlog 中同一路径最慢 235 ms，所有 localhost API 最慢 578 ms；运行 137 秒后 sidecar 仍只有正常 `Established`，0 `CloseWait` / 0 `FinWait2`，诊断日志无新增 timeout。WIN-06 改为 passed。
  - 使用官方 `@oven/bun-windows-x64-baseline@1.3.14` binary 重编译 sidecar；真实 Electron 空闲 106 秒后 MiniMax 返回 `IDLE0_BUN1314_OK`，运行 131 秒仍为 0 `CloseWait` / 0 `FinWait2` 且无新增 timeout，排除仅在系统 Bun 1.3.11 上偶然通过。
  - `cliTaskStore` 新增同一 session 重叠轮询合并；聚焦 12/12 passed，避免 React/轮询重入放大本地连接压力，但它不是 stale socket 根因的替代修复。
- 剩余风险：H5 开启时 sidecar 监听 `0.0.0.0`，`idleTimeout: 0` 也会允许尚未发送完整 HTTP headers 的裸 TCP 连接长期占用资源。当前 H5 token 鉴权只发生在形成 HTTP 请求之后；若要彻底收敛 slowloris/资源占用风险，应将桌面 loopback 与 LAN H5 listener 拆分，或增加 pre-header 连接级 deadline。此架构项不影响本轮 localhost timeout 修复结论，但发布时需要风险接受或后续整改。

### BUG-010｜Windows 宠物窗口重启后失去置顶层级

- 严重程度：P1 / Windows 桌面宠物可见性
- 状态：fixed / focused + live Windows verified
- 触发用例：PET-01、PET-02。
- 实际结果：完整重启隔离 Electron 后，宠物窗口存在且 shaped region 正确，但被 ChatGPT 等普通窗口遮住；用户只能偶尔看到很小的光标/透明边缘，容易误判为宠物图片资源缺失。
- 排除项：当前配置选择的是仓库内置 `dada-code`，4 个内置宠物资源均存在且与 HEAD 一致。另一台电脑导入的猫/狗宠物位于 `${CLAUDE_CONFIG_DIR}/cc-haha/pets`，属于本地用户状态，不会通过 Git 自动同步；本次故障不是资源丢失或 fallback。
- Windows 现场证据：修复前宠物 Win32 z-rank 285，ChatGPT 为 39，窗口样式 `topmost=false`；宠物 mascot region 为 `96,116,288,322`，任务卡 region 为 `12,322,372,388`，证明渲染区域存在但层级错误。
- 根因：`BrowserWindow` 构造时的 `alwaysOnTop: true` 在 Windows `showInactive()` 后未保持；代码只在 macOS 分支重新调用 `setAlwaysOnTop`。
- 修复：`showInactive()` 后，macOS 继续使用 `setAlwaysOnTop(true, 'floating')`，Windows 等其他平台显式调用 `setAlwaysOnTop(true)`。
- 变更文件：
  - `desktop/electron/services/petWindow.ts`
  - `desktop/electron/services/petWindow.test.ts`
- 验证证据：
  - `bun run test -- --run electron/services/petWindow.test.ts`：24/24 passed（连续两次）。
  - `bun run build:electron`：passed；重启隔离 Electron 两次。
  - 修复后宠物 `topmost=True`、z-rank 13，高于主窗口 30 与 ChatGPT 43；截图/可访问性树可见 192px Dada 和“暂无进行中的任务 / 收起 0 个任务”。
  - 后续 BUG-011 修复原生 shape 与前端层级后，Computer Use 已能真实鼠标命中任务圆点和关闭按钮；宠物本体拖动与多显示器位置恢复仍未完成，PET-02 继续保持 partial。

### BUG-011｜宠物任务卡顶部被原生 shape 裁切，关闭按钮被宠物透明命中区截获

- 严重程度：P1 / Windows 宠物任务面板可用性
- 状态：fixed / focused + live Windows verified
- 触发用例：PET-02、PET-04；用户截图显示卡片顶部圆角/阴影缺失，点击卡片下方箭头没有反应。
- 实际结果：任务卡 DOM 矩形紧贴 Windows `BrowserWindow.setShape()` 边界，圆角抗锯齿与阴影越界部分被原生窗口裁切；关闭按钮绝对定位在卡片 DOM 矩形外，最初既不在原生命中 shape 内，又处在 `z-index: 5` 的卡片 stacking context 中，低于 `z-index: 10` 的宠物透明按钮区域。鼠标点箭头实际聚焦宠物按钮，因此卡片不关闭。
- 排查证据：
  - 修复前真实鼠标点击箭头后 UI 无变化，隔离配置 `showTaskPanel` 仍为 `true`。
  - 同一界面用 Tab 将焦点移到关闭按钮并按 Enter，卡片立即隐藏且 `showTaskPanel` 变为 `false`，排除 React handler 和偏好持久化故障。
  - 修复层级前鼠标点击箭头后，下一次 Tab 焦点从宠物按钮移到任务行，证明点击被宠物透明命中区截获。
- 修复：
  - Windows/Linux 原生交互 shape 对每个渲染区域增加 12px 安全边距并钳制在 384×400 窗口内，保留圆角、边框抗锯齿和阴影。
  - 将独立关闭按钮注册为原生命中区域，并纳入 renderer 的交互点/透传判断。
  - 将任务卡 stacking context 提升到 `z-index: 15`，高于宠物按钮的 `z-index: 10`，让画在宠物上方的关闭按钮也实际接收鼠标事件。
- 变更文件：
  - `desktop/electron/services/petWindow.ts`
  - `desktop/electron/services/petWindow.test.ts`
  - `desktop/src/features/pets/PetApp.tsx`
  - `desktop/src/features/pets/PetApp.test.tsx`
  - `desktop/src/theme/globals.css`
  - `desktop/src/theme/globals.test.ts`
- 验证证据：
  - 原生 shape 回归 24/24 passed；PetApp + globals 聚焦回归 24/24 passed。
  - 真实 Windows Electron + DeepSeek 编程任务中，卡片四角、顶部边框和阴影完整可见。
  - Computer Use 真实鼠标完成“数字圆点展开 → 箭头关闭 → 数字圆点恢复”两轮；第二轮无键盘辅助或 DOM 注入。
  - 隔离配置最终为 `showTaskPanel: false`，证明关闭状态已真实落盘。

### 当前测试限制

- LIVE-001（closed）：用户明确授权真实 Provider 额度并提供专用测试配置。隔离 Electron 中 DeepSeek 连接测试 179 ms 成功，`deepseek-v4-pro` 已设为默认；真实回复 `LIVE_DEEPSEEK_OK`、拒绝权限后的 `CHAT_CONTINUES` 和修复后重启的 `WINDOWS_TIMEOUT_FIX_ACTIVE` 均通过。配置与证据只保留在隔离测试目录，本文不记录密钥。
- PROVIDER-001（closed / false negative）：MiniMax-M3 的 Anthropic 兼容接口确实支持 image block。此前出现 `[Unsupported Image]` 的会话复用了由 DeepSeek 产生该文本的历史 assistant 消息，并把同一图片重复附加，不能作为 MiniMax 不支持图片的证据。使用首轮即选 MiniMax-M3 的全新会话、只附一张 `canary.png` 后，真实模型准确返回 `PDF_CANARY_91829E91`；trace 为 `/anthropic/v1/messages`、1 个 image block、HTTP 200，prompt 仅出现 1 次，请求和响应均无 `[Unsupported Image]`。离线附件序列化回归 `conversation-attachments.test.ts` 为 3 passed / 0 failed / 22 expects。MiniMax 连接测试为 1,349 ms，本文不记录密钥。
- LIVE-002（closed）：真实 MiniMax-M3 编程流程调用 TaskCreate/List/Get/Update、SubAgent、Read/Bash 并运行 `bun test`，3 个任务全部完成、测试 2 passed / 0 failed，最终返回 `REAL_TASK_AGENT_FLOW_OK`。真实 DeepSeek 流程同样完成 3 个 Task V2、真实编辑和 `bun test`，最终返回 `DEEPSEEK_TASK_V2_OK 2 pass, 0 fail`。这两条均为隔离 Git 工作区的实际 Provider 流程，不是 mock。
- PLAT-001：项目声明的 Electron 42.4 本地二进制不可用，本轮交互暂用已缓存的 Electron 42.3。最终构建与源码门禁不受此回退影响，但 Electron 版本特异风险会在最终结论中单独保留。
- NATIVE-001（closed）：`check:native` 首次执行在替换 Windows sidecar 时因隔离 Electron 遗留进程持有 exe 而 `EPERM`。核实进程链为隔离测试的 `bun 39396 → electron 29132 → sidecar 44260` 后仅结束该实例；清理后门禁进入 Electron 套件并暴露 BUG-006 / QA-004，修复后完整重跑 passed。

### 最终门禁汇总

- `bun run check:impact`：policy blocked；正确识别 adapters、cli-core、desktop、server，并要求 desktop、server、provider-contract、chat-contract、adapters、native、coverage。唯一 blocker 是 CLI core 变更需要 PR 标签与维护者批准，不是测试失败。
- `bun run check:desktop`：passed；完整 Vitest、lint 与 production Vite build 均成功。首轮仅因旧断言仍期待 20 秒 context timeout 而失败；更新为当前 30 秒契约后聚焦 30/30 passed，完整门禁重跑通过。
- `bun run check:server`：passed；221 files、2254 passed、0 failed。首次与其他大门禁并行时 `conversations.test.ts` 单例触发 10 秒资源竞争超时；单例 203 ms 通过，随后完整串行重跑通过。
- `bun run check:provider-contract`：passed；18 个 deterministic suites 全部通过。
- `bun run check:chat-contract`：passed。
- `bun run check:adapters`：passed；406 passed、0 failed、1091 assertions。
- `bun run check:native`：passed；sidecar compiled smoke 8/8，Electron 311 passed、1 个 macOS-only skipped、0 failed；Electron production build、Windows x64 目录打包及 current package smoke 均通过。一次 1 秒命令超时是执行器主动中止，不是代码失败，完整重跑 84 秒成功。
- `bun run check:coverage`：passed；5/5 groups、0 failed，报告位于 `artifacts/coverage/2026-07-22T11-11-42-208Z/coverage-report.md`。
- 最终工作区核对：`git diff --check` passed；`git diff --stat` 为 53 个已跟踪文件、931 insertions / 301 deletions（另有本轮新增测试与两份人工文档）；`git status --short` 已复核。未执行 `bun run verify`，因为本轮按 `check:impact` 选择的最小完整门禁交付，未声明 PR-ready/push-ready。
