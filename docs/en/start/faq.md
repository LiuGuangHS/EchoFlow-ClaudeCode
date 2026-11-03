---
title: EchoFlow Code FAQ
nav_title: FAQ
description: Answers about EchoFlow Code installation, models and costs, local-first networking, source licensing, phone relay, and Computer Use platform limits.
order: 8
---

# EchoFlow Code FAQ

EchoFlow Code is a local-first AI coding desktop client based on Claude Code, available for macOS, Windows, and Linux. Connect your model, let the agent read and edit project files or run commands, and follow execution through permission requests, tool records, and diff review. This page explains installation, networking, licensing, and cross-device boundaries. Public source does not mean open-source licensing, and local first does not mean fully offline.

## Do I need to install Claude Code, Node.js, or Python first?

The desktop installer bundles the CLI and file-search components, so you do not need a separate Claude Code or Node.js installation. Choose the package for your OS and CPU architecture from the [download page](https://code.echoflow.cn/download), then [connect a model](./models.md). Some Computer Use compatibility executors need a Python environment; follow the checks in Settings. Running from source has separate requirements, including Bun and Git. See [Download and install](./install.md) and [Computer Use](../desktop/computer-use.md).

## Does EchoFlow Code include a model? Do I need a Claude subscription?

The application does not include a model, and Claude is not the only connection option. Use supported official account sign-in, a model vendor's API, an EchoFlow SiHub account, or a local model service from LM Studio or Ollama. Available models depend on account entitlements, provider, and configuration. A model name in the documentation does not mean every account can use it. See [Connect a model](./models.md) and [Sign in to EchoFlow SiHub](./account.md).

## Are model calls free? Will a local model always complete the task?

Subscriptions, quotas, and API charges are set by the relevant provider. Running multiple agents also adds model calls. Local models can avoid remote model API charges but still require your own hardware and runtime, and do not guarantee the same task results as remote models. Agent workflows depend on tool calling, API compatibility, and sufficient context capacity. Verify with a small, reversible task rather than relying only on a connectivity test. See [Local model configuration](./models.md) and [Your first session](./first-session.md).

## Does local first mean it works offline and code never leaves my computer?

No. Sessions, settings, memory, and skills are primarily stored locally, but remote model calls send prompts, attachments, selected code context, and tool results to your chosen service. MCP, search and other external tools, messaging, relays, updates, and the upstream runtime can also use the network. Account sign-in authenticates with the relevant service.

A local model can keep inference on your computer, but does not automatically disable other network features. Check enabled tools, services, and permissions before working with private code. See [Privacy and network access](./privacy.md). The project not operating a cloud backend that receives session content does not prevent third-party services from receiving data.

## Is publicly viewable source open source? Can I modify, distribute, or use it commercially?

No. EchoFlow's original code, documentation, and assets are proprietary, with all rights reserved. Public visibility does not grant permission to copy, modify, redistribute, or use them commercially; these require a separate written agreement. The repository's [LICENSE](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/LICENSE) also states that it is not a complete end-user license agreement.

EchoFlow's license does not cover third-party portions. [THIRD_PARTY_LICENSES.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/THIRD_PARTY_LICENSES.md) records that the root `src/` runtime derives from Claude Code source leaked from the Anthropic npm registry on March 31, 2026. It preserves historical notices limiting use to learning and research and prohibiting commercial use and redistribution. This is a provenance record, not authorization from Anthropic; changing the repository's own license cannot expand third-party rights. Legal review of distribution remains an open item in that file. Download availability and instructions for running from source are not proof of permission.

## Can my phone run tasks without the computer?

No. Phone H5, the Android client, and messaging relay connect to services running on your computer; tasks still execute there. Keep the computer on, the application running, and the required network connected. Your phone locking or briefly disconnecting does not mean the computer can sleep or shut down.

Public tunnels and messaging platforms handle the relevant transmitted content. Do not share pairing codes, tokens, or credential-bearing links. For connection methods, revocation, and privacy limits, see [Phone (H5) and IM](../desktop/remote.md) and the [mobile client](../mobile/index.md).

## Does Computer Use work in the background on every platform?

No. Full background clicking and typing without taking over your physical mouse or keyboard requires macOS 14.4 or later. Windows uses a compatibility executor and the system mouse and keyboard; Linux has no executor yet. macOS also requires Accessibility and Screen Recording permissions.

Computer Use changes the target app and may capture sensitive content. Background operation does not mean no side effects. Only one session can control apps at a time, and browsers, terminals, and IDEs have operation restrictions. Read [Computer Use permissions and known limits](../desktop/computer-use.md) before enabling it.

## How do Agent Teams, Dynamic Workflow, and ordinary subagents differ?

Start with a [subagent](../desktop/agents.md) for one bounded task. Choose [Agent Teams](../desktop/agent-teams.md) for shared tasks, member communication, and dependency coordination. Choose [Dynamic Workflow](../desktop/dynamic-workflow.md) for executable steps, parallel checks or ordered handoffs, and reusable orchestration. Small edits are usually simpler in the current session. Both guides include copyable read-only prompts and acceptance checks. A member or phase marked complete does not replace final diff review and testing.
