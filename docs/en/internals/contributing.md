---
title: Contributing and Quality Gates
nav_title: Contributing
description: Local setup, impact checks, quality gates, testing requirements, and the PR workflow.
order: 14
---

# Contributing and Quality Gates

This guide explains how to install, develop, test, and run the local quality gates before opening a PR. The goal is to help maintainers and contributors answer one question before review: did this change break the core Coding Agent workflow?

## Setup

Install root dependencies with Bun:

```bash
bun install
```

If your change touches `desktop/`, also install desktop dependencies:

```bash
cd desktop
bun install
```

If your change touches `adapters/`, or if you run `check:adapters` / `check:native`, install adapter dependencies:

```bash
cd adapters
bun install
```

Do not commit local artifacts such as `artifacts/quality-runs/`, `node_modules/`, or `desktop/node_modules/`.

### Common development commands

```bash
bun run start                                   # or ./bin/echoflow-code: run the CLI locally
SERVER_PORT=3456 bun run src/server/index.ts    # local API/WebSocket server used by desktop/
cd desktop && bun run dev                       # desktop frontend in Vite
cd desktop && bun run test                      # desktop Vitest suites
cd desktop && bun run check:electron            # type-check the Electron host and rebuild bundles
cd desktop && bun run build                     # type-check and produce a production build
cd adapters && bun run test                     # all adapter tests; test:<platform> for one platform
bun run docs:dev                                # docs preview; bun run docs:build to build
```

For Windows x64 packaging use `cd desktop && bun run build:windows-x64`; it requires Bun/Bunx and Visual Studio 2022 Build Tools with the Desktop development with C++ workload.

## Gate Tiers

| Tier | Trigger | What runs | Constraint |
| --- | --- | --- | --- |
| Local | manual | The narrowest relevant tests, then whatever `bun run check:impact` selects | seconds |
| PR (required) | `pull_request` | The deterministic lanes the impact report selects, including `check:agent-flow` | no model, no provider, no secret, runs on an untrusted fork |
| Full sweep | Maintainer-triggered (`workflow_dispatch`) | Every deterministic lane with no path selection, plus module-graph health and `check:desktop-ui-smoke` | still no model, no secret |
| Release | maintainer-run `bun run quality:release` (**not** `release-desktop.yml`) | Everything above, plus native/packaging smoke and maintainer-authorized live provider baselines | live models only here, only with explicit authorization |

Note: `release-desktop.yml` deliberately runs no quality gate — tagging must not be blocked by `bun run verify`, and `scripts/pr/release-workflow.test.ts` guards that decision. Release-time evidence therefore comes from the PRs that were merged, plus whatever full sweeps the maintainer ran, plus the manual `quality:release`. The full sweep is deliberately not scheduled: spending ~90 minutes of CI is a decision, not a default, and `pr-quality-workflow.test.ts` fails if a `schedule:` is added back.

The split follows from what each tier can prove. A per-PR gate only ever covers what the diff reaches, so it is structurally blind to checks no recent PR selected and to failures that only appear when the whole suite runs together — the full sweep closes both, when the maintainer asks for it. Live model quota is spent only at release time, so every contributor can pass the required gate with no provider at all.

## Path-Aware PR Checks

First ask the repository which deterministic checks match the changed paths:

```bash
bun run check:impact
```

Selection is **import-aware**. Besides the changed paths themselves, the router adds every surface that imports a changed file (`scripts/pr/module-graph.ts`). This closes holes that prefix-only routing could not see: editing `src/shared/modelReasoning.ts` now selects `check:desktop` because `desktop/src/lib/runtimeSelection.ts` imports it, and editing `desktop/src/lib/browserSafePort.ts` now selects `check:native` because `desktop/electron/services/sidecarManager.ts` imports it while `desktop/tsconfig.json` does not compile `desktop/electron/`. The report's `## Cross-surface impact` section names the importer behind each extra check.

The graph only widens *check selection*. Areas, labels, and every blocking rule stay scoped to the actual diff, so editing a hub file never demands tests for files you did not touch. If the graph cannot be built, the run selects every surface and says so rather than silently reverting to prefix routing.

## Deterministic Agent Gate (no model required)

