---
title: Contributing and Quality Gates
nav_title: Contributing
description: Local setup, impact checks, quality gates, testing requirements, and the PR workflow.
order: 14
---

# Contributing and Quality Gates

This guide covers local setup, development, and module validation, plus PR gates and full sweeps on GitHub Actions. The goal is to help maintainers and contributors use candidate-specific evidence to answer: did this change break the core Coding Agent workflow?

Follow the [root AGENTS.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/AGENTS.md) for shared working, authorization, safety, and verification rules, and [DESIGN.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/DESIGN.md) for desktop design. See [Execution, data, and trust boundaries](./execution-boundaries.md) for durable rules on product capabilities, execution binding, persistence, and external input. This page owns the check workflow and test design; task progress, audit lists, and temporary validation records are not published as implemented architecture.

## Setup

Before verification, the operator must perform a preflight: read the expected Bun version from root `package.json`'s `packageManager`, record the executable actually resolved and its version, and check that nested processes launched from the repository resolve the same version; checking a shell alias alone is insufficient. Real binaries installed by version managers are valid; do not reject `mise` / `asdf` directory names. Preserve platform tool paths needed by the selected lanes and test-specific PATH fixtures rather than blindly clearing PATH. Check Node, Rust toolchains, and caches only when selected lanes need them.

Dependency installation and tool/cache preparation require explicit setup within authorized scope and may need the network; deterministic check execution must not implicitly download missing tools or auto-grant trust. The existing `check:docs` command includes a declared isolated dependency install; distinguish that preparation from the subsequent deterministic build and checks. Report missing prerequisites as `blocked` / `not run` in the handoff with the required setup; automation failures must still exit nonzero, not report success. A common preflight covering every verification entrypoint is not currently implemented; these are operator requirements, not newly enforced checks.

Run `bun install` at the root, and in `desktop/` when touching that area. Also install in `adapters/` when touching it or running `check:adapters` / `check:native`. Required PR jobs use the matching Bun and `bun install --frozen-lockfile` without updating lockfiles.

