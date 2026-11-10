---
title: Computer Use Verification Boundaries
nav_title: Verification boundaries
description: Distinguish protocol regression from hardware acceptance, including permissions, focus, displays, and window states.
order: 18
---

# Computer Use Verification Boundaries

Deterministic Computer Use regression and real-desktop acceptance answer different questions. This page defines verification scope, not a passed checklist, and makes no claim that any platform or application has completed hardware verification. See [Computer Use architecture](computer-use.md) for mechanisms and limits.

## What deterministic regression establishes

Temporary configuration, fake runners, and loopback transports can verify arguments, session identity, global enablement, errors, cancellation, and cleanup. Native event factories can check event order and window coordinates, but cannot prove OS or target-app acceptance.

These checks must not read real user homes, providers, tokens, or desktop data. Cross-process tests also need disposable directories. Live-model and real-desktop operations are separate evidence and do not belong in routine deterministic gates.

## Boundaries needing separate observation

| Scope | Evidence to record |
| --- | --- |
| Installed macOS authorization | Accessibility, Screen Recording, signing identity, permission state after rebuilds or updates |
| Target and focus | Actual foreground/background process, window identity, human input, physical-pointer interference |
| CEF/Electron | Receiver-visible clicks and text, not just a successful action receipt |
| Multiple displays and occlusion | Coordinate conversion, capture scope, visible cursor feedback |
| Fullscreen and other Spaces | Foreground or Space changes, capture freshness, refusal reasons |
| Minimized and hidden targets | Whether observation or actions restore or activate a window and when fresh observation is required |
| Fullscreen combined with minimization or hiding | Explicit refusal of an unreachable target rather than a false completion receipt |
| Windows/Linux | Native capabilities, physical-input side effects, graphical sessions, platform limits |

These are verification dimensions, not promises that other-Space, hidden, or minimized windows are controllable. Each finding needs app and OS versions, initial window state, procedure, and receiver-visible before/after changes.

## Receipts are not results

Allow only one experimenter to operate a target app and use unique input markers. Other Agents or a person's edits must not be mistaken for the experiment's success. After a timeout, cancellation, or partial delivery, observe again rather than repeat possible side effects.

Release and regression reports should separate passed, failed, blocked, and not run. Builds, mocks, and hardware observations are not interchangeable. See [compatibility evaluation](computer-use-codex-parity-review.md) for protocol-level evidence.
