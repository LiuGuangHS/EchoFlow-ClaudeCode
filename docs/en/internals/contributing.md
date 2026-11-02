---
title: Contributing and Quality Gates
nav_title: Contributing
description: Local setup, impact checks, quality gates, testing requirements, and the PR workflow.
order: 14
---

# Contributing and Quality Gates

This guide explains how to install, develop, test, and run quality gates before opening a PR. The goal is to answer one question before review: did this change break the core Coding Agent workflow?

## Setup

The repository uses Bun:

```bash
bun install
```

If a change touches `desktop/` or `adapters/`, install the corresponding dependencies:

```bash
cd desktop && bun install
cd adapters && bun install
```

Do not commit local artifacts such as `artifacts/quality-runs/`, `node_modules/`, or `desktop/node_modules/`.

Common development entry points:

```bash
bun run start                                   # run the CLI locally
SERVER_PORT=3456 bun run src/server/index.ts    # API/WebSocket server used by desktop/
cd desktop && bun run electron:dev              # full Electron app, sidecars, and hot reload
cd desktop && bun run electron:build            # build sidecars, renderer, and Electron bundles; no installer
cd desktop && bun run electron:package           # create a local installer with electron-builder (`--publish never`)
cd desktop && bun run test                      # desktop Vitest suites
cd adapters && bun run test                     # adapter tests
bun run docs:dev                                # docs preview
```

When the repository is hosted in WSL, run desktop development and verification commands inside WSL. The Vite-only `cd desktop && bun run dev` path is for isolated frontend debugging; user-visible desktop changes should use the full Electron app. Native Windows x64 packaging starts with `cd desktop && bun run build:windows-x64`.

## Gate Tiers

| Tier | Trigger | What runs | Constraint |
| --- | --- | --- | --- |
| Local | manual | Narrow tests and commands selected by `check:impact` | fast feedback |
| PR (required) | `pull_request` | Deterministic lanes selected by impact, including `check:agent-flow` | no model, provider, or secret; works on forks |
| Full sweep | Maintainer-triggered `workflow_dispatch` | Every deterministic lane, module-graph health, and `check:desktop-ui-smoke` | still no model or secret |
| Release | tag triggers `release-desktop.yml` | Content gate, three verification jobs, and six-platform build | live checks require maintainer authorization |

The release workflow's `release-contract` checks the release surface, tag, `desktop/package.json` version, and release-note title. `verify-governance`, `verify-runtime`, and `verify-desktop` run in parallel; `release-verify-gate` summarizes their results. A failed build or verification job prevents publishing.

Every quality lane that starts the real server uses a sandbox config directory and checks that the developer's real `~/.claude` was not written. Maintainer live baselines, signing, packaging, and real upgrade verification are internal runbook procedures, not normal PR requirements.

## Path-Aware PR Checks

Ask the repository which checks match the current diff:

```bash
bun run check:impact
```

`scripts/pr/change-policy.ts` is the single owner of path routing, areas, same-area test requirements, labels, and blocking rules. `scripts/pr/module-graph.ts` only widens check selection: `## Cross-surface impact` names the importer that selected an extra check and does not widen areas, labels, or missing-test blocking. If the graph cannot be built, every surface check is selected and the reason is printed.

Common entry points are:

```bash
bun run check:server
bun run check:desktop
bun run check:adapters
bun run check:docs
```

Use the `check:*` scripts in `package.json` for mobile, native, provider/chat contracts, persistence, and coverage; do not maintain a second routing table here.

## Deterministic Agent Gate (no model required)

```bash
bun run check:agent-flow
bun run check:desktop-ui-smoke
```

`check:agent-flow` uses the real server, real WebSocket, and mock CLI to cover session creation, runtime selection, first-turn streaming, tool calls, permission allow/deny, tool failure, API error, interrupt, reconnect permission replay, and session recovery. `check:desktop-ui-smoke` clicks the real permission button in the real desktop UI; it prints a reason when `agent-browser` or desktop dependencies are missing.

Neither lane needs a provider, credentials, or the public network. For temporary browser checks, screenshots, and exploratory UI verification, use browser automation available in the current session rather than treating repository `agent-browser` scripts as a general-purpose browser tool.

## AI Coding Agent Fix Loop

1. Run `bun run check:impact` to determine the current diff's check scope.
2. Write a behavior-reproducing test, watch it fail for the expected reason, then make the smallest fix.
3. Rerun focused checks during repair and rerun every required check after the final edit.
4. Fix failures caused by this change; report unrelated failures or environment blockers instead of expanding scope.
5. Claim PR-ready or full validation only after `bun run verify` passes for the final diff.

For a failed lane, read the Summary / Result Matrix in `artifacts/quality-runs/<timestamp>/report.md` and its `logs/<lane>.log`. For coverage failures, read `artifacts/coverage/<timestamp>/coverage-report.md` or `.json`; do not lower baselines, thresholds, or test expectations to hide failures.

Adjudicate conflicts hunk by hunk; never apply blanket `--ours` or `--theirs`. Before release, run `bun run check:release-surface` to audit public identity.

