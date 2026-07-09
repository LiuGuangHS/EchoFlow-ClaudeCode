---
layout: home

hero:
  name: EchoFlow Code
  text: 面向真实项目的本地 Coding Agent
  tagline: 在终端、桌面端和 IM 里协同编码，内置清云 API（EchoFlowAPI），支持官方 Claude、Anthropic 兼容模型、多 Agent、记忆系统、Skills 与 Computer Use。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: brand
      text: 配置清云 API
      link: https://api.echoflow.cn/
    - theme: alt
      text: 下载最新版
      link: https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest
    - theme: alt
      text: 清云 AI 在线应用
      link: https://ai.echoflow.cn/

features:
  - icon:
      src: /images/home/terminal-desktop.svg
      alt: CLI 与桌面端
      width: 32
      height: 32
      wrap: false
    title: CLI 与桌面端并行
    details: 终端高频开发，桌面端负责多标签、项目选择和可视化设置。
    link: /desktop/
  - icon:
      src: /images/home/provider.svg
      alt: Provider
      width: 32
      height: 32
      wrap: false
    title: 模型与 Provider 可控
    details: 推荐清云 API，也支持 Anthropic / OpenAI 兼容网关和本地模型。
    link: /guide/third-party-models
  - icon:
      src: /images/home/agents.svg
      alt: 多 Agent
      width: 32
      height: 32
      wrap: false
    title: 多 Agent 协作
    details: 并行探索、实现、审查与验证，用 Teams 和 Worktree 隔离复杂改动。
    link: /agent/
  - icon:
      src: /images/home/memory-skills.svg
      alt: 记忆与 Skills
      width: 32
      height: 32
      wrap: false
    title: 记忆与 Skills
    details: 沉淀项目偏好、团队约束和可复用流程，减少重复解释。
    link: /memory/
  - icon:
      src: /images/home/mobile-im.svg
      alt: 移动与 IM
      width: 32
      height: 32
      wrap: false
    title: 移动与 IM 远程接入
    details: Android 扫码打开 H5，也可用 Telegram、飞书、微信、钉钉发起任务。
    link: /mobile/
  - icon:
      src: /images/home/computer-use.svg
      alt: Computer Use
      width: 32
      height: 32
      wrap: false
    title: Computer Use
    details: 通过本地 Python Bridge 控制截图、鼠标、键盘和应用窗口。
    link: /features/computer-use
---

# EchoFlow Code：落地到真实开发流的 AI 编程工具

EchoFlow Code 是一个本地可运行的 Coding Agent 产品，覆盖 CLI、桌面端、本地服务、IM 适配器和文档化的质量门禁。它适合想把 AI 编程从“聊天窗口”推进到真实仓库、真实分支、真实验证流程里的个人开发者和工程团队。

## 推荐使用清云 API

