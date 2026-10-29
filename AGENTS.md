# Repository Agent Contract

This file is the authoritative operating contract for AI coding agents and human contributors in this repository. Any shorter summary of it defers here where the two diverge.

Treat it as executable guidance: inspect the real code, make narrow changes, verify the affected behavior, and leave a handoff another maintainer can trust.

## How This Contract Is Maintained

This file states **direction**. Procedures, examples, and case law live in `docs/`; this section is what keeps that split from drifting.

A rule belongs here only when all three hold:

1. It changes a direction decision, not just the mechanics of a task.
2. Violating it causes irreversible loss: fork identity, user data, release integrity, or a CI contract.
3. It cannot be read out of the code or `scripts/pr/change-policy.ts`.

Otherwise it belongs in `docs/` with a one-line pointer. Move the content — do not leave a shortened copy behind. A stale summary is worse than no summary, because it still reads as authoritative.

Update this file in the **same change** that makes one of its statements untrue:

- A top-level directory, quality gate, or package script is added, removed, or renamed.
- A `ChangeArea` is added or changed in `scripts/pr/change-policy.ts` or `scripts/pr/area-routing.json`.
- A release, or migration workflow changes.
- A file referenced from here is moved or renamed.

Keep this file under 24 KiB. Crossing that is the signal to move content out, not to trim prose. The hard limit is 28 KiB and is enforced by `scripts/pr/quality-contract.test.ts`.

## Language Policy
- Repository-level agent instructions and operational rules are written in English.
- Respond to the user in Chinese by default.
- Keep commands, paths, identifiers, code symbols, and raw errors unchanged.
- Nested guidance next to affected code follows this policy, with one documented exception: `desktop/src/components/AGENTS.md` is the authoritative component index and is maintained in Chinese. Read it as guidance, not as documentation, and do not restate its component list elsewhere.

## Agent Operating Rules
- Work autonomously on clear, reversible tasks. Do not stop to ask whether to proceed with obvious next steps; ask only for destructive actions, missing authority, or genuinely branching product decisions.
- Prefer the installed agent toolset over recreating planning, review, debugging, or design workflows. Superpowers ships **skills, not slash commands** — invoke them with the Skill tool by their real names: `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` for design and planning, `code-review:code-review` for review, `ponytail:ponytail-review` for minimal-code discipline, `frontend-design` for desktop/web UI. Verify a tool exists before you name it in a handoff; a tool that cannot be invoked is not evidence. No plugin replaces the gates in this file, and the contract stays tool-independent; details in `docs/internals/contributing.md`.
- Identify the changed surface first. The canonical vocabulary is the `ChangeArea` union in `scripts/pr/change-policy.ts`: `desktop`, `server`, `adapters`, `docs`, `release`, `mobile`, `cli-core`. The prose surfaces in this file map onto it: `native/` routes to `desktop`, `site/` to `docs`, and `.github/workflows/**` selects the policy lane. Path-to-area routing lives in `scripts/pr/area-routing.json`; `pr-triage.yml` reads that file from the base revision, never from PR head. Do not invent a surface name that has no area and no check behind it.
- `cli-core` covers `bin/` and the root `src/` runtime paths. Changes there are blocked until the PR carries the `allow-cli-core-change` label and a maintainer approves.
- Treat root `src/` as the upstream-derived native Claude Code runtime: prefer not to modify it directly. Enhance behavior through configuration, dependency upgrades, and adapters/services in EchoFlow-owned surfaces (such as `desktop/`, `src/server/`, or existing orchestration boundaries) where practical. When a change to native `src/` is unavoidable, keep it minimal, isolated, covered by focused regression tests, and document the compatibility reason; the `cli-core` approval requirement still applies.
- Check `git status --short` before editing. The worktree may already contain user changes; never revert, overwrite, restage, or reformat unrelated files.
- Keep diffs small and owned. Stage or commit only files you intentionally changed for the current task.
- Prefer existing utilities, stores, services, command patterns, and test harnesses over new abstractions. Do not add dependencies unless the task explicitly requires them.
- For cleanup/refactor/deslop work, write the cleanup plan first, lock existing behavior with regression tests when it is not already protected, then make one smell-focused pass at a time.
- Never commit generated output: `artifacts/`, coverage reports, `node_modules/`, build directories, or Rust `target/` trees.
- `.claude/` stays local-only. It must never be a CI dependency or a committed source of truth. Run `bun run audit:harness` when changing agent guidance, quality policy, CI, or the agent toolset.

