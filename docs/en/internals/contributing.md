---
title: Contributing and Quality Gates
nav_title: Contributing
description: Local setup, impact checks, quality gates, testing requirements, and the release workflow.
order: 14
---

# Contributing and Quality Gates

This guide explains how to install, develop, test, and run quality gates. The goal is that every change can answer one question: did it break the core Coding Agent workflow?

## Setup

The repository root uses Bun:

```bash
bun install
```

When a change touches `desktop/` or `adapters/`, install the corresponding dependencies:

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
cd desktop && bun run electron:build            # build sidecars, renderer, and Electron bundle; no installer
cd desktop && bun run electron:package           # create a local installer with electron-builder (--publish never)
cd desktop && bun run test                      # desktop Vitest suites
cd adapters && bun run test                     # adapter tests
bun run docs:dev                                # docs site preview
```

When the repository lives in WSL, run development and verification commands inside WSL. The Vite-only `bun run dev` in `desktop` is for isolated frontend debugging; for user-visible desktop changes, start the full Electron app and exercise the affected flow. The native Windows x64 packaging entry point is `cd desktop && bun run build:windows-x64`.

## Four Gate Tiers

| Tier | Trigger | What runs | Constraint |
| --- | --- | --- | --- |
| Local iteration | manual | The narrowest relevant tests and the commands selected by `check:impact` | fast feedback |
| PR (required) | `pull_request` | Deterministic lanes selected by impact, including `check:agent-flow` | no model, no secret; safe for external contributions |
| Full sweep | maintainer-triggered `workflow_dispatch` | Every deterministic lane, module-graph health, and `check:desktop-ui-smoke` | still no model, no secret |
| Release | tag triggers `release-desktop.yml` | Content gate, three verification jobs, and six-platform builds | live checks run only in authorized maintainer flows |

In the release workflow, `release-contract` first checks the release surface, the tag, the `desktop/package.json` version, and the release-note title. `verify-governance`, `verify-runtime`, and `verify-desktop` run in parallel, and `release-verify-gate` summarizes their results. A failed build or verification job prevents publishing.

Maintainer live baselines, signing, packaging, and real upgrade verification belong to the internal runbooks.

## Impact Checks

Let the repository list the checks required by the changed paths and the import graph:

```bash
bun run check:impact
```

`scripts/pr/change-policy.ts` is the single owner of path routing, areas, same-area test requirements, labels, and blocking rules. `scripts/pr/module-graph.ts` only widens check selection: the report's `## Cross-surface impact` names the importer that triggered an extra check, and it never widens areas, labels, or missing-test blocking. If the dependency graph cannot be built, every surface check is selected and the reason is printed.

The most common entry points:

```bash
bun run check:server
bun run check:desktop
bun run check:adapters
bun run check:docs
```

Entry points for mobile, native, provider/chat contracts, persistence, and coverage are defined by the `check:*` scripts in `package.json`; this guide does not keep a second routing table.

## Deterministic Agent Gate (no model required)

```bash
bun run check:agent-flow
bun run check:desktop-ui-smoke
```

`check:agent-flow` uses a real server, a real WebSocket, and a mock CLI to cover session creation, runtime selection, first-turn streaming, tool calls, permission allow/deny, tool failure, API error, interrupt, reconnect permission replay, and session recovery. `check:desktop-ui-smoke` clicks the real permission button in the real desktop UI; when `agent-browser` or desktop dependencies are missing, it prints the reason.

Neither lane needs a provider, credentials, or the public network. `agent-browser` belongs only to this committed lane (run headlessly on Linux CI) and to the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts. For ad-hoc browser checks, screenshots, and exploratory UI verification, use whatever browser automation the current session actually has (a browser MCP, a browser plugin, or headless Chrome); do not treat the repository's `agent-browser` as a general-purpose tool.

Every quality-gate lane that starts a real server runs in a sandbox config directory (`scripts/quality-gate/sandbox.ts`) and checks at the end that the developer's real `~/.claude` was not written; a write fails the lane.

During development, run the narrow commands selected by the impact report. When you need full validation, use the unified entry point directly; there is no need to run all of its lanes separately first:

```bash
bun run verify
```

`bun run verify` is equivalent to `bun run quality:pr`. It runs the selected policy, desktop, server, adapter, native, provider contract, chat contract, persistence, docs, and coverage lanes for the changed scope, and it does not call a real model. Contributors with a small change do not need to run unrelated modules locally; GitHub CI runs the exact path-aware gate again.

