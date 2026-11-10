---
title: Computer Use Source Navigation
nav_title: Source navigation
description: Find Computer Use entry points from settings and tool registration through sessions, transport, and platform engines.
order: 19
---

# Computer Use Source Navigation

When reading Computer Use source, identify the platform and failure boundary before following one call path. Tool registration, runtime readiness, input dispatch, and receiver-visible completion are different states. Start with [Computer Use architecture](computer-use.md) for product and platform boundaries.

## From entry points to native engines

| Question | Source entry points |
| --- | --- |
| Settings status and enablement | `desktop/src/pages/ComputerUseSettings.tsx`, `src/server/api/computer-use.ts` |
| Platform and binary availability | `src/utils/computerUse/setup.ts`, `common.ts`, `gates.ts` |
| Session ownership and cancellation | `src/vendor/computer-use-mcp/mcpServer.ts`, `src/utils/computerUse/wrapper.tsx` |
| macOS JavaScript scheduling | `src/utils/computerUse/replRuntime.ts`, `src/vendor/computer-use-mcp/replApi.ts` |
| macOS native observation and input | `native/cu-helper/Sources/cu-helper/` |
| Windows/Linux commands and transport | `src/vendor/computer-use-mcp/agentDesktopTools.ts`, `src/utils/computerUse/agentDesktopBridge.ts` |
| Windows/Linux native implementation | `native/agent-desktop/` |

## Preserve boundaries while investigating

Enabling Computer Use in Settings and confirming once authorizes all supported apps. Distinguish global enablement, OS permissions, and target validity rather than introducing per-app approvals or category-based permissions.

The macOS helper and Windows/Linux engine use different target references and input mechanisms. Check the selected engine, session identity, and observation result first; do not silently switch execution paths and replay after failure.

## Evidence after changes

Use temporary directories, simulated runners, or loopback transports for argument, state, cancellation, and protocol changes. Focus, TCC, multiple monitors, Spaces, and actual input delivery require separate hardware evidence. Real user configuration and providers are not deterministic test fixtures.

Continue with [native protocols](computer-use-codex-impl-blueprint.md), [window input](computer-use-cef-injection.md), and [verification boundaries](computer-use-native-manual-qa.md).
