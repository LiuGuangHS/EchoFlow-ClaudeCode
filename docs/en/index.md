---
layout: home

hero:
  name: EchoFlow Code
  text: A local coding agent for real projects
  tagline: Work from the terminal, desktop, or IM channels with EchoFlowAPI, Anthropic-compatible models, multi-agent workflows, memory, Skills, and Computer Use.
  actions:
    - theme: brand
      text: Quick Start
      link: /en/guide/quick-start
    - theme: brand
      text: Download Latest
      link: https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest
    - theme: alt
      text: Read Docs
      link: /en/guide/quick-start
    - theme: alt
      text: GitHub Source
      link: https://github.com/LiuGuangHS/EchoFlow-ClaudeCode

features:
  - icon:
      src: /images/home/terminal-desktop.svg
      alt: CLI and desktop
      width: 32
      height: 32
      wrap: false
    title: CLI and desktop together
    details: Use the terminal for fast work and the desktop app for sessions, projects, and settings.
    link: /desktop/
  - icon:
      src: /images/home/provider.svg
      alt: Provider
      width: 32
      height: 32
      wrap: false
    title: Controlled model routing
    details: Start with Qingyun API, then add Anthropic / OpenAI-compatible gateways or local models.
    link: /en/guide/third-party-models
  - icon:
      src: /images/home/agents.svg
      alt: Multi-agent
      width: 32
      height: 32
      wrap: false
    title: Multi-agent work
    details: Split research, implementation, review, and verification with Teams and Worktrees.
    link: /en/agent/
  - icon:
      src: /images/home/memory-skills.svg
      alt: Memory and Skills
      width: 32
      height: 32
      wrap: false
    title: Memory and Skills
    details: Keep project preferences, team rules, and reusable workflows across sessions.
    link: /en/memory/
  - icon:
      src: /images/home/mobile-im.svg
      alt: Mobile and IM
      width: 32
      height: 32
      wrap: false
    title: Mobile and IM access
    details: Scan into H5 on Android, or start local tasks from Telegram, Feishu, WeChat, and DingTalk.
    link: /en/mobile/
  - icon:
      src: /images/home/computer-use.svg
      alt: Computer Use
      width: 32
      height: 32
      wrap: false
    title: Computer Use
    details: Control screenshots, mouse, keyboard, and app windows through the local Python Bridge.
    link: /en/features/computer-use
---

# EchoFlow Code: an AI coding tool that lands in real development workflows

EchoFlow Code is a locally runnable coding agent product with a CLI, desktop app, local server, IM adapters, and documented quality gates. It is built for developers and teams who want AI coding to operate inside real repositories, real branches, and real verification loops.

## Recommended: Qingyun API

