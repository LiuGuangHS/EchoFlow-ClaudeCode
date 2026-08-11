# Repository Agent Contract

This file is the complete and authoritative operating contract for AI coding agents and human contributors working in this repository. Root `CLAUDE.md` is a short, session-loaded summary and must point here instead of duplicating detailed rules. If the two files diverge, this file wins.

Treat this contract as executable guidance: inspect the real code, make narrow changes, verify the affected behavior, and leave a handoff that another maintainer can trust.

## Language Policy
- Repository-level agent instructions and operational rules are written in English.
- Respond to the user in Chinese by default.
- Keep commands, paths, identifiers, code symbols, and raw errors unchanged.

## Agent Operating Rules
- Work autonomously on clear, reversible tasks. Do not stop to ask whether to proceed with obvious next steps; ask only for destructive actions, missing authority, or genuinely branching product decisions.
- Start every task by identifying the changed surface: `desktop`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
- Check `git status --short` before editing. The worktree may already contain user changes; never revert, overwrite, restage, or reformat unrelated files.
- Keep diffs small and owned. Stage or commit only files you intentionally changed for the current task.
- Prefer existing utilities, stores, services, command patterns, and test harnesses over new abstractions. Do not add dependencies unless the task explicitly requires them.
- For cleanup/refactor/deslop work, write the cleanup plan first, lock existing behavior with regression tests when it is not already protected, then make one smell-focused pass at a time.
- Do not commit generated artifacts: `artifacts/quality-runs/`, `artifacts/coverage/`, `.omx/`, `node_modules/`, `desktop/node_modules/`, `adapters/node_modules/`, `desktop/src-tauri/target/`, or local build outputs.

## ECC-First Development
ECC is the default toolset. Prefer `/ecc:plan`, `@code-reviewer`, `@architect`, `/ecc:code-review`, `/ecc:quality-gate`, and `/ecc:build-fix` over recreating their planning, review, validation, or repair workflows. ECC must enforce the fork policy below; upstream work follows the full safe-sync workflow.

The repository contract is tool-independent: run `bun run check:impact` for scoped checks and `bun run verify` for PR-level validation. Run `bun run audit:harness` when changing agent guidance, quality policy, CI, or ECC integration. The audit reads only fixed repository contract paths; `.claude/` remains local-only and must never be a CI dependency or a committed source of truth.

## Fork Identity & Provider Policy
- Public/release brand: `EchoFlow Code`; executable/docs: `echoflow-code`.
- When touching fork-owned identifiers, convert `cc-haha` → `echoflow`, `Claude-Code-Haha` → `EchoFlow-Code`, and `CC_HAHA_*` → `ECHOFLOW_*`. Retain historical names only for explicit compatibility, attribution, migration fixtures, or supported variables.
- Retain upstream `Claude Code`, `Claude CLI`, `claude-code-*`, and `CLAUDE_CODE_*` terminology for upstream/runtime compatibility.
- Fork calls to action and service links use EchoFlow surfaces, including `https://code.echoflow.cn/` and `https://api.echoflow.cn/`.
- `src/server/config/providerPresets.json` contains only official vendor APIs, official local integrations, EchoFlow/Qingyun API, and custom. Do not automatically add third-party relay, sponsor/referral gateway, or promotional provider presets; reject (`jiekouai`, `shengsuanyun`, `teamorouter`) and referral URLs. Official vendor APIs and official OAuth integrations, including Grok Official, may be synchronized from upstream; private gateways use custom.

## Safe Upstream Sync Workflow
These are repository policies, not guarantees enforced by Git. Use them for every upstream merge.

1. Start from a clean `main` worktree and inspect the configured remotes.
2. Fetch `origin` normally. Fetch upstream branches without tags using `git fetch upstream +refs/heads/*:refs/remotes/upstream/* --prune`; upstream release tags can share names with fork release tags.
3. Compare `main...origin/main` and `main...upstream/main` before merging.
4. Merge upstream with a merge commit; do not rebase public `main`.
5. Run `/ecc:plan "合并上游，保留修复，替换品牌名"`, use `@code-reviewer` on conflicted and high-risk files, and use `@architect` for provider-policy decisions.
6. Resolve file contents intentionally; never apply blanket `--ours` or `--theirs`. Preserve the fork identity and provider policy, sponsor-free public docs, persistence compatibility, Electron release flow, and quality gates.
7. Conflict analysis and worktree edits may be automated, but `git add` and `git commit` require explicit developer confirmation. Never stage or commit a conflict resolution automatically.
8. After writing conflict resolutions, run `/ecc:code-review` and `/ecc:quality-gate` before asking the developer to stage or commit. If a build or type check fails, use `/ecc:build-fix`, rerun the narrow failed check, and run `bun run verify` before claiming the merge push-ready.
9. Push `main` before or together with release tags, then verify the remote branch and tag targets.

