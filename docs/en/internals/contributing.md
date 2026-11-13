---
title: Contributing and Quality Gates
nav_title: Contributing
description: Local setup, impact checks, quality gates, testing requirements, and the PR workflow.
order: 14
---

# Contributing and Quality Gates

This guide explains how to install, develop, test, and run the local quality gates before opening a PR. The goal is to help maintainers and contributors answer one question before review: did this change break the core Coding Agent workflow?

See [Execution, data, and trust boundaries](./execution-boundaries.md) for durable rules on product capabilities, execution binding, persistence, and external input. This page owns the check workflow and test design; task progress, audit lists, and temporary validation records are not published as implemented architecture.

## Setup

Before verification, the operator must perform a preflight: read the expected Bun version from root `package.json`'s `packageManager`, record the executable actually resolved and its version, and check that nested processes launched from the repository resolve the same version; checking a shell alias alone is insufficient. Real binaries installed by version managers are valid; do not reject `mise` / `asdf` directory names. Preserve platform tool paths needed by the selected lanes and test-specific PATH fixtures rather than blindly clearing PATH. Check Node, Rust toolchains, and caches only when selected lanes need them.

Dependency installation and tool/cache preparation below are explicit setup and may need the network; deterministic check execution must not implicitly download missing tools or auto-grant trust. The existing `check:docs` command includes a declared isolated dependency install; distinguish that preparation from the subsequent deterministic build and checks. Report missing prerequisites as `blocked` / `not run` in the handoff with the required setup; automation failures must still exit nonzero, not report success. A common preflight covering every verification entrypoint is not currently implemented; these are operator requirements, not newly enforced checks.

Explicitly install root dependencies with Bun:

```bash
bun install
```

If your change touches `desktop/`, also install desktop dependencies:

```bash
cd desktop
bun install
```

Before your first desktop development run or `check:native`, run `bun run prepare:cloudflared` from `desktop/`. It downloads the pinned official connector, verifies SHA-256, and stages it in the Git-ignored local cache; distributed apps already include it. Native checks only validate and use that cache and do not download it. Cross-platform builds can select a target with `--target-triple`.

Downloads show progress, allow up to 10 minutes per attempt, stop after 60 seconds without progress, and make at most 3 attempts for transient network failures. Build commands use the terminal's `HTTPS_PROXY` / `https_proxy`, not the desktop app's proxy settings. Set your HTTP proxy in the same terminal if needed, for example:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 bun run prepare:cloudflared
```

Replace the example with your proxy address. If this network cannot download the file, download the matching version and platform asset from the official URL in the error, then import it with `CC_HAHA_CLOUDFLARED_ARCHIVE=/absolute/path/to/asset bun run prepare:cloudflared`. Offline imports still require the pinned SHA-256; other versions and unverified executables are rejected.

If your change touches `adapters/`, or if you run `check:adapters` / `check:native`, install adapter dependencies:

```bash
cd adapters
bun install
```

Do not commit local artifacts such as `artifacts/quality-runs/`, `node_modules/`, or `desktop/node_modules/`.

## Gate Tiers

| Tier | Trigger | What runs | Constraint |
| --- | --- | --- | --- |
| Local | manual | The narrowest relevant tests, then whatever `bun run check:impact` selects | seconds |
| PR (required) | `pull_request`, and `push` to `main` after a merge | The deterministic lanes the impact report selects, including `check:agent-flow` and `check:agent-e2e`; coverage is reported, not blocking | no model, no provider, no secret, runs on an untrusted fork |
| Full sweep | `nightly-quality.yml`, daily (19:00 UTC) plus maintainer-triggered | The workflow's configured deterministic checks without path selection, separate macOS Swift checks, and module-graph health; includes `check:desktop-ui-smoke` | no model, no secret; manual `skip_coverage` defaults off, and UI smoke explicitly skips missing dependencies |
| Release | maintainer-run `bun run quality:release -- --allow-live --provider-model <selector>:main` | PR checks, baseline catalog/live, native and current-platform packaging smoke; the full sweep runs separately, not all of its checks are automatically included | live models require explicit maintainer authorization; this is not the publication workflow |

`release-desktop.yml` does not directly invoke `bun run verify`, but it does gate publication: `verify-governance` (`check:policy`, `check:product-identity`, `check:upstream-content`), `verify-runtime` (`check:server`, `check:agent-flow`, `check:adapters`), and `verify-desktop` (`check:desktop`, `check:persistence-upgrade`) feed `release-verify-gate`. `publish-release` depends on both the build matrix and that aggregate gate; any verification group without a successful result prevents publication. Jobs bind to the same release SHA; these checks do not replace complete `verify`, the full sweep, or the manual live release gate. `scripts/pr/release-workflow.test.ts` separately guards the absence of a direct `verify` invocation and the actual publication dependencies. The daily frequency is pinned in `pr-quality-workflow.test.ts`; changing it requires a maintainer decision.

The split follows from what each tier can prove. A per-PR gate only ever covers what the diff reaches, so it is structurally blind to checks no recent PR selected and to failures that only appear when the whole suite runs together — the daily full sweep closes both. Live model quota is spent only at release time, so every contributor can pass the required gate with no provider at all.

## Path-Aware PR Checks

First ask the repository which deterministic checks match the changed paths:

```bash
bun run check:impact
```

Selection is **import-aware**. Besides the changed paths themselves, the router adds every surface that imports a changed file (`scripts/pr/module-graph.ts`). This closes holes that prefix-only routing could not see: editing `src/shared/modelReasoning.ts` now selects `check:desktop` because `desktop/src/lib/runtimeSelection.ts` imports it, and editing `desktop/src/lib/browserSafePort.ts` now selects `check:native` because `desktop/electron/services/sidecarManager.ts` imports it while `desktop/tsconfig.json` does not compile `desktop/electron/`. The report's `## Cross-surface impact` section names the importer behind each extra check.

