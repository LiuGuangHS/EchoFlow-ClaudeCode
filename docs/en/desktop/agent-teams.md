---
title: Agent Teams workbench
nav_title: Agent Teams
description: The EchoFlow Code Agent Teams workbench: see team members, shared tasks, communication and dependencies in one place, with blocked tasks flagged.
order: 4
---

# Agent Teams workbench

Agent Teams is EchoFlow Code's multi-agent collaboration workbench, bringing team members, shared tasks, member communication, and task dependencies into one view. Use it for work that needs distinct roles and ongoing coordination, such as research, implementation, testing, and review. See who is working or blocked by a prerequisite, then open member run history to investigate. It is more than an ordinary Subagent list.

## When to use it

- The work can be divided into mostly independent roles or phases.
- You need to see who is working, what is blocked, and why.
- You want one lead session to collect several members' results.

If you already know that a single file needs one small change, working in the current session is usually faster.

## Open a workbench from a session

Ask the agent in a session to create or join a Team. Once it starts, open the **Activity** panel in the top-right and select the team entry to open its workbench.

The workbench shows live team state. After a team finishes, its completed session can still reopen the archived snapshot and member run history from Activity.

Start with a copyable read-only task to learn the coordination flow:

```text
Create an Agent Team for a read-only test-coverage review of this project.
Member A finds core features and call sites; member B finds existing tests
and test commands. After both finish, member C uses their findings to suggest
the 3 most valuable regression tests. Put the work in the shared task list,
mark C as depending on A and B, and summarize file paths and evidence in the
lead session. Do not edit files, install dependencies, call external services,
or commit code. Explicitly identify anything you did not verify.
```

These are instructions to the agent, not an additional permission sandbox. Also choose an appropriate [permission mode](./sessions.md) when restricting writes.

## Read the workbench

- **Summary** shows the team phase plus completed and total tasks.
- **Members** show each member's state, current work, and recent activity. Select a member to open their run history.
- **Shared tasks** are one task list for the whole team. Completing prerequisites releases dependent work; blocked tasks stay marked as blocked.
- **Communication** shows member messages and task notifications so you can spot stalled coordination.
- **Dependency lanes** arrange tasks by dependency. They are an observation view; they do not reorder work for you.

## Stop, recover, and diagnose

- Stopping the lead session stops work that is still running in that session. Check Activity first for background members.
- If a member stalls, open its run history and inspect the last tool call, permission request, or error.
- Finished teams can be reopened from their session Activity history. Archives let you inspect state and context; they do not automatically run members again.
- A final workbench snapshot remains readable when a team is removed. Do not treat it as the only backup of source code or conversation history.

## Permissions and data boundaries

Each Team member still follows its session's provider, model, tools, and permission mode. The workbench only shows coordination state and permitted run events; it does not bypass permissions or expose provider credentials to other members.

For sensitive repositories, start in an isolated Worktree before creating a team. Review final source changes file by file in the workspace.

## Acceptance and limits

- In the example, A and B should each produce findings before C uses them to make suggestions. Shared task status is not evidence by itself.
- The lead session should provide file paths you can open, evidence from existing tests, and unverified items. After read-only work, use `git status` and `git diff` to check for unintended writes.
- For implementation work, a member marked complete does not mean tests passed. Review the diff file by file and run tests that match the goal.
- More members mean more model calls and coordination overhead. Keep small edits in one session. If members need to edit the same file, define write ownership first; the shared task list is not file isolation.

## Common distinctions

**How is Agent Teams different from a normal subagent?** A subagent fits a bounded task that returns its result to the lead session. Teams fits ongoing work needing shared tasks, member communication, and dependency coordination. See [Subagents](./agents.md).

**When should I choose Teams instead of Dynamic Workflow?** Choose Teams when the focus is observing and coordinating roles, tasks, and messages. Choose [Dynamic Workflow](./dynamic-workflow.md) when you want executable steps, parallel work or pipelines, and reusable orchestration. Neither replaces final tests and human review.

## Next

- [Subagents](./agents.md)
- [Sessions, permissions, and review](./sessions.md)
- [Workspace](./workspace.md)
- [Dynamic Workflow](./dynamic-workflow.md)
