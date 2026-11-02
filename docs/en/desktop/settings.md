---
title: Settings guide
nav_title: Settings
description: The settings page in five groups — what each tab configures and when you'd need it.
order: 13
---

# Settings guide

Click **Settings** at the bottom of the sidebar. The left rail is arranged in five groups, each with a fixed order:

| Group | Tabs |
|---|---|
| Models & Runtime | Model Settings, Runtime management |
| Preferences | General, Network, Data & Storage, Voice Input, Pets |
| Capabilities | Agents, Skills, Plugins, MCP, Memory, Computer Use |
| Remote Access | H5 Access, IM Adapters |
| Tools & Activity | Terminal, Token usage, Trace, Diagnostics |

**About** sits on its own below the groups. This page walks through them in that order; for your first session, connect a model in **Model Settings**, check permissions and language in **General**, then follow [Your first session](../start/first-session.md).

## Model Settings

Shared model configuration. This tab was called **Providers** before 0.5.5, when it was renamed to Model Settings / Model Management — same place, same contents.

Sign in to Claude, ChatGPT, or Grok with an account (no API key required), add any Anthropic- or OpenAI-compatible service with an API key, or sign in to [EchoFlow SiHub](../start/account.md) and build channels from its call tokens. This is where service credentials, endpoints, and model mappings live; it is not the execution runtime for a session. Choosing a provider, model, or effort inside a session creates a session-level override without replacing this shared configuration.

You'll come here once during setup and rarely again. Full steps in [Connecting a model](../start/models.md).

## General

General covers two areas: appearance and replies, and how the agent works. Check both before your first session; network and local data each have their own tab for when you need them.

![Settings → General: color themes, language, output style, default permissions (Chinese interface)](../../images/app/en/settings-general.webp)

### Before your first session: permissions and replies

