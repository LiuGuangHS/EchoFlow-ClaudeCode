---
title: Execution, Data, and Trust Boundaries
nav_title: Execution Boundaries
description: Ownership and verification rules for runtimes, session persistence, external messages, and desktop navigation.
order: 16
---

# Execution, Data, and Trust Boundaries

This standard defines responsibility from session input through execution, persistence, and outbound delivery. These are requirements for implementation and review, not a claim that every path has passed verification or authorization to start a runtime migration. See [Architecture overview](./index.md) for the current structure and [Contributing and quality gates](./contributing.md) for the check workflow.

## Four rules to remember

1. **EchoFlow product capabilities are independent of the execution engine.** Projects, workspaces, session management, tasks, Agent Teams, schedules, memory, extensions, notifications, and IM integration belong to the product layer. Changing or adding an engine must not remove them or make the engine a second product entry point.
2. **One operation has one execution owner.** Select the execution binding before submission. After acceptance, consumption, or uncertain consumption, do not automatically switch engines and replay. Leave a diagnosable state and a manual recovery path; a successful retry is not proof of exactly-once execution.
3. **Each kind of source data has explicit authority.** Sessions, approvals, archives, and attachments need their own writing and coordination contracts, not two unrelated writers both claiming authority. This does not require one process to write every record. Caches, indexes, and UI state are projections; they must not recreate deleted source data.
4. **Test boundaries at real entry points.** Unit tests prove parsing and local logic. Cross-process flows, platform callbacks, file delivery, and Electron navigation need a real entry point or an isolated loopback fixture, not only a mock of the module under test.

## Ownership model

| Object | Responsibility | Disallowed substitute |
| --- | --- | --- |
| Product capabilities | EchoFlow Server, desktop, and adapters orchestrate product features | Replacing product features with an Agent SDK or CLI's default behavior |
| Agent turns | The current CLI/Agent core executes tools, permissions, compaction, subagents, and turn recovery | Implementing a second turn loop in Server, an adapter, or another sidecar |
| Session source data | Preserve each transcript and metadata persistence contract; indexes and lists are rebuildable projections | Adding a second authoritative transcript beside legacy JSONL without an explicit ownership contract |
| Execution binding | Choose the engine, process, and required capabilities before submission; an accepted operation must not silently change owner | Switching engines after delivery, double-running side-effecting tools, or unconditional replay |
| Approval decision | The request owner stores pending state; the authenticated platform envelope supplies actor identity | Inferring identity from card fields, chat text, or a client-supplied `userId` |

The binding rule does not prohibit model configuration changes in later turns through an existing protocol. Before introducing a native module, define its boundary with Server, CLI core, and persistence owners, then provide protocol, recovery, and real process-restart evidence. Replacing one sidecar is not migration acceptance.

## Trust boundaries

### Outbound files and images

Agent output is not automatically a trusted attachment. Reuse the safe loading boundary in `adapters/common/attachment/outbound-image.ts`:

- the session must have an explicit work directory;
- resolve both the file path and work directory with `realpath`; the target must remain inside the work directory and be a regular file;
- both files and inline images must meet the existing size limit and MIME allowlist; file-path checks do not apply to inline data;
- the local send path must not automatically fetch a remote URL produced by the agent.

Platform APIs upload validated bytes. They do not redefine path, size, or remote-address policy.

### Platform approval callbacks

Card content and client parameters are not identity credentials. Take the actor from the authenticated platform envelope and check:

- the request ID is still pending;
- the actor is the intended recipient and is still authorized;
- the card or callback instance belongs to that request;
- allow-once, always-allow, and deny all pass through the same authorization check.

A missing, forged, expired, or mismatched callback must not change pending state. Route the business action from server-held request context, not a client-supplied `chatId`.

### Electron navigation

A window with file, terminal, session, and IPC privileges may navigate only to the configured development origin or the exact packaged renderer entry, including legitimate hash routes. Other `file:` URLs, other loopback origins, and external pages must not inherit main-window privileges; HTTP/HTTPS links go to the system browser.