## Identity & Provider Policy
- Public/release brand: `EchoFlow Code`; executable/docs: `echoflow-code`.
- When touching inherited identifiers, convert `cc-haha` → `echoflow`, `Claude-Code-Haha` → `EchoFlow-Code`, and `CC_HAHA_*` → `ECHOFLOW_*`. Retain historical names only for explicit compatibility, attribution, migration fixtures, or supported variables.
- Retain `Claude Code`, `Claude CLI`, `claude-code-*`, and `CLAUDE_CODE_*` terminology: those name the Claude Code runtime and its env contracts, and renaming them breaks the integration.
- Calls to action and service links use EchoFlow surfaces, including `https://code.echoflow.cn/` and `https://api.echoflowai.cc/`.
- `src/server/config/providerPresets.json` carries only official vendor APIs, official local integrations, official subscription/API integrations such as OpenCode Go, EchoFlow API, and custom. Judge a candidate preset by rule, not by an id list: reject anything a vendor marks deprecated, any URL carrying promotion or tracking parameters (`utm_`, `invite`, `referral`, `?code=`), third-party relay or sponsor/referral gateways, and promotional copy. Currently rejected: `jiekouai`, `shengsuanyun`, `teamorouter`, `xuanshuapi`, `fennoai`, `qiniuai`, `atlascloud`, `apismart`.
- Official vendor APIs and official OAuth integrations, including Grok Official, may be adopted from the vendor's own documentation; private gateways use custom. A new provider or preset is rejected by default until it passes the rule above.

## Engineering Behavior Guardrails
- Define the smallest behavior change and proof before editing. Keep changes surgical, use existing utilities, avoid dependencies and speculative abstractions, and remove only obsolescence created by the change. `ponytail` enforces this ladder; run `/ponytail-review` when a diff outgrows its proof.
- Every changed line must trace to the request, a failing test, a verified bug, or a compatibility constraint. Stop and simplify if the diff grows beyond that proof.
- Never apply blanket `--ours` or `--theirs`. Resolve per hunk: a conflict is two decisions at once, and picking a side wholesale keeps the wrong half of one of them.
- Run the narrowest relevant test while iterating. Run `bun run verify` only when full validation is requested or before claiming a change is PR-ready or push-ready.
- Coding style: TypeScript with 2-space indentation, ESM imports, no semicolons; `PascalCase` components and descriptive file names such as `teamWatcher.ts` or `AgentTranscript.tsx`; `camelCase` functions, hooks, and stores.
- For structured data, use structured parsers or existing helpers instead of ad hoc string manipulation. Add succinct comments only where they clarify non-obvious control flow or external constraints.

## Verification Routing
Use the narrowest meaningful check while iterating; do not silently escalate a small fix to a full gate.

| Surface | Gate |
| --- | --- |
| Desktop UI/store/API | `bun run check:desktop` |
| Server/API/provider/runtime/MCP/OAuth/WebSocket | `bun run check:server` |
| IM adapters | `bun run check:adapters` |
| Kotlin Android shell (mobile) | `bun run check:mobile` |
| Electron/native/packaging/version | `bun run check:native` |
| Docs/README/release notes/workflows | `bun run check:docs` |
| JSON/localStorage/app-config migration | `bun run check:persistence-upgrade` |
| PR/push/merge/release readiness | `bun run verify` |

- `bun run check:impact` prints the changed-area impact report and is part of the minimum handoff for the current diff. Selection is import-aware: a change is routed to every surface that imports it, not only to its own directory. The report's `## Cross-surface impact` section names the importer that pulled in each extra check.
- Provider/auth/proxy/runtime changes may additionally select `bun run check:provider-contract`; desktop chat/WebSocket/session changes may additionally select `bun run check:chat-contract`. These contracts are offline and do not replace their selected surface checks.
- `bun run check:agent-flow` is the deterministic end-to-end agent lane: real server and WebSocket through session creation, runtime selection, streaming, tool permission allow/deny, tool failure, API error, interrupt, reconnect replay, and session recovery, using the repository's mock SDK CLI. It needs no provider, credentials, or network, so every contributor can run it.
- `bun run check:desktop-ui-smoke` drives the real desktop UI against that same mock runtime and answers the permission dialog by clicking the real button. It skips with a printed reason when `agent-browser` or desktop dependencies are missing.
- `agent-browser` is an implementation detail of that committed lane and of the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts. It is not the tool for ad-hoc browser work: for manual verification, screenshots, and exploratory UI checks use the installed `playwright` plugin or the `browser` tools, and record which path you used in the handoff.
- `bun run check:docs` runs `npm ci`; run it sequentially with checks that rely on root `node_modules`.
- If `bun run verify` fails, inspect its latest Result Matrix and lane log, fix the concrete lane, rerun the narrow check, then rerun `verify`. `bun run check:coverage` gives PR-level coverage proof; `quality:providers` and live `quality:gate` require explicit maintainer authorization.