新用户推荐优先使用 **清云（EchoFlow）API**：[api.echoflow.cn](https://api.echoflow.cn)。桌面端 Providers 页面提供清云 API 快捷接入卡片，可以注册账号、生成系统访问令牌、选择 main / haiku 模型并连接为默认 Provider。

清云 API 是 EchoFlow Code 的推荐模型入口：配置路径更短，和桌面端 Provider 流程贴合，也方便后续在官方 Claude、Anthropic 兼容协议、OpenAI 兼容网关和本地模型之间切换。已经有自有模型网关的团队，可以先用清云 API 跑通项目会话、多 Agent、记忆和 Computer Use，再按需要改成 Custom Provider。

## EchoFlow 生态入口

| 入口 | 地址 | 你可以做什么 |
| --- | --- | --- |
| 清云 API 主站 | [api.echoflow.cn](https://api.echoflow.cn) | 注册账号、获取系统访问令牌，为 EchoFlow Code 配置推荐 Provider。 |
| 清云 AI 在线应用站 | [ai.echoflow.cn](https://ai.echoflow.cn) | 直接体验清云 AI 在线应用，把轻量任务交给在线应用处理。 |
| EchoFlow Code 文档 | [code.echoflow.cn](https://code.echoflow.cn) | 下载桌面端、阅读安装指南、配置模型和学习多 Agent 工作流。 |

如果你只是想快速体验在线 AI 应用，先去 [ai.echoflow.cn](https://ai.echoflow.cn)。如果你要把 AI 落到本地代码仓库，下载 EchoFlow Code，并用 [api.echoflow.cn](https://api.echoflow.cn) 的清云 API 完成模型接入。

## 适合谁

- 想继续使用终端工作流，但需要更完整桌面体验的开发者。
- 想把 Claude、OpenAI 兼容模型、EchoFlowAPI 或本地模型统一接入一个编码代理的团队。
- 需要多 Agent 并行处理探索、实现、审查、测试、发布任务的项目。
- 希望通过 Telegram、飞书、微信或钉钉远程发起任务、查看进度、继续会话的用户。
- 正在评估 Computer Use、桌面自动化、真实 UI 验收和本地权限控制的工程团队。

## 你可以用它做什么

### 在本地仓库里完成端到端编码任务

EchoFlow Code 可以读取真实代码、编辑文件、运行测试、检查影响面，并按照仓库约束留下可交接的结果。终端 CLI 适合高频开发，桌面端适合多会话、多项目和可视化操作。

### 用多 Agent 拆解复杂问题

多 Agent 系统适合把大任务拆成调研、实现、测试、审查等并行路径。配合 Worktree 隔离，可以降低多线探索互相污染的风险。

### 让项目经验沉淀下来

记忆系统会把跨会话偏好、项目约定和历史决策变成可检索上下文。Skills 系统则把高频流程封装成可复用能力，让团队工作方式逐步稳定。

### 从桌面、移动端与 IM 继续工作

桌面端提供会话、设置、Provider、IM 配置和 Computer Use 入口。Android 客户端可以扫码连接桌面端 H5 服务，在手机 WebView 中继续聊天、审批权限和上传文件；IM 适配器则让你可以在 Telegram、飞书、微信或钉钉里向本地 EchoFlow Code 发送任务。

## 快速开始

```bash
bun install
bun run start
```

桌面端用户可以直接前往 [GitHub Releases 下载最新版](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest)，也可以先查看 [安装与构建](/desktop/04-installation)。需要模型接入时，推荐先按 [桌面端快速上手](/desktop/01-quick-start) 配置清云 API，再查看 [第三方模型](/guide/third-party-models) 扩展其他 Provider。

## 下载引导

| 你的设备 | 推荐下载 | 适合场景 |
| --- | --- | --- |
| Windows x64 | `EchoFlow-Code-<版本>-win-x64.exe` | 日常桌面使用、多项目会话、Provider 可视化配置。 |
| macOS Apple Silicon | `EchoFlow-Code-<版本>-mac-arm64.dmg` | M 系列 Mac 用户，适合桌面端和本地 Computer Use。 |
| macOS Intel | `EchoFlow-Code-<版本>-mac-x64.dmg` | Intel Mac 用户，首次打开可能需要在系统安全设置中放行。 |
| Linux x64 | `.AppImage` 或 `.deb` | AppImage 适合免安装试用，deb 适合固定工作站环境。 |
| Linux ARM64 | `linux-arm64.AppImage` 或 `linux-arm64.deb` | ARM64 Linux 设备和开发机。 |
| Android | 移动端 APK / 本地构建 | 通过 H5 Token 扫码连接桌面端，适合可信局域网或自建 HTTPS 入口。 |

不知道怎么选时，优先下载桌面端；已经习惯终端工作流的用户，可以直接用 CLI；安装包暂时不可用时，用 Web UI 模式在浏览器里连接本地服务。

## 按用户类型推荐架构

| 用户类型 | 推荐架构 | 为什么这样选 |
| --- | --- | --- |
| 个人开发者 | 桌面端 + 清云 API / EchoFlowAPI Provider | 安装后即可管理项目、会话和模型，配置成本最低。 |
| 终端重度用户 | CLI + 本地仓库 + 项目级配置 | 保留 shell、git、测试命令和编辑器工作流，适合高频编码。 |
| 小团队协作 | 桌面端 + 多 Agent + 记忆系统 + Skills | 把团队约束、常用流程和审查标准沉淀下来，减少重复解释。 |
| 多模型/私有模型用户 | 本地服务 + Anthropic/OpenAI 兼容 Provider + Ollama 或网关 | 统一模型入口，方便在云端模型、本地模型和代理网关之间切换。 |
| 移动远程使用 | 桌面端 + Android 客户端 / IM 适配器 + H5 Token + 本地服务 | 手机扫码进入 H5 或从 IM 发起任务，本地机器执行真实代码操作。 |
| UI 自动化验证 | 桌面端 + Computer Use + 项目测试命令 | 让 Agent 能看见桌面、操作应用，并结合测试命令验证真实界面。 |

架构选择可以从轻到重渐进：先用桌面端跑通 Provider 和项目会话，再按需要打开多 Agent、记忆、Skills、IM 或 Computer Use。这样不会一开始就把所有能力堆进工作流里。

## 文档入口

- [快速开始](/guide/quick-start)：安装、启动和基础使用。
- [桌面端](/desktop/)：Electron 客户端、Provider、IM、Computer Use 和构建说明。
- [移动端](/mobile/)：Android 客户端、扫码连接、H5 Token 和可信网络说明。
- [多 Agent 系统](/agent/)：Agent 调用、Teams、并行任务和实现细节。
- [记忆系统](/memory/)：记忆提取、检索、AutoDream 和本地存储。
- [Skills 系统](/skills/01-usage-guide)：自定义能力、触发条件和执行约束。
- [IM 接入](/im/)：Telegram、飞书、微信、钉钉等远程入口。
- [Computer Use](/features/computer-use)：本地桌面控制能力与安全边界。