```bash
bun run check:agent-flow       # real server + real WebSocket + mock CLI
bun run check:desktop-ui-smoke # real desktop UI + real permission dialog + mock CLI
```

Neither needs a provider, credentials, or the public network. `check:agent-flow` covers session creation, runtime selection, first-turn streaming, tool execution, permission allow/deny, tool failure, API error, interrupt, reconnect permission replay, and session recovery. `check:desktop-ui-smoke` clicks the real Allow button in a real browser; it needs `agent-browser` and installed desktop dependencies and skips with a printed reason when either is missing.

`agent-browser` belongs to that committed lane (which runs headless on Linux CI) and to the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts. For ad-hoc browser work (manual verification, screenshots, exploratory UI checks), use the `ego-browser` skill instead; do not treat `agent-browser` as a general-purpose browser tool just because it appears in the repository.

Every quality-gate lane that boots the real server runs against a sandbox config dir (`scripts/quality-gate/sandbox.ts`) and fails if it wrote to the developer's real `~/.claude`.

Run the selected focused commands while developing. For PR-ready or full validation, use the unified entrypoint directly without first running all of its lanes separately:

```bash
bun run verify
```

`bun run verify` is equivalent to `bun run quality:pr`. It runs the selected policy, desktop, server, adapter, native, provider contract, chat contract, persistence, docs, and coverage lanes, without calling real models. Small external contributions do not need to run unrelated modules locally; GitHub CI runs the exact path-aware gate again.

The main quality report embeds the current test scope, result matrix, coverage summary, and links to the full coverage/JUnit/log artifacts:

```text
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/report.json
artifacts/quality-runs/<timestamp>/junit.xml
artifacts/quality-runs/<timestamp>/logs/*.log
artifacts/coverage/<timestamp>/coverage-report.md
artifacts/coverage/<timestamp>/coverage-report.json
```

Include the commands you ran and the report summary in your PR description. `quality:pr` / `quality:verify` remain available for contributors who prefer explicit quality command names, but docs and AI prompts should prefer `bun run verify`.

The coverage gate does four things: measures source-only coverage, enforces the baseline ratchet, reports target gaps against 75-80%+ maintained-area goals, and enforces changed-line coverage for new or modified executable production lines. The current baseline lives in `scripts/quality-gate/coverage-baseline.json`, and CI compares against the base branch baseline when available. New PRs must not lower coverage beyond the allowed window. Changes to `coverage-baseline.json` or `coverage-thresholds.json` require the maintainer-only `allow-coverage-baseline-change` label. Quarantine is reserved for maintainer baseline/release tracking and must never hide deterministic provider/chat contract tests; the normal PR gate does not depend on quarantine to pass.

## AI Coding Agent Fix Loop

Completion means implementing the intended behavior, running the checks required for the current diff, and fixing failures caused by the change. Scoped local edits, isolated fixture checks, and related repairs do not need approval at each step. Commits, pushes, releases, repository settings, and live-model quota still follow the root `AGENTS.md` authorization boundaries.

Use `bun run check:impact` to determine the check scope. Run the selected checks for ordinary tasks; use `bun run verify` directly for PR-ready/full validation without first running all of its lanes separately. During repairs, rerun affected focused checks, then complete the evidence needed for the final diff. Do not repeat passing checks without subsequent edits or unresolved risks. Report unrelated existing failures or environment blockers instead of expanding the change merely to make everything green.

When a check fails, consult the evidence for that failure:

| Failure | Evidence and action |
| --- | --- |
| Failed lane | Summary / Result Matrix in `artifacts/quality-runs/<timestamp>/report.md` and `logs/<lane>.log` |
| Path-aware PR checks | Check same-area tests, CLI core, and coverage policy; maintainer overrides require an explicit decision |
| Coverage gate | `artifacts/coverage/<timestamp>/coverage-report.md` or `.json`; address `changedLines.failures` / `failures`, while `targetGaps` signal technical debt |
| Build, types, lint, docs, or native | Fix issues caused by the change identified in the relevant log and rerun affected checks |

Claim PR-ready/full validation only after `bun run verify` passes for the final diff. Do not lower coverage baselines/thresholds or rewrite test expectations to hide failures.

## Agent Toolset