The graph only widens *check selection*. Areas, labels, and every blocking rule stay scoped to the actual diff, so editing a hub file never demands tests for files you did not touch. If the graph cannot be built, the run selects every surface and says so rather than silently reverting to prefix routing.

When local policy needs an exception decision but lacks a trusted PR author and base branch CODEOWNERS, keep it `blocked`; missing context does not prove approval is missing. Never infer maintainer identity from `git user` or worktree CODEOWNERS, fabricate labels, or use `ALLOW_*` bypasses. Preserve technical check results and wait for verifiable PR/base context before drawing a governance conclusion.

## Deterministic Agent Gate (no model required)

```bash
bun run check:agent-flow       # real server + real WebSocket + mock CLI
bun run check:agent-e2e        # real server + real CLI agent loop + mock LLM, then recorded-traffic replay
bun run check:agent-replay     # recorded-traffic replay only
bun run check:desktop-ui-smoke # real desktop UI + real permission dialog + mock CLI
```

None of them needs a provider, credentials, or the public network.

`check:agent-e2e` fakes only the model: a loopback Anthropic-compatible endpoint (`scripts/quality-gate/mock-llm/`) is registered as a provider through the same API as the desktop "add provider" form, and the real CLI runs its real agent loop with real tools on a real (throwaway) disk. The scripted model reacts to plain-language prompts the way a model would, so it shares one scenario catalog with `check:agent-flow:live` (`agent-flow/liveScenarios.ts`): the mock proves the plumbing, the live lane proves a real model lands on the same outcome. Mock-only scenarios assert what only the upstream side can see — the tool's output really went back to the model (nonce check), a denied permission reaches the model as an error result, stopping really closes the upstream connection, and the session recovers after an upstream error. When you change the agent loop, tools, permissions, or provider wiring, add a scenario here rather than only a unit test.

