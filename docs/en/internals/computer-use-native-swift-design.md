---
title: Computer Use Swift Helper Design
nav_title: Swift Helper
description: Observation, input, permissions, and shared-desktop boundaries in the macOS native helper.
order: 14
---

# Computer Use Swift Helper Design

The Swift `cu-helper` performs native Computer Use operations on macOS. It places AX observation, window capture, and target-process input inside one native boundary. Windows/Linux use a separate agent-desktop engine rather than this implementation. See [Computer Use architecture](computer-use.md) for the complete call path.

## Responsibilities

| Boundary | Responsibilities |
| --- | --- |
| TypeScript host | Platform readiness, global enablement, session lock, cancellation, native transport |
| Swift helper | Process/window validation, AX trees and actions, targeted input, capture |
| Operating system | Accessibility, Screen Recording, application focus, graphical session |

Source lives in `native/cu-helper/Sources/cu-helper/`. AX element resolution, window coordinates, event construction, and capture have separate contracts. Success in one does not establish availability of the others.

## Permissions and signing

Enabling Computer Use in Settings and confirming consent once authorizes all supported apps, without extra per-app approvals, application lists, or permission tiers. Global disablement, OS permissions, and target validity checks still apply.

macOS Accessibility and Screen Recording are separate permissions. Package, host, and helper signing and launch methods affect how the OS identifies the responsible application. A working development binary does not establish installed-app authorization, permission retention after updates, or packaging correctness.

## An unmoved pointer is not complete isolation

AX operations and `CGEvent.postToPid` targeted input do not need the physical pointer for targeting. The virtual cursor is visual feedback, not a second hardware mouse. The graphical session, focus, and clipboard remain shared, and a person editing the same app can interfere with the Agent.

Covered, hidden, minimized, or other-Space windows require separate judgments about capture freshness and input reachability. If target identity or fresh pixels cannot be established, cached screenshots or a dispatch receipt are not completion evidence. See [verification boundaries](computer-use-native-manual-qa.md).
