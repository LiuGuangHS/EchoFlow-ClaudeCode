---
title: Dynamic Workflow
nav_title: Dynamic Workflow
description: Orchestrate agents in parallel or pipelines, then observe, interrupt, and recover runs from Activity.
order: 5
---

# Dynamic Workflow

Dynamic Workflow lets an agent turn coordinated, multi-step work into an executable orchestration script and run it in the same session. It is useful for independent checks, parallel research, and ordered handoffs; ordinary questions do not need a workflow.

## Good fits

- Review frontend, server, tests, or docs at the same time.
- Gather independent research before choosing a next step.
- Pass the result of one task to the next task in order.
- Save a proven orchestration as a reusable workflow command.

A small known edit, one command, or a single Subagent usually does not need a Workflow.

## Start a workflow

State the goal and constraints in a session. The agent can create and run a workflow, or save a completed orchestration as a workflow command. Before saving it, check that the script only requests tools and scope you are willing to authorize.

While it runs, the **Activity** panel shows phases, members, and progress. Open a member for its run history; open workflow activity for phase state and the final result.

## Parallel work and pipelines

- **Parallel work** is for independent checks, such as code review, security review, and test design.
- **Pipelines** are for steps that need a previous result, such as finding call sites, implementing, then verifying.
- Parallel execution does not reduce permissions or cost. Every member still consumes model usage and follows tool permissions.

## Interrupt and recover

- Interrupting stops work that is still running. It does not undo files already written to the workspace.
- Before resuming, review the existing diff, phase results, and failure reason.
- Completed runs remain in session Activity so you can inspect scripts, phases, and member output.
- If a workflow needs another run, restart from the failed phase or smallest scope when possible instead of repeating already-verified expensive work.

## Security and review

Workflows do not bypass session permissions. Members that write files, use Git, access the network, or call external services still follow the relevant permission rules. Do not place secrets, private paths, or unverified external content directly into a workflow script.

For workflows that write code, inspect the final diff, run focused tests, and use an isolated Worktree when appropriate.

## Next

- [Agent Teams](./agent-teams.md)
- [Subagents](./agents.md)
- [Sessions, permissions, and review](./sessions.md)