## Engineering Behavior Guardrails
These rules are adapted from Karpathy-style coding-agent guidelines. They bias toward caution and simplicity, but do not override the autonomy rule for clear, reversible work.

- Define the smallest behavior change and proof before editing. Keep changes surgical, use existing utilities, avoid dependencies and speculative abstractions, and remove only obsolescence created by the change.
- Every changed line must trace to the request, a failing test, a verified bug, or a compatibility constraint. Stop and simplify if the diff grows beyond that proof.
- Production code changes under `desktop/src`, `src/server`, `src/tools`, `src/utils`, or `adapters` require a same-area regression test unless explicitly approved otherwise.
- Keep TypeScript ESM style: 2-space indentation, no semicolons, `PascalCase` components, and `camelCase` functions/hooks/stores.
- Do not commit generated output such as `artifacts/`, coverage reports, `node_modules/`, build directories, or Rust `target/` trees. Use Conventional Commit subjects and normal product branch prefixes when publishing.

## Writing a Test That Holds


- **Drive the transition; never hand-write the state it produces.** Component tests in
  `desktop/src` call `setState` 744 times and a real store action 3 times. State you
  assigned is self-consistent by construction and cannot expose "transition A did not
  update B" — which is where these bugs live. Use `handleServerMessage`, store actions,
  and real user events.
- **Assert the invariant, not today's output.** `2262973a4` shipped
  `expect(getByText('deepseek-reasoner'))` at a moment when the screen showed another
  model's number: it wrote the bug in as a passing assertion, and the next fix had to
  invert that exact line. Ask what must be true after this step, not what it prints now.
- **Cover both directions of any rule that drops or merges something.** The replay guard
  was tested for "a replay must be discarded" and never for "a genuine repeat must be
  kept", so it shipped dropping real replies.
- **Test the join, not each end.** Server, store, and component each had a test for
  `runtime_config_applied`; nothing crossed them, and deleting the term that joins them
  (`ChatInput.tsx` `refreshNonce`) left 314 tests green.
- **Never retune an existing test's inputs to keep it green.** `128f75ab5` changed five
  tests' props (`messageCount={0}` → `{1}`) instead of accepting that they described
  states a real session cannot reach. If a test only passes after you edit its inputs,
  the test was describing the implementation.
- **Do not mock the module under test.** A hand-written factory freezes an interface
  snapshot: the store can be renamed or gutted and the test still passes.
- **If you are comparing content to decide identity, the identity exists upstream.**
  Deduping by text cannot separate a replay from a legitimate repeat; forward the id
  (`uuid`, `toolUseId`) instead of guessing.

Blind spots to check rather than trust:

- `desktop/electron/` is not instrumented at all (`vitest.config.ts` collects only
  `desktop/src`), so main-process diffs score zero covered lines.
- Bun's LCOV emits no branch records, so `src/` and `adapters/` report **100% branch
  coverage** for data that was never collected (`pct(0, 0) === 100`). Only `desktop/`
  has real branch numbers.

## Verification

1. Run the narrowest relevant test while iterating.
2. Run `bun run check:impact`; every command it selects is part of the minimum handoff for the current diff. Selection is import-aware: a change is routed to every surface that imports it, not only to its own directory. The report's `## Cross-surface impact` section names the importer that pulled in each extra check.
3. Run `bun run verify` only when full validation is requested or before claiming a code change is PR-ready or push-ready.

## Project Structure & Module Organization
This is a Bun-based Coding Agent product with a CLI, local server, desktop app, IM adapters, docs, and release automation.

