---
title: DeepSeek Harness
nav_title: DeepSeek Harness
description: 在 EchoFlow 里通过官方 npx 按需运行原版 DeepSeek Harness。
order: 10
---

# DeepSeek Harness

桌面端通过官方 npm 包 `@deepseek-ai/dsh` 按需启动原版 DeepSeek Harness，不把 DSH 固定版本打进 EchoFlow 安装包。入口在侧边栏的「**DeepSeek Harness**」，启动后会打开独立窗口。

首次启动需要网络连接以便 `npx` 解析并下载官方包。正常启动使用 npm 缓存；点击「**检查官方更新并重启**」时会要求 npm 在线重新检查包。DSH 仍处于预览阶段，升级可能带来不兼容变化，因此不会每次启动都自动更新。

## Node.js 运行环境

EchoFlow 先检测系统中的 Node.js，再检测自己管理的运行时；没有兼容版本时，首次启动会在 EchoFlow 的应用数据目录下载并校验 Node.js LTS。当前最低要求为 Node.js 22.19.0。不会安装或改写系统 Node.js。

面板会显示使用的 Node 版本及来源（系统或 EchoFlow 管理）。这只是 DSH 所需的独立运行时状态，不代表设置页已有通用 Node 运行时管理器。

## 登录与数据隔离

DSH 的配置、会话和插件数据保存在 `deepseek-harness` 专属目录，不会与 EchoFlow 的服务商、会话、Skills、MCP 或 Agents 自动同步。DSH 启动时打印的一次性认证 URL 只在 Electron 主进程内存中暂存，用于首次打开和完成认证跳转；认证完成后立即丢弃，不写入配置、日志或渲染进程状态。

DSH 的会话和插件能力仍独立运行，不接入 EchoFlow 的 Agent Loop。插件市场和 EchoFlow 项目上下文导入尚未包含在当前功能中。

## 生命周期控制

| 状态 | 操作 |
|---|---|
| 已停止 | 启动；检查官方更新并启动 |
| 正在准备 / 启动 | 等待 npx 解析包并启动本地服务 |
| 正在运行 | 打开 DSH；重启；停止；检查官方更新并重启 |
| 运行环境不可用 | 启动时自动准备 EchoFlow 管理的 Node.js，失败时查看面板错误 |

服务绑定到 `127.0.0.1`，端口按需分配。状态页展示可识别的 DSH 版本、Node 版本与来源，并在页面内显示启动错误。

## 常见问题

**首次启动失败或下载很慢。** 确认网络可访问 npm registry，并重试。DSH 的包下载由官方 npm 流程处理。

**更新后行为变化。** DSH 目前仍是预览软件；用「检查官方更新并重启」前请留意其数据兼容性。EchoFlow 不会自动迁移或清理 DSH 数据。

**在 EchoFlow 里配的模型，DSH 里为什么没有？** 两边的数据目录相互独立，模型需要在 DSH 自己的界面中配置。

**DSH 会话会进入 EchoFlow 的会话列表吗？** 不会。DSH 使用自己的会话存储，也不接入 EchoFlow 的 Agent Loop。
