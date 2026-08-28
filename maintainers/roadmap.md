# Repository Maintenance Index

Status snapshot: 2026-07-22. This is the repository-level task index: it records state, dependencies, evidence boundaries, and links to the domain source of truth. It does not replace a domain roadmap or a release runbook.

## Source-of-truth map

| Need | Canonical location | Notes |
| --- | --- | --- |
| Repository rules, ownership, verification routing | `AGENTS.md` | Root contract; nested `AGENTS.md` files add only subtree-specific rules. |
| Claude Code adapter guidance | `CLAUDE.md` | Concise adapter to the root contract, not a second roadmap. |
| Maintainer-document policy and index | `maintainers/AGENTS.md`, `maintainers/README.md` | Maintainer-only material is not public VitePress content. |
| Repository task state and dependencies | This file | Detailed domain work remains in the linked domain document. |
| Claude runtime architecture, checkpoints, and evidence | `maintainers/runtime/claude-runtime-roadmap.md` | `Next Agent Execution Contract` N0--N7 is the only execution order. M0--M6 is historical design context, not an alternative ordering. |
| Independent DeepSeek Harness lifecycle and follow-up tasks | `maintainers/deepseek-harness-roadmap.md` | DSH-0--DSH-8 is the ordered task register; plugin marketplace work is explicitly deferred. |
| Release procedure | `maintainers/release/desktop-release.md` | `desktop/package.json`, `scripts/release.ts`, `release-notes/`, and `.github/workflows/release-desktop.yml` are executable/product sources. |
| Agent/Skill policy | `maintainers/agents/governance.md` | Skills invoke stable procedures; they do not copy roadmaps. |
| Published setup and released behavior | `docs/` and `docs/en/` | Must not contain internal plans, runbooks, test counts, or unshipped contracts. |
| Version-specific user change record | `release-notes/` | Must match the eventual desktop package version and tag. |

### Configuration and Skill inventory

| Location | Classification | Status / handling |
| --- | --- | --- |
| Root and nested `AGENTS.md` | Canonical scoped instructions | Root is primary; apply the closest nested file only within its subtree. |
| `CLAUDE.md` | Tool adapter | Mirrors recurring root rules; do not place roadmap detail here. |
| `maintainers/**` | Maintainer source | The directory is currently untracked in this checkout; preserve existing files until their ownership is explicitly isolated. |
| `.claude/skills/release-preflight/SKILL.md` | Repository-local Skill candidate | Untracked; its scope is narrow, user-invoked, and delegates to `scripts/release-preflight.ts` plus the release runbook. It becomes canonical only after an intentional isolated commit. |
| `.claude/settings.json`, `.claude/settings.local.json` | User-local configuration | Ignored by `.gitignore`; do not edit, publish, or commit. The current contents include machine/worktree-specific permissions. |
| `.codex/`, `.agents/` | Empty tool-adapter directories | No first-party configuration file was found; they are not a source of truth. |
| `node_modules/**/.claude` and dependency `CLAUDE.md` files | Generated/vendor material | Excluded from repository governance. |
| `desktop/build-artifacts/**` | Generated build output | Never a roadmap, instruction, or release source of truth. |

## Confirmed task register

### GOV-0 — repository governance and task-index convergence

- **Class / source:** A — maintainer request dated 2026-07-22; `AGENTS.md`; `maintainers/AGENTS.md`.
- **Surface / state:** `maintainers`, `docs`, Agent configuration; **completed for the current index-delivery**. This index captures the audited state, while the existing dirty governance and public-document files cannot be safely rewritten or committed as one unit.
- **Goal and acceptance:** maintain one repository task index; keep complex domain plans separate; classify Agent configuration/Skills; distinguish implementation, mock, package, Host, visible-UI, and platform evidence; publish only released behavior under `docs/`.
- **Current implementation / missing work:** `maintainers/README.md`, runtime roadmap, release runbook, and governance document establish the intended split. `docs/desktop/07-*`, `08-*`, `09-*`, and substantial internal detail in `02-architecture.md` remain publicly linked; they need a separately owned documentation migration.
- **Dependencies / downstream / recommended stage:** no product-code dependency. Complete the documentation migration only after the pre-existing dirty docs and maintainer files can be attributed; it is a remaining **G0** item, before a public-docs release claim.
- **Files:** this index; later migration candidates are `docs/.vitepress/config.mts`, `docs/desktop/index.md`, `docs/desktop/02-architecture.md`, and the `07`--`09` migration documents.
- **Verification / evidence:** content audit only. No product behavior is asserted. `docs/**` changes require `bun run check:docs`; maintainer-only Markdown does not.
- **Risk / rollback:** changing the current dirty governance or public docs could capture unrelated work; defer those edits. The safe rollback for this new index is deleting only this file.