- `bin/echoflow-code` is the executable entrypoint; `bun run start` and `./bin/echoflow-code` run the CLI locally.
- `src/` contains the CLI/runtime surface: `entrypoints/` for startup paths, `screens/` and `components/` for the Ink TUI, `commands/` for slash commands, `services/` for API/MCP/OAuth logic, `tools/` for agent tools, `utils/` for shared runtime helpers, and `server/` for the local API/WebSocket service.
- `desktop/` contains the desktop product: React UI in `desktop/src/`, API clients in `desktop/src/api/`, shared UI in `desktop/src/components/`, Electron host code in `desktop/electron/`, legacy/shared assets in `desktop/src-tauri/`, and desktop build scripts in `desktop/scripts/`.
- Desktop is Electron-first. `desktop/src-tauri/` is retained for icons, sidecar binaries, preview-agent resources, and compatibility assets. Do not treat `desktop/src-tauri/tauri.conf.json` as the release source of truth unless a task explicitly revives Tauri packaging.
- `adapters/` contains IM adapter sidecars for Telegram, Feishu, WeChat, DingTalk, and shared adapter utilities.
- `site/` is the React documentation site and its build tooling. `docs/` and `docs/en/` are its Chinese and English Markdown content sources; keep counterparts aligned when both exist. Root screenshots and `docs/images/` are reference assets unless a task explicitly updates docs media.
- `.github/workflows/`, `scripts/pr/`, and `scripts/quality-gate/` define CI routing and quality policy.
- `release-notes/`, `scripts/release.ts`, and `.github/workflows/release-desktop.yml` define release behavior. Treat workflow changes as product changes because they alter what future agents and contributors can safely ship.
- Required PR checks must be deterministic and work on an untrusted fork: no real models, public network, repository secrets, saved providers, or real user home/config. Use fake credentials, fixtures, mocked/loopback transports, temporary directories, and explicit cleanup.
- `bun run check:agent-flow` is the deterministic end-to-end agent lane: it drives the real server and WebSocket through session creation, runtime selection, streaming, tool permission allow/deny, tool failure, API error, interrupt, reconnect replay, and session recovery using the repository's mock SDK CLI. It needs no provider, credentials, or network, so every contributor can run it.
- `bun run check:desktop-ui-smoke` drives the real desktop UI against that same mock runtime and answers the permission dialog by clicking the real button. It skips with a printed reason when `agent-browser` or desktop dependencies are missing.
- `agent-browser` is an implementation detail of that committed lane (which runs headless on Linux CI) and of the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts. It is not the tool for ad-hoc browser work: manual verification, screenshots, and exploratory UI checks go through the `ego-browser` skill instead.
- Quality-gate lanes that boot the real server must run in a sandbox config dir (`scripts/quality-gate/sandbox.ts`) and fail if they wrote to the developer's real `~/.claude`.
- Provider/auth/proxy/runtime changes may select `bun run check:provider-contract`; desktop chat/WebSocket/session changes may select `bun run check:chat-contract`. These contracts are offline and do not replace their selected surface checks.
- Any persisted JSON, `localStorage`, or app-config shape change requires a forward migration, an old-fixture regression test, and `bun run check:persistence-upgrade`.
- User-visible desktop or cross-process behavior needs an actual browser/desktop smoke path when unit tests cannot prove the workflow.
- Live model checks are separate maintainer evidence. Run them only after deterministic checks pass and a maintainer explicitly authorizes quota use; finding credentials on the machine is not authorization.
- `bun run check:docs` runs `npm ci`; run it sequentially with checks that rely on root `node_modules`.

## Build, Test, and Development Commands
Install root dependencies with `bun install`. Install desktop dependencies in `desktop/` when touching desktop UI/native code, and adapter dependencies in `adapters/` when touching IM adapters.

- `./bin/echoflow-code` or `bun run start`: run the CLI locally.
- `SERVER_PORT=3456 bun run src/server/index.ts`: start the local API/WebSocket server used by `desktop/`.
- `cd desktop && bun run dev`: run the desktop frontend in Vite.
- `cd desktop && bun run electron:dev`: build Electron main/preload bundles, start Vite, and launch the Electron shell for host-level desktop behavior.
- `cd desktop && bun run check:electron`: type-check Electron host code, run Electron host tests, and rebuild Electron bundles.
- `cd desktop && bun run build`: type-check and produce a production web build.
- `cd desktop && bun run test`: run desktop Vitest suites.
- `cd desktop && bun run lint`: run desktop TypeScript no-emit checks.
- `cd desktop && bun run build:windows-x64`: package the Windows x64 Electron app from PowerShell; requires Bun/Bunx and Visual Studio 2022 Build Tools with the Desktop development with C++ workload.
- `cd adapters && bun run test`: run all adapter tests; use `test:telegram`, `test:feishu`, `test:wechat`, or `test:dingtalk` for focused adapter work.
- `bun run docs:dev` / `bun run docs:build`: preview or build the React/Vite documentation site.
- `bun run check:impact`: print the changed-area impact report and recommended local checks.

## Verification Routing
Use the narrowest meaningful check while iterating; do not silently escalate a small fix to a full gate. Use focused tests first, then the affected gate:

| Surface | Gate |
| --- | --- |
| Desktop UI/store/API | `bun run check:desktop` |
| Server/API/provider/runtime/MCP/OAuth/WebSocket | `bun run check:server` |
| IM adapters | `bun run check:adapters` |
| Electron/native/packaging/version | `bun run check:native` |
| Docs/README/release notes/workflows | `bun run check:docs` |
| JSON/localStorage/app-config migration | `bun run check:persistence-upgrade` |
| PR/push/merge/release readiness | `bun run verify` |

