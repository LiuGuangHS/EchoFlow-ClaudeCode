# DeepSeek Harness Roadmap

Status: active planning record, last reviewed 2026-08-21.

This document is the maintainer handoff for the independent DeepSeek Harness module. It records the product boundary, current implementation state, deferred decisions, and the ordered work needed to make the module releasable. It is not public product documentation and must not be linked from `docs/` navigation.

## Product boundary

DeepSeek Harness is an independent top-level desktop page and hosted runtime inside EchoFlow Code. It is not an EchoFlow provider, Agent Runtime, session implementation, Skills/MCP/Agents integration, or replacement for the existing EchoFlow Agent Loop.

The module owns only:

- installing and starting the original `@deepseek-ai/dsh` Web CLI;
- opening that CLI in a dedicated Electron window;
- reporting lifecycle state and actionable errors;
- keeping Harness configuration, sessions, and future plugin state separate from EchoFlow state.

The module must not:

- route EchoFlow chat sessions through DSH;
- copy EchoFlow provider credentials or session data into DSH;
- reuse a system-installed `dsh` command as the managed product runtime;
- expose arbitrary package names, Git URLs, local paths, shell commands, executable paths, or ports through renderer IPC;
- claim that third-party DSH plugins are sandboxed by EchoFlow.

## Current decisions

| Decision | Current contract |
| --- | --- |
| Product name | `DeepSeek Harness` in UI and user-facing copy |
| Data root | `<app.getPath('userData')>/deepseek-harness/` |
| Windows example | `%LOCALAPPDATA%/EchoFlow Code/deepseek-harness/` |
| Managed runtime | `runtime/dsh/<version>/` |
| Harness home | `data/`, passed as `DSH_HOME` |
| Other directories | `logs/`, `downloads/`, `backups/` remain reserved; do not imply they are active until code uses them |
| DSH package | `@deepseek-ai/dsh@0.1.0-rc.7` (fixed for this phase) |
| Node policy | Reuse an absolute system Node.js executable only when version `>=22.19.0` is available; do not reuse system DSH |
| Installer | Use the npm executable beside the selected Node; do not use `npx` |
| Network binding | `127.0.0.1` only |
| Window | Separate Electron `BrowserWindow`, not an iframe or EchoFlow session tab |
| Plugin marketplace | Deferred; no EchoFlow-owned plugin marketplace in the current phase |

The system-Node-only policy has a known usability ceiling: machines without a compatible Node/npm pair cannot install DSH. A managed Node fallback is a later task, not an implicit fallback to `npx` or a global DSH installation.

## Current implementation inventory

Implemented or present in the dirty worktree; each item still requires current-checkout verification before release claims:

- `desktop/electron/services/deepseekHarnessRuntime.ts`: lifecycle service, fixed-version installation, isolated `DSH_HOME`, loopback startup, status persistence, concurrent start/install coalescing, and process-tree cleanup.
- `desktop/electron/services/deepseekHarnessRuntime.test.ts`: unit coverage for path isolation, Node availability/version checks, launch arguments, environment isolation, concurrency, stop, and child exit.
- `desktop/electron/main.ts`: runtime ownership, fixed no-payload IPC handlers, dedicated Harness window, loopback navigation allowlist, popup/redirect blocking, denied permissions, and quit cleanup.
- `desktop/src/pages/DeepSeekHarness.tsx`: install/start/open/restart/stop status page. It is desktop-only and explicitly says plugin-market support is not available yet.
- `desktop/src/components/layout/Sidebar.tsx`, `ContentRouter.tsx`, `TabBar.tsx`, and `stores/tabStore.ts`: top-level navigation and special-tab isolation.
- `desktop/electron/ipc/channels.ts`, `capabilities.ts`, and `desktop/src/lib/desktopHost/*`: typed host boundary with no-payload fixed actions; browser/H5 rejects the feature.

These files are mixed with unrelated in-flight changes. A future implementation pass must inspect the current diff first and preserve unrelated work.

## Ordered task register

### DSH-0 — ownership and baseline audit

State: current handoff gate.

Before editing implementation, record the current `git status --short`, inspect all Harness files above, and run the narrow tests. Separate Harness changes from unrelated runtime, server, docs, and generated build changes. Do not stage or commit generated artifacts.

Acceptance:

- the diff lists every Harness-owned file;
- no unrelated dirty file is reformatted or overwritten;
- the exact test and type-check commands are recorded;
- the current package version, Node policy, data root, and deferred plugin decision remain unchanged unless explicitly approved.

### DSH-1 — make installation reliable and observable

State: incomplete.

Keep installation constrained to the fixed package/version and the app-owned runtime directory. Validate the npm executable beside the compatible Node before starting a network install. Preserve an existing working installation when an update attempt fails. Surface actionable errors for missing Node, missing npm, network failure, package failure, and incomplete launcher output.

Acceptance:

- a real temporary-user-data install succeeds on a supported machine;
- a failed install leaves no partial active runtime and does not destroy the previous working runtime;
- `state.json` is written atomically and invalid/missing state is handled as not installed;
- install, reinstall of the same version, and interruption have focused regression coverage;
- no credentials from EchoFlow config are passed to npm or DSH.

### DSH-2 — define update and rollback behavior

State: incomplete; current UI has no separate update operation.

The first release may use a fixed-version reinstall as the update mechanism, but the behavior must be explicit. Add version metadata and a migration rule before changing `DSH_VERSION`. Do not replace a running runtime in place. Stop DSH before update, install to a temporary sibling, validate the launcher, atomically promote it, and retain enough backup information to recover the prior working version.

Acceptance:

- the UI communicates whether the action is install, reinstall, or update;
- a failed update keeps the prior version startable;
- a successful update reports the actual managed version;
- downgrade/rollback behavior is either tested and supported or explicitly unavailable;
- package integrity and lockfile/reproducibility requirements are documented before adding a remote version index.

