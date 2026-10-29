---
title: Project Structure
nav_title: Structure
description: Responsibility boundaries across the CLI, server, desktop app, adapters, and docs site.
order: 3
---

# Project Structure

The repository contains the CLI/TUI, local Server, Electron desktop app, IM adapters, and documentation site. This map lists stable responsibility boundaries rather than every file.

```text
.
├── bin/
│   └── echoflow-code                 # CLI launcher
├── preload.ts                      # Bun preload and build compatibility entry
├── package.json                    # Root scripts and dependencies
├── src/
│   ├── entrypoints/
│   │   └── cli.tsx                 # Main CLI entry
│   ├── main.tsx                    # TUI flow
│   ├── setup.ts                    # Startup initialization
│   ├── screens/                    # REPL and other terminal screens
│   ├── components/                 # Ink UI components
│   ├── tools/                      # Agent tools such as Bash, Edit, and Grep
│   ├── commands/                   # Slash commands
│   ├── services/                   # Shared Provider, MCP, and OAuth services
│   ├── utils/                      # Runtime utilities and Computer Use integration
│   ├── vendor/                     # Controlled vendored implementations
│   └── server/
│       ├── index.ts                # Bun.serve HTTP/WebSocket entry
│       ├── router.ts               # REST resource routing
│       ├── api/                    # API boundaries
│       ├── services/               # Session, Provider, index, and diagnostics services
│       ├── ws/                     # WebSocket protocol and lifecycle
│       ├── proxy/                  # Provider protocol conversion
│       ├── middleware/             # Auth and CORS
│       └── config/                 # Provider presets
├── desktop/
│   ├── src/                        # React Renderer
│   │   ├── api/                    # Server API and WebSocket clients
│   │   ├── components/             # Chat, Workspace, Browser, and layout
│   │   ├── features/               # Isolated features such as Pets
│   │   ├── pages/                  # Sessions, Settings, tasks, diagnostics
│   │   ├── stores/                 # Zustand state
│   │   ├── i18n/                   # Desktop locales
│   │   └── lib/                    # Renderer runtime utilities
│   ├── electron/
│   │   ├── main.ts                 # Electron main entry
│   │   ├── preload.ts              # Main-window Host bridge
│   │   ├── preview-preload.ts      # Native preview bridge
│   │   ├── pet-preload.ts          # Pet-window bridge
│   │   ├── ipc/                    # IPC channels and validation
│   │   └── services/               # Sidecar, terminal, updater, and preview services
│   ├── sidecars/
│   │   └── claude-sidecar.ts       # Unified server / cli / adapters entry
│   ├── scripts/                    # Build, packaging, and resource preparation
│   └── src-tauri/                  # Historical code and current package resources; not the Host
├── adapters/
│   ├── common/                     # Shared config, pairing, messaging, and WS bridge
│   ├── dingtalk/
│   ├── feishu/
│   ├── qq/
│   ├── slack/
│   ├── telegram/
│   ├── wechat/
│   ├── wecom/
│   └── whatsapp/
├── mobile/                         # Kotlin Android shell
├── native/
│   └── cu-helper/                  # Native macOS Computer Use Swift helper
├── runtime/
│   ├── win_helper.py               # Windows Computer Use helper
│   └── requirements-win.txt
├── scripts/                        # Root quality, release, and maintenance scripts
├── tests/                          # Cross-module tests and fixtures
├── site/                           # React docs site, content index, and static build
└── docs/                           # Chinese and English Markdown content
```

## Documentation layout

| Location | Purpose | Published |
| --- | --- | --- |
| `docs/{start,cases,desktop,mobile,im,cli,internals}/` | Chinese product documentation | Yes |
| `docs/en/` | English mirrors, aligned file by file | Yes |
| `docs/images/`, `docs/public/` | Site images and static assets | Yes |
| `release-notes/` | GitHub Release history | No, separate release output |
| `docs/_internal/` | Maintainer runbooks, design notes, and `archive/` | No |
| Root and per-surface `AGENTS.md` | Agent and contributor guidance | No |
| `docs/superpowers/` | Local plans, gitignored | No; never link from a public page |
| `site/src/generated/` | Generated docs index and content | No, gitignored |

Renaming a public page requires updating both `LEGACY_ROUTES` and `legacyRoutes` in `scripts/prepare-static-output.mjs`. When a process draft lands, fold the facts that still matter into `docs/internals/`, then archive it under `docs/_internal/archive/`; public pages must not link to `_internal/`, `archive/`, or `docs/superpowers/`.

## Runtime boundaries

| Entry | Runtime | Responsibility |
|---|---|---|
| `src/entrypoints/cli.tsx` | Bun | CLI/TUI and Agent tools |
| `src/server/index.ts` | Bun / `Bun.serve` | Local HTTP, WebSocket, and H5 |
| `desktop/electron/main.ts` | Electron main | Native desktop Host |
| `desktop/src/` | Chromium Renderer | React desktop UI |
| `desktop/sidecars/claude-sidecar.ts` | Bun-compiled Sidecar | Packaged Server, CLI, and Adapter entry |
| `adapters/<platform>/` | Bun Sidecar | Platform messaging integration |

Place new code at the boundary that owns the responsibility: native desktop capabilities belong in `desktop/electron/`, shared business APIs in `src/server/`, and platform-specific messaging behavior in `adapters/<platform>/`. The Renderer should not bypass these boundaries.
