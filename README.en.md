# EchoFlow Code

<p align="center">
  <img src="docs/images/app-icon.png" alt="EchoFlow Code" width="480">
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/LiuGuangHS/EchoFlow-ClaudeCode?style=social)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/LiuGuangHS/EchoFlow-ClaudeCode?style=social)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/LiuGuangHS/EchoFlow-ClaudeCode)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/LiuGuangHS/EchoFlow-ClaudeCode)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/pulls)
[![License](https://img.shields.io/github/license/LiuGuangHS/EchoFlow-ClaudeCode)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/LICENSE)
[![中文](https://img.shields.io/badge/🇨🇳_中文-Available-green)](README.md)
[![English](https://img.shields.io/badge/🇺🇸_English-当前-blue)](README.en.md)
[![Docs](https://img.shields.io/badge/📖_Documentation-Visit-FF7A00)](https://code.echoflow.cn)

</div>

EchoFlow Code is a local coding agent for real projects on macOS, Windows, and Linux. Work from the terminal, desktop, or IM channels with Qingyun API (EchoFlowAPI), official Claude, Anthropic-compatible models, multi-agent workflows, memory, Skills, and Computer Use. Sessions, projects, branch / Worktree launch, right-side file changes, code diffs, permission review, H5 remote access, and scheduled tasks live in one desktop app.

<p align="center">
  <a href="#desktop-preview">Desktop Preview</a> · <a href="#quick-links">Quick Links</a> · <a href="#install-the-desktop-app">Install</a> · <a href="#desktop-highlights">Highlights</a> · <a href="#community--contact">Community</a> · <a href="#more-documentation">More Docs</a>
</p>

<p align="center">
  <a href="https://code.echoflow.cn"><img src="https://img.shields.io/badge/Docs-code.echoflow.cn-D97757?style=for-the-badge" alt="EchoFlow Code docs"></a>
  &nbsp;
  <a href="https://api.echoflow.cn/"><img src="https://img.shields.io/badge/Qingyun_API-api.echoflow.cn-D97757?style=for-the-badge" alt="Qingyun API"></a>
  &nbsp;
  <a href="https://ai.echoflow.cn/"><img src="https://img.shields.io/badge/Online_Apps-ai.echoflow.cn-gray?style=for-the-badge" alt="Qingyun AI online apps"></a>
</p>

---

## Quick Links

| Destination | URL | Best fit |
|------|------|----------|
| EchoFlow Code docs | [code.echoflow.cn](https://code.echoflow.cn) | Download the desktop app, read setup guides, connect models, and learn multi-agent workflows. |
| Qingyun API main site | [api.echoflow.cn](https://api.echoflow.cn/) | Register, create a system access token, and configure the recommended EchoFlow Code Provider. |
| Qingyun AI online apps | [ai.echoflow.cn](https://ai.echoflow.cn/) | Try lightweight online AI workflows; use EchoFlow Code when you need AI inside local repositories. |
| Community & contact | [Community & Contact](#community--contact) | Join community groups, contact the maintainer on WeChat, share requirements, or leave team usage leads. |

If you want AI to work inside a local codebase, start with EchoFlow Code and connect it with [Qingyun API](https://api.echoflow.cn/). If you only want lightweight online AI workflows, start with [Qingyun AI online apps](https://ai.echoflow.cn/).

---

## Desktop Preview

The EchoFlow Code desktop app brings sessions, multi-project navigation, branch / Worktree controls, right-side file changes, code diffs, permission review, provider setup, and remote access into one graphical workspace. EchoFlowAPI is the recommended built-in provider for better compatibility and native Claude Code ecosystem support, while official vendor APIs, local models, and custom APIs remain configurable.

<p align="center">
  <a href="https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases"><img src="https://img.shields.io/badge/⬇_Download_Desktop-macOS_%7C_Windows_%7C_Linux-FF7A00?style=for-the-badge" alt="Download Desktop"></a>
  &nbsp;
  <a href="docs/desktop/04-installation.md"><img src="https://img.shields.io/badge/📖_Install_Guide-Guide-gray?style=for-the-badge" alt="Install Guide"></a>
</p>

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/10_desktop_workspace.png" alt="Desktop workspace"><br><b>Desktop Workspace</b></td>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/13_workspace_changes_worktree.png" alt="Right-side changes and Worktree"><br><b>Right-side Changes & Worktree</b></td>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/02_edit_code.png" alt="Code editing"><br><b>Code Editing & Diff View</b></td>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/03_ask_question_and_permission.png" alt="Permission control"><br><b>Permission Review & AI Questions</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/12_h5_access.png" alt="H5 remote access"><br><b>H5 Remote Access</b></td>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/11_token_usage.png" alt="Token usage"><br><b>Token Usage</b></td>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/06_settings_computer_use.png" alt="Computer Use"><br><b>Computer Use</b></td>
    <td align="center" width="25%"><img src="docs/images/desktop_ui/08_scheduled_task.png" alt="Scheduled tasks"><br><b>Scheduled Tasks</b></td>
  </tr>
</table>

---

## Install the Desktop App

1. Download the macOS / Windows / Linux desktop installer from [Releases](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases).
2. On first launch, configure your model provider, API key, and default model in Settings.
3. macOS releases prefer signing and notarization. When certificates are unavailable, the workflow publishes an unsigned fallback that needs the bundled helper script or one-time manual approval. Unsigned Windows installers may show SmartScreen; click "More info" -> "Run anyway". See the [desktop installation guide](docs/desktop/04-installation.md).

## Run the CLI from Source

For users who want to debug the underlying CLI, server, or local development flow:

```bash
bun install
cp .env.example .env
./bin/echoflow-code
```

The legacy `claude-haha` command is kept only as a compatibility shim for older scripts and installs. New docs and scripts should use `echoflow-code`.

See [environment variables](docs/en/guide/env-vars.md) and [global usage](docs/en/guide/global-usage.md) for more configuration options.

---

## Desktop Highlights

- **Multi-session workspace**: tabs, project switching, terminal entry, and session history in one place.
- **Branch / Worktree launch**: choose a repository branch and decide whether to use the current working tree or an isolated Worktree.
- **Right-side file changes**: review changed files, added/removed lines, and current workspace state while chatting.
- **Visual code changes**: inspect edits, file writes, and diffs directly in the desktop app.
- **Permission review**: approve risky commands, tool calls, and model follow-up questions in the GUI.
- **Multi-provider setup**: configure Anthropic-compatible APIs, third-party models, WebSearch fallback, and local options.
- **Skill Marketplace**: discover, preview, install, and manage third-party skills from ClawHub / SkillHub in the desktop app.
- **Session Activity Panel**: review tasks, background tasks, SubAgents, team activity, and sources in one side panel.
- **Computer Use**: let the agent take screenshots, click, type, and control desktop apps after authorization.
- **H5 remote access**: open the current desktop session from a phone or another device with a one-time token.
- **IM integration**: chat, switch projects, and approve actions through Telegram / Feishu / WeChat / DingTalk.
- **Scheduled tasks and usage stats**: create planned tasks and track local token usage trends.

---

## More Documentation

| Document | Description |
|------|------|
| [Environment Variables](docs/en/guide/env-vars.md) | Full env var reference and configuration methods |
| [Third-Party Models](docs/en/guide/third-party-models.md) | Using OpenAI / DeepSeek / Ollama and other non-Anthropic models |
| [Contributing](docs/en/guide/contributing.md) | Local tests, live model baselines, PR gates, and release gates |
| [Memory System](docs/memory/01-usage-guide.md) | Cross-session persistent memory usage and implementation |
| [Multi-Agent System](docs/agent/01-usage-guide.md) | Agent orchestration, parallel tasks and Teams collaboration |
| [Skills System](docs/skills/01-usage-guide.md) | Extensible capability plugins, custom workflows and conditional activation |
| [IM Integration](docs/im/) | Remote chat, project switching, and permission approval via Telegram / Feishu / WeChat / DingTalk |
| [Computer Use](docs/en/features/computer-use.md) | Desktop control (screenshots, mouse, keyboard) — [Architecture](docs/en/features/computer-use-architecture.md) |
| [Desktop App](docs/desktop/) | Electron + React GUI client — [Quick Start](docs/desktop/01-quick-start.md) \| [Architecture](docs/desktop/02-architecture.md) \| [Installation](docs/desktop/04-installation.md) |
| [Global Usage](docs/en/guide/global-usage.md) | Run echoflow-code from any directory |
| [FAQ](docs/en/guide/faq.md) | Common error troubleshooting |
| [Source Fixes](docs/en/reference/fixes.md) | Fixes compared with the original leaked source |
| [Project Structure](docs/en/reference/project-structure.md) | Code directory structure |

---

## Community & Contact

Scan a QR code to join the community groups or contact the maintainer on WeChat.

<table>
<tr>
<td align="center" width="33%">
<img src="docs/images/community/echoflow-aigc-group.png" width="220" alt="EchoFlow AIGC community group QR code"><br>
<b>EchoFlow AIGC Group</b>
</td>
<td align="center" width="33%">
<img src="docs/images/community/echoflow-vibecoding-group.png" width="220" alt="EchoFlow Vibecoding community group QR code"><br>
<b>EchoFlow Vibecoding Group</b>
</td>
<td align="center" width="33%">
<img src="docs/images/community/wechat-contact.png" width="220" alt="WeChat contact QR code"><br>
<b>WeChat Contact</b>
</td>
</tr>
</table>

---

## Tech Stack

| Category | Technology |
|------|------|
| Language | TypeScript |
| Desktop app | Electron |
| Desktop UI | React + Vite |
| Local runtime | [Bun](https://bun.sh) |
| Terminal UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI parsing | Commander.js |
| API | Anthropic SDK |
| Protocols | MCP, LSP |

## Thanks

Thanks to the following open-source projects and community practices for reference and inspiration:

- [NanmiCoder/cc-haha](https://github.com/NanmiCoder/cc-haha): the original upstream project that laid the foundation for EchoFlow Code's ongoing iteration.
- [React](https://github.com/facebook/react): frontend engineering and component-based UI ecosystem.
- [Electron](https://github.com/electron/electron): cross-platform desktop app capabilities and engineering practices.
- [cc-switch](https://github.com/farion1231/cc-switch): reference for model provider configuration.

---

## ⭐ Star History

If this project helps you, please support it with a ⭐ Star so more people can discover EchoFlow Code.

<a href="https://www.star-history.com/#LiuGuangHS/EchoFlow-ClaudeCode&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=LiuGuangHS/EchoFlow-ClaudeCode&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=LiuGuangHS/EchoFlow-ClaudeCode&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=LiuGuangHS/EchoFlow-ClaudeCode&type=Date" />
  </picture>
</a>

---

## Disclaimer

This repository is based on the Claude Code source leaked from the Anthropic npm registry on 2026-03-31. All original source code copyrights belong to [Anthropic](https://www.anthropic.com). It is provided for learning and research purposes only.
