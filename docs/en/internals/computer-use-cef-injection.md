---
title: CEF and Electron Window Input
nav_title: Window input
description: Window identity, coordinates, and focus in macOS targeted input, and why dispatch receipts do not prove successful interaction.
order: 13
---

# CEF and Electron Window Input

Posting an event to a macOS process also requires binding it to the correct window. Chromium, CEF, and Electron input routing depends on window information; a target PID and screen coordinates alone do not prove that the intended control received input. See [Computer Use architecture](computer-use.md) for the platform overview.

## Process, window, and coordinates form one chain

`native/cu-helper/Sources/cu-helper/WindowTargetedEvent.swift` constructs window-targeted events, and `Injection.swift` handles delivery. Mouse events are constructed through AppKit and converted to CGEvents, retaining target-window identity and global and window-local positions before posting to the PID.

- Capture and input must bind to the same process and window, not merely similar titles.
- Scaled screenshot coordinates, window points, and global coordinates need consistent conversion, including multiple displays and Retina scaling.
- AX semantic actions and coordinate events are separate paths. A missing AX action does not establish that coordinate input will work.

## Focus and receipt limits

Window routing does not replace focus, process-lifetime, or human-interference checks. Background input is not an independent desktop: the target can change focus, and the system clipboard remains shared. Fixed delays from historical experiments are not universal contracts for all applications.

Successful event construction or an action receipt does not prove that the interface changed. Observe window state again at the next decision point. After a timeout, cancellation, or partial delivery, establish the current state before repeating clicks, pastes, or other side effects.

## Verification entry points

Deterministic event-factory tests can check window binding, coordinates, and event order, but cannot establish input acceptance across all CEF/Electron versions. Foreground/background interaction, multiple displays, hiding, and minimization require separate hardware evidence; see [verification boundaries](computer-use-native-manual-qa.md).