### DSH-3 — complete process and window lifecycle

State: partially implemented; needs end-to-end proof.

Verify start, readiness, open, stop, restart, child exit, startup timeout, window close, app quit, and stale-port behavior against the real DSH Web CLI. Keep the server on loopback and keep the BrowserWindow navigation allowlist tied to the active loopback origin.

Acceptance:

- start waits for a real successful health/readiness response before opening the window;
- stop kills the full child process tree on Linux and Windows;
- startup failure leaves no orphan DSH process and reports stderr without leaking secrets;
- closing the Harness window does not silently delete DSH data;
- app quit stops DSH synchronously enough to prevent orphan processes;
- a real desktop smoke procedure covers install -> start -> open -> stop.

### DSH-4 — harden the Electron boundary

State: partially implemented; security review required before release.

Review the main-process-only IPC registration, no-payload channels, BrowserWindow `sandbox`, `contextIsolation`, disabled Node integration, permission denial, external-link handling, redirect/popup blocking, loopback origin checks, and environment allowlist. Treat DSH and its plugins as user code with the same local-machine authority as the managed Node process.

Acceptance:

- renderer input cannot choose an executable, package, source, port, environment variable, or command;
- only the active loopback DSH origin can be loaded in the Harness window;
- external HTTP(S) links open in the system browser and cannot navigate the Harness window;
- no EchoFlow tokens, provider secrets, `CLAUDE_CONFIG_DIR`, or unrelated app paths enter the DSH environment;
- hostile/invalid persisted state cannot escape the app-owned root;
- security review records any accepted risk that remains because DSH plugins execute locally.

### DSH-5 — fix desktop startup and visible UI evidence

State: blocked by the previously observed renderer `Failed to fetch` startup issue.

Reproduce and fix the dynamic local-server URL/IPC startup ordering before using the preview as Harness evidence. The known symptom was a healthy sidecar on a dynamic port while the renderer still polled the default `127.0.0.1:3456`. Trace `getServerUrl()`, preload exposure, `initializeDesktopServerUrl()`, AppShell startup, and background polling as one flow; do not treat repeated retry clicks as a fix.

Acceptance:

- the renderer uses the actual sidecar URL before scheduled polling starts;
- startup failure distinguishes server-unavailable, IPC-unavailable, and request-authentication errors;
- the normal EchoFlow desktop flow works after the fix;
- the Harness page is visible only in Electron desktop mode and does not appear in browser/H5 mode;
- visible smoke evidence records the exact build, temporary data root, actions, and cleanup.

### DSH-6 — package and cross-platform verification

State: package artifacts exist but evidence is incomplete.

Retain the Linux AppImage/deb and Wine/NSIS Windows cross-build workflow. Package creation is not installation proof. Run package smoke where supported, then test the installed/unpacked app with isolated user data on Linux and Windows. Record unsigned status and unavailable macOS evidence separately.

Acceptance:

- Linux AppImage and deb launch with Harness IPC registered;
- Windows x64 NSIS artifact installs or its unpacked equivalent runs under a real Windows/Wine-compatible smoke path;
- the package does not rely on repository paths or development-only files;
- a clean user-data directory produces the expected `deepseek-harness` layout;
- no generated build output is committed.

### DSH-7 — public documentation after behavior proof

State: not started.

Only document shipped behavior after DSH-1 through DSH-6 have evidence. Add Chinese/English user guidance under the existing `desktop/` or `start/` sections only if the feature is release-ready. Keep architecture and maintainer plans under `maintainers/`. Do not document a plugin marketplace until it is separately approved and implemented.

Acceptance:

- Chinese and English pages describe the same install/runtime/data-isolation behavior;
- docs state the Node.js prerequisite accurately if system-Node-only remains;
- docs explain that DSH sessions/plugins are independent from EchoFlow;
- no page promises update, plugin, or sandbox behavior that is not shipped;
- `bun run check:docs` passes.

### DSH-8 — future plugin management decision

State: explicitly deferred by product decision.

Do not implement an EchoFlow-owned plugin marketplace now. When reauthorized, first research the original DSH plugin contract and decide whether EchoFlow should provide discovery only, installation only, or a curated registry. Any future registry must use fixed package/version/integrity metadata and must not accept arbitrary Git URLs or local paths from the renderer.

Acceptance for a future task:

- the DSH plugin loading/profile model is documented from official source;
- trust, update, uninstall, rollback, and user-code execution risks are reviewed;
- the UI boundary remains separate from EchoFlow Skills, MCP, Agents, and Plugins;
- marketplace work has its own implementation and security review rather than being folded into DSH-1.

## Required verification matrix

| Evidence | What it proves | Not enough by itself |
| --- | --- | --- |
| Unit tests | state transitions and dependency seams | real npm/DSH installation |
| Electron host tests | IPC and main-process behavior | visible renderer flow |
| Package smoke | artifact shape and launch metadata | installed Harness usability |
| Host-service smoke | real child lifecycle and loopback readiness | packaged UI behavior |
| Visible desktop smoke | user flow and startup ordering | cross-platform coverage |
| Security review | boundary and secret handling | plugin safety certification |
| Public docs check | links/build/locale parity | semantic truth without code review |

## Explicit non-goals for the current phase

- no EchoFlow Agent Loop integration;
- no provider/model routing through DSH;
- no synchronization of EchoFlow sessions, credentials, Skills, MCP, Agents, or Plugins;
- no arbitrary runtime/source/package selection from the UI;
- no EchoFlow plugin marketplace;
- no claim that local third-party DSH plugins are sandboxed;
- no managed Node downloader until the system-Node usability ceiling is accepted as a product issue.