### GOV-1 — reconcile public Electron migration documents

- **Class / source:** A — `docs/AGENTS.md`; B — `docs/desktop/07-electron-migration-research.md`, `08-electron-migration-tasks.md`, `09-electron-migration-validation-checklist.md`.
- **Surface / state:** `docs`, `maintainers`; **blocked by dirty-file ownership**.
- **Goal and acceptance:** move internal research, migration records, historical test counts, validation matrices, and blocker evidence under `maintainers/`; keep a concise public desktop overview that describes only shipped behavior; remove public navigation to internal plans; repair links.
- **Current implementation / missing work:** `docs/desktop/10-release-auto-update.md` was correctly narrowed to public update guidance, but the three internal Electron documents remain in the VitePress sidebar and desktop index. The public architecture page also exposes internal directory/protocol detail and needs a separately reviewed public rewrite before it can remain published.
- **Dependencies / downstream / recommended stage:** depends on confirming ownership of the modified/untracked docs and maintainer files. It is a **G0 follow-up**, not a product-runtime task.
- **Files:** listed above; the target maintainer files should be named only after deciding whether historical evidence is preserved verbatim or condensed.
- **Verification / evidence:** `bun run check:docs` after public-file changes; verify no VitePress navigation or Markdown link points to moved internal pages.
- **Risk / rollback:** moving historical evidence can break bookmarked links and localization expectations. Preserve history under `maintainers/`, leave a user-facing replacement or redirect decision explicit, and revert only the owned documentation commit if links fail.

### AGT-1 — agent/subagent governance optimization backlog

- **Class / source:** B — `maintainers/agents/governance.md` sections “Current optimization backlog” and “No runtime prompt … is changed”.
- **Surface / state:** `agent-loop`; **deferred**. Repository policy exists; no runtime prompt or AgentTool behavior has been changed.
- **Goal and acceptance:** replace mandatory Explore/Plan spawning with decision rules; make built-in-agent documentation capability-based; add selection/limit tests before changing runtime prompt behavior; measure concurrency outcomes.
- **Current implementation / missing work:** the governance document records the backlog and explicitly prohibits treating it as an implementation. The current session also confirms that harness-level Plan Mode behavior is outside this repository’s product source.
- **Dependencies / downstream / recommended stage:** requires a separately approved `agent-loop` task, bounded prompt/runtime ownership, focused tests, and live/provider evidence when applicable. Do not combine with G0 or Claude runtime work.
- **Files:** to be determined by the future agent-loop task; `maintainers/agents/governance.md` remains the source.
- **Verification / evidence:** prompt-selection and delegation-limit tests first; measure timeout, token, and completion rate before changing defaults.
- **Risk / rollback:** behavior changes may increase cost or decrease completion rate; rollback restores the previous prompt/selection policy, not user-global settings.

### RT-1 — revalidate Claude runtime N1--N5 implementation claims

- **Class / source:** C — `maintainers/runtime/claude-runtime-roadmap.md` N1--N5.
- **Surface / state:** `desktop`, Electron Host, renderer transport; **partially implemented / pending revalidation**. The audited checkout contains the documented adapter, metadata repository, Host service, renderer transport, runtime store, and selector, but recorded passing checks are dated 2026-07-21 and must not be treated as current after later review changes.
- **Goal and acceptance:** confirm N1 metadata ownership, N2 SDK-to-`ServerMessage` adaptation, N3 no-WebSocket external transport, N4 session-operation semantics, and N5 UI/rollback against the current checkout; correct stale roadmap text from direct evidence only.
- **Current implementation / missing work:** `ClaudeSdkMessageAdapter`, `ElectronAgentRuntimeHost`, `AgentRuntimeMetadataRepository`, `AgentSessionTransport`, `agentRuntimeStore`, and `AgentRuntimeSelector` exist. The early “Known incomplete boundaries” section of the roadmap still describes raw messages and unfinished cutover while N2--N5 later record completion; this is a documentation inconsistency until code/tests are rerun.
- **Dependencies / downstream / recommended stage:** complete **G1** before N6 evidence or any N7 work. It unblocks RT-2 and makes later evidence credible.
- **Files:** `desktop/electron/services/{claudeInstallationDiscovery,claudeAgentRuntime,claudeSdkMessageAdapter,agentRuntimeHost,agentRuntimeMetadata}.ts`; `desktop/electron/ipc/**`; `desktop/src/{lib/agentSessionTransport.ts,stores/agentRuntimeStore.ts,stores/sessionStore.ts,stores/chatStore.ts,components/controls/AgentRuntimeSelector.tsx}` and their tests; runtime roadmap.
- **Verification / evidence:** focused service/Host/IPC and renderer/store/transport tests, then the scoped `check:electron`, `check:desktop`, and `check:persistence-upgrade` commands specified by N0--N6. Record fixture/mock, package, Host-service, and visible-Desktop evidence separately.
- **Risk / rollback:** no `src/**` runtime change is allowed. Revert only owned Electron/renderer changes by behavior group; preserve external metadata and user Claude transcripts.