New users should start with **Qingyun (EchoFlow) API** at [api.echoflow.cn](https://api.echoflow.cn), also shown as EchoFlowAPI in the product. The desktop Providers page includes an official quick-connect card where you can register EchoFlowAPI, generate a system access token, choose main / haiku models, and set it as the default Provider.

Qingyun API is the shortest path to a working EchoFlow Code setup: it matches the desktop Provider flow, keeps model configuration simple, and still leaves room to add Anthropic-compatible APIs, OpenAI-compatible gateways, or local models later. Teams with their own model gateway can still use Qingyun API as the first validation path before expanding into multi-agent workflows, memory, and Computer Use.

## EchoFlow Ecosystem

| Destination | URL | What to use it for |
| --- | --- | --- |
| Qingyun API main site | [api.echoflow.cn](https://api.echoflow.cn) | Register, create a system access token, and configure the recommended EchoFlow Code Provider. |
| Qingyun AI online apps | [ai.echoflow.cn](https://ai.echoflow.cn) | Try Qingyun AI applications online for lightweight AI workflows. |
| EchoFlow Code docs | [code.echoflow.cn](https://code.echoflow.cn) | Download the desktop app, read setup guides, connect models, and learn multi-agent workflows. |

If you want to try online AI applications immediately, start at [ai.echoflow.cn](https://ai.echoflow.cn). If you want AI to work inside a local codebase, download EchoFlow Code and connect it with Qingyun API from [api.echoflow.cn](https://api.echoflow.cn).

## Who it is for

- Developers who prefer terminal workflows but want a stronger desktop experience.
- Teams that need one coding agent surface for Claude, EchoFlowAPI, OpenAI-compatible gateways, or local models.
- Projects that benefit from multi-agent exploration, implementation, review, testing, and release work.
- Users who want to start tasks, monitor progress, and continue sessions from Telegram, Feishu, WeChat, or DingTalk.
- Teams evaluating Computer Use, desktop automation, real UI validation, and local permission boundaries.

## What you can do

### Complete coding tasks inside local repositories

EchoFlow Code can inspect real code, edit files, run tests, check impact, and leave a maintainable handoff. The CLI is fast for daily development, while the desktop app is better for multi-session, multi-project, and visual workflows.

### Split complex work across agents

The multi-agent system helps separate research, implementation, testing, and review. Worktree isolation keeps parallel exploration from colliding with your main working tree.

### Preserve project knowledge

Memory turns project preferences, team constraints, and decisions into reusable context. Skills package repeated workflows into capabilities that can be reused across tasks.

### Continue from desktop, mobile, and IM channels

The desktop app exposes sessions, settings, Providers, IM configuration, and Computer Use. The Android client scans desktop H5 launch links and keeps chat, approvals, file inputs, and WebSocket flows inside a mobile WebView; IM adapters let you send tasks to local EchoFlow Code from chat tools.

## Quick Start

```bash
bun install
bun run start
```

Desktop users can go straight to [GitHub Releases for the latest build](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest), or read [Installation & Build](/desktop/04-installation) first. For model setup, start with Qingyun API in the [Desktop Quick Start](/desktop/01-quick-start), then use [Third-Party Models](/en/guide/third-party-models) when you want additional Providers.

## Download Guide

| Your device | Recommended download | Best fit |
| --- | --- | --- |
| Windows x64 | `EchoFlow-Code-<version>-win-x64.exe` | Daily desktop use, multi-project sessions, and visual Provider setup. |
| macOS Apple Silicon | `EchoFlow-Code-<version>-mac-arm64.dmg` | M-series Mac users who want the desktop app and local Computer Use. |
| macOS Intel | `EchoFlow-Code-<version>-mac-x64.dmg` | Intel Mac users; first launch may require a manual security approval. |
| Linux x64 | `.AppImage` or `.deb` | AppImage for quick trials, deb for a fixed workstation setup. |
| Linux ARM64 | `linux-arm64.AppImage` or `linux-arm64.deb` | ARM64 Linux devices and development machines. |
| Android | Mobile APK or local build | Connect to desktop with an H5 Token over a trusted LAN or your own HTTPS entry. |

If you are not sure what to choose, start with the desktop app. If you already live in the terminal, use the CLI. If a packaged build is not convenient, run the Web UI and connect it to the local server from your browser.

## Architecture Recommendations

| User type | Recommended architecture | Why it fits |
| --- | --- | --- |
| Individual developer | Desktop app + Qingyun API / EchoFlowAPI Provider | Lowest setup cost for projects, sessions, and model configuration. |
| Terminal-heavy developer | CLI + local repository + project-level config | Keeps shell, git, tests, and editor workflows in the center. |
| Small engineering team | Desktop app + multi-agent workflows + memory + Skills | Turns team constraints, repeated workflows, and review standards into reusable process. |
| Multi-model or private-model user | Local server + Anthropic/OpenAI-compatible Provider + Ollama or gateway | Gives one routing layer for cloud models, local models, and proxy gateways. |
| Mobile remote user | Desktop app + Android client / IM adapters + H5 Token + local server | Scan into H5 or start tasks from IM while the local machine performs real code operations. |
| UI automation and validation user | Desktop app + Computer Use + project test commands | Lets the agent see and operate the desktop while tests verify real interface behavior. |

You can adopt these pieces gradually: start with the desktop app, connect a Provider, and open multi-agent, memory, Skills, IM, or Computer Use only when the workflow actually needs them.

## Documentation

- [Quick Start](/en/guide/quick-start): installation, startup, and basic usage.
- [Desktop](/desktop/): Electron client, Providers, IM, Computer Use, and build notes.
- [Mobile](/en/mobile/): Android client, QR connection, H5 Token, and trusted-network notes.
- [Multi-Agent System](/en/agent/): agent calls, Teams, parallel tasks, and implementation details.
- [Memory System](/en/memory/): extraction, retrieval, AutoDream, and local storage.
- [Skills System](/en/skills/01-usage-guide): custom capabilities, activation, and execution constraints.
- [Channel System](/en/channel/): IM channel architecture and adapter concepts.
- [Computer Use](/en/features/computer-use): local desktop control and safety boundaries.