## Project Structure & Module Organization

Bun-based Coding Agent product with a CLI, local server, desktop app, IM adapters, docs, and release automation. `docs/internals/structure.md` carries the full directory map; this section keeps only what changes how you work.

- `bin/echoflow-code` is the executable entrypoint. `src/` is the CLI/runtime surface (`entrypoints/`, the Ink TUI in `screens/` and `components/`, `commands/`, `services/`, `tools/`, `utils/`, `server/`).
- `desktop/` is the desktop product: React UI in `desktop/src/`, Electron host code in `desktop/electron/`, build scripts in `desktop/scripts/`.
- Desktop is Electron-first. `desktop/src-tauri/` is retained for icons, sidecar binaries, preview-agent resources, and compatibility assets. Do not treat `desktop/src-tauri/tauri.conf.json` as the release source of truth unless a task explicitly revives Tauri packaging.
- `adapters/` holds IM adapter sidecars for Telegram, Feishu, WeChat, and DingTalk. `site/` is the React documentation site; `docs/` and `docs/en/` are its Chinese and English Markdown sources.
- `mobile/` is the separate native Kotlin Android shell. Rules in `mobile/AGENTS.md`.
- `native/` holds the Computer Use native helper (`native/cu-helper`, Swift). Its gates are `bun run check:swift`, `check:computer-use-live-smoke`, and `check:computer-use-signed-chain`.
- `.github/workflows/`, `scripts/pr/`, and `scripts/quality-gate/` define CI routing and quality policy. `scripts/harness-audit.js` audits this contract itself.
- `release-notes/`, `scripts/release.ts`, and `.github/workflows/release-desktop.yml` define release behavior. Treat workflow changes as product changes because they alter what future agents and contributors can safely ship.
- Required PR checks must be deterministic and work on an untrusted fork: no real models, public network, repository secrets, saved providers, or real user home/config. Server-booting lanes run in a sandbox config dir (`scripts/quality-gate/sandbox.ts`) and fail if they wrote to the developer's real `~/.claude`. Live model checks are separate maintainer evidence that require explicit authorization. `docs/internals/contributing.md` carries the full gate layering and the per-lane constraints.

## Build, Test, and Development Commands
Install root dependencies with `bun install`, plus `desktop/` or `adapters/` dependencies when you touch those surfaces. The command list and development loop live in `docs/internals/contributing.md`.

## Test Design Direction
Case law, the concrete regression examples, and the coverage caveats live in `docs/internals/contributing.md`. These are the parts that change how you write a test:

- Drive the transition; never hand-write the state it produces. Use real store actions and user events instead of `setState`.
- Assert the invariant, not today's output. Ask what must be true after this step, not what it prints now.
- Cover both directions of any rule that drops or merges something.
- Test the join, not each end. Separate tests per layer do not prove the message actually drives the UI.
- Never retune an existing test's inputs or invert an expectation to keep it green, and never mock the module under test.
- If you are comparing content to decide identity, the identity exists upstream — forward the id (`uuid`, `toolUseId`) instead of guessing.
- Blind spots to check rather than trust: `desktop/electron/` is not instrumented at all (`desktop/vitest.config.ts` collects only `desktop/src`), and Bun's LCOV emits no branch records, so `src/` and `adapters/` report 100% branch coverage for data that was never collected.

## Feature Quality Contract
Every feature, bugfix, and behavior change ships with proof matching the changed surface. `docs/internals/contributing.md` carries the full contract, coverage policy, and lane-by-lane detail; `scripts/pr/change-policy.ts` is the machine-readable source of truth for which paths require same-area tests.

