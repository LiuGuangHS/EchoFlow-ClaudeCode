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
- Prefer the installed agent toolset over recreating planning, review, debugging, or design workflows; the contribution guide owns the detailed tool routing and workflow.
- Identify the changed surface first. The canonical vocabulary is the `ChangeArea` union in `scripts/pr/change-policy.ts`: `desktop`, `server`, `adapters`, `docs`, `release`, `mobile`, `cli-core`, `harness`. The prose surfaces in this file map onto it: `native/` routes to `desktop`, `site/` to `docs`, `harness/` to `harness`, and `.github/workflows/**` selects the policy lane. Path-to-area routing lives in `scripts/pr/area-routing.json`; `pr-triage.yml` reads that file from the base revision, never from PR head. Do not invent a surface name that has no area and no check behind it.
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

## Verification and quality ownership

- Use the narrowest meaningful check while iterating. The surface-to-gate matrix, deterministic lane contracts, coverage rules, and failure diagnosis live in `docs/internals/contributing.md`; the English mirror is `docs/en/internals/contributing.md`.
- `scripts/pr/change-policy.ts` owns path routing and required checks. `bun run check:impact` is the minimum changed-surface report and must be read before selecting checks; dependency-aware widening is reported in `## Cross-surface impact`.
- Provider/auth/proxy/runtime and desktop chat/session changes may add offline contract checks. Required PR checks must not call real models, live providers, public network, repository secrets, or the developer's real home/config.
- `bun run verify` is the full PR/push/release-readiness entrypoint. Do not claim that status without the required evidence; live provider and maintainer-only lanes require explicit authorization.

## Quality and verification boundaries
- `docs/internals/contributing.md` owns contribution procedures, test design, quality gates, coverage policy, and Agent flow case law; its English mirror is `docs/en/internals/contributing.md`.
- `docs/internals/structure.md` owns the directory map and module responsibilities. Area-specific guidance stays next to the code in `desktop/AGENTS.md`, `adapters/AGENTS.md`, `src/AGENTS.md`, `mobile/AGENTS.md`, and `docs/AGENTS.md`.
- `scripts/pr/change-policy.ts` owns path routing, same-area test requirements, labels, and blocking policy. Do not duplicate those predicates in reports or prose.
- Required PR checks must be deterministic and safe on an untrusted fork: no real models, public network, repository secrets, saved providers, or real user home/config. The detailed lane contract and command list live in the contribution guide.
- `bun run check:impact` is the minimum changed-surface report. `bun run verify` is the full PR/push/release-readiness entrypoint; do not claim that status without its required evidence.

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

## Release integrity

- Desktop releases use plain `vX.Y.Z` tags matching `desktop/package.json`; release notes, `scripts/release.ts`, and `.github/workflows/release-desktop.yml` must agree. `desktop/package.json` is the version source of truth, and EchoFlow keeps its own version line.
- Do not move tags, upload local artifacts, or announce a release before the release workflow and public assets are verified. The full release procedure, signing requirements, Windows packaging, and update-channel checks live in `docs/_internal/release-windows.md` and its English mirror.
- `bun run check:release-surface` is the standing content and identity gate.

## Independence & Reference Policy
EchoFlow Code is standalone software. There is no upstream project this repository tracks, merges with, or versions against, and the old sync workflow is retired.

- Never merge, cherry-pick, vendor, or copy code from another project into this tree. Other projects — including any former upstream — are reference and learning material only. Read them, take the idea, and reimplement it here with our own code, our own names, and our own tests.
- When a fix is inspired by elsewhere, the commit must stand on our own proof: a failing test we wrote, a verified bug we reproduced, or a compatibility constraint. "It came from that project" is not a provenance this repository accepts.
- Do not attribute EchoFlow's authorship, maintenance, contact, or product identity to another project or its author in README, docs, release notes, package metadata, diagnostics export, signing/privacy pages, updater links, or desktop About/profile defaults.
- Third-party copyright and permission notices stay with the code they cover. Move them to `THIRD_PARTY_LICENSES.md` when a file needs to carry its own license separately; never delete a notice a license requires us to keep. This is a legal floor, not a branding preference.
- `bun run check:release-surface` is the standing gate: it rejects foreign-authored release notes, version/brand drift, unresolved conflicts, and upstream identity markers on the public surfaces.

## Commit and PR boundaries

- Use Conventional Commit prefixes and normal product branch prefixes such as `fix/xxx`, `feat/xxx`, or `docs/xxx`; do not create `codex/`-prefixed branches.
- Record non-obvious decisions in git-native trailers. The PR evidence fields and local handoff format are owned by `.github/pull_request_template.md` and `docs/internals/contributing.md`.

## Deeper Guides
- When installing, testing, or preparing a contribution, read `CONTRIBUTING.md` and `docs/internals/contributing.md` for workflows, coverage policy, and test-design case law.
- When locating a module or understanding ownership, read `docs/internals/structure.md` for directory responsibilities.
- When selecting commands or determining which checks a change requires, consult `package.json` and `scripts/pr/change-policy.ts`.
- When preparing a pull request, follow the evidence fields in `.github/pull_request_template.md`.
- Before a desktop release or auto-update change, follow `docs/_internal/release-windows.md` (English: `docs/en/_internal/release-windows.md`).
