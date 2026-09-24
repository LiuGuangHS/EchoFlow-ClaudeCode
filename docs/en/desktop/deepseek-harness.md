---
title: DeepSeek Harness
nav_title: DeepSeek Harness
description: Install and run the original DeepSeek Harness from inside EchoFlow — no environment setup, no terminal.
order: 10
---

# DeepSeek Harness

The original DeepSeek Harness (`@deepseek-ai/dsh`) is installed and run from inside the desktop app. No Node environment to prepare, no npm packages, no terminal. The entry point is **DeepSeek Harness** in the sidebar, which opens as its own tab.

## How it relates to EchoFlow

This comes first because it decides how you will actually use the thing.

**DeepSeek Harness keeps its data entirely separate, and the two sides do not interfere.** It has its own configuration directory, sessions, and plugins, and it does **not** sync with EchoFlow's providers, sessions, Skills, MCP servers, or agents. A model channel you configure in EchoFlow is invisible to Harness, and vice versa.

**It is also not wired into EchoFlow's agent loop.** Harness keeps its own sessions and plugin capabilities. Do not expect work done in Harness to show up in EchoFlow's session history or to be reusable by EchoFlow subagents.

There is **no plugin market at this stage**; plugin management will be designed separately.

In one line: **it is closer to an independent tool window opened inside the app than to a feature module of EchoFlow.**

## One-click install

The first time you open the panel the state is **Not installed**, with a single **Install DeepSeek Harness** button. Click it — both the Node runtime and the Harness package are managed by the desktop app.

If the button instead reads **Install runtime and DeepSeek Harness**, the machine has no usable Node runtime. Clicking it prepares the runtime first, then installs Harness. See the next section.

## Runtime requirements

The bundled runtime requires **Node.js 22.19.0 or newer**.

As of 0.5.6, when that is not met the app **downloads the latest compatible LTS release automatically**, verifies its SHA-256, and only then switches over — with **automatic rollback on failure**. Progress is visible in the panel and needs no intervention.

If even the automatic setup fails, the panel reports **Runtime unavailable** plainly rather than failing silently. In that case, read the error in the panel, or check [Won't install, won't open, won't connect](../start/troubleshooting.md).

## Lifecycle control

Once installed, the buttons change with the state:

| State | What you can do |
|---|---|
| Not installed | Install (or install the runtime first) |
| Stopped | Start · Update / Reinstall |
| Running | Open DeepSeek Harness · Restart · Stop |

**Open DeepSeek Harness** lands you in the **original interface**, not an EchoFlow-wrapped version.

Ports are allocated on demand — you never pick one — and startup is protected by a timeout, so a hung start does not wait forever.

## Status and version

The badge in the top-right of the panel is the thing to watch:

- **Running** — the service is up
- **Installing runtime** — Node is being prepared; just wait
- **Runtime unavailable** — the Node version is unmet, or preparation failed
- **Stopped** — installed but not started
- **Not installed** — nothing yet

Once installed, the panel shows **Current version: x.y.z**.

**Errors surface in place** — there is no log file to dig through.

## Updating and reinstalling

**Update / Reinstall** pulls the Harness package again, moving you to the latest version, and also repairs a broken install. It does not touch Harness's own data directory.

## Troubleshooting

**"Runtime unavailable."** Node.js 22.19.0+ is required. From 0.5.6 the app downloads a compatible LTS and verifies it, rolling back on failure; upgrade the app if you are on an older build.

**Startup times out.** Ports are allocated on demand and startup is guarded by a timeout, so this usually means the port is taken or the first start is slow. Wait and retry, or hit **Restart**.

**My EchoFlow models aren't in Harness.** That is by design. The two sides keep separate data, and Harness models and plugins are configured in its own interface.

**Will Harness sessions show up in EchoFlow's session list?** No. It has its own session store and is not wired into the agent loop.

**Does this work on mobile?** No. The entry point only appears when the desktop runtime is available.

## Related

- [Workspace](./workspace.md) — Harness is one of the workspace tabs
- [Settings reference](./settings.md) — app-level settings live there
- [Won't install, won't open, won't connect](../start/troubleshooting.md) — order to check for environment errors
- [Connect a model](../start/models.md) — how EchoFlow's own models are configured
