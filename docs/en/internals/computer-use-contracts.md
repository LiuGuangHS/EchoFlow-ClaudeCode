---
title: Computer Use Contracts and Verification
nav_title: Contracts and verification
description: Contracts for observation, window input, and action receipts, and the distinct limits of deterministic regression and hardware evidence.
order: 13
---

# Computer Use Contracts and Verification

Tool registration, runtime readiness, input dispatch, and receiver-visible completion are different Computer Use states. This page explains contracts and verification methods, not a passed acceptance checklist or a claim that historical designs and experiments are implemented capabilities. See [Computer Use architecture](computer-use.md) for platform support, authorization, sessions, and distribution.

<a id="computer-use-swift-helper-design"></a>
<a id="computer-use-native-protocol-contracts"></a>
<a id="responsibilities"></a>

## JavaScript and native boundaries

| Boundary | Responsibilities |
| --- | --- |
| TypeScript host | Platform readiness, global enablement, session lock, cancellation, native transport |
| macOS Swift helper | Process/window validation, AX trees and actions, targeted input, capture |
| Operating system | Accessibility, Screen Recording, application focus, graphical session |

A persistent macOS JavaScript session binds a target through `cua.getApp()` and forwards native calls through the host. Entry points include `src/utils/computerUse/replRuntime.ts`, `replWorker.ts`, `replCompiler.ts`, and `src/vendor/computer-use-mcp/replApi.ts`; native code lives in `native/cu-helper/Sources/cu-helper/`. An App object inside a script cannot bypass global authorization, process identity, window validation, or cancellation.

Windows/Linux use a separate agent-desktop engine, not the Swift helper's input mechanism. Native App input and browser Tab/DOM automation are also separate paths. Sending native coordinates to a browser does not supply DOM nodes or Playwright capabilities.

## Permissions and signing