Verify this rule at `will-navigate`, main-frame `will-redirect`, and new-window entry points. Preview and subframe content must not promote itself to a trusted renderer through these paths. Passing top-level navigation tests alone does not prove subframe isolation.

### Documentation publication

`docs/_internal/` contains maintainer material, not public documentation. Exclude it during scanning for the manifest, content modules, search index, static routes, and sitemap, not merely from navigation. Public Chinese and English pages stay paired. The internal directory must not contain credentials or real user state either.

## Persistence and deletion

### Migrations

Changes to persisted JSON, localStorage, app-config, or session-metadata formats must:

1. provide a forward migration from the old format;
2. preserve unknown fields and unrelated settings;
3. cover the real startup read order with an old fixture;
4. pass `bun run check:persistence-upgrade`.

An unsupported future version must remain unchanged and stop writing back. Do not load defaults and later overwrite future data through debounce, `pagehide`, or `dispose`.

### Write failures

A write queue must retain the target file identity so a replaced file cannot receive old data. When open, append, close, or a later flush fails:

- bytes confirmed written must not be replayed blindly;
- an ambiguous append must not be repaired by truncating another writer's bytes;
- entries not submitted and still belonging to the original file must be discoverable by a later flush;
- background timer failures must be observable and clear drain state, rather than leaving an unhandled rejection or a permanently stuck queue.

This is not an exactly-once promise. Preserve a diagnosable unconfirmed state rather than treating an uncertain side effect as safe to retry.

### Deletion and archives

Single and batch deletion should have consistent deletion results. Clearing a transcript and deleting a session are distinct operations with their own user-visible semantics, but share these safety constraints:

- re-check protection across processes under the applicable archive lock;
- define ownership and handling of transcripts, tool results, subagent transcripts, and archive metadata;
- retention cleanup respects archive intent; an explicit user deletion handles archive metadata under the deletion contract, without allowing old indexes or archive records to recreate the session;
- delayed writes must not recreate deleted sessions or restore content from before a clear;
- unrelated sessions, workspaces, and in-use files remain untouched.

An archive is a retention decision, not a second transcript. Corrupt or unsupported archive state stops destructive cleanup and reports an error.

## Verification and handoff

Use [Contributing and quality gates](./contributing.md#regression-test-design) for test design and commands. Boundary fixes need at least this evidence:

| Risk | Required evidence |
| --- | --- |
| Migrations and startup reads | Old fixtures, unknown fields, future versions, and real read order |
| Approvals and adapter routing | Actual entry point with mock transport; accepted, rejected, duplicate, and expired paths |
| File delivery and concurrent writes | Temporary directories, real path/file identity, and fault injection; cross-process claims need multiple processes |
| Electron host and navigation | Main-process tests plus isolated desktop/browser smoke; renderer unit tests cannot replace them |
| Recovery and deletion | Failure, duplicates, late events, and state after restart; same-process resume cannot replace real process restart |

Record each check as `passed`, `failed`, `blocked`, `skipped`, or `not run`. Mocks, successful builds, real browsers, real platform callbacks, and live providers are different evidence. State missing layers explicitly; an old report cannot cover a current failure. Real model or platform checks still need explicit authorization; finding local credentials is not authorization.

## Explicit non-goals

- Do not create a second RuntimeHost, a conflicting session writer, or use temporary global cwd/env changes as concurrency isolation.
- Do not change Computer Use's all-app authorization boundary through per-app allowlists, denylists, or permission tiers.
- Do not put internal design drafts, real user configuration, tokens, QR codes, provider keys, or local paths in public documentation.
- Do not lower coverage baselines, loosen assertions, or rerun failures until one happens to pass to hide a problem.

The root and directory-level `AGENTS.md` files remain the source of truth for code-entry rules. This page stores cross-directory invariants, not implementation or verification records.