### RT-2 — complete N6 Linux Desktop evidence

- **Class / source:** B/C — runtime roadmap N6 and N5 visible-smoke blocker.
- **Surface / state:** `desktop`, Electron; **partially complete / blocked**. Recorded evidence includes automated gates, Linux package smoke, and an authenticated Linux Host-service turn with permission, resume, and history; it explicitly excludes a visible Electron renderer/window turn.
- **Goal and acceptance:** obtain controlled, logged-in Linux **visible Electron Desktop** evidence for discovery, selection/login failure, first turn, permission, interrupt/stop, restart/resume/history, shutdown, and orphan inspection without sending raw SDK messages to renderer state.
- **Current implementation / missing work:** Host-service execution exists; GUI-capable packaged or Electron-dev environment and a predeclared smoke procedure remain missing.
- **Dependencies / downstream / recommended stage:** requires RT-1. Recommended **G2**; blocks RT-4.
- **Files:** expected evidence/runbook updates only unless a verified defect appears; runtime implementation paths from RT-1.
- **Verification / evidence:** plan the process, port, authenticated user impact, temp-data location, cleanup, and stop condition before launch. Do not call host-only or package evidence a visible UI result.
- **Risk / rollback:** live turns may create Claude-owned transcripts or local temporary files. Use an isolated work directory, delete only test-owned files, stop Electron/SDK processes, and never alter user credentials/transcripts.

### RT-3 — complete N6 Windows Host/WSL and macOS evidence

- **Class / source:** B/C — runtime roadmap N6 cross-platform table and N6 observed blockers.
- **Surface / state:** `desktop`, packaging; **blocked by unavailable platforms**.
- **Goal and acceptance:** in a real Windows Electron package, validate both a Windows Host Claude CLI and user-selected WSL CLI; on available macOS hardware validate Host Claude. Each path covers the RT-2 lifecycle matrix.
- **Current implementation / missing work:** Windows WSL discovery/launch wrappers and platform packaging scripts are present in the checkout; no real Windows Host, Windows-to-WSL, or macOS runtime evidence is recorded.
- **Dependencies / downstream / recommended stage:** requires RT-1 and a successful/reproducible RT-2 procedure. Recommended **G3**; blocks RT-4.
- **Files:** evidence/runbook updates only by default; platform scripts and discovery service only if a platform-specific defect reproduces.
- **Verification / evidence:** real packages and real Host/WSL environments; cross-build and package-smoke remain package evidence only.
- **Risk / rollback:** use isolated user data/workspaces and stop all test processes. Platform-specific implementation fixes need their own focused tests and gates.

### RT-4 — execute N7 transitional server-runtime removal

- **Class / source:** A/B — runtime hard boundary in the maintenance directive; runtime roadmap N7.
- **Surface / state:** `server`, `desktop`, `provider/runtime`; **blocked / not started**.
- **Goal and acceptance:** remove `/api/runtimes`, runtime fields on server sessions, and `src/server/runtimes/**` only after N1--N6 plus one real logged-in Desktop turn; retain Built-in server/WebSocket behavior and external Electron ownership.
- **Current implementation / missing work:** the checkout still contains the transitional server prototype, server imports/routing, and transition DTO/session paths. It must not be removed during G0--G3.
- **Dependencies / downstream / recommended stage:** requires RT-1, RT-2, and applicable RT-3 evidence. Recommended **G4**.
- **Files:** `src/server/runtimes/**`, affected `src/server` API/router/WebSocket/H5/MCP/plugins/rewind/shutdown files, transitional renderer DTO/API paths, and regression tests.
- **Verification / evidence:** restore one behavior group at a time; rerun Built-in server/WebSocket regression after each group, plus the full N6 evidence record. No reset, checkout, or bulk overwrite in the dirty worktree.
- **Risk / rollback:** high risk to upstream Built-in behavior. Each behavior-group commit is the rollback unit; unresolved external server shells block deletion.

