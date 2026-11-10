---
title: 下载与安装
nav_title: 下载与安装
description: 下载 EchoFlow Code 桌面端：macOS、Windows、Linux 安装包，无需另装 Node.js 或 Claude Code，以及系统拦截安装时的处理办法。
order: 1
---

# 下载与安装

装完就能用，不需要另外安装 Node.js、Python 或任何外部命令行工具——CLI 内核和文件搜索用的 ripgrep 都已经打进安装包里了。

产品名称统一为 **EchoFlow Code**。现有安装包、已安装的应用和系统进程可能仍显示旧名称；下面的文件名和命令按实际发布包保留。

## 挑对安装包

所有 EchoFlow 安装包都在 [GitHub Releases](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest)，按系统和 CPU 架构选一个；以该发布页实际列出的文件名为准，下面保留的上游文件名不代表 EchoFlow 已发布这些产物：

| 你的系统 | 下载 |
|---|---|
| macOS，Apple 芯片（M 系列） | `Claude-Code-Haha-<版本>-macOS-Apple-Silicon.dmg` |
| macOS，Intel 芯片 | `Claude-Code-Haha-<版本>-macOS-Intel.dmg` |
| Windows x64 | `Claude-Code-Haha-<版本>-Windows-x64-Setup.exe` |
| Windows ARM64 | `Claude-Code-Haha-<版本>-Windows-arm64-Setup.exe` |
| Linux x64 | `Claude-Code-Haha-<版本>-Linux-x64.AppImage`、`.deb` 或 `.rpm` |
| Linux ARM64 | `Claude-Code-Haha-<版本>-Linux-arm64.AppImage`、`.deb` 或 `.rpm` |

不确定自己是哪种架构：macOS 看「关于本机」里的芯片型号，Windows 看「设置 → 系统 → 系统信息」里的系统类型。别只凭机器牌子猜。

名字以 `-update.zip` 结尾的文件和 `latest*.yml` 是应用自动更新用的，不用手动下载。不同发布批次可能使用不同的系统与架构标记；按对应 EchoFlow 发布页选择文件，不使用上游版本号推断本站安装包名称。

## macOS

1. 双击 DMG。
2. 把应用拖进「应用程序」。
3. 从「应用程序」打开。

### 如果提示「已损坏，无法打开」

「已损坏」提示可能与下载不完整、签名验证或系统安全检查有关，不能仅凭提示判断安装包安全。先核对下载来源、对应发布说明中的签名状态和校验信息，必要时重新下载。历史发布、开发构建与当前发布流程的签名要求可能不同，本页不承诺所有正式包都已签名、公证，也不承诺已签名的应用绝不会被系统拦截。只有明确确认来源可信、且发布说明要求处理未签名构建时，才考虑下方操作；来源或完整性不明时不要绕过系统检查。

**办法一：用构建附带的脚本**

未签名的开发构建会附带 `install-macos-unsigned.sh`。把它和 DMG 放在**同一个文件夹**（比如「下载」），然后在终端里跑：

```bash
cd ~/Downloads
bash install-macos-unsigned.sh
```

脚本会自动挑对架构的 DMG、挂载、把应用装进 `/Applications`、清掉隔离标记再打开。已有的旧版本会先移到废纸篓，不会直接覆盖。

**办法二：手动清隔离标记**

已经把应用拖进「应用程序」了，就直接执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Claude Code Haha.app"
```

只对你确认来自本仓库 Release 的安装包这么做。来路不明的应用不要绕过 Gatekeeper。

## Windows

1. 先把正在运行的旧版本完全退出，包括系统托盘里的图标。
2. 双击 `.exe` 安装。
3. **不要**右键选「以管理员身份运行」——安装器是给当前用户装的，用管理员身份反而会让数据目录对不上。

未签名的安装包会触发 SmartScreen 蓝屏提示。确认文件确实来自本仓库 Release 后，点「更多信息」→「仍要运行」。

覆盖升级时安装器会检查旧安装目录里的用户数据。如果它提示「程序仍在运行」，退出主窗口和托盘图标，等几秒让后台的 sidecar、终端和 IM adapter 退干净，再重新运行安装器。别先手动删掉旧安装目录。

## Linux

**AppImage**（免安装，下载即用）：

```bash
chmod +x Claude-Code-Haha-<版本>-Linux-x64.AppImage
./Claude-Code-Haha-<版本>-Linux-x64.AppImage
```

启动失败并提示 FUSE 相关错误时，装一下运行库：Ubuntu 22.04 及更早用 `sudo apt install libfuse2`，24.04 及以后用 `libfuse2t64`。

**deb**（Ubuntu、Debian 等，装进系统菜单）：

```bash
sudo apt install ./Claude-Code-Haha-<版本>-Linux-x64.deb
```

**rpm**（Fedora、openSUSE 等）：

```bash
sudo dnf install ./Claude-Code-Haha-<版本>-Linux-x64.rpm
```

ARM64 机器换成对应的 `Linux-arm64` 文件。

## 从源码跑

想改代码、调试内核，或者只想在终端里用 CLI，可以从源码起：

```bash
git clone https://github.com/LiuGuangHS/EchoFlow-ClaudeCode.git
cd EchoFlow-ClaudeCode
bun install
cp .env.example .env
./bin/echoflow-code
```

需要 [Bun](https://bun.sh) 和 Git。这条路只跑 CLI，桌面端的构建方式和本地服务参数见 [命令行](../cli/index.md)。

## 升级

**应用内更新（推荐）。** 打开「设置 → 关于 → 应用更新」，点「检查更新」。它会比对当前版本和 GitHub Releases 上的最新版本，有新版就下载，下载完提示「安装并重启」。

更新前先把正在跑的会话停掉，未提交的代码存好。

下载卡住不动，多半是网络到不了 GitHub。同一个面板里有「高级更新代理」，可以切成系统代理或填一个本地 HTTP 代理地址（例如 `http://127.0.0.1:7890`）。这个代理只管应用自己的更新下载，不影响模型请求。

**手动换包。** 从 Releases 下新版安装包，按上面各平台的步骤重装一遍即可。会话、服务商配置、技能、Agent、记忆都存在 `~/.claude` 下，不在应用目录里，覆盖安装不会动它们。

:::warning
安装器的数据保护不等于备份。真正重要的东西请自己另存一份。
:::

## Code signing policy

Windows 安装包的签名范围、人工审批、责任角色和验证方法见 [Code signing policy](./code-signing.md)。在 SignPath Foundation 接入完成前，Windows Release 仍会明确标注为未签名；软件联网和本地数据处理方式见[隐私与联网说明](./privacy.md)。

## 装完之后

去 [连接模型服务](./models.md)。没接模型之前，应用能打开，但发不出任何一条消息。

装不上或者打不开，看 [装不上 / 打不开 / 连不上](./troubleshooting.md)。