Selected harness checks also require Node `>= 24.9.0` and separate dependency preparation with `npm --prefix harness ci` using its independent lockfile (network may be needed). After preparation, run `npm --prefix harness test` (existing Bun scheduling does not change the Node runtime) and the separate `bun run audit:harness`; required audit failures must propagate. `bun run check:harness` includes installation and the suite, not the audit. See the [harness toolchain guide](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/harness/README.md#工具链).

Before your first desktop development run or `check:native`, run `bun run prepare:cloudflared` from `desktop/`. It downloads the pinned official connector, verifies SHA-256, and stages it in the Git-ignored local cache; distributed apps already include it. Native checks only validate and use that cache and do not download it. Cross-platform builds can select a target with `--target-triple`.

Downloads show progress, allow up to 10 minutes per attempt, stop after 60 seconds without progress, and make at most 3 attempts for transient network failures. Build commands use the terminal's `HTTPS_PROXY` / `https_proxy`, not the desktop app's proxy settings. Set your HTTP proxy in the same terminal if needed, for example:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 bun run prepare:cloudflared
```

Replace the example with your proxy address. If this network cannot download the file, download the matching version and platform asset from the official URL in the error, then import it with `CC_HAHA_CLOUDFLARED_ARCHIVE=/absolute/path/to/asset bun run prepare:cloudflared`. Offline imports still require the pinned SHA-256; other versions and unverified executables are rejected.

Do not commit local artifacts such as `artifacts/quality-runs/`, `node_modules/`, or `desktop/node_modules/`.

## Gate Tiers

| Tier | Trigger | What runs | Constraint |
| --- | --- | --- | --- |
| Local | manual | Focused tests covering the change, with additional checks for cross-module behavior | WSL runs focused/module validation only, not a duplicate of the cloud full sweep |
| PR (required) | `pull_request`, and `push` to `main` after a merge | The deterministic lanes the impact report selects, including `check:agent-flow` and `check:agent-e2e`; coverage is reported, not blocking | no model, no provider, no secret, runs on an untrusted fork |
| Full sweep | `nightly-quality.yml`, daily (19:00 UTC) plus maintainer-triggered | The workflow's configured deterministic checks without path selection, separate macOS Swift checks, and module-graph health; includes `check:release-surface` and `check:desktop-ui-smoke` | no model, no secret; manual `skip_coverage` defaults off, and UI smoke explicitly skips missing dependencies |
| Release | maintainer-run `bun run quality:release -- --allow-live --provider-model <selector>:main` | PR checks, baseline catalog/live, native and current-platform packaging smoke; the full sweep runs separately, not all of its checks are automatically included | live models require explicit maintainer authorization; this is not the publication workflow |

Use `nightly-quality.yml` for manual full sweeps; the former `push-quality.yml` entrypoint is retired, while local `quality:push` semantics are unchanged. PRs select checks by impact; the daily full sweep covers untouched checks and whole-suite interactions. Its frequency is pinned by `pr-quality-workflow.test.ts` and requires a maintainer decision to change. Live models are reserved for releases and maintainer-run smoke with explicit quota authorization; ordinary contributors need no provider to run the PR tier.

## AI Coding Agent Fix Loop

Follow the [root rules](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/AGENTS.md) for daily diagnosis, coordination, and authorization. This is the single change-to-delivery workflow. Compare expected behavior, actual outcomes, and logs along real call chains; separate observations, hypotheses, and unknowns rather than inferring defects from names. Preserve validation and error handling; redesign only when the existing contract cannot meet the goal.

### PR Workflow

1. Check that existing explicit authorization covers each intended branch, commit, push, PR, or merge operation. Do not ask again within the same scope; obtain authorization for uncovered operations. When authorized, use a normal product branch such as `fix/session-reconnect`.
2. Name the surface (`desktop`, `mobile`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`), add regressions under the [Feature Quality Contract](#feature-quality-contract), and make the smallest fix.
3. On WSL, run the tests that cover the change. Use the [impact report](#path-aware-pr-checks) to select additional checks when the change crosses module boundaries. If live or release evidence is needed, meet the dedicated [Baseline](#live-model-baseline) or [Release](#release-gate) prerequisites.
4. Record the candidate, commands, summaries, report paths, and gaps under [Evidence and Failure Diagnosis](#evidence-and-failure-diagnosis). Use the [PR template](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/.github/pull_request_template.md) for user impact, changed files, tests added, coverage/E2E/live reports or blockers, and remaining risks; then perform authorized commit, push, and PR operations.
5. Collect the candidate's PR Actions results. Qualify PR-ready/push-ready as “local module validation complete, ready to commit/push for CI” or “the candidate's PR Actions gate passed.” The former proves neither merge readiness nor authorization.

A passed PR gate requires an Actions run link for the full candidate SHA, the final `pr-quality-gate` result, and selected job results; record how the tested checkout/merge SHA maps to PR head/base. An uncommitted worktree, later edits, or another SHA cannot reuse an old green CI result; use `not run` / pending when no corresponding run exists. Qualify full validation with its scope and Actions evidence. Nightly proves only the deterministic full sweep for its SHA, not the PR gate or release live checks, per-platform artifacts, installation/upgrades, or publication acceptance.

### Path-Aware PR Checks

```bash
bun run check:impact
```

`check:impact` selects scope; it does not prove behavior. `scripts/pr/change-policy.ts` owns routing: path prefixes define areas and blocking rules, while the importer graph in `scripts/pr/module-graph.ts` only widens check selection, without demanding tests for untouched areas. The report's `## Cross-surface impact` names the importer behind extra checks. For example, a renderer utility imported by the Electron host selects `check:native`, since the renderer tsconfig does not compile `desktop/electron/`. Graph failure warns and selects every surface, never silently reverting to prefix routing.

When local policy needs an exception decision but lacks a trusted PR author and base branch CODEOWNERS, keep it `blocked`; missing context does not prove approval is missing. Never infer identity from `git user` or worktree CODEOWNERS, fabricate labels, or use `ALLOW_*` bypasses. Preserve technical results and wait for verifiable PR/base context.

### Area-Specific Checks

Run the module commands from impact output rather than every lane. The complete command list lives in root [package.json](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/package.json) `scripts`, with composition and selection in [modes.ts](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/scripts/quality-gate/modes.ts). Persistence changes require `bun run check:persistence-upgrade`; Electron/sidecar/packaging changes require impact-selected `check:native`, not renderer checks as a substitute. Mobile `check:mobile` includes types, lint, tests, and offline H5 export; H5/mocks cannot replace native-device evidence.

### Local Pre-Push Reminder

push no longer runs a local quality gate. `bun run verify` is neither the WSL default nor a prerequisite for committing or pushing. Use these entrypoints only when explicitly choosing extra local PR verification:

| Command | Meaning |
| --- | --- |
| `bun run verify` | Equivalent to `quality:pr` / `quality:verify`: impact-selected PR lanes, with selected coverage blocking locally; no real models, not nightly full sweep or release acceptance |
| `bun run quality:push` | Optional shortcut reusing PR impact/policy/path checks but skipping coverage; not a substitute for complete verification |
| `bun run hooks:install` | Optional local pre-push hook that prints a non-blocking reminder without blocking `git push` |

### PR CI Merge Gate

`pr-quality.yml` runs on PR `opened`, `synchronize`, `reopened`, `ready_for_review`, `labeled`, and `unlabeled`, plus pushes after merging to `main`. `scope-plan` installs no dependencies and only produces the plan; `policy-enforcement` independently installs frozen dependencies and enforces policy. Product jobs depend only on `scope-plan`, so policy failures cannot swallow product results. Label exceptions are judged on the PR, not re-blocked on main.

`pr-quality-gate` requires successful `scope-plan` and `policy-enforcement`, then validates blocking jobs: selected jobs must succeed, unselected jobs must be skipped, and cancelled or missing results fail. Advisory `coverage-checks` reports separately, stays out of the gate's `needs`, and is not awaited (see [Coverage Policy](#coverage-policy)). Server/desktop `--shard=<i>/<n>` shards still run the whole check together, with desktop lint in the first and build in the last; any failing shard fails the job. Local and daily full sweeps are unsharded.

Branch protection on `main` requires `pr-quality-gate`, including for admins, so releases also go through PRs. Individual CODEOWNER authors need no `allow-cli-core-change`; author identity and CODEOWNERS must come from trusted PR/base context. Other contributors' CLI core changes still need the maintainer label; other exceptions remain unchanged. Required PR jobs are offline, need no provider/secrets/paid services, and run on forks. `pull_request_target` may only inspect metadata using trusted base code, never execute PR head, install its dependencies, or expose secrets to it. Editing workflows does not authorize changing branch protection or repository settings.

## Feature Quality Contract

Every feature, bugfix, and behavior change needs verifiable delivery evidence, for humans and AI coding agents alike:

- Executable JS/TS production changes need same-area tests in the same PR. `change-policy.ts` checks `desktop/src/`, `src/server/`, the rest of `src/`, and `adapters/` separately. Only a maintainer confirming automation is unsuitable and explicitly applying `allow-missing-tests` can grant an exception. Prose/CSS do not independently require new tests, but still need impact-selected checks.
- Use unit tests for pure logic, API or request-shape tests for server/API/provider/runtime, and Vitest/Testing Library for desktop UI/store/API. Cross-boundary user flows through UI, WebSocket, provider proxies, native sidecars, or release packaging need E2E/desktop smoke.
- Agent loops, tools, provider routing, model selection, file edits, permissions, recovery, and desktop chat require PR mock/fixture contracts (see the [deterministic gate](#deterministic-agent-gate-no-model-required)); live evidence cannot replace deterministic regressions.

### Regression Test Design

For defects, use **RED → GREEN → refactor**: reproduce through a real entry point with the smallest regression, confirm failure is from the target defect rather than environment/fixture errors, then make the smallest fix. Refactor only with tests green. If reproduction is unavailable, record inputs, environment, observations, and gaps; an always-passing test is neither a reproduction nor proof of a fix. A same-area file is only the minimum signal; prove behavior too:

- **Drive transitions.** Use `handleServerMessage`, real store actions, or user events, not `setState` assigning a transition's expected result. Direct fixture initialization is still valid.
- **Assert invariants.** Verify which session/model owns the data, not today's screen strings. Inputs and expectations follow the behavior contract; do not change them to hide failures.
- **Cover dropping and keeping.** Test both sides of deduplication, merging, and filtering; reject replays but retain genuine repeated messages. Forward upstream identities such as `uuid` / `toolUseId`, never infer identity from text.
- **Test boundary connections.** Exercise callers and dependencies through real entry points and assert final observable outcomes; do not mock the module under test. Separate green server/store/component tests do not prove messages drive UI.
- **Verify failure and recovery.** Cover errors, timeouts, cancellation, retries/reconnects according to risk, asserting failure state, cleanup, and continued usability without replaying accepted side effects or bypassing permissions.
- **Protect compatibility.** Add evidence for affected legacy key/path/marker behavior; old names do not justify deletion. Migrations need old fixtures for retries after partial failure and for user-cleared preferences not resurrecting from old data on restart after success. These are test requirements, not fix claims.

### Coverage Policy

Exclude generated/build output from product coverage; maintained areas should move toward 75-80%+, and new/changed executable production lines must meet `coverage-thresholds.json` changed-line thresholds. The baseline is `scripts/quality-gate/coverage-baseline.json`; CI compares against the base branch baseline when available and disallows drops beyond the window. Baseline/threshold changes require a maintainer's `allow-coverage-baseline-change` and a reason, never lowering standards merely to pass. Legacy low coverage is debt; new PRs must leave touched areas better than they found them.

In local `bun run verify`, selected coverage is blocking and failures fail verification; add the `run-coverage` label to request an advisory `coverage-checks` report for a PR with coverage-relevant changes. Ordinary PRs skip this job by default. It still measures source coverage, applies the baseline ratchet, reports 75-80%+ target gaps, and checks changed-line coverage. Advisory does not mean failures can be ignored. See [Evidence and Failure Diagnosis](#evidence-and-failure-diagnosis) for collection limits and diagnosis.

#### Coverage References

- [Google Testing Blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html): 60% acceptable, 75% commendable, 90% exemplary; 90% is a reasonable changed/per-commit lower threshold.
- [Microsoft Visual Studio / Azure DevOps](https://learn.microsoft.com/en-us/visualstudio/test/using-code-coverage-to-determine-how-much-code-is-being-tested): typically about 80%, with 75% possible for typical requirements and relaxed treatment of generated code.
- [ChromiumOS EC](https://chromium.googlesource.com/chromiumos/platform/ec/+/main/docs/code_coverage.md): at least 80% for new/changed lines.

### Deterministic Agent Gate (no model required)

```bash
bun run check:agent-flow       # real server + real WebSocket + mock CLI
bun run check:agent-e2e        # real server + real CLI agent loop + mock LLM, then recorded-traffic replay
bun run check:agent-replay     # recorded-traffic replay only
bun run check:desktop-ui-smoke # real desktop UI + real permission dialog + mock CLI
```

All four channels run without a provider, credentials, or the public network.

`check:agent-e2e` fakes only the model: a loopback Anthropic-compatible endpoint (`scripts/quality-gate/mock-llm/`) is registered as a provider through the same API as the desktop "add provider" form, and the real CLI runs its real agent loop with real tools on a real (throwaway) disk. The scripted model reacts to plain-language prompts the way a model would, so it shares one scenario catalog with `check:agent-flow:live` (`agent-flow/liveScenarios.ts`): the mock proves the plumbing, the live lane proves a real model lands on the same outcome. Mock-only scenarios assert what only the upstream side can see — the tool's output really went back to the model (nonce check), a denied permission reaches the model as an error result, stopping really closes the upstream connection, and the session recovers after an upstream error. When you change the agent loop, tools, permissions, or provider wiring, add a scenario here rather than only a unit test.

A hand-written mock cannot represent every upstream shape, so `check:agent-e2e` also runs a replay lane (`scripts/quality-gate/replay/`). A maintainer runs each scenario once against real DeepSeek Flash and commits the recorded upstream traffic as `cassettes/*.json`; CI serves it back to the real server and real CLI with no network and no credentials. Recordings preserve thinking/signatures, fragmented and parallel tools, recovery, large output, subagents/Teams, MCP, images, automatic/manual compaction, interrupts, Chinese, and proxied OpenAI Chat streams; the catalog in `scripts/quality-gate/replay/` owns the individual scenarios.

- **Matching**: requests take recorded interactions in order, per queue. Each agent loop (the main agent, a subagent, a teammate) is its own queue, keyed by the first user message that started it, matched strictly on model, stream mode, the last message's role, the user's text, and whether the tool results answer exactly the previous reply's tool calls (parallel tools return in completion order, so only the set is compared). A mismatch returns a 400 `replay_mismatch` and writes a field-level diff to `artifacts/agent-e2e/replay/<format>/<id>.report.json`. Tool-less side calls such as a session title are replayed when recorded and otherwise get a placeholder reply, without failing.
- **Run-specific values**: the throwaway work dir, the sandbox config dir, the project's directory name, session ids, the date, and the temp dir are stored as placeholders such as `{{WORK_ROOT}}` and expanded for each run, also when a path was streamed across several fragments. Values the app mints from the clock that a reply must quote back verbatim (a teammate shutdown request id) are stored as learned slots such as `{{V1}}`: a replay learns this run's value from the first request that carries it and fills it into later replies. Message batching in an agent team depends on timing, so that scenario replays the recorded model latency and stream timing; the others replay at a compressed pace.
- **Drift**: a changed tool list or `max_tokens` that still replays is noted in `drift.md`, not failed. The system prompt and tool schemas carry the OS, shell, and date, which differ between the recording machine and CI, so they are not compared.
- **Re-recording**: when behaviour really changed (a prompt edit sends the model down a different tool path), run `bun run quality:record-cassettes -- --allow-live --only <id>` locally. It reads the key of the DeepSeek provider saved in the desktop app and keeps it in the recording proxy's memory; the sandbox gets a fake key. Each new cassette is replayed once as a self-check, and a recording containing the key, the real home path, or a temp-dir path is rejected. Recording spends real quota and never runs in CI.

`check:agent-flow` covers session creation, runtime selection, first-turn streaming, tool execution, permission allow/deny, tool failure, API error, interrupt, reconnect permission replay, and session recovery. `check:desktop-ui-smoke` clicks the real Allow button in a real browser; it needs `agent-browser` and installed desktop dependencies and skips with a printed reason when either is missing.

For ad hoc UI verification (manual checks, screenshots, or exploratory testing), use a browser tool available in the current session or the repository's isolated desktop preview. Record the steps you performed and what you observed. Use `agent-browser` only in the committed lane (which runs headless on Linux CI) and in the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts.

Every quality-gate lane that boots the real server runs against a sandbox config dir (`scripts/quality-gate/sandbox.ts`) and fails if it wrote to the developer's real `~/.claude`.

## Evidence and Failure Diagnosis

Bind verification evidence to a candidate: the full Git SHA, dirty diff, and content fingerprints of relevant untracked source, along with the environment (OS/architecture, tool versions and paths), actual commands, exit statuses, final summaries, and logs; also record SHA-256 for release artifacts. Relevant source, dependency, or environment changes invalidate affected prior evidence. Distinguish `passed`, `failed`, `skipped`, `blocked`, and `not run`; an incomplete run, missing final summary, or unknown background-task state is not `passed`. Redact shared evidence: never expose credentials, user configuration, full transcripts, or upstream response bodies.

The main `artifacts/quality-runs/<timestamp>/report.md` / `report.json` embeds scope, result matrices, and coverage summaries, linking to `junit.xml`, `logs/*.log`, and `artifacts/coverage/<timestamp>/coverage-report.md` / `.json`.

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

Coverage reports have limits: `desktop/vitest.config.ts` collects only `src/**`, excluding the Electron main process. The repository's current Bun coverage baseline has zero branch records, and `coverage.ts` displays `0/0` as 100%; that does not prove all branches were exercised. Inspect current configuration and reports instead of using historical coverage figures as evidence for a new change.

### When the gate is red

- **Changed behavior caused a failure**: fix regressions first; change assertions in the same PR only when intended behavior actually changed, explaining why rather than hiding defects.
- **Unrelated existing failure**: compare the latest PR Quality (push) and full sweep on `main`. A separate fix PR still requires authorization; report a blocker if it cannot be fixed promptly, never bypass required lanes. Quarantine is for maintainer baseline/release tracking only, audited for owners/expiry by `check:quarantine`; it exempts neither normal PRs nor deterministic provider/chat contracts.
- **Intermittent failure**: `check:server` reruns failed files alone; both `FLAKY` (rerun passes) and `FAILED` (fails again) fail the gate. Reruns diagnose races; fix them instead of loosening assertions or extending timeouts. Isolation is a last resort with a recorded reason and owner.
- **Gate change needed**: update `change-policy.ts`, workflows, and their tests together, run `check:policy` and `actionlint` when available, and preserve `pr-quality-gate` and its blocking semantics without changing repository protection unilaterally.

## Maintaining Agent Instructions

Route first-party rules through [root AGENTS.md](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/blob/main/AGENTS.md) by area; user-level preferences cannot override repository constraints. Shared guidance must work across models. Revisit duplication and broad stopping conditions as capabilities change without skipping safety/CI contracts. Maintain domain rules, implementation details, and examples in the nearest authoritative source. Use skills for complex procedures: descriptions state applicable tasks and necessary distinctions, multi-workflow skills use short routers, and operational details live in the body/references rather than keyword-heavy triggers.

Module READMEs describe responsibilities/non-goals, entry points, dependencies, data ownership, and development/verification commands, linking designs without copying global rules or storing task logs. Check touched documentation against implementation and fix scoped gaps, not unrelated modules in bulk. Verify source before documenting model defaults, tool formats, or compaction behavior.

Use a bounded feedback loop for reproducible failures/rule conflicts: minimal behavioral regression → shared implementation fix → selected checks → nearest authoritative rule. Documentation-string tests cannot replace behavior evidence. Distinguish requirements, implemented permission/hook/CI enforcement, and pending engineering. Rules requiring exceptionless execution should use appropriate permissions, hooks, or CI; prose is not enforcement, and new automation must respect configuration and authorization boundaries. Stay within the user-requested scope: do not expand permissions, weaken thresholds, retire behavior, change global config, or add endless loops/task ledgers autonomously.

## Live Model Baseline

`quality:baseline` runs real Coding Agent tasks: it starts the local server, creates isolated fixtures, asks a model through chat to fix code, runs tests, and saves transcripts, diffs, verification logs, and a report. It also runs provider live smoke: saved or active OpenAI-compatible providers validate connectivity, proxy conversion, and streaming proxy behavior; env-only provider smoke validates upstream connectivity and the transform pipeline.

Ordinary PRs do not require live checks. Before live smoke/baseline, maintainers must pass deterministic checks; this dedicated procedure also requires an explicit successful `bun run verify` (including selected blocking coverage), a defined provider scope, and quota authorization. Do not turn this into a general commit/push prerequisite. Finding a local provider is not authorization. The default command does not call real models:

```bash
bun run quality:baseline
```

To actually call models, pass `--allow-live` and choose a local provider.

First list your local providers and copyable selectors:

```bash
bun run quality:providers
```

Copy the printed `--provider-model` argument rather than guessing UUIDs/model IDs:

```bash
bun run quality:gate --mode baseline --allow-live --provider-model <provider>:<model-or-role>:<label>
```

To run only provider smoke plus desktop agent-browser smoke, use:

```bash
bun run quality:smoke --provider-model <provider>:<model-or-role>:<label>
```

Repeat `--provider-model` for multiple models. Selectors come from local Desktop Settings > Providers; contributors use their own providers, not maintainer UUIDs or vendor accounts. When names collide, `quality:providers` prints provider IDs. For model IDs containing colons, prefer a role, such as `--provider-model custom:haiku:custom-haiku`, which resolves the actual ID from local configuration.

Without a saved provider, use one-time environment variables for unsaved provider smoke; never put real keys in shell history, logs, or shared reports:

```bash
QUALITY_GATE_PROVIDER_BASE_URL=https://example.com \
QUALITY_GATE_PROVIDER_API_KEY=... \
QUALITY_GATE_PROVIDER_MODEL=model-id \
QUALITY_GATE_PROVIDER_API_FORMAT=openai_chat \
bun run quality:gate --mode baseline --allow-live
```

### When To Run The Baseline

After meeting the dedicated prerequisites above, a trusted maintainer should run the live baseline for changes touching:

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

`quality:release` aliases release mode; real calls still require explicit `--allow-live` and maintainer quota authorization. Release mode composes PR checks, baseline catalog validation, live baseline cases, provider smoke, native checks, and current-platform canonical release `package-smoke --package-kind release`, but does not run every full-sweep check. Reports are written to `artifacts/quality-runs/<timestamp>/`. The publication workflow has the separate deterministic gates below and does not automatically run the manual live release gate.

`release-desktop.yml` does not directly invoke `bun run verify`, but it does gate publication: `verify-governance` (`check:policy`, `check:product-identity`, `check:upstream-content`), `verify-runtime` (`check:server`, `check:agent-flow`, `check:adapters`), and `verify-desktop` (`check:desktop`, `check:persistence-upgrade`) feed `release-verify-gate`. `publish-release` depends on both the build matrix and that aggregate gate; any verification group without a successful result prevents publication. Jobs bind to the same release SHA; these checks do not replace complete `verify`, the full sweep, or the manual live release gate. `scripts/pr/release-workflow.test.ts` separately guards the absence of a direct `verify` invocation and the actual publication dependencies.

Distinguish these evidence layers per target OS/architecture; they are not interchangeable:

| Evidence layer | What it proves |
| --- | --- |
| Source / build | Tests, type checks, and builds for an identified candidate; not that a distributed package runs |
| Package structure | Metadata, resources, sidecars, and update files in an identified artifact; static or cross-platform inspection does not prove native launch |
| Native packaged runtime | The actual distributed package running on matching OS/architecture, exercising the app, sidecars, and key user paths; mocks or local Electron development smoke are not substitutes |
| Install / upgrade / data preservation | Actual installation and upgrades from supported older versions, preserving user data, custom directories, and settings |
| Signing / notarization / launch policy | Signing, notarization, and Gatekeeper as applicable to the platform and explicitly selected release mode; unsigned macOS / Windows packages are allowed with disclosed limitations, not counted as passing signing acceptance |

For each layer, follow the [common evidence requirements](#evidence-and-failure-diagnosis), recording candidate, target, and artifact SHA-256 and linking evidence to the same artifact actually published. Rebuilding or signing changes bytes: relink and revalidate affected evidence. All platforms in the platform matrix below remain supported; one platform's results cannot stand in for other targets or silently remove them. `skipped`, `UNEXERCISED`, and `blocked` / `not run` do not prove those paths covered; valid unrelated skips remain allowed, without changing lane statuses or existing blocking rules.

Before publication, use the same artifact intended for release for applicable native launch, installation, older-version upgrade/data preservation, and signing/notarization checks; do not require an unpublished candidate to exist on the official update feed. Verify the post-publication real update path from an older client through hosted metadata, download, installation, and restart separately (below); do not backdate that evidence as a passed pre-publication check.

The current release workflow is not a per-target aggregate gate for all native runtime, installation, and upgrade evidence. Documentation requirements do not imply such automation exists or change publication policy or authorization. In release mode, live lanes are not allowed to be silently skipped. Missing providers, model quota, or external account access will fail the gate and must be recorded as a release blocker.

## Releases and Auto-Update

`desktop/package.json` is the single source of the desktop version number. A real release requires the version, the Git tag, and `release-notes/vX.Y.Z.md` to match exactly. Mobile has an independent version line: `mobile/package.json` and `mobile/app.json` must agree with each other, not with desktop.

In-app updates are driven by `electron-updater`, with artifacts hosted on GitHub Releases:

| Platform | Install / update target | Metadata |
|---|---|---|
| macOS arm64 / x64 | `dmg` for installation; signed `zip` for Squirrel.Mac updates, manual updates in unsigned mode | `latest-mac.yml` published only in signed mode |
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

`.blockmap` files are published alongside macOS and Windows release artifacts and are also checked by package-smoke on the runner. Differential downloading is disabled by default; it is used only when explicitly enabled and the download feed passes the differential contract, otherwise downloads are full. See `desktop/electron/services/updater.ts` for the decision. After Windows installer signing, `scripts/refresh-windows-update-metadata.ts` rebuilds the blockmap and verifies it matches the final installer; publication checks blockmap and `latest*.yml` version consistency for each architecture. Releases do not attach `install-macos-unsigned.sh` or scripts that remove quarantine attributes or disable system protections. Unsigned macOS builds still generate update files for package-structure checks, but do not publish macOS channel metadata to the public update feed; retained ZIP / blockmap files do not establish auto-update availability.

### Signing secrets

The `macos_signing` input explicitly selects `unsigned` or `signed`, defaulting to `unsigned`. Release Please uses the `MACOS_SIGNING_MODE` repository variable, falling back to `unsigned` when unset. Missing credentials never cause a silent fallback. Unsigned builds have no Developer ID signature or Apple notarization, and the OS may warn or block installation or launch. Native-component signature checks remain unchanged, so Computer Use is unavailable and updates require manual download and installation. Release notes must disclose these limitations.

Signed mode retains all signing, notarization, and launch-policy gates and fails on missing configuration. macOS signing and notarization depend on these GitHub Actions repository secrets:

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

Before running `bun run scripts/release.ts <version>` for real, confirm `release-notes/v<version>.md` exists and check whether existing authorization covers the branch-creation and commit side effects; ask only if those actions are not already covered. A non-dry run creates `release/vX.Y.Z` and commits the version files and release notes; it does not create a tag, push, or publish. By default it updates only desktop; explicitly pass `--mobile <patch|minor|major|x.y.z>` to also increment the independent mobile version.

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

Platforms differ in what matters: in macOS signed mode, confirm the release job used signed artifacts and the launch-policy check passed; in unsigned mode, verify manual installation/upgrades and data preservation instead of auto-update, recording OS warnings and Computer Use unavailability; on Windows confirm `latest.yml` and both `-win-x64.exe` / `-win-arm64.exe` installers are in the release assets, and remember that a SmartScreen prompt on an unsigned build does not mean the updater failed; on Linux verify auto-update through the AppImage, since `.deb` and `.rpm` ship as manual installers only.

## FAQ

### Can I run checks without a provider?

Yes: run the [impact-selected](#path-aware-pr-checks) deterministic commands; `verify` also needs no real model. Only explicitly authorized live checks need a provider; see [Live Model Baseline](#live-model-baseline).

### What if provider selectors conflict?

Copy `quality:providers` output rather than guessing selectors; see [Baseline arguments](#live-model-baseline) for collision fallback and role selection.

### What if a model ID contains a colon?

Use the role-selector example in [Baseline](#live-model-baseline).