A hand-written mock can only stream what its author imagined a model sends: fixed usage, tool input in one piece, no thinking, no OpenAI format. So `check:agent-e2e` also runs a replay lane (`scripts/quality-gate/replay/`). A maintainer runs each scenario once against real DeepSeek Flash and commits the recorded upstream traffic as `cassettes/*.json`; CI serves it back to the real server and real CLI with no network and no credentials. What it replays is the real shape: thinking with signatures, tool input split across many fragments (Grep/Read/Edit/Bash), several tools called in one reply, failed tool calls the model recovers from, large command output, a subagent's own tool loop (also two subagents in parallel), a project MCP server's tool, an image attachment (recorded with DeepSeek Flash's vision variant), an agent team from the lead's plan through approval, two members working in turn, their reports, and shutdown, automatic compaction in a long conversation as well as `/compact`, a stream cut short by the user's stop, a Chinese conversation, and OpenAI Chat chunks through the server's proxy (with reasoning and an interrupt).

- **Matching**: requests take recorded interactions in order, per queue. Each agent loop (the main agent, a subagent, a teammate) is its own queue, keyed by the first user message that started it, matched strictly on model, stream mode, the last message's role, the user's text, and whether the tool results answer exactly the previous reply's tool calls (parallel tools return in completion order, so only the set is compared). A mismatch returns a 400 `replay_mismatch` and writes a field-level diff to `artifacts/agent-e2e/replay/<format>/<id>.report.json`. Tool-less side calls such as a session title are replayed when recorded and otherwise get a placeholder reply, without failing.
- **Run-specific values**: the throwaway work dir, the sandbox config dir, the project's directory name, session ids, the date, and the temp dir are stored as placeholders such as `{{WORK_ROOT}}` and expanded for each run, also when a path was streamed across several fragments. Values the app mints from the clock that a reply must quote back verbatim (a teammate shutdown request id) are stored as learned slots such as `{{V1}}`: a replay learns this run's value from the first request that carries it and fills it into later replies. Message batching in an agent team depends on timing, so that scenario replays the recorded model latency and stream timing; the others replay at a compressed pace.
- **Drift**: a changed tool list or `max_tokens` that still replays is noted in `drift.md`, not failed. The system prompt and tool schemas carry the OS, shell, and date, which differ between the recording machine and CI, so they are not compared.
- **Re-recording**: when behaviour really changed (a prompt edit sends the model down a different tool path), run `bun run quality:record-cassettes -- --allow-live --only <id>` locally. It reads the key of the DeepSeek provider saved in the desktop app and keeps it in the recording proxy's memory; the sandbox gets a fake key. Each new cassette is replayed once as a self-check, and a recording containing the key, the real home path, or a temp-dir path is rejected. Recording spends real quota and never runs in CI.

 `check:agent-flow` covers session creation, runtime selection, first-turn streaming, tool execution, permission allow/deny, tool failure, API error, interrupt, reconnect permission replay, and session recovery. `check:desktop-ui-smoke` clicks the real Allow button in a real browser; it needs `agent-browser` and installed desktop dependencies and skips with a printed reason when either is missing.

`agent-browser` belongs to that committed lane (which runs headless on Linux CI) and to the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts. For ad-hoc browser work (manual verification, screenshots, exploratory UI checks), use the `ego-browser` skill instead; do not treat `agent-browser` as a general-purpose browser tool just because it appears in the repository.

Every quality-gate lane that boots the real server runs against a sandbox config dir (`scripts/quality-gate/sandbox.ts`) and fails if it wrote to the developer's real `~/.claude`.

Run the selected focused commands while developing. For PR-ready or full validation, use the unified entrypoint directly without first running all of its lanes separately:

```bash
bun run verify
```

`bun run verify` is equivalent to `bun run quality:pr`. It runs the selected policy, desktop, mobile, server, adapter, native, provider contract, chat contract, persistence, docs, and coverage lanes, without calling real models. Small external contributions do not need to run unrelated modules locally; GitHub CI runs the exact path-aware gate again.

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

In local `bun run verify`, the selected coverage lane is blocking: a failure fails local verification. Do not apply the hosted PR advisory policy to local runs. Hosted coverage is reported on pull requests but never blocks a merge: `coverage-checks` reports as its own check and is not in `pr-quality-gate`'s `needs`, so the required status does not wait for its ~25 minutes. It still does four things: measures source-only coverage, enforces the baseline ratchet, reports target gaps against 75-80%+ maintained-area goals, and enforces changed-line coverage for new or modified executable production lines. The current baseline lives in `scripts/quality-gate/coverage-baseline.json`, and CI compares against the base branch baseline when available. New PRs must not lower coverage beyond the allowed window. Changes to `coverage-baseline.json` or `coverage-thresholds.json` require the maintainer-only `allow-coverage-baseline-change` label. Quarantine is reserved for maintainer baseline/release tracking and must never hide deterministic provider/chat contract tests; the normal PR gate does not depend on quarantine to pass.

## AI Coding Agent Fix Loop

Completion means implementing the intended behavior, running the checks required for the current diff, and fixing failures caused by the change. Scoped local edits, isolated fixture checks, and related repairs do not need approval at each step. Commits, pushes, releases, repository settings, and live-model quota still follow the root `AGENTS.md` authorization boundaries.

In a shared checkout, assign one writer per file at a time; dependency installs, builds, and full gates run serially under one executor, and readers must not duplicate delegated investigation. On resume, first check existing background tasks and their status, the current candidate, and available evidence; do not blindly replay commands whose side effects may already have completed.

For module iteration, understand the problem before choosing a change: compare expected behavior with actual results, read the module, its callers, existing tests, and relevant logs, and trace the real call chain to locate the cause. Separate observed evidence from hypotheses and unknowns; do not infer defects from filenames or code appearance.

Before editing, define contracts and boundaries: how inputs, outputs, and errors flow; who owns state and when it transitions or persists; who creates, cancels, and releases resources; where permissions are checked across trust boundaries; and which callers, old data, protocols, and user behaviors must remain compatible. For cross-process or execution-engine changes, consult [Execution, Data, and Trust Boundaries](execution-boundaries.md) and carry necessary changes through the call chain without creating hidden execution paths.

Use the evidence to choose preservation, repair, consolidation, redesign, or retirement after verification. Preserve correct implementations with clear responsibilities; repair located defects; consolidate duplicate responsibilities while retaining validation and error handling; redesign only when the existing contract cannot meet the goal. Before retirement, confirm callers and entry points have migrated or are unused, and verify old-data compatibility, state handoff, and resource cleanup. Ageing names or implementation complexity alone do not justify deletion.

Judge quality by intended behavior, clear boundaries, and regression evidence, not mechanical renaming, file splitting, or line counts. Refactor to solve an established problem rather than mixing unrelated structural changes into a fix.

`bun run check:impact` selects checks; it does not prove behavior correct. Run the selected checks for ordinary tasks; use `bun run verify` directly for PR-ready/full validation without first running all of its lanes separately. During repairs, rerun affected focused checks, then complete the evidence needed for the final diff. Do not repeat passing checks without subsequent edits or unresolved risks. Report unrelated existing failures or environment blockers instead of expanding the change merely to make everything green.

Bind verification evidence to a candidate: the full Git SHA, dirty diff, and content fingerprints of relevant untracked source, along with the environment (OS/architecture, tool versions and paths), actual commands, exit statuses, final summaries, and logs; also record SHA-256 for release artifacts. Relevant source, dependency, or environment changes invalidate affected prior evidence. An incomplete run, missing final summary, or unknown background-task state is not `passed`.

The quality runner now captures `candidate.before` / `candidate.after` around lane execution: full HEAD, `indexDiffSha256` for HEAD→index, `worktreeDiffSha256` for index→worktree, and `untrackedSha256` for non-ignored untracked files (sorted by raw filename bytes, including path, permissions, type, and content identity; symlinks record only their target bytes without reading through the link). A read or Git failure marks an endpoint `unknown`, not clean. `candidate.status` is `stable`, `changed`, or `invalid`; `candidate.failures` is separate from lane counts. Changed or unknown candidates fail overall `status` and the CLI exit, with that failure preserved in JSON, Markdown, and JUnit even when all lanes pass.

These fields remain optional in schema version `1` for legacy reports; missing fields do not prove candidate stability. `runtime` records the runner's own name, version, executable, `argv`, platform, and architecture, not inferred child-tool versions. Equal endpoints cannot detect intermediate change-and-restore, and collection is not atomic. There is no automatic cross-run cache or enforced universal preflight; operators still record additional tool versions, package hashes, and platform evidence.

Lane `signalCode` is persisted in logs and reports. An executor exception appends error evidence, preserves existing partial logs, records a failed lane, and continues later lanes; a log's existence alone does not prove completion. Forced termination of the runner itself or artifact-write failure cannot guarantee a final report.

When a check fails, consult the evidence for that failure:

| Failure | Evidence and action |
| --- | --- |
| Failed lane | Summary / Result Matrix in `artifacts/quality-runs/<timestamp>/report.md` and `logs/<lane>.log` |
| Path-aware PR checks | Check same-area tests, CLI core, and coverage policy; maintainer overrides require an explicit decision |
| Coverage gate | `artifacts/coverage/<timestamp>/coverage-report.md` or `.json`; address `changedLines.failures` / `failures`, while `targetGaps` signal technical debt. Missing test-discovery results, a final summary, or expected LCOV is a collection failure, not proof of a product defect or insufficient coverage; investigate logs without changing existing blocking policy |
| Build, types, lint, docs, or native | Fix issues caused by the change identified in the relevant log and rerun affected checks |

Coverage emits phase start/end events as `[coverage]` JSON. The start event identifies the isolated live `capturePath`; after completion, read the persisted `logPath` and `${logPath}.process.json`, since the temporary capture is normally cleaned up. Process JSON records the command, cwd, timestamps, duration, actual `exitCode` (`null` when unknown), `signalCode`, optional `error`, and the runner's own runtime. Spawn/wait exceptions preserve partial output and diagnostics before cleanup and rethrowing the original exception; do not start duplicate checks just because the final summary has not appeared.

Root coverage preserves its existing instrumentation exception: an ordinary nonzero assertion exit can supply coverage only when test-file discovery/completion, the final summary, and single-process LCOV are complete and available, with a note recorded. The original assertion failures still happened; independent `check:server` enforces correctness. Signals, execution errors, and unknown exits cannot use this exception; a signal fails even with exit 0 or `lcovAvailable: true`. Root records `lcovAvailable` independently of suite success; adapters/desktop do not evaluate that field.

Read changed-line numbers with `changedLines.scope`: it records `strategy`, optional `baseRef` / `diffArgs`, `includes` (committed/staged/unstaged/untracked), and optional `error`, without changing selection or scoring.

| Strategy | Actual comparison | Includes | Excludes |
| --- | --- | --- | --- |
| `explicit-base` | `<base>...HEAD` | committed changes | staged, unstaged, untracked |
| `dirty-worktree` | `HEAD` | staged and unstaged changes | committed branch changes, untracked |
| `branch-fallback` | `origin/main...HEAD` | committed changes | staged, unstaged, untracked |
| `none` | no diff selected | nothing | all change types |

Dirty fallback still triggers only for unstaged tracked changes; staged-only changes may select branch fallback or no diff on main. Dirty coverage is not whole-branch coverage. Failed diff/scope collection is explicitly unknown, but existing empty-fallback scoring is unchanged; zero lines in that case prove neither an absence of changes nor whole-branch compliance.

Claim PR-ready/full validation only after `bun run verify` passes for the final diff. Do not lower coverage baselines/thresholds or rewrite test expectations to hide failures.

## Regression Test Design

For defects, follow **RED → GREEN → refactor**: first add the smallest regression test that reproduces the defect through a real entry point. Run it and confirm it fails because of the intended defect (RED), not an environment or fixture error. Then make the smallest fix that passes it (GREEN), and only then refactor while keeping tests green. If reproduction is unavailable, record the inputs and environment tried, observed results, and evidence gaps. Do not present an always-passing test as a reproduction or claim it proves the defect is fixed.

A same-area test file is the gate's minimum signal; tests also need to prove behavior:

- **Drive state transitions.** When testing a transition, produce the state through `handleServerMessage`, real store actions, or user events instead of directly assigning the expected result with `setState`. Direct state setup is still appropriate for fixture initialization.
- **Assert behavioral invariants.** Check which session or model the displayed data belongs to, rather than copying today's screen text. Test inputs and expectations must follow the intended behavior contract; do not change them to hide failures.
- **Cover both dropping and keeping.** Test what a deduplication, merging, or filtering rule should discard and retain. Message deduplication in particular must reject replays and preserve legitimate repeats; forward upstream identities such as `uuid` / `toolUseId` instead of guessing identity from text.
- **Test the connections across boundaries.** Separate green server, store, and component tests do not prove that messages drive the UI. Exercise callers and dependencies through real entry points and assert the final observable behavior; do not mock the module under test.
- **Verify failure and recovery.** Cover errors, timeouts, cancellation, retries, or reconnects according to the change's risks. Assert post-failure state and resource cleanup, continued usability after recovery, and that accepted side effects are not repeated or permission boundaries bypassed.
- **Preserve legacy compatibility when behavior changes.** Add compatibility evidence when the change affects legacy key, path, or marker behavior; ageing names alone do not justify deletion. For migrations, use old fixtures to test retries after partial failure and that, after a successful migration, preferences deliberately cleared by the user are not resurrected from old data on restart. These are test requirements, not a claim that a product defect has been fixed.

Coverage reports have limits: `desktop/vitest.config.ts` collects only `src/**`, excluding the Electron main process. The repository's current Bun coverage baseline has zero branch records, and `coverage.ts` displays `0/0` as 100%; that does not prove all branches were exercised. Inspect current configuration and reports instead of using historical coverage figures as evidence for a new change.

### Coverage References

External reference points:

- [Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html): 60% acceptable, 75% commendable, 90% exemplary; 90% is a reasonable lower threshold for changed/per-commit coverage.
- [Microsoft Visual Studio / Azure DevOps docs](https://learn.microsoft.com/en-us/visualstudio/test/using-code-coverage-to-determine-how-much-code-is-being-tested): teams typically target about 80%, typical project requirements can be 75%, and generated code may be relaxed.
- [ChromiumOS EC](https://chromium.googlesource.com/chromiumos/platform/ec/+/main/docs/code_coverage.md): new or changed lines require at least 80% coverage.

## Maintaining Agent Instructions

Keep project constraints and entry points in root `AGENTS.md`, specialized rules near the code, and explanations/examples in on-demand documentation. Shared guidance must work for contributors using different models. Revisit duplicated workflows and broad stopping conditions as capabilities change, while preserving current safety and CI contracts. This cleanup draws on Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862) (2026-09-04).

Keep long-term personal preferences in user-level guidance without overriding repository constraints; put module rules in the nearest `AGENTS.md` or applicable directory rules, and complex operational procedures in skills. Rules that must run without exceptions should be enforced by the appropriate permissions, hooks, or CI checks. Natural-language guidance is not implemented enforcement, and new automation must respect configuration and authorization boundaries.

A module README should describe its purpose, responsibilities and non-goals, main entry points, dependencies and data ownership, and development and verification commands. Link detailed designs on demand rather than copying repository-wide rules or storing temporary task logs. When touching a module, proactively compare its documentation with the implementation, report concrete gaps, and fix in-scope documentation without rewriting unrelated modules just to fill a template.

Repository skill descriptions should identify the applicable task and necessary distinctions; put operational detail in the body or referenced files. Use a short router for multiple workflows and avoid broadening triggers just to match more keywords. Model defaults, tool formats, and compaction behavior describe product implementation, so check the source before updating those docs.

Use a bounded feedback loop for reproducible failures or rule conflicts: when code changes, add the smallest behavioral regression, fix the actual shared implementation, run selected checks, then update only the closest existing authoritative rule. Avoid duplicated prose and tests that merely match documentation strings instead of proving behavior. Separate requirements, currently implemented enforcement, and pending engineering. User-requested guidance edits are allowed within scope, but do not autonomously expand permissions, weaken thresholds, retire behavior, change unrequested global configuration, or add endless loops or a new task ledger.

## Feature Quality Contract

Every feature, bugfix, and behavior change must ship with verifiable evidence. This rule applies to human authors and AI coding agents:

- Name the changed surface first: `desktop`, `mobile`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
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

`.github/workflows/pr-quality.yml` runs for PR `opened`, `synchronize`, `reopened`, `ready_for_review`, `labeled`, and `unlabeled` events, and again after each merge to `main`, scoped to what that push changed (label-based exceptions are judged on the PR only and never re-block `main`). `scope-plan` installs no dependencies and only produces the stable impact plan. `policy-enforcement` installs the frozen dependency graph independently and runs policy, so a policy failure cannot swallow product-test results. Product jobs depend only on `scope-plan` and select desktop, mobile, server, adapter, native, provider contract, chat contract, persistence, docs, and coverage lanes by path. The final `pr-quality-gate` validates every result strictly: selected jobs must succeed, unselected jobs must be skipped, and cancelled or missing results cannot be mistaken for success. The two longest lanes, server and desktop, are split across runners with `--shard=<i>/<n>` purely to cut wall time: the shards together run the whole check (the first desktop shard also lints, the last also builds), and any failing shard fails the job. Local runs and the daily full sweep are not sharded.

Branch protection on `main` requires the `pr-quality-gate` status check and applies to admins too: nobody can merge a red PR, so releases also go through a PR (see "Release steps"). A PR authored by a CODEOWNER needs no `allow-cli-core-change` label; an external contributor's CLI core change still needs the maintainer's label. The local hook only reminds; the PR gate is what blocks low-quality merges.

### When the gate is red

The gate is only useful while green means mergeable, so `main` has to stay green:

- **You changed behavior and a test went red**: the gate is working. Update the test in the same PR and say why the old assertion no longer holds.
- **The failure is not from your change**: check whether the latest PR Quality (push) run and the full sweep on `main` are red too. If so, fix it in a separate PR; if it cannot be fixed immediately, report a blocker rather than bypassing required deterministic lanes to merge. `scripts/quality-gate/quarantine.json` is only for maintainer baseline/release tracking (owners and expiry dates are audited by `check:quarantine`), not an exemption from required PR gates.
- **Intermittent failure (flaky)**: `check:server` re-runs each failed file once, alone, and labels it `FLAKY` (passes alone) or `FAILED` (fails again); the gate is red either way. `FLAKY` means a race: fix the race itself (a common cause is asserting on "the last request" or on wall-clock time). Do not hide it with longer timeouts or looser assertions.
- **The gate itself needs to change**: edit `scripts/pr/change-policy.ts`, the workflow, and their tests (`check:policy`). Keep the `pr-quality-gate` check name stable so branch protection does not need to change.

## Area-Specific Checks

Run the checks that match the files you changed:

```bash
bun run check:server      # Server API, WebSocket, providers, sessions, and related tests
bun run check:desktop     # Desktop lint, Vitest, and production build
bun run check:mobile      # Mobile types, lint, tests, and offline H5 export
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

Provider selectors come from the providers saved in your local Desktop Settings > Providers page. Contributors do not need the maintainer's provider UUIDs or vendor accounts. They can add their own provider locally, run `bun run quality:providers`, and choose their own model.

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

`quality:release` aliases release mode; real calls still require explicit `--allow-live` and maintainer quota authorization. Release mode composes PR checks, baseline catalog validation, live baseline cases, provider smoke, native checks, and current-platform canonical release `package-smoke --package-kind release`, but does not run every full-sweep check. Reports are written to `artifacts/quality-runs/<timestamp>/`. See Gate Tiers above for the publication workflow's three verification groups and aggregate dependencies; they neither directly invoke `bun run verify` nor automatically run the manual live release gate.

Distinguish these evidence layers per target OS/architecture; they are not interchangeable:

| Evidence layer | What it proves |
| --- | --- |
| Source / build | Tests, type checks, and builds for an identified candidate; not that a distributed package runs |
| Package structure | Metadata, resources, sidecars, and update files in an identified artifact; static or cross-platform inspection does not prove native launch |
| Native packaged runtime | The actual distributed package running on matching OS/architecture, exercising the app, sidecars, and key user paths; mocks or local Electron development smoke are not substitutes |
| Install / upgrade / data preservation | Actual installation and upgrades from supported older versions, preserving user data, custom directories, and settings |
| Signing / notarization / launch policy | Signing, notarization, and Gatekeeper as applicable to the platform and current release policy; unsigned Windows packages allowed by existing policy remain allowed |

For each layer, record the candidate (full SHA, dirty diff, and relevant untracked source fingerprints), target, commands, exit statuses, summaries, logs, and artifact SHA-256, linking evidence to the same artifact actually published. Rebuilding or signing changes bytes: relink and revalidate affected evidence. All platforms in the platform matrix below remain supported; one platform's results cannot stand in for other targets or silently remove them. `skipped`, `UNEXERCISED`, and `blocked` / `not run` do not prove those paths covered; valid unrelated skips remain allowed, without changing lane statuses or existing blocking rules.

Before publication, use the same artifact intended for release for applicable native launch, installation, older-version upgrade/data preservation, and signing/notarization checks; do not require an unpublished candidate to exist on the official update feed. Verify the post-publication real update path from an older client through hosted metadata, download, installation, and restart separately (below); do not backdate that evidence as a passed pre-publication check.

The current release workflow is not a per-target aggregate gate for all native runtime, installation, and upgrade evidence. Documentation requirements do not imply such automation exists or change publication policy or authorization. In release mode, live lanes are not allowed to be silently skipped. Missing providers, model quota, or external account access will fail the gate and must be recorded as a release blocker.

## Releases and Auto-Update

`desktop/package.json` is the single source of the desktop version number. A real release requires the version, the Git tag, and `release-notes/vX.Y.Z.md` to match exactly. Mobile has an independent version line: `mobile/package.json` and `mobile/app.json` must agree with each other, not with desktop.

In-app updates are driven by `electron-updater`, with artifacts hosted on GitHub Releases:

| Platform | Install / update target | Metadata |
|---|---|---|
| macOS arm64 / x64 | `dmg` for first install, `zip` for Squirrel.Mac updates | `latest-mac.yml` |
| Windows x64 / ARM64 | NSIS `.exe` | `latest.yml` |
| Linux x64 | `.AppImage` for updates, `.deb` and `.rpm` for manual install | `latest-linux.yml` |
| Linux arm64 | `.AppImage` for updates, `.deb` and `.rpm` for manual install | `latest-linux-arm64.yml` |

The release workflow generates `latest*.yml` inside each platform matrix job, renames colliding metadata to `latest-<platform>.yml`, and finally lets `scripts/release-update-metadata.ts` merge them back into the standard filenames electron-updater expects. Do not change this so each matrix job publishes the GitHub Release directly — the metadata files would overwrite each other.

### Artifact names

File names follow `build.artifactName` in `desktop/package.json` and the release workflow's per-platform asset lists, with the prefix `EchoFlow-Code-<version>`. macOS uses `-mac-arm64` / `-mac-x64` with `.dmg` or auto-update `.zip`; Windows uses `-win-x64.exe` / `-win-arm64.exe`. Linux x64 uses `-linux-x86_64.AppImage`, `-linux-amd64.deb`, and `-linux-x86_64.rpm`; Linux ARM64 uses `-linux-arm64.AppImage`, `-linux-arm64.deb`, and `-linux-aarch64.rpm`. Do not assume electron-builder spells `${arch}` identically across Linux formats.

Renames have three hard constraints, each checked by `scripts/pr/release-workflow.test.ts` against electron-updater's selection logic:

- `latest.yml`, `latest-mac.yml`, `latest-linux.yml` and `latest-linux-arm64.yml` are hard-coded by installed clients and cannot change.
- The Apple Silicon zip name must contain `arm64` and the Intel one must not; otherwise Apple Silicon machines get "updated" to the Intel build.
- Both Windows installers share one `latest.yml`, and the updater picks by the `x64` / `arm64` in the name; without them, ARM devices install the x64 build.

`.blockmap` files are published alongside macOS and Windows release artifacts and are also checked by package-smoke on the runner. Differential downloading is disabled by default; it is used only when explicitly enabled and the download feed passes the differential contract, otherwise downloads are full. See `desktop/electron/services/updater.ts` for the decision. After Windows installer signing, `scripts/refresh-windows-update-metadata.ts` rebuilds the blockmap and verifies it matches the final installer; publication checks blockmap and `latest*.yml` version consistency for each architecture. Releases do not attach `install-macos-unsigned.sh`, since release Mac builds are always signed and notarized.

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

Windows signing goes through SignPath and is off until approval lands: tag pushes, manual releases and manual drafts all produce unsigned Windows installers. Auto-update still works; users may just see a SmartScreen prompt. The switch is the `WINDOWS_SIGNING_ENABLED` repository variable:

- Unset or anything but `true`: Windows is not signed, and the preflight only emits a notice.
- `true`: the `SIGNPATH_*` variables and `SIGNPATH_API_TOKEN` are required, and a non-draft release with missing configuration is refused.
- A manual `Release Desktop` run can override it with the `windows_signing` input: `auto` follows the variable, `unsigned` skips signing for that run, and `signed` forces it (failing if configuration is incomplete), so a draft can be trial-signed before the variable is turned on.

Before turning signing on, update the installer artifact configuration in SignPath to match `.github/signpath/windows-installer.xml` (`EchoFlow-Code-*-win-*.exe`), then trial-sign a draft. As long as unsigned Windows releases remain possible, never add `publisherName` or `verifyUpdateCodeSignature` to `desktop/package.json`: clients built with either would reject every later unsigned update, with no way to recover in place.

The application artifact configuration must also match `.github/signpath/windows-application.xml`: it includes the source-built `agent-desktop.exe` alongside the main application and sidecar. When signing is enabled, the workflow submits, restores, and verifies all three executables before building the installer. After adding the native runtime, synchronize the SignPath configuration and trial-sign a draft first; signing the installer does not sign its embedded runtime executables.

### Pre-release checks

```bash
bun run scripts/release.ts <version> --dry
bun test scripts/pr/release-workflow.test.ts scripts/release-update-metadata.test.ts scripts/quality-gate/package-smoke/index.test.ts
bun run check:policy
```

Before running `bun run scripts/release.ts <version>` for real, confirm `release-notes/v<version>.md` exists and obtain separate authorization to create a branch and commit. A non-dry run creates `release/vX.Y.Z` and commits the version files and release notes; it does not create a tag, push, or publish. By default it updates only desktop; explicitly pass `--mobile <patch|minor|major|x.y.z>` to also increment the independent mobile version.

### Release steps

`main` is protected by `pr-quality-gate`, including for admins. Official publication is authorized only by the trusted `Release Please` workflow: it validates the tag and commit, then calls `Release Desktop` with `official_release: true`. Do not treat a direct tag push as the official release process.

1. Prepare the version change under the current Release Please configuration and merge it to `main` through a PR. If you use `bun run scripts/release.ts <version>` to help bump the version, prepare the corresponding release notes first; the script creates a version-bump branch and prompts you to open a PR.
2. After `main` changes, `Release Please` creates/validates the official release tag and calls `Release Desktop` to build and publish. Confirm the run was authorized by `.github/workflows/release-please.yml`, not merely triggered by a tag push.
3. `bun run scripts/release.ts --tag <version>` creates a local tag only; it does not publish an official release. Pushing that tag still does not replace Release Please's official authorization. If a Release Please-authorized run fails before publication, follow the maintainer recovery process while preserving that authorization boundary. Once a release is published, every run is refused at preflight, so nothing can overwrite installers users are downloading.

### Verify one real update path

This is post-publication update-path acceptance, not a pre-publication gate that requires publishing the candidate first. Package and installation/upgrade checks still run before publication as described above. Every release should be verified by upgrading from the previous stable build at least once:

1. Install the previous stable release from GitHub Releases.
2. Publish the candidate through the Release Please process above and confirm its authorized `Release Desktop` workflow finishes green; do not substitute a direct tag push for official publication authorization.
3. Open the old build and wait for the startup check, or check for updates manually in settings.
4. Confirm the new version is offered, then install and restart.
5. After restart, confirm the version in About, and that providers, sessions, skills, agents, memories, custom pets, and a custom data directory all still work.
6. Confirm historical attachment context, subagent details, and task state restore correctly; open a pet window and check the overlay and current-session navigation.

Platforms differ in what matters: on macOS confirm the release job used the signed artifacts and the launch-policy check passed; on Windows confirm `latest.yml` and both `-win-x64.exe` / `-win-arm64.exe` installers are in the release assets, and remember that a SmartScreen prompt on an unsigned build does not mean the updater failed; on Linux verify auto-update through the AppImage, since `.deb` and `.rpm` ship as manual installers only.

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