`bun run check:impact` selects all affected surfaces and is part of the normal handoff. Use `bun run check:coverage` or `bun run verify` for PR-level proof; use `quality:providers` and live `quality:gate` only with explicit maintainer authorization. If `verify` fails, inspect its latest Result Matrix and lane log, fix the concrete lane, rerun the narrow check, then rerun `verify`.

## Feature Quality Contract
Every feature, bugfix, and behavior change must ship with proof that matches the changed surface. Treat this as the implementation contract for both human authors and AI coding agents.

- Start by naming the behavior surface: `desktop`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
- Production code changes under `desktop/src`, `src/server`, `src/tools`, `src/utils`, or `adapters` must include a same-area test file in the same PR unless a maintainer explicitly approves `allow-missing-tests`.
- Pure logic requires unit tests. Server/API/provider/runtime changes require server or request-shape tests. Desktop UI/store/API changes require Vitest or Testing Library coverage. User-facing desktop flows require browser/agent-browser smoke when the flow cannot be trusted through unit tests alone.
- Agent loop, tool execution, provider routing, model selection, file editing, permissions, session resume, and desktop chat changes require mock/fixture tests in PR plus live smoke or baseline evidence from a maintainer machine when provider access exists.
- Coverage is part of PR readiness, not an afterthought. Generated/build output is excluded, maintained product areas should move toward 75-80%+, and every changed executable production line must meet the changed-line coverage gate in `scripts/quality-gate/coverage-thresholds.json` before push/PR readiness. For local non-PR handoff, focused regression tests are acceptable; record that coverage was not run instead of running it by default.
- Do not lower `scripts/quality-gate/coverage-baseline.json` or `coverage-thresholds.json` unless the PR carries maintainer approval via `allow-coverage-baseline-change` and explains why. Legacy areas below target are debt; new work must leave the touched area higher than it found it.
- E2E is required when the feature crosses process boundaries, browser UI, WebSocket/session state, provider proxying, native sidecars, or release packaging. Use the narrowest meaningful E2E lane first, then `quality:baseline` or `quality:release` for core Coding Agent paths.
- A PR is not ready until the author records changed files, tests added, coverage report path, E2E/live evidence or explicit blocker, and remaining risk. AI agents must include this evidence before saying "PR-ready", "push-ready", "mergeable", or "release-ready". For ordinary local handoff, include changed files, targeted tests/checks run, tests not run, and remaining risk without escalating to PR-level gates.

## Persistent Storage Compatibility
- Any change to local JSON, `localStorage`, or app config persistence formats must ship with a forward migration, an old-fixture regression test, and a persistence upgrade gate.
- Run `bun run check:persistence-upgrade` for storage-shape changes. The change is blocked until migration tests, old fixtures, backup behavior, and unknown-field preservation pass.
- `~/.claude/settings.json` is user-owned shared state: preserve unknown fields on read/write, merge additively, and never write a repo-owned global `schemaVersion` into it.
- Desktop Doctor and any automatic repair path must be deny-by-default. One-click repair may only mutate allowlisted, regenerable desktop UI state such as `echoflow-code-*` `localStorage` keys or native window state.
- `echoflow-code-*` `localStorage` keys and the `echoflow-code` internal directory are active persistence contracts. The resolved config root comes from `CLAUDE_CONFIG_DIR` or the platform data directory; `~/.claude/echoflow-code/**` remains a supported legacy migration source. Do not rename any of these surfaces without a migration task, forward/backward compatibility tests, and explicit user-data preservation.
- When merging upstream, preserve EchoFlow migration sources by default unless the user explicitly says the migration window is closed.
- Windows AppUserModelID must stay equal to `desktop/package.json` `build.appId`; it controls toast attribution and taskbar identity. Branding changes must update Electron identity tests.
- Doctor and repair flows must never mutate chat transcripts, model/provider config, Skills, MCP config, plugin state, IM bindings, adapter sessions, OAuth tokens, or team/session records unless a future task explicitly adds a reviewed, backup-first manual repair flow.
- Protected files include `~/.claude/projects/**/*.jsonl`, `~/.claude/settings.json`, project `.claude/settings.json`, providers/settings/OAuth files under the resolved EchoFlow config root or legacy `~/.claude/echoflow-code/`, `~/.claude/adapters.json`, `~/.claude/adapter-sessions.json`, `~/.claude/skills`, project `.claude/skills`, `.mcp.json`, managed MCP config, `~/.claude/plugins/**`, and `~/.claude/teams/**`. Diagnose these paths only with redaction by default.
- If a persistence shape cannot be upgraded in place, the implementation is blocked until the upgrade path is explicit and tested.

