# EchoFlow Code

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-horizontal-dark.svg">
    <img src="docs/images/logo-horizontal.svg" alt="EchoFlow Code" width="480">
  </picture>
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/LiuGuangHS/EchoFlow-ClaudeCode?style=social)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/LiuGuangHS/EchoFlow-ClaudeCode?style=social)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/LiuGuangHS/EchoFlow-ClaudeCode)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/LiuGuangHS/EchoFlow-ClaudeCode)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/pulls)
[![License](https://img.shields.io/badge/License-MIT-blue)](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/LICENSE)
[![Chinese](https://img.shields.io/badge/Chinese-Available-green)](README.zh-CN.md)
[![Docs](https://img.shields.io/badge/Docs-Visit-FF7A00)](https://code.echoflow.cn)

**English** · [简体中文](README.zh-CN.md)

</div>

EchoFlow Code is a **local-first desktop workspace for Claude Code and model providers**. Run coding sessions, inspect every diff, coordinate Agent Teams and Dynamic Workflows, and keep control of every tool call and model connection.

<p align="center">
  <a href="https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest"><strong>Download desktop app</strong></a> · <a href="docs/en/start/first-session.md"><strong>Start in five minutes</strong></a> · <a href="https://code.echoflow.cn">Documentation</a> · <a href="https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/discussions">Feedback and discussions</a>
</p>

| Inspect every change | Coordinate complex work | Keep control of your setup |
| --- | --- | --- |
| Tool calls, workspace diffs, and undo stay visible. | Subagents, Agent Teams, and Dynamic Workflow make parallel work readable. | Connect official OAuth, vendor APIs, local models, or custom compatible endpoints. |

## Desktop Preview

<p align="center">
  <a href="https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases"><img src="https://img.shields.io/badge/Download_Desktop-macOS_%7C_Windows_%7C_Linux-FF7A00?style=for-the-badge" alt="Download desktop"></a>
  <a href="docs/en/start/install.md"><img src="https://img.shields.io/badge/Install_Guide-Guide-gray?style=for-the-badge" alt="Install guide"></a>
</p>

<table>
  <tr>
    <td align="center" width="33.33%"><img src="docs/images/app/en/session-new.webp" alt="Empty session"><br><b>Start with a clear session</b><br><sub>Project and permissions stay visible</sub></td>
    <td align="center" width="33.33%"><img src="docs/images/app/en/session-main.webp" alt="Running task"><br><b>Follow work as it runs</b><br><sub>Tool calls and progress stay in view</sub></td>
    <td align="center" width="33.33%"><img src="docs/images/app/en/workspace-diff.webp" alt="Workspace diff"><br><b>Review every change</b><br><sub>Focused syntax-highlighted diffs</sub></td>
  </tr>
  <tr>
    <td align="center" width="33.33%"><img src="docs/images/app/en/workspace-preview.webp" alt="Built-in browser preview"><br><b>Verify on the spot</b><br><sub>Open the real edited page in the app</sub></td>
    <td align="center" width="33.33%"><img src="docs/images/app/en/model-picker.webp" alt="Model picker"><br><b>Choose the exact model</b><br><sub>Providers, presets, and local endpoints together</sub></td>
    <td align="center" width="33.33%"><img src="docs/images/app/en/skill-market.webp" alt="Skill marketplace"><br><b>Add the right skill</b><br><sub>Source and safety status are visible first</sub></td>
  </tr>
</table>

## Install the Desktop App

1. Download the macOS, Windows, or Linux installer from [Releases](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases).
2. Configure a model provider, API key, and default model in Desktop Settings.
3. Public macOS releases require signing and notarization. Draft or unsigned builds may require one-time manual approval. Unsigned Windows installers can show SmartScreen; choose “More info” then “Run anyway.” See the [installation guide](docs/en/start/install.md).

## Run the CLI from Source

```bash
bun install
cp .env.example .env
./bin/echoflow-code
```

See [environment variables](docs/en/cli/env.md) and [CLI setup](docs/en/cli/index.md) for configuration details.

## Why EchoFlow Code

EchoFlow Code turns a coding-agent runtime into a visible, reviewable workspace rather than another opaque chat window.

- **Coordinate real multi-agent work**: the Agent Teams workbench shows members, a shared task list, communication, dependency lanes, and completed-session history. Dynamic Workflow runs parallel or pipeline orchestration with phase progress, interruption, and recovery.
- **Keep every change inspectable**: sessions expose permission requests, tool calls, workspace diffs, browser previews, model traces, diagnostics, and an undo path instead of hiding agent execution behind a single response.
- **Use the setup you trust**: connect official Claude, ChatGPT, and Grok sign-in flows; vendor APIs; LM Studio or Ollama; and compatible custom endpoints. Provider credentials, model selection, and permissions remain under your control.
- **Continue beyond one desktop**: keep the same session moving through H5, Android, and messaging integrations while the desktop remains the source of truth for project context and approval.
- **Recover with evidence**: local activity, diagnostics exports, upgrade-safe persistence, and controlled repair paths help investigate startup, provider, or session failures without exposing secrets.

## Desktop Highlights

- **Multi-session workspace**: tabs, project switching, terminal entry, and session history in one place, with a resizable sidebar.
- **Global search**: press Cmd+K to search across every session and jump to the match.
- **Branch / Worktree launch**: choose a repository branch and decide whether to use the current working tree or an isolated Worktree.
- **Review edits file by file**: the workspace lists this turn's changes; open any file for a syntax-highlighted diff, or undo the whole turn.
- **Built-in browser preview**: the page your agent just edited renders right inside the app, cookies and login state included.
- **Five permission modes**: from "ask every time" to "skip permissions" — risky commands, tool calls, and follow-up questions are all approved in the GUI.
- **Bring your own model**: sign in to Claude, ChatGPT, or Grok; use presets for DeepSeek, Kimi, Zhipu GLM and others; or point it at LM Studio and Ollama running locally.
- **Image generation**: generate and edit images right in the chat — sign in with ChatGPT or Grok for instant use, or plug in any OpenAI-compatible Images API.
- **Visual MCP manager**: add and edit MCP servers in a GUI — STDIO / Streamable HTTP / SSE, with project, shared, or global scope.
- **Six colour themes**: white, paper, warm classic, celadon, ink night, and ink blue — optionally following your system's light/dark setting.
- **Skill marketplace**: discover, preview, and install third-party skills from ClawHub / SkillHub, with source and safety status shown up front.
- **Session activity panel**: track task progress, background tasks, SubAgents, and sources in one side panel.
- **Visual SubAgent manager**: create and tune SubAgents in a GUI — model, tools, and permission mode.
- **Agent Teams workbench**: visualize multi-agent collaboration in the GUI — members, tasks, a communication feed, and a dependency-lane canvas.
- **Dynamic Workflow orchestration**: the model writes and runs orchestration scripts on the fly, driving subagents concurrently or in pipelines, with phase views, interrupts, and resume.
- **Model trace**: every model request is logged locally with status and timing — search and filter to diagnose stuck or failed calls.
- **Computer Use**: let the agent take screenshots, click, type, and control desktop apps after authorization.
- **Desktop pets**: Dada, Huhu, Bubu, and Huihui change what they do with the task at hand — or raise one of your own (off by default).
- **H5 remote access**: scan a QR code to continue the session in your phone browser; locking the screen won't kill a running task.
- **IM integration**: chat, switch projects, and approve actions through Telegram / Feishu / WeChat / DingTalk / WhatsApp.
- **Scheduled tasks and usage stats**: run planned tasks in their own sessions and track local token usage trends.

## Documentation

Full documentation: <https://code.echoflow.cn>

| Area | Documents |
|------|-----------|
| Getting started | [Install](docs/en/start/install.md) · [Connect a model](docs/en/start/models.md) · [First session](docs/en/start/first-session.md) · [Troubleshooting](docs/en/start/troubleshooting.md) |
| Desktop | [Overview](docs/en/desktop/index.md) · [Agent Teams](docs/en/desktop/agent-teams.md) · [Dynamic Workflow](docs/en/desktop/dynamic-workflow.md) · [Computer Use](docs/en/desktop/computer-use.md) · [Pets](docs/en/desktop/pets.md) · [H5 and IM relay](docs/en/desktop/remote.md) |
| CLI | [Setup](docs/en/cli/index.md) · [Reference](docs/en/cli/reference.md) · [Environment](docs/en/cli/env.md) |
| Internals | [Desktop architecture](docs/en/internals/desktop.md) · [Agents](docs/en/internals/agent.md) · [Skills](docs/en/internals/skills.md) · [Server API](docs/en/internals/server.md) · [Contributing](docs/en/internals/contributing.md) |

## Feedback and discussions

Use [Discussions](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/discussions) for questions, ideas, and usage notes. Use [Issues](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/issues) for reproducible bugs. Read [SUPPORT.md](SUPPORT.md) before sharing logs, and use [SECURITY.md](SECURITY.md) for vulnerabilities.

## Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript |
| Desktop | Electron |
| Desktop UI | React + Vite |
| Local runtime | [Bun](https://bun.sh) |
| Terminal UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI parsing | Commander.js |
| API | Anthropic SDK |
| Protocols | MCP, LSP |

## Acknowledgements

- [React](https://github.com/facebook/react): UI ecosystem and component model.
- [Electron](https://github.com/electron/electron): cross-platform desktop capabilities.
- [cc-switch](https://github.com/farion1231/cc-switch): provider configuration references.