- Name the changed behavior surface first.
- Production code changes under `desktop/src`, `src/server`, `src/tools`, `src/utils`, or `adapters` must include a same-area test file in the same PR unless a maintainer explicitly approves `allow-missing-tests`.
- Pure logic requires unit tests. Server/API/provider/runtime changes require server or request-shape tests. Desktop UI/store/API changes require Vitest or Testing Library coverage. Agent loop, tool execution, provider routing, model selection, file editing, permissions, session resume, and desktop chat changes require mock/fixture tests in PR plus live smoke or baseline evidence from a maintainer machine when provider access exists.
- E2E is required when a feature crosses process boundaries, browser UI, WebSocket/session state, provider proxying, native sidecars, or release packaging. Use the narrowest meaningful lane first, then `quality:baseline` or `quality:release` for core Coding Agent paths.
- Coverage is part of PR readiness, not an afterthought. Every changed executable production line must meet the changed-line gate in `scripts/quality-gate/coverage-thresholds.json` before push/PR readiness. Do not lower `coverage-baseline.json` or `coverage-thresholds.json` without maintainer approval via `allow-coverage-baseline-change`. Legacy areas below target are debt; new work must leave the touched area higher than it found it.
- Do not claim "PR-ready", "push-ready", "mergeable", or "release-ready" until you record changed files, tests added, coverage report path, E2E/live evidence or explicit blocker, and remaining risk. For ordinary local handoff, record changed files, focused checks run, checks not run, and remaining risk without escalating to PR-level gates.

## Persistent Storage Compatibility
- Any change to local JSON, `localStorage`, or app config persistence formats must ship with a forward migration, an old-fixture regression test, and a persistence upgrade gate.
- Run `bun run check:persistence-upgrade` for storage-shape changes. The change is blocked until migration tests, old fixtures, backup behavior, and unknown-field preservation pass.
- `~/.claude/settings.json` is user-owned shared state: preserve unknown fields on read/write, merge additively, and never write a repo-owned global `schemaVersion` into it.
- Desktop Doctor and any automatic repair path must be deny-by-default. One-click repair may only mutate allowlisted, regenerable desktop UI state such as `echoflow-code-*` `localStorage` keys or native window state.
- `echoflow-code-*` `localStorage` keys and the `echoflow-code` internal directory are active persistence contracts. The resolved config root comes from `CLAUDE_CONFIG_DIR` or the platform data directory; `~/.claude/echoflow-code/**` remains a supported legacy migration source. Do not rename any of these surfaces without a migration task, forward/backward compatibility tests, and explicit user-data preservation.
- Preserve EchoFlow migration sources by default unless the user explicitly says the migration window is closed.
- Windows AppUserModelID must stay equal to `desktop/package.json` `build.appId`; it controls toast attribution and taskbar identity. Branding changes must update Electron identity tests.
- Doctor and repair flows must never mutate chat transcripts, model/provider config, Skills, MCP config, plugin state, IM bindings, adapter sessions, OAuth tokens, or team/session records unless a future task explicitly adds a reviewed, backup-first manual repair flow.
- Protected files include `~/.claude/projects/**/*.jsonl`, `~/.claude/settings.json`, project `.claude/settings.json`, providers/settings/OAuth files under the resolved EchoFlow config root or legacy `~/.claude/echoflow-code/`, `~/.claude/adapters.json`, `~/.claude/adapter-sessions.json`, `~/.claude/skills`, project `.claude/skills`, `.mcp.json`, managed MCP config, `~/.claude/plugins/**`, and `~/.claude/teams/**`. Diagnose these paths only with redaction by default.
- If a persistence shape cannot be upgraded in place, the implementation is blocked until the upgrade path is explicit and tested.

## Desktop & UX Expectations
- Match the existing desktop design system and component patterns before adding new UI primitives.
- Use `lucide-react` icons for common actions when an icon exists. Use familiar controls: icon buttons for tool actions, toggles/checkboxes for binary settings, tabs for views, menus for option sets, and sliders/inputs for numeric values.
- Keep operational desktop UI dense, readable, and work-focused. Avoid marketing-style hero layouts, decorative cards, gradient-orb backgrounds, and oversized type inside app panels.
- Text must fit in its container on mobile and desktop viewports. Stable controls such as tab bars, toolbars, status chips, and buttons should not resize or shift when labels, hover states, or loading text change.
- For visible UI changes, validate with an actual browser/desktop smoke path when feasible and include screenshots or a short visual-evidence note in the handoff. When the committed smoke lane is unavailable, say which browser path you actually used, or state that no visual evidence was produced — do not claim a smoke path that was skipped. User-visible desktop or cross-process behavior needs a real smoke path when unit tests cannot prove the workflow.

