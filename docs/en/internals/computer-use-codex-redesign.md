---
title: Computer Use Observation and Execution Layers
nav_title: Observation and actions
description: Why interface observation, target resolution, input delivery, and visual feedback need separate contracts.
order: 16
---

# Computer Use Observation and Execution Layers

Computer Use is not simply repeated full-screen capture followed by coordinate guesses. Observation, targeting, and actions must bind to the same target while retaining separate failure semantics. This page explains the layering principles; see [Computer Use architecture](computer-use.md) for current platform implementations.

## Observation establishes targeting

AX trees provide control semantics, and window screenshots provide visible context. Both need an explicit process, window, and coordinate relationship. A screenshot does not prove that the interface remains unchanged later. Element handles need generation and live-identity checks, while images need freshness checks.

Some custom-rendered interfaces expose incomplete AX trees. Their coordinate path still needs window identity and a valid screenshot. Missing AX nodes do not establish that an app is entirely uncontrollable; present AX nodes do not guarantee that a control supports an action.

## Execution and the next observation are separate

Known actions can execute serially inside one script, with observation requested at the next decision point. Not every input needs another model round trip, but a changed interface cannot safely reuse invalid references.

Action receipts, event dispatch, and receiver-visible completion are different facts. A failure or cancellation may follow side effects, so automatic retries cannot resolve an unknown result. See [native protocol contracts](computer-use-codex-impl-blueprint.md).

## Visual feedback is not targeting evidence

A virtual cursor helps a person understand where the Agent is acting. It is neither an independent desktop nor a copy of the physical pointer. Hidden or covered windows, multiple monitors, and Space switches affect feedback visibility. A completed cursor animation does not establish input delivery.

## Performance optimization must retain validation

Measure model round trips, AX traversal, capture, input, and receiver-visible changes separately. Removing redundant waits must retain process identity, focus acknowledgement, cancellation, and input-release protection. A delay observed in one application is not a specification for every application.

Platform engines have different input mechanisms and capabilities. macOS background targeted input is not a universal Windows/Linux promise; see [verification boundaries](computer-use-native-manual-qa.md).