The default toolset is five plugins covering design, planning, review, and minimal implementation. They accelerate the workflow but **do not replace the gates**: `bun run check:impact`, the surface checks, `bun run check:policy`, and `bun run verify` remain the only authority. Where a plugin disagrees with this repository, `AGENTS.md` and this document win.

| Plugin | Purpose | Entry point |
| --- | --- | --- |
| `superpowers` | The main flow: clarify requirements → implementation plan → batched execution with review checkpoints | `/superpowers:brainstorm`, `/superpowers:write-plan`, `/superpowers:execute-plan`; review with `@code-reviewer` |
| `ponytail` | The minimal-code ladder: ask whether the code is needed, then reuse, standard library, native features, and only then the least code that works | `/ponytail-review` on the current diff; `/ponytail-audit` across the repo |
| `frontend-design` | Interface design quality for the desktop app and docs site, avoiding generic output | Triggered on demand for UI design work |
| `typescript-lsp` | TypeScript/JavaScript go-to-definition, find-references, and diagnostics | Always on |
| `claude-model-router-hook` | Routes model tiers by task class and constrains the model a spawned sub-agent uses | Always on; configured via `.claude/model-router.json` |

`superpowers`, `typescript-lsp`, and `frontend-design` come from the official Claude Code marketplace; the other two need their own marketplace added first:

```bash
/plugin marketplace add tzachbon/claude-model-router-hook
/plugin install claude-model-router-hook@claude-model-router-hook
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

The mapping from task class (mechanical, implementation, debugging, architecture, cross-system) to model tier is defined and maintained by `claude-model-router-hook` itself — do **not** copy that table into repository docs, and do not rewrite the plugin's classification. Set the Agent tool's `model` to match the task class instead of defaulting every sub-agent to the top tier.

`ponytail` is how the "smallest change" bullet under Engineering Behavior Guardrails is enforced: when a diff outgrows its own proof, run `/ponytail-review` to find what can be deleted. Its `ultra` level challenges requirements themselves, while fork identity, provider policy, persistence compatibility, and the release flow are non-negotiable in `AGENTS.md` — do not use any level to challenge those.

## Regression Test Design

A same-area test file is the gate's minimum signal; tests also need to prove behavior:

- **Drive state transitions.** When testing a transition, produce the state through `handleServerMessage`, real store actions, or user events instead of directly assigning the expected result with `setState`. Direct state setup is still appropriate for fixture initialization.
- **Assert behavioral invariants.** Check which session or model the displayed data belongs to, rather than copying today's screen text. Test inputs and expectations must follow the intended behavior contract; do not change them to hide failures.
- **Cover both dropping and keeping.** Test what a deduplication, merging, or filtering rule should discard and retain. Message deduplication in particular must reject replays and preserve legitimate repeats; forward upstream identities such as `uuid` / `toolUseId` instead of guessing identity from text.
- **Test the connections across boundaries.** Separate green server, store, and component tests do not prove that messages drive the UI. Exercise risky connections through real entry points and do not mock the module under test.

Coverage reports have limits: `desktop/vitest.config.ts` collects only `src/**`, excluding the Electron main process. The repository's current Bun coverage baseline has zero branch records, and `coverage.ts` displays `0/0` as 100%; that does not prove all branches were exercised. Inspect current configuration and reports instead of using historical coverage figures as evidence for a new change.

### Regression case law

The directions above are the rules; these are regressions that actually shipped. The concrete evidence is kept so you can judge whether the problem in front of you is the same kind.

- **Drive the transition; never hand-write the state it produces.** Component tests in `desktop/src` call `setState` 744 times and a real store action 3 times. State you assigned is self-consistent by construction and cannot expose "transition A did not update B" — which is where these bugs live. Use `handleServerMessage`, store actions, and real user events.
- **Assert the invariant, not today's output.** `2262973a4` shipped `expect(getByText('deepseek-reasoner'))` at a moment when the screen showed another model's number: it wrote the bug in as a passing assertion, and the next fix had to invert that exact line. Ask what must be true after this step, not what it prints now.
- **Cover both directions of any rule that drops or merges something.** The replay guard was tested for "a replay must be discarded" and never for "a genuine repeat must be kept", so it shipped dropping real replies.
- **Test the join, not each end.** Server, store, and component each had a test for `runtime_config_applied`; nothing crossed them, and deleting the term that joins them (`ChatInput.tsx` `refreshNonce`) left 314 tests green.
- **Never retune an existing test's inputs to keep it green.** `128f75ab5` changed five tests' props (`messageCount={0}` → `{1}`) instead of accepting that they described states a real session cannot reach. If a test only passes after you edit its inputs, the test was describing the implementation.

### Coverage References

External reference points:

- [Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html): 60% acceptable, 75% commendable, 90% exemplary; 90% is a reasonable lower threshold for changed/per-commit coverage.
- [Microsoft Visual Studio / Azure DevOps docs](https://learn.microsoft.com/en-us/visualstudio/test/using-code-coverage-to-determine-how-much-code-is-being-tested): teams typically target about 80%, typical project requirements can be 75%, and generated code may be relaxed.
- [ChromiumOS EC](https://chromium.googlesource.com/chromiumos/platform/ec/+/main/docs/code_coverage.md): new or changed lines require at least 80% coverage.

## Maintaining Agent Instructions

Keep project constraints and entry points in root `AGENTS.md`, specialized rules near the code, and explanations/examples in on-demand documentation. Shared guidance must work for contributors using different models. Revisit duplicated workflows and broad stopping conditions as capabilities change, while preserving current safety and CI contracts. This cleanup draws on Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862) (2026-09-04).

The "How This Contract Is Maintained" section of `AGENTS.md` turns that principle into an executable rule: a rule stays in the root contract only when all three hold — it changes a direction decision, violating it causes irreversible loss, and it cannot be read from the code. Otherwise it moves here and leaves a one-line pointer. When a trigger fires (a top-level directory or gate added or removed, a `ChangeArea` change, a workflow change, a referenced file moved), fix the contract in the **same commit**. `scripts/pr/quality-contract.test.ts` checks the byte budget and checks that the contract's pointers still resolve to real content — re-inlining a copy of what was moved out after the fact is caught by that assertion.

Repository skill descriptions should identify the applicable task and necessary distinctions; put operational detail in the body or referenced files. Use a short router for multiple workflows and avoid broadening triggers just to match more keywords. Model defaults, tool formats, and compaction behavior describe product implementation, so check the source before updating those docs.

## Feature Quality Contract

Every feature, bugfix, and behavior change must ship with verifiable evidence. This rule applies to human authors and AI coding agents:

- Name the changed surface first: `desktop`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
- Executable JS/TS production changes must include same-area tests in the same PR. `scripts/pr/change-policy.ts` checks four areas separately: `desktop/src/`, `src/server/`, the rest of `src/`, and `adapters/`, unless a maintainer explicitly applies `allow-missing-tests`. Non-executable files such as prose or CSS do not independently require new tests under this rule; all impact-selected checks still apply.
- Pure logic needs unit tests. Server/API/provider/runtime behavior needs API or request-shape tests. Desktop UI/store/API behavior needs Vitest or Testing Library coverage. Cross-boundary user flows through UI, WebSocket, provider proxying, native sidecars, or release packaging need E2E or desktop UI smoke.
- Agent loop, tool execution, provider routing, model selection, file editing, permissions, session resume, and desktop chat changes need mock/fixture tests in PR. Run live smoke or baseline only after deterministic checks pass and a maintainer explicitly authorizes quota use. Finding a local provider is not authorization; report when live checks were not run.
- Coverage is part of the feature. This project follows a Google/Microsoft-style policy: generated/build output is not counted as product coverage, maintained product areas should move toward 75-80%+, and new or changed executable production lines must pass the changed-line coverage threshold in `coverage-thresholds.json`.
- Do not lower `coverage-baseline.json` or `coverage-thresholds.json` just to pass the gate; real baseline/threshold changes require `allow-coverage-baseline-change` and a reason. Legacy low-coverage areas are debt; new PRs must leave touched areas better than they found them.
- The PR description must record changed files, tests added, coverage report path, E2E/live report path or blocker, and remaining risk.

## Local Pre-Push Reminder

push no longer runs a local quality gate. Run checks manually when needed:

```bash
bun run quality:push
```

`bun run quality:push` reuses the PR gate impact, policy, and path-aware checks, but skips the expensive coverage lane by default; full coverage remains in `bun run verify`, `bun run quality:pr`, and CI.

You can still install the local pre-push hook, but it only prints a non-blocking reminder and never blocks `git push`:

```bash
bun run hooks:install
```

Maintainers with a trusted repository environment and model quota can run real provider smoke and desktop agent-browser smoke manually:

```bash
bun run quality:providers
bun run quality:smoke -- --provider-model minimax:main:minimax-main
```

To run the full live baseline, use:

```bash
bun run quality:gate --mode baseline --allow-live --provider-model minimax:main:minimax-main
```

## PR CI Merge Gate

`.github/workflows/pr-quality.yml` runs for PR `opened`, `synchronize`, `reopened`, `ready_for_review`, `labeled`, and `unlabeled` events. `scope-plan` installs no dependencies and only produces the stable impact plan. `policy-enforcement` installs the frozen dependency graph independently and runs policy, so a policy failure cannot swallow product-test results. Product jobs depend only on `scope-plan` and select desktop, server, adapter, native, provider contract, chat contract, persistence, docs, and coverage lanes by path. The final `pr-quality-gate` validates every result strictly: selected jobs must succeed, unselected jobs must be skipped, and cancelled or missing results cannot be mistaken for success.

Repository settings should protect `main` with GitHub branch protection / rulesets and require the `pr-quality-gate` status check. CODEOWNERS requires maintainer review for workflows, quality policy, and high-risk provider/WebSocket boundaries. The local hook only reminds; the PR gate is what blocks low-quality merges.

## Area-Specific Checks

Run the checks that match the files you changed:

```bash
bun run check:server      # Server API, WebSocket, providers, sessions, and related tests
bun run check:desktop     # Desktop lint, Vitest, and production build
bun run check:adapters    # IM adapter tests
bun run check:native      # Desktop sidecars, Electron host, and package-smoke checks
bun run check:provider-contract # Offline provider/runtime/proxy contract tests
bun run check:chat-contract     # WebSocket, session, and desktop chat-store contracts
bun run check:persistence-upgrade # Persistence migrations and old-fixture compatibility
bun run check:docs        # Isolated install, build, and validation for the site/ React docs
bun run check:quarantine  # Maintainer baseline/release quarantine audit
bun run check:coverage    # Root, desktop, and adapter coverage reports plus ratchet enforcement
```

Focused tests are the normal development loop. Run `bun run verify` locally when claiming PR-ready/full validation; hosted CI still executes every selected required lane.

Executable JS/TS production changes must include matching tests. See the Feature Quality Contract above and `scripts/pr/change-policy.ts` for area boundaries; missing same-area tests block the change unless a maintainer applies `allow-missing-tests`. Coverage baseline/threshold changes are also blocked unless a maintainer applies `allow-coverage-baseline-change`.

## Live Model Baseline

`quality:baseline` runs real Coding Agent tasks: it starts the local server, creates isolated fixtures, asks a model through chat to fix code, runs tests, and saves transcripts, diffs, verification logs, and a report. It also runs provider live smoke: saved or active OpenAI-compatible providers validate connectivity, proxy conversion, and streaming proxy behavior; env-only provider smoke validates upstream connectivity and the transform pipeline.

The default baseline command does not call real models:

```bash
bun run quality:baseline
```

To actually call models, pass `--allow-live` and choose a local provider.

First list your local providers and copyable selectors:

```bash
bun run quality:providers
```

Example output:

```text
Saved providers:
  MiniMax
    selector: minimax
    main: MiniMax-M2.7-highspeed
      --provider-model minimax:main:minimax-main
```

Copy one of the listed values:

```bash
bun run quality:gate --mode baseline --allow-live --provider-model minimax:main:minimax-main
```

To run only provider smoke plus desktop agent-browser smoke, use:

```bash
bun run quality:smoke --provider-model minimax:main:minimax-main
```

You can run multiple models in one pass:

```bash
bun run quality:gate --mode baseline --allow-live \
  --provider-model codingplan:main:codingplan-main \
  --provider-model minimax:main:minimax-main
```

Provider selectors come from the providers saved in your local desktop app under Settings > Model settings. Contributors do not need the maintainer's provider UUIDs or vendor accounts. They can add their own provider locally, run `bun run quality:providers`, and choose their own model.

If you do not have a saved provider, you can run one unsaved provider smoke with environment variables:

```bash
QUALITY_GATE_PROVIDER_BASE_URL=https://example.com \
QUALITY_GATE_PROVIDER_API_KEY=... \
QUALITY_GATE_PROVIDER_MODEL=model-id \
QUALITY_GATE_PROVIDER_API_FORMAT=openai_chat \
bun run quality:gate --mode baseline --allow-live
```

## When To Run The Baseline

After deterministic contract/E2E checks pass, a trusted maintainer should run the live baseline for changes touching:

- Desktop chat, session resume, WebSocket, or the CLI bridge
- Provider, model, or runtime selection
- Permissions, tool calls, file edits, and task execution
- agent-browser smoke, Computer Use, Skills, or MCP
- Release preparation or broad cross-module refactors

External PRs from forks do not receive repository secrets, and contributors are not expected to pay for model calls. Record `live model: not run (untrusted fork / no provider)` in the PR. A maintainer should add live evidence before merging or releasing high-risk changes; missing live evidence must not make deterministic PR lanes flaky.

## Release Gate

Before a release, run release mode:

```bash
bun run quality:gate --mode release --allow-live --provider-model <selector>:main
```

Release mode composes PR checks, baseline catalog validation, live baseline cases, provider smoke, native checks, and current-platform canonical release `package-smoke --package-kind release`. Reports are written to `artifacts/quality-runs/<timestamp>/`. `release-desktop.yml` builds and publishes artifacts without running `bun run verify`. Pre-release quality evidence comes from PR gates and explicitly run maintainer full checks and release gates.

In release mode, live lanes are not allowed to be silently skipped. Missing providers, model quota, or external account access will fail the gate and must be recorded as a release blocker.

## Releases and Auto-Update

`desktop/package.json` is the single source of the desktop version number. A real release requires the version, the Git tag, and `release-notes/vX.Y.Z.md` to match exactly.

In-app updates are driven by `electron-updater`, with artifacts hosted on GitHub Releases:

| Platform | Install / update target | Metadata |
|---|---|---|
| macOS arm64 / x64 | `dmg` for first install, `zip` for Squirrel.Mac updates | `latest-mac.yml` |
| Windows x64 / ARM64 | NSIS `.exe` | `latest.yml` |
| Linux x64 | `.AppImage` for updates, `.deb` for manual install | `latest-linux.yml` |
| Linux arm64 | `.AppImage` for updates, `.deb` for manual install | `latest-linux-arm64.yml` |

The release workflow generates `latest*.yml` inside each platform matrix job, renames colliding metadata to `latest-<platform>.yml`, and finally lets `scripts/release-update-metadata.ts` merge them back into the standard filenames electron-updater expects. Do not change this so each matrix job publishes the GitHub Release directly — the metadata files would overwrite each other.

### Signing secrets

macOS signing and notarization depend on these GitHub Actions repository secrets:

```text
MACOS_CERTIFICATE
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`MACOS_CERTIFICATE` is the base64 content of a Developer ID Application `.p12`. The project does not ship a `.pkg`, so no Developer ID Installer certificate is needed.

Windows signing is optional:

```text
WINDOWS_CERTIFICATE
WINDOWS_CERTIFICATE_PASSWORD
```

Auto-update still works without Windows signing; users may just see a SmartScreen prompt.

### Pre-release checks

```bash
bun run scripts/release.ts <version> --dry
bun test scripts/pr/release-workflow.test.ts scripts/release-update-metadata.test.ts scripts/quality-gate/package-smoke/index.test.ts
bun run check:policy
```

Confirm `release-notes/v<version>.md` exists before running `bun run scripts/release.ts <version>` for real.

### Verify one real update path

Every release should be verified by upgrading from the previous stable build at least once:

1. Install the previous stable release from GitHub Releases.
2. Push the tag and let the `Release Desktop` workflow finish green.
3. Open the old build and wait for the startup check, or check for updates manually in settings.
4. Confirm the new version is offered, then install and restart.
5. After restart, confirm the version in About, and that providers, sessions, skills, agents, memories, custom pets, and a custom data directory all still work.
6. Confirm historical attachment context, subagent details, and task state restore correctly; open a pet window and check the overlay and current-session navigation.

Platforms differ in what matters: on macOS confirm the release job used the signed artifacts and the launch-policy check passed; on Windows confirm `latest.yml`, `.exe`, and `.exe.blockmap` are all in the release assets, and remember that a SmartScreen prompt on an unsigned build does not mean the updater failed; on Linux verify auto-update through the AppImage, since `.deb` ships as a manual installer only.

## Upstream Sync (maintainer)

The fork tracks upstream **releases**, not upstream's moving tip: upstream `main` is a development branch, and only a release tag is something the fork can version against. Syncing is high-risk; the non-negotiable constraints live in `AGENTS.md` under "Upstream Sync Direction", and this section is the full procedure.

### Three commands

| Command | Effect |
| --- | --- |
| `bun run upstream:check` | Read-only probe. Reports the verdict, changes nothing. |
| `bun run upstream:resolve` | Fetches the sync branch and merges `main` into it locally, leaving conflicts in the tree. |
| `bun run upstream:sync` | Pushes the sync branch so the PR can be opened. |

### Automated path (preferred)

`.github/workflows/upstream-sync.yml` tracks upstream releases and opens a `sync/upstream-vX.Y.Z` PR for each new version:

1. **Review the sync PR**: start with the changed-files list in the PR description.
2. **Resolve conflicts in place**: if the PR is a draft with conflicts listed, fetch the sync branch and merge `main` into it locally with `bun run upstream:resolve`. Conflicts stay in the working tree and are not committed.
3. **Apply the conflict workflow below** (manual path steps 6-11), then `git push origin sync/upstream-vX.Y.Z`.
4. **Merge the PR**: once the sync branch is clean and verified, merge into `main` via GitHub's merge button or a fast-forward merge locally.

The automation fetches upstream releases (not `main`) into `refs/remotes/upstream-release/`, never polluting the local tag namespace. It refuses to overwrite a sync branch holding different content, so manual resolutions survive later scheduled runs.

### Manual path

Use this when the automation is unavailable or a non-release sync is needed:

1. Start from a clean `main` worktree and inspect the configured remotes.
2. Fetch `origin` normally. Fetch upstream branches without tags: `git fetch upstream +refs/heads/*:refs/remotes/upstream/* --prune`. Upstream release tags can share names with fork release tags.
3. Compare `main...origin/main` and `main...upstream/main` before merging.
4. Merge upstream with a merge commit; **do not** rebase public `main`.
5. Plan the merge ("merge upstream, keep the fixes, replace the brand") with `/superpowers:brainstorm` and `/superpowers:write-plan`; use `@code-reviewer` on conflicted files, high-risk files, and provider-policy decisions.
6. **Write one complete conflict matrix before editing** (see below), then resolve the whole matrix in one pass. Do not discover and patch conflicts one at a time.
7. Resolve file contents intentionally; **never** apply blanket `--ours` or `--theirs`. Preserve fork identity and provider policy, sponsor-free public docs, persistence compatibility, the Electron release flow, and the quality gates.
8. Audit public identity after every merge: README, docs, release notes, package metadata, diagnostics export, signing/privacy pages, updater links, and desktop About/profile defaults must not identify NanmiCoder/阿江 or `cc-haha` as the current EchoFlow author, maintainer, contact, or product.
9. Conflict analysis and worktree edits may be automated, but `git add` and `git commit` require explicit developer confirmation. **Never** stage or commit a conflict resolution automatically.
10. After writing resolutions, have `@code-reviewer` review them and run `bun run check:policy` before asking the developer to stage or commit. If a build or type check fails, locate it through the "AI Coding Agent Fix Loop" section, rerun the narrow failed check, and run `bun run verify` before claiming push-readiness.
11. Push `main` before or together with release tags, then verify the remote branch and tag targets.

### Conflict matrix template

One row per file, written in full before you edit anything:

| File | base / ours / theirs behavior | Final decision | Validating command |
| --- | --- | --- | --- |
| `package.json` | Upstream changes version and deps, ours holds fork metadata | `ours` | `bun run check:policy` |
| `LICENSE` | Upstream changes the copyright line | `ours` | manual check |
| `providerPresets.json` | Upstream adds provider presets | `manual`, ruled one by one | `bun run check:provider-contract` |
| `desktop/src/stores/chatStore.ts` | Upstream changes session-title logic, ours holds brand copy | per-field: keep fork branding in `title`, take upstream logic in `body` | `cd desktop && bun run test` |

`providerPresets.json` is always `manual`. Brand-owned files (`package.json`, `LICENSE`, `README.md`, `desktop/package.json`, `AGENTS.md`) are `ours`, with a separate decision about whether upstream logic needs to come along.

### Worked example: the selective v0.6.4 merge

This merge ran the four-phase flow and is the reference for selective adoption. Branch `merge/upstream-v0.6.4-selective`, snapshot tag `pre-merge-v0.6.4-snapshot`, estimated 12-18 hours.

- **Strategy**: cherry-pick plus manual merge, not a wholesale merge.
- **Phase 2 selected 6 upstream commits** (all landed in `main`, under new hashes after cherry-pick): Agent Teams inheriting the lead model; teammate permission prompt routing; session list no longer scanning every JSONL; restored window dragging; the test-connection button collapse; and the fold control with context table.
- **The one brand conflict** (`desktop/src/stores/chatStore.ts`) was resolved by per-field choice rather than `--ours` or `--theirs`: keep EchoFlow branding in `title`, take the upstream logic in `body`. It is the clearest statement of the whole sync philosophy.
- **Phase 3 provider decision**: all 7 provider presets added upstream in v0.6.4 were **rejected** (5 were marked `deprecated` upstream, `atlascloud` carried `utm_campaign=cc-haha`, `apismart` was a sponsor), and the EchoFlow API preset upstream had deleted was restored. The conclusion: `providerPresets.json` **did not change at all**.
- **One file landed in the end**: `desktop/build/getProcessInfo.nsh`.

### Version consolidation

When a sync contains multiple upstream releases, do not carry upstream release-note files or upstream version numbers into the fork unchanged. The fork's `desktop/package.json` is the release-version source of truth:

1. Determine the next fork release from the latest **fork** release/tag, not from the upstream tag.
2. Consolidate user-relevant upstream changes into the next fork release note under the fork's version.
3. Increment the fork patch version exactly once per fork release; **do not** create same-named tags merely because upstream `v0.6.4` or `v0.6.5` was merged.
4. Remove upstream-only release-note files after their useful content has been consolidated, unless the maintainer explicitly asks to retain them.
5. Before committing, verify that `desktop/package.json`, the consolidated release note, release scripts, and any tag plan all use the same fork version. If the target version or the file to remove is ambiguous, ask the maintainer before deleting it.

For example, if the fork has not released `v0.5.6`, merge upstream changes into the fork's `v0.5.6` release note and do not introduce upstream `v0.6.x` release notes or tags.

## PR Workflow

1. Create a product branch such as `fix/session-reconnect` or `feat/provider-quality-gate`.
2. Install dependencies and make the change.
3. Add tests for behavior changes.
4. Run focused checks for the affected area.
5. Optional: run `bun run hooks:install` to show a non-blocking reminder before later pushes.
6. Run `bun run verify` if you are claiming PR-ready/full validation.
7. A trusted maintainer runs the live baseline for high-risk changes; external contributors only record why it was not run.
8. In the PR description, include user impact, verification commands, coverage/quality report summary, and known risks.

## FAQ

### Can I run checks without a provider?

Yes. Run the impact report and its selected deterministic checks:

```bash
bun run check:impact
```

`bun run verify` also needs no real model. Only the live baseline does. Maintainers can add a provider in Desktop Settings > Providers, then run:

```bash
bun run quality:providers
```

### What if provider selectors conflict?

If two provider names produce the same selector, `quality:providers` falls back to the provider ID. Copy the `--provider-model ...` value it prints.

### What if a model ID contains a colon?

Prefer role selectors:

```bash
--provider-model custom:haiku:custom-haiku
```

The runner resolves `haiku` to the real model ID from your local provider configuration.