## Agent Toolset

Installed workflow skills and code-navigation tools help with design, planning, review, and minimal implementation, but they do not replace `check:impact`, surface checks, `check:policy`, or `verify`. Use the repository's current skill registry instead of assuming an unavailable command or agent name.

Choose the smallest agent shape that proves the task: a single agent for a local reversible change; an independent exploration or focused reviewer for cross-surface uncertainty; separate exploration, implementation, and adversarial review only for high-risk or architecture-level work. Do not default every sub-agent to the highest model tier, and do not use parallel agents when their work would conflict in the same tree.

## Regression Test Design

A same-area test file is only the gate's minimum signal; tests must prove behavior:

- **Drive state transitions.** Produce state through `handleServerMessage`, real store actions, or user events instead of assigning the expected result with `setState`; direct setup is fine for fixture initialization.
- **Assert behavioral invariants.** Check which session or model the user should see instead of copying today's screen text; do not change existing test inputs or expectations just to keep the gate green.
- **Cover both dropping and keeping.** A replay should be dropped while a genuine repeat is kept; forward upstream identities such as `uuid` and `toolUseId` instead of guessing identity from text.
- **Test connections across boundaries.** Separate green server, store, and component tests do not prove that a message drives the UI; exercise risky connections through real entry points and do not mock the module under test.
- **Separate flakiness from defects.** Reproduce suspected existing flakes on a clean `main` worktree; before changing waits, confirm that the assertion measures behavior rather than machine speed.
- **Build external-service doubles from a captured response.** Before writing a fake for a gateway, OAuth, or token API, capture one real request/response (redacted) and model the fake from it. The SiHub token flow once had 695 offline tests pass while every live call failed on an undocumented `New-Api-User` header and group field. Until the live path is exercised, report "offline tests pass, live not verified", not "fixed".

Coverage also has limits: `desktop/vitest.config.ts` collects only `src/**`, excluding the Electron main process; the current Bun coverage baseline has no branch records, so `0/0` displayed as 100% does not prove all branches ran. Use current configuration and reports as evidence.

## Feature Quality Contract

Every feature, bugfix, and behavior change must ship with verifiable evidence:

- Name the changed surface and add same-area tests for executable JS/TS production changes; `scripts/pr/change-policy.ts` enforces the exact area and blocking rules.
- Pure logic needs unit tests. Server/API/provider/runtime behavior needs API or request-shape tests. Desktop UI/store/API behavior needs Vitest or Testing Library coverage. Cross-boundary UI, WebSocket, provider proxy, native sidecar, and release-packaging flows need E2E or smoke evidence.
- Agent loops, tool calls, provider routing, model selection, file editing, permissions, session resume, and desktop chat changes need mock/fixture tests in the PR. Run live smoke or baseline only after deterministic checks pass and a maintainer explicitly authorizes quota use.
- New or changed executable production lines must pass the changed-line threshold in `coverage-thresholds.json`. Baseline/threshold changes require maintainer authorization and `allow-coverage-baseline-change`.
- PR descriptions must record changed files, tests added or updated, coverage evidence, E2E/live evidence or a blocker, and known risk / rollback.

## Local Pre-Push Reminder

push no longer runs a local quality gate automatically. Run it manually when needed:

```bash
bun run quality:push
```

It reuses PR impact, policy, and path checks while skipping expensive coverage by default. `bun run hooks:install` installs only a non-blocking reminder and never blocks a push.

## PR CI Merge Gate

`.github/workflows/pr-quality.yml` runs when a PR changes. `scope-plan` creates the stable impact plan, `policy-enforcement` runs policy independently, and product jobs select desktop, server, adapter, native, provider contract, chat contract, persistence, docs, and coverage lanes by path. The final `pr-quality-gate` requires selected jobs to succeed and unselected jobs to be explicitly skipped; cancelled or missing results cannot be treated as success.

A required contract failure from `bun run audit:harness` exits nonzero; other rubric findings, such as names still inside a compatibility window, remain report-only. Repository settings, rulesets, secrets, and required-check changes require explicit authorization.

## Unified Verification and PR Evidence

```bash
bun run verify
```

`bun run verify` is `bun run quality:pr`; it runs the selected policy, surface, contract, persistence, docs, and coverage lanes for the current diff without real models. Maintainer-authorized live provider and baseline checks are not normal contributor requirements.

A PR description should include:

- user impact and changed surface;
- changed files and tests added or updated;
- commands actually run and quality/coverage report paths;
- E2E or live evidence, or an explicit blocker;
- known risk, rollback notes, and checks not run.

## Maintainer Verification and Releases

Live model baselines, provider configuration, signing, and real upgrade verification are maintainer procedures, not requirements for contributors or public PRs. Maintainers should consult `docs/_internal/release-windows.md` and the other `_internal/` runbooks when these procedures are needed; do not record local providers, credentials, or real upgrade steps in this public contribution guide.

The public release contract requires the version, Git tag, and `release-notes/vX.Y.Z.md` to match, and `bun run check:release-surface` to pass.
