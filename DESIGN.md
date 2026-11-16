# EchoFlow Code 桌面设计规范

本文定义桌面应用的全产品视觉方向与组件实现契约，作为设计和实现评审标准；组件 API 以源码为准，不重复维护逐像素规格。

## 权威来源

- `desktop/src/theme/globals.css` 负责主题值和语义设计 token。
- 本文件负责视觉原则、页面角色、组件选择、实现、无障碍、本地化和测试契约。
- [根规范](AGENTS.md)负责全仓授权、用户状态安全和验证流程。
- [「纸·墨·印」历史交接](docs/_internal/archive/desktop-design.md#paper-ink-seal)的旧尺寸与实现清单不是现行权威依据。

这些来源看似冲突时，主题值由 `globals.css` 负责，组件实现契约与产品级视觉决策由本文件负责。应更新负责该事项的来源，而不是复制数值；涉及行为冲突时仍遵循根规范的调查规则。

## 产品气质

EchoFlow Code 是面向持续阅读、编辑和操作控制的高密度编程工作区。视觉语言应平静、精确且有辨识度，不能把代码、对话、差异或设置降格为装饰。

当前方向是 **Ink Workbench（墨色工作台）**：内容稳定地放在纸面桌台上，控件只在活跃时抬升，印章标示有意义的决策。辨识度不来自全局透明或暖色调，而来自阅读表面、操作表面和执行状态之间的关系。

六套主题共用以下材质角色、信息层级和交互语言，主题只改变配色：

| 角色 | 用途 | 不可妥协的规则 |
|---|---|---|
| 纸面（Paper） | 聊天、代码、差异、终端、追踪详情、工作区、设置表单、长列表、对话框 | 持续阅读和编辑的默认材质，不透明且可读 |
| 墨面（Ink） | 侧栏、标签页、工具栏、活动区框架、紧凑工具摘要 | 使用主题 token 的控制表面；活跃项可克制抬升，静止项不积累装饰阴影 |
| 印章（Seal） | 权限决策、品牌入口、主要操作、完成反馈 | 稀疏的语义强调；不能替代警告、错误、成功或焦点 |
| 玻璃（Glass） | 紧凑、短暂的锚定菜单、弹出层、输入框外壳、速览浮层 | 只作墨面的增强，不是新的内容层；必须能退回不透明主题表面 |

**执行主线（execution spine）**是同一会话中工具行、活动、导航标记与权限表面的共享视觉关系。它是展示规则，不是第二套状态存储：多个信号并存时，等待或权限优先于错误，错误优先于运行中，运行中优先于已完成。每种状态还必须有文本、图标或语义状态标记，不能只靠颜色、发光或动效。

## 设计原则

1. **内容始终清晰。** 阅读和编辑表面按材质角色使用稳定、高对比填充。
2. **用结构建立层级。** 优先使用对齐、间距、排版、表面层次和克制的边框，再考虑阴影或装饰卡片。
3. **一个操作只有一种视觉含义。** 主要操作、破坏性操作、选中态和状态色在全应用保持相同语义。不要在与状态竞争的位置用品牌色装饰。
4. **密度服从任务。** 设置、追踪检查和工作区列表可以紧凑；引导与空态可以留白。标签可读、控件可用时，紧凑是有意选择。
5. **动效解释变化。** 优先短促、由用户触发的过渡。尊重减少动效设置，避免环境式持续运动和重复进场效果。
6. **每套主题都是一等主题。** 使用语义 token，保留对比度，验证浅色与墨色配色。避免只对默认主题有效的一次性颜色修补。

## 材质与玻璃决策

采用 **Ink Workbench**，不是桌面壁纸透明效果。Electron 窗口保持不透明；系统毛玻璃会引入平台特有行为，让工作区背景不可预测。

玻璃仅限上表所列的紧凑、临时表面。侧栏、标题栏、聊天记录、代码/差异/终端、设置表单、权限及其他对话框、追踪详情和工作区内容都不默认使用玻璃。大型或可滚动表面必须不透明。玻璃必须保留主题填充和可见边框；`backdrop-filter` 不可用、启用降低透明度或强制颜色时，应退回不透明主题表面。玻璃外壳内的长文本和详细预览必须置于不透明内层。

等待和权限使用成对的 warning 容器 token，错误用 error token，焦点用 focus-border token。

扩大玻璃使用前，应在组件 gallery 中检查六套主题、密集文字背景及模糊不可用的情况；渲染证据要求见评审清单。

## 页面角色

采用少量页面角色，不把每个路由强塞进同一个模板：

| 角色 | 示例 | 视觉重点 |
|---|---|---|
| 工作表面 | 活跃会话、工作区、终端 | 最大阅读面积、安静的界面框架；控件靠近其影响的工作 |
| 配置 | 桌面设置、服务商/运行时设置 | 清晰页标题、有标签的分区、紧凑对齐字段、明确的保存/应用状态 |
| 移动配置 | H5 设置 | 触摸优先的导航和控件；聚焦桌面配置的适用子集，不挤压桌面页面 |
| 目录 | 市场、扩展/技能浏览 | 搜索和筛选先于结果；重复条目方便对比 |
| 检查 | 追踪、活动、Agent Teams | 清楚的主从或时间线层级；密集数据仍可扫读 |
| 聚焦对话框/任务 | 权限、确认、导入 | 一个决策或短任务；不透明表面、明确后果、简洁操作 |

角色只指导组合，不引入新行为。不能为适配视觉模板删除已有能力或凭空创造功能。

### 角色与组件边界

页面通用控件按下文组件索引复用；聊天消息、工具/权限块、功能专属表单、市场安装流程、追踪树和工作区文件/差异等领域行为留在本地。不要求替换每个原生元素：标签页、菜单、树、网格、任务行与窗口控件即使标记结构相似，也保留自己的语义。

只有状态类型、生命周期、可见含义和无障碍提示相同时，才可共享状态映射。不要合并焦点与等待、品牌与警告、展开状态与模态焦点管理。`disclosureMemory`、模态焦点限制/恢复，以及 `useDismissable` 的 Escape 和外部关闭行为，是独立契约，必须保留。

有明确理由且不削弱可读性或 token 所有权时，局部层叠上下文、桌宠玻璃效果，以及页面专属圆角或表面例外可以留在本地。

## 字体与间距

当前字体 token：`--font-body` 为界面无衬线字体；`--font-headline` 当前指向 `--font-body`，也是无衬线；`--font-serif` 是明确选择的编辑型衬线字体；`--font-mono` 用于代码和机器格式值。只有明确采用编辑型标题时才使用衬线角色，不要假设 `--font-headline` 已提供衬线。改变 token 映射是独立的设计系统决策。

以下是视觉角色范围，不是新增可用字号；实现从下文固定集合选取，范围外或小数字号需先作独立设计决策并同步门禁：

| 角色 | 指导 |
|---|---|
| 紧凑元数据 | 11–12px；仅次要信息，不承载关键指令 |
| 密集控件文字 | 13–14px |
| 正文与表单标签 | 14–16px |
| 分区标题 | 16–18px |
| 页面标题 | 24–28px；当前 `--font-headline` 是无衬线，只有有意采用编辑型风格时才用 `--font-serif` |
| 大数值 | 21–26px；仅在该数值是视图重点时使用 |

不机械替换已有尺寸，也不以布局测量自行豁免字号门禁。优先已有间距和圆角 token；对真实触摸目标、组合控件、媒体裁剪或页面专属布局有意义的例外应保留。

## 表面与浮层

- 页面分区使用无框布局或全宽带，不嵌套卡片；卡片只用于独立有意义的条目或确需框定的工具。
- 菜单与弹出层共享主题表面、边框、抬升、焦点、关闭和键盘行为。专用内容可以改变尺寸，不改变基本表面语言。
- 对话框保持不透明，遵循对话框表面契约；媒体查看器可使用自己的内容表面。
- 底部面板是触摸专用、类似对话框的表面，形状与交互可以不同，但保持相同主题和焦点标准。
- Toast 用于传达结果，不模仿菜单或卡片。
- 内容短且可展开时，工具摘要可用紧凑行；差异、终端、预览、长输出和错误详情仍为有框、不透明内容。不把所有工具调用都改为行。

当前实现已有共享且 token 化的抬升与 z-index 刻度，但类菜单表面仍同时存在 `.glass-panel` 和独立拼装、圆角与阴影不同的不透明面板。只有行为相关改动触及时才收敛，不为统一 class 字符串而发起高风险全局重写。

## 控件与交互

通用控件使用共享 UI 原语。领域专属行、标签页、树节点和窗口控件可以手写按钮，但必须保留相同的键盘、焦点、禁用和主题语义。使用语义 token，不用原始调色板值。焦点必须可见，悬停不能是唯一状态提示。尊重减少动效设置，为 H5 保持合适的触摸目标。

抽取组件前核对键盘与焦点、Escape 与外部关闭、本地化、主题状态、触摸目标及业务耦合，调用方与放置要求见下文。优先已有原语而非新包装；新抽象必须保留现有 store、API、路由、权限载荷及状态流。

## 组件实现契约

以下路径除特别注明外相对 `desktop/src/components/`。先查已有组件，不重复实现；API 与变体以组件源码为准，历史审计见[桌面设计归档](docs/_internal/archive/desktop-design.md#component-library-plan)，不作为待执行计划。

### 组件索引与放置

| 需求 | 现有组件 |
|---|---|
| 操作与复制 | `ui/Button.tsx`、`ui/IconButton.tsx`、`ui/CopyButton.tsx` |
| 字段 | `ui/Checkbox.tsx`、`ui/Switch.tsx`、`ui/Input.tsx`、`ui/TextArea.tsx`、`ui/SearchField.tsx` |
| 选择与切换 | 纯文本选项用 `ui/SelectField.tsx`，带图标/描述用 `ui/Dropdown.tsx`；分段/标签切换用 `ui/SegmentedControl.tsx` |
| 状态与进度 | `ui/Badge.tsx`（含 `StatusDot`）、`ui/Spinner.tsx`、`ui/Progress.tsx` |
| 空、错、加载、骨架 | `ui/EmptyState.tsx`、`ui/ErrorState.tsx`、`ui/LoadingState.tsx`、`ui/Skeleton.tsx`（含 `SkeletonRows`、`SkeletonCards`） |
| 容器与浮层 | `ui/Card.tsx`、`ui/Modal.tsx`、`ui/ActionDialog.tsx`（带按钮行）、`ui/ConfirmDialog.tsx`、`ui/MobileBottomSheet.tsx`、`ui/Tooltip.tsx` |
| 业务复合件 | `composite/DirectoryPicker.tsx`、`composite/OpenWithMenu.tsx`、`composite/BrandSeal.tsx` |

- 新功能面板独立成模块；单调用方组件放 `components/<feature>/`，至少两个真实调用方共享相同语义行为才抽取。纯 UI 放 `ui/`，不得 import store/API 或功能目录；业务复合件放 `composite/`，可依赖 store/API。既有两处 `contract.test.ts` 检查边界与调用方数量。
- 新增产品组件必须通过路由或 import 从产品入口可达，由既有 `componentReachability` 检查验证；仅开发 gallery 不替代产品接入。
- 不重建 `shared/`、`common/`；import 使用 `@/` 别名。不引 UI 依赖，不加 barrel `index.ts`。不新增通用 `Table`、`Divider`、`Avatar`，分别复用 CSS Grid、`divide-y`、`market/SkillAvatar`；不引虚拟滚动库，保留虚拟化项禁用 `content-visibility` 的不变量。
- 通用能力不足时补 variant/tone/size 和测试，不以冲突 className 或退回手写按钮规避；领域列表项、树节点、标签页、拖拽把手及窗口控件保留自己的语义。在任务范围内验证调用方、交互和主题；仅缺产品决策或超出授权时确认，未完成项说明 blocker。
- 设置页复用 `settings/SettingsSection.tsx` 的 PageHeader → Section → Group → Row 骨架。

### 主题、样式与兼容

- 六主题由 `<html data-theme>` 应用，支持手动选择与跟随系统。新增 token 在全部主题可解析，由 `desktop/src/theme/globals.test.ts` 与 `desktop/src/theme/tokenUsage.test.ts` 检查；`dark:` 可用，作用域以 `desktop/src/theme/globals.css` 为准，但优先语义 token。
- 颜色、圆角及 z-index 使用 token，不写硬编码 hex、Tailwind 命名圆角或裸 z-index。语义容器底色 `--color-<tone>-container` 配 `--color-on-<tone>-container`，不拿 tone 本色作容器文字；由 `desktop/src/theme/contrast.test.ts` 检查对比度至少 4.5:1，半透明先与表面合成。
- 层级保持 base → raised → sticky → nav → scrim → drawer → dialog → sheet → dropdown → popover → tooltip → toast；dropdown 必须高于 dialog，toast 高于 sheet。具体数值仅在 `globals.css` 维护。
- 组件不做 Tailwind 冲突消解；className 顺序不能保证覆盖，反复覆盖同组工具类应补变体。删除图标静止用 muted、悬停用 `hoverTone="danger"`；侧栏与终端用相应 `surface`；图片上用 `solid` 与配对前景 token，不用 `filled` 或硬写 `text-white`。
- 状态语义：运行 info、待确认 warning、完成 success、失败 error；陶土色限品牌、发送键与选中指示，不取代状态色。图标用 lucide、`strokeWidth={1.75}`，`IconButton.icon` 传元素而非 Material 字符串。
- 字重最高 semibold，`font-mono` 不配 semibold；中文不用斜体或宽字距大写标签，摘要列表用「、」。字号指导不解除 `desktop/src/theme/designSystem.test.ts` 的现有固定集合门禁：11 / 12 / 13 / 14 / 15 / 18 / 22 / 26；`text-xs/sm/lg` 可用，`text-base/xl/2xl…` 与小数字号不可用。例外或调整集合须单独设计决策并同步门禁，不因本次文档合并放宽。
- 关键配色不用 `/N` alpha 修饰符，保持 Safari 15 WebView 兼容；浅底色增加实色 token。`content-visibility` 写 CSS class 而非内联 style；同 bundle 服务 Electron、桌面浏览器与手机 H5，触屏专属样式限定 `html[data-touch-h5]`。
- 移动端主要触摸目标保持 44px（`IconButton` 的 `2xl`、`SearchField` 的 `xl`）；不得把 ChatInput 已测输入栏按钮缩到 40px。

### 浮层、本地化与无障碍

- 复用 `hooks/useDismissable.ts`（pointerdown 外部关闭/Esc）、`hooks/useAnchoredPosition.ts`（锚定、翻转与夹取）、`hooks/useRoomAbove.ts`（向上浮层限高）；不另写 mousedown 外部关闭。Modal 内浮层传 `stopEscapePropagation: true`，避免一次 Esc 同关两层。
- 被 Tooltip/Dropdown 锚定的组件必须 `forwardRef`，保留定位、关闭后焦点恢复与模态焦点契约。
- 所有可见文案走 `useTranslation()`，含 `aria-label`、`title`；所有翻译 key 同步五种 locale，包括表达式生成的 key。组件默认文案由调用方传入，不写中文/英文字面量或拼接英文（包括 SearchField 的 `clearLabel`）。
- 可聚焦元素有可见 focus ring：`focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]`；图标按钮用 `IconButton` 并传必需的 `label`。
- 输入控件用 `useId()` 关联 label，不从文案派生 id；描述不要混入可访问名，label 含标题与描述时用 `aria-labelledby` 精确关联标题。
- 错误信息用 `role="alert"` 并由 `aria-describedby` 关联；listbox 内放 option，不放 button；tooltip 用 `aria-describedby`，不用会覆盖控件名称的 `aria-label`。

### 组件验证

- 新组件有对应 `.test.tsx`，覆盖可访问名、props 变体与调用方行为，复用已有测试模式。浮层测试至少包含函数组件 trigger（如 Button），不能只测原生 button 而漏掉 ref 转发失败。
- jsdom 的禁用 input 断言 `toBeDisabled()`，不靠 `fireEvent.click`；源码对 `scrollIntoView` 用可选调用；定位测试以 ref callback 同步打桩 `getBoundingClientRect`，早于 layout effect。
- 新 UI 原语同步加入 `desktop/src/dev/ComponentGallery.tsx`。`cd desktop && bun run dev` 后打开 `http://localhost:1420/gallery.html` 检查各主题的对比度、浮层和动画；gallery 仅开发可达，不进入生产构建。
- UI、store/API 行为用定向 Vitest / Testing Library 验证，其余流程遵循根规范；`check:desktop` 已含 lint、完整 test 和 build，不预先重复执行。

## 评审清单

- 页面是否无需增加界面框架便能表达其角色和主要任务？
- 主要、次要、破坏性、选中及状态处理是否与含义一致？
- 六套主题和目标密度下，文字与控件是否可读？
- 大型阅读/表单表面是否不透明，玻璃是否限于合适的短暂表面？
- 通用控件是否采用共享原语，例外是否有领域行为依据？
- 焦点、键盘操作、本地化和减少动效是否保留？
- 可见改动是否在相关主题、密集文本及目标视口（含窄视口）下检查过截图或实际渲染，包括玻璃、对比度与布局？没有则记录缺少视觉证据。
- 是否把源码计数当成了视觉结论？字号字面量、原生控件、焦点 class 等计数只是审计信号，不是完整视觉清单；全局颜色例外、图标族差异和逐页间距须经渲染评审，才能视为已确认视觉缺陷。