The main quality report embeds the current test scope, a result matrix, and a coverage summary, and links the full coverage, JUnit, and log artifacts:

```text
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/report.json
artifacts/quality-runs/<timestamp>/junit.xml
artifacts/quality-runs/<timestamp>/logs/*.log
artifacts/coverage/<timestamp>/coverage-report.md
artifacts/coverage/<timestamp>/coverage-report.json
```

Paste the commands you actually ran and their summaries into the handoff. `quality:pr` and `quality:verify` remain as compatibility entry points, but documentation and AI prompts should use `bun run verify`.

### Lightweight verification (maintainer routine releases)

Release verification now lives in CI, so a full local run is no longer needed. The routine flow:

1. **Before tagging** (optional): manually trigger the `Quality Check` workflow in GitHub Actions to confirm the codebase is green.
2. **Tag**: `release-desktop.yml` runs the content gate, the parallel verification jobs, and the six-platform builds automatically, and publishes only if all of them pass.

If you really need to run everything locally (for example, with an inconvenient network), use this set of commands, which covers the same ground as the CI verification:

```bash
bun run check:policy              # policy, dead-imports, module-graph, contract byte budget
bun run check:server              # all of src/
bun run check:desktop             # lint + vitest + vite build
bun run check:provider-contract   # provider/proxy/auth contracts
bun run check:chat-contract       # desktop transport, store, first turn
bun run check:persistence-upgrade # persistence migrations and legacy fixtures
bun run check:agent-flow          # model-free agent end-to-end, 8 scenarios
bun run check:adapters            # IM sidecars
bun run check:release-surface     # release surface: brand markers, version/brand drift, leftover conflicts
```

`check:native` (full sidecar build + packaging + package smoke) is the slowest; run it only when you touch `native/`, `desktop/electron` packaging configuration, or release scripts. The real Release workflow rebuilds on six platforms, so there is no need to repeat that locally.

`check:server` includes dynamic-port tests and must not run concurrently with other server lanes; run them serially.

The coverage gate runs the root, desktop, and adapters suites that match the changed source areas, then applies the baseline ratchet, reports the gap to the targets, and checks changed-line coverage; unchanged areas are not rerun. When no source area can be identified, or when the coverage policy or the dependency manifests change, every area runs. The current baseline is recorded in `scripts/quality-gate/coverage-baseline.json`; CI prefers the base branch's baseline, and coverage of the changed areas must not fall below the allowed window. A change to `coverage-baseline.json` or `coverage-thresholds.json` can merge only after a maintainer adds `allow-coverage-baseline-change`. Quarantine is only for maintainer baseline/release tracking and must not hide deterministic provider/chat contract tests; the regular PR gate does not rely on quarantine to pass.

## AI Coding Agent Fix Loop

1. Run `bun run check:impact` first to determine the check scope of the current diff.
2. Write a test that reproduces the behavior, watch it fail for the expected reason, then make the smallest fix.
3. During repair, rerun the narrow checks that are affected; after the last edit, rerun every required check.
4. Fix only the failures this change caused; report unrelated existing failures or environment blockers honestly instead of expanding scope.
5. Claim full validation only after `bun run verify` passes for the final diff.

When diagnosing a failed lane, first read the Summary / Result Matrix in `artifacts/quality-runs/<timestamp>/report.md` and the matching `logs/<lane>.log`. For coverage failures, read `artifacts/coverage/<timestamp>/coverage-report.md` or `.json`; do not lower baselines, thresholds, or test expectations to hide a failure. `bun run check:impact` determines the check scope of the final diff: read its result before starting the checks it selects, and never launch them in parallel with the impact analysis. When a check fails or its output is incomplete, look at the existing logs and processes first; rerun the same check only when there is new diagnostic evidence. Do not keep rerunning checks that already passed when there are no further edits or unresolved risks. Report unrelated existing failures or environment blockers accurately instead of widening the change just to turn the result green.

Resolve merge conflicts hunk by hunk; never apply blanket `--ours` or `--theirs`. Before release, also run `bun run check:release-surface` to audit the public identity.

## Agent Toolset

Installed workflow skills and code-navigation tools can help with design, planning, review, and minimal implementation, but they do not replace `check:impact`, surface checks, `check:policy`, or `verify`. Use the repository's current skill registry; do not assume commands or agent names that do not exist.

