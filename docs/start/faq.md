---
title: EchoFlow Code 常见问题
nav_title: 常见问题
description: EchoFlow Code 安装、模型与费用、本地优先和联网、源码许可、手机接力及 Computer Use 平台限制的常见问题。
order: 8
---

# EchoFlow Code 常见问题

EchoFlow Code 是基于 Claude Code 的本地优先 AI 编程桌面客户端，支持 macOS、Windows 和 Linux。它让你连接自己的模型，在项目中读写文件和运行命令，并通过权限请求、工具记录和 Diff 审阅跟踪执行过程。本页说明安装、联网、许可与跨设备使用的边界；源码公开不代表开源授权，本地优先也不代表完全离线。

## 需要先安装 Claude Code、Node.js 或 Python 吗？

使用桌面安装包，不需要另装 Claude Code 或 Node.js：CLI 和文件搜索组件已经随包提供。先从[下载页](https://code.echoflow.cn/download)选择与你的系统和 CPU 架构对应的包，再[连接模型](./models.md)。部分 Computer Use 兼容执行器需要 Python 环境，以设置页检查为准；从源码运行则另有 Bun、Git 等要求。步骤见[下载与安装](./install.md)和 [Computer Use](../desktop/computer-use.md)。

## EchoFlow Code 自带模型吗？必须订阅 Claude 吗？

应用不自带模型，也不只有 Claude 一条接入路径。可以使用受支持的官方账号登录、模型厂商 API、EchoFlow SiHub 账号，或者 LM Studio、Ollama 提供的本地模型服务。可调用的模型取决于账号权限、服务商和配置，不应把文档中的模型名称理解为人人可用。见[连接模型服务](./models.md)与[登录 EchoFlow SiHub](./account.md)。

## 模型调用免费吗？本地模型一定能完成任务吗？

模型服务的订阅、额度与 API 费用由对应服务商决定；并发运行多个 Agent 也会增加模型调用。本地模型可以避免远程模型 API 费用，但仍需要自己的硬件和运行环境，不能保证与远程模型相同的任务效果。Agent 工作流还依赖工具调用、接口兼容性和足够的上下文窗口。请用一个范围小、可撤销的实际任务验收，不要只看连通测试。见[本地模型配置](./models.md)和[第一条会话](./first-session.md)。

## 本地优先是不是代表断网可用、代码不会离开电脑？

不是。会话、设置、记忆和技能主要保存在本机，但调用远程模型时，提示词、附件、所选代码上下文与工具结果会发送给你选择的服务。MCP、搜索等外部工具、IM、中继、更新和上游运行时也可能联网；账号登录需要与相应服务认证。

本地模型可将模型推理留在本机，但不会自动关闭其他联网功能。使用私有代码前，请核对已启用的工具、服务与权限，并阅读[隐私与联网说明](./privacy.md)。项目不运营接收会话内容的云端后端，不等于第三方服务收不到数据。

## 源码公开就是开源吗？可以修改、分发或商用吗？

不是。EchoFlow 原创代码、文档和资源采用保留所有权利的专有许可；源码可查看，不等于获准复制、修改、再分发或商用。这些行为需要单独的书面协议。仓库的 [LICENSE](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/LICENSE) 也明确说明，它不是完整的最终用户许可协议。

第三方部分不在 EchoFlow 的授权范围内。[THIRD_PARTY_LICENSES.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/THIRD_PARTY_LICENSES.md) 记录了根目录 `src/` 运行时来自 Anthropic npm registry 于 2026 年 3 月 31 日泄露的 Claude Code 源码，并保留了学习研究用途、禁止商业用途和再分发等历史声明。这是来源记录，不是 Anthropic 的授权；仓库不能通过改自己的许可来扩大第三方权利。该文件仍将分发的法律审查列为未解决事项。不要把安装包可下载或文档中的源码运行步骤当作授权证明。

## 手机可以脱离电脑单独运行任务吗？

不可以。手机 H5、Android 客户端与 IM 接力连接的是电脑上运行的服务，任务仍在电脑执行。电脑需要开机、应用运行，并保持所需网络连接；手机锁屏或短暂断网不等于电脑可以休眠或关机。

公网隧道和 IM 平台会接触相应传输内容；不要分享配对码、令牌或带凭据的链接。连接方式、撤销授权与隐私限制见[手机 H5 与 IM 接力](../desktop/remote.md)及[移动端客户端](../mobile/index.md)。

## Computer Use 在所有系统都能后台操作吗？

不能。后台点击和输入、不占用真实鼠标键盘的完整体验需要 macOS 14.4 及以上；Windows 使用兼容执行器，会使用系统鼠标键盘；Linux 暂无执行器。macOS 还需要辅助功能和屏幕录制授权。

Computer Use 会影响目标应用，也可能截图到敏感内容；后台操作不等于没有副作用。同一时间只有一条会话能操控，浏览器、终端与 IDE 也有操作限制。开启前请阅读 [Computer Use 的授权与已知边界](../desktop/computer-use.md)。

## Agent Teams、Dynamic Workflow 和普通子 Agent 怎么选？

一个边界清楚的子任务先用[子 Agent](../desktop/agents.md)。需要共享任务、成员通信和依赖协调时用 [Agent Teams](../desktop/agent-teams.md)；需要把步骤写成脚本、并发检查或顺序交接并复用编排时用 [Dynamic Workflow](../desktop/dynamic-workflow.md)。小改动留在当前会话通常更省事。两篇指南都提供可复制的只读提示词和验收清单；成员或阶段显示完成，不能替代最终 Diff 审阅与测试。
