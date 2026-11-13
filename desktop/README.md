# EchoFlow Code 桌面端

基于 Electron、React 和 TypeScript 的桌面 Coding Agent 工作台。桌面端负责项目与会话界面、设置与本地持久化、WebSocket 聊天、权限交互，以及 Electron host、sidecar、终端、通知和桌面打包；模型执行与外部执行引擎通过既有 execution binding 连接，不在本目录创建第二套运行时循环。

## 边界与入口

- **renderer**：`src/`，包含 React 页面、组件、stores、i18n、主题和桌面端 API 客户端。
- **Electron host**：`electron/`，包含主进程、preload、窗口生命周期、用户数据根目录、登录、IPC、sidecar 和原生集成。
- **构建与质量脚本**：`scripts/`，包含 Electron、sidecar、node-pty、ripgrep、cloudflared、预览 agent 和打包目录检查。
- **H5 移动端导出**：`build:h5-mobile` 调用 `mobile/scripts/export-h5.ts`，产物由桌面服务端托管；它不是第二个移动原生应用。

桌面端的目录级规则见 [desktop/AGENTS.md](AGENTS.md)；可复用组件规则见 [src/components/AGENTS.md](src/components/AGENTS.md)。跨产品执行、持久化和信任边界见 [执行、数据与信任边界](../docs/internals/execution-boundaries.md)。

## 开发

在仓库根目录或 `desktop/` 安装锁定依赖后，在 `desktop/` 执行：

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run dev` 启动 renderer 开发服务器；需要真实 Electron 窗口时使用仓库提供的隔离预览脚本或：

```bash
bun run electron:dev
```

真实 Electron 预览必须使用临时 HOME、配置目录和 provider fixture；不能读取或写入开发者真实用户状态，也不能通过关闭 Chromium sandbox 绕过问题。

## 构建与打包

```bash
# renderer、TypeScript 和 H5
bun run build

# Electron host / preload
bun run build:electron

# 本地目录打包，不发布
bun run electron:package:dir

# 完整 Electron 构建与本地打包
bun run electron:package
```

构建与打包产物位于 `build-artifacts/` 或被 Git 忽略的构建目录。正式签名、安装、升级、公证和发布属于独立发布流程，不由本地 `build` 或目录打包单独证明。

## 验证

从仓库根目录按影响面运行：

```bash
bun run check:impact
bun run check:desktop
bun run check:native
bun run check:persistence-upgrade
```

- UI、store 或 API 行为改动需要同区域 Vitest / Testing Library 回归测试。
- Electron host、sidecar、打包或 host 导入的 renderer 模块改动需要 `check:native`；`check:desktop` 单独不能证明 Electron host 编译正确。
- localStorage 或原生设置形状变化需要迁移和旧 fixture。
- 单元测试不能证明跨进程或用户可见流程时，再运行无 provider 的桌面 UI smoke 或隔离 Electron 预览，并记录实际截图/日志路径。

不要把本地 renderer 构建、mock smoke 或 Linux 目录打包结果表述成所有平台安装、签名、公证或生产发布验收。
