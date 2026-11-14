---
title: 账号与内容市场（历史归档）
nav_title: 账号与内容市场
description: 合并保存 2026 年的相关设计、计划与任务记录，不作为现行执行指令。
order: 2
---

# 账号与内容市场（历史归档）

本页于 2026-11-14 按主题合并旧 Superpowers 资料，保留原设计、计划、任务摘要和进度；仅调整标题层级、旧路径、插件要求与本地绝对路径。原文中的版本、审批、完成状态和测试结果均为当时记录，不代表当前实现、当前授权或本次验证。不得按归档中的命令直接继续旧任务。

现行要求以仓库 AGENTS.md、[执行与信任边界](../../../internals/execution-boundaries.md) 和 [贡献流程](../../../internals/contributing.md) 为准；[返回归档索引](README.md)。

## 来源目录

- [sdd/2026-10-echoflow-site-account-market/progress.md](#sdd-2026-10-echoflow-site-account-market-progress)
- [plans/2026-10-30-echoflow-sihub-account-merge.md](#plans-2026-10-30-echoflow-sihub-account-merge)
- [plans/2026-10-echoflow-site-account-market.md](#plans-2026-10-echoflow-site-account-market)
- [specs/2026-10-echoflow-site-account-market-design.md](#specs-2026-10-echoflow-site-account-market-design)

---

<a id="sdd-2026-10-echoflow-site-account-market-progress"></a>

## SDD ledger — plan: docs/_internal/archive/planning/accounts-and-market.md#plans-2026-10-echoflow-site-account-market

来源：`sdd/2026-10-echoflow-site-account-market/progress.md`。

Workspace: user declined worktree and explicitly chose in-place development; remain on the current main checkout and preserve all existing modifications. The SDD helper scripts `task-start`/`task-done` are absent from this plugin installation, so execute the plan's tests directly and maintain this ledger manually.
Pre-flight interface Task 1 -> Task 3: Task 1 owns the isolated login BrowserWindow and Electron cookie jar; it must never return cookies to renderer. Task 3's main process consumes the cookie jar and sends cookies directly to server over sidecar-only bridge secret. Compatible.
Pre-flight interface Task 2 -> Task 3: main-site `/api/user/self` requires `New-Api-User`; identity is captured only from the fixed-origin successful `/api/user/login` response through Electron CDP, then the local server validates the account ID against `/api/user/self`. The request body/password is never read.
Pre-flight interface Task 3 -> Tasks 4/5: server session API returns public account DTO only; market service consumes server-owned cookie; React receives no bootstrap endpoint or secret. Compatible.
Task 1: in progress.
Task 1: complete (no commit requested; tests: `bun test ./electron/services/echoFlowLogin.test.ts` → 5 pass; `bun test ./electron` → 644 pass, 1 skip, 0 fail). `bun run check:electron` was attempted; TypeScript currently fails in untouched `electron/services/runtimeDiscovery.ts` and `runtimeDiscovery.test.ts` with existing unused-symbol/mock-type errors. Live site login identity check remains explicitly pending Task 3.
Task 2: in progress. Ruling: bind the CDP-captured login user ID to the fixed-origin `/api/user/self` result using `New-Api-User`; fail closed on ID mismatch.
Task 2: complete (no commit requested; tests: `bun test src/server/services/echoFlowSiteSession.test.ts` → 7 pass, 0 fail). Service holds raw cookie only in memory, sends fixed-origin `Cookie` self request, validates identity/quota, and exposes no secret in its account DTO.
Task 3: in progress. Added a server-generation-only 256-bit bridge secret distinct from the renderer local-access token; Electron main-only no-payload login/sign-out IPC; CDP reader for successful login response identity; site session service/API and server remote-browser denial. Bootstrap sends the cookie only over the authorized local bridge, and the server retains it in memory only. Real Turnstile login remains unverified until the user signs in through the app.
Task 3: Ruling: automatic rehydration validates persisted Electron-partition cookies by repeating `/api/user/self` before sending them to the server; if server is offline it leaves the server signed out, and the next `onServerReady` retries. This keeps the shared persistent partition durable without exposing raw cookies to renderer; cost if wrong: account view remains signed out until retry after transient API/server failure.
Task 3: partial. Protected route/service, sidecar-only bridge secret, Electron-only login IPC/window, typed public status methods, account dock, locale entries, and fake-session tests were added. `bun run check:electron` passed (TS, 656 Electron tests: 655 pass/1 skip, bundle). `bun test src/server/__tests__/echoflow-api.test.ts src/server/services/echoFlowSiteSession.test.ts src/server/router.remoteBrowser.test.ts` passed before adding the required userId protocol; after that protocol was recognized, the tool classifier blocked the test run because it exercises sending a site session cookie into the local server. No real site session was used. User explicitly authorized the Electron-main -> authenticated loopback -> server-memory-only cookie handoff. Focused server tests now verify the New-Api-User header and no cookie leakage; no real site session has been used.
Current Task 3 modified surfaces include Electron IPC/main/runtime, server session API/service/router, renderer API/host, Sidebar account dock and locale strings. Existing user changes in Sidebar, API files, and tests remain; do not overwrite them.

---

<a id="plans-2026-10-30-echoflow-sihub-account-merge"></a>

## EchoFlow SiHub Account Merge Implementation Plan

来源：`plans/2026-10-30-echoflow-sihub-account-merge.md`。

**Goal:** One account surface in Model Management that signs in to EchoFlow SiHub's main site and dedicated line through their own login pages, replacing the paste-a-token flow, with the bottom-left account dock removed and the API business renamed and reworded for compliance.

**Architecture:** The existing `EchoFlowApiService` becomes the single account facade. A credential is one of `token` (legacy user ID + system access token), `session` (main-site cookie held by Electron and passed to the server in memory), or `bearer` (dedicated gateway access token). The Electron login window becomes profile-driven: one profile per endpoint, each knowing its URL, partition, navigation allowlist, and how to read a credential from the page. Credentials never reach the renderer; only user ID, username, balance, and token options do.

**Tech Stack:** TypeScript, Electron 42, React 19, Bun test (server and `desktop/electron`), Vitest/Testing Library (`desktop/src`), new-api site APIs.

**Spec:** `docs/_internal/archive/planning/accounts-and-market.md#specs-2026-10-echoflow-site-account-market-design` (local, gitignored), plus the decisions recorded in this plan.

### Global Constraints

- Do not change or extend the EchoFlow site backend. Only existing endpoints may be called: main site `GET /api/user/self`, `GET /api/token/?p=N&size=100`; dedicated gateway `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, model relay `https://expapi.echoflowai.cc/v1`.
- Never persist, log, or return a site cookie or access token. The account JSON stores only `userId`, `username`, `credential` kind, and the legacy `managementToken` for token-bound accounts.
- The renderer receives only `{ userId, username, balance, refreshedAt, tokens }`. No cookie, token, or raw upstream body crosses the preload boundary.
- Every new translation key goes into all five files under `desktop/src/i18n/locales/`.
- `providerPresets.json` keeps `"id": "echoflowai"` unchanged. Only display fields `name` and `promoText` change.
- Existing saved providers and token-bound accounts keep working. `echoflow-account.json` upgrades forward and preserves unknown fields.
- Copy rules for the EchoFlow API business: no “官方”/“Official/공식/公式”, no “国内”/“China”/“中国国内”. Use “推荐接入” and add the legal-region disclaimer. “官方” stays for Claude, ChatGPT, and Grok OAuth, which are factual vendor logins.
- The site at `api.echoflowai.cc` is a separate project. Its own page titles are out of scope for this repository.
- Style: TypeScript 2-space, ESM, no semicolons, single quotes; `PascalCase` components, descriptive file names.
- Do not copy code from `dsh` or any other project; reimplement with this repository's own names and tests.

### Review Focus

1. A negative-balance account signs in and shows a negative balance instead of being rejected as invalid. (Task 1)
2. An expired session cookie shows “需要重新登录” per endpoint; it never leaves the UI in “正在登录…” or reports a stale balance. (Tasks 8, 12)
3. Signing out of one endpoint leaves the other endpoint's account, tokens, and providers untouched. (Task 8)
4. Restarting the app rehydrates the main-site account from the persistent partition and the stored user ID only; the dedicated account asks for a new login because its token is intentionally not persisted. (Tasks 5, 8, 11)
5. A v2 `echoflow-account.json` from a token-bound user loads unchanged and is migrated to v3 without deleting or rewriting the token. (Task 5)

---

#### Task 1: Accept negative quota

**Files:**
- Modify: `src/server/services/echoFlowSiteSession.ts:103-108`
- Test: `src/server/services/echoFlowSiteSession.test.ts`

**Interfaces:**
- Consumes: `EchoFlowSiteSession.setSession({ cookie, userId })`
- Produces: `EchoFlowSiteAccount` with `balance: quota / 500_000`, which may be negative.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts an account whose quota is negative', async () => {
  const session = new EchoFlowSiteSession({ fetch: fakeFetch({ id: 851842, username: 'zhijun2003', quota: -11002 }) })
  const account = await session.setSession({ cookie: 'session=live', userId: '851842' })
  expect(account.balance).toBeCloseTo(-0.022004)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/server/services/echoFlowSiteSession.test.ts`
Expected: FAIL with `EchoFlowSiteSessionError: invalid_response`.

- [ ] **Step 3: Remove `quota < 0` from the validity condition**

The site allows debt; only a non-finite or non-numeric quota is invalid.

- [ ] **Step 4: Re-run the test**

Run: `bun test src/server/services/echoFlowSiteSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/echoFlowSiteSession.ts src/server/services/echoFlowSiteSession.test.ts
git commit -m "fix(server): accept a negative site quota for the account session"
```

#### Task 2: Fix the endpoint placeholder in all locales

**Files:**
- Modify: `desktop/src/i18n/locales/{zh,zh-TW,en,jp,kr}.ts`
- Test: `desktop/src/i18n/locales.test.ts` (create if absent)

**Interfaces:**
- Produces: `echoflowApiOfficialLogin.bindAccount` values containing `{endpoint}`, never `{{endpoint}}`.

- [ ] **Step 1: Write the failing test**

```ts
it('interpolates the endpoint with single braces', async () => {
  for (const locale of [zh, zhTW, en, jp, kr]) {
    expect(locale['echoflowApiOfficialLogin.bindAccount']).toContain('{endpoint}')
    expect(locale['echoflowApiOfficialLogin.bindAccount']).not.toContain('{{endpoint}}')
  }
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd desktop && bun run test -- --run src/i18n/locales.test.ts`
Expected: FAIL on all five locale values.

- [ ] **Step 3: Replace `{{endpoint}}` with `{endpoint}` in all five files**

- [ ] **Step 4: Re-run the test**

Expected: PASS. Then confirm in the running app that the button reads “绑定主站账户”.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/i18n/locales desktop/src/i18n/locales.test.ts
git commit -m "fix(desktop): interpolate the endpoint label in the bind-account button"
```

#### Task 3: Fail fast when the credential bridge rejects a signed-in session

**Files:**
- Modify: `desktop/electron/services/echoFlowLogin.ts`
- Test: `desktop/electron/services/echoFlowLogin.test.ts`

**Interfaces:**
- Consumes: `deps.verifySession(cookies, identity)`
- Produces: `EchoFlowLoginResult = 'failed'` after `identityRetryMs * 3` of consecutive rejections, instead of waiting for `loginTimeoutMs`.

- [ ] **Step 1: Write the failing test**

```ts
it('fails after three rejected session bootstraps instead of waiting for the login timeout', async () => {
  const verifySession = vi.fn(async () => false)
  const session = new EchoFlowLoginSession({ ...deps, verifySession, identityRetryMs: 10, loginTimeoutMs: 60_000 })
  const result = session.open()
  await windowFake.finishLoad()
  windowFake.setCookies([{ name: 'session', value: 'live' }])
  windowFake.setPageUser({ id: 1, username: 'u' })
  await expect(result).resolves.toBe('failed')
  expect(windowFake.closed).toBe(true)
})
```

- [ ] **Step 2: Run it and watch it time out/fail**

Run: `cd desktop && bun test ./electron/services/echoFlowLogin.test.ts`
Expected: FAIL (the promise stays pending).

- [ ] **Step 3: Add a consecutive-rejection counter**

Add `private identityRejections = 0`. Increment when `verifySession` returns false; reset on success. When it reaches 3, call `this.failAndClose(window, 'bootstrap-rejected')`.

- [ ] **Step 4: Re-run the suite**

Run: `cd desktop && bun test ./electron/services/echoFlowLogin.test.ts`
Expected: PASS, all existing cases still green.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/echoFlowLogin.ts desktop/electron/services/echoFlowLogin.test.ts
git commit -m "fix(desktop): stop waiting when the account bridge rejects the session"
```

#### Task 4: Server credential union for the main-site session

**Files:**
- Modify: `src/server/services/echoflowApiService.ts`
- Modify: `src/server/api/echoflow.ts`
- Test: `src/server/services/echoflowApiService.test.ts`, `src/server/__tests__/echoflow-api.test.ts`

**Interfaces:**
- Produces:

```ts
export type EchoFlowCredential =
  | { kind: 'token'; userId: string; managementToken: string }
  | { kind: 'session'; userId: string; cookie: string }
  | { kind: 'bearer'; userId: string; accessToken: string }

setCredential(endpoint: EchoFlowEndpoint, credential: EchoFlowCredential): Promise<EchoFlowAccount>
clearCredential(endpoint: EchoFlowEndpoint): void
```

- `fetchManagementApi(pathname, credential, endpoint)` sends `Authorization: managementToken` for `token`, `Authorization: Bearer accessToken` for `bearer`, and `Cookie` + `New-Api-User` for `session`.
- `getAccounts()` returns stored accounts plus a `live: boolean` derived from the in-memory credential.

- [ ] **Step 1: Write the failing test**

```ts
it('lists tokens with the session cookie and the New-Api-User header', async () => {
  const calls: RequestInit[] = []
  const service = new EchoFlowApiService({ fetch: async (_url, init) => { calls.push(init!); return jsonResponse({ success: true, data: { items: [] } }) } })
  await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
  await service.listTokensWithCredential('main')
  expect(new Headers(calls.at(-1)!.headers).get('cookie')).toBe('session=live')
  expect(new Headers(calls.at(-1)!.headers).get('new-api-user')).toBe('851842')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/server/services/echoflowApiService.test.ts`
Expected: FAIL (`setCredential` is not a function).

- [ ] **Step 3: Implement the union and route**

- Add the credential map in `EchoFlowApiService`.
- `setCredential` validates via `/api/user/self` and returns the normalized account. It persists only `{ userId, username, credential }` metadata; the cookie stays in memory.
- `listTokensWithCredential(endpoint)` reuses the existing pagination loop with the in-memory credential.
- Add `POST /api/echoflow/account/session` accepting `{ endpoint, kind: 'session', cookie, userId }` and calling `setCredential`; respond `{ account }`. Leave the old `site-session` route untouched until Task 13 removes it.
- Reject `session` credentials for `dedicated` until Task 11.

- [ ] **Step 4: Re-run the server suites**

Run: `bun test src/server/services/echoflowApiService.test.ts src/server/__tests__/echoflow-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/echoflowApiService.ts src/server/api/echoflow.ts src/server/services/echoflowApiService.test.ts src/server/__tests__/echoflow-api.test.ts
git commit -m "feat(server): accept a main-site session credential for account and token reads"
```

#### Task 5: Persist the credential kind with a v3 migration

**Files:**
- Modify: `src/server/services/echoflowApiService.ts`
- Test: `src/server/services/echoflowApiService.test.ts`, `src/server/__tests__/echoflow-api.test.ts`
- Fixture: `src/server/__tests__/fixtures/echoflow-account-v2.json` (create)

**Interfaces:**
- Produces: stored shape

```ts
type StoredEchoFlowAccount = {
  userId: string
  credential: 'token' | 'session' | 'bearer'
  managementToken?: string
  username?: string
  balance?: number
  userGroup?: string
  tokens?: EchoFlowTokenOption[]
  refreshedAt?: number
  endpoint?: EchoFlowEndpoint
}
type StoredEchoFlowAccounts = { schemaVersion: 3; accounts: Record<EchoFlowEndpoint, StoredEchoFlowAccount | null> }
```

- [ ] **Step 1: Write the failing migration test**

```ts
it('upgrades a v2 account file to v3 without dropping the management token', async () => {
  const dir = tempDirWith('echoflow-account.json', v2Fixture)
  const service = new EchoFlowApiService({ configDir: dir })
  const accounts = await service.getAccounts()
  const raw = await readRaw(join(dir, 'echoflow-account.json'))
  expect(accounts.accounts.main?.credential).toBe('token')
  expect(raw).toContain('"credential": "token"')
  expect(raw).toContain('"managementToken"')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/server/services/echoflowApiService.test.ts`
Expected: FAIL (`credential` is undefined / file not rewritten).

- [ ] **Step 3: Implement the migration**

Read `schemaVersion`; when it is `2`, add `credential: 'token'` to every non-null account, preserve all unknown fields, write atomically with mode `0600`, and set `schemaVersion: 3`. A v3 file is read as-is.

- [ ] **Step 4: Run the persistence gate**

Run: `bun run check:persistence-upgrade`
Expected: PASS with the new fixture counted.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/echoflowApiService.ts src/server/services/echoflowApiService.test.ts src/server/__tests__/fixtures/echoflow-account-v2.json
git commit -m "feat(server): version the account store and migrate token-bound accounts"
```

#### Task 6: Profile-driven login window for the main endpoint

**Files:**
- Modify: `desktop/electron/services/echoFlowLogin.ts`
- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/ipc/channels.ts`, `desktop/electron/ipc/capabilities.ts`, `desktop/electron/preload.ts`
- Modify: `desktop/src/lib/desktopHost/types.ts`, `electronHost.ts`, `browserHost.ts`
- Test: `desktop/electron/services/echoFlowLogin.test.ts`, `desktop/electron/ipc/capabilities.test.ts`

**Interfaces:**
- Produces:

```ts
export type EchoFlowLoginEndpoint = 'main' | 'dedicated'
export type EchoFlowLoginProfile = {
  endpoint: EchoFlowLoginEndpoint
  url: string
  origin: string
  partition: string
  allowedHosts: ReadonlySet<string>
}
export interface EchoFlowLoginSessionDeps {
  profiles: Record<EchoFlowLoginEndpoint, EchoFlowLoginProfile>
  verifySession: (endpoint: EchoFlowLoginEndpoint, credential: EchoFlowLoginCredential) => Promise<boolean>
  readCredential: (endpoint: EchoFlowLoginEndpoint, window: EchoFlowLoginWindow) => Promise<EchoFlowLoginCredential | null>
}
open(endpoint?: EchoFlowLoginEndpoint): Promise<EchoFlowLoginResult>
```

- `openLogin(endpoint: EchoFlowLoginEndpoint)` crosses IPC; the default remains `'main'` for one release.

- [ ] **Step 1: Write the failing tests**

```ts
it('opens the main profile in its own partition', async () => {
  const session = new EchoFlowLoginSession(deps)
  void session.open('main')
  expect(deps.createWindow).toHaveBeenCalledWith('persist:echoflow-site-login')
  expect(windowFake.loadedUrl).toBe('https://api.echoflowai.cc/login')
})
it('rejects a navigation to an origin outside the profile allowlist', async () => {
  // navigate to https://evil.example — expect preventDefault
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd desktop && bun test ./electron/services/echoFlowLogin.test.ts`
Expected: FAIL (no `endpoint` parameter).

- [ ] **Step 3: Refactor the class to take a profile**

Move `ECHOFLOW_LOGIN_URL`, `ECHOFLOW_LOGIN_ORIGIN`, `ECHOFLOW_LOGIN_PARTITION`, and `ALLOWED_OAUTH_HOSTS` into a `MAIN_LOGIN_PROFILE`. Keep the existing main-site behavior byte-for-byte. Replace the hard-coded `isAllowedSiteNavigation` with a per-profile check. `readCredential` for main keeps the current cookie + page-identity logic.

- [ ] **Step 4: Re-run the electron tests**

Run: `cd desktop && bun test ./electron`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron desktop/src/lib/desktopHost
git commit -m "refactor(desktop): drive the login window from an endpoint profile"
```

#### Task 7: Make Model Management the only account surface

**Files:**
- Modify: `desktop/src/components/settings/EchoFlowAPIOfficialLogin.tsx`
- Modify: `desktop/src/pages/settings/ProviderSettings.tsx`
- Modify: `desktop/src/api/echoflow.ts`
- Modify: `desktop/src/components/layout/Sidebar.tsx:1477`
- Delete: `desktop/src/components/layout/EchoFlowAccountDock.tsx`, `EchoFlowAccountDock.test.tsx`
- Modify: `desktop/src/lib/desktopHost/types.ts`, `electronHost.ts`
- Test: `EchoFlowAPIOfficialLogin.test.tsx`, `ProviderSettings.test.tsx`, `Sidebar.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `host.echoFlow.openLogin(endpoint)`, `echoflowApi.getAccounts()`, `echoflowApi.refreshAccount(endpoint)`, `echoflowApi.disconnectAccount(endpoint)`.
- Produces: an account block with these states per endpoint: `signedOut`, `signingIn`, `authenticated`, `needsRelogin`, `error`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('signs in from the account block with the selected endpoint', async () => {
  render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'echoflowApiOfficialLogin.signIn' }))
  expect(hostMock.echoFlow.openLogin).toHaveBeenCalledWith('main')
})
it('keeps manual token binding available under the advanced section', async () => {
  // open the disclosure, fill user ID + token, expect bindAccount called
})
it('does not render the bottom-left account dock', () => {
  render(<Sidebar />)
  expect(screen.queryByText('echoflowAccount.signIn')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd desktop && bun run test -- --run src/components/settings/EchoFlowAPIOfficialLogin.test.tsx src/pages/settings/ProviderSettings.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the account block and remove the dock**

- Primary button: “登录 EchoFlow SiHub” → `openLogin(selectedEndpoint)`; on `authenticated`, `refreshAccount(endpoint)`; on `failed`, show `echoflowApiOfficialLogin.signInFailed`; on `cancelled`, reset.
- Signed-in state keeps username/balance/refresh/disconnect and the token list.
- Move the user ID + system access token form under a `<details>` labelled “手动绑定（高级）” and keep `bindAccount` unchanged.
- Remove `getSiteSession`/`refreshSiteSession` from `echoflowApi` and their server routes.
- Delete the dock and remove `<EchoFlowAccountDock />` from `Sidebar`.
- Remove `echoflowAccount.*` keys from all five locales.
- Add the disclaimer line under the block.

- [ ] **Step 4: Re-run the desktop tests**

Run: `cd desktop && bun run test -- --run src/components/settings/EchoFlowAPIOfficialLogin.test.tsx src/pages/settings/ProviderSettings.test.tsx src/components/layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src desktop/src/i18n/locales
git commit -m "feat(desktop): move EchoFlow account sign-in into model management"
```

#### Task 8: Rehydrate and sign out per endpoint

**Files:**
- Modify: `desktop/electron/main.ts:270-380`
- Modify: `desktop/electron/services/echoFlowLogin.ts`
- Test: `desktop/electron/services/echoFlowLogin.test.ts`, `desktop/src/pages/settings/ProviderSettings.test.tsx`

**Interfaces:**
- Consumes: persisted `{ userId, credential: 'session' }`, the partition cookies, `setCredential`.
- Produces: `rehydrate(endpoint)`, `clear(endpoint)`; `deps.clearCookies(endpoint)` and `deps.readCookies(endpoint)` become per-endpoint. Sign-out clears only that endpoint's partition, in-memory credential, and stored account.

- [ ] **Step 1: Write the failing tests**

```ts
it('rehydrates the main account from the partition cookie and the stored user id', async () => {
  await expect(session.rehydrate('main')).resolves.toBe(true)
  expect(deps.verifySession).toHaveBeenCalledWith('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
})
it('signs out the main endpoint without touching the dedicated account', async () => {
  await session.clear('main')
  expect(deps.clearCookies).toHaveBeenCalledWith('main')
  expect(await service.getAccounts()).toMatchObject({ accounts: { dedicated: { userId: 'x' } } })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd desktop && bun test ./electron/services/echoFlowLogin.test.ts`
Expected: FAIL (no `endpoint` argument).

- [ ] **Step 3: Implement per-endpoint rehydrate and sign-out**

- On startup, iterate stored accounts: `session` → cookies present + `verifySession`; missing cookie → mark `needsRelogin` without deleting the stored `{userId, username}`.
- `bearer` → do not rehydrate (token intentionally not persisted); mark `needsRelogin`.
- `token` → unchanged legacy rehydrate.
- Sign-out deletes the stored account for that endpoint and clears its partition.

- [ ] **Step 4: Re-run the tests**

Run: `cd desktop && bun test ./electron && cd .. && bun test src/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron desktop/src
git commit -m "feat(desktop): rehydrate and sign out each endpoint independently"
```

#### Task 9: Probe the dedicated gateway contract (manual evidence)

**Files:** none (record findings in this plan)

**Interfaces:**
- Produces: the exact `auth_user` shape, the `/api/v1/auth/me` response, and whether the access token is accepted by `https://expapi.echoflowai.cc/v1/models`.

- [ ] **Step 1: Log in to `https://expapi.echoflowai.cc/login` in the app's login window with a test account**
- [ ] **Step 2: Record the keys (not values) of `localStorage.auth_user` and the status/shape of `GET /api/v1/auth/me`**
- [ ] **Step 3: Call `GET https://expapi.echoflowai.cc/v1/models` with `Authorization: Bearer <access_token>` and record the status**
- [ ] **Step 4: Decide**
  - If `/v1/models` returns 200, the access token is the provider key; continue to Task 10.
  - If it returns 401/403, stop. The dedicated login only replaces account display; report that the provider key still needs a backend/API decision.

#### Task 10: Dedicated login window

**Files:**
- Modify: `desktop/electron/services/echoFlowLogin.ts`, `desktop/electron/main.ts`
- Test: `desktop/electron/services/echoFlowLogin.test.ts`

**Interfaces:**
- Consumes: the Task 9 contract.
- Produces: `DEDICATED_LOGIN_PROFILE = { endpoint: 'dedicated', url: 'https://expapi.echoflowai.cc/login', origin: 'https://expapi.echoflowai.cc', partition: 'persist:echoflow-dedicated-login', allowedHosts: new Set(['expapi.echoflowai.cc']) }`
- `readCredential` for dedicated reads `localStorage.auth_token` and `localStorage.auth_user`.

- [ ] **Step 1: Write the failing test**

```ts
it('completes the dedicated login from the gateway access token', async () => {
  void session.open('dedicated')
  windowFake.setLocalStorage({ auth_token: 'jwt', auth_user: JSON.stringify({ id: 7, username: 'u' }) })
  await expect(result).resolves.toBe('authenticated')
  expect(deps.verifySession).toHaveBeenCalledWith('dedicated', { kind: 'bearer', accessToken: 'jwt', userId: '7' })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd desktop && bun test ./electron/services/echoFlowLogin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the profile and credential reader**

- Poll the same interval; a non-empty `auth_token` plus a parsable `auth_user` completes the login.
- Reject expired tokens (`token_expires_at` in the past) and keep polling.
- Never log the token.

- [ ] **Step 4: Re-run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron
git commit -m "feat(desktop): sign in to the dedicated gateway from its own login page"
```

#### Task 11: Dedicated bearer credential and provider mapping

**Files:**
- Modify: `src/server/services/echoflowApiService.ts`, `src/server/api/echoflow.ts`
- Modify: `desktop/src/pages/settings/ProviderSettings.tsx`
- Test: `src/server/services/echoflowApiService.test.ts`, `ProviderSettings.test.tsx`

**Interfaces:**
- Consumes: `{ kind: 'bearer', accessToken, userId }`; the Task 9 probe result.
- Produces: a dedicated account display from `GET /api/v1/auth/me`; a provider draft with base URL `https://expapi.echoflowai.cc/v1`, OpenAI format, and the access token as the key (only if Task 9 proved `/v1/models` accepts it).

- [ ] **Step 1: Write the failing tests**

```ts
it('reads the dedicated account with its bearer token', async () => {
  await service.setCredential('dedicated', { kind: 'bearer', userId: '7', accessToken: 'jwt' })
  expect(await service.getAccount('dedicated')).toMatchObject({ userId: '7' })
})
it('creates the dedicated provider with the gateway base URL and OpenAI format', async () => {
  // expect draft.baseUrl === 'https://expapi.echoflowai.cc/v1', draft.apiFormat === 'openai'
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `bun test src/server/services/echoflowApiService.test.ts` and the desktop test.
Expected: FAIL.

- [ ] **Step 3: Implement the bearer path**

- `fetchManagementApi` sends `Authorization: Bearer <accessToken>` for `bearer`.
- For `dedicated`, call `/api/v1/auth/me`; do **not** call `/api/user/self` or `/api/token`.
- `setCredential('dedicated', …)` persists only `{ userId, username, credential: 'bearer' }`, so `getAccount('dedicated')` reflects the live account metadata.
- Provider creation uses the dedicated base URL and OpenAI format.
- The token stays in memory.

- [ ] **Step 4: Re-run the tests**

Expected: PASS. If Task 9 showed the token is not a model key, implement the account display only and leave the manual token binding as the provider path; record the blocker in the handoff.

- [ ] **Step 5: Commit**

```bash
git add src/server desktop/src
git commit -m "feat: bind the dedicated gateway account through its bearer session"
```

#### Task 12: Rebrand to EchoFlow SiHub and reword for compliance

**Files:**
- Modify: `src/server/config/providerPresets.json:17-34`
- Modify: `desktop/src/i18n/locales/{zh,zh-TW,en,jp,kr}.ts`
- Modify: `desktop/electron/main.ts` (window title)
- Test: `src/server/config/providerPresets.test.ts` (create if absent), `desktop/src/i18n/locales.test.ts`

**Interfaces:**
- Produces: display name “EchoFlow SiHub 推荐接入” (and its translations), `promoText` without region claims, a disclaimer key present in all five locales.

- [ ] **Step 1: Write the failing copy tests**

```ts
it('does not call the EchoFlow API business official or China-only', async () => {
  const preset = readPreset('echoflowai')
  expect(preset.id).toBe('echoflowai')
  expect(`${preset.name} ${preset.promoText}`).not.toMatch(/官方|Official|공식|公式|国内|China|中国国内/)
  expect(preset.promoText).toMatch(/推荐|recommended/)
})
it('adds the legal-region disclaimer in all five locales', async () => {
  for (const locale of [zh, zhTW, en, jp, kr]) {
    expect(locale['settings.providers.echoflowAPIOfficialDisclaimer']).toMatch(/法律|law|법률|法令/)
  }
})
```

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL.

- [ ] **Step 3: Update the copy**

- `name`: “EchoFlow SiHub 推荐接入” / “EchoFlow SiHub (Recommended)” / “EchoFlow SiHub 추천 연동” / “EchoFlow SiHub おすすめ接続” / “EchoFlow SiHub 推薦接入”.
- `promoText` / `Desc`: remove “官方/国内/China”; keep “500+ 模型, Claude / OpenAI 兼容”; add: “模型与服务仅在您所在地区法律法规允许的范围内提供，请自行确认所在地的合规要求与可用性。”
- Remove the “清雲” legacy prefix from zh-TW/jp/kr.
- Window title: “EchoFlow SiHub 账号登录”.

- [ ] **Step 4: Re-run the copy tests and the desktop suite**

Run: `cd desktop && bun run test -- --run src/i18n/locales.test.ts && cd .. && bun test src/server/config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/config/providerPresets.json desktop/src/i18n/locales desktop/electron/main.ts
git commit -m "feat: present the API business as EchoFlow SiHub recommended access"
```

#### Task 13: Remove the dead site-session surface

**Files:**
- Modify: `desktop/src/api/echoflow.ts`, `src/server/api/echoflow.ts`, `desktop/electron/main.ts`
- Delete: `src/server/services/echoFlowSiteSession.ts`, `src/server/services/echoFlowSiteSession.test.ts` (after Task 4 absorbs its behavior)
- Test: `src/server/__tests__/echoflow-api.test.ts`, `desktop/src/api/echoflow.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
it('no longer serves the separate site session route', async () => {
  const response = await app.fetch(new Request('http://localhost/api/echoflow/site-session'))
  expect(response.status).toBe(404)
})
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL (route still exists).

- [ ] **Step 3: Remove `getSiteSession`, `refreshSiteSession`, the old `site-session` GET/refresh routes, and the old service**

The credential-setting route added in Task 4 (`POST /api/echoflow/account/session`) stays. All account reads go through `/api/echoflow` and `/api/echoflow/account`.

- [ ] **Step 4: Re-run the server and desktop suites**

Run: `bun test src/server && cd desktop && bun run test -- --run src/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/server desktop/src desktop/electron
git commit -m "refactor: drop the separate site-session surface"
```

#### Task 14: Blank-page guard for the site login window

**Files:**
- Modify: `desktop/electron/services/echoFlowLogin.ts`
- Test: `desktop/electron/services/echoFlowLogin.test.ts`

**Interfaces:**
- Produces: one automatic reload when a finished page has an empty body for 3 consecutive polls.

- [ ] **Step 1: Write the failing test**

```ts
it('reloads once when the site page finishes loading with an empty body', async () => {
  // page reports body text length 0 on three polls, then content on the fourth
  expect(windowFake.loadCalls).toBe(2)
})
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL.

- [ ] **Step 3: Implement the guard**

After `did-finish-load`, poll `document.body.innerText.trim().length === 0`; on the third empty poll, call `loadURL` once. Comment: `shortcut: host-side blank check, replace with the site's own preload-error handler once the site repo ships it.`

- [ ] **Step 4: Re-run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/echoFlowLogin.ts desktop/electron/services/echoFlowLogin.test.ts
git commit -m "fix(desktop): recover from a blank site login page once"
```

### Verification

Run in order after all tasks:

```bash
bun run check:impact
bun run check:desktop
bun run check:server
bun run check:native
bun run check:persistence-upgrade
bun run check:coverage
```

`check:chat-contract` and `check:agent-flow` are required only if `check:impact` selects them. Record the coverage report path, the E2E evidence, and any skipped manual probe.

### Out of Scope

- Renaming the site at `api.echoflowai.cc`; that project owns its own page titles and console copy.
- Renaming internal identifiers (`EchoFlowAPIOfficialLogin`, `echoflowApiOfficialLogin.*`) and file names.
- Changing the `echoflowai` preset id or any saved provider record.
- Backend changes to the dedicated gateway. Task 9 is a gate: if the gateway does not expose a usable model key, stop and report.
- Persisting the dedicated bearer token. The user signs in again after a restart.

### Risks

- The dedicated gateway's access token may be management-only. Task 9 decides before any UI is built.
- Removing the dock deletes a recently added surface; the provider settings block must keep the same sign-in visibility so the feature does not disappear.
- The account JSON gains fields; the v3 migration must preserve unknown fields or older/newer builds will drop user data.
- The site can stay blank when a lazy chunk fails; Task 14 is a host-side guard, not a site fix.

---

<a id="plans-2026-10-echoflow-site-account-market"></a>

## EchoFlow Site Account and Market Implementation Plan

来源：`plans/2026-10-echoflow-site-account-market.md`。

**Goal:** Add main-site EchoFlow login and account status/balance, then expose the authenticated EchoFlow content catalog while preserving existing account binding and local market behavior.

**Architecture:** Electron main owns a dedicated persistent site-login session and opens only the fixed EchoFlow HTTPS origin. A narrow Electron-main-to-local-server bridge passes the session using a sidecar-only bridge secret that is never exposed to the renderer; the server owns account and catalog requests and returns only validated public data. Desktop UI consumes those APIs; content installation is limited to formats proven compatible with existing EchoFlow Code installers.

**Tech Stack:** Electron, TypeScript, React, Bun server/tests, existing local-access-token API, existing desktop host IPC and market stores/components.

**Spec:** `docs/_internal/archive/planning/accounts-and-market.md#specs-2026-10-echoflow-site-account-market-design`

### Global Constraints

- First release supports the main endpoint only; dedicated-endpoint binding remains unchanged.
- Existing user-ID/management-token account binding and existing local skills-market behavior remain compatible.
- Site login/password and Turnstile are handled by the actual site page; never submit a password from EchoFlow Code or bypass/replay Turnstile.
- Raw site cookies never enter React, localStorage, provider settings, ordinary config JSON, or logs.
- Cookie bootstrap is authorized by a per-server-generation bridge secret available only to Electron main and the local server process; the renderer-visible local API token alone must not authorize session bootstrap.
- The renderer never supplies a URL for the server to fetch; all site destinations are fixed to the verified main origin.
- No site API token is silently created, rotated, or revoked.
- Market reads are read-only; install actions require explicit confirmation, verified format compatibility, archive/path validation, and failure-safe writes.
- Do not overwrite, revert, stage, or reformat pre-existing user changes; inspect overlapping hunks before edits.

### Review Focus

- A site login accepted in Electron but missing/expired cookies or account identity must remain signed out; test incomplete handoff and retry without exposing secrets.
- Loopback session bootstrap must reject renderer-known local tokens, invalid bridge secrets, and remote/public requests; test bridge-secret authorization and remote-browser denial.
- Turnstile/login redirects must not let an arbitrary origin signal success or deliver cookies; test fixed-origin navigation and cancellation.
- Malformed, oversized, stale, or unsupported catalog/artifact responses must not mutate local files; test response validation and install refusal.
- Sign-out or expired site session must not delete ID/management-token accounts, providers, or the local skill market; test preservation.

---

### File Map

#### Electron session and handoff

- Modify `desktop/electron/main.ts` to create, own, and dispose a dedicated login BrowserWindow/session service; keep it separate from the app renderer and workspace/preview partitions.
- Create `desktop/electron/services/echoFlowLogin.ts` and `desktop/electron/services/echoFlowLogin.test.ts` for a small injectable login-session controller: fixed origin, single active window, close/cancel handling, redirect policy, session cookie extraction, and handoff callback. Keep Electron-facing behavior testable with fakes.
- Modify `desktop/electron/ipc/channels.ts` and `desktop/electron/ipc/capabilities.ts` for a no-argument `echoflowLoginOpen` operation, allowed only from the main application window.
- Modify `desktop/src/lib/desktopHost/types.ts`, `desktop/src/lib/desktopHost/electronHost.ts`, and their tests to expose `echoFlow.openLogin()` without exposing cookie data.

#### Local server account session/API

- Create `src/server/services/echoFlowSiteSession.ts` and `src/server/services/echoFlowSiteSession.test.ts` for in-memory session ownership, fixed-origin account/self requests, response validation, timeout, and logout.
- Modify `desktop/electron/services/serverRuntime.ts` to generate and inject a per-generation bridge secret into the server process without exposing it via IPC; expose it only to Electron main for its loopback bootstrap request.
- Modify `src/server/api/echoflow.ts` and `src/server/__tests__/echoflow-api.test.ts` to add desktop-local session bootstrap/status/refresh/sign-out routes without changing legacy account routes or persistence schema.
- Modify `src/server/router.ts` only if needed to supply an explicit local/remote request context; do not rely solely on caller-provided headers.
- Modify `desktop/src/api/echoflow.ts` and its tests with typed `getSiteSession`, `refreshSiteSession`, and `signOutSiteSession` methods. No cookie-bearing bootstrap method exists in renderer APIs.

#### EchoFlow market catalog

- Create `src/server/services/echoFlowSiteMarket.ts` and focused tests to request and normalize the verified site catalog partitions using the authenticated server session or an already-approved credential; no implicit key creation.
- Modify `src/server/api/echoflow.ts` or add `src/server/api/echoFlowSiteMarket.ts` plus router dispatch for read-only catalog endpoints. Keep existing `/api/market/*` contract unchanged.
- Create `desktop/src/api/echoFlowSiteMarket.ts`, `desktop/src/stores/echoFlowSiteMarketStore.ts`, and tests only after response schema is established from authenticated site data.
- Modify `desktop/src/pages/ExtensionMarket.tsx` and its test to add a separate EchoFlow site-market view while preserving the current skill market and the user's already-added MarketplaceBrowser behavior.
- Modify `desktop/src/components/layout/Sidebar.tsx` only to connect the EchoFlow account panel and distinguish site market navigation; preserve archive-session changes already present.
- Installation files are added only after a task proves the real artifact format maps to an existing local installer. Unsupported types remain browse/detail-only; no guessed installer.

#### Build/test routing

- Electron changes require `bun run check:electron`; desktop UI changes require targeted Vitest and `bun run check:desktop`; server API changes require targeted Bun tests and `bun run check:server`.
- Run `bun run check:impact` after the implementation to discover cross-surface checks; run `bun run verify` only if claiming PR/push readiness.

---

### Task 1: Prove the login handoff contract without exposing secrets

**Files:**
- Create: `desktop/electron/services/echoFlowLogin.ts`
- Test: `desktop/electron/services/echoFlowLogin.test.ts`
- Inspect only (no edits initially): Electron typings for `Session.cookies.get`, existing navigation guards, public `/api/user/self` response shape, and the main site login route behavior.

**Interfaces:**
- Produces `EchoFlowLoginSession.open(): Promise<'authenticated' | 'cancelled'>`, `getCookies(): Promise<Cookie[]>`, and `clear(): Promise<void>` through injectable Electron-like dependencies.
- It must not return a cookie or any identity to renderer code.
- Before app code obtains cookies, establish whether the site login completes in the dedicated partition and whether the site self endpoint can identify the user using cookies alone. If not, stop and report the concrete missing protocol; do not scrape arbitrary DOM or capture passwords.

- [ ] **Step 1: Write failing controller tests** for opening only `https://api.echoflowai.cc/login`, preventing off-origin success redirects, one active window, close cancellation, accepting only a verified successful login transition, cookie retrieval from the owned partition, and clearing cookies.
- [ ] **Step 2: Run the focused Electron test** with `cd desktop && bun run test -- --run electron/services/echoFlowLogin.test.ts`; confirm expected failures before implementation.
- [ ] **Step 3: Implement the smallest injectable controller** with fixed origin and no renderer-visible cookie return.
- [ ] **Step 4: Run the test and Electron type/lint check**; use `cd desktop && bun run check:electron`.
- [ ] **Step 5: Verify the main-site identity protocol** using only the login window and harmless account/self reads. Do not print cookie headers, response bodies containing personal data, or credentials. If cookie-only self lookup cannot yield stable user identity, stop before Task 2 and request a supported client-side handoff design.

### Task 2: Add a protected in-memory site session service

**Files:**
- Create: `src/server/services/echoFlowSiteSession.ts`
- Test: `src/server/services/echoFlowSiteSession.test.ts`

**Interfaces:**
```ts
export type EchoFlowSiteAccount = {
  userId: string
  username: string
  balance: number
  refreshedAt: number
}

export class EchoFlowSiteSession {
  setSession(input: { userId: string; cookie: string }): Promise<EchoFlowSiteAccount>
  getStatus(): Promise<EchoFlowSiteAccount | null>
  refresh(): Promise<EchoFlowSiteAccount>
  clear(): void
}
```

The service retains the cookie only in process memory. It uses the fixed main endpoint, bounded timeout and response-size limits, validates `success`, account ID/name and quota, and returns no secret fields.

- [ ] **Step 1: Write failing tests** for valid session bootstrap and balance normalization, `401/403` expiration, malformed/partial JSON, transport timeout, rejection of blank/oversized cookie and invalid identity, refresh after success, and clear removing credentials.
- [ ] **Step 2: Run `bun test src/server/services/echoFlowSiteSession.test.ts`** and confirm failures.
- [ ] **Step 3: Implement the service** with injected fetch/clock for deterministic tests and fixed `https://api.echoflowai.cc/api/user/self` only.
- [ ] **Step 4: Run the focused test** and verify serialized results never contain a cookie.

### Task 3: Bridge Electron login to the local server safely

**Files:**
- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/ipc/channels.ts`
- Modify: `desktop/electron/ipc/capabilities.ts` and its tests
- Modify: `desktop/src/lib/desktopHost/types.ts`
- Modify: `desktop/src/lib/desktopHost/electronHost.ts` and tests
- Modify: `desktop/src/api/echoflow.ts` and tests
- Modify: `src/server/api/echoflow.ts`, `src/server/router.ts` only if context plumbing is required
- Modify: `src/server/__tests__/echoflow-api.test.ts`

**Interfaces:**
- Renderer: `desktopHost.echoFlow.openLogin(): Promise<'authenticated' | 'cancelled'>` and `echoflowApi.getSiteSession()`, `.refreshSiteSession()`, `.signOutSiteSession()` return public account data only. The renderer must not have a bootstrap method.
- Main process keeps cookies private and sends them directly over the server URL with the per-generation sidecar-only bridge secret. The preload IPC returns only a discriminated result, never cookie data.
- Server site-session bootstrap requires the sidecar-only bridge secret and an explicit non-remote context; status/refresh/sign-out require `isLocalAccessAuthorized(req)` and an explicit non-remote context.

- [ ] **Step 1: Add failing IPC capability tests** proving renderer payload must be empty and only the main app window may invoke login. Add server route tests proving the renderer-visible local API token cannot bootstrap the session, the sidecar-only bridge secret can bootstrap it, and remote/public request contexts cannot use site-session routes.
- [ ] **Step 2: Add failing route tests** for bridge-secret bootstrap, local-token status/refresh/logout, wrong-secret and remote 403, asserting no cookie in any JSON body and legacy ID/token account remains unchanged.
- [ ] **Step 3: Implement dedicated persistent session partition and IPC**; validate sender main frame, login completion and fixed-origin navigation; retrieve only EchoFlow cookies from the dedicated session; bootstrap local server with the sidecar-only bridge secret, never the renderer-visible local token, and do not pass cookies to renderer.
- [ ] **Step 4: Implement protected server routes and API client methods**; preserve current legacy account endpoints and schema.
- [ ] **Step 5: Run focused IPC, EchoFlow API, and account-service tests**; then `cd desktop && bun run check:electron`.
- [ ] **Step 6: Manual user-driven login** in the Electron app. Confirm username and balance with redacted logs only; test cancel, server restart rehydration, and sign-out preserving legacy credentials. Do not use the password previously posted in chat.

### Task 4: Verify and expose the authenticated site catalog

**Files:**
- Create: `src/server/services/echoFlowSiteMarket.ts`
- Test: `src/server/services/echoFlowSiteMarket.test.ts`
- Modify: `src/server/api/echoflow.ts` or create `src/server/api/echoFlowSiteMarket.ts` and route/tests

**Interfaces:**
```ts
export type EchoFlowSiteMarketType = 'expert' | 'skill' | 'connector'
export type EchoFlowSiteMarketItem = {
  id: string
  name: string
  description: string
  version?: string
  category?: string
  installable: boolean
  unsupportedReason?: string
}
export type EchoFlowSiteCatalog = {
  type: EchoFlowSiteMarketType
  items: EchoFlowSiteMarketItem[]
  categories: Array<{ id: string; name: string }>
  stale?: boolean
}
```

Only freeze this wire type after the real authenticated probe; map actual verified fields and keep unknown artifact installation unsupported.

- [ ] **Step 1: After Task 3 manual login, perform authenticated read-only requests** for `expert`, `skill`, and `connector`; record field names, pagination, ETag, artifact formats, and whether cookie or a pre-existing API key is accepted. Never create a key without explicit consent.
- [ ] **Step 2: Write failing normalizer/service tests** from sanitized fixtures, covering malformed rows, duplicate IDs, invalid types, response-size limits, timeout, 401 expiration, pagination/ETag if present, and no data mutation.
- [ ] **Step 3: Implement fixed-origin catalog reads** using the authenticated session, cache only validated normalized data, and prohibit arbitrary upstream URLs.
- [ ] **Step 4: Add protected read-only API routes and focused route tests**. If the site only accepts API keys, stop here for a product/security decision rather than minting one.
- [ ] **Step 5: Run focused catalog and API tests** plus `bun run check:server`.

### Task 5: Add separate site-market UI and account sidebar state

**Files:**
- Create: `desktop/src/api/echoFlowSiteMarket.ts` and tests
- Create: `desktop/src/stores/echoFlowSiteMarketStore.ts` and tests
- Modify: `desktop/src/pages/ExtensionMarket.tsx` and tests
- Modify: `desktop/src/components/layout/Sidebar.tsx` and tests
- Modify/create: locale keys in `desktop/src/i18n/locales/{zh,en,zh-TW,jp,kr}.ts`

**Interfaces:**
- Store depends on the normalized `EchoFlowSiteCatalog` API from Task 4, separately from `marketStore`.
- Sidebar reads only public account state from the local API. It calls the host login method for sign-in; the renderer never receives site cookies.
- Site market is a distinct section/tab. Existing local skill market (`Market`) and existing plugin `MarketplaceBrowser` stay available under their current semantics.

- [ ] **Step 1: Write failing store/UI tests** for signed-out/signed-in account display, login cancel/error, balance refresh, logout that does not clear legacy provider binding, switching site/local market without cross-contaminating state, empty catalog and API error states.
- [ ] **Step 2: Run focused desktop tests** and confirm failures.
- [ ] **Step 3: Implement typed site market API/store** with stale-request protection and no secret-bearing state.
- [ ] **Step 4: Add the account row and separate site-market navigation** while preserving unrelated in-progress Sidebar hunks (archived-session controls) and existing market changes; inspect staged diff only if staging is later explicitly requested.
- [ ] **Step 5: Run targeted tests, lint, and desktop build** with focused `cd desktop && bun run test -- --run <test-file>` commands, followed by root `bun run check:desktop` after all edits.

### Task 6: Add only verified artifact installers (conditional)

**Files:**
- Modify only the existing skill or connector installer/service that actually owns the selected content type; add focused tests and a sanitized real-format fixture.

**Interfaces:**
- Install requests contain catalog type and item ID only, never upstream URL or archive path.
- No expert installer is added unless the actual expert archive can be safely mapped to an EchoFlow Code runtime format and the user-visible product requirement is decided.

- [ ] **Step 1: For each installable type, add failing tests** for valid archive install, path traversal, symlink, expanded-size cap, duplicate/owned install, failed staging cleanup, and preservation of pre-existing files.
- [ ] **Step 2: Inspect the owning existing installer** and reuse its archive/path validation where available; do not add a second installer framework.
- [ ] **Step 3: Implement one type at a time** behind explicit user confirmation and verified installability metadata. Unsupported types remain browse/detail-only.
- [ ] **Step 4: Run focused installer tests and existing market/install regression tests.** If no type maps to an existing installer, ship read-only browsing and report that no artifacts are installable yet; do not claim install support.

### Task 7: Full regression and impact gate

**Files:** all intentionally changed files from Tasks 1–6; no unrelated cleanup.

- [ ] Run focused Electron tests, `bun run check:server`, `cd desktop && bun run check:desktop`, and `bun run check:electron`.
- [ ] Run `bun run check:impact`; execute its cross-surface selections.
- [ ] Inspect `git diff --check`, `git diff --stat`, and each changed file against the baseline; ensure user changes in `Sidebar.tsx`, `ExtensionMarket.tsx`, API files, tests, and localization remain intact.
- [ ] Run `bun run verify` only if explicitly delivering PR/push-ready work; do not claim readiness without it.
- [ ] Report real-login/manual-test limits separately from deterministic test results. Do not commit or stage without an explicit request.

---

<a id="specs-2026-10-echoflow-site-account-market-design"></a>

## EchoFlow Site Account and Content Market

来源：`specs/2026-10-echoflow-site-account-market-design.md`。

**Status:** Design for review
**Surface:** `desktop`, `server`, and Electron/native host integration

### Goal

Add main-site EchoFlow account sign-in and the EchoFlow-hosted content market to EchoFlow Code, using the already-running site and its existing login/Turnstile flow. The desktop app must not implement a second password form or bypass Turnstile. The existing user-ID/management-token account binding and the existing skills market remain compatible.

The account surface shows the signed-in username and site balance. The market browses the site's expert, skill, and connector catalog partitions and installs only artifacts that EchoFlow Code can safely and correctly support.

### Verified facts and unresolved protocol

- The main site `/login` returns a normal HTML login page. `/api/status` reports `turnstile_check: true` and `captcha_login_enabled: false`; an empty-token login request is rejected with “Turnstile token 为空”. Login must therefore happen through the site page, not a direct password POST from the local service.
- `/api/desktop-content/catalog/expert` exists and returns 401 without credentials. Authenticated catalog access and artifact responses have not been verified.
- The reference app's account flow posts to `/api/user/login`, then uses a session cookie and account ID for `/api/user/self`. It uses a site API key for catalog reads. These are reference-app observations, not proof that every route on the main site accepts the same credentials.
- Electron can give the site login window a persistent session partition. The current EchoFlow account service stores ID/management-token credentials in a local JSON file; that flow remains untouched for compatibility.
- The repository currently has a local skill market and connector/plugin market, but no confirmed compatible installer for the reference app's expert archive format.

No account credentials, cookies, or keys are included in this document.

### User experience

1. The desktop sidebar exposes an EchoFlow account area near Settings. Signed-out state offers **Sign in**; signed-in state shows username and balance, with account refresh and sign-out actions.
2. Sign in opens a dedicated in-app window at the main site's login page. The site owns password entry and Turnstile. The user can close the window to cancel.
3. A successful login returns the user to EchoFlow Code. Site account sign-in does not force a provider switch, overwrite existing providers, or silently create a model key.
4. The sidebar's Market entry opens the EchoFlow site content market. Existing local skill-market functionality remains available and its current data source is not silently replaced.
5. Market browsing is read-only. Installing an artifact requires an explicit confirmation and a supported local target.
6. The first release supports the main endpoint only. Dedicated endpoint account binding remains as-is and is not silently treated as a site login.

### Architecture and data flow

#### Electron account session

- Electron main creates a dedicated persistent session partition used only for the EchoFlow main-site login. It does not reuse the app renderer, workspace browser, or preview partitions.
- The login window navigates to the fixed HTTPS origin `https://api.echoflowai.cc`; top-level navigation and popups are limited to that origin plus the site's OAuth providers (GitHub, Google, Telegram), so the privileged handoff cannot be triggered by an arbitrary page.
- Electron main observes the site session cookie in the dedicated partition and resolves only the minimum account identity (`id`, `username`) from the site's own account endpoint, with the site's persisted user record as a fallback when that endpoint refuses a cookie-only read. It reads only those fields and never scrapes arbitrary page text or logs response bodies. Passwords are never read by app code.
- Cookie and user ID are delivered directly from Electron main to the local server over its existing authenticated loopback API. They are never sent to the React renderer. The server holds the cookie in memory only; the persistent Chromium cookie jar is the durable session store. Non-secret account display metadata may be persisted.
- On app start and local-server restart, Electron main rehydrates the in-memory server session from the dedicated cookie partition. On sign-out, it clears that partition's site cookies and the server's in-memory session.
- If Electron cannot reliably observe a successful login or the required account identity within the login timeout, the flow fails closed and leaves the user signed out. Do not scrape arbitrary page text or log response bodies as a fallback.

#### Local server account API

- Add a narrow desktop-local account session boundary to the existing EchoFlow API rather than replacing `EchoFlowApiService` or its persistence schema.
- Session bootstrap, status, refresh, and sign-out are authenticated by the existing local access token and are unavailable to remote-browser/public-access clients.
- The server uses the in-memory site cookie for account/self requests and reports normalized public data only (signed-in state, username, balance, timestamp). Cookie values and upstream response bodies are never returned.
- Local-server restart clears in-memory session state until Electron rehydrates it. A missing/expired cookie becomes a signed-out or relogin-required state; it does not invalidate the legacy management-token account.
- Site calls use fixed main-site URLs, bounded timeouts, response-size limits, and structured response validation. No renderer-provided URL is fetched.

#### Catalog and installation

- Add a distinct EchoFlow site-market API/store path. Do not repurpose the existing `/api/market/skills` contract or `marketStore` data-source semantics.
- The host reads `/api/desktop-content/catalog/{expert|skill|connector}` for the site's supported runtime/version and normalizes untrusted catalog rows into a small UI contract. Search, category selection, pagination, locale, and ETag/cache behavior follow observed site contracts rather than assumptions from the reference binary.
- First authenticated probe determines whether catalog routes accept the site cookie. If they require a site API token, implementation must use an existing user-approved credential or present an explicit, reversible consent step before creating a dedicated token. It must not mint a token silently. Token storage and revocation semantics require separate review before that fallback is implemented.
- Artifact requests name a catalog type and item ID/slug, never a renderer-supplied URL. The host resolves the site's documented download route, pins requests to the main-site origin (and any explicitly verified CDN origin), validates redirect targets, and enforces content type and size limits.
- Skill artifacts map to the existing local-skill installation service only after their archive layout and metadata are validated. Connector catalog items are displayed and installed only when their manifest maps safely to the existing connector model; otherwise show details and an unsupported reason.
- Expert artifacts are not installed until their format is mapped to EchoFlow Code's actual runtime. No DSH preset/composition files are executed or copied into a different runtime by assumption. This is an explicit compatibility gate, not a claim that the market feature is complete if expert installation is a required launch criterion.
- Installation is explicit, serialized, and failure-safe. Validate archive paths against traversal/symlinks, cap compressed and expanded sizes, stage before atomic placement, preserve pre-existing user content, and clean staging on failure. Uninstall may remove only files owned by a verified installation record.

### Security and compatibility constraints

- Never capture, persist, log, or return the user's password.
- Keep site cookies out of renderer state, React props, localStorage, provider settings, and diagnostics. Restrict server bootstrap to authenticated loopback desktop requests; reject remote-access contexts.
- Use Electron's persistent cookie jar for cookie durability; do not copy the raw cookie into the current plaintext account JSON. Main-to-server bootstrap occurs only over the authenticated local API.
- Do not disable Turnstile, synthesize tokens, replay a token, or submit credentials outside the site's login page.
- Do not silently create, rotate, or revoke site API keys. Do not overwrite existing providers or ID/management-token bindings.
- Site catalog text and artifact metadata are untrusted. Render text as text, validate all identities and archive paths, and install only after user confirmation.
- Account sign-out must not delete local skill/provider data. Removing the site session must not alter dedicated-endpoint credentials.

### Failure behavior

- Login window closed: remain signed out with no partial account state.
- Site login denied, Turnstile rejected, network timeout, missing cookie, or unparseable identity: show a safe actionable error; never persist partial credentials.
- Server bootstrap fails: retain the valid Electron cookie partition and allow retry; do not claim signed in until server confirms the session.
- Site session expires: show relogin-required while preserving existing local providers and legacy account binding.
- Catalog unavailable or invalid: show retry/stale state if a validated cache exists; browsing failures never mutate installation state.
- Invalid/incompatible artifact or install failure: abort without overwriting existing content; retain diagnostic details only after secret redaction.

### Testing and acceptance

#### Deterministic tests

- Electron login window uses a dedicated persistent partition and fixed HTTPS site origin; arbitrary navigation cannot complete the privileged handoff.
- Login response identity and cookie extraction are bounded to the expected site login route; secrets are absent from renderer payloads and diagnostic output.
- Server session endpoints require desktop-local authorization, reject remote/public access, never serialize cookies, and clear state on sign-out/restart.
- Account/self response normalization covers valid, expired, malformed, timeout, and partial responses without inventing a zero balance.
- Catalog normalization covers each type, invalid rows, pagination/cache validators, upstream errors, and credential rejection.
- Artifact install tests cover traversal, symlinks, archive expansion limits, unsupported expert artifacts, failure cleanup, and preservation of existing user content.
- Existing ID/management-token account and existing skill-market tests remain unchanged in behavior.

#### Manual integration acceptance

Using the user's own signed-in session in the packaged/development Electron app:

1. Complete main-site login and Turnstile in the in-app window; verify account name/balance appears.
2. Restart the local server and the desktop app; verify session rehydration or a clean relogin-required state.
3. Sign out; verify the site cookie is cleared and legacy provider/account data remains untouched.
4. Read all three catalog types with the authenticated session and record the real response contract without logging credentials.
5. Install a compatible skill and connector only after their mapping is verified; verify unsupported expert entries are not installed.
6. Confirm direct password login without a browser challenge is still rejected, and no token is silently created.

### Rollout boundary

The first implementation targets main-site account status, balance, and authenticated catalog browsing; existing user-ID/management-token flows remain available. Install support ships only for catalog types whose format has been validated against current EchoFlow Code installers. If the main site requires a newly created API key for market access, or if expert archives are required to be installable, stop at that boundary and obtain a separate product/security decision rather than silently broadening credential or runtime behavior.