### RT-5 — research and design official Codex runtime

- **Class / source:** B — runtime roadmap “Deferred Runtime Work”.
- **Surface / state:** `provider/runtime`; **not started / deliberately deferred**.
- **Goal and acceptance:** research only official SDK/CLI/protocol support for credentials/transcripts, sessions/resume/history, stream/tool/permission events, operations, platform support, and Electron packaging; produce a decision document with no implementation.
- **Current implementation / missing work:** no Codex runtime is approved or implemented; `openai_oauth` is not a runtime substitute.
- **Dependencies / downstream / recommended stage:** wait for stable Claude boundary and N7 outcome; recommended **G5**.
- **Files:** future maintainer research document; no runtime abstraction or provider implementation now.
- **Verification / evidence:** official documentation and controlled research evidence at implementation time.
- **Risk / rollback:** avoid credential/transcript ownership violations and premature shared abstractions; no product rollback is needed because this is research.

### RT-6 — research and design official OpenCode runtime

- **Class / source:** B — runtime roadmap “Deferred Runtime Work”.
- **Surface / state:** `provider/runtime`; **not started / deliberately deferred**.
- **Goal and acceptance:** establish whether a documented stable official SDK/CLI/daemon supports the same lifecycle guarantees; defer if only private or unstable protocols exist.
- **Current implementation / missing work:** no OpenCode implementation or approved protocol exists.
- **Dependencies / downstream / recommended stage:** follow RT-5 only after the Claude boundary is stable; recommended **G6**.
- **Files:** future maintainer research document only.
- **Verification / evidence:** official documentation and platform/packaging analysis at that time.
- **Risk / rollback:** no preemptive abstraction or dependency; research-only rollback is discarding an unapproved proposal.

### RT-7 — extract multi-runtime capability boundary only after repetition

- **Class / source:** B — runtime roadmap accepted architecture and deferred work.
- **Surface / state:** `desktop`, `provider/runtime`; **not started / product decision required**.
- **Goal and acceptance:** extract common capability/segment behavior only after at least two real runtimes exhibit stable repeated needs; preserve runtime-specific ownership and unsupported-feature gates.
- **Current implementation / missing work:** Claude is intentionally concrete; no generic runtime capability contract is justified.
- **Dependencies / downstream / recommended stage:** requires completed, validated Claude plus at least one additional official runtime design/implementation and a product decision; recommended **G7**.
- **Files:** to be determined after actual duplication exists.
- **Verification / evidence:** behavior matrix across real runtimes, migration tests, and runtime-specific regression checks.
- **Risk / rollback:** premature abstraction can leak capability semantics; retain per-runtime adapters until duplicated behavior is proven.

### REL-1 — re-establish the next desktop release evidence baseline

- **Class / source:** B/D — `maintainers/release/desktop-release.md`; release workflow; `release-notes/v0.4.8.md` historical update-verification procedure.
- **Surface / state:** `release`; **blocked by release/version decision**. The checked-out desktop package version is `0.4.6`, while `v0.4.8` is an upstream tag and the local `main` is ahead of `origin/main`; the prior v0.4.8 update procedure is historical evidence, not an executable current release plan.
- **Goal and acceptance:** after a maintainer chooses the next release version and owned changes, align `desktop/package.json`, `release-notes/vX.Y.Z.md`, main, exact tag, updater metadata, signed/unsigned status, and the selected real update evidence.
- **Current implementation / missing work:** deterministic release preflight, dry run, workflow asset validation, and the repository-local skill exist. A next version, clean/owned release set, and platform evidence do not.
- **Dependencies / downstream / recommended stage:** requires the related product stages and explicit release intent; recommended **G8**.
- **Files:** `desktop/package.json`, `release-notes/vX.Y.Z.md`, `scripts/release.ts`, `scripts/release-preflight.ts`, `.github/workflows/release-desktop.yml`, and the runbook as applicable.
- **Verification / evidence:** `bun run release:preflight -- X.Y.Z`, dry run, selected gates, then exact `origin` pushes and explicit `gh --repo LiuGuangHS/EchoFlow-ClaudeCode` checks. Separate package, updater, signing, and real update evidence.
- **Risk / rollback:** tags/releases are outward-facing. Preflight is read-only; tag repair needs explicit maintainer intent, recorded old/new targets, and an exact-tag force push only.

