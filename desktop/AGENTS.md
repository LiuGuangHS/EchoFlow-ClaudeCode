# 桌面端规范

这些规则适用于 `desktop/` 改动，并叠加根目录规则。

- 在 `desktop/src/components/` 下新增或编辑内容前，先阅读 `desktop/src/components/AGENTS.md`。它是可复用组件、放置规则以及 style/i18n/a11y/test 约定的权威索引。不要添加其中已列组件的重复实现，也不要向 `components/shared/` 或 `components/common/` 添加新文件。
- 复用现有桌面 store/API 模式。通用图标使用 `lucide-react`，保持操作型 UI 紧凑、稳定且易读。
- 新功能面板从一开始就应是独立模块。`Settings.tsx` 曾在 4639 行中承载七个无关面板，仓库中最常被修复的四个文件也正是最大的四个文件。将面板放入独立文件；两个面板共享的内容放入明确的 shared 模块，不要留在碰巧承载它们的页面中。
- 创建组件的同一改动必须把它接入路由。`src/__tests__/componentReachability.test.ts` 会对任何没有入口可达的 `.tsx` 失败。曾有三个组件失去最后一个 import，覆盖率门禁把“零覆盖”当成“需要测试”，于是有人为其中两个写了套件，之后 UI 重设计又重做了三个。
- 组件使用的每个翻译 key 都必须加入 `src/i18n/locales/` 的五个文件，包括表达式内选择的 key（`t(count === 1 ? 'a' : 'b')`）；仅扫描字面量会在两个方向上漏掉它们。
- 为 UI、store 或 API 行为添加定向 Vitest 或 Testing Library 覆盖。先运行它，再执行 `bun run check:impact`；桌面产品改动通常会选中 `bun run check:desktop`。
- 聊天传输、WebSocket 生命周期、首回合 runtime 选择、重连或 session 改动，在选中时还必须运行离线 `bun run check:chat-contract`，以及端到端 session/tool/permission/reconnect 协议检查 `bun run check:agent-flow`。
- 权限对话框、工具调用渲染或审批流程改动还应运行 `bun run check:desktop-ui-smoke`：它在无 provider 的 mock runtime 上、真实浏览器中执行真实对话框。
- `desktop/electron/**` 不在 `desktop/tsconfig.json` 覆盖范围内，因此 `check:desktop` 不能证明它仍可编译。修改被 Electron host 导入的 `desktop/src/**` 模块时，导入图会选择 `bun run check:native`；应运行它。
- Electron host、sidecar、打包或版本改动在选中时需要 `bun run check:native`。
- 单元测试无法证明布局或跨进程行为时，应在真实浏览器 / 桌面会话中验证用户可见流程，并记录实际路径。
- `localStorage` 或原生设置形状变化需要迁移、旧 fixture 和 `bun run check:persistence-upgrade`。
