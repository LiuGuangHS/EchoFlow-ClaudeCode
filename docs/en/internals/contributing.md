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
cd desktop && bun run electron:dev              # default path: full Electron app, sidecars, hot reload
cd desktop && bun run electron:build            # build and package the desktop app (not `bun run build`)
cd desktop && bun run test                      # desktop Vitest suites
cd desktop && bun run check:electron            # type-check the Electron host and rebuild bundles
cd desktop && bun run build                     # type-check and produce a production build (frontend only)
cd adapters && bun run test                     # all adapter tests; test:<platform> for one platform
bun run docs:dev                                # docs preview; bun run docs:build to build
```

Run desktop development and verification commands inside WSL when the repository is hosted there:

```bash
wsl.exe -d Ubuntu -- bash -lc 'cd /home/<user>/WorkSpace/EchoFlow-Code/desktop && bun run electron:dev'
```

Do not use the Vite-only `cd desktop && bun run dev` browser preview as the product test path; reserve it for explicitly isolated frontend work. For user-visible desktop changes, launch the full Electron app and exercise the affected workflow.

For Windows x64 packaging use `cd desktop && bun run build:windows-x64`; it requires Bun/Bunx and Visual Studio 2022 Build Tools with the Desktop development with C++ workload.

## Gate Tiers

| Tier | Trigger | What runs | Constraint |
| --- | --- | --- | --- |
| Local | manual | The narrowest relevant tests, then whatever `bun run check:impact` selects | seconds |
| PR (required) | `pull_request` | The deterministic lanes the impact report selects, including `check:agent-flow` | no model, no provider, no secret, runs on an untrusted fork |
| Full sweep | Maintainer-triggered (`workflow_dispatch`) | Every deterministic lane with no path selection, plus module-graph health and `check:desktop-ui-smoke` | still no model, no secret |
| Release | Tagging triggers `release-desktop.yml` automatically; the maintainer may also run `bun run quality:release` manually | CI runs a content gate plus parallel verification (see below); `quality:release` adds native/packaging smoke and maintainer-authorized live provider baselines | live models only in `quality:release`, only with explicit authorization |

`release-desktop.yml` now runs two gates:

1. **Content gate** (`release-contract` job, ~30 seconds): verifies the tag matches `desktop/package.json`, `release-notes/vX.Y.Z.md` exists with the right title, and `check:release-surface` passes. If any of these fail, the build never starts.
2. **Parallel verification** (`release-verification` job, runs alongside the 6-platform build): `check:policy` / `check:server` / `check:desktop` / `check:agent-flow` / `check:adapters` / `check:persistence-upgrade`. If the build finishes but verification fails, nothing is published.

Pre-release checks no longer need a 20-minute local sweep — CI runs them during the build. The full sweep (`nightly-quality.yml`) is deliberately not scheduled: spending ~90 minutes of CI is a decision, not a default, and `pr-quality-workflow.test.ts` fails if a `schedule:` is added back.

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

`agent-browser` belongs to that committed lane (which runs headless on Linux CI) and to the maintainer-run `desktop/scripts/e2e-*-agent-browser.sh` scripts. For ad-hoc browser work (manual verification, screenshots, exploratory UI checks), use the installed `playwright` plugin or the `browser` tools instead; do not treat `agent-browser` as a general-purpose browser tool just because it appears in the repository.

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

The coverage gate runs root, desktop, and adapter suites for the source areas changed in the diff, then enforces the baseline ratchet, reports target gaps, and checks changed-line coverage. Unchanged areas are skipped. If no source area can be selected, or the coverage policy or dependency manifests changed, it runs every area. The current baseline lives in `scripts/quality-gate/coverage-baseline.json`, and CI compares the affected suites against the base branch baseline when available. Changed areas must not lower coverage beyond the allowed window. Changes to `coverage-baseline.json` or `coverage-thresholds.json` require the maintainer-only `allow-coverage-baseline-change` label. Quarantine is reserved for maintainer baseline/release tracking and must never hide deterministic provider/chat contract tests; the normal PR gate does not depend on quarantine to pass.

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

The default toolset is five plugins covering design, planning, review, and minimal implementation. They accelerate the workflow but **do not replace the gates**: `bun run check:impact`, the surface checks, `bun run check:policy`, and `bun run verify` remain the only authority. Where a plugin disagrees with this repository, `AGENTS.md` wins on direction and policy, and this document wins on procedure.

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

Two general disciplines apply when merging and releasing:

- **Adjudicate conflicts hunk by hunk.** A merge conflict is two decisions stacked together. Never apply blanket `--ours` or `--theirs`; read both sides per hunk and decide which half to keep.
- **Audit public identity before shipping a merge.** README, docs, release notes, package metadata, diagnostics exports, signing and privacy pages, update links, and desktop "About" defaults must never name another project or its author as EchoFlow's author, maintainer, contact, or product identity. The executable check is `bun run check:release-surface`.

## Feature Quality Contract

Every feature, bugfix, and behavior change must ship with verifiable evidence. This rule applies to human authors and AI coding agents:

- Name the changed surface first: `desktop`, `server`, `adapter`, `native`, `docs`, `provider/runtime`, `agent-loop`, or `release`.
- Executable JS/TS production changes must include same-area tests in the same PR. `scripts/pr/change-policy.ts` checks desktop, server, each adapter package (`adapters/<platform>/`), mobile, and the remaining root runtime separately, unless a maintainer explicitly applies `allow-missing-tests`. Non-executable files such as prose or CSS do not independently require new tests under this rule; all impact-selected checks still apply.
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

Path-to-area routing lives in `scripts/pr/area-routing.json`. `change-policy.ts` consumes it directly, while `pr-triage.yml` reads the same file from the base revision through the GitHub API: it never checks out, installs, or executes PR code. That keeps `site/` on docs, `native/` on desktop, and `.github/workflows/**` on the policy lane, without a second advisory prefix graph.

`bun run audit:harness` runs with `--fail-on-required`: failures in the fixed `REQUIRED_CHECK_IDS` repository-contract set exit nonzero, while other rubric findings, such as historical names that remain inside a compatibility window, stay report-only.

Repository settings should protect `main` with GitHub branch protection / rulesets and require the `pr-quality-gate` status check. CODEOWNERS requires maintainer review for workflows, quality policy, and high-risk provider/WebSocket boundaries. The local hook only reminds; the PR gate is what blocks low-quality merges.

## Area-Specific Checks

`bun run check:impact` prints a `## Required local checks` list derived from the changed paths and the import graph; run that list. The most common entry points:

```bash
bun run check:server      # Server API, WebSocket, providers, sessions, and related tests
bun run check:desktop     # Desktop lint, Vitest, and production build
bun run check:adapters    # IM adapter tests
bun run check:docs        # Isolated install, build, and validation for the site/ React docs
```

Entry points for mobile, native, provider/chat contracts, persistence, and coverage live in the `check:*` scripts in `package.json`; do not maintain a second list here.

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

Release mode composes PR checks, baseline catalog validation, live baseline cases, provider smoke, native checks, and current-platform canonical release `package-smoke --package-kind release`. Reports are written to `artifacts/quality-runs/<timestamp>/`. `release-desktop.yml` runs content-gate and parallel verification in CI (`check:policy` / `check:server` / `check:desktop` / `check:agent-flow` / `check:adapters` / `check:persistence-upgrade`); publishing requires both the build and verification to pass. `quality:release` is an optional stricter local check that additionally covers native/packaging smoke and real provider baselines.

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

### Update channel and site sync

Release finishing mirrors the update channel to the public site, with three separate responsibilities:

- **Update metadata**: the app requests `latest*.yml` from `https://code.echoflow.cn/update/` first, then falls back to GitHub directly on a missing file, network error, or empty response. When `ECHOFLOW_UPDATE_FEED_URL` is set, it is the only source and there is no fallback.
- **Installer downloads**: the download page and in-app download prefer the `gh-proxy.org` acceleration prefix, with GitHub direct download as the fallback.
- **Failure guidance**: when an in-app update fails, Settings → About points the user to `code.echoflow.cn/download` for a manual download.

On release, `site-release-sync` in `release-desktop.yml` triggers `deploy-docs.yml` with `--release <tag>` after the GitHub release completes. `scripts/site-release-manifest.ts` copies the four yml files byte-for-byte into `site/dist/update/` and writes `site/dist/download/manifest.json` from the release asset list. Ordinary docs deploys use `--release latest` so the machine endpoints remain present; the sync step runs before the upload, so a failed sync fails the workflow.

Three invariants must not break:

1. GitHub Releases keeps the complete electron-builder asset set. Existing apps only know the compiled-in GitHub feed and cannot discover a new channel.
2. Mirrored yml files must stay byte-for-byte identical to the GitHub release assets. Do not rewrite or re-serialize them: Ed25519 signatures cover their contents, and any change breaks updates.
3. Keep `artifactName` as `EchoFlow-Code-${version}-${os}-${arch}.${ext}`. The download-page manifest file names and installer verification both depend on it.

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

CI runs verification during the build. Locally, just confirm content alignment:

```bash
bun run scripts/release.ts <version> --dry   # dry-run: checks version/tag/notes consistency
bun run check:release-surface                # release surface: branding markers, version/brand drift, conflict residue
```

To run a full verification before tagging, trigger the `Quality Check` workflow manually from GitHub Actions.

Confirm `release-notes/v<version>.md` exists before running `bun run scripts/release.ts <version>` for real.

`check:release-surface` is the first check in the release workflow's `release-contract` job and a gate in `push-quality.yml`; it is read-only with no external dependencies and takes milliseconds, so it is worth confirming on its own before tagging.

### Verify one real update path

Every release should be verified by upgrading from the previous stable build at least once:

1. Install the previous stable release from GitHub Releases.
2. Push the tag and let the `Release Desktop` workflow finish green.
3. Open the old build and wait for the startup check, or check for updates manually in settings.
4. Confirm the new version is offered, then install and restart.
5. After restart, confirm the version in About, and that providers, sessions, skills, agents, memories, custom pets, and a custom data directory all still work.
6. Confirm historical attachment context, subagent details, and task state restore correctly; open a pet window and check the overlay and current-session navigation.

Platforms differ in what matters: on macOS confirm the release job used the signed artifacts and the launch-policy check passed; on Windows confirm `latest.yml`, `.exe`, and `.exe.blockmap` are all in the release assets, and remember that a SmartScreen prompt on an unsigned build does not mean the updater failed; on Linux verify auto-update through the AppImage, since `.deb` ships as a manual installer only.

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

`bun run verify` also needs no real model. Only the live baseline does. Maintainers can add a provider in the desktop app under Settings > Model settings, then run:

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