## Release Workflow
- Desktop releases use plain `vX.Y.Z` tags matching `desktop/package.json`; `release-notes/vX.Y.Z.md`, `scripts/release.ts`, and `.github/workflows/release-desktop.yml` must agree. Tauri config is legacy.
- `desktop/package.json` is the release-version source of truth. EchoFlow ships on its own version line, one small release at a time: increment the patch once per release, and never create a tag or release note to mirror another project's numbering.
- Before release: on `main`, create notes, then run `bun run scripts/release.ts X.Y.Z --dry` and `bun run check:release-surface`. The release workflow runs content gate and verification in CI; optionally trigger the `Quality Check` workflow first for a full pre-tag sweep.
- The normal release command is `bun run scripts/release.ts X.Y.Z`; it creates the release commit and annotated tag. Do not move tags manually or upload local artifacts.
- Push `git push origin main --tags`, wait for the release workflow, and verify the public release assets before announcing it. Report missing macOS signing/notarization secrets and unsigned Windows artifacts.
- A published release additionally mirrors the update channel files to `code.echoflow.cn/update/` and writes the download-page manifest at `/download/manifest.json`; GitHub Releases stays the full publish source, and the mirror step runs before the site upload so a failed sync fails the workflow.

## Independence & Reference Policy
EchoFlow Code is standalone software. There is no upstream project this repository tracks, merges with, or versions against, and the old sync workflow is retired.

- Never merge, cherry-pick, vendor, or copy code from another project into this tree. Other projects — including any former upstream — are reference and learning material only. Read them, take the idea, and reimplement it here with our own code, our own names, and our own tests.
- When a fix is inspired by elsewhere, the commit must stand on our own proof: a failing test we wrote, a verified bug we reproduced, or a compatibility constraint. "It came from that project" is not a provenance this repository accepts.
- Do not attribute EchoFlow's authorship, maintenance, contact, or product identity to another project or its author in README, docs, release notes, package metadata, diagnostics export, signing/privacy pages, updater links, or desktop About/profile defaults.
- Third-party copyright and permission notices stay with the code they cover. Move them to `THIRD_PARTY_LICENSES.md` when a file needs to carry its own license separately; never delete a notice a license requires us to keep. This is a legal floor, not a branding preference.
- `bun run check:release-surface` is the standing gate: it rejects foreign-authored release notes, version/brand drift, unresolved conflicts, and upstream identity markers on the public surfaces.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, `docs:`), imperative subjects scoped to one change, and normal product branch prefixes such as `fix/xxx`, `feat/xxx`, or `docs/xxx`. Do not create `codex/`-prefixed branches in this repository.
- When a decision needs context, record it in git-native trailers rather than prose: `Constraint:`, `Rejected:`, `Confidence:` (`low`/`medium`/`high`), `Scope-risk:` (`narrow`/`moderate`/`broad`), `Directive:`, and `Tested:` / `Not-tested:` for verification evidence and gaps.
- PRs explain user-visible impact, link related issues, list verification steps, include screenshots for desktop/docs UI changes, and call out follow-up work or known gaps.
- A PR description must include changed files, tests added or updated, coverage report path, E2E/live evidence or blocker, pass/fail/skip counts from the quality report when available, and remaining risk/rollback notes. A normal local agent handoff may be lighter: changed files, focused checks run, skipped full gates, and remaining risk/rollback notes.

## Deeper Guides
- Contributor workflow, coverage policy, and test-design case law: `CONTRIBUTING.md` and `docs/internals/contributing.md`
- Directory responsibilities: `docs/internals/structure.md`
- Package scripts and path routing: `package.json` and `scripts/pr/change-policy.ts`
- PR evidence contract: `.github/pull_request_template.md`
- Desktop release and auto-update runbook: `docs/_internal/release-windows.md` (English: `docs/en/_internal/release-windows.md`)
