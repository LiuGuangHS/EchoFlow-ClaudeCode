---
title: Desktop feature map
nav_title: Feature map
description: Feature map of the EchoFlow Code desktop app: sessions and permissions, diff review, Agent Teams, Dynamic Workflow, Computer Use, scheduled tasks, and phone or IM relay.
order: 0
---

# Desktop feature map

EchoFlow Code is a local-first AI coding desktop client for macOS, Windows, and Linux. Choose your model, let the agent read and edit project files or run commands, and inspect permission requests, tool calls, and file-by-file diffs in one window. Projects and sessions sit on the left, the conversation in the middle, and files, diffs, and browser previews on the right. Agent Teams, Dynamic Workflow, scheduled tasks, and phone relay extend this workflow; each linked guide explains its platform and network limits.

This page is a map, not a manual. One line per feature — click through for the details. If you haven't installed it or connected a model yet, start with [Get started](../start/index.md).

To learn by doing, choose a task from the [practical guides](../cases/index.md).

## Three places to know

- **Sidebar** — under the brand seal: New session, Scheduled, Skills Market. Below that, the search bar and your projects and past sessions. Settings sits at the bottom. Drag the edge to resize it.
- **Tab bar** — sessions side by side, switched like browser tabs. The four buttons on the right are Activity, Open project, Open terminal, and Show/hide workspace.
- **Composer toolbar** — left to right: attachments, permission mode, launch location, context usage ring, model and effort, and the run button.

## What you'll use daily

- [Sessions, permissions, and review](./sessions.md) — starting a session, reading tool cards, answering permission prompts, undoing a turn that went wrong.
- [Workspace](./workspace.md) — the right-hand panel: changed files, diff review, line comments, isolated worktrees, built-in browser.
- [Settings reference](./settings.md) — find settings by topic: themes, languages, proxy, terminal, MCP, token usage.

## Getting more work out of it

- [Subagents](./agents.md) — when to delegate, which agents ship built in, how to write your own.
- [Agent Teams workbench](./agent-teams.md) — see members, shared tasks, communication, and dependencies in one panel.
- [Dynamic Workflow](./dynamic-workflow.md) — orchestrate agents in parallel or pipelines, then observe, interrupt, and recover runs.
- [Skills and the Skills Market](./skills.md) — what a skill is, how it differs from an agent, what to check before installing one.
- [Scheduled tasks](./schedule.md) — have Claude review yesterday's commits every morning.
- [Computer Use](./computer-use.md) — control other desktop apps; macOS 14.4+ supports background input without taking over your mouse or keyboard, Windows uses system input, and Linux is not supported.

## Continuing somewhere else

- [Phone (H5) and IM](./remote.md) — while your computer stays running, scan a QR code to continue the session in a mobile browser, or chat remotely from apps such as WeChat, Feishu, or Telegram.
- [IM integrations](../im/index.md) — setup, permissions, and troubleshooting by messaging platform.

## Making it yours

- [Desktop pet](./pets.md) — a little robot that floats on your desktop and shows you how the current task is going. Off by default.

## Curious how it works inside

The pages above cover usage. For architecture and source, start at the [architecture overview](../internals/index.md); the desktop process boundaries are in [Desktop Architecture](../internals/desktop.md).
