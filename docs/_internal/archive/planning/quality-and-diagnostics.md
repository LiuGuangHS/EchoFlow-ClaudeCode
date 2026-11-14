---
title: 质量门禁、Hook 与诊断（历史归档）
nav_title: 质量门禁、Hook 与诊断
description: 合并保存 2026 年的相关设计、计划与任务记录，不作为现行执行指令。
order: 5
---

# 质量门禁、Hook 与诊断（历史归档）

本页于 2026-11-14 按主题合并旧 Superpowers 资料，保留原设计、计划、任务摘要和进度；仅调整标题层级、旧路径、插件要求与本地绝对路径。原文中的版本、审批、完成状态和测试结果均为当时记录，不代表当前实现、当前授权或本次验证。不得按归档中的命令直接继续旧任务。

现行要求以仓库 AGENTS.md、[执行与信任边界](../../../internals/execution-boundaries.md) 和 [贡献流程](../../../internals/contributing.md) 为准；[返回归档索引](README.md)。

## 来源目录

- [sdd/2026-10-31-diagnostic-remediation/progress.md](#sdd-2026-10-31-diagnostic-remediation-progress)
- [sdd/2026-10-31-diagnostic-remediation/task-1-brief.md](#sdd-2026-10-31-diagnostic-remediation-task-1-brief)
- [sdd/2026-10-31-diagnostic-remediation/task-2-brief.md](#sdd-2026-10-31-diagnostic-remediation-task-2-brief)
- [sdd/2026-10-31-diagnostic-remediation/task-3-brief.md](#sdd-2026-10-31-diagnostic-remediation-task-3-brief)
- [sdd/2026-10-31-diagnostic-remediation/task-4-brief.md](#sdd-2026-10-31-diagnostic-remediation-task-4-brief)
- [sdd/2026-10-31-diagnostic-remediation/task-5-brief.md](#sdd-2026-10-31-diagnostic-remediation-task-5-brief)
- [sdd/2026-10-31-diagnostic-remediation/task-6-brief.md](#sdd-2026-10-31-diagnostic-remediation-task-6-brief)
- [plans/2026-10-18-claude-hook-policy.md](#plans-2026-10-18-claude-hook-policy)
- [plans/2026-10-29-quality-gate-integrity.md](#plans-2026-10-29-quality-gate-integrity)
- [plans/2026-10-30-agent-quality-gate.md](#plans-2026-10-30-agent-quality-gate)
- [plans/2026-10-31-diagnostic-remediation.md](#plans-2026-10-31-diagnostic-remediation)
- [specs/2026-10-31-diagnostic-remediation-design.md](#specs-2026-10-31-diagnostic-remediation-design)

---

<a id="sdd-2026-10-31-diagnostic-remediation-progress"></a>

## SDD ledger — plan: docs/_internal/archive/planning/quality-and-diagnostics.md#plans-2026-10-31-diagnostic-remediation

来源：`sdd/2026-10-31-diagnostic-remediation/progress.md`。

Ruling: use the existing main worktree instead of a new worktree — the requested fixes must preserve and validate substantial uncommitted user changes already in this tree, and the user's standing preference is sequential work here — if wrong, unrelated dirty files share one workspace but no existing changes are overwritten and validation covers only named files.

Pre-flight: Task 1 and Task 3 both add independent keys to diagnosticsShare allowlist; no overlapping key names, no interface conflict. Tasks otherwise have no shared produced interfaces. No commits are authorized; task completion records tests and changed paths instead of commit ranges.
Task 1: complete (commits bd72edb..bd72edb, tests: bun test src/server/services/diagnosticsShare.test.ts src/server/services/echoflowApiService.test.ts → Ran 35 tests across 2 files. [1348.00ms])
Task 2: complete (commits bd72edb..bd72edb, tests: bun test src/server/__tests__/diagnostics-service.test.ts src/server/services/diagnosticsShare.test.ts → Ran 46 tests across 2 files. [8.81s])
Task 3: Ruling: the planned `getPublicStatus` override recursively called itself and was caught as unknown status; capture the original fixture status before replacing it — the intended test is index-off fallback, not a throwing status getter — cost if wrong: the status-error branch is covered separately by Task 2's unavailable test, but not here.
Task 3: complete (commits bd72edb..d0f0189, tests: bun test src/server/services/sessionService.sessionListPerformance.test.ts src/server/services/diagnosticsShare.test.ts → Ran 15 tests across 2 files. [1368.00ms])
Task 2: complete (commits bd72edb..bd72edb, tests: bun test src/server/__tests__/diagnostics-service.test.ts src/server/services/diagnosticsShare.test.ts → Ran 46 tests across 2 files. [8.81s])
Task 3: complete (commits bd72edb..d0f0189, tests: bun test src/server/services/sessionService.sessionListPerformance.test.ts src/server/services/diagnosticsShare.test.ts → Ran 15 tests across 2 files. [1368.00ms])
Task 4: Ruling: the brief's third test mocks a bare snapshot, but teamsApi.getWorkbenchForSession returns { sessionId, teamName, source, snapshots }; use the real timeline shape — a bare snapshot would throw inside the store's catch and the test could never prove discovery — cost if wrong: fixture differs from the plan text but matches desktop/src/api/teams.ts.
Task 4: complete (commits none — no commit authorized; tests: bun run --cwd desktop test -- --run src/stores/teamStore.test.ts → 39 passed)
Task 7: origin — the completed background review (wg13ci2y5) confirmed two token-lifecycle defects; both re-verified in echoflowApiService.ts (selectAccountToken built `sk-` from a missing key; rememberCreatedToken matched the first same-named token). Its serverRuntime onServerReady race is refuted: this.server is assigned before onServerReady fires, so getServerUrl() returns synchronously. Extended the plan inside the same EchoFlow surface because the user asked to fix every evidence-backed problem; deferred the workflow's CLI, frontend-ReferenceError, session-realpath and /api/sessions-evidence items with reasons in the final report.
Task 7: complete (commits none — no commit authorized; tests: bun test src/server/services/echoflowApiService.test.ts → 32 passed)
Task 5: complete (commits none; tests: bun run audit:harness → exit 0)
Task 6: complete (commits none; focused suites 110 server + 15 electron + 85 desktop passed; gates PASS: check:policy 487/1skip, check:server 6879 tests/575 files, check:desktop, check:native, check:provider-contract, check:chat-contract 431, check:agent-flow 8/8, check:docs 65, check:harness 62; NOT RUN: check:mobile/check:release/check:persistence-upgrade/check:coverage — selected only by the 25 pre-existing local commits, and this work changes no storage shape; git diff --check clean; no generated files in status)
Task 8: origin — the archived events show details.model/permissionMode/providerId/retryable (CLI failures) and lineno/colno (renderer errors) were present but dropped by the share allowlist; added the six typed scalars, with retention plus omission tests keeping filename/componentStack out.
Task 8: complete (commits none; tests: bun test src/server/services/diagnosticsShare.test.ts src/server/__tests__/diagnostics-service.test.ts → 48 passed)
Task 8 follow-up: added a secret-shaped `model` assertion to the gateway redaction test; reran check:server after the last edit — first run reported failed-files=1 with failed-tests=0 (file-level flake, file name not captured), immediate rerun passed files=575 tests=6880 failed=0. Reviewer must confirm the final state.
Final: fixed cross-account token-key bleed — 'does not carry one account user’s token key into another user’s list' RED→GREEN; reattachStoredTokenKeys now keeps stored keys only when the stored account is the same user — suite 34/34.
Final: fixed a newly created key overwriting an older same-named token — 'does not move a newly created key onto an older same-named token' RED→GREEN; rememberCreatedToken attaches only to a single match with no key or the identical key, otherwise keeps the new key under its own name — suite 34/34.
Final: fixed repeated slow-fallback diagnostic events — 'rate-limits the slow fallback event across repeated slow reads' RED (2 events)→GREEN (1); per-instance 60s cooldown — suite 9/9.
Final: Ruling: reviewer finding 4 (page-lane HISTORY_BUSY hides sessions from a successful list) does not stand — getMetadataProjection already passes the 'metadata' lane (sessionService.ts:1508, capacity 2 / queue 128), so list summaries never take the page lane. The new test 'serves list summaries without taking the interactive page lane' pins that invariant and passed on first run; it is a regression guard for existing behavior, not a fix — cost if wrong: ~128 queued metadata reads could still 429, and the pre-existing skip-unreadable catch would drop that session for one refresh.
Final: minor (deferred): a same-named second token's key lives under a synthetic id (created.name) and is dropped by the next list refresh because the gateway list never repeats keys; the key stays usable until that refresh.

---

<a id="sdd-2026-10-31-diagnostic-remediation-task-1-brief"></a>

## Task 1: Preserve safe gateway and CLI failure evidence

来源：`sdd/2026-10-31-diagnostic-remediation/task-1-brief.md`。

**Files:**
- Modify: `src/server/services/diagnosticsShare.ts:43-82`
- Modify: `src/server/services/echoflowApiService.ts:520-553`
- Test: `src/server/services/diagnosticsShare.test.ts`
- Test: `src/server/services/echoflowApiService.test.ts`
- Test: `src/server/services/sessionService.sessionListPerformance.test.ts` (existing CLI/session failure fixture command only; no production change here)

**Interfaces:**
- Produces diagnostic keys `exitCode`, `endpoint`, `credentialKind`, `transport`; existing keys `errorCode`, `status`, `method`, `sdkType`, and `subtype` stay safe.
- `EchoFlowApiService.fetchManagementApi()` continues throwing `EchoFlowApiError`; it additionally records `echoflow_gateway_request_failed` with only `{ endpoint, credentialKind, method, transport, errorCode, status? }`.

- [ ] **Step 1: Write the failing projection test**

In `src/server/services/diagnosticsShare.test.ts`, add:

```ts
test('keeps bounded failure metadata while redacting secret-shaped values', () => {
  const projected = projectDiagnosticEventForSharing({
    id: 'event-gateway',
    timestamp: '2026-10-31T00:00:00.000Z',
    type: 'echoflow_gateway_request_failed',
    severity: 'warn',
    details: {
      endpoint: 'main',
      credentialKind: 'session',
      transport: 'chromium-bridge',
      method: 'POST',
      status: 502,
      errorCode: 'service_unavailable',
      exitCode: 1,
      sdkType: 'result',
      subtype: 'error',
      body: 'PRIVATE_RESPONSE_BODY',
      cookie: 'session=PRIVATE_COOKIE',
      pathname: '/api/token/',
    },
    omittedFields: [],
  })
  expect(projected.details).toEqual({
    endpoint: 'main',
    credentialKind: 'session',
    transport: 'chromium-bridge',
    method: 'POST',
    status: 502,
    errorCode: 'service_unavailable',
    exitCode: 1,
    sdkType: 'result',
    subtype: 'error',
  })
  expect(JSON.stringify(projected)).not.toContain('PRIVATE_')
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test src/server/services/diagnosticsShare.test.ts`
Expected: FAIL because `exitCode`, `endpoint`, `credentialKind`, and `transport` are omitted.

- [ ] **Step 3: Add only the missing safe scalar keys**

In `SAFE_SCALAR_KEYS`, add `'credentialkind'`, `'endpoint'`, `'exitcode'`, and `'transport'`. Do not add `body`, `cookie`, `pathname`, URL, or arbitrary stack fields.

- [ ] **Step 4: Write the failing gateway-event test**

In `src/server/services/echoflowApiService.test.ts`, import `spyOn` from `bun:test` and `diagnosticsService` from `./diagnosticsService.js`. Add:

```ts
test('records typed gateway failure metadata without response content', async () => {
  const record = spyOn(diagnosticsService, 'recordEvent').mockResolvedValue({ ok: true })
  globalThis.fetch = mock(async () => new Response(
    '<html>PRIVATE_GATEWAY_BODY</html>',
    { status: 502, headers: { 'content-type': 'text/html' } },
  )) as typeof fetch
  const service = new EchoFlowApiService()
  await service.setCredential('main', { kind: 'session', userId: '1', cookie: 'session=private' })
  await expect(service.refreshAccount('main')).rejects.toMatchObject({
    code: 'service_unavailable',
    status: 502,
  })
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    type: 'echoflow_gateway_request_failed',
    severity: 'warn',
    details: expect.objectContaining({
      endpoint: 'main',
      credentialKind: 'session',
      method: 'GET',
      transport: 'direct',
      errorCode: 'service_unavailable',
      status: 502,
    }),
  }))
  expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE_GATEWAY_BODY')
  record.mockRestore()
})
```

- [ ] **Step 5: Run it and verify it fails**

Run: `bun test src/server/services/echoflowApiService.test.ts`
Expected: FAIL because no `echoflow_gateway_request_failed` event is recorded.

- [ ] **Step 6: Record one failure event at the shared gateway boundary**

Wrap the body of `fetchManagementApi()` after the `transport` decision in `try/catch`. On an `EchoFlowApiError`, call `void diagnosticsService.recordEvent({ type: 'echoflow_gateway_request_failed', severity: 'warn', summary: 'EchoFlow gateway request failed', details: { endpoint, credentialKind: credential.kind, method: init.method ?? 'GET', transport, errorCode: error.code, ...(error.status === undefined ? {} : { status: error.status }) } })`, then rethrow the same error. Import the existing `diagnosticsService`; do not add a new logger or event service.

- [ ] **Step 7: Verify focused tests pass**

Run: `bun test src/server/services/diagnosticsShare.test.ts src/server/services/echoflowApiService.test.ts`
Expected: PASS, including the existing 411-line EchoFlow service test set.

---

<a id="sdd-2026-10-31-diagnostic-remediation-task-2-brief"></a>

## Task 2: Export local-index state with the bundle

来源：`sdd/2026-10-31-diagnostic-remediation/task-2-brief.md`。

**Files:**
- Modify: `src/server/services/diagnosticsService.ts:351-388` and `buildReadme()`
- Test: `src/server/__tests__/diagnostics-service.test.ts:421-439`

**Interfaces:**
- Produces archive entry `local-index-status.json` with exactly `{ available: true, mode, state, discovered, indexed, degradedSources, databaseBytes, walBytes, lastUpdatedAt, lastErrorCode }`, or `{ available: false }`.
- Consumes `DiagnosticsService.getLocalIndexStatus(): LocalIndexStatus`.

- [ ] **Step 1: Write the failing export test**

Extend the existing tar-reading export test (or add beside it) with a spy returning the status fixture already used at lines 922-932, then assert:

```ts
const localIndex = JSON.parse(readTarEntry(await fs.readFile(bundle.path), 'local-index-status.json'))
expect(localIndex).toEqual({
  available: true,
  mode: 'on',
  state: 'degraded',
  discovered: 12,
  indexed: 10,
  degradedSources: 2,
  databaseBytes: 4096,
  walBytes: 1024,
  lastUpdatedAt: '2026-07-15T00:00:00.000Z',
  lastErrorCode: 'SQLITE_BUSY',
})
expect(archiveText).toContain('local-index-status.json')
expect(JSON.stringify(localIndex)).not.toContain(configDir)
```

Add a second test where `getLocalIndexStatus` throws and assert the bundle still exists and the entry is `{ available: false }`.

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test src/server/__tests__/diagnostics-service.test.ts`
Expected: FAIL because the entry is missing.

- [ ] **Step 3: Implement the bounded status projection**

Add a private `buildLocalIndexSummary(): Record<string, unknown>` that calls `this.getLocalIndexStatus()`, copies only the fields named in the interface, and catches any error to return `{ available: false }`. Add the entry to the existing `files` array and one README bullet. Do not serialize the `LocalIndexStatus` object generically.

- [ ] **Step 4: Verify**

Run: `bun test src/server/__tests__/diagnostics-service.test.ts src/server/services/diagnosticsShare.test.ts`
Expected: PASS.

---

<a id="sdd-2026-10-31-diagnostic-remediation-task-3-brief"></a>

## Task 3: Add bounded session-list fallback evidence and concurrency

来源：`sdd/2026-10-31-diagnostic-remediation/task-3-brief.md`。

**Files:**
- Modify: `src/server/services/sessionService.ts` near imports/constants, `loadSessionList()` at 4047-4103
- Modify: `src/server/services/diagnosticsShare.ts` allowlist for `discovered`, `included`, `indexMode`, `indexState`, `discoveryMs`, `statMs`, `summaryMs`, `totalMs`
- Test: `src/server/services/sessionService.sessionListPerformance.test.ts:107-119`

**Interfaces:**
- Produces `session_list_fallback_slow` only when fallback total time is at least 1000 ms; details are `{ indexMode, indexState, discovered, included, discoveryMs, statMs, summaryMs, totalMs }`.
- Summary processing concurrency is exactly `2`, matching the existing `metadata` admission pool. Files are processed through local worker loops, not an unbounded `Promise.all`.

- [ ] **Step 1: Write the failing concurrency test**

Add to the existing performance describe block, using the existing fixture:

```ts
it('bounds summary scans during file fallback', async () => {
  const { gateway, ids } = await fixture()
  gateway.getMode = () => 'off'
  gateway.getPublicStatus = () => ({ ...gateway.getPublicStatus(), state: 'off' })
  const service = new SessionService(gateway)
  const internals = service as unknown as {
    scanSessionListSummary: (...args: unknown[]) => Promise<unknown>
  }
  let active = 0
  let peak = 0
  const original = internals.scanSessionListSummary.bind(service)
  const scan = spyOn(internals, 'scanSessionListSummary').mockImplementation(async (...args) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    try { return await original(...args) } finally { active -= 1 }
  })
  try {
    const result = await service.listSessions({ limit: 20 })
    expect(result.sessions.map(session => session.id)).toEqual([...ids].reverse())
    expect(peak).toBe(2)
  } finally {
    scan.mockRestore()
  }
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test src/server/services/sessionService.sessionListPerformance.test.ts`
Expected: FAIL because the current loop is sequential and `peak` is 1.

- [ ] **Step 3: Replace the sequential summary loop**

Keep discovery and stat phases unchanged. Use two local async workers sharing a numeric cursor over `filesWithStats`; each calls `getCachedSessionListSummary`, skips unreadable entries exactly as today, and pushes results. Await both workers before sorting. Use `this.now()` to measure discovery, stat, summary, and total durations. After sorting/pagination, record one diagnostic only at `totalMs >= 1000`. Build the event with aggregate counts and the current index mode/state; never include file names, titles, or content.

- [ ] **Step 4: Add the slow-event assertion**

In a separate test, keep the six-file fixture but spy on `getPublicStatus` to `state: 'off'`, use an injected `now()` that advances 300 ms per call, and spy on `diagnosticsService.recordEvent`. Assert one `session_list_fallback_slow` event with numeric counts/timings and no project path or session id. Restore spies in `finally`.

- [ ] **Step 5: Verify focused behavior**

Run: `bun test src/server/services/sessionService.sessionListPerformance.test.ts`
Expected: PASS; result order and total remain unchanged; peak is 2; slow event is typed and path-free.

---

<a id="sdd-2026-10-31-diagnostic-remediation-task-4-brief"></a>

## Task 4: Negative-cache team discovery

来源：`sdd/2026-10-31-diagnostic-remediation/task-4-brief.md`。

**Files:**
- Modify: `desktop/src/stores/teamStore.ts:1081-1210`
- Test: `desktop/src/stores/teamStore.test.ts`

**Interfaces:**
- Consumes `ApiError` from `desktop/src/api/client.ts`; only `status === 404` records a negative discovery at `teamDiscoveryCompletedAt`.
- `fetchTeamForSession(sessionId, { force: true })` always bypasses the negative cache.
- Existing five-second `TEAM_DISCOVERY_TTL_MS` applies to a session with no cached snapshots.

- [ ] **Step 1: Write the failing store tests**

Add tests using fake timers and `new ApiError(404, {})`:

```ts
it('negative-caches a 404 discovery but still honors force', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T00:00:00.000Z'))
  getWorkbenchForSessionMock.mockRejectedValueOnce(new ApiError(404, {}))
  await useTeamStore.getState().fetchTeamForSession('no-team-session')
  await useTeamStore.getState().fetchTeamForSession('no-team-session')
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(1)
  await useTeamStore.getState().fetchTeamForSession('no-team-session', { force: true })
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(2)
  vi.useRealTimers()
})

it('does not negative-cache transient failures', async () => {
  getWorkbenchForSessionMock.mockRejectedValue(new ApiError(502, {}))
  await useTeamStore.getState().fetchTeamForSession('error-session')
  await useTeamStore.getState().fetchTeamForSession('error-session')
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(2)
})

it('discovers a newly created team after the negative TTL expires', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T00:00:00.000Z'))
  getWorkbenchForSessionMock.mockRejectedValueOnce(new ApiError(404, {}))
  await useTeamStore.getState().fetchTeamForSession('later-team')
  vi.advanceTimersByTime(5_001)
  getWorkbenchForSessionMock.mockResolvedValue(workbench('1', 'pending'))
  await useTeamStore.getState().fetchTeamForSession('later-team')
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(2)
  expect(useTeamStore.getState().workbenchesBySession['later-team']).toBeDefined()
  vi.useRealTimers()
})
```

Import `ApiError` from `../api/client`. Ensure mocks are reset by the existing test harness.

- [ ] **Step 2: Run and verify failure**

Run: `bun run --cwd desktop test -- --run src/stores/teamStore.test.ts`
Expected: FAIL because the repeated miss calls the API each time.

- [ ] **Step 3: Implement miss TTL and 404-only recording**

After the existing known-workbench TTL block, return early when `!options?.force`, there are no known snapshots, and the last completed discovery is younger than `TEAM_DISCOVERY_TTL_MS`. In the catch, before `set({ error })`, record completion only when `err instanceof ApiError && err.status === 404` and both store and discovery generations are still current; return without surfacing an error. Leave all other errors unchanged.

- [ ] **Step 4: Verify**

Run: `bun run --cwd desktop test -- --run src/stores/teamStore.test.ts`
Expected: PASS, existing 36 tests plus the three new ones.

---

<a id="sdd-2026-10-31-diagnostic-remediation-task-5-brief"></a>

## Task 5: Document the diagnostic evidence contract

来源：`sdd/2026-10-31-diagnostic-remediation/task-5-brief.md`。

**Files:**
- Modify: `docs/internals/contributing.md`
- Modify: `docs/en/internals/contributing.md`

- [ ] **Step 1: Add the rule in both language mirrors**

Under the existing failure-diagnostics section, add a short paragraph: shared exports keep typed exit/status/timing/count/index evidence; omit content, credentials, arbitrary stacks, paths, and upstream bodies; every new safe field needs both retention and redaction tests. Keep the Chinese and English wording aligned and do not duplicate it in `AGENTS.md`.

- [ ] **Step 2: Run repository guidance audit**

Run: `bun run audit:harness`
Expected: exit code 0.

---

<a id="sdd-2026-10-31-diagnostic-remediation-task-6-brief"></a>

## Task 6: Full affected-surface verification

来源：`sdd/2026-10-31-diagnostic-remediation/task-6-brief.md`。

**Files:** no production edits; only fixes driven by failing checks.

- [ ] **Step 1: Run the narrow combined suite**

Run: `bun test src/server/services/diagnosticsShare.test.ts src/server/__tests__/diagnostics-service.test.ts src/server/services/echoflowApiService.test.ts src/server/api/echoflow.test.ts src/server/__tests__/echoflow-api.test.ts src/server/services/sessionService.sessionListPerformance.test.ts`

Run: `bun test desktop/electron/services/echoFlowSiteIdentity.test.ts desktop/electron/services/echoFlowDedicatedRestore.test.ts desktop/electron/services/echoFlowSiteRestore.test.ts desktop/electron/services/siteNetworkBridge.test.ts`

Run: `bun run --cwd desktop test -- --run src/stores/teamStore.test.ts src/components/settings/EchoFlowAPIOfficialLogin.test.tsx src/pages/settings/ProviderSettings.test.tsx`

Expected: all PASS.

- [ ] **Step 2: Determine impact from the final diff**

Run: `bun run check:impact`
Expected: record the selected areas and checks; do not claim PR readiness.

- [ ] **Step 3: Run the selected gates**

Run the server, desktop, native, provider-contract, chat-contract, agent-flow, docs, and harness commands that `check:impact` selects. Read each command's own exit code and output. Do not run live gateway or model tests.

- [ ] **Step 4: Review dirty diff ownership**

Run: `git status --short --branch` and `git diff --check`.
Expected: only files named by this plan are newly changed; every pre-existing EchoFlow hunk is preserved. Report the actual test counts, skipped/blocked gates, and the three remaining evidence gaps: live gateway sign-in/token creation, CLI root-cause reproduction, frontend ReferenceError location.

### Self-Review

- Spec coverage: existing login verification (Task 1 plus Task 6), safe diagnostics and index state (Tasks 1-2), session fallback evidence/concurrency (Task 3), negative team cache (Task 4), docs (Task 5), verification boundaries (Task 6). ReferenceError stack export is intentionally deferred because no safe stack policy exists.
- No task changes external gateways, CLI transports, `src/cli`, user data, or unrelated EchoFlow code.
- Type names used consistently: `EchoFlowApiError`, `LocalIndexStatus`, `ApiError`, `SessionService`.
- Review Focus inputs each have an owning test: body leakage Task 1; secret-shaped values Task 1; team 404/transient/new team Task 4; scan boundedness/order Task 3; index failure/path leakage Task 2.

---

<a id="plans-2026-10-18-claude-hook-policy"></a>

## EchoFlow Claude Hook Policy Migration Implementation Plan

来源：`plans/2026-10-18-claude-hook-policy.md`。

**Goal:** Replace the repository's non-functional Claude hook DSL with a small, tested command-policy implementation and a valid local Claude Code hook configuration, while keeping repository policy and CI authoritative.

**Architecture:** Put all reusable policy logic and tests in tracked `scripts/git-hooks/` files. A single stdin-driven Bun entrypoint will translate Claude Code hook events into that policy and return the documented allow/block result without logging secret values. Keep `.claude/` as optional local-only wiring: its settings invoke the tracked entrypoint but are never required by CI or other clones; remove the duplicate custom hook declaration so there is one unambiguous local configuration.

**Tech Stack:** Bun 1.3.14, TypeScript/ESM, `bun:test`, Claude Code native `PreToolUse`/`PostToolUse`/`UserPromptSubmit` hook protocol, existing `scanForSecrets()` utility, repository `check:policy` and quality-gate tooling.

**Spec:** Current-task scope established by the approved request to process the EchoFlow-Code Claude configuration and hooks; no separate design document exists.

### Global Constraints

- Preserve every pre-existing user modification and untracked file in the worktree; do not reset, overwrite, stage, or commit unrelated work.
- `.claude/` remains local-only and must never become a CI dependency or committed source of truth.
- The authoritative provider policy remains `AGENTS.md`, provider preset behavior/tests, and repository quality gates; do not create a second incomplete deny-list in local configuration.
- The tracked `scripts/git-hooks/pre-push` hook remains non-blocking and must not be changed to run a blocking quality gate.
- Do not add automatic formatting or a formatter hook.
- Do not print full secret values, command contents containing secrets, or raw hook input in diagnostics.
- Use the exact Claude Code event names `PreToolUse`, `PostToolUse`, and `UserPromptSubmit`; command hooks read JSON from stdin and use exit code `2` only for an intentional block.
- `PreToolUse` may block a prospective Bash/Edit/Write operation; `PostToolUse` is advisory only and must not be described as able to undo a completed command.
- Keep the implementation dependency-free and reuse existing repository utilities, policy lists, test harnesses, and validation routes.
- Because new tests under `scripts/` are part of the policy surface, add their paths to the explicit `package.json` `check:policy` test list without overwriting the user's existing package changes.
- Identify the changed surface using `scripts/pr/change-policy.ts`; this work is primarily the `cli-core`/repository-policy tooling surface as defined by the existing routing, not an invented surface name.

### Review Focus

- **Shell composition and indirect execution:** commands such as `cd repo && git push`, `git -C repo push`, option-heavy pushes, chained commands, subshells, and wrapper invocations must not silently evade the intended direct-push check; tests pin the conservative behavior and document unavoidable shell-parser limits in Task 1.
- **Tool-input shape differences:** `Bash` uses `tool_input.command`, while `Edit` and `Write` expose content in different fields; malformed or unrelated inputs must be allowed or rejected deterministically without assuming every tool has `command` (Task 2 tests).
- **Provider-policy drift:** local hook matching must cover the same currently rejected provider/tracking patterns as the authoritative policy, without making the local hook list the source of truth (Task 1 and Task 3 tests).
- **Secret redaction and diagnostics:** a detected credential must produce only a rule label/reason, never the matched token or raw JSON; allow paths must not emit noisy output (Task 1 and Task 2 tests).
- **Unavailable or failing local hooks:** a missing local `.claude` hook configuration must not break CI, while an explicitly invoked hook must fail closed only for a confirmed violation and must not turn ordinary hook startup errors into an undocumented repository gate (Task 2 and Task 3 tests).

---

#### Task 1: Add the tracked command-policy core

**Files:**
- Create: `scripts/git-hooks/agent-command-policy.ts`
- Create: `scripts/git-hooks/agent-command-policy.test.ts`
- Read/reuse: `src/services/teamMemorySync/secretScanner.ts`
- Read/reuse: `src/server/__tests__/provider-presets.test.ts` and the provider-policy rules in `AGENTS.md`

**Interfaces:**
- Produces `AgentPolicyViolation`, a redacted violation record containing a stable `kind`, a safe `ruleId`, and a human-readable `reason` with no matched input.
- Produces `evaluateBashCommand(command: string): AgentPolicyViolation[]` for prospective Bash execution.
- Produces `evaluateToolInput(toolName: string, toolInput: unknown): AgentPolicyViolation[]` for secret checks on supported file-editing tools.
- The implementation must consume the existing `scanForSecrets(content)` result (or a narrowly justified adapter around it), not duplicate its credential regular expressions.

- [ ] **Step 1: Write failing unit tests for the policy contract**

  Add Bun tests that assert:
  - a normal command returns no violations;
  - each currently rejected provider and the existing promotion/tracking URL forms is detected consistently with the repository policy, while a supported official/custom provider string is not blocked;
  - direct pushes to `main` are detected in simple, option-heavy, `git -C`, chained, and `cd &&` command forms, while ordinary non-push Git commands are not blocked;
  - Bash policy checks do not inspect unrelated tool-input fields as if they were commands;
  - `Edit`/`Write` content containing a high-confidence secret returns only a rule identifier/label, and the secret text is absent from the violation;
  - malformed/empty tool input is handled deterministically.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:
  ```bash
  bun test ./scripts/git-hooks/agent-command-policy.test.ts
  ```

  Expected: FAIL because the policy module and exported functions do not yet exist.

- [ ] **Step 3: Implement the minimal pure policy functions**

  In `scripts/git-hooks/agent-command-policy.ts`:
  - normalize only enough command syntax to recognize the supported Git/provider cases; do not claim to be a complete shell parser;
  - centralize the eight currently rejected provider identifiers and the documented tracking-parameter patterns in the tracked policy implementation or reuse an existing authoritative exported helper if one exists;
  - recognize `git push` after common `git -C <path>` and option placement, and recognize an explicit `main` target without blocking unrelated branches;
  - extract only supported text fields from `Edit`/`Write` inputs, pass their content to `scanForSecrets`, and return safe labels/reasons;
  - return structured data only, leaving exit-code and stdin concerns to Task 2.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run:
  ```bash
  bun test ./scripts/git-hooks/agent-command-policy.test.ts
  ```

  Expected: PASS with all policy and redaction cases green.

---

#### Task 2: Add the stdin-driven Claude Code hook entrypoint

**Files:**
- Create: `scripts/git-hooks/claude-code-hook.ts`
- Create: `scripts/git-hooks/claude-code-hook.test.ts`
- Modify: `package.json` (`check:policy` explicit test list only)

**Interfaces:**
- Produces `readHookInput(input: string): ClaudeHookInput`, with safe validation of the JSON object and event/tool fields.
- Produces `evaluateClaudeHook(input: ClaudeHookInput): HookDecision`, where an allow decision has no secret-bearing output and a block decision has a safe reason.
- The executable reads stdin, dispatches by `hook_event_name`, writes no normal stdout on allow, writes a concise safe reason to stderr and exits `2` only for a confirmed `PreToolUse` block; malformed input and unsupported advisory events follow the documented non-blocking behavior.

- [ ] **Step 1: Write failing tests for event dispatch and exit behavior**

  Add Bun tests covering:
  - valid `PreToolUse` Bash input delegates to `evaluateBashCommand`;
  - valid `PreToolUse` Edit/Write input delegates to the content scanner without assuming `tool_input.command`;
  - `PostToolUse` is treated as audit/advisory and cannot claim to undo a completed command;
  - `UserPromptSubmit` does not pretend to inspect future tool calls or model output;
  - malformed JSON, missing `tool_input`, unknown tools, and unknown events do not leak input and follow the chosen non-blocking startup policy;
  - a blocked decision returns a safe reason and status `2`, while an allowed decision returns status `0` with empty normal output.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:
  ```bash
  bun test ./scripts/git-hooks/claude-code-hook.test.ts
  ```

  Expected: FAIL because the hook entrypoint and decision interfaces do not yet exist.

- [ ] **Step 3: Implement the Bun stdin adapter**

  Implement strict-but-small parsing for the documented top-level fields (`hook_event_name`, `tool_name`, and `tool_input`). Keep policy decisions in Task 1. Ensure diagnostics contain only event/tool/rule information and never raw stdin, command text, matched secrets, or `tool_response` contents. Make the executable usable from a project-root `bun run` command and avoid writing to Git config or installing hooks.

- [ ] **Step 4: Add the new tests to the policy gate without disturbing existing edits**

  Append the new test paths to `scripts.check:policy` in `package.json`, preserving the existing upstream-sync additions and every other user change. Confirm `scripts/pr/quality-contract.test.ts` sees both files.

- [ ] **Step 5: Run focused tests and the policy-contract coverage check**

  Run:
  ```bash
  bun test ./scripts/git-hooks/agent-command-policy.test.ts ./scripts/git-hooks/claude-code-hook.test.ts
  bun test ./scripts/pr/quality-contract.test.ts
  ```

  Expected: PASS; no raw secret or command content appears in test diagnostics.

---

#### Task 3: Replace the local custom hook declarations with valid native wiring

**Files:**
- Modify: `.claude/settings.json`
- Remove: `.claude/hooks.json` after reviewing its current contents and confirming it is the obsolete duplicate DSL
- Do not modify: `AGENTS.md` as a replacement source of hook execution

**Interfaces:**
- The local settings invoke `bun` with the tracked `scripts/git-hooks/claude-code-hook.ts` entrypoint using native `PreToolUse` matcher groups for `Bash` and `Edit|Write`.
- Any `PostToolUse` wiring is explicitly advisory and must not be used as a blocking safety claim.
- The settings remain optional local configuration; repository checks must pass when `.claude/` is absent.

- [ ] **Step 1: Add a configuration-shape regression fixture/test before changing the local files**

  Extend the hook configuration tests (or add a focused local-config test outside the tracked policy source if the repository’s test contract permits it) to assert the native shape: event-key arrays, matcher groups, command handler type, and no obsolete custom event names/keys. Also assert the tracked policy tests do not read `.claude/` as their source of truth.

- [ ] **Step 2: Replace `.claude/settings.json` with the minimal native hook mapping**

  Keep only the supported schema/native hook configuration needed for this local integration. Use exact `PreToolUse` event names, `Bash` and `Edit|Write` matchers, an explicit short timeout, and the tracked Bun entrypoint. Do not retain the old `security`, `agentToolset`, `verification`, `codeQuality`, `git`, or `project` blocks as if Claude Code executes them; their repository-level rules already live in `AGENTS.md` and the tracked gates.

- [ ] **Step 3: Remove the obsolete `.claude/hooks.json` DSL**

  Delete the duplicate custom declaration only after verifying it is the file currently containing the non-native `$schema`/custom-key configuration. Do not delete any tracked repository policy or Git hook. The resulting local configuration must have one clear native entrypoint.

- [ ] **Step 4: Test local wiring and absence behavior**

  Run a temporary-project or fixture-level invocation that feeds an allowed and a blocked JSON event to the tracked entrypoint, and verify the repository policy tests still pass with `.claude/` ignored or absent. Do not run `hooks:install`, change Git config, or install a pre-push hook as part of this task.

---

#### Task 4: Document the boundary and run repository verification

**Files:**
- Modify: `docs/internals/contributing.md` (add a concise local Claude hook section without overwriting existing user edits)
- Modify: `docs/en/internals/contributing.md` (matching English guidance, if the existing document structure requires parity)
- No changes: `scripts/git-hooks/pre-push`

**Interfaces:**
- Documentation states that local Claude hooks are optional advisory/PreToolUse guardrails, tracked policy and CI remain authoritative, and Git hosting/real Git hooks are the final protection for pushes.
- Documentation names the exact setup/configuration location and the focused validation commands, without promising that a Bash-string hook is a complete shell firewall.

- [ ] **Step 1: Add the minimal boundary documentation**

  Explain the native event names, stdin/exit behavior, secret-redaction rule, the non-blocking pre-push distinction, and the required offline policy tests. Do not document `.claude/` as a shared CI prerequisite or imply that `PostToolUse` can undo a command.

- [ ] **Step 2: Verify changed-surface routing before the full gate**

  Run:
  ```bash
  bun run check:impact
  bun run audit:harness
  ```

  Expected: the impact report selects the existing policy/tooling checks, and the harness audit reports no contract violation caused by the new local wiring or test-list entry.

- [ ] **Step 3: Run the focused repository checks**

  Run:
  ```bash
  bun run check:policy
  bun run check:provider-contract
  ```

  Expected: both pass without live providers, network access, real credentials, or writes to the real Claude config directory. If the provider contract runner is not selected by the actual impact report, record that fact rather than inventing a pass.

- [ ] **Step 4: Run the full PR gate before claiming completion**

  Run:
  ```bash
  bun run verify
  ```

  Expected: the quality gate completes, or any failure is reported with its concrete lane and log path; do not claim the change is ready if this command was not run or did not pass.

- [ ] **Step 5: Review the final diff and report remaining limitations**

  Confirm only the intended tracked helper/tests/package/docs files and the local `.claude/` wiring changed; confirm all pre-existing upstream-sync files remain intact; report that direct shell execution, wrapper scripts, and server-side Git permissions remain outside the Claude hook's guarantee.

---

<a id="plans-2026-10-29-quality-gate-integrity"></a>

## Quality Gate Integrity Implementation Plan

来源：`plans/2026-10-29-quality-gate-integrity.md`。

**Goal:** Eliminate the verified false-green and zero-routing paths in the repository quality gates without weakening approvals or coverage requirements.

**Architecture:** Keep `scripts/pr/change-policy.ts` as the blocking routing source of truth. Extend the existing policy, harness, and coverage tests before changing behavior; make no change to release artifacts, repository settings, remotes, or the active dsh migration worktree.

**Tech Stack:** Bun, TypeScript, Node.js harness audit, GitHub Actions YAML, Bun test.

**Spec:** `.claude/task-survey/REMAINING_TASKS.zh-CN.md` (local audit evidence; not a committed dependency)

### Global Constraints

- Run `git status --short` before editing; preserve unrelated changes.
- Keep changes narrow and use existing test harnesses.
- `pull_request_target` automation must not checkout, install, or execute PR-head code.
- Do not hand-raise coverage baselines. Baseline regeneration requires a complete fresh run and maintainer approval through `allow-coverage-baseline-change`.
- Do not alter branch protection, repository settings, remotes, or the dsh migration worktree.
- Do not commit unless the user separately asks for a commit.

### Review Focus

- Agent-instruction files intentionally have no area but must retain policy routing; test both routing and non-blocking behavior in Task 1.
- `src/server/` must not become cli-core when the root runtime approval rule is broadened; test this boundary in Task 1.
- A test added under a different adapter package must not satisfy a same-package requirement; test both directions in Task 2.
- Zero observed branch records mean unavailable data, not 100%; test nonzero records remain unchanged in Task 3.
- PR triage cannot import trusted repository code without adding a checkout; its fix must preserve the no-checkout security property in Task 5.

---

#### Task 1: Route Every Tracked Runtime Path and Align CLI-Core Approval

**Files:**
- Modify: `scripts/pr/change-policy.ts`
- Modify: `scripts/pr/change-policy.test.ts`
- Modify: `scripts/pr/run-server-tests.ts`
- Modify: `scripts/pr/run-server-tests.test.ts` if present, otherwise `scripts/pr/test-environment.test.ts` only for existing discovery helpers
- Modify: `AGENTS.md` and `docs/internals/contributing.md` only to keep routing prose within budget

**Interfaces:**
- Consumes: `evaluateChangePolicy(files, labels?)`.
- Produces: root `src/` except `src/server/` maps to `cli-core`; `runtime/` maps to `server`; root `tests/` is discovered by server tests; all tracked top-level paths have explicit routing or an asserted agent-instruction exception.

- [ ] Add failing policy cases for `runtime/win_helper.py`, `desktop/bunfig.toml`, `src/services/example.ts`, `src/server/example.ts`, root tests, and each tracked top-level directory.
- [ ] Run `bun test scripts/pr/change-policy.test.ts` and confirm failures reproduce zero routing or missing cli-core approval.
- [ ] Make the smallest prefix/exact-path changes; add `tests/` to existing server test discovery and coverage discovery without creating a second runner.
- [ ] Rerun the focused tests and `bun run check:policy`.
- [ ] Run `bun run check:impact` and record selected checks.

#### Task 2: Make the Harness Audit Exit Contract Enforceable

**Files:**
- Modify: `scripts/harness-audit.js`
- Modify: `scripts/harness-audit.test.ts`
- Modify: `.github/workflows/pr-quality.yml` only if an explicit scope flag is needed
- Modify: `scripts/pr/pr-quality-workflow.test.ts`

**Interfaces:**
- Consumes: existing `buildReport(scope, { rootDir })` result.
- Produces: a documented required-check policy and nonzero process exit for failed in-scope checks; optional hygiene findings remain visible.

- [ ] Add a subprocess test against a minimal fixture with a known failing required check and assert nonzero exit; add a clean-fixture success case.
- [ ] Run the focused test and confirm the failing case currently exits zero.
- [ ] Implement the minimal explicit exit policy. Do not make every score category blocking by accident.
- [ ] Reconcile actual `CC_HAHA_*` findings by semantic compatibility review, or narrowly scope required checks; do not blindly rename active environment contracts.
- [ ] Run `bun test scripts/harness-audit.test.ts scripts/pr/pr-quality-workflow.test.ts` and `bun run audit:harness`.

#### Task 3: Associate Missing-Test Signals With the Changed Package

**Files:**
- Modify: `scripts/pr/change-policy.ts`
- Modify: `scripts/pr/change-policy.test.ts`

**Interfaces:**
- Consumes: production and test path lists already computed by `missingTestSignals`.
- Produces: package-aware test matching for adapters and narrowly defined ownership for other surfaces.

- [ ] Add failing cases where `adapters/wechat/index.ts` plus only a Telegram test produces no signal today, plus a same-package passing case.
- [ ] Implement adapter package matching first; add equivalent cross-package tests before tightening other surfaces if their ownership boundaries are unambiguous.
- [ ] Run focused policy tests and `bun run check:policy`.

#### Task 4: Report Unavailable Coverage Instead of 100 Percent

**Files:**
- Modify: `scripts/quality-gate/coverage.ts`
- Modify: `scripts/quality-gate/coverage.test.ts`
- Modify: coverage report rendering in the same existing module
- Defer: `scripts/quality-gate/coverage-baseline.json` until a fresh complete run

**Interfaces:**
- Consumes: parsed LCOV totals `{ covered, total }`.
- Produces: branch totals of zero are reported as unavailable and do not produce a misleading 100% metric or gate success.

- [ ] Add a failing zero-branch fixture and a nonzero-branch control fixture.
- [ ] Implement an explicit unavailable representation without changing line/function/statement semantics.
- [ ] Ensure thresholds skip only unavailable metrics while available changed-line and other suite metrics remain enforced.
- [ ] Run `bun test scripts/quality-gate/coverage.test.ts` and then `bun run check:coverage` if a fresh complete run is feasible.

#### Task 5: Align CI Routing and Triage Without Executing Untrusted Code

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/internals/contributing.md`
- Modify: `.github/workflows/pr-triage.yml`
- Modify: `scripts/pr/pr-triage-workflow.test.ts`
- Modify: `scripts/pr/quality-contract.test.ts`

**Interfaces:**
- Consumes: `evaluateChangePolicy` routing for `.github/workflows/**`, `site/`, `native/`.
- Produces: accurate documentation and triage labels without a second drifting prefix graph.

- [ ] Add failing assertions for workflow→policy and site/native triage parity.
- [ ] Choose a trusted-data sharing mechanism that adds no checkout/install to `pull_request_target`; do not execute repository TypeScript in that workflow.
- [ ] Move procedural prose out of `AGENTS.md` to fund the correction; make KB/KiB wording match the executable assertion.
- [ ] Run policy, docs, and harness audit checks sequentially where they share `node_modules`.

### Completion Evidence

Record changed files, red-to-green focused test evidence, `check:impact`, checks not run, and remaining risks. Do not claim PR-ready without `bun run verify`, coverage evidence, and any selected cross-process lanes.

---

<a id="plans-2026-10-30-agent-quality-gate"></a>

## 强制独立审查闸门（agent-quality-gate）

来源：`plans/2026-10-30-agent-quality-gate.md`。

状态：已批准范围（用户选定「先做强制闸门一条线」）
日期：2026-10-30

### 要解决的问题

「写代码的人不能当自己唯一的验收者」目前只是提示词里的期望，没有任何机器强制。
模型写完自己说没问题就结束了，漏测和架构退化从这里进来。

已有能力不缺，缺的是强制：

| 需要的角色 | 已有的 |
| --- | --- |
| 架构调查 | 内置 `Explore` agent |
| 代码审查 | `code-review:code-review`、独立代码审查（旧插件已停用） |
| 安全审查 | `security-review` |
| 测试分析 | 测试驱动与完成前验证（旧插件已停用） |
| UI/E2E | `bun run check:desktop-ui-smoke` |

### 现状（已核实，带出处）

- `~/.claude/settings.json` 已有一个 PreToolUse 机器闸门（拦 `git add -A` / `reset --hard` / `clean` / `force push` / `rm -rf`）——闸门范式已存在，本次是扩展它，不是新造。
- `src/utils/hooks.ts`：PreToolUse `exit 2` 阻断工具调用；Stop `exit 2` 不许结束并继续对话；Stop 负载含 `session_id` / `transcript_path` / `stop_hook_active`（:311-312、:3693-3702）。
- `scripts/quality-gate/` 是现成的质量框架（`runner.ts` / `reporter.ts` / `sandbox.ts` / `types.ts`），测试用同目录 `*.test.ts`。
- `scripts/harness-audit.js` `detectTargetMode()`（:261-277）按 `package.json` name 与根级 `.claude-plugin/`、`agents/`、`skills/` 判定，本仓判为 `consumer`，只做静态存在性计分，证不了行为。

### Rulings

1. **不新建 6 个专业 agent，复用已有的。** —— 评审提议的角色与 Explore / code-review / security-review / superpowers 重复，仓库规则要求优先复用现有机制。代价：少了专属提示词的针对性。
2. **闸门逻辑放 `scripts/agent-quality-gate/`（仓库自有、可测试），`settings.json` 只做接线。** —— AGENTS.md 规定 `.claude/` 不能作为提交的事实来源或 CI 依赖。代价：多一层进程调用。
3. **闸门 fail-open，并留显式 BLOCKED 豁免通道。** —— 闸门失灵不得锁死会话；拿不到审查时必须能诚实地报阻塞。代价：极端情况缺口会被放过，但留痕。
4. **`batch.ts` 与 `runWorkflowAgent.ts` 本轮不动。** —— 两者在根 `src/` 下，属 `cli-core`，改动需 `allow-cli-core-change` 标签和维护者批准。代价：这两项 P1 延后。
5. **状态存 `~/.claude/agent-quality-gate/<session_id>.json`。** —— 会话隔离、瞬时、不入仓库。代价：换机器不同步（状态本来就是瞬时的，可接受）。

### 任务

1. `state.ts` —— 会话状态读写：`lastEditAt` / `lastReviewAt` / `lastTestAt` / `waiver`；文件损坏时 fail-open。
2. `pre-tool.ts` —— PreToolUse：Edit/Write/MultiEdit 记 `lastEditAt`；Bash 跑测试命令记 `lastTestAt`。
3. `subagent-stop.ts` —— SubagentStop 记 `lastReviewAt`。
4. `stop.ts` —— Stop：改过代码但最后一次编辑之后没有独立审查、或没跑测试 → `exit 2` 阻断；有豁免 → 放行并记录。
5. `ack-blocked` —— 显式豁免入口，记 `BLOCKED` 留痕。
6. 测试（含防死锁用例），与 `scripts/quality-gate/` 同目录约定。
7. `settings.json` 接线 + `package.json` 脚本 + `AGENTS.md` 同步更新（新增目录和脚本触发契约更新要求）。

### 验收

- 改过代码、未经独立审查就结束 → 被阻断
- 审查之后又编辑 → 上一次审查失效
- 本会话没改代码 → 不阻断
- 闸门自身出错 → 放行并记录，不锁死会话
- 显式 BLOCKED 豁免 → 放行且留下记录

### 未做 / 延后

- `batch.ts` 的 5–30 agent 硬编码与 worker 自己 commit/push/开 PR（cli-core 门后）
- `runWorkflowAgent.ts` 的 `permissionMode: 'acceptEdits'` 强制（cli-core 门后）
- `audit:harness` 行为审计、Evals 场景、插件增删 —— 不在「一条线」范围内
- 对 `batch.ts` / `acceptEdits` 两条断言的对抗性复查 **NOT RUN**（脚本 id 过滤没匹配上，Challenge 阶段起 0 个 agent）；动那两个文件前必须补跑

---

<a id="plans-2026-10-31-diagnostic-remediation"></a>

## Diagnostic Remediation Implementation Plan

来源：`plans/2026-10-31-diagnostic-remediation.md`。

**Goal:** Make the next diagnostic bundle actionable and remove the repeated team/session-list overhead while preserving all existing uncommitted EchoFlow login work.

**Architecture:** Add only bounded, typed metadata to the existing event/export pipeline; reuse the existing history-read admission pool for session scanning; reuse the existing team discovery TTL for negative results. No new service, scheduler, dependency, or CLI runtime change.

**Tech Stack:** Bun, TypeScript, Node fs, Zod, Zustand, Vitest, Bun test.

**Spec:** `docs/_internal/archive/planning/quality-and-diagnostics.md#specs-2026-10-31-diagnostic-remediation-design`

### Global Constraints

- Preserve every existing uncommitted EchoFlow change; edit only named hunks and do not reformat or restage unrelated files.
- Never write real user config, transcripts, credentials, external gateway state, or release config. Tests use temporary config roots.
- No diagnostics content, messages, stacks, cookies, authorization values, response bodies, transcript paths, or arbitrary free text.
- No change to `src/cli/**`, startup timeouts, or retry policy for account/site-session POSTs.
- No new dependency and no generic concurrency abstraction. Worktrees are not needed because tasks are sequential in the current dirty tree.
- Do not commit unless the user asks. Record changed files and verification instead.
- Run the narrow test first, then `bun run check:impact`; run only selected gates while iterating.

### Review Focus

- A non-JSON/HTML 502 from the gateway must produce typed metadata without copying its body.
- Secret-shaped values in newly allowed diagnostic keys must still be redacted.
- A 404 negative team result must not hide a later team, a reconnect refresh, or a non-404 failure.
- Parallel transcript summaries must stay behind the existing budget and must not turn queue overflow into silently skipped sessions.
- Local-index status must never leak a path or make the diagnostics export fail.

---

#### Task 1: Preserve safe gateway and CLI failure evidence

**Files:**
- Modify: `src/server/services/diagnosticsShare.ts:43-82`
- Modify: `src/server/services/echoflowApiService.ts:520-553`
- Test: `src/server/services/diagnosticsShare.test.ts`
- Test: `src/server/services/echoflowApiService.test.ts`
- Test: `src/server/services/sessionService.sessionListPerformance.test.ts` (existing CLI/session failure fixture command only; no production change here)

**Interfaces:**
- Produces diagnostic keys `exitCode`, `endpoint`, `credentialKind`, `transport`; existing keys `errorCode`, `status`, `method`, `sdkType`, and `subtype` stay safe.
- `EchoFlowApiService.fetchManagementApi()` continues throwing `EchoFlowApiError`; it additionally records `echoflow_gateway_request_failed` with only `{ endpoint, credentialKind, method, transport, errorCode, status? }`.

- [ ] **Step 1: Write the failing projection test**

In `src/server/services/diagnosticsShare.test.ts`, add:

```ts
test('keeps bounded failure metadata while redacting secret-shaped values', () => {
  const projected = projectDiagnosticEventForSharing({
    id: 'event-gateway',
    timestamp: '2026-10-31T00:00:00.000Z',
    type: 'echoflow_gateway_request_failed',
    severity: 'warn',
    details: {
      endpoint: 'main',
      credentialKind: 'session',
      transport: 'chromium-bridge',
      method: 'POST',
      status: 502,
      errorCode: 'service_unavailable',
      exitCode: 1,
      sdkType: 'result',
      subtype: 'error',
      body: 'PRIVATE_RESPONSE_BODY',
      cookie: 'session=PRIVATE_COOKIE',
      pathname: '/api/token/',
    },
    omittedFields: [],
  })
  expect(projected.details).toEqual({
    endpoint: 'main',
    credentialKind: 'session',
    transport: 'chromium-bridge',
    method: 'POST',
    status: 502,
    errorCode: 'service_unavailable',
    exitCode: 1,
    sdkType: 'result',
    subtype: 'error',
  })
  expect(JSON.stringify(projected)).not.toContain('PRIVATE_')
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test src/server/services/diagnosticsShare.test.ts`
Expected: FAIL because `exitCode`, `endpoint`, `credentialKind`, and `transport` are omitted.

- [ ] **Step 3: Add only the missing safe scalar keys**

In `SAFE_SCALAR_KEYS`, add `'credentialkind'`, `'endpoint'`, `'exitcode'`, and `'transport'`. Do not add `body`, `cookie`, `pathname`, URL, or arbitrary stack fields.

- [ ] **Step 4: Write the failing gateway-event test**

In `src/server/services/echoflowApiService.test.ts`, import `spyOn` from `bun:test` and `diagnosticsService` from `./diagnosticsService.js`. Add:

```ts
test('records typed gateway failure metadata without response content', async () => {
  const record = spyOn(diagnosticsService, 'recordEvent').mockResolvedValue({ ok: true })
  globalThis.fetch = mock(async () => new Response(
    '<html>PRIVATE_GATEWAY_BODY</html>',
    { status: 502, headers: { 'content-type': 'text/html' } },
  )) as typeof fetch
  const service = new EchoFlowApiService()
  await service.setCredential('main', { kind: 'session', userId: '1', cookie: 'session=private' })
  await expect(service.refreshAccount('main')).rejects.toMatchObject({
    code: 'service_unavailable',
    status: 502,
  })
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    type: 'echoflow_gateway_request_failed',
    severity: 'warn',
    details: expect.objectContaining({
      endpoint: 'main',
      credentialKind: 'session',
      method: 'GET',
      transport: 'direct',
      errorCode: 'service_unavailable',
      status: 502,
    }),
  }))
  expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE_GATEWAY_BODY')
  record.mockRestore()
})
```

- [ ] **Step 5: Run it and verify it fails**

Run: `bun test src/server/services/echoflowApiService.test.ts`
Expected: FAIL because no `echoflow_gateway_request_failed` event is recorded.

- [ ] **Step 6: Record one failure event at the shared gateway boundary**

Wrap the body of `fetchManagementApi()` after the `transport` decision in `try/catch`. On an `EchoFlowApiError`, call `void diagnosticsService.recordEvent({ type: 'echoflow_gateway_request_failed', severity: 'warn', summary: 'EchoFlow gateway request failed', details: { endpoint, credentialKind: credential.kind, method: init.method ?? 'GET', transport, errorCode: error.code, ...(error.status === undefined ? {} : { status: error.status }) } })`, then rethrow the same error. Import the existing `diagnosticsService`; do not add a new logger or event service.

- [ ] **Step 7: Verify focused tests pass**

Run: `bun test src/server/services/diagnosticsShare.test.ts src/server/services/echoflowApiService.test.ts`
Expected: PASS, including the existing 411-line EchoFlow service test set.

#### Task 2: Export local-index state with the bundle

**Files:**
- Modify: `src/server/services/diagnosticsService.ts:351-388` and `buildReadme()`
- Test: `src/server/__tests__/diagnostics-service.test.ts:421-439`

**Interfaces:**
- Produces archive entry `local-index-status.json` with exactly `{ available: true, mode, state, discovered, indexed, degradedSources, databaseBytes, walBytes, lastUpdatedAt, lastErrorCode }`, or `{ available: false }`.
- Consumes `DiagnosticsService.getLocalIndexStatus(): LocalIndexStatus`.

- [ ] **Step 1: Write the failing export test**

Extend the existing tar-reading export test (or add beside it) with a spy returning the status fixture already used at lines 922-932, then assert:

```ts
const localIndex = JSON.parse(readTarEntry(await fs.readFile(bundle.path), 'local-index-status.json'))
expect(localIndex).toEqual({
  available: true,
  mode: 'on',
  state: 'degraded',
  discovered: 12,
  indexed: 10,
  degradedSources: 2,
  databaseBytes: 4096,
  walBytes: 1024,
  lastUpdatedAt: '2026-07-15T00:00:00.000Z',
  lastErrorCode: 'SQLITE_BUSY',
})
expect(archiveText).toContain('local-index-status.json')
expect(JSON.stringify(localIndex)).not.toContain(configDir)
```

Add a second test where `getLocalIndexStatus` throws and assert the bundle still exists and the entry is `{ available: false }`.

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test src/server/__tests__/diagnostics-service.test.ts`
Expected: FAIL because the entry is missing.

- [ ] **Step 3: Implement the bounded status projection**

Add a private `buildLocalIndexSummary(): Record<string, unknown>` that calls `this.getLocalIndexStatus()`, copies only the fields named in the interface, and catches any error to return `{ available: false }`. Add the entry to the existing `files` array and one README bullet. Do not serialize the `LocalIndexStatus` object generically.

- [ ] **Step 4: Verify**

Run: `bun test src/server/__tests__/diagnostics-service.test.ts src/server/services/diagnosticsShare.test.ts`
Expected: PASS.

#### Task 3: Add bounded session-list fallback evidence and concurrency

**Files:**
- Modify: `src/server/services/sessionService.ts` near imports/constants, `loadSessionList()` at 4047-4103
- Modify: `src/server/services/diagnosticsShare.ts` allowlist for `discovered`, `included`, `indexMode`, `indexState`, `discoveryMs`, `statMs`, `summaryMs`, `totalMs`
- Test: `src/server/services/sessionService.sessionListPerformance.test.ts:107-119`

**Interfaces:**
- Produces `session_list_fallback_slow` only when fallback total time is at least 1000 ms; details are `{ indexMode, indexState, discovered, included, discoveryMs, statMs, summaryMs, totalMs }`.
- Summary processing concurrency is exactly `2`, matching the existing `metadata` admission pool. Files are processed through local worker loops, not an unbounded `Promise.all`.

- [ ] **Step 1: Write the failing concurrency test**

Add to the existing performance describe block, using the existing fixture:

```ts
it('bounds summary scans during file fallback', async () => {
  const { gateway, ids } = await fixture()
  gateway.getMode = () => 'off'
  gateway.getPublicStatus = () => ({ ...gateway.getPublicStatus(), state: 'off' })
  const service = new SessionService(gateway)
  const internals = service as unknown as {
    scanSessionListSummary: (...args: unknown[]) => Promise<unknown>
  }
  let active = 0
  let peak = 0
  const original = internals.scanSessionListSummary.bind(service)
  const scan = spyOn(internals, 'scanSessionListSummary').mockImplementation(async (...args) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    try { return await original(...args) } finally { active -= 1 }
  })
  try {
    const result = await service.listSessions({ limit: 20 })
    expect(result.sessions.map(session => session.id)).toEqual([...ids].reverse())
    expect(peak).toBe(2)
  } finally {
    scan.mockRestore()
  }
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test src/server/services/sessionService.sessionListPerformance.test.ts`
Expected: FAIL because the current loop is sequential and `peak` is 1.

- [ ] **Step 3: Replace the sequential summary loop**

Keep discovery and stat phases unchanged. Use two local async workers sharing a numeric cursor over `filesWithStats`; each calls `getCachedSessionListSummary`, skips unreadable entries exactly as today, and pushes results. Await both workers before sorting. Use `this.now()` to measure discovery, stat, summary, and total durations. After sorting/pagination, record one diagnostic only at `totalMs >= 1000`. Build the event with aggregate counts and the current index mode/state; never include file names, titles, or content.

- [ ] **Step 4: Add the slow-event assertion**

In a separate test, keep the six-file fixture but spy on `getPublicStatus` to `state: 'off'`, use an injected `now()` that advances 300 ms per call, and spy on `diagnosticsService.recordEvent`. Assert one `session_list_fallback_slow` event with numeric counts/timings and no project path or session id. Restore spies in `finally`.

- [ ] **Step 5: Verify focused behavior**

Run: `bun test src/server/services/sessionService.sessionListPerformance.test.ts`
Expected: PASS; result order and total remain unchanged; peak is 2; slow event is typed and path-free.

#### Task 4: Negative-cache team discovery

**Files:**
- Modify: `desktop/src/stores/teamStore.ts:1081-1210`
- Test: `desktop/src/stores/teamStore.test.ts`

**Interfaces:**
- Consumes `ApiError` from `desktop/src/api/client.ts`; only `status === 404` records a negative discovery at `teamDiscoveryCompletedAt`.
- `fetchTeamForSession(sessionId, { force: true })` always bypasses the negative cache.
- Existing five-second `TEAM_DISCOVERY_TTL_MS` applies to a session with no cached snapshots.

- [ ] **Step 1: Write the failing store tests**

Add tests using fake timers and `new ApiError(404, {})`:

```ts
it('negative-caches a 404 discovery but still honors force', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T00:00:00.000Z'))
  getWorkbenchForSessionMock.mockRejectedValueOnce(new ApiError(404, {}))
  await useTeamStore.getState().fetchTeamForSession('no-team-session')
  await useTeamStore.getState().fetchTeamForSession('no-team-session')
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(1)
  await useTeamStore.getState().fetchTeamForSession('no-team-session', { force: true })
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(2)
  vi.useRealTimers()
})

it('does not negative-cache transient failures', async () => {
  getWorkbenchForSessionMock.mockRejectedValue(new ApiError(502, {}))
  await useTeamStore.getState().fetchTeamForSession('error-session')
  await useTeamStore.getState().fetchTeamForSession('error-session')
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(2)
})

it('discovers a newly created team after the negative TTL expires', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T00:00:00.000Z'))
  getWorkbenchForSessionMock.mockRejectedValueOnce(new ApiError(404, {}))
  await useTeamStore.getState().fetchTeamForSession('later-team')
  vi.advanceTimersByTime(5_001)
  getWorkbenchForSessionMock.mockResolvedValue(workbench('1', 'pending'))
  await useTeamStore.getState().fetchTeamForSession('later-team')
  expect(getWorkbenchForSessionMock).toHaveBeenCalledTimes(2)
  expect(useTeamStore.getState().workbenchesBySession['later-team']).toBeDefined()
  vi.useRealTimers()
})
```

Import `ApiError` from `../api/client`. Ensure mocks are reset by the existing test harness.

- [ ] **Step 2: Run and verify failure**

Run: `bun run --cwd desktop test -- --run src/stores/teamStore.test.ts`
Expected: FAIL because the repeated miss calls the API each time.

- [ ] **Step 3: Implement miss TTL and 404-only recording**

After the existing known-workbench TTL block, return early when `!options?.force`, there are no known snapshots, and the last completed discovery is younger than `TEAM_DISCOVERY_TTL_MS`. In the catch, before `set({ error })`, record completion only when `err instanceof ApiError && err.status === 404` and both store and discovery generations are still current; return without surfacing an error. Leave all other errors unchanged.

- [ ] **Step 4: Verify**

Run: `bun run --cwd desktop test -- --run src/stores/teamStore.test.ts`
Expected: PASS, existing 36 tests plus the three new ones.

#### Task 5: Document the diagnostic evidence contract

**Files:**
- Modify: `docs/internals/contributing.md`
- Modify: `docs/en/internals/contributing.md`

- [ ] **Step 1: Add the rule in both language mirrors**

Under the existing failure-diagnostics section, add a short paragraph: shared exports keep typed exit/status/timing/count/index evidence; omit content, credentials, arbitrary stacks, paths, and upstream bodies; every new safe field needs both retention and redaction tests. Keep the Chinese and English wording aligned and do not duplicate it in `AGENTS.md`.

- [ ] **Step 2: Run repository guidance audit**

Run: `bun run audit:harness`
Expected: exit code 0.

#### Task 6: Full affected-surface verification

**Files:** no production edits; only fixes driven by failing checks.

- [ ] **Step 1: Run the narrow combined suite**

Run: `bun test src/server/services/diagnosticsShare.test.ts src/server/__tests__/diagnostics-service.test.ts src/server/services/echoflowApiService.test.ts src/server/api/echoflow.test.ts src/server/__tests__/echoflow-api.test.ts src/server/services/sessionService.sessionListPerformance.test.ts`

Run: `bun test desktop/electron/services/echoFlowSiteIdentity.test.ts desktop/electron/services/echoFlowDedicatedRestore.test.ts desktop/electron/services/echoFlowSiteRestore.test.ts desktop/electron/services/siteNetworkBridge.test.ts`

Run: `bun run --cwd desktop test -- --run src/stores/teamStore.test.ts src/components/settings/EchoFlowAPIOfficialLogin.test.tsx src/pages/settings/ProviderSettings.test.tsx`

Expected: all PASS.

- [ ] **Step 2: Determine impact from the final diff**

Run: `bun run check:impact`
Expected: record the selected areas and checks; do not claim PR readiness.

- [ ] **Step 3: Run the selected gates**

Run the server, desktop, native, provider-contract, chat-contract, agent-flow, docs, and harness commands that `check:impact` selects. Read each command's own exit code and output. Do not run live gateway or model tests.

- [ ] **Step 4: Review dirty diff ownership**

Run: `git status --short --branch` and `git diff --check`.
Expected: only files named by this plan are newly changed; every pre-existing EchoFlow hunk is preserved. Report the actual test counts, skipped/blocked gates, and the three remaining evidence gaps: live gateway sign-in/token creation, CLI root-cause reproduction, frontend ReferenceError location.

### Self-Review

- Spec coverage: existing login verification (Task 1 plus Task 6), safe diagnostics and index state (Tasks 1-2), session fallback evidence/concurrency (Task 3), negative team cache (Task 4), docs (Task 5), verification boundaries (Task 6). ReferenceError stack export is intentionally deferred because no safe stack policy exists.
- No task changes external gateways, CLI transports, `src/cli`, user data, or unrelated EchoFlow code.
- Type names used consistently: `EchoFlowApiError`, `LocalIndexStatus`, `ApiError`, `SessionService`.
- Review Focus inputs each have an owning test: body leakage Task 1; secret-shaped values Task 1; team 404/transient/new team Task 4; scan boundedness/order Task 3; index failure/path leakage Task 2.

---

<a id="specs-2026-10-31-diagnostic-remediation-design"></a>

## Diagnostic remediation design

来源：`specs/2026-10-31-diagnostic-remediation-design.md`。

### Intent

Turn the 2026-10-30 diagnostics bundle into verifiable fixes rather than guesses. Preserve the existing uncommitted EchoFlow login work, reduce repeated local overhead, and make the next bundle sufficient to locate failures without exporting content or credentials.

The archive was produced by app version 42.7.0. The current checkout is 0.7.2 with substantial uncommitted EchoFlow changes. Passing tests in this checkout are evidence for the new implementation, not proof that the historical installed build is already repaired.

### Evidence and boundaries

- `POST /api/echoflow/site-session`: 107 logged 502 responses; token login also succeeds. The current dirty diff replays browser request identity, restores cookies through Electron, and routes session traffic through a local authenticated bridge. It also creates main-site tokens with `routing_priority: 'auto'` and surfaces gateway refusal messages. These are existing changes to verify, not newly claimed work.
- `POST /api/echoflow/create-token`: 16 logged 502 responses and one 400. Offline fixtures cover the gateway's group-selection refusal and new request defaults. The external gateway's historical refusal is not observable in the bundle.
- One CLI process exits about 12 seconds after launch. WebSocket opening is the last transport event. Exit code, SDK error shape, and safe local stack are omitted by the sharing projection. No root cause is established; do not alter startup timeouts, retries, or `cli-core` transport behavior without a reproduction.
- Repeated slow session-list requests spend substantial time in process CPU. Index mode/state, scan counts, and stage timings are absent. The fallback walks discovered transcripts and builds summaries sequentially, but this is a hypothesis until measured. Session lifecycle and polling can share this work.
- A workbench miss performs full team/config/inbox and archive discovery. Successful discoveries already have a five-second TTL; misses are retried on every mount. Apply the same short TTL to misses, retaining force refresh, generation checks, and reconciliation.
- Six `ReferenceError` records have no safe stack. A stack whitelist cannot guarantee redaction of arbitrary file paths. A separately generated, sanitized, share-safe diagnostic stack needs explicit tests before implementation; it is not silently added to this scope.

No writes to actual user configuration, transcripts, credentials, external gateway state, production services, or release configuration. No dependency or new module is needed. `src/cli` and root runtime behavior stay unchanged.

### Changes

#### 1. Verify and finish the existing EchoFlow remediation

Owner: existing `desktop/electron/services/echoFlow*.ts`, `siteNetworkBridge.ts`, `serverRuntime.ts`, `main.ts`; `src/server/services/echoflowApiService.ts`, `src/server/api/echoflow.ts`; account settings UI and their tests.

- Reuse the current request helper and browser-profile/network-bridge implementation; do not introduce a parallel login service or merge dedicated and main-site protocols.
- Exercise all focused offline tests. Cover non-2xx management responses, site-session refresh, restoration, proxy/identity propagation, token creation, and the UI's refusal message.
- Preserve no-retry behavior for non-idempotent account creation and site-session operations.
- Only where a current response summary is dropped by diagnostics, emit bounded metadata (status, route, credential kind, transport) without headers, cookies, response bodies, or endpoint-specific user identifiers.
- Do not claim live recovery or token creation is fixed until a separately authorized real sign-in test proves it.

#### 2. Preserve useful safe diagnostics

Owner: `src/server/services/diagnosticsShare.ts`, `diagnosticsService.ts`, their tests, and only the event producers needed for CLI/team evidence.

- Extend the scalar whitelist with `exitCode`, `closeCode`, `closeReason` only when it is constrained to a known enum rather than free text, `errorCategory`, and necessary numeric scan/timing/count fields.
- Preserve safe nested error names and selected SDK event `type`/`subtype`; never export messages, captured output, SDK message bodies, arbitrary stack strings, request headers, or URLs.
- Emit `sdkType`/`subtype` on CLI startup failure and WebSocket permanent rejection from the already available parsed control messages. Keep the existing server-side raw logs for local debugging.
- Include `local-index-status.json` in exported bundles using `getLocalIndexStatus()`'s existing numeric/enum/date fields. Document the new file in the bundle README.
- For every new metadata field, test both its safe form and malicious/content-shaped values. Do not broaden projection to arbitrary objects or string stacks.
- Report the `APP_VERSION` source accurately: it is the runtime environment value, not automatically the checkout's `desktop/package.json` version. Do not change release versioning in this task.

#### 3. Measure and improve session-list fallback only at its proven common cost

Owner: `src/server/services/sessionService.ts` and `sessionService.sessionListPerformance.test.ts` / nearest list fixture test.

- Add one bounded/rate-limited diagnostic event for slow file-fallback list operations with index mode/state, discovered file count, cache hits/misses, scan/read counts, and phase durations. It must not contain transcript paths, titles, content, or per-file data.
- Measure discovery/stat, summary scanning, sorting, and final item preparation. Do not record every file or request; retain only aggregate counts and timings.
- With existing fixture behavior locked, evaluate one bounded parallel summary read for cache misses using the existing history-read budget. Use an existing concurrency/budget helper if it fits; do not create a new generic scheduler. Keep deterministic ordering, shared-request deduplication, and cache semantics unchanged.
- Land concurrency only if a test demonstrates bounded in-flight scans and identical result behavior. Otherwise ship just measurement and explicitly report the unresolved performance cause.
- Check project-history and session lifecycle callers for the same fallback; do not silently change retention, index invalidation, pagination, or transcript freshness.

#### 4. Cache negative team discovery without hiding later teams

Owner: `desktop/src/stores/teamStore.ts` and `teamStore.test.ts`.

- Record a miss in the existing `teamDiscoveryCompletedAt` map only after a genuine API 404 for the requested session and current generation. Use the existing five-second TTL for hits and misses.
- Before discovery, honor the TTL for both known and missing workbenches unless `force: true`; preserve live-event/reconnect forced reconciliation.
- Do not convert server/transport errors into negative results. Do not suppress the existing error behavior for those failures.
- Tests must cover repeated misses, forced retry, later successful discovery, archived timeline discovery, generation staleness, and non-404 failures.
- Keep the existing server workbench endpoint and team-service architecture; a second persisted team/session index is not justified by this evidence.

#### 5. Update the operating documentation, not the top-level contract

Owner: `docs/internals/contributing.md`.

Add a short diagnostic-export rule: exports retain typed exit/status/timing/count/index evidence needed for diagnosis; content-bearing fields and arbitrary stacks stay omitted; every new safe field has both positive and redaction tests. No root `AGENTS.md` rule, CI contract, release process, or new agent tool changes are required. Run the harness audit because agent-facing operational guidance changes.

### Test and handoff

- Focused tests before and after each change: EchoFlow service/API/UI/Electron; diagnostics projection/export; team store; session list performance.
- `bun run check:impact` determines final affected surfaces. Desktop chat/session changes also select `check:chat-contract` and `check:agent-flow`; Electron changes select `check:native`; provider changes select `check:provider-contract`.
- No claim of full PR readiness without `bun run verify`, coverage evidence, and real workflow evidence required by the final impact report.
- The old archive remains historical evidence. A new offline export test must demonstrate that safe fields and local-index state survive while fixtures containing secrets/private text do not.
- Remaining evidence gates: live EchoFlow gateway behavior; reproduction of the CLI failure and frontend ReferenceError; actual before/after performance on the affected session corpus. No live test is run without explicit authorization.

### Explicitly rejected

- Rewriting WebSocket or CLI startup behavior from one incomplete log.
- Retrying token/session creation automatically.
- Sending real credentials, cookies, stacks, response bodies, or transcript paths in a shared bundle.
- Replacing the session index or introducing a persistent team/session store as part of this repair.
- Broad refactoring of the already-dirty EchoFlow files merely to reduce line count.
