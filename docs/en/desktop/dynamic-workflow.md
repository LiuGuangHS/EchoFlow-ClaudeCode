---
title: Dynamic Workflow
nav_title: Dynamic Workflow
description: EchoFlow Code Dynamic Workflow: let the agent write an orchestration script, run agents in parallel or in a pipeline, and observe, interrupt and recover runs from the Activity panel.
order: 5
---

# Dynamic Workflow

Dynamic Workflow is EchoFlow Code's multi-step agent orchestration capability. The agent writes an executable script, schedules parallel checks or ordered handoffs in the same session, and shows phase and member progress in Activity. Use it for coordinated work with explicit dependencies, combined findings, or reusable steps; ordinary questions and small edits do not need a workflow.

## Good fits

- Review frontend, server, tests, or docs at the same time.
- Gather independent research before choosing a next step.
- Pass the result of one task to the next task in order.
- Save a proven orchestration as a reusable workflow command.

A small known edit, one command, or a single Subagent usually does not need a Workflow.

## Start a workflow

State the goal and constraints in a session. The agent can create and run a workflow, or save a completed orchestration as a workflow command. Before saving it, check that the script only requests tools and scope you are willing to authorize.

While it runs, the **Activity** panel shows phases, members, and progress. Open a member for its run history; open workflow activity for phase state and the final result.

Try a read-only flow before saving a command:

```text
Use Dynamic Workflow for a read-only change-risk review of this project.
First read git diff to establish the scope; stop and explain if nothing changed.
Then run two checks in parallel: A finds affected callers; B finds relevant
tests and uncovered edge cases. Wait for both before summarizing. Report only
risks with file paths and evidence, and suggest the smallest verification commands.
Do not edit files, install dependencies, call external services, commit code,
or save a command. If a phase fails, preserve completed findings, explain the
failure, and do not claim the review passed.
```

The prompt states goals and constraints, not an additional permission gate. Set session permissions to match the task.

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

## Acceptance and limits

- The example should establish scope first, run two independent checks, then summarize. Findings should cite files or test evidence, not just completion status.
- A run without errors does not prove the code is correct. Inspect the script, member output, final diff, and focused test results. List failed or skipped checks separately.
- Stopping is not rollback, and recovery does not make every step safe to replay. Before rerunning steps that write files or call external services, check for existing effects to avoid duplicate edits or requests.
- If one known command solves the task, use it directly. Multi-agent orchestration adds model calls and does not guarantee faster, cheaper, or more reliable results.

## Common distinctions

**How does Dynamic Workflow differ from Agent Teams?** Workflow focuses on executable orchestration, parallel work, and ordered handoffs. [Agent Teams](./agent-teams.md) focuses on visually coordinating team roles, shared tasks, messages, and dependencies.

**Is it the same as a scheduled task?** No. Workflow describes how work is coordinated; [scheduled tasks](./schedule.md) determine when a task starts automatically. Saving a workflow command does not schedule it, and its authorized scope still needs review before saving.

## Next

- [Agent Teams](./agent-teams.md)
- [Subagents](./agents.md)
- [Sessions, permissions, and review](./sessions.md)