## Desktop & UX Expectations
- Match the existing desktop design system and component patterns before adding new UI primitives.
- Use `lucide-react` icons for common actions when an icon exists. Use familiar controls: icon buttons for tool actions, toggles/checkboxes for binary settings, tabs for views, menus for option sets, and sliders/inputs for numeric values.
- Keep operational desktop UI dense, readable, and work-focused. Avoid marketing-style hero layouts, decorative cards, gradient-orb backgrounds, and oversized type inside app panels.
- Text must fit in its container on mobile and desktop viewports. Stable controls such as tab bars, toolbars, status chips, and buttons should not resize or shift when labels, hover states, or loading text change.
- For visible UI changes, validate with an actual browser/desktop smoke path when feasible and include screenshots or a short visual-evidence note in the handoff.

## Release Workflow
- Desktop releases use plain `vX.Y.Z` tags matching `desktop/package.json`; `release-notes/vX.Y.Z.md`, `scripts/release.ts`, and `.github/workflows/release-desktop.yml` must agree. Tauri config is legacy.
- Before release: on `main`, create notes, run `bun run scripts/release.ts X.Y.Z --dry`, then `bun run check:policy`, affected desktop/native gates, and `bun run verify`.
- The normal release command is `bun run scripts/release.ts X.Y.Z`; it creates the release commit and annotated tag. Do not move tags manually or upload local artifacts.
- Push `git push origin main --tags`, wait for the release workflow, and verify the public release assets before announcing it. Report missing macOS signing/notarization secrets and unsigned Windows artifacts.

## Docs Workflow Notes
- The docs workflow `.github/workflows/deploy-docs.yml` installs from `site/package-lock.json` with `npm --prefix site ci`, builds the React site with `npm --prefix site run build`, and uploads `site/dist`. Keep `site/package.json` and `site/package-lock.json` aligned.
- The docs workflow currently runs on Node 22. Avoid reintroducing older Node assumptions without checking dependency engine requirements.
- `bun run check:docs` operates on the isolated `site/` dependency tree. It may run alongside root Bun checks when machine resources allow, but avoid overlapping dependency installation commands within `site/`.

## Coding Style & Naming Conventions
- Use TypeScript with 2-space indentation, ESM imports, and no semicolons.
- Prefer `PascalCase` for React components, `camelCase` for functions/hooks/stores, and descriptive file names such as `teamWatcher.ts` or `AgentTranscript.tsx`.
- Keep shared desktop UI in `desktop/src/components/`, desktop API clients in `desktop/src/api/`, server behavior under `src/server/`, and agent/runtime utilities under `src/tools/` or `src/utils/` according to existing boundaries.
- For structured data, use structured parsers or existing helpers instead of ad hoc string manipulation.
- Add succinct comments only where they clarify non-obvious control flow or external constraints.

## Commit & Pull Request Guidelines
- Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, and `docs:`. Keep the subject imperative and scoped to one change.
- Branch names should use normal product prefixes such as `fix/xxx`, `feat/xxx`, or `docs/xxx`; do not create `codex/`-prefixed branches in this repository.
- When creating commits, use a Conventional Commit subject plus a useful body when the decision needs context. Prefer git-native trailers for durable decision notes:
  - `Constraint:` for external constraints.
  - `Rejected:` for alternatives considered and why they were not used.
  - `Confidence:` as `low`, `medium`, or `high`.
  - `Scope-risk:` as `narrow`, `moderate`, or `broad`.
  - `Directive:` for forward-looking warnings.
  - `Tested:` and `Not-tested:` for verification evidence and gaps.
- PRs should explain user-visible impact, link related issues, list verification steps, include screenshots for desktop/docs UI changes, and call out follow-up work or known gaps.
- A PR description must include changed files, tests added or updated, coverage report path, E2E/live evidence or blocker, pass/fail/skip counts from the quality report when available, and remaining risk/rollback notes. A normal local agent handoff may be lighter: summarize changed files, focused tests/checks run, skipped full gates, and remaining risk/rollback notes.

## Deeper Guides
- Contributor workflow and quality lanes: `CONTRIBUTING.md` and `docs/internals/contributing.md`
- Package scripts and path routing: `package.json` and `scripts/pr/change-policy.ts`
- PR evidence contract: `.github/pull_request_template.md`
- Desktop release and auto-update runbook: `docs/desktop/10-release-auto-update.md`