Tier agents by what the task needs to be proven: a single agent for a local, reversible change; independent exploration or a focused review when it is unclear which surfaces are affected; separate exploration, implementation, and adversarial review only for high-risk or architecture-level work. Do not default every sub-agent to the highest model tier, and do not let parallel agents modify conflicting content in the same working tree.

## Regression Test Design

A same-area test file is only the gate's minimum signal; the test must also prove behavior:

- **Drive state transitions.** Produce state through `handleServerMessage`, real store actions, or user events; do not write with `setState` a result that a transition should have produced. Setting state directly is fine when initializing a fixture.
- **Assert behavioral invariants.** Assert which session's or model's data the user should see instead of copying the current screen text, and never change existing test inputs or expectations just to get past the gate.
- **Cover both dropping and keeping.** A replay must be dropped and a genuine repeat must be kept; pass through upstream identities such as `uuid` and `toolUseId` rather than guessing identity from text.
- **Test the connections across boundaries.** Server, store, and component tests each passing does not mean a message actually drives the UI; test the connection through the real entry point and do not mock the module under test.
- **Decide first whether it is flaky or defective.** Reproduce a suspected pre-existing flaky test on a clean `main` worktree; before changing how a test waits, confirm that the assertion measures behavior rather than machine speed.
- **Build external-service doubles from real responses.** Before writing a double for a gateway, OAuth, or token API, capture one real request and response (redacted) and model from it. The SiHub token flow once had 695 offline tests pass while every real call failed because of an undocumented `New-Api-User` header and group field. Until the real path has been exercised, report "offline tests pass, live not verified", never "fixed".

Coverage has limits too: `desktop/vitest.config.ts` collects only `src/**` and excludes the Electron main process; the current Bun coverage baseline has no branch records, so `0/0` shown as 100% does not mean every branch was tested. Treat the current configuration and reports as evidence.

## Feature Quality Contract

Every feature, bugfix, and behavior change must come with verifiable evidence:

- Declare the changed surface first and add same-area tests for executable JS/TS production code; the exact area and blocking decisions are enforced by `scripts/pr/change-policy.ts`.
- Pure logic gets unit tests; server/API/provider/runtime code gets API or request-shape tests; desktop UI/store/API code gets Vitest or Testing Library tests; flows that cross UI, WebSocket, provider proxy, native sidecar, and release packaging add E2E or smoke coverage.
- Changes to the agent loop, tool calls, provider routing, model selection, file editing, permissions, session recovery, and desktop chat must have mock/fixture tests. Live smoke or baseline runs only after the deterministic checks pass and a maintainer explicitly authorizes it.
- New or changed executable production lines must meet the changed-line coverage threshold in `coverage-thresholds.json`. Changing the coverage baseline or thresholds requires maintainer authorization and `allow-coverage-baseline-change`.
- The handoff should record changed files, tests added or updated, coverage evidence, E2E/live evidence or a blocker, and known risk / rollback.

## Local Pre-Push Reminder

A push no longer runs the local quality gate automatically. Run it manually when needed:

```bash
bun run quality:push
```

It reuses the impact, policy, and path checks and skips the expensive coverage run by default. `bun run hooks:install` installs only a non-blocking reminder and will not hold up a push.

A failure of a required contract in `bun run audit:harness` exits nonzero; other rubric findings, such as legacy names still inside a compatibility window, are reported but do not block. Changes to repository settings, rulesets, secrets, and required checks need explicit authorization.

## Delivery Evidence

The scope of `bun run verify` is described above under "Deterministic Agent Gate (no model required)". Only maintainer-authorized live provider and baseline runs are not required of regular contributors.

In the handoff, write:

- user impact and changed surface;
- changed files, tests added or updated;
- the commands actually run and the quality/coverage report paths;
- E2E or live evidence, or an explicit blocker;
- known risk, rollback notes, and checks not run.

## Maintainer Verification and Releases

Real-model baselines, provider configuration, signing, and real upgrade verification are maintainer procedures, not requirements for everyday changes. When these procedures are needed, maintainers should consult `docs/_internal/release-windows.md` and the other `_internal/` runbooks; do not record local providers, credentials, or real upgrade steps in this public contribution guide.

The public release contract only requires the version, the Git tag, and `release-notes/vX.Y.Z.md` to match and `bun run check:release-surface` to pass.
