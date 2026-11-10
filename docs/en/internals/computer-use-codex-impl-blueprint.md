---
title: Computer Use Native Protocol Contracts
nav_title: Native protocol
description: Implementation boundaries for macOS JavaScript sessions, AX elements, window events, and explicit observation.
order: 15
---

# Computer Use Native Protocol Contracts

Native Computer Use on macOS separates JavaScript scheduling, interface observation, and input delivery. Compatibility must be checked along the actual call path; similar tool names or success on one task cannot establish complete compatibility. See [Computer Use architecture](computer-use.md) for platform differences and authorization.

## JavaScript and native boundaries

A persistent JavaScript session binds a target through `cua.getApp()` and forwards native calls through the host. Entry points include `src/utils/computerUse/replRuntime.ts`, `replWorker.ts`, `replCompiler.ts`, and `src/vendor/computer-use-mcp/replApi.ts`. An App object inside a script cannot bypass global authorization, process identity, window validation, or cancellation.

Native App input and browser Tab/DOM automation are different paths. Sending native coordinates to a browser does not supply DOM nodes or Playwright capabilities.

## Element and window contracts

- AX elements use generation-bearing handles such as `g17:4`. Actions recheck the process, window, and element. Observe again after a stale reference rather than guessing its current position.
- Capture and input share window identity and a coordinate transform. Neither a similar title nor independently calculated scale factors establish a target.
- The coordinate-drag event factory preserves mouseDown, mouseDragged at the origin/midpoint/destination, and mouseUp, with one window binding. Implementation and tests are concentrated in `AXAction.swift`, `WindowTargetedEvent.swift`, `WindowGeometry.swift`, and `MouseDragEventTests`.

## Actions are not observations

Scripts can execute known actions consecutively and explicitly request AX state or screenshots at the next decision point. Image output, text output, and native-state refresh are distinct. Menu, window, or interface-structure changes require a usable observation baseline again.

Batch execution is not a transaction. Timeouts, cancellation, script failures, or partial delivery do not roll back completed side effects. Observe the current state before continuing; never automatically replay actions.

## Evidence limits

Worker tests using temporary directories and simulated native tools establish isolation and protocol boundaries. Event-factory tests establish event construction. Neither proves success rates across real applications, OS versions, or model tasks. Performance measurements should separate model round trips, actions, observations, and receiver-visible completion; see [compatibility evaluation](computer-use-codex-parity-review.md).