## Evidence and blocker rules

1. A test name, mock, fixture, code path, or package artifact alone does not complete a task.
2. Record mock/fixture, migration, cross-build, package, Electron Host-service, visible Desktop UI, real provider, and platform evidence separately.
3. Conditional test skips are current environment/feature guards unless their surrounding test identifies an unmet product requirement. Existing Darwin, Windows, and transcript-classifier guards were reviewed as **not independently approved backlog tasks**.
4. `src/**` TODO/FIXME markers are upstream maintenance debt unless a user request or approved roadmap creates a fork-owned task. They remain review suggestions, not automatic work.

## Review suggestions — not approved for implementation

| ID | Observation | Why it is not a task yet |
| --- | --- | --- |
| SUG-1 | Add a focused documentation-policy regression only if future public/internal migrations recur and manual review proves insufficient. | A new check script would be speculative today. |
| SUG-2 | Review whether public desktop architecture should retain a stable, user-oriented overview after GOV-1 moves internal detail. | Requires ownership of the current dirty docs and a documentation product decision. |
| SUG-3 | Review machine-specific `.claude` permissions when the active worktree path changes. | User-local settings are protected and must not be changed by repository maintenance. |
| SUG-4 | Triage upstream `src/**` TODO/FIXME inventory only during a separately approved upstream-sync or upstream-contribution effort. | The runtime boundary forbids opportunistic fork changes under `src/**`. |

## Dirty-worktree disposition

| Group | Files / evidence | Attribution and disposition |
| --- | --- | --- |
| Existing governance and public-doc edits | Modified `AGENTS.md`, `CLAUDE.md`, `docs/AGENTS.md`, `docs/desktop/10-release-auto-update.md`, `docs/desktop/index.md`; untracked existing maintainer files | **Unknown/in-flight.** They contain useful convergence work but predate G0 ownership. Do not stage, reformat, overwrite, or include them in this phase commit. |
| Repository-local Skill/config | `.claude/skills/release-preflight/SKILL.md` is untracked but intentionally shareable; `.claude/settings*.json` are ignored local settings | The Skill may be reviewed and committed only in a dedicated, isolated ownership step. Settings remain user-local. |
| External Claude Electron/renderer implementation | Modified Electron IPC/main/host, renderer stores/components/types; untracked Electron services, runtime store/API/transport/selector tests | **Current in-flight runtime work; ownership not established by diff alone.** Preserve unchanged during G0; RT-1 revalidates it. |
| Transitional server runtime | Modified server/session/WebSocket/H5/MCP/plugins/rewind/shutdown; untracked `src/server/runtimes/**` and runtime APIs/tests | **Current in-flight transition; explicitly blocked from removal before RT-4.** Never stage it with G0. |
| Release/dependency/platform script changes | Modified `package.json`, lockfiles, release script/tests; untracked release preflight and Windows cross-build script/tests | **Current in-flight release/runtime support.** Preserve; REL-1 owns a future release-only review. |
| This index | `maintainers/roadmap.md` | **G0-owned new file.** It is the only candidate for a G0 commit. |

## Stage direction and entry criteria

| Stage | Direction | Enter only when |
| --- | --- | --- |
| G0 | Governance/index convergence | Current phase; commit only isolated new governance files. |
| G1 | Revalidate and reconcile Claude runtime N1--N5 | G0 records the dirty-worktree boundary; runtime files and tests can be attributed. |
| G2 | N6 automation plus controlled visible Linux Desktop evidence | G1 evidence is current and the live procedure is approved in the stage plan. |
| G3 | Windows Host/WSL and macOS evidence | G2 procedure is reproducible and required hardware/package environments are available. |
| G4 | N7 transitional server-runtime removal | N1--N6 and a real logged-in Desktop Claude turn are evidenced; external mapping migration is clear. |
| G5 | Official Codex runtime research/design | Claude boundary is stable; research is explicitly authorized. |
| G6 | Official OpenCode runtime research/design | G5/Claude findings establish a meaningful comparison point. |
| G7 | Shared multi-runtime boundary | At least two real runtimes demonstrate stable duplicated behavior and product approval exists. |
| G8 | Release, migration, and long-term maintenance | A concrete version/release scope is selected and all required platform evidence is identified. |
