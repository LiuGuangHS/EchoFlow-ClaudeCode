---
title: Live Model Quality Baseline
nav_title: Live Model Baseline
description: Maintainer procedures for provider smoke, Coding Agent baselines, and the release quality gate.
order: 12
---

# Live Model Quality Baseline

This is a maintainer runbook, not a normal PR requirement. Run a live provider or model only after deterministic checks pass, the provider scope is understood, and a maintainer authorizes quota use. Never put real tokens, response bodies, transcripts, or user configuration into a PR, docs, or shared artifacts; shared reports keep only bounded, redacted evidence.

## Before running

Confirm that deterministic checks for the current diff pass first:

```bash
bun run check:impact
bun run verify
```

`bun run verify` does not call real models. It must pass before a live failure can be attributed to a provider, model, or real cross-process path rather than a deterministic regression.

## Baseline and smoke

The default baseline is offline and does not call a model:

```bash
bun run quality:baseline
```

List providers saved by the local desktop app and copyable selectors:

```bash
bun run quality:providers
```

After explicit maintainer authorization, run a live baseline with a value printed by `quality:providers`:

```bash
bun run quality:gate --mode baseline --allow-live --provider-model <provider>:<model-or-role>:<label>
```

To run only provider smoke and desktop agent-browser smoke:

```bash
bun run quality:smoke --provider-model <provider>:<model-or-role>:<label>
```

Repeat `--provider-model` to run multiple models:

```bash
bun run quality:gate --mode baseline --allow-live \
  --provider-model <provider-a>:<model-or-role>:<label-a> \
  --provider-model <provider-b>:<model-or-role>:<label-b>
```

When no provider is saved, a maintainer may run a one-off environment-variable smoke. Do not put a real key in shell history, logs, or documentation:

```bash
QUALITY_GATE_PROVIDER_BASE_URL=<redacted> \
QUALITY_GATE_PROVIDER_API_KEY=<redacted> \
QUALITY_GATE_PROVIDER_MODEL=<model-id> \
QUALITY_GATE_PROVIDER_API_FORMAT=openai_chat \
bun run quality:gate --mode baseline --allow-live
```

The actual `provider-model` format and available selectors come from `bun run quality:providers`. When a model ID contains colons, prefer a role selector rather than manually splitting UUIDs or guessing provider configuration.

## What the baseline proves

The baseline starts an isolated local server, creates fixtures, asks a model through chat to complete Coding Agent tasks, runs verification commands, and saves transcripts, diffs, verification logs, and a report. Provider smoke separately checks upstream connectivity, proxy conversion, and streaming results. Model request headers, group fields, and error responses must be modelled from a redacted real request/response; a green offline double is not live evidence.

After deterministic contract/E2E checks pass, a maintainer should add a live baseline for changes involving:

- desktop chat, session recovery, WebSocket, or the CLI bridge;
- provider, model, or runtime selection;
- permissions, tool calls, file editing, or task execution;
- agent-browser, Computer Use, Skills, or MCP;
- release preparation or a high-risk cross-module refactor.

Fork PRs do not receive repository secrets, and contributors are not expected to pay for model calls. Record `live model: not run (untrusted fork / no provider)` for an external PR; a maintainer adds appropriate live evidence before merging or releasing.

## Evidence and failures

Reports normally live under:

```text
artifacts/quality-runs/<timestamp>/report.md
artifacts/quality-runs/<timestamp>/report.json
artifacts/quality-runs/<timestamp>/junit.xml
artifacts/quality-runs/<timestamp>/logs/*.log
```

The handoff records the provider selector, commands, exit status, whether live/model execution ran, report paths, and remaining risk. Do not share credentials, arbitrary message bodies, full stacks, user paths, or unredacted upstream responses.

Keep the SiHub lesson explicit: 695 offline token tests once passed while every live call failed on an undocumented `New-Api-User` header and group field. Until the real path is exercised, report "offline tests pass, live not verified", not "fixed".

## Release gate

A maintainer explicitly authorizes live checks before a release:

```bash
bun run quality:gate --mode release --allow-live --provider-model <provider>:<model-or-role>:<label>
```

Release mode combines PR checks, baseline catalog validation, live baseline, provider smoke, native checks, and the current platform's release `package-smoke`. Live lanes must not be silently skipped; missing provider access, quota, or external accounts must be recorded as a blocker and stop the release.
