# 安装指南

桌面端基于 **Electron**，提供 macOS / Windows / Linux 安装包。当前版本暂未进行 Apple / Windows 代码签名，首次安装需要手动放行一次（不是文件损坏，按下方步骤操作即可）。

## 下载

前往 [GitHub Releases](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases) 下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| macOS (Apple Silicon / M 系列) | `EchoFlow-Code-<版本>-mac-arm64.dmg` |
| macOS (Intel) | `EchoFlow-Code-<版本>-mac-x64.dmg` |
| Windows (x64) | `EchoFlow-Code-<版本>-win-x64.exe` |
| Linux (x64) | `EchoFlow-Code-<版本>-linux-x86_64.AppImage` 或 `...-linux-amd64.deb` |
| Linux (ARM64) | `EchoFlow-Code-<版本>-linux-arm64.AppImage` 或 `...-linux-arm64.deb` |

> 不确定 Mac 架构？点击左上角  → 关于本机，芯片为「Apple M…」选 arm64，「Intel」选 x64。

移动端 Android 客户端用于连接已经运行的桌面端或本地服务。它不会在手机上运行 sidecar，也不会替代桌面端安装；需要先在桌面端开启 H5 访问，再按 [移动端文档](/mobile/) 扫码或手动输入 Server URL + H5 Token。

## macOS 安装

双击 DMG 把应用拖入 `Applications`。首次打开如果提示**"已损坏"**或**"无法验证开发者"**，在终端执行：

```bash
xattr -cr "/Applications/EchoFlow Code.app"
```

也可以在「系统设置 → 隐私与安全性」里点"仍要打开"。

## Windows 安装

双击 `.exe` 安装。首次运行如果 SmartScreen 弹出 **"Windows 已保护你的电脑"**，点击 **「更多信息」** → **「仍要运行」**。

## Linux 安装

AppImage：

```bash
chmod +x EchoFlow-Code-<版本>-linux-x86_64.AppImage
./EchoFlow-Code-<版本>-linux-x86_64.AppImage
```

> 提示缺少 FUSE：Ubuntu 22.04 及更早 `sudo apt install libfuse2`，24.04+ `sudo apt install libfuse2t64`。

deb：

```bash
sudo apt install ./EchoFlow-Code-<版本>-linux-amd64.deb
```

## Web UI 模式

如果桌面端安装遇到问题，可以直接通过浏览器使用 Web UI。在项目根目录下分别启动服务端和前端：

```bash
# 1. 启动服务端（在项目根目录）
SERVER_PORT=3456 bun run src/server/index.ts

# 2. 启动前端（在 desktop 目录）
cd desktop
bun run dev --host 127.0.0.1 --port 2024
```

启动后浏览器访问 `http://127.0.0.1:2024` 即可。

## 常见问题

**Q: 这个版本会自动更新吗？**

桌面端会检查 GitHub Releases 并在有新版本时提示更新；Windows/macOS 未完成代码签名时，系统仍可能要求你手动确认或重新下载安装包。最稳妥的方式仍是到 [GitHub Releases](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest) 下载最新版覆盖安装。

覆盖安装不会删除本地数据。上游兼容数据（例如 `projects`、`skills`、`plugins`、`agents`、`teams`、`tasks`、`adapters.json`）默认继续保存在 `~/.claude`；EchoFlow 自有 Provider、OAuth、桌面偏好和 diagnostics 保存在 EchoFlow 应用数据目录。
