---
title: DeepSeek Harness
nav_title: DeepSeek Harness
description: Run the original DeepSeek Harness on demand through the official npx package.
order: 10
---

# DeepSeek Harness

The desktop app starts the original DeepSeek Harness from the official npm package, `@deepseek-ai/dsh`, on demand. EchoFlow does not bundle a pinned DSH release. Open **DeepSeek Harness** from the sidebar to launch it in its own window.

The first start needs network access so `npx` can resolve and download the official package. Normal starts use npm's cache. **Check official update and restart** asks npm to check online again. DSH is still in preview, so upgrades can introduce compatibility changes; EchoFlow does not update it on every launch.

## Node.js runtime

EchoFlow checks system Node.js first, then its app-managed runtime. If neither meets the requirement, the first start downloads and verifies a compatible Node.js LTS in EchoFlow's app data directory. The current minimum is Node.js 22.19.0. EchoFlow does not install or modify system Node.js.

The panel shows the Node.js version and whether it comes from the system or EchoFlow. This is the runtime used by DSH; it is not a general Node.js runtime manager in Settings.

## Authentication and data isolation

DSH configuration, sessions, and plugin data live in its own `deepseek-harness` directory. They are not synchronized with EchoFlow providers, sessions, Skills, MCP servers, or agents. DSH's one-time authenticated URL is held briefly in Electron's main-process memory for the initial navigation. It is discarded after the authentication redirect and is never written to config, logs, or renderer state.

DSH sessions and plugins remain independent and are not connected to EchoFlow's agent loop. A plugin market and importing EchoFlow project context are outside this implementation.

## Lifecycle

| State | Actions |
|---|---|
| Stopped | Start; check official update and start |
| Preparing / starting | Wait for npx to resolve the package and start the local service |
| Running | Open DSH; restart; stop; check official update and restart |
| Runtime unavailable | Starting prepares EchoFlow-managed Node.js; read the panel error if that fails |

The service binds to `127.0.0.1` on an automatically allocated port. The panel shows a DSH version when it can identify one from startup output, the Node.js version and source, and startup errors.

## Troubleshooting

**The first start fails or downloads slowly.** Check that the network can reach the npm registry, then retry. The package download uses the official npm flow.

**Behavior changed after an update.** DSH is still preview software. Review its data compatibility before selecting **Check official update and restart**. EchoFlow does not migrate or delete DSH data.

**My EchoFlow models are not in DSH.** Their data directories are separate; configure models in DSH itself.

**Will DSH sessions appear in EchoFlow?** No. DSH has its own session store and does not use EchoFlow's agent loop.
