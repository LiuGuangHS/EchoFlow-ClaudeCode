# 桌面端说明

这些规则适用于 `desktop/` 下的改动，并叠加根目录规则。

- 在 `desktop/src/components/` 下新增或编辑内容前，先阅读 `desktop/src/components/AGENTS.md`。它是可复用组件索引、新组件放置规则以及样式/i18n/无障碍/测试约定的唯一权威。不要新增其中已列出的重复组件，也不要向 `components/shared/` 或 `components/common/` 添加文件。
- 在新增 UI 原语前，先复用现有桌面 store/API 模式和 `src/components/AGENTS.md` 中的设计系统。通用图标使用 `lucide-react`。选择熟悉的控件：工具操作使用图标按钮，二元设置使用开关/复选框，视图使用标签页，选项集合使用菜单，数值使用滑块/输入框。操作界面应紧凑、稳定、易读、面向工作；应用面板不得使用营销式 hero 布局、装饰卡片、渐变光球背景或超大字号。文本必须适配移动端和桌面端视口；稳定控件（标签栏、工具栏、状态 chip、按钮）不得因标签、悬停状态或加载文字变化而调整大小或位置。
- 新功能面板从一开始就是独立模块：面板放入独立文件，多个面板共享的内容放入明确的共享模块，不要留在恰好承载它们的页面中。原因：`Settings.tsx` 曾膨胀到 4639 行，最常被修复的文件正是最大的几个。
- 创建组件的同时把它接入路由；`src/__tests__/componentReachability.test.ts` 会对没有任何可达入口的 `.tsx` 报错，避免失去 import 的死组件被 coverage 门禁读成“需要测试”。
- 组件使用的每个翻译 key 都必须加入 `src/i18n/locales/` 中的五个文件，包括表达式中选择的 key（`t(count === 1 ? 'a' : 'b')`）；只扫描字面量会在两个方向都漏检。
- 为 UI、store 或 API 行为添加定向 Vitest 或 Testing Library 覆盖。先运行定向测试，再执行 `bun run check:impact`；`desktop/src/**` 的 UI/store/API 改动会选择 `bun run check:desktop`。不要依据 `desktop/` 目录名推断检查：`desktop/electron/**` 和 `desktop/scripts/**` 在被选中时路由到 `bun run check:native`。
- Chat transport、WebSocket 生命周期、首轮运行时选择、重连或 session 改动在被选中时还需要离线 `bun run check:chat-contract`，以及覆盖 session/tool/permission/reconnect 协议的 `bun run check:agent-flow`。
- 权限对话框、工具调用渲染或审批流程改动还应运行 `bun run check:desktop-ui-smoke`：它在 mock runtime 上的真实浏览器中操作真实对话框，不需要 provider。
- `desktop/electron/**` 不在 `desktop/tsconfig.json` 覆盖范围内，因此 `check:desktop` 不能证明它仍可编译。修改被 Electron host 导入的 `desktop/src/**` 模块时，导入图会选择 `bun run check:native`；应运行它。
- Electron host、sidecar、打包或版本改动在被选中时需要 `bun run check:native`。该 lane 会打包应用，成本较高；迭代时使用定向测试，只有影响报告选中且交付证据需要时才运行该 lane；运行与诊断纪律见 `docs/internals/contributing.md`。
- 当单元测试无法证明布局或跨进程行为时，在真实浏览器/桌面会话中验证用户可见流程，并记录实际走过的路径。
- `localStorage` 或 native 设置结构变化需要迁移、旧 fixture 和 `bun run check:persistence-upgrade`。
