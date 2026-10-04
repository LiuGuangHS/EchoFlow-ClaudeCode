---
title: Agent Teams workbench
nav_title: Agent Teams
description: See multi-agent members, shared tasks, communication, and dependencies in the desktop app.
order: 4
---

# Agent Teams workbench

Use Agent Teams when a task genuinely needs coordinated roles: one agent researches, another implements, another tests, and another reviews. This is more than a Subagent list: the workbench puts members, shared tasks, communication, and dependencies in one place.

## When to use it

- The work can be divided into mostly independent roles or phases.
- You need to see who is working, what is blocked, and why.
- You want one lead session to collect several members' results.

If you already know that a single file needs one small change, working in the current session is usually faster.

## Open a workbench from a session

Ask the agent in a session to create or join a Team. Once it starts, open the **Activity** panel in the top-right and select the team entry to open its workbench.

The workbench shows live team state. After a team finishes, its completed session can still reopen the archived snapshot and member run history from Activity.

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

## Next

- [Subagents](./agents.md)
- [Sessions, permissions, and review](./sessions.md)
- [Workspace](./workspace.md)
- [Dynamic Workflow](./dynamic-workflow.md)