Enabling Computer Use in Settings and confirming consent once authorizes all supported apps, without extra per-app approvals, application lists, or permission tiers. Global disablement, OS permissions, and target validity still apply. See the [overview](computer-use.md#one-application-authorization-boundary) for configuration preservation and data boundaries.

macOS Accessibility and Screen Recording are separate permissions. Package, host, and helper signing and launch methods affect how the OS identifies the responsible application. A working development binary does not establish installed-app authorization, permission retention after updates, or packaging correctness. Unsigned/ad-hoc distribution packages cannot pass existing helper attestation: Computer Use is unavailable and updates require manual installation. A successful build of such a package is not CU acceptance; see [build and distribution](computer-use.md#build-and-distribution).

<a id="cef-and-electron-window-input"></a>
<a id="computer-use-observation-and-execution-layers"></a>
<a id="observation-establishes-targeting"></a>
<a id="element-and-window-contracts"></a>
<a id="process-window-and-coordinates-form-one-chain"></a>

## Observation, elements, and windows

AX trees provide control semantics, and window screenshots provide visible context. Both must bind to the same process, window, and coordinate relationship, not merely similar titles. A screenshot does not establish that the interface remains unchanged: handles need generation and live-identity checks, and images need freshness checks. macOS AX handles carry a generation; observe again after a stale reference rather than guessing its current position.

Custom-rendered interfaces may expose incomplete AX trees. Their coordinate path still needs window identity and a valid screenshot. Missing AX nodes do not establish that an app is entirely uncontrollable; present nodes do not guarantee support for an action. Scaled screenshot coordinates, window points, and global coordinates need consistent conversion, including multiple displays and Retina scaling.

Chromium, CEF, and Electron input routing also depends on window identity. A PID and screen coordinates alone cannot establish that the intended control received input. `WindowTargetedEvent.swift` constructs window events, and `Injection.swift` handles delivery; `AXAction.swift`, `WindowGeometry.swift`, and `MouseDragEventTests` cover actions, coordinates, and drag-event order. Event factories must preserve consistent window binding and event order, but correct construction does not establish target acceptance.

<a id="actions-are-not-observations"></a>
<a id="execution-and-the-next-observation-are-separate"></a>
<a id="focus-and-receipt-limits"></a>
<a id="an-unmoved-pointer-is-not-complete-isolation"></a>
<a id="visual-feedback-is-not-targeting-evidence"></a>

## Actions, focus, and visual feedback

Known actions can execute serially inside one script, explicitly requesting AX state or screenshots at the next decision point rather than requiring a model round trip for every input. Image output, text output, and native-state refresh are distinct. Menu, window, or interface-structure changes require a usable observation baseline again, not reuse of invalid references.

Action receipts, event dispatch, and receiver-visible completion are also distinct. Batch execution is not a transaction: timeouts, cancellation, script failures, or partial delivery do not roll back completed side effects. Observe the current state before continuing. Do not automatically replay actions or silently switch execution paths to retry.

Window routing does not replace focus, process-lifetime, or human-interference checks. macOS AX operations and targeted input that leave the physical pointer alone do not provide an independent desktop or a universal Windows/Linux promise. The graphical session, focus, and clipboard remain shared, and a person editing the same app can interfere with the Agent.

A virtual cursor is visual feedback, not a second hardware mouse or independent desktop. Hidden or covered windows, multiple monitors, and Space switches affect feedback visibility; a completed animation does not establish input delivery. Covered, hidden, minimized, or other-Space targets require separate judgments about capture freshness and input reachability. Cached pixels or a dispatch receipt are not completion evidence.

<a id="computer-use-verification-boundaries"></a>
<a id="evaluating-computer-use-compatibility"></a>
<a id="what-deterministic-regression-establishes"></a>
<a id="evidence-limits"></a>
<a id="verification-entry-points"></a>
<a id="compare-actual-call-paths"></a>
<a id="report-evidence-separately"></a>

## Deterministic regression and hardware evidence

Temporary configuration, fake runners, simulated native tools, and loopback transports can verify arguments, session identity, global enablement, errors, cancellation, cleanup, and worker isolation. Cross-process tests also use disposable directories and must not read real user homes, providers, tokens, or desktop data. Live-model and real-desktop operations are separate evidence, not routine deterministic gates.

| Evidence | Establishes | Does not replace |
| --- | --- | --- |
| Schema, argument, and mock-transport tests | Validation, errors, cancellation propagation | Real desktop input |
| Native event-factory tests | Event order, window and coordinate fields | OS or target acceptance and completion |
| Hardware observations of a specific app | Behavior for that version, environment, and procedure | All-app or model-task success rates |
| Model-task records | The call path actually exercised by that task | Compatibility of unexecuted features |

A compatibility finding identifies the interface or client version, platform and target app, arguments and result structure, process/window binding, delivery mechanism, and receiver-visible changes. Similar tool names, one successful task, or completion percentages do not replace this evidence. Results from one native or DOM path do not establish another. Missing symbols in a binary import table or string listing do not independently prove the absence of dynamically resolved runtime calls.

### Boundaries needing separate observation

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

These are verification dimensions, not promises that other-Space, hidden, or minimized windows are controllable. Findings also need app and OS versions, initial window state, procedure, and receiver-visible before/after changes. macOS compilation or mocks do not establish Windows/Linux input behavior.

### Receipts are not results

Allow only one experimenter to operate a target app and use unique input markers. Other Agents or a person's edits must not be mistaken for the experiment's success. After a timeout, cancellation, or partial delivery, observe again rather than repeat possible side effects.

Release and regression reports should separate passed, failed, skipped, blocked, and not run. Builds, mocks, and hardware observations are not interchangeable. This page makes no claim of new hardware test results.

<a id="performance-optimization-must-retain-validation"></a>

## Failures and performance are contracts too

Stale handles, ambiguous targets, revoked permissions, process exit, timeouts, partial delivery, and cancellation need accurate failure semantics. Performance optimization must retain process identity, focus acknowledgement, cancellation, and input-release protection. Replaying side effects cannot improve genuine success rates.

Performance records should separate model round trips, action counts, observation counts, AX traversal, capture, input, tool duration, and receiver-visible completion. A session containing long idle periods cannot establish per-input latency, another engine's trace cannot benchmark this implementation, and a fixed wait from one application's experiment is not a specification for every application.
