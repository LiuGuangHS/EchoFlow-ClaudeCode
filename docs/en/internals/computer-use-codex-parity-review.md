---
title: Evaluating Computer Use Compatibility
nav_title: Compatibility evaluation
description: Evaluate native protocol compatibility by call path, environment, and evidence rather than completion percentages.
order: 17
---

# Evaluating Computer Use Compatibility

Computer Use compatibility describes specific interfaces, target environments, and verification scope. A single completion percentage cannot represent success rates across applications. See [Computer Use architecture](computer-use.md) for product boundaries and [native protocol contracts](computer-use-codex-impl-blueprint.md) for macOS call boundaries.

## Compare actual call paths

A compatibility finding should identify the interface or client version, platform and target app, arguments and result structure, process/window binding, delivery mechanism, and receiver-visible changes.

Native App coordinate input and browser Tab/DOM providers are different mechanisms. Results from one do not establish the other. Missing symbols in a binary import table or string listing do not independently prove the absence of dynamically resolved runtime calls.

## Report evidence separately

| Evidence | Establishes | Does not replace |
| --- | --- | --- |
| Schema, argument, and mock-transport tests | Validation, errors, cancellation propagation | Real desktop input |
| Native event-factory tests | Event order, window and coordinate fields | Target acceptance and completion |
| Hardware observations of a specific app | Behavior for that version, environment, and procedure | All-app or model-task success rates |
| Model-task records | The call path actually exercised by that task | Compatibility of unexecuted features |

## Failures and performance are contracts too

Compatibility includes more than the happy path. Stale handles, ambiguous targets, revoked permissions, process exit, timeouts, partial delivery, and cancellation need accurate semantics. Relaxing identity checks or replaying side effects cannot improve genuine compatibility.

Performance records should separate model round trips, action counts, observation counts, and tool duration. A session containing long idle periods cannot establish per-input latency, and another engine's trace cannot benchmark this implementation.

See [verification boundaries](computer-use-native-manual-qa.md) for hardware environments and limits. This page defines an evaluation method, not new hardware test results.