| Setting | What to choose | When it takes effect |
|---|---|---|
| Default session permissions | Keep the default **Ask for permission** at first. Inspect the target file or command before approving edits or higher-risk commands. You can change any session separately with the composer control; see [the five modes](./sessions.md#the-five-permission-modes). | Default for new chat sessions; change an existing session in its composer. |
| Response language | Choose a language if you want consistent replies in it. This is independent of the interface language and is unset by default. | Subsequent replies; earlier messages are unchanged. |
| Output style | **Default** is concise; **Explanatory** explains implementation choices; **Learning** asks you to write small pieces. Installed custom styles can also appear here. | New sessions, sessions resumed in a new process, or restarted sessions. A running session keeps its current prompt. |
| Effort level and Thinking Mode | Start with the supported model default. Adjust for speed, cost, or provider compatibility; disabling thinking sends a non-thinking parameter to compatible providers that require one. | Defaults for new sessions; available effort levels depend on the selected model. |

**Try it:** Choose a disposable Git project and ask: “List the files you plan to change, make one small edit, then tell me how to verify it.” Inspect any permission prompt, then [review the Diff](./workspace.md#diff-review-leaving-a-note-on-a-line) file by file.

### Appearance and input

- **Color theme:** Pure White, Paper, Warm Classic, Celadon, Ink Night, or Ink Blue. **Follow the system** lets you choose separate light and dark themes.
- **Language:** changes only the interface, with English, Simplified and Traditional Chinese, Japanese, and Korean choices. It does not set the response language.
- **UI Zoom:** scales the whole window. Use `⌘+` / `⌘-` on macOS or `Ctrl+` / `Ctrl-` on Windows; press `0` to reset to 100%.
- **Message sending:** defaults to Enter to send and Shift+Enter for a newline. If you write long prompts, choose `Ctrl/Cmd+Enter` to send.
- **Default editor:** chooses which detected local editor appears as the default under a file's **Open with** menu.

### For more involved agent workflows

| Setting | When to use it |
|---|---|
| Ultracode | On by default. A standalone keyword triggers dynamic Workflow orchestration; the same text in code blocks, quotes, or paths keeps its literal meaning. |
| Agent Teams | On by default. Use it when a larger task needs several agents working together. New sessions pick it up; existing sessions do after an app restart. See [Subagents](./agents.md) first. |
| Auto-answer questions | Off by default. After 1, 5, 10, or 30 minutes without an answer to an agent's multiple-choice question, it can choose a recommended option. If it cannot choose reliably, it keeps waiting. Use only when you want unattended work to continue. |
| Auto-dream | Off by default. After enough sessions have accumulated, it can organize auto-memory in the background, using additional model calls and tokens. |

### Notifications

- **System Notifications** are off by default. Enable them and grant OS permission when you need alerts for permission requests, completed replies, or scheduled tasks away from the app.

Product screenshots in this guide consistently use the **Pure White** theme so the interface can be compared without palette changes.

## Network

Everything outbound goes through this tab: model services, account sign-in, MCP, and agent tools.

- **Network** uses the system proxy by default. **Direct** bypasses system and inherited process proxies; **Manual** accepts an HTTP/HTTPS URL such as `http://user:password@127.0.0.1:7890`. Click **Save**. New requests use the new route; requests already in flight keep their old route. App updates have a separate proxy under **About**, unaffected by this setting.
- **AI request timeout** defaults to 1800 seconds and accepts at least 30 seconds. Raise it only when the first model response or connection test really times out. For a local model that thinks for a long time, you can enter 14400 seconds (four hours).
- **WebFetch preflight** skips the upstream domain check by default to avoid false failures with third-party providers or restricted networks. Turn this off only when you specifically want the upstream check.
- **WebSearch** defaults to **Auto**: Claude models try native search first, then Tavily or Brave on failure or with non-Claude models. You can force Claude, Tavily, Brave, or Off. Tavily and Brave require your own API keys and a click on **Save**.

## Data & Storage

Check the effect before changing anything here — both settings touch data you already have.

- **Session retention** defaults to 365 days and accepts 0–3650 days. Reducing it immediately removes older records; setting 0 removes all existing records and stops recording session contents. The UI previews and confirms the change. This is not a backup system.
- **Data Storage Location** defaults to `~/.claude` (`%USERPROFILE%\\.claude` on Windows). Portable mode takes an absolute path outside the app installation folder. After an app restart, sessions, configuration, tasks, skills, and plugins are read from the new location. The two directories are not merged or migrated automatically. If `CLAUDE_CONFIG_DIR` is set at launch, remove that environment variable before switching locations in the UI.

## Runtime management

The **Runtime management** page checks the EchoFlow Agent bundled with the app, plus the Claude Code and Codex it can find on this computer through the usual command paths. Windows users can also check WSL distributions on request, or pick a Claude Code or Codex executable by hand. Checking only reads version information: it does not install or update third-party tools, and EchoFlow does not switch your sessions to them because of it.

Each entry shows its source, version, location, and when it was last checked — a version and a "Found" label are the result of a probe, not a standing state. A local path can be shown in its folder, which opens the containing folder and never runs the program. **Found means it exists on this machine; it does not mean EchoFlow can run sessions or Team tasks with it.** The WSL check is user-triggered and reports the distribution and its in-Linux path; a Linux path belongs to another filesystem, so those entries are not offered to the native file manager. WSL installs are managed separately from a Windows install. The SDK is an internal development dependency of EchoFlow, so you do not install or manage it yourself.

DeepSeek Harness keeps its own entry for starting, stopping, and updating. It is a standalone app today and does not accept EchoFlow sessions or Team tasks.

The **EchoFlow Agent runtime** card chooses which executable starts new sessions: **EchoFlow Managed** uses the EchoFlow Agent shipped with the app, and **Claude Code on this computer** uses an executable you installed. That is a choice between two products, not two configurations of one. **Claude Code on this computer** is disabled when this machine has no usable install; choose **Choose a local Claude Code executable** to point at one manually, and the card then shows its full path so you can confirm you picked the right file. If that file is later uninstalled or renamed, the option returns to disabled and you must pick a new one. This setting does not affect sessions already running, and a session can switch separately.

## Voice input

Adds a microphone button next to the composer so speech becomes text without a third-party dictation app. Audio is transcribed only on the machine running the EchoFlow Code service; it never goes to a cloud service.

- **Enable voice input** — shows the dictation button next to the chat composer. The switch only shows the button; the model is downloaded separately.
- **Recognition engine** — click **Download** on first use. The voice runtime, the speech model, and the voice-activity model download in turn and are verified when they finish. An interrupted download keeps what it already has; click **Resume** to continue from that point. The download source can be automatic, official (Hugging Face, npm), or a mirror (hf-mirror, npmmirror), and downloads use the proxy from **Network**.
- **Language** — automatic detection by default, or fixed to Mandarin, English, Japanese, Korean, or Cantonese. A fixed language makes short utterances more reliable.
- **Microphone** — lists the input devices on this machine. Picking the wrong one usually shows up as silence.
- **Transcription test** — record a few seconds and read the result through the same path dictation uses, to confirm the model, microphone, and permission all work.

The model lives on this machine. Deleting it also deletes the runtime files, so you download again afterwards. On a platform without local speech recognition the page says so and never shows the dictation button.

## H5 Access

Continue the same session in your phone's browser. Off by default; enabling it makes the desktop server listen on a LAN address. This tab covers two things:

- **LAN access** — generate an H5 token and QR code so a phone on the same network can join.
- **Public access · ngrok** — with no public IP, connect your own ngrok account (enter the **ngrok Authtoken**) so your phone can reach this machine over the internet.

A newly generated token is shown once — copy it immediately. Tokens from older builds cannot be recovered; regenerate once and it is stored long-term. Full steps in [Phone (H5) and IM](./remote.md).

## IM Adapters

Talk to Claude from WeChat, DingTalk, WhatsApp, Telegram, Feishu, WeCom, QQ, or Slack, and manage paired users. See [Phone (H5) and IM](./remote.md) and [IM integrations](../im/index.md).

## Terminal

A real host shell embedded in the app, for installing plugins, skills, MCP servers, and anything else that needs a command line. The desktop app bundles `echoflow-code`, so anywhere the docs say `claude <args>` you can run `echoflow-code <args>`.

On Windows you can also choose the startup shell (system default, PowerShell 7, Windows PowerShell, Command Prompt, or a custom executable) and set a Bash path — used when a tool calls Unix commands like `grep` or `sed`, usually pointing at Git Bash.

## MCP

External tools and data sources. STDIO, Streamable HTTP, and SSE transports are supported, and the scopes match the CLI:

- **Local** — only for you, but bound to one project.
- **Project** — written to the project's `.mcp.json` and shared with the team.
- **User** — written to your global config, active in every project.

The three numbers at the top are total servers, currently connected, and needs attention. STDIO commands run directly on your machine, so runtimes like Node, Python, and Bun must be installed and on your `PATH`.

## Agents

Browse installed agents and create your own. See [Subagents](./agents.md).

## Skills

Every skill available on this machine, grouped by source, with the prose and source files readable in place. See [Skills and the Skills Market](./skills.md).

## Memory

View and edit the Markdown memory files Claude keeps per project. Pick a project on the left, a file in the middle, then edit or preview the rendered output. The files live in `~/.claude/projects/<project>/memory/` and are loaded by the CLI at runtime.

`/memory` in any session jumps straight here. For how memory is written and recalled, see [Memory system](../internals/memory.md).

## Plugins

A plugin bundles skills, agents, hooks, and MCP servers together. This tab shows installed plugins, their health, and what capabilities each one exposes, with enable, disable, update, and uninstall — including multi-select for bulk operations.

After enabling or disabling anything, click **Apply changes** to push the change into the running runtime.

## Pets

A little robot floating on your desktop. Off by default. See [Desktop pet](./pets.md).

## Computer Use

Let Claude read the screen, click, and type. Enable it, confirm the global consent, and satisfy the OS permission checks; setup steps vary by platform. See [Computer Use](./computer-use.md).

## Token usage

![Settings → Token usage: heatmap and stat cards (Chinese interface)](../../images/app/en/settings-usage.webp)

A usage dashboard computed from the Claude Code session records on this machine. Everything is calculated locally and nothing is uploaded.

- Across the top: total tokens, peak tokens, longest task, current and longest streak.
- In the middle: a heatmap with daily, weekly, and cumulative views. Click a day for that day's sessions, tokens, messages, and tool calls.
- Below: activity insights — active rate, most-used model, skills used, fresh versus cache-hit token split, and estimated cost. Estimated cost excludes models with no known price, and the UI says how many were skipped.

## Trace

Records the model request chain for each session — requests, responses, status events, timings — for debugging stalls, failures, and unexplained waits. The switch sits at the top of this page and is on by default; new sessions produce new records.

Once enabled, new sessions write condensed records to a local traces directory. Existing records stay readable after you turn it off; only new ones stop being written. The trace list supports search, filtering (all / LLM / tools / errors), opening a trace in its own window, and deleting a session's trace without touching its chat history.

## Diagnostics

Where to go when something breaks. Logs server and CLI startup, provider, and session runtime errors.

- Across the top: log size, event count, warnings in the last 24 hours, retention policy.
- **Recent events** lists the actual errors, each with an event ID you can copy on its own.
- **Export Bundle** / **Copy error summary** / **Copy issue report** — use the latter two when filing an issue; they're already formatted.
- **Doctor** — checks user and current-project configuration state, read-only, returning a healthy / not configured / missing / invalid list. `/doctor` in a session opens it directly.
- **Reset safe UI state** — clears only regenerable interface keys like open tabs, theme, and zoom. Chat history, model config, skills, MCP, IM, and OAuth are always protected and never touched.
- **Local index** — status and size of the derived SQLite index, with a rebuild button. Rebuilding only affects the index; source conversations are never deleted.

:::info
Issue reports and exported bundles are redacted on a best-effort basis — chat contents, file contents, full environment variables, and API keys are omitted. Still give them a read before sharing, in case an internal hostname, username, or path slipped through.
:::

## About

Version, changelog, GitHub repo, feedback link.

**App Updates** checks GitHub Releases, downloads, and restarts to install. Updates use their own proxy setting, separate from **Settings → Network** — if updates stall on a corporate network, configure the advanced update proxy here. Differential downloads are off by default; they are attempted only when explicitly enabled on a verified feed. If differential downloading fails, the updater falls back to the full installer.
