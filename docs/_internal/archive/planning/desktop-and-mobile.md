---
title: 桌面、设置与 H5（历史归档）
nav_title: 桌面、设置与 H5
description: 合并保存 2026 年的相关设计、计划与任务记录，不作为现行执行指令。
order: 3
---

# 桌面、设置与 H5（历史归档）

本页于 2026-11-14 按主题合并旧 Superpowers 资料，保留原设计、计划、任务摘要和进度；仅调整标题层级、旧路径、插件要求与本地绝对路径。原文中的版本、审批、完成状态和测试结果均为当时记录，不代表当前实现、当前授权或本次验证。不得按归档中的命令直接继续旧任务。

现行要求以仓库 AGENTS.md、[执行与信任边界](../../../internals/execution-boundaries.md) 和 [贡献流程](../../../internals/contributing.md) 为准；[返回归档索引](README.md)。

文中引用的旧桌面文档已归档：`desktop/docs/component-library-plan.md` 见[组件库审计与迁移](../desktop-design.md#component-library-plan)，`desktop/docs/redesign-paper-ink-seal.md` 见[「纸·墨·印」交接](../desktop-design.md#paper-ink-seal)。以下历史引用保留原文件名与行号。

## 来源目录

- [sdd/2026-11-02-settings-reorg/progress.md](#sdd-2026-11-02-settings-reorg-progress)
- [sdd/2026-11-02-settings-reorg/task-1-brief.md](#sdd-2026-11-02-settings-reorg-task-1-brief)
- [plans/2026-05-09-h5-access.md](#plans-2026-05-09-h5-access)
- [plans/2026-10-26-frontend-visual-polish-and-flutter-verdict.md](#plans-2026-10-26-frontend-visual-polish-and-flutter-verdict)
- [plans/2026-10-26-ui-layer-hardening.md](#plans-2026-10-26-ui-layer-hardening)
- [plans/2026-11-02-desktop-design-system-boundaries.md](#plans-2026-11-02-desktop-design-system-boundaries)
- [plans/2026-11-02-settings-reorg.md](#plans-2026-11-02-settings-reorg)
- [specs/2026-05-09-h5-access-design.md](#specs-2026-05-09-h5-access-design)
- [specs/2026-05-13-desktop-open-project-targets-design.md](#specs-2026-05-13-desktop-open-project-targets-design)
- [specs/2026-10-26-ui-layer-hardening-design.md](#specs-2026-10-26-ui-layer-hardening-design)

---

<a id="sdd-2026-11-02-settings-reorg-progress"></a>

## SDD ledger — plan: docs/_internal/archive/planning/desktop-and-mobile.md#plans-2026-11-02-settings-reorg

来源：`sdd/2026-11-02-settings-reorg/progress.md`。

Pre-flight: Task 1 produces SETTINGS_TABS and SETTINGS_NAV consumed by Tasks 2–3; verified the plan's order and interface. Tasks 4 consumes existing settingsStore trace setters and Task 5 documents the resulting UI; no shared edit contract.
Ruling: execute in the existing worktree — user memory says avoid additional worktrees by default and current repository contains many unrelated dirty files; narrow edits are possible without overwriting them — cost if wrong: changes coexist with unrelated worktree edits.
Ruling: do not commit — the current execution instruction explicitly prohibited committing; verify each stage in place — cost if wrong: no per-task commit boundaries.
Ruling: plan Step 0's request for maintainer confirmation is superseded by the current user's explicit “开始吧”; only proceed where existing hunks are attributable and preserve all others — cost if wrong: a hunk's authorship could be misattributed.
Ruling: GeneralSettings already has legacy migration UI removed by existing user edits; do not restore or migrate it — cost if wrong: the Data tab won't contain that removed control.
Task 1: Ruling: the plan's navigation test expects network/data in the preference group before Tasks 2–3 create those tabs; the Task 1 implementation explicitly says they are absent at this stage. Assert only current tabs now; add network/data when their tasks wire them — cost if wrong: coverage of future tabs depends on Task 2/3 updating the assertion.
Task 1: complete (no commits per explicit instruction; tests: bun run test -- --run src/stores/uiStore.test.ts src/pages/SettingsNavigation.test.tsx src/__tests__/petSettingsNavigation.test.tsx src/i18n → 51/51 pass; GeneralSettings separately → 143/143 pass)
Task 2: Ruling: the plan asks for `settings.tab.network` in five locales and a `lan` icon; used both as written — cost if wrong: one icon differs from the plan's intent.
Task 2: Ruling: the plan's "keep the selected settings tab" case asserted the WebFetch toggle on General; the toggle moved to Network, so the case now enters Network — cost if wrong: the case no longer proves the General tab persists.
Task 2: Ruling: the plan's "data storage at the bottom of General" case ordered WebSearch before the storage heading; WebSearch moved out, so the case now asserts the storage heading exists instead of an ordering that no longer exists — cost if wrong: the storage block's position within General is no longer pinned by that case.
Task 2: complete (no commits per explicit instruction; tests: bun run test -- --run src/__tests__/generalSettings.test.tsx src/pages/settings/VoiceInputSettings.test.tsx src/pages/SettingsNavigation.test.tsx src/stores/uiStore.test.ts src/i18n → 270/270 pass; bun run lint → exit 0)
Task 3: Ruling: the plan lists a legacyMigration block among the pieces to move, but the worktree had already deleted that control before this plan started; moved only what exists — cost if wrong: the Data tab has no legacy import control, which the worktree had already removed.
Task 3: Ruling: the plan's "keeps data storage at the bottom of General settings" case asserted a WebSearch-before-storage ordering; WebSearch moved out in Task 2, so the case now asserts the storage heading exists — cost if wrong: the storage block's position within General is no longer pinned by that case.
Task 3: complete (no commits per explicit instruction; tests: bun run test -- --run src/__tests__/generalSettings.test.tsx src/pages/SettingsNavigation.test.tsx src/stores/uiStore.test.ts src/i18n → 195/195 pass; bun run lint → exit 0; all six moved blocks verified byte-identical to their pre-move text)
Task 4: Ruling: the plan asks the switch to reuse `settings.general.traceEnabled`/`traceHintOn`/`traceHintOff`; used those keys verbatim so the General-page copy is unchanged — cost if wrong: the Trace page copy still reads as if it lived under General.
Task 4: Ruling: `openTraceCaptureSettings` and its test are deleted outright rather than repointed — the switch and the list it controls are now on the same page, so the navigation hop no longer exists — cost if wrong: a deep link to the capture control loses its old landing spot.
Task 4: Ruling: the TraceList test suite had no per-test reset for `traceCapture`, so a failed-save case leaked a flipped flag into later cases; the suite now resets `traceCapture` in `beforeEach` — cost if wrong: none, this only makes existing cases independent.
Task 4: complete (no commits per explicit instruction; tests: bun run test -- --run src/pages/TraceList.test.tsx src/lib/traceNavigation.test.ts src/__tests__/generalSettings.test.tsx src/i18n src/pages/SettingsNavigation.test.tsx src/stores/uiStore.test.ts → 214/214 pass; bun run lint → exit 0; mutation check: removing the store's rollback turned the failure case red, so the case really pins the rollback)

---

<a id="sdd-2026-11-02-settings-reorg-task-1-brief"></a>

## Task 1: 单一 tab 来源 + 左栏分组

来源：`sdd/2026-11-02-settings-reorg/task-1-brief.md`。

**Files:**
- Modify: `desktop/src/stores/uiStore.ts:46-65`（`SETTINGS_TABS`）、`:235-253`（`SettingsTab`）
- Modify: `desktop/src/pages/Settings.tsx:54-98`（左栏和内容区）
- Modify: `desktop/src/i18n/locales/{en,zh,zh-TW,jp,kr}.ts`（加 5 个 `settings.navGroup.*` key）
- Test: `desktop/src/stores/uiStore.test.ts`、`desktop/src/pages/SettingsNavigation.test.tsx`

**Interfaces:**
- Produces: `export const SETTINGS_TABS = [...] as const`（从 `uiStore.ts` 导出）；`export type SettingsTab = typeof SETTINGS_TABS[number]`。
- Produces: `Settings.tsx` 内部常量 `SETTINGS_NAV: ReadonlyArray<{ group: TranslationKey | null; tabs: ReadonlyArray<{ id: SettingsTab; icon: string; label: TranslationKey }> }>`，最后一项 `group: null` 只放 `about`，渲染在分隔线下面。Task 2、3 往这个数组里加条目。
- Produces: 分组标题用 `<h3>` 渲染，外层每组包 `<div role="group" aria-labelledby=...>`；每个 tab 按钮带 `data-settings-tab={tab.id}`，供导航覆盖测试逐 id 核验。

- [ ] **Step 1: 写失败测试**

在 `uiStore.test.ts` 新增独立用例（不嵌套进现有 `describe('uiStore theme handling')`）：

```ts
it('restores every persisted Settings tab id an older build could have written', async () => {
  for (const tab of ['providers', 'general', 'runtime', 'voice', 'h5Access', 'adapters', 'terminal', 'mcp', 'agents', 'skills', 'memory', 'plugins', 'pets', 'computerUse', 'activity', 'trace', 'diagnostics', 'about']) {
    window.localStorage.setItem('echoflow-code-active-settings-tab', tab)
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    expect(useUIStore.getState().activeSettingsTab).toBe(tab)
  }

  window.localStorage.setItem('echoflow-code-active-settings-tab', 'unknown-tab')
  vi.resetModules()
  const { useUIStore } = await import('./uiStore')
  expect(useUIStore.getState().activeSettingsTab).toBe('providers')
})
```

在 `SettingsNavigation.test.tsx` 加：

```ts
it('lists every settings tab exactly once, grouped', () => {
  render(<DesktopSettings />)
  const nav = screen.getByTestId('settings-navigation')
  const buttons = within(nav).getAllByRole('button')
  expect(buttons).toHaveLength(SETTINGS_TABS.length)
  expect(buttons.map((button) => button.getAttribute('data-settings-tab')).sort()).toEqual([...SETTINGS_TABS].sort())
  const groups = within(nav).getAllByRole('group')
  expect(groups).toHaveLength(5)
  expect(groups.map((group) => within(group).getAllByRole('button').map((button) => button.getAttribute('data-settings-tab')))).toEqual([
    ['providers', 'runtime'],
    ['general', 'network', 'data', 'voice', 'pets'],
    ['agents', 'skills', 'plugins', 'mcp', 'memory', 'computerUse'],
    ['h5Access', 'adapters'],
    ['terminal', 'activity', 'trace', 'diagnostics'],
  ])
  expect(within(nav).getByRole('group', { name: 'Models & Runtime' })).toHaveTextContent('Runtime management')
  const about = within(nav).getByRole('button', { name: 'About' })
  expect(about).toHaveAttribute('data-settings-tab', 'about')
  expect(groups.some((group) => within(group).queryByRole('button', { name: 'About' }) !== null)).toBe(false)
})
```

（按该文件已有写法 import `DesktopSettings`、`within`、`SETTINGS_TABS`；locale 设为 `en`。）

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && bun run test -- --run src/stores/uiStore.test.ts src/pages/SettingsNavigation.test.tsx`
Expected：恢复测试 PASS（它锁住的是现状，用来防回归）；分组测试 FAIL，原因是 `SETTINGS_TABS` 没有导出，或找不到 `group`。

- [ ] **Step 3: 实现**

- `uiStore.ts`：给 `SETTINGS_TABS` 加 `export`，`SettingsTab` 改成从数组推导，删掉手写的 union。`isSettingsTab` 不用改。
- `Settings.tsx`：用 `SETTINGS_NAV` 替换左栏里 18 行写死的 `TabButton`，按上面「左栏最终结构」表排列（此时还没有 network/data）。分组标题样式：`px-3 pt-3 pb-1 text-[11.5px] font-medium text-[var(--color-text-tertiary)]`，第一组不加 `pt-3`。mcp 的图标改成 `hub`。内容区的 `activeTab === ...` 条件链保持原样。
- 五个 locale 文件：加 5 个 `settings.navGroup.*`，取值照「新增 i18n key」表。

- [ ] **Step 4: 运行，确认通过**

Run: `cd desktop && bun run test -- --run src/stores/uiStore.test.ts src/pages/SettingsNavigation.test.tsx src/__tests__/petSettingsNavigation.test.tsx src/__tests__/generalSettings.test.tsx src/i18n`
Expected：全部 PASS。`generalSettings.test.tsx:1448,1460` 断言的是「Token 用量在诊断之上」「Trace 在两者之间」，新顺序里 activity → trace → diagnostics 仍然成立。

- [ ] **Step 5: 类型检查**

Run: `cd desktop && bun run lint`
Expected：退出码 0。

- [ ] **Step 6: Commit**

```bash
git add -p desktop/src/stores/uiStore.ts desktop/src/stores/uiStore.test.ts desktop/src/pages/Settings.tsx desktop/src/pages/SettingsNavigation.test.tsx desktop/src/i18n/locales
git commit -m "feat(desktop): group the settings rail and derive tab ids from one list"
```

---

---

<a id="plans-2026-05-09-h5-access"></a>

## H5 Access Implementation Plan

来源：`plans/2026-05-09-h5-access.md`。

**Goal:** Add opt-in personal/team H5 browser access with a generated token, controlled origin handling, authenticated REST/WebSocket access, and a mobile-safe chat shell without disrupting the default desktop/Tauri flow.

**Architecture:** Store H5 access configuration under the existing cc-haha managed settings file, expose a narrow H5 settings API for the desktop Settings UI, and validate the generated token in the shared server auth path when remote access is required. The browser H5 runtime reuses the current Vite SPA with a connection screen, central REST/WebSocket auth injection, and responsive chat layout adjustments.

**Tech Stack:** Bun server, TypeScript, React 18, Zustand, Vite, Vitest, Testing Library, existing REST/WebSocket server.

---

### File Structure

- Create `src/server/services/h5AccessService.ts`: H5 settings persistence, token generation, token hashing, sanitized response shaping, token validation.
- Create `src/server/api/h5-access.ts`: H5 Settings API endpoints for status, enable, disable, regenerate, update, and verify.
- Modify `src/server/router.ts`: route `/api/h5-access`.
- Modify `src/server/middleware/auth.ts`: accept either existing Anthropic bearer auth or enabled H5 token auth when auth is required.
- Modify `src/server/middleware/cors.ts`: make allowed origins configurable through H5 settings and keep localhost/Tauri defaults.
- Modify `src/server/index.ts`: use async CORS/auth helpers for REST, proxy, and client WebSocket upgrades.
- Add/modify server tests under `src/server/__tests__/`.
- Create `desktop/src/api/h5Access.ts`: typed client for H5 settings endpoints.
- Modify `desktop/src/api/client.ts`: auth token storage/injection helpers for browser H5 mode.
- Modify `desktop/src/api/websocket.ts`: `http -> ws`, `https -> wss`, and token query injection.
- Modify `desktop/src/lib/desktopRuntime.ts`: read/write H5 browser connection state and distinguish startup health from authenticated verification.
- Create `desktop/src/components/layout/H5ConnectionView.tsx`: browser-only connection form.
- Modify `desktop/src/components/layout/AppShell.tsx`: show H5 connection view on browser auth startup failure; keep Tauri startup unchanged.
- Modify `desktop/src/stores/settingsStore.ts`, `desktop/src/types/settings.ts`, and `desktop/src/pages/Settings.tsx`: Settings UI state and controls for H5 enable/token URL management.
- Modify `desktop/src/i18n/locales/en.ts` and `desktop/src/i18n/locales/zh.ts`: new H5 labels.
- Create `desktop/src/hooks/useMobileViewport.ts`: shared mobile breakpoint hook.
- Modify `desktop/src/theme/globals.css`, `desktop/src/components/layout/AppShell.tsx`, `desktop/src/components/layout/Sidebar.tsx`, `desktop/src/pages/ActiveSession.tsx`, `desktop/src/components/chat/ChatInput.tsx`, and `desktop/src/components/controls/PermissionModeSelector.tsx`: mobile shell and touch-target improvements.
- Add/modify desktop tests under `desktop/src/**`.
- Create `docs/desktop/h5-access.md`: concise user setup notes for LAN/reverse proxy mode.

### Task 1: Server H5 Settings Service And API

**Files:**
- Create: `src/server/services/h5AccessService.ts`
- Create: `src/server/api/h5-access.ts`
- Modify: `src/server/router.ts`
- Test: `src/server/__tests__/h5-access-service.test.ts`
- Test: `src/server/__tests__/h5-access-api.test.ts`

- [ ] **Step 1: Write service tests first**

Add tests covering default disabled state, token generation, hash-only persistence, token regeneration invalidating old tokens, and unknown field preservation.

```ts
// src/server/__tests__/h5-access-service.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { H5AccessService } from '../services/h5AccessService.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-access-service-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('H5AccessService', () => {
  it('defaults to disabled without creating settings', async () => {
    const service = new H5AccessService()
    await expect(service.getSettings()).resolves.toMatchObject({
      enabled: false,
      tokenPreview: null,
      allowedOrigins: [],
      publicBaseUrl: null,
    })
  })

  it('generates a raw token once and stores only a hash plus preview', async () => {
    const service = new H5AccessService()
    const result = await service.enable()
    expect(result.token).toMatch(/^h5_[A-Za-z0-9_-]{43,}$/)
    expect(result.settings.enabled).toBe(true)
    expect(result.settings.tokenPreview).toMatch(/^h5_.+\\.{3}.+$/)
    expect(await service.validateToken(result.token)).toBe(true)

    const raw = await fs.readFile(path.join(tmpDir, 'cc-haha', 'settings.json'), 'utf-8')
    expect(raw).toContain('h5Access')
    expect(raw).not.toContain(result.token)
  })

  it('preserves unrelated managed settings fields', async () => {
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'cc-haha', 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_MODEL: 'keep-me' }, futureField: { keep: true } }),
      'utf-8',
    )

    const service = new H5AccessService()
    await service.enable()
    const saved = JSON.parse(await fs.readFile(path.join(tmpDir, 'cc-haha', 'settings.json'), 'utf-8'))
    expect(saved.env.ANTHROPIC_MODEL).toBe('keep-me')
    expect(saved.futureField).toEqual({ keep: true })
  })

  it('regenerates token and rejects the previous token', async () => {
    const service = new H5AccessService()
    const first = await service.enable()
    const second = await service.regenerateToken()
    expect(second.token).not.toBe(first.token)
    expect(await service.validateToken(first.token)).toBe(false)
    expect(await service.validateToken(second.token)).toBe(true)
  })
})
```

- [ ] **Step 2: Run service tests and verify they fail**

Run: `bun test src/server/__tests__/h5-access-service.test.ts`

Expected: FAIL because `H5AccessService` does not exist.

- [ ] **Step 3: Implement `H5AccessService`**

Create the service with these exports and behavior:

```ts
export type H5AccessSettings = {
  enabled: boolean
  tokenPreview: string | null
  allowedOrigins: string[]
  publicBaseUrl: string | null
}

export type H5AccessEnableResult = {
  settings: H5AccessSettings
  token: string
}

export class H5AccessService {
  async getSettings(): Promise<H5AccessSettings>
  async enable(): Promise<H5AccessEnableResult>
  async disable(): Promise<H5AccessSettings>
  async regenerateToken(): Promise<H5AccessEnableResult>
  async updateSettings(input: {
    allowedOrigins?: string[]
    publicBaseUrl?: string | null
  }): Promise<H5AccessSettings>
  async validateToken(token: string | null | undefined): Promise<boolean>
  async isOriginAllowed(origin: string | null | undefined): Promise<boolean>
}
```

Implementation details:

- Use `process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')`.
- Persist under `cc-haha/settings.json` in an `h5Access` object.
- Use `crypto.randomBytes(32).toString('base64url')` with `h5_` prefix for raw tokens.
- Hash with SHA-256 and store `tokenHash`, not raw token.
- Preview format: first 7 chars, ellipsis, last 4 chars.
- Normalize `allowedOrigins` to valid `http://` or `https://` origins only, no path, no wildcard.
- Preserve unknown fields by reading current JSON, replacing only `h5Access`, and writing back.

- [ ] **Step 4: Run service tests and verify they pass**

Run: `bun test src/server/__tests__/h5-access-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Write API tests**

Add route tests for sanitized status, enable returning raw token once, verify accepting bearer token, and disable rejecting the old token.

```ts
// src/server/__tests__/h5-access-api.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleApiRequest } from '../router.js'

let tmpDir: string

async function api(method: string, pathname: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return handleApiRequest(
    new Request(`http://localhost${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    new URL(`http://localhost${pathname}`),
  )
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-access-api-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('/api/h5-access', () => {
  it('enables access and returns raw token only in mutation response', async () => {
    const enabled = await api('POST', '/api/h5-access/enable')
    expect(enabled.status).toBe(200)
    const payload = await enabled.json()
    expect(payload.token).toMatch(/^h5_/)
    expect(payload.settings.enabled).toBe(true)

    const status = await api('GET', '/api/h5-access')
    const statusPayload = await status.json()
    expect(statusPayload.token).toBeUndefined()
    expect(statusPayload.settings.tokenPreview).toBe(payload.settings.tokenPreview)
  })

  it('verifies a good token and rejects a bad token', async () => {
    const enabled = await api('POST', '/api/h5-access/enable')
    const { token } = await enabled.json()

    expect((await api('POST', '/api/h5-access/verify', undefined, token)).status).toBe(200)
    expect((await api('POST', '/api/h5-access/verify', undefined, 'bad-token')).status).toBe(401)
  })
})
```

- [ ] **Step 6: Implement API route and router case**

`src/server/api/h5-access.ts` handles:

- `GET /api/h5-access`
- `POST /api/h5-access/enable`
- `POST /api/h5-access/disable`
- `POST /api/h5-access/regenerate`
- `PUT /api/h5-access`
- `POST /api/h5-access/verify`

Add `case 'h5-access': return handleH5AccessApi(req, url, segments)` to `src/server/router.ts`.

- [ ] **Step 7: Run API tests**

Run: `bun test src/server/__tests__/h5-access-service.test.ts src/server/__tests__/h5-access-api.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/server/services/h5AccessService.ts src/server/api/h5-access.ts src/server/router.ts src/server/__tests__/h5-access-service.test.ts src/server/__tests__/h5-access-api.test.ts
git commit -m "Add managed H5 access settings service"
```

Use Lore trailers in the commit body: `Constraint`, `Rejected`, `Confidence`, `Scope-risk`, `Tested`, and `Not-tested`.

### Task 2: Server Auth, CORS, And WebSocket Integration

**Files:**
- Modify: `src/server/middleware/auth.ts`
- Modify: `src/server/middleware/cors.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/__tests__/h5-access-auth.test.ts`
- Test: existing `src/server/__tests__/e2e/full-flow.test.ts`

- [ ] **Step 1: Write auth/CORS tests**

Create tests that start the server bound to `0.0.0.0` on a random port and assert:

- H5 disabled + no Anthropic key rejects `/api/status`.
- H5 enabled + wrong token rejects `/api/status`.
- H5 enabled + correct token allows `/api/status`.
- CORS rejects unlisted origins.
- CORS allows configured origins and includes `Vary: Origin`.
- Client WebSocket upgrade rejects missing/wrong token when auth is required.

```ts
// src/server/__tests__/h5-access-auth.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { startServer } from '../index.js'
import { H5AccessService } from '../services/h5AccessService.js'

let tmpDir: string
let server: ReturnType<typeof startServer> | null = null

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-access-auth-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  delete process.env.ANTHROPIC_API_KEY
})

afterEach(async () => {
  server?.stop(true)
  server = null
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.ANTHROPIC_API_KEY
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function freePort() {
  return 46000 + Math.floor(Math.random() * 1000)
}

describe('H5 remote auth', () => {
  it('allows remote API requests with enabled H5 token', async () => {
    const service = new H5AccessService()
    const { token } = await service.enable()
    await service.updateSettings({ allowedOrigins: ['http://phone.local:1420'] })

    const port = freePort()
    server = startServer(port, '0.0.0.0')

    const ok = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://phone.local:1420',
      },
    })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://phone.local:1420')
    expect(ok.headers.get('Vary')).toContain('Origin')

    const bad = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Authorization: 'Bearer bad-token', Origin: 'http://phone.local:1420' },
    })
    expect(bad.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `bun test src/server/__tests__/h5-access-auth.test.ts --timeout 30000`

Expected: FAIL because auth/CORS do not consult H5 settings yet.

- [ ] **Step 3: Extend auth middleware**

Change `auth.ts` to expose an async helper:

```ts
export async function requireAuth(req: Request): Promise<Response | null> {
  const existing = validateAuth(req)
  if (existing.valid) return null

  const token = extractBearerToken(req)
  if (await new H5AccessService().validateToken(token)) return null

  return Response.json(
    { error: 'Unauthorized', message: existing.error || 'Invalid authorization token' },
    { status: 401 },
  )
}
```

Keep `validateAuth()` available for existing tests. Add `extractBearerToken(req)` as a small exported helper for WebSocket query-token tests if useful.

- [ ] **Step 4: Make CORS origin-aware**

Change `corsHeaders(origin)` to `async corsHeaders(origin)` or add `corsHeadersForOrigin(origin, h5Service)` and update callers in `index.ts`.

Rules:

- Always allow localhost, `127.0.0.1`, `tauri.localhost`, `tauri://localhost`, and `asset://localhost`.
- If H5 is enabled, allow exact origins in `h5Access.allowedOrigins`.
- Never wildcard.
- Always set `Vary: Origin`.

- [ ] **Step 5: Update `src/server/index.ts`**

Update all call sites that currently use `corsHeaders(origin)` and `requireAuth(req)`:

- `OPTIONS`
- `/ws/*`
- `/api/*`
- `/proxy/*`
- `/health`
- error responses in API/proxy catch blocks

For WebSocket auth, accept either `Authorization` header or `?token=` by constructing a request-like check or by adding `validateRequestToken(req, url.searchParams.get('token'))`.

- [ ] **Step 6: Run focused auth/server tests**

Run:

```bash
bun test src/server/__tests__/h5-access-auth.test.ts src/server/__tests__/settings.test.ts src/server/__tests__/e2e/full-flow.test.ts --timeout 30000
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/server/middleware/auth.ts src/server/middleware/cors.ts src/server/index.ts src/server/__tests__/h5-access-auth.test.ts
git commit -m "Protect remote H5 access with token auth"
```

### Task 3: Desktop H5 Settings UI

**Files:**
- Create: `desktop/src/api/h5Access.ts`
- Modify: `desktop/src/types/settings.ts`
- Modify: `desktop/src/stores/settingsStore.ts`
- Modify: `desktop/src/pages/Settings.tsx`
- Modify: `desktop/src/i18n/locales/en.ts`
- Modify: `desktop/src/i18n/locales/zh.ts`
- Test: `desktop/src/__tests__/generalSettings.test.tsx`

- [ ] **Step 1: Write UI/store tests first**

Extend `generalSettings.test.tsx` with:

- H5 section renders disabled state.
- Enabling calls `enableH5Access`.
- Regenerating token calls `regenerateH5AccessToken`.
- Updating allowed origin/public URL calls `updateH5AccessSettings`.

Use the existing `useSettingsStore.setState()` pattern in that file.

- [ ] **Step 2: Add typed API client**

Create `desktop/src/api/h5Access.ts`:

```ts
import { api } from './client'

export type H5AccessSettings = {
  enabled: boolean
  tokenPreview: string | null
  allowedOrigins: string[]
  publicBaseUrl: string | null
}

export type H5AccessStatus = { settings: H5AccessSettings }
export type H5AccessTokenResult = { settings: H5AccessSettings; token: string }

export const h5AccessApi = {
  get() {
    return api.get<H5AccessStatus>('/api/h5-access')
  },
  enable() {
    return api.post<H5AccessTokenResult>('/api/h5-access/enable')
  },
  disable() {
    return api.post<H5AccessStatus>('/api/h5-access/disable')
  },
  regenerate() {
    return api.post<H5AccessTokenResult>('/api/h5-access/regenerate')
  },
  update(input: { allowedOrigins?: string[]; publicBaseUrl?: string | null }) {
    return api.put<H5AccessStatus>('/api/h5-access', input)
  },
}
```

- [ ] **Step 3: Extend settings store**

Add state and actions:

```ts
h5Access: H5AccessSettings
h5AccessGeneratedToken: string | null
fetchH5Access: () => Promise<void>
enableH5Access: () => Promise<void>
disableH5Access: () => Promise<void>
regenerateH5AccessToken: () => Promise<void>
updateH5AccessSettings: (input: { allowedOrigins?: string[]; publicBaseUrl?: string | null }) => Promise<void>
clearH5AccessGeneratedToken: () => void
```

Call `fetchH5Access()` inside `fetchAll()` alongside existing settings requests.

- [ ] **Step 4: Add Settings UI section**

In `GeneralSettings`, add a section after System Notifications and before WebFetch:

- checkbox `Enable H5 access`
- token preview row
- generated token one-time visible box with copy button
- regenerate button
- public URL input
- allowed origins textarea or comma-separated input
- copied URL display
- compact safety note

Keep styling consistent with existing rounded settings panels. Do not create nested cards.

- [ ] **Step 5: Add i18n strings**

Add matching English and Chinese keys under `settings.general.h5...`.

- [ ] **Step 6: Run focused desktop tests**

Run:

```bash
cd desktop && bunx vitest run src/__tests__/generalSettings.test.tsx src/stores/settingsStore.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add desktop/src/api/h5Access.ts desktop/src/types/settings.ts desktop/src/stores/settingsStore.ts desktop/src/pages/Settings.tsx desktop/src/i18n/locales/en.ts desktop/src/i18n/locales/zh.ts desktop/src/__tests__/generalSettings.test.tsx
git commit -m "Add desktop controls for H5 access"
```

### Task 4: Browser H5 Runtime And Auth Injection

**Files:**
- Modify: `desktop/src/api/client.ts`
- Modify: `desktop/src/api/websocket.ts`
- Modify: `desktop/src/lib/desktopRuntime.ts`
- Create: `desktop/src/components/layout/H5ConnectionView.tsx`
- Modify: `desktop/src/components/layout/AppShell.tsx`
- Test: `desktop/src/api/client.test.ts`
- Test: `desktop/src/api/websocket.test.ts`
- Test: `desktop/src/components/layout/AppShell.test.tsx`

- [ ] **Step 1: Write API client tests**

Add tests asserting:

- default local requests do not include Authorization.
- `setAuthToken('h5_x')` causes REST requests to include `Authorization: Bearer h5_x`.
- diagnostics reporting does not include token in payload.

- [ ] **Step 2: Implement auth helpers in `client.ts`**

Add:

```ts
let authToken: string | null = null

export function setAuthToken(token: string | null) {
  authToken = token && token.trim() ? token.trim() : null
}

export function getAuthToken() {
  return authToken
}
```

In `request()`, include `Authorization` only when `authToken` is set.

- [ ] **Step 3: Write WebSocket URL tests**

In `websocket.test.ts`, mock `getBaseUrl()` and `getAuthToken()` for:

- `http://127.0.0.1:3456` -> `ws://127.0.0.1:3456/ws/session`
- `https://example.com/backend` -> `wss://example.com/backend/ws/session`
- token adds `?token=<encoded>`

- [ ] **Step 4: Implement WebSocket URL builder**

Add a small exported helper in `websocket.ts`:

```ts
export function buildSessionWebSocketUrl(sessionId: string) {
  const base = new URL(getBaseUrl())
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/ws/${sessionId}`
  const token = getAuthToken()
  if (token) base.searchParams.set('token', token)
  return base.toString()
}
```

Use it in `connect()`.

- [ ] **Step 5: Add H5 connection runtime**

In `desktopRuntime.ts`, add localStorage keys:

```ts
const H5_SERVER_URL_KEY = 'cc-haha-h5-server-url'
const H5_TOKEN_KEY = 'cc-haha-h5-token'
```

Add functions:

```ts
export function isBrowserH5Runtime() {
  return !isTauriRuntime()
}

export function readStoredH5Connection() {
  return { serverUrl: localStorage.getItem(H5_SERVER_URL_KEY), token: localStorage.getItem(H5_TOKEN_KEY) }
}

export async function saveAndVerifyH5Connection(serverUrl: string, token: string) {
  setBaseUrl(serverUrl)
  setAuthToken(token)
  await api.post('/api/h5-access/verify')
  localStorage.setItem(H5_SERVER_URL_KEY, serverUrl)
  localStorage.setItem(H5_TOKEN_KEY, token)
}
```

Keep Tauri startup path untouched.

- [ ] **Step 6: Add `H5ConnectionView`**

The component accepts `initialServerUrl`, `initialError`, and `onConnected`. It renders server URL and token inputs, calls `saveAndVerifyH5Connection`, and displays concise errors.

- [ ] **Step 7: Wire `AppShell`**

In browser mode, if startup fails with 401 or no stored token, render `H5ConnectionView`. On successful connect, retry `initializeDesktopServerUrl()` and `fetchSettings()`.

Do not render this connection view in Tauri mode.

- [ ] **Step 8: Run focused desktop runtime tests**

Run:

```bash
cd desktop && bunx vitest run src/api/client.test.ts src/api/websocket.test.ts src/components/layout/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add desktop/src/api/client.ts desktop/src/api/websocket.ts desktop/src/lib/desktopRuntime.ts desktop/src/components/layout/H5ConnectionView.tsx desktop/src/components/layout/AppShell.tsx desktop/src/api/client.test.ts desktop/src/api/websocket.test.ts desktop/src/components/layout/AppShell.test.tsx
git commit -m "Add authenticated H5 browser runtime"
```

### Task 5: Mobile Chat Shell

**Files:**
- Create: `desktop/src/hooks/useMobileViewport.ts`
- Modify: `desktop/src/theme/globals.css`
- Modify: `desktop/src/components/layout/AppShell.tsx`
- Modify: `desktop/src/components/layout/Sidebar.tsx`
- Modify: `desktop/src/pages/ActiveSession.tsx`
- Modify: `desktop/src/components/chat/ChatInput.tsx`
- Modify: `desktop/src/components/controls/PermissionModeSelector.tsx`
- Test: `desktop/src/components/layout/AppShell.test.tsx`
- Test: `desktop/src/pages/ActiveSession.test.tsx`
- Test: `desktop/src/components/chat/ChatInput.test.tsx`

- [ ] **Step 1: Add viewport hook test and implementation**

Create `useMobileViewport.ts` with `matchMedia('(max-width: 767px)')`, SSR-safe default `false`, and cleanup of listeners.

- [ ] **Step 2: Update shell CSS**

Add classes in `globals.css`:

```css
.app-shell {
  height: 100vh;
  height: 100dvh;
}

@media (max-width: 767px) {
  .app-shell {
    min-width: 0;
  }

  .sidebar-shell {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 60;
    width: min(86vw, 320px);
    transform: translateX(-100%);
  }

  .sidebar-shell[data-mobile-state="open"] {
    transform: translateX(0);
  }

  .mobile-touch-target {
    min-height: 44px;
    min-width: 44px;
  }
}
```

Preserve existing desktop sidebar behavior outside the media query.

- [ ] **Step 3: Update `AppShell` mobile drawer**

Use `useMobileViewport()` to:

- apply `className="app-shell flex overflow-hidden ..."`
- add `data-mobile-state`
- add a backdrop button when sidebar is open on mobile
- keep desktop `sidebarOpen` behavior unchanged

- [ ] **Step 4: Relax mobile chat min-widths**

In `ActiveSession.tsx`, replace unconditional `min-w-[320px]` and `min-w-[360px]` with responsive classes:

- desktop keeps current min widths
- mobile uses `min-w-0 w-full`
- workspace and terminal resize handles do not render on mobile

- [ ] **Step 5: Make composer touch-safe**

In `ChatInput.tsx`, on mobile:

- plus button uses `mobile-touch-target`
- send/stop compact button uses `h-11 w-11`
- slash and plus menus use `left-0 right-0 w-auto max-w-[calc(100vw-24px)]`
- keyboard shortcut footer in slash menu can hide on mobile

- [ ] **Step 6: Make permission selector mobile-safe**

In `PermissionModeSelector.tsx`, on mobile:

- dropdown uses fixed bottom sheet or full-width anchored sheet.
- bypass confirm overlay removes `pl-[var(--sidebar-width)]`.
- dialog width becomes `w-[calc(100vw-24px)] max-w-[420px]`.

- [ ] **Step 7: Run focused mobile tests**

Run:

```bash
cd desktop && bunx vitest run src/components/layout/AppShell.test.tsx src/pages/ActiveSession.test.tsx src/components/chat/ChatInput.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add desktop/src/hooks/useMobileViewport.ts desktop/src/theme/globals.css desktop/src/components/layout/AppShell.tsx desktop/src/components/layout/Sidebar.tsx desktop/src/pages/ActiveSession.tsx desktop/src/components/chat/ChatInput.tsx desktop/src/components/controls/PermissionModeSelector.tsx desktop/src/components/layout/AppShell.test.tsx desktop/src/pages/ActiveSession.test.tsx desktop/src/components/chat/ChatInput.test.tsx
git commit -m "Adapt chat shell for mobile H5 access"
```

### Task 6: H5 Documentation And Verification

**Files:**
- Create: `docs/desktop/h5-access.md`
- Modify: `docs/.vitepress/config.mts` if desktop docs sidebar needs the new page.
- Test/verify: docs build if sidebar changes.

- [ ] **Step 1: Write user-facing setup doc**

Create `docs/desktop/h5-access.md` with:

- enable H5 in Settings
- copy token
- configure allowed origin
- expose backend with LAN/reverse proxy
- open H5 URL on phone
- reset token if leaked
- TLS recommendation for domains

- [ ] **Step 2: Add docs navigation only if desktop docs already list peer pages**

Inspect `docs/.vitepress/config.mts`. If `docs/desktop` is sidebar-linked, add H5 page next to related desktop pages. If there is no desktop sidebar section, leave the page unlinked for now and mention the path in final handoff.

- [ ] **Step 3: Run docs check if navigation changed**

Run: `bun run check:docs`

Expected: PASS. If it fails due pre-existing npm lock/dependency drift, record the blocker and do not modify lockfiles unless the failure is caused by this docs change.

- [ ] **Step 4: Run full targeted gates**

Run:

```bash
bun run check:server
bun run check:desktop
```

Then run:

```bash
bun run verify
```

Expected: PASS or explicit pre-existing blocker from the quality report.

- [ ] **Step 5: Browser/mobile smoke**

Start backend and frontend on isolated ports:

```bash
SERVER_PORT=3456 bun run src/server/index.ts --host 127.0.0.1
cd desktop && VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456 bun run dev -- --host 127.0.0.1 --port 1422
```

Use browser automation at 390x844 and 430x932 to verify:

- H5 connection view renders in browser mode without stored token.
- token entry reaches sessions list after server is configured.
- session list and chat column do not overflow viewport.
- send/stop controls are visible and touch-sized.

- [ ] **Step 6: Commit Task 6**

```bash
git add docs/desktop/h5-access.md docs/.vitepress/config.mts
git commit -m "Document H5 access setup"
```

Only include `docs/.vitepress/config.mts` if it changed.

### Execution Strategy

Use subagent-driven execution with sequencing to avoid shared-file conflicts:

1. Run Task 1 locally or with one executor. It defines server service/API contracts.
2. After Task 1 lands, dispatch one executor for Task 2.
3. In parallel after Task 1, dispatch one executor for Task 3 and one for Task 4 only if their write sets are kept separate; coordinate shared `settingsStore` and `AppShell` carefully.
4. Run Task 5 after Task 4 because both touch `AppShell`.
5. Run Task 6 last.

Do not let multiple workers edit `desktop/src/components/layout/AppShell.tsx` at the same time. If parallel execution is used, Task 4 owns `AppShell` first; Task 5 rebases on that result.

### Plan Self-Review

- Spec coverage: H5 settings, token generation, CORS/auth, browser runtime, mobile shell, error handling, docs, and verification are covered by Tasks 1-6.
- Scope: This remains one implementation plan because each task is independently testable and all tasks serve the single opt-in H5 access feature.
- Ambiguity resolved: H5 config is stored in `~/.claude/cc-haha/settings.json`, not the shared `~/.claude/settings.json`.
- Desktop safety: Default localhost/Tauri behavior is explicitly preserved and covered by focused desktop tests.

---

<a id="plans-2026-10-26-frontend-visual-polish-and-flutter-verdict"></a>

## 前端美化路线与 Flutter 迁移判定

来源：`plans/2026-10-26-frontend-visual-polish-and-flutter-verdict.md`。

- 日期：2026-10-26
- 状态：分析 + 方案（未实施，未改任何代码）
- 关联：`docs/_internal/archive/planning/desktop-and-mobile.md#specs-2026-10-26-ui-layer-hardening-design`（同日的 D5 已拒绝框架迁移）、`desktop/docs/redesign-paper-ink-seal.md`、`desktop/src/components/AGENTS.md`
- 本文只回答两件事：**现在为什么「看着不够好」**，以及**要不要迁 Flutter**。

---

### 一、结论先给

1. **不要迁 Flutter。** 这不是框架问题，而且迁移在本仓库里是**结构性不可能**：一套 `desktop/dist` 同时服务 Electron 桌面、桌面浏览器和 Android WebView，`src/server/staticH5.ts` 只认这个 bundle。换 Flutter 等于要么永久维护两套 UI，要么删掉手机端。
2. **真正的问题是「设计系统已经有规范、但规范没有执行面」。** 纸墨印重设计、组件索引、对比度测试、token 使用测试全都存在，且质量不低；但**规范只约束 `components/ui/` 一个目录**，页面层（`pages/`、`components/settings/`、`features/`）是自由发挥区。截图里的每一处「不精致」都能在这一层找到成因。
3. **美化顺序应该是：先给规范装上执行面，再改界面。** 反过来的话，改完会被下一次自由发挥冲掉——这个仓库已经发生过一次（见 §3.1 字体事故）。
4. **最伤观感的不是颜色，是「层次」和「字」。** 色阶在 paper 主题下只有 1.03–1.09 的对比差（几乎不可见），而所有标题走的是系统无衬线——「纸·墨·印」的「墨」在 2026-09-13 的一次提交里被悄悄抹掉了。

---

### 二、为什么不要迁 Flutter

#### 2.1 一个 bundle，三个宿主

| 宿主 | 消费方式 | 证据 |
|---|---|---|
| Electron 桌面 | `desktop/dist` 经 Vite 打包进 asar | `desktop/package.json` `build` |
| 桌面浏览器 / 远程 | `src/server/staticH5.ts` 把 `desktop/dist` 当静态根 | `src/server/staticH5.ts:56-90` |
| Android WebView | `mobile/` 是 774 行 Kotlin 壳，`MainActivity.kt` 加载同一份 H5 | `mobile/README.md`、`mobile/android/app/src/main/java/com/echoflow/code/mobile/MainActivity.kt` |

Flutter / Compose Multiplatform desktop **不产出可被 WebView 消费的 HTML bundle**。选择 Flutter 就是三选一：维护两套 UI、删掉手机端、或者给手机端再套一层 WebView（等于桌面端白迁）。

#### 2.2 迁移账单（仓库实测）

| 项 | 现状 | 迁移后 |
|---|---|---|
| UI 代码 | `desktop/src` 481 个 `.tsx`、约 31 万行 | 全部重写 |
| 状态层 | 81 个 Zustand store | 全部重写 |
| Electron host | 101 文件 / 26,645 行；`desktop/electron/ipc/channels.ts` 定义 **119** 个 channel | 全部重写为 Dart/原生 |
| 平台能力 | `node-pty` + xterm、ProseMirror、Shiki、Mermaid、KaTeX、pdfjs、docx-preview、xlsx、`@dnd-kit`、`@ngrok/ngrok`、Swift CU helper | 逐个找 Dart 等价物或自己写 |
| 测试 | 442 个测试文件 | 作废 |
| i18n | 5 语言 × 3,632 key | 重新接线 |
| 主题 | 6 套 `data-theme` + 221 个语义 token | 重做 |

这是 3–4 人年级别的工作量，且**迁移完仍然要回答「界面为什么还不够好看」**——因为问题不在渲染引擎。

#### 2.3 Flutter 真正更强的地方（诚实列出）

- 桌面端动画与手势的物理感（弹层、拖拽、滚动回弹）比 Web 栈更顺。
- 单语言（Dart）省掉 TS + CSS + Electron 三层心智。
- 桌面包的冷启动与内存占用优于 Electron（本仓库 Linux 解包 709MB，其中 Electron runtime 310MB，见同日 spec E5）。
- 如果产品未来要**手机本地跑 agent**，Flutter 一套代码覆盖 iOS/Android 比现在的 Kotlin 壳 + WebView 更正统。

**但这些优势都不解决「模型管理页看起来像表单堆叠」这个问题。** 那是信息架构与视觉层级问题，Flutter 会一模一样地重现它。

#### 2.4 什么条件下答案会翻转

只有一种：**手机端从「远程看会话」升级为「手机本地跑完整 agent」**，且这条产品线被确认优先于桌面。那时移动端需要真正的原生 UI，Flutter 才成为候选。当前 `docs/mobile/index.md` 明确写着手机端不支持本地 sidecar，所以答案是不迁。

---

### 三、真正的诊断

#### 3.1 事故一：设计系统的「签名」被一次提交抹掉

`desktop/docs/redesign-paper-ink-seal.md` 规定标题走衬线，这是「纸·墨·印」的「墨」：

```
/* Type roles. Headings are serif — that is the "墨" half of 「纸 · 墨 · 印」. */
--font-headline: 'Noto Serif SC', 'Songti SC', ..., sans-serif;
--font-serif: var(--font-headline);
```

2026-09-13 的提交 `6f0650c5c`（作者：程序员阿江(Relakkes)，`fix(workspace): align resource panels...`，一个**看起来与字体无关的 commit**）把它改成了：

```css
--font-headline: var(--font-body);   /* globals.css:714 */
--font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', ...;
```

后果：

- **79 处** `font-headline` 调用点全部退化成系统无衬线（`SettingsPageHeader`、`MarkdownRenderer`、`PluginList`、`SkillList`、`TraceDetail` 等）。
- 32,876 字节的 `noto-serif-sc-latin.woff2` 仍在打包，但**已无任何消费方**（`font-serif` 使用次数 = 0）。
- 85,272 + 48,432 字节的 Inter、15,240 + 24,576 字节的 Manrope 同样在打包，`--font-body` 已不含 Inter——**约 170KB 字体是死重**。
- 结果是整个应用的「签名感」消失：模型管理页标题「模型管理」用的是和正文一样的系统字体，只靠 24px 字号区分。

**这不是审美分歧，是一次没有回归测试覆盖的静默退化。** 没有任何测试断言 `--font-headline` 必须是衬线。

#### 3.2 事故二：规范只约束一个目录

`desktop/src/components/ui/contract.test.ts` 会拦截 hex、`rounded-md`、store import——但**只扫描 `src/components/ui/`**。页面层不受约束，于是：

| 指标 | 实测 | 含义 |
|---|---|---|
| `rounded-md` / `rounded-lg`（AGENTS.md 明令禁止） | 26 / 12 处 | 用的是 Tailwind 默认 6px/8px，与 `--radius-md` 10px、`--radius-lg` 13px 不同值 |
| 手搓卡片（`rounded-[var(--radius-xl)] border border-[var(--color-border)]`） | 71 处 | 而 `<Card>` 原语只被用了 55 次 |
| 手写 `<button>` / `<Button>` | 216 / 333 | 复用率 61%，比组件库计划记录的 22% 有改善，但仍有 216 处绕过 focus/disabled/尺寸体系 |
| `text-white` 压在 `--color-brand` 上 | 2 处 | `EchoFlowAPIOfficialLogin.tsx:196` 就是截图里那颗按钮 |
| 字号种类 | `text-[Npx]` **30 种不同数值** | 其中 `text-[12.5px]` 用了 58 次、`text-[13.5px]` 32 次、`text-[16.5px]` 19 次——半像素字号说明梯度是手调的，不是选出来的 |
| 内容宽度 | settings 各页 `max-w-xl` / `max-w-2xl` / `max-w-3xl` / `max-w-4xl` / `max-w-5xl` / 无约束 | 切 tab 时内容宽度会跳 |

#### 3.3 事故三：层次建在「看不见的色阶」上

`globals.css` 把 7 级 surface 映射到只有 5 个源变量，`paper` 主题实测相邻层级对比度：

```
bg(纸底) ↔ s2(surface-container)      1.045
bg      ↔ s0(surface-container-low)   1.091
bg      ↔ s1(surface-container-high)  1.183
s2 ↔ s0                               1.045
s0 ↔ s1                               1.084
```

**1.03–1.09 的差异在真实显示器上等于零。** 而设计规范写着「层次靠底色分层与 1px 细边框建立，不靠重阴影」。当底色分层看不见、1px 边框只有 1.25:1 时，「层次」实际上只剩边框线，于是页面读起来是「一堆等价的框」——这正是截图给人的第一印象。

同时：`--color-surface-container-highest` 和 `--color-surface-variant` **定义了但 0 次使用**；`--color-surface-dim`、`--color-on-surface`、`--color-on-surface-variant` 等 16 个 token 也从无消费方。名义 7 级，实际在用 3 级。

#### 3.4 事故四：两套图标语言并存

- `material-symbols-outlined`：234 处、69 个文件，1,109KB 字体。
- `lucide-react`：100 个文件。
- **16 个文件同文件混用。**

图标字体固定 `FILL 0 / wght 400 / opsz 24`（`globals.css:1587`），而 Material Symbols 的字形是按 **24px 光学尺寸**设计的。设置导航用 18px 渲染它们（`Settings.tsx:125`）——**在非设计尺寸下渲染，笔画会偏细偏虚**，这是截图里左侧导航图标显得「糊」的直接原因。lucide 是 SVG，任何尺寸都锐利。两套并列时，这种锐度差会被眼睛直接读成「不专业」。

#### 3.5 事故五：信息架构平铺，页面自己找层次

`desktop/src/pages/Settings.tsx` 是 **19 个平级 TabButton 的线性列表**：provider / general / runtime / voice / h5Access / adapters / terminal / mcp / agents / skills / memory / plugins / pets / computerUse / activity / trace / diagnostics / configGenerator / about。无分组、无搜索、无层级。

- 侧栏宽 195px，内容区 `px-9 py-8`。
- 无搜索框（`grep SearchField` 在 `Settings.tsx` 里 0 命中）。
- `dns` 图标用了两次（providers 和 mcp），视觉上无法区分。
- 无密度设置（`grep density` 在 stores/settings 里 0 命中）。

这里的问题不是「丑」，是**用户找不到东西**，于是每个页面都在自己内部重复堆标题来补偿，越堆越长。

#### 3.6 事故六：截图里那颗按钮为什么「看着不对」

`EchoFlowAPIOfficialLogin.tsx:196`：

```tsx
className="... bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
```

- 未配置凭据时按钮本来就 `disabled`（userId/managementToken 为空），而 `disabled:opacity-50` 把**整个按钮**（含文字）合成到 50%。
- 实测：品牌色 `#96442B` 压在纸色卡 `#FBF9F4` 上 50% 混合 → 底色 `#C89E90`、文字 `#FDFCFA`，**对比度 2.34:1**，低于 AA 4.5:1，也低于大字号 3:1。这就是截图里那颗按钮「像被洗掉了」的量化原因。
- 同时它绕过了 `Button` 原语（`docs/redesign-paper-ink-seal.md` 规定 `primary` 是**墨色实心**，禁用态是不透明的 `--s1`/`--t3`，不是半透明）。

**同一屏里三套按钮语言**：页头近黑实心、卡内半透明品牌色、旁边三段虚线框按钮（`rounded-md border border-[var(--color-border)]`）。没有统一的「主/次/次次」分级。

#### 3.7 事故七：状态与错误被当成附属品

- 错误行渲染在卡片**最底部、左对齐**（`EchoFlowAPIOfficialLogin.tsx:275`），`text-xs`，没有 `role="alert"`、没有 `aria-describedby`——违反 `components/AGENTS.md` §6 的无障碍基线。
- 状态圆点（成功的绿点、未配置的灰点）+ 名称 + 「未配置凭据」三处表达同一件事，但没有视觉主次。
- 每张供应商卡都有一个拖拽把手 `GripVertical`，即便只有一个供应商可拖——在只有 5 张卡的列表里，把手比信息更抢眼。

#### 3.8 事故八：文档与代码已经漂移

| 文档 | 声称 | 实际 |
|---|---|---|
| `components/AGENTS.md:96` | 「三个主题（white / light / dark）」 | 六套：white / paper / warm-classic / celadon / dark / ink-blue |
| `components/AGENTS.md:230` | gallery「右上角切三个主题」 | 同上 |
| `redesign-paper-ink-seal.md:20` | 六套 | 正确 |
| `components/AGENTS.md:92` | 「`rounded-md` 禁用」 | 仅 ui/ 目录被 contract 测试拦截 |

**当规范本身有两个版本时，执行者会挑省事的那个。** 这是 §3.2 的根因，而不只是纪律问题。

---

### 四、美化路线（分四阶段，每阶段都能独立验收）

#### 阶段 0：先修执行面（1–2 天，不改观感但决定后续是否会被冲掉）

| 动作 | 文件 | 验收 |
|---|---|---|
| 恢复衬线标题 token，或**明确决定**放弃衬线并同步文档 | `globals.css:714` + `redesign-paper-ink-seal.md` | 新增 `globals.test.ts` 断言：`--font-headline` 必须解析到一个非 `--font-body` 的栈，或文档删掉「墨」的表述 |
| 删掉无消费方的字体（Inter / Manrope / 可选 Noto Serif） | `globals.css:20-52`、`public/fonts/` | 构建产物少 ~170KB；`paletteEscapes.test.ts` / `globals.test.ts` 绿 |
| 把 `contract.test.ts` 的规则从 `ui/` 扩到 `pages/` + `components/settings/` | `desktop/src/**/contract.test.ts` | 先只开「禁 hex / 禁 `rounded-md` / 禁 `text-white` on brand」三条，其余后续 |
| 修正文档三主题 → 六主题 | `components/AGENTS.md` | `bun run check:docs` |

> 关键取舍：`contract.test.ts` 扩面会一次性亮出 38 处违规。**先把它们修完再开测试**，否则只能加 `// eslint-disable` 式的豁免，等于没做。

#### 阶段 1：修「看不见的层次」和「不平整的字」（3–5 天，观感提升最大）

这是投入产出比最高的一档，因为改的是全局 token 而不是单个页面。

1. **拉开 surface 阶梯。** 目标：`bg ↔ container-low` ≥ 1.12，`bg ↔ container` ≥ 1.08，`s0 ↔ s1` ≥ 1.15。做法是把 `paper` / `white` / `warm-classic` / `celadon` 四个浅主题的 `--cc-s0` / `--cc-s1` / `--cc-s2` 分别往下压，然后在 `contrast.test.ts` 里加一条「相邻 surface 层级最小对比差」断言，防止再次被压平。
2. **收敛字号梯度到 7 档。** 现在 30 种数值。建议：`11 / 12 / 13 / 14 / 16 / 20 / 24`（半像素字号全部并入相邻档）。做法是加 `--text-2xs` 语义档，把 `text-[Npx]` 全量替换，然后加一条 contract 断言禁止新的任意 px 字号。
3. **统一内容宽度。** settings 全部收敛到 `max-w-2xl`（672px），宽表类页面（MCP、Diagnostics）用 `max-w-4xl` 并显式声明豁免。加断言。
4. **补齐 focus / disabled / hover 三态到一个地方。** `Button` 原语已有正确实现（`disabled` 是不透明 `--s1`/`--t3`），把 216 处原生 `<button>` 分批替换——一次一个目录，每次伴随测试。

**验收**：截图三张（paper / dark / warm-classic）、`bun run check:desktop` 绿、`contrast.test.ts` 扩充后的层级断言绿。

#### 阶段 2：修页面构图（5–8 天，解决截图里的具体问题）

1. **模型管理页重排。** 现在的「一张大卡包住表单 + 五张等价卡」改为：
   - 「EchoFlow API 官方」作为**主卡**：左侧状态 + 账号摘要，右侧单一主行动；凭证输入收进 `Modal` 或行内展开，不再常驻。
   - 「已配置供应商」改为**密集列表行**（状态点 + 名称 + 模型标签 + 右侧操作），仅在选中时展开编辑区——参考 `redesign-paper-ink-seal.md` 里已有的「列表行」形态，而不是每行都是一张大卡。
   - 把「绑定账号」按钮换成 `Button variant="primary"`（墨色），禁用态走原语。
2. **设置导航分组 + 搜索。** 19 项分为：**模型与运行时**（providers / runtime / terminal / mcp）、**连接与访问**（h5Access / adapters / computerUse）、**智能体与技能**（agents / skills / plugins / memory）、**外观与声音**（general / voice / pets）、**诊断**（activity / trace / diagnostics / configGenerator）、**关于**。顶部加 `SearchField` 过滤。这是解决「找不到」的根本，也让每页不必再靠堆标题补偿。
3. **错误态升格为独立形态。** 用 `--color-error-container` 底 + `--color-on-error-container` 字 + `role="alert"`，放在它描述的控件旁边，而不是卡片底部的 `text-xs` 红字。
4. **图标收敛为一套。** 二选一：全部换 lucide（SVG、任意尺寸锐利、与已有 100 个文件一致），或保留 Material Symbols 但**在 24px 倍数下渲染**。推荐前者；69 个文件的替换可以按目录分批。

#### 阶段 3：动效与细节（3–5 天）

- 统一 `duration-150 / ease-out`（目前 46 / 12 / 3 / 2 分散在四档）。
- 卡片 hover 抬起用 `Card lift`（现仅 14 处），列表行 hover 用 `--color-surface-hover`。
- 补 `EmptyState`：35 个页面里大量空列表只渲染空白或一行灰字。
- 骨架屏：列表加载时用 `Skeleton` 而不是 `animate-spin`（现 40 处 spin）。
- 加一条视觉回归：`bun run check:desktop-ui-smoke` 已在跑真实 UI，可扩展为对关键页面截图做像素基线（目前**仓库零视觉回归机制**）。

---

### 五、迁移也解决不了的三件事

1. **规范没有执行面**——换语言不会自动产生「哪些类名不允许」的自动化检查。
2. **层次靠 1.05 的色差**——Flutter 的 `ColorScheme` 一样可以定义出一组看不见差别的 surface。
3. **19 个平级设置项**——这不是渲染层问题，是信息架构，任何框架都会忠实重现。

反过来说：**这三件在 React 栈里都有低成本解法**（contract 测试、token 数值、分组导航），而迁移的成本是 3–4 人年。

---

### 六、即使按上面做完，仍可能「看着不够好」的三处

1. **没有真正的页面级视觉基线。** 现在所有验证都是断言（对比度、token 解析、contract），没有一张截图基线。风格漂移只能靠人眼发现——这正是 `6f0650c5c` 能悄悄抹掉衬线的原因。**建议把视觉回归列为阶段 3 的硬交付。**
2. **内容密度与信息量的矛盾。** 19 个设置项、每项都可能有十几个配置字段，密度不可能低到「高级感」。参考 Linear / Raycast 的做法是把**低频项收进 advanced 折叠**，而不是摊平——这需要先做「哪些字段是 90% 用户永远不碰的」的产品判断。
3. **两套字体目标之间的摇摆。** 现在是「系统无衬线（工具感）」和「衬线标题（文气感）」的混合，但衬线已失效、系统字体也没有经过选择。需要一次**明确的字体决策**（要么全系统字体走工具路线，要么恢复衬线走文气路线），并写进测试——继续摇摆的话，每次重构都会有人「顺手」改掉它。

---

### 七、落地顺序建议

```
阶段 0（修执行面，2 天）
   └─ 字体决策 + contract 扩面 + 文档漂移修正
阶段 1（全局 token，4 天）
   └─ surface 阶梯 + 字号 7 档 + 内容宽度 + 三态统一
阶段 2（页面构图，6 天）
   └─ 模型管理页重排 + 设置分组搜索 + 错误态 + 图标收敛
阶段 3（动效与基线，4 天）
   └─ 动效统一 + 空态骨架 + 视觉回归机制
```

每个阶段结束都应留下：改动文件清单、`bun run check:desktop` / `check:impact` 结果、三主题截图、已知风险。**不要在阶段 0 完成前开始阶段 2**——否则改动会被下一次自由发挥覆盖。

---

### 八、附：本文引用的全部实测数据

| 数据 | 值 | 来源 |
|---|---|---|
| `desktop/src` tsx / ts / css | 481 / ~520 / 3 | `find` |
| tsx 行数 / ts 行数 | 170,374 / 137,780 | `find … -exec cat \| wc -l` |
| 测试文件 | 442 | `find -name '*.test.ts*'` |
| Zustand store 文件 | 81 | `ls desktop/src/stores` |
| 页面 | 35 | `ls desktop/src/pages/*.tsx` |
| 设置分页 | 19（含 about） | `Settings.tsx:55-75` |
| i18n key | 3,632 × 5 语言 | `grep -c` |
| IPC channel | 119 | `desktop/electron/ipc/channels.ts` |
| Electron host | 101 文件 / 26,645 行 | `find desktop/electron` |
| `globals.css` | 3,209 行 / 569 个 `--cc-*` | `wc -l`、spec E16 |
| 语义 token 定义 / 被消费 / 从未消费 | 221 / 205 / 16 | `comm` |
| 长尾 token（用 1 次 / ≤2 次） | 38 / 56 | `sort \| uniq -c` |
| 任意 px 字号种类 | 30 | `grep -oE 'text-\[[0-9.]+px\]'` |
| material-symbols / lucide | 234 处/69 文件 / 100 文件，16 文件混用 | `grep -rl` |
| 禁用按钮对比度 | 2.34:1 | 手工计算（50% 合成 `#96442B` + `#FBF9F4`） |
| paper 主题 `bg ↔ s2` | 1.045 | 手工 WCAG 计算 |
| 手搓卡片 / `<Card>` | 71 / 55 | `grep` |
| 原生 `<button>` / `<Button>` | 216 / 333 | `grep` |

---

<a id="plans-2026-10-26-ui-layer-hardening"></a>

## UI 层改造（不做框架迁移）Implementation Plan

来源：`plans/2026-10-26-ui-layer-hardening.md`。

**Goal:** 在不更换框架的前提下，把 EchoFlow Code 的安装包体积压下来并加上防回涨 gate，把桌面 UI 开发体验从「超大组件 + 散落 token」改成「可维护的设计系统」，并把 H5/Android WebView 从偶然耦合提升为一等表面。

**Architecture:** 三个独立子项目串行推进：Task 1-4 是纯打包配置与 gate（不碰运行时逻辑）；Task 5-6 是 `desktop/src` 内的渐进重构（拆组件 + token 审计）；Task 7 是 H5 bundle 瘦身与 mobile 契约 gate。每个子项目独立可测、独立可回滚。root `src/` 一行不改。

**Tech Stack:** Electron + electron-builder（打包）、React 18 + TypeScript + Tailwind v4 + zustand（UI）、Bun test + Vitest（测试）。

**Spec:** `docs/_internal/archive/planning/desktop-and-mobile.md#specs-2026-10-26-ui-layer-hardening-design`

---

### Global Constraints

- **root `src/` 是 cli-core，本计划不修改任何 root `src/` 文件。** 若某步骤看似需要改 `src/`，停下来在 plan 里记为 blocker，不要改。
- `desktop/package.json` 在 `desktopNativeExactPaths`：改它会同时触发 `bun run check:desktop` 与完整 `bun run check:native`。
- 打包相关改动的验证命令是 `bun run check:native`（真实 `electron:package:dir` + package-smoke），不是 `bun run check:desktop`。
- **禁止拆分合并 sidecar。** bun compile floor 实测 90.2MB，拆开是净亏（spec E11）。
- **禁止一次性 shadcn / Radix 迁移。** 已被 revert 过（spec E12）；浮层统一一次只替换一个。
- 新增 CSS 变量：禁止。删除 / 合并已存在变量：允许，但不得改动已发布 token 的**名字**（`globals.test.ts`、`contrast.test.ts`、`paletteEscapes.test.ts` 依赖）。
- `echoflow-code-*` localStorage 键与 WebView origin 不得变动；本计划不触发 `check:persistence-upgrade`，若意外触发说明做错了。
- Conventional Commit 前缀 + `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 每个 Task 结束时 `git status --short` 确认只 stage 了本任务的文件。

### Review Focus

以下输入 / 条件是 spec 隐含要求但没有被任何单个任务的测试自然覆盖的，最可能伤到真实用户：

1. **Windows 与 macOS 构建**：本计划的验证在 Linux 上跑，但 `electronLanguages`、否定 glob、rg 清理、`dist/**` 从 asarUnpack 移除都是跨平台配置。Windows/macOS 上若 `dist/` 被 asar 压缩后 `staticH5.ts` 解析不到，手机端会静默变白屏。→ 由 Task 4 的 `staticH5` 路径解析测试覆盖（用 fixture 同时断言 `.asar` 与 `.asar.unpacked` 两条候选）。
2. **H5 远程访问在生产 asar 下的可用性**：Task 4 把 `dist/**` 移出 `asarUnpack`，直接改变手机端取文件的路径。→ Task 4 必须有一条在「dist 在 asar 内」fixture 下 `handleStaticH5Request` 返回 200 的测试。
3. **ripgrep 在真实运行时被找到**：Task 2 清理异 target 变体，若清错了会让 ripgrep 完全消失，搜索功能整体报废。→ Task 2 必须保留 `hasMatchingRipgrepManifest` 语义并加「目标 target 的 rg 必须存在」断言。
4. **拆组件后的视觉一致性**：Task 5 拆 4061 行的 `MessageList.tsx`，最容易产生「行为没变但渲染差一像素」的回归。→ Task 5 要求先有 `MessageList.test.tsx` 的既有用例全绿 baseline，再拆；且 `check:desktop-ui-smoke` 必须跑过。
5. **size-budget 数值定错导致 CI 假失败**：Task 3 加的 MB 断言若按理想值而非实测值设定，会在别人机器上误报。→ Task 3 的测试必须从 fixture 读期望值而非硬编码，并在同一步骤打印实测值。

---

### File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `desktop/package.json` | 打包配置：`build.files` 否定 glob、`electronLanguages`、`asarUnpack` | T1, T4 |
| `desktop/scripts/prepare-ripgrep.ts` | ripgrep staging；清理异 target 变体 | T2 |
| `desktop/scripts/clean-electron-output.ts` | 打包前清理 staging 目录 | T2 |
| `scripts/quality-gate/package-smoke/desktopSize.ts` | size-budget 断言逻辑 | T3 |
| `scripts/quality-gate/package-smoke/desktopSize.test.ts` | 上述的测试 | T3 |
| `scripts/quality-gate/package-smoke/index.ts` | 挂载新 lane | T3 |
| `src/server/__tests__/staticH5.test.ts` | H5 静态路径解析回归 | T4 |
| `desktop/src/components/chat/MessageList.tsx` + 新子组件 | 拆分 4061 行组件 | T5 |
| `desktop/src/theme/globals.css` | 删除无引用 / 重复 CSS 变量 | T6 |
| `desktop/src/components/chat/MermaidRenderer.tsx` | mermaid 改 lazy | T7 |
| `desktop/src/components/markdown/MarkdownRenderer.tsx` | katex 改 lazy | T7 |
| `mobile/test/native-contract.test.ts` | WebView patch 契约 gate | T7 |

---

### Task 1: 打包配置瘦身（否定 glob + electronLanguages）

**Files:**
- Modify: `desktop/package.json`（`build.files`、`build.electronLanguages`）
- Test: `desktop/scripts/prepare-ripgrep.test.ts` 无关；本任务无新单测，靠 `check:native` 实测

**Interfaces:**
- Consumes: 无
- Produces: `build.files` 新增两条否定 glob；新增 `build.electronLanguages: ["en-US", "zh-CN"]`。后续 Task 3 的 size lane 依赖这两项已生效。

**背景（不可跳过）：** asar 内 3,233 个 `.map` 文件（spec E6），而 `electron-dist/main.cjs` 对这些包的引用为 0（spec E7）。renderer 真实产物已在 `desktop/dist/assets`。`@electron/asar` **不支持压缩**，设 `asarCompression` 会被静默忽略——不要加那个字段。

- [ ] **Step 1: 记录当前基线**

在改任何东西前，跑一次完整打包并记录体积：

```bash
cd desktop && bun run clean:electron-output && bun run electron:package:dir
```

然后把 `build-artifacts/electron/linux-unpacked` 的总字节数写进本 plan 的「实测记录」一节（文末）。这是 Task 3 设定期望值的依据。

- [ ] **Step 2: 加 `electronLanguages`**

在 `desktop/package.json` 的 `build` 对象里加：

```json
"electronLanguages": ["en-US", "zh-CN"]
```

- [ ] **Step 3: 加否定 glob 排除 source map**

在 `desktop/package.json` 的 `build.files` 数组**末尾**追加两条：

```json
"!**/*.map",
"!**/node_modules/**/{test,__tests__,tests,demo,docs,examples,examples-*,site,website}/**"
```

注意 `!` 规则必须在数组末尾——electron-builder 的 glob 顺序敏感，否定模式只对它前面的模式生效。

- [ ] **Step 4: 重新打包并记录体积**

```bash
cd desktop && bun run clean:electron-output && bun run electron:package:dir
```

预期：体积下降 60-110MB（47MB locale + source map）。把新字节数写进「实测记录」。

- [ ] **Step 5: 确认 rg.exe 仍在、且没删掉不该删的**

```bash
ls -la desktop/build-artifacts/electron/linux-unpacked/resources/app.asar.unpacked/src-tauri/binaries/
```

预期：`rg` 与 `rg.exe` 都还在（rg.exe 的清理是 Task 2，不要在这里做）。若 `rg` 消失了，说明否定 glob 写错了，回退 Step 3。

- [ ] **Step 6: 跑 native gate**

```bash
bun run check:native
```

预期：PASS。若 package-smoke 因体积变化失败，看它的输出是否为「体积断言」——本任务还没有那条断言，所以失败意味着别的东西坏了。

- [ ] **Step 7: Commit**

```bash
git add desktop/package.json
git commit -m "build(desktop): prune locales and source maps from the package

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 清理 staging 目录里异 target 的 ripgrep 变体

**Files:**
- Modify: `desktop/scripts/prepare-ripgrep.ts`
- Modify: `desktop/scripts/clean-electron-output.ts`
- Test: `desktop/scripts/prepare-ripgrep.test.ts`（若不存在则创建）

**Interfaces:**
- Consumes: `getBundledRipgrepName(targetTriple)`、`hasMatchingRipgrepManifest(manifestPath, triple)`（已在 `build-sidecars.ts`，需导出或复制语义）
- Produces: `prepare-ripgrep.ts` 导出 `stageRipgrepForTarget(targetTriple, opts)` 语义不变的纯函数式清理逻辑；`clean-electron-output.ts` 增加 `--check-only` 下的异 target 检测

**背景（不可跳过）：** `src-tauri/binaries/` 是**持久** staging 目录。`prepare-ripgrep.ts` 的清理循环只在下载 / archive 路径走到，`build-sidecars.ts` 的 `stageHostRipgrepForOfflineBuild()` dev fallback 路径**只写不删**（spec E9）。所以 Windows 机器上 build 过一次后，`rg.exe` 会永远留在目录里，之后任何 Linux 打包都带着它（4.1MB）。

- [ ] **Step 1: 写失败测试——目标 target 的 rg 必须存在**

在 `desktop/scripts/prepare-ripgrep.test.ts` 加：

```ts
test('pruneRipgrepVariants keeps only the target triple executable', () => {
  // fixture 目录里同时放 rg / rg.exe / ripgrep-manifest.json(targetTriple=x86_64-unknown-linux-gnu)
  const kept = pruneRipgrepVariants(['rg', 'rg.exe', 'ripgrep-licenses', 'claude-sidecar-x86_64-unknown-linux-gnu'], 'x86_64-unknown-linux-gnu')
  expect(kept).toContain('rg')
  expect(kept).not.toContain('rg.exe')
  expect(kept).toContain('ripgrep-licenses')
})
```

同时一条反向测试：target 是 windows 时反过来，且**目标 executable 必须保留**（这是 Review Focus #3）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && bun test ./scripts/prepare-ripgrep.test.ts`
Expected: FAIL，`pruneRipgrepVariants is not defined`

- [ ] **Step 3: 实现 `pruneRipgrepVariants(entries, targetTriple)`**

签名：`(entries: string[], targetTriple: string) => string[]`
返回应保留的条目名。规则：保留 `getBundledRipgrepName(targetTriple)` 的结果、保留所有非 `rg*` 条目、删掉另一个 executable 名与 `rg-` 前缀的残留。

- [ ] **Step 4: 在 `prepare-ripgrep.ts` 里调用它**

在写 manifest 之前调用，替换现有的内联清理循环（现有循环已经做了大部分事，只是没被 dev fallback 路径走到）。保持 `prepareRipgrep()` 的对外签名不变。

- [ ] **Step 5: 在 `clean-electron-output.ts` 里也清理**

`clean:electron-output` 跑在 `electron:package` 最前面。让它按 `ripgrep-manifest.json` 的 `targetTriple`（或 `SIDECAR_TARGET_TRIPLE` env）删掉异 target 变体。`--check-only` 模式下改为报告而不删除。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd desktop && bun test ./scripts/prepare-ripgrep.test.ts`
Expected: PASS

- [ ] **Step 7: 手动验证 staging 目录**

```bash
rm -f desktop/src-tauri/binaries/rg.exe
cd desktop && bun run check:native
```

预期：PASS，且产物里没有 `rg.exe`。

- [ ] **Step 8: Commit**

```bash
git add desktop/scripts/prepare-ripgrep.ts desktop/scripts/clean-electron-output.ts desktop/scripts/prepare-ripgrep.test.ts
git commit -m "fix(desktop): prune cross-target ripgrep from the staging dir

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: size-budget gate

**Files:**
- Create: `scripts/quality-gate/package-smoke/desktopSize.ts`
- Create: `scripts/quality-gate/package-smoke/desktopSize.test.ts`
- Modify: `scripts/quality-gate/package-smoke/index.ts`（在 `inspectLinuxArtifacts` / `inspectWindowsArtifacts` / `inspectMacosArtifacts` 三个分支里挂断言）

**Interfaces:**
- Consumes: Task 1/2 已生效的打包配置
- Produces:
  - `export function measureDirectorySizeBytes(dir: string): number` — 递归累加文件字节，**不用 shell `du`**（Windows 不可用）。用 `readdirSync` + `statSync`，`index.ts` 已 import 这两个。
  - `export function formatBytes(bytes: number): string` — 供报告打印 MB。
  - `export function assertDesktopSizeWithinBudget(actualBytes: number, budgetBytes: number): void` — 超预算 throw，消息带实际值/预算/超出量。

**背景（不可跳过）：** 仓库没有任何 size gate（已验证 `scripts/quality-gate/` 无 size 断言）。这条 gate 是 Task 1-2 成果的唯一保护。

**lane 机制（实现前必读）：** `inspectPackagedArtifacts()` 按 `options.platform` 分派到 `inspectMacosArtifacts` / `inspectWindowsArtifacts` / `inspectLinuxArtifacts`，每个分支把 `{label, path}` 推进 `report.passedChecks` / `report.missingChecks`，最终 `report.passed = report.missingChecks.length === 0`。所以 size 断言**不是新 lane**，而是在三个分支里各加一条 check：测出 unpacked 目录大小（`findLinuxUnpackedDir(report.artifactsDir)` 已存在，Windows/macOS 有各自定位方式），与预算比较，超了 push 进 `report.missingChecks`。预算从 JSON 读，因为三个平台的体积不同。

- [ ] **Step 1: 写失败测试**

`desktopSize.test.ts`（放 `scripts/quality-gate/package-smoke/`，与 `index.test.ts` 同目录同风格）：

```ts
test('assertDesktopSizeWithinBudget passes at or under budget', () => {
  expect(() => assertDesktopSizeWithinBudget(1000, 1000)).not.toThrow()
})
test('assertDesktopSizeWithinBudget fails above budget with the actual size in the message', () => {
  expect(() => assertDesktopSizeWithinBudget(1001, 1000)).toThrow(/1001/)
})
test('measureDirectorySizeBytes sums nested files', () => {
  // 用 mkdtempSync 建 fixture 树：a/b.txt 10 字节 + c.bin 20 字节 → 30
})
test('formatBytes renders MB', () => {
  expect(formatBytes(1048576)).toContain('1')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ./scripts/quality-gate/package-smoke/desktopSize.test.ts`
Expected: FAIL，函数未定义

- [ ] **Step 3: 实现三个函数**

放 `desktopSize.ts`。`measureDirectorySizeBytes` 要处理 symlink（`statSync` 默认 follow，与 electron-builder 的行为一致即可，不必特判）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ./scripts/quality-gate/package-smoke/desktopSize.test.ts`
Expected: PASS

- [ ] **Step 5: 在三个平台分支挂断言**

每个分支里：定位 unpacked 目录 → `measureDirectorySizeBytes` → 从 `scripts/quality-gate/package-smoke/desktopSizeBudget.json` 读该平台的预算 → 比较 → 超了 `report.missingChecks.push({label: 'desktop unpacked size within budget', path: ...})`，并在 note 里打印实测 MB。

**预算 JSON 按平台分键**，因为 macOS bundle / Windows NSIS / Linux unpacked 体积差异很大：

```json
{
  "linux": { "unpackedBytes": 0 },
  "windows": { "unpackedBytes": 0 },
  "macos": { "unpackedBytes": 0 }
}
```

- [ ] **Step 6: 按 Task 1 Step 4 的实测值定预算**

把 Linux 的 `unpackedBytes` 设为 Task 1 Step 4 实测值 **+5% 余量**（locale 集与依赖版本会小幅波动）。Windows/macOS 在本机无法实测，**设为 `null` 并在代码里跳过该平台的断言**，同时在 note 里打印实测值供维护者回填。**不要**给未实测平台编一个数值——那会立刻误报。

- [ ] **Step 7: 跑 gate 确认通过并打印实测值**

Run: `bun run check:native`
Expected: PASS，且 `[package-smoke]` 输出里能看到 unpacked 实测 MB 数与预算。

- [ ] **Step 8: Commit**

```bash
git add scripts/quality-gate/package-smoke/
git commit -m "ci(quality-gate): assert the desktop unpacked size against a budget

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 把 `dist/**` 移出 `asarUnpack`，并锁住 H5 路径解析

**Files:**
- Modify: `desktop/package.json`（`build.asarUnpack`）
- Test: `src/server/__tests__/staticH5.test.ts`（若不存在则创建；**注意这是 root `src/` 下的测试文件**）

**Interfaces:**
- Consumes: `handleStaticH5Request(req, url)` from `src/server/staticH5.ts`（**只调用，不修改**）
- Produces: 无新导出；本任务是配置 + 回归测试

**背景（不可跳过）：** `asarUnpack: ["dist/**", ...]` 让 `desktop/dist`（40MB）在 asar 与 unpacked 各存一份（spec E10）。`staticH5.ts` 的 `resolveH5DistDir()` 已经会依次尝试 `.asar` → `.asar.unpacked` → `CLAUDE_APP_ROOT/dist` 等多个候选，所以把 `dist/**` 移出 unpack 在理论上安全——但这条路径是手机端的生命线，必须有测试锁住。

**关于测试文件位置的说明：** `src/server/__tests__/staticH5.test.ts` 当前**不存在**。本任务要新建它，这是新增测试文件而非修改 cli-core 生产代码。但 root `src/` 下的任何改动都可能在 change-policy 里触发 cli-core 判定——**Step 0 先跑 `bun run check:impact` 确认**。若判定触发 cli-core，停下来记录 blocker，把同样的测试改为放 `desktop/` 下（用 fixture 复现候选路径解析，行为等价）。

- [ ] **Step 0: 确认 impact 判定**

Run: `bun run check:impact`
Expected: 新增 `src/server/__tests__/staticH5.test.ts` 不触发 cli-core。若触发，停下并记录 blocker。

- [ ] **Step 1: 写失败测试——dist 在 asar 内时 H5 仍可用**

创建 `src/server/__tests__/staticH5.test.ts`。三个用例：

1. fixture 目录树含 `index.html` 与 `assets/app.js`，`CLAUDE_H5_DIST_DIR` 指向它 → `handleStaticH5Request(new Request('http://x/'), new URL('http://x/'))` 返回 200 且 body 非空。
2. `CLAUDE_H5_DIST_DIR` 指向 `.../app.asar/dist` 而 fixture 实际在 `.../app.asar.unpacked/dist` → 仍返回 200（这条锁住 `.asar` → `.asar.unpacked` 回退，是 Task 4 改 `asarUnpack` 后手机端的生命线）。
3. 目录里没有 `index.html` → 返回 `null`（反向：不能假装成功）。

fixture 只放 `index.html` 与一个 `assets/app.js`，**不要**复制真实 37MB 产物。用 `mkdtempSync` 建临时树并在 `afterAll` 清理。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ./src/server/__tests__/staticH5.test.ts`
Expected: FAIL（`handleStaticH5Request` 对新 fixture 的路径解析不成立，或文件本身刚建还没有 fixture）

- [ ] **Step 3: 补齐 fixture 让测试通过**

只加 fixture 与断言，**不修改 `staticH5.ts`**。若测试暴露了真实的解析缺陷（比如 `.asar` → `.asar.unpacked` 回退根本不工作），停下来记录 blocker——修它就是改 cli-core。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ./src/server/__tests__/staticH5.test.ts`
Expected: PASS

- [ ] **Step 5: 改 `asarUnpack`**

从 `desktop/package.json` 的 `build.asarUnpack` 数组里删掉 `"dist/**"` 这一行。其他条目（node-pty、sharp、@img、detect-libc、semver、src-tauri/binaries、@ngrok）**全部保留**。

- [ ] **Step 6: 完整打包 + 验证 H5 路径**

```bash
cd desktop && bun run clean:electron-output && bun run electron:package:dir
```

然后确认 `app.asar.unpacked/` 下不再有 `dist`：

```bash
ls desktop/build-artifacts/electron/linux-unpacked/resources/app.asar.unpacked/
```

预期：没有 `dist` 条目。把体积写进「实测记录」。

- [ ] **Step 7: 跑 gate**

```bash
bun run check:native && bun run check:server
```

预期：都 PASS。`check:server` 是必须的——`staticH5.ts` 在 server area。

- [ ] **Step 8: Commit**

```bash
git add desktop/package.json src/server/__tests__/staticH5.test.ts
git commit -m "build(desktop): stop double-packing dist and pin the H5 dist resolution

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 拆分 `MessageList.tsx`（第一个超大组件）

**Files:**
- Modify: `desktop/src/components/chat/MessageList.tsx`（4061 行 → 目标 <800 行）
- Create: `desktop/src/components/chat/messageList/*.tsx`（按职责拆出）
- Test: `desktop/src/components/chat/MessageList.test.tsx`（既有，9,528 行，作为 baseline）

**Interfaces:**
- Consumes: 无（这是第一个拆的任务）
- Produces: `MessageList` 的 props 签名**不变**——这是硬约束。拆出的子组件不导出给 `MessageList` 之外使用，除非后续任务有明确需要。

**背景（不可跳过）：** 该文件对 web-heavy 栈的 import 为 0（spec E3），所以拆分不涉及任何渲染管线的替换，是纯结构工作。`MessageList.test.tsx` 有 9,528 行覆盖，这是安全网。

**铁律：先有全绿 baseline，再动一刀。**

- [ ] **Step 1: 建立 baseline**

```bash
cd desktop && bun run test -- --run src/components/chat/MessageList.test.tsx
```

记录 PASS 数。若有任何失败，**停下来**——不在红的状态下拆组件。

- [ ] **Step 2: 只做一次职责清点，不动代码**

通读 `MessageList.tsx`，列出顶层区块（如：消息分组、工具调用折叠、图片附件、代码块分发、空态、滚动锚定、虚拟化）。写下每个区块的行数范围。这份清单是后面每一步的边界依据，写进 commit message。

- [ ] **Step 3: 拆第一个区块**

选清单里**行数最大且 import 依赖最少**的区块。把它连同它私有的 helper、type、常量一起移到 `desktop/src/components/chat/messageList/<Name>.tsx`。

约束：
- 新文件不得 import `MessageList`（避免循环）。
- 若区块需要 `MessageList` 的状态，把状态作参数传进去，不要把整个 store 传进去。
- 新文件命名 PascalCase，与 `desktop/src/components/AGENTS.md` 一致。

- [ ] **Step 4: 跑测试**

```bash
cd desktop && bun run test -- --run src/components/chat/MessageList.test.tsx
```

预期：PASS 数与 Step 1 完全一致。**若有用例失败，不要改测试——回退这一步。** （AGENTS.md：never retune an existing test's inputs or invert an expectation to keep it green。）

- [ ] **Step 5: Commit 这一个区块**

```bash
git commit -m "refactor(desktop): extract <Name> out of MessageList

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 6: 重复 Step 3-5 直到 `MessageList.tsx` < 800 行**

每个区块一次 commit。若某个区块拆不出来（它的状态与父组件纠缠到无法分离），**跳过它并在最后报告**，不要为了凑数字做强行拆分。

- [ ] **Step 7: 跑完整 desktop gate + UI smoke**

```bash
bun run check:desktop && bun run check:desktop-ui-smoke
```

预期：都 PASS。`check:desktop-ui-smoke` 是必须的（Review Focus #4：视觉一致性只能靠真实浏览器证明）。若它 skip（缺 agent-browser），在报告里明确写「skipped: <reason>」。

- [ ] **Step 8: Commit（若 Step 7 后有修正）**

---

### Task 6: 审计 `globals.css` 的 569 个 CSS 变量

**Files:**
- Modify: `desktop/src/theme/globals.css`（3,209 行）
- Test: `desktop/src/theme/globals.test.ts`、`contrast.test.ts`、`paletteEscapes.test.ts`（既有，作为 baseline）

**Interfaces:**
- Consumes: 无
- Produces: 无新变量。净效果是变量数下降。

**背景（不可跳过）：** `globals.css` 已有 `@theme`(661) + 多个 `:root` 分层，z-index 已收敛为 `--z-*` 阶梯且 0 处 hack（spec E16）。**这是审计，不是重建 token 体系。** 已发布 token 的名字不能改。

- [ ] **Step 1: baseline**

```bash
cd desktop && bun run test -- --run src/theme/
```

记录 PASS 数。

- [ ] **Step 2: 找出无引用的变量**

写一个一次性脚本（或在测试里）扫描 `desktop/src/**/*.{ts,tsx,css}`，找出在 `globals.css` 里定义但从未被 `var(--cc-*)` 引用的变量。产出清单。

**注意：** 有些变量是给运行时动态拼接的类名用的（如主题相关），grep 不到不代表无用。逐个确认后再删。

- [ ] **Step 3: 删除确认无引用的变量，一次一类**

按前缀分组删（spec E16 的分组：`ac`/`t`/`diff`/`s`/`er`/`bd`/`heat`/...）。每删一组跑一次 Step 1 的测试。

- [ ] **Step 4: 找出重复定义（同名多处 `:root`）**

`globals.css` 有 5 处 `:root` 块（585/641/1206/2102 + `@theme` 后的 738）。找出被重复定义且值相同的变量，合并到一处。

- [ ] **Step 5: 跑 theme 测试 + desktop gate**

```bash
cd desktop && bun run test -- --run src/theme/ && bun run check:desktop
```

预期：PASS。theme 测试是 token 名字与对比度的守门人，改名会立刻红。

- [ ] **Step 6: 记录审计结论**

把「删了 N 个无引用变量、合并了 M 个重复定义、剩 K 个」写进 commit message。这是给下一个人的地图。

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(desktop): drop unreferenced and duplicated theme tokens

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: H5 bundle 瘦身 + mobile 契约 gate

**Files:**
- Modify: `desktop/src/components/chat/MermaidRenderer.tsx`
- Modify: `desktop/src/components/markdown/MarkdownRenderer.tsx`
- Test: `desktop/src/components/chat/MermaidRenderer.test.tsx`（既有）
- Modify: `mobile/test/native-contract.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `MermaidRenderer` 与 katex 渲染路径改为动态 import；`mobile/test/native-contract.test.ts` 新增 WebView patch 契约断言

**背景（不可跳过）：** mermaid 与 katex 是 H5 bundle 里唯一的重型静态 import（spec E14）。改成 lazy 后手机端不再下载 mermaid（除非消息里真有图表）。`MarkdownRenderer.tsx:5` 还有 `import 'katex/dist/katex.min.css'`——CSS 副作用 import 也要处理。

- [ ] **Step 1: baseline**

```bash
cd desktop && bun run test -- --run src/components/chat/MermaidRenderer.test.tsx src/components/markdown/MarkdownRenderer.test.tsx
```

记录 PASS 数。若 `MarkdownRenderer.test.tsx` 不存在，先确认覆盖它的测试是哪个文件并记下。

- [ ] **Step 2: 写失败测试——mermaid 不在入口 chunk**

在 `MermaidRenderer.test.tsx` 加一条：断言 `MermaidRenderer.tsx` 的源码不含顶层 `import mermaid from 'mermaid'`。这是**源码断言**不是行为断言，但它精确锁住「不回归」。

同时一条行为测试：渲染一个 mermaid 代码块时，动态 import 被触发且图表最终出现（用 `await waitFor`）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd desktop && bun run test -- --run src/components/chat/MermaidRenderer.test.tsx`
Expected: FAIL，源码断言命中静态 import

- [ ] **Step 4: 改 `MermaidRenderer.tsx` 为动态 import**

把 `import mermaid from 'mermaid'` 改为在 effect 内 `const { default: mermaid } = await import('mermaid')`。组件需要在 loading 期间渲染一个占位（用 `ui/Skeleton` 或现有加载态，不要新造）。

**坑：** mermaid 的 `initialize` 与 `render` 都是 async，且 theme 变化时要重新 render。保持现有的 `isDarkTheme` 逻辑，只是把 import 挪进同一个 effect。

- [ ] **Step 5: 改 `MarkdownRenderer.tsx` 的 katex**

katex 的 `renderToString` 是同步的，动态 import 会让渲染路径变 async。处理方式：把含数学公式的块抽成一个 `<MathBlock tex={...} />` 子组件，由它自己做 `await import('katex')` 并渲染。CSS 副作用 import 移到同一个子组件里。

- [ ] **Step 6: 跑测试确认通过**

```bash
cd desktop && bun run test -- --run src/components/chat/MermaidRenderer.test.tsx src/components/markdown/MarkdownRenderer.test.tsx
```

预期：PASS 数 ≥ Step 1。

- [ ] **Step 7: 验证入口 chunk 真的瘦了**

```bash
cd desktop && bun run build && ls -la dist/assets/ | head -20
```

找出入口 chunk（最大的那个 `.js`），与 Task 1 Step 4 记录的对比。把差值写进「实测记录」。

- [ ] **Step 8: 给 mobile 契约加 gate**

`mobile/test/native-contract.test.ts` 里加断言：Android WebView 注入的 `EchoFlowMobile` bridge 与 `WebSocket` patch 的契约（方法名、消息形状）与 `desktop/src` 侧消费方一致。具体做法：从 `desktop/src` 里 grep 出真实的消费点，把它们固定成测试里的期望值。

**若发现契约没有单一来源**（两边各写一份字符串），这是本次的发现，不要顺手重构——记录下来作为后续项。

- [ ] **Step 9: 跑 gate**

```bash
bun run check:desktop && cd mobile && bun run check
```

预期：都 PASS。

- [ ] **Step 10: Commit**

```bash
git add desktop/src/components/chat/MermaidRenderer.tsx desktop/src/components/markdown/MarkdownRenderer.tsx desktop/src/components/chat/MermaidRenderer.test.tsx mobile/test/native-contract.test.ts
git commit -m "perf(desktop): lazy-load mermaid and katex so the H5 bundle stays small

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### 实测记录

（实现过程中填写，不要预填）

| 步骤 | 项目 | 字节 | 备注 |
|---|---|---|---|
| T1 S1 | linux-unpacked 基线 | | 改造前 |
| T1 S4 | + electronLanguages + 否定 glob | | |
| T4 S6 | + dist 移出 asarUnpack | | |
| T7 S7 | H5 入口 chunk | | 与 T1 S4 的入口 chunk 对比 |

### 已知未做（交接给后续）

- `Sidebar.tsx` 2528 / `ProviderSettings.tsx` 2451 / `GeneralSettings.tsx` 2002 的拆分：Task 5 的方法论已确立，照做即可。
- 31 个手写浮层的逐个统一：受 spec E12 约束，一次一个。
- sharp / ngrok 平台变体去重（spec E15）：收益 ~28MB，需按 electron-builder target 而非 host 裁剪，涉及 CI matrix，单独一项。
- Tauri v2 mobile spike：观察项，触发条件见 spec D4。

---

<a id="plans-2026-11-02-desktop-design-system-boundaries"></a>

## Desktop design-system boundaries

来源：`plans/2026-11-02-desktop-design-system-boundaries.md`。

### Status

This is an audit and implementation boundary plan, not a component migration
checklist. The working tree already contains unrelated changes across desktop,
server, adapters, native code, scripts, and docs. Treat that state as the
baseline; do not attribute or overwrite those changes.

### Source-of-truth boundary

- `DESIGN.md` owns product-wide visual principles, page roles, material roles,
  state meaning, and consistency decisions.
- `desktop/src/theme/globals.css` owns theme source values and semantic tokens.
- `desktop/src/components/AGENTS.md` owns component selection, placement,
  implementation, accessibility, localization, and test contracts.
- Component files and tests own behavior and API contracts.
- `desktop/docs/redesign-paper-ink-seal.md` and
  `desktop/docs/component-library-plan.md` are historical context, not current
  implementation authority.

Do not duplicate component APIs, token values, or historical measurements in
`DESIGN.md`.

### Current evidence snapshot

The following are source counts, not visual defects and not migration targets:

| Surface | Current source signal | Interpretation |
|---|---:|---|
| Native `<button>` | 207 | Includes domain rows, tabs, trees, grids, drag/window controls, and feature actions; inspect semantics before changing |
| Native `<input>`, `<textarea>`, `<select>` | 64 | Separate by field semantics; do not create one generic field wrapper by count |
| Shared `Button` / `IconButton` | 471 usages | Mature primitives already cover common actions |
| Shared `Input` / `TextArea` / `SelectField` / `SearchField` | 105 usages | Existing field primitives should be adopted opportunistically |
| Shared `Badge` | 51 usages | Existing status/count primitive; state-specific rows may still need local structure |
| Shared `Card` | 26 usages | Use for distinct repeated items or framed tools, not every section |
| Shared `Modal` | 17 usages | Keep dialog semantics and content ownership explicit |

Counts were produced from production `.tsx` source with tests excluded. They
are approximate adoption signals and must be refreshed before any migration.

### Candidate matrix

A candidate is eligible for extraction or adoption work only when all of these
are true:

1. At least two real production consumers share the same semantic behavior.
2. The repeated contract includes keyboard, focus, disabled, localization,
   theme, and touch behavior where applicable.
3. The boundary does not require a second store, API, routing, permission
   payload, or state machine.
4. The existing interaction can be preserved and protected by focused tests.
5. The candidate has a clear owner in `ui`, `composite`, or its feature area.

| Candidate family | Evidence | Provisional boundary | Decision |
|---|---|---|---|
| Generic buttons and icon actions | `Button`/`IconButton` have mature APIs and broad use | `components/ui` | Adopt existing primitives; add a variant only for a repeated generic behavior |
| Single-line, multi-line, select, and search fields | Existing `Input`, `TextArea`, `SelectField`, and `SearchField` cover distinct semantics | `components/ui` | Audit adoption by semantic field type; do not merge into a universal `Field` |
| Status and count presentation | `Badge` and `StatusDot` already provide shared primitives | `components/ui` | Extend only for repeated state semantics; preserve text/icon alternatives to color |
| Dialog and anchored floating surfaces | `Modal`, `ActionDialog`, `ConfirmDialog`, `Dropdown`, `Tooltip`, `useDismissable`, and `useAnchoredPosition` exist | `components/ui` plus hooks | Prefer adoption; unify only shared behavior such as dismissal or focus, not content-specific layouts |
| Paper/Ink/Seal materials | Repeated visual roles span feature components but are not proven to share one behavior API | `DESIGN.md` plus existing tokens | Keep as semantic guidance first; do not create empty wrapper components such as `PaperPanel` or `SealCard` |
| Execution-state spine | Tool rows, Activity, navigation, and Permission have different owners and current state inputs | feature/composite display logic | Define a pure presentation mapping only after current state signals are traced; do not create a second store |
| Tool row/card | `ToolCallBlock` already supports row/card and content types have different reading needs | `components/chat` | Preserve row/card distinction; do not convert all tool calls or extract a generic content card |
| Permission actions | Permission and plan-mode actions carry product-specific payloads and consequences | `components/chat` | Keep domain-owned; share only token/state display helpers after behavior is proven |
| Sidebar, tabs, trees, grids, task rows, trace details | Similar markup does not imply the same keyboard or state contract | feature areas | Explicitly do not extract into generic UI primitives |

### Audit method before implementation

For each candidate under consideration, record:

- exact production importers and call count;
- semantic role and whether consumers agree on behavior;
- store/API/router/permission coupling;
- keyboard, focus, Escape, outside-dismiss, and ref requirements;
- localization and CJK/long-label behavior;
- six-theme token and contrast behavior;
- 320px touch/H5 behavior and 44px target requirements;
- existing tests and the smallest missing regression test;
- owner directory and whether the current primitive can be adopted without an API change.

Source counts alone cannot establish a visual defect. A visible change requires
rendered evidence in the relevant themes and viewport sizes.

### Implementation order

1. Reconcile `DESIGN.md` with current tokens, tests, and representative surfaces.
2. Refresh this matrix from the current worktree before choosing a candidate.
3. Select one low-risk adoption slice, preferably an existing primitive with
   stable behavior and multiple consumers.
4. Add or strengthen the behavior contract before changing callers.
5. Run the focused desktop test, then `bun run check:impact` and the selected
   desktop gate. For permission or tool rendering, run the desktop UI smoke
   path when available.
6. Use a real gallery or browser/desktop path for visible changes; cover six
   themes and a narrow viewport and record the evidence.
7. Reassess the matrix before selecting another slice.

### Explicit non-goals

- No mechanical replacement of all native controls.
- No global CSS rewrite or global transparency.
- No new glass dependency or Electron vibrancy requirement.
- No generic wrapper for every Paper, Ink, or Seal surface.
- No extraction of chat messages, tool blocks, permission blocks, tabs, menus,
  trees, grids, workspace file/diff surfaces, trace trees/details, market cards,
  or task rows solely because their markup repeats.
- No changes to stores, APIs, routes, permission payloads, or state models as
  part of a visual/component-boundary pass.

---

<a id="plans-2026-11-02-settings-reorg"></a>

## 设置页重组 Implementation Plan

来源：`plans/2026-11-02-settings-reorg.md`。

**Goal:** 把当前工作树中的桌面设置页分成 5 组导航，从「通用」拆出「网络」「数据与存储」两个 tab，并把 Trace 采集开关并入 Trace 页。

**Architecture:** tab id 只增不改：新增 `network`、`data`，当前 `SettingsTab` 中的 id 全部保留，旧 localStorage 值照常恢复，无需迁移。`SettingsTab` 类型改为由 `SETTINGS_TABS` 数组推出，左栏由一个分组常量渲染，一条测试锁住「数组里每个 id 在左栏恰好出现一次」。区块搬迁是剪切 JSX 加搬走它独占的 state、effect、handler 和确认框，行为和文案不变。

**Tech Stack:** React + TypeScript、zustand（`uiStore`、`settingsStore`）、Vitest + Testing Library、i18n 五语言文件（`en` / `zh` / `zh-TW` / `jp` / `kr`）。

**Spec:** 本会话的分析结论（方案 B），没有单独的 spec 文件。决定记在下面的 Rulings。

### Rulings

- 拆出 `network` 和 `data`，「Agent 行为」类区块留在「通用」。理由：网络和数据存储是被跨页跳转（语音页「修改代理」）和不可逆操作（删会话、换数据目录）牵动的两块，拆出来收益最大；Agent 行为区块和 H5 的 `H5GeneralSettings`、斜杠命令 `/config` 都对应「通用」，拆开会让两端对不上。代价：「通用」仍有约 15 个区块，以后要拆再加 `agent` id，同样不需要迁移。
- Trace 采集开关并入 Trace 页头，删掉 `openTraceCaptureSettings`。理由：开关和它控制的列表在同一页；`traceNavigation.ts:17` 的注释本身就在解释这种割裂。代价：Trace 页多一个开关组件。
- `/config`、`/settings` 继续指向 `general`（`components/chat/composerUtils.ts:56`），不做改动。
- 「终端」tab 不移出设置页：Windows 的启动 Shell 偏好在这里（`TerminalSettings.tsx:525`）；当前任务只改分组，不调整 tab 所属入口。
- `proxyManagedSettingsWarning` 提示条留在「通用」顶部：它讲的是 settings.json 被 CC Switch 覆盖（`zh.ts:2379`），和网络代理无关。
- i18n key 不改名：Trace 页直接复用 `settings.general.trace*` 这组 key，避免五语言文件的无谓改动。

### 左栏最终结构

| 分组 key | zh | tab（顺序固定） |
| --- | --- | --- |
| `settings.navGroup.models` | 模型与运行 | providers、runtime |
| `settings.navGroup.preferences` | 偏好 | general、network、data、voice、pets |
| `settings.navGroup.capabilities` | 能力扩展 | agents、skills、plugins、mcp、memory、computerUse |
| `settings.navGroup.access` | 远程接入 | h5Access、adapters |
| `settings.navGroup.tools` | 工具与观测 | terminal、activity、trace、diagnostics |
| 底部分隔线下，无标题 | — | about |

图标变化：`mcp` 由 `dns` 改为 `hub`（与 providers 不再重复）；新增 `network` 用 `lan`，`data` 用 `database`。其他图标不变。

### 新增 i18n key（五个语言文件都加）

| key | zh | en | zh-TW | jp | kr |
| --- | --- | --- | --- | --- | --- |
| `settings.tab.network` | 网络 | Network | 網路 | ネットワーク | 네트워크 |
| `settings.tab.data` | 数据与存储 | Data & Storage | 資料與儲存 | データと保存 | 데이터 및 저장소 |
| `settings.navGroup.models` | 模型与运行 | Models & Runtime | 模型與執行環境 | モデルとランタイム | 모델 및 런타임 |
| `settings.navGroup.preferences` | 偏好 | Preferences | 偏好 | 環境設定 | 환경설정 |
| `settings.navGroup.capabilities` | 能力扩展 | Capabilities | 能力擴充 | 機能拡張 | 기능 확장 |
| `settings.navGroup.access` | 远程接入 | Remote Access | 遠端接入 | リモート接続 | 원격 접속 |
| `settings.navGroup.tools` | 工具与观测 | Tools & Activity | 工具與觀測 | ツールと監視 | 도구 및 모니터링 |
| `trace.list.captureSaveFailed` | 保存 Trace 采集设置失败 | Couldn't save the trace capture setting | 儲存 Trace 採集設定失敗 | Trace 収集設定を保存できませんでした | Trace 수집 설정을 저장하지 못했습니다 |

删除的 key（五个语言文件都删）：`trace.list.settings`（Trace 页「设置」按钮随 Task 4 去掉）。

### Global Constraints

- 现有 `SettingsTab` id 一个不改名、不删除。
- 存储键 `echoflow-code-active-settings-tab` 不变，旧值必须照常恢复。
- 不加依赖。TypeScript 2 空格缩进、ESM、无分号。
- 区块搬迁不改文案、不改行为、不改 store；搬走的 JSX 保留原有的 `isTouchH5Document()`、`isDesktopRuntime()` 判断和代码注释。
- 已有测试只允许改「点哪个 tab 进入」，断言内容不改。被搬走区块的断言整条移到新页面所在的 describe，不删。
- 不碰 root `src/`、`desktop/electron/`、H5 页面（`H5Settings.tsx`、`H5GeneralSettings.tsx`）。
- 只暂存本计划列出的文件；工作区里其他人的改动不动。

### Review Focus

1. 老版本存下的 tab 值（如 `general`、`trace`）升级后必须照常打开对应页；未知值回退到 `providers`。由 Task 1 的恢复测试锁住。
2. 新加 tab 却漏进左栏、重复出现、分组错位或顺序错误。由 Task 1 的逐 ID、逐组顺序和 about 分隔位置测试锁住。
3. 网络页切走再切回时，未保存草稿丢弃且已保存代理值仍从 store 恢复。由 Task 2 的测试覆盖。
4. 数据页的删会话确认框：取消后存储值不变，失败时错误显示在框内。原有测试搬到 Task 3 后必须照原样通过。
5. Trace 开关保存失败：开关回到原状态，并弹出错误 toast，列表徽标不变。由 Task 4 的测试覆盖。

---

### 开工前

- [ ] **Step 0: 记录工作区基线**

Run: `git status --short --branch`
本次只读复核时，工作树已有大量未提交改动；其中 `desktop/src/pages/Settings.tsx`、`desktop/src/stores/uiStore.ts` 和五个 locale 文件会与本计划修改相交，且 `ConfigGeneratorPage.tsx` 已被删除并从 `SettingsTab`、`Settings.tsx` 移除。开始实施前重跑 `git status --short --branch` 和目标文件 diff，逐 hunk 确认当前改动归属，并请维护者明确重叠 hunk 是本任务可承载的基线还是应等待其先完成；未明确前不得编辑重叠文件。若无法可靠区分 hunk，暂停该文件，不得改用重置、换工作树或覆盖方式绕过。不得恢复配置生成器或覆盖现有改动。提交时只暂存本计划新增的 hunk。

---

#### Task 1: 单一 tab 来源 + 左栏分组

**Files:**
- Modify: `desktop/src/stores/uiStore.ts:46-65`（`SETTINGS_TABS`）、`:235-253`（`SettingsTab`）
- Modify: `desktop/src/pages/Settings.tsx:54-98`（左栏和内容区）
- Modify: `desktop/src/i18n/locales/{en,zh,zh-TW,jp,kr}.ts`（加 5 个 `settings.navGroup.*` key）
- Test: `desktop/src/stores/uiStore.test.ts`、`desktop/src/pages/SettingsNavigation.test.tsx`

**Interfaces:**
- Produces: `export const SETTINGS_TABS = [...] as const`（从 `uiStore.ts` 导出）；`export type SettingsTab = typeof SETTINGS_TABS[number]`。
- Produces: `Settings.tsx` 内部常量 `SETTINGS_NAV: ReadonlyArray<{ group: TranslationKey | null; tabs: ReadonlyArray<{ id: SettingsTab; icon: string; label: TranslationKey }> }>`，最后一项 `group: null` 只放 `about`，渲染在分隔线下面。Task 2、3 往这个数组里加条目。
- Produces: 分组标题用 `<h3>` 渲染，外层每组包 `<div role="group" aria-labelledby=...>`；每个 tab 按钮带 `data-settings-tab={tab.id}`，供导航覆盖测试逐 id 核验。

- [ ] **Step 1: 写失败测试**

在 `uiStore.test.ts` 新增独立用例（不嵌套进现有 `describe('uiStore theme handling')`）：

```ts
it('restores every persisted Settings tab id an older build could have written', async () => {
  for (const tab of ['providers', 'general', 'runtime', 'voice', 'h5Access', 'adapters', 'terminal', 'mcp', 'agents', 'skills', 'memory', 'plugins', 'pets', 'computerUse', 'activity', 'trace', 'diagnostics', 'about']) {
    window.localStorage.setItem('echoflow-code-active-settings-tab', tab)
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    expect(useUIStore.getState().activeSettingsTab).toBe(tab)
  }

  window.localStorage.setItem('echoflow-code-active-settings-tab', 'unknown-tab')
  vi.resetModules()
  const { useUIStore } = await import('./uiStore')
  expect(useUIStore.getState().activeSettingsTab).toBe('providers')
})
```

在 `SettingsNavigation.test.tsx` 加：

```ts
it('lists every settings tab exactly once, grouped', () => {
  render(<DesktopSettings />)
  const nav = screen.getByTestId('settings-navigation')
  const buttons = within(nav).getAllByRole('button')
  expect(buttons).toHaveLength(SETTINGS_TABS.length)
  expect(buttons.map((button) => button.getAttribute('data-settings-tab')).sort()).toEqual([...SETTINGS_TABS].sort())
  const groups = within(nav).getAllByRole('group')
  expect(groups).toHaveLength(5)
  expect(groups.map((group) => within(group).getAllByRole('button').map((button) => button.getAttribute('data-settings-tab')))).toEqual([
    ['providers', 'runtime'],
    ['general', 'network', 'data', 'voice', 'pets'],
    ['agents', 'skills', 'plugins', 'mcp', 'memory', 'computerUse'],
    ['h5Access', 'adapters'],
    ['terminal', 'activity', 'trace', 'diagnostics'],
  ])
  expect(within(nav).getByRole('group', { name: 'Models & Runtime' })).toHaveTextContent('Runtime management')
  const about = within(nav).getByRole('button', { name: 'About' })
  expect(about).toHaveAttribute('data-settings-tab', 'about')
  expect(groups.some((group) => within(group).queryByRole('button', { name: 'About' }) !== null)).toBe(false)
})
```

（按该文件已有写法 import `DesktopSettings`、`within`、`SETTINGS_TABS`；locale 设为 `en`。）

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && bun run test -- --run src/stores/uiStore.test.ts src/pages/SettingsNavigation.test.tsx`
Expected：恢复测试 PASS（它锁住的是现状，用来防回归）；分组测试 FAIL，原因是 `SETTINGS_TABS` 没有导出，或找不到 `group`。

- [ ] **Step 3: 实现**

- `uiStore.ts`：给 `SETTINGS_TABS` 加 `export`，`SettingsTab` 改成从数组推导，删掉手写的 union。`isSettingsTab` 不用改。
- `Settings.tsx`：用 `SETTINGS_NAV` 替换左栏里 18 行写死的 `TabButton`，按上面「左栏最终结构」表排列（此时还没有 network/data）。分组标题样式：`px-3 pt-3 pb-1 text-[11.5px] font-medium text-[var(--color-text-tertiary)]`，第一组不加 `pt-3`。mcp 的图标改成 `hub`。内容区的 `activeTab === ...` 条件链保持原样。
- 五个 locale 文件：加 5 个 `settings.navGroup.*`，取值照「新增 i18n key」表。

- [ ] **Step 4: 运行，确认通过**

Run: `cd desktop && bun run test -- --run src/stores/uiStore.test.ts src/pages/SettingsNavigation.test.tsx src/__tests__/petSettingsNavigation.test.tsx src/__tests__/generalSettings.test.tsx src/i18n`
Expected：全部 PASS。`generalSettings.test.tsx:1448,1460` 断言的是「Token 用量在诊断之上」「Trace 在两者之间」，新顺序里 activity → trace → diagnostics 仍然成立。

- [ ] **Step 5: 类型检查**

Run: `cd desktop && bun run lint`
Expected：退出码 0。

- [ ] **Step 6: Commit**

```bash
git add -p desktop/src/stores/uiStore.ts desktop/src/stores/uiStore.test.ts desktop/src/pages/Settings.tsx desktop/src/pages/SettingsNavigation.test.tsx desktop/src/i18n/locales
git commit -m "feat(desktop): group the settings rail and derive tab ids from one list"
```

---

#### Task 2: 「网络」tab

**Files:**
- Create: `desktop/src/pages/settings/NetworkSettings.tsx`
- Modify: `desktop/src/pages/settings/GeneralSettings.tsx`（剪走 :1352-1617 三个区块及其独占代码）
- Modify: `desktop/src/stores/uiStore.ts`（`SETTINGS_TABS` 在 `general` 后面插入 `'network'`）
- Modify: `desktop/src/pages/Settings.tsx`（`SETTINGS_NAV` 偏好组插入 `{ id: 'network', icon: 'lan', label: 'settings.tab.network' }`，内容区加 `activeTab === 'network' && <NetworkSettings />`）
- Modify: `desktop/src/pages/settings/VoiceInputSettings.tsx:248`（`'general'` 改为 `'network'`）
- Modify: 五个 locale 文件（加 `settings.tab.network`）
- Test: `desktop/src/__tests__/generalSettings.test.tsx`、`desktop/src/pages/settings/VoiceInputSettings.test.tsx:517-523`

**Interfaces:**
- Consumes: Task 1 的 `SETTINGS_NAV` 和 `SETTINGS_TABS`。
- Produces: `export function NetworkSettings(): JSX.Element`，无 props。

**要搬的东西**（从 `GeneralSettings.tsx` 剪走，`GeneralSettings` 里不再保留任何引用）：
- JSX：网络 :1352-1501、WebFetch 预检 :1502-1524、WebSearch :1525-1617。
- 常量：`NETWORK_TIMEOUT_MIN_SECONDS`、`NETWORK_TIMEOUT_STEP_SECONDS`（:51-52）；组件内的 `WEB_SEARCH_MODES`、`NETWORK_PROXY_MODES`（:309、:317）。
- state：`webSearchDraft`、`networkDraft`、`networkTimeoutInput`、`networkSaveError`、`isSavingNetwork`（:131-135），以及派生值 `webSearchDirty`。
- effect：`webSearch → webSearchDraft`（:195-197）、`network → networkDraft/...`（:207-211）。
- handler：`parsedNetworkTimeoutSeconds`、`setNetworkTimeoutSeconds`、`saveNetworkSettings`（:446-533 中的网络部分）。
- store 字段：`skipWebFetchPreflight`、`setSkipWebFetchPreflight`、`webSearch`、`setWebSearch`、`network`、`setNetwork`。
- import：`NETWORK_TIMEOUT_MAX_SECONDS`、`isValidHttpProxyUrl`、`NetworkProxyMode`、`WebSearchMode`，以及只被这三块用到的 UI 组件。搬完跑 lint，靠 `no-unused-vars` 和 tsc 确认两边的 import 都干净。
- 页面开头加 `<SettingsPageHeader title={t('settings.tab.network')} />`，和 Runtime/MCP 页一致。原区块里的 `<h2>` 保持不动。第一个区块去掉 `mt-8`，让标题与页头贴齐。

- [ ] **Step 1: 改测试入口（先让测试失败）**

`generalSettings.test.tsx` 里所有断言「网络 / WebFetch 预检 / WebSearch」的用例（:645、:654、:821、:882、:1474，以及 :2338 附近的「saves WebSearch fallback provider settings」「links to WebSearch provider API key dashboards」），把 `fireEvent.click(screen.getByText('General'))` 改成 `fireEvent.click(screen.getByText('Network'))`，断言不动。这样保存行为和外部 API key 链接断言会随整个 WebSearch 区块一起迁移。

还有两条测试要拆：
- `:794`「UI zoom below system notifications」：去掉其中 network 和 webFetch 两个 heading 的位置断言，只保留 notifications → uiZoom。
- `:1682`「checkbox anchored」：从 label 列表里移出 `'Skip WebFetch domain preflight'`，在 Network 页里新建一条同样断言的用例。

`VoiceInputSettings.test.tsx:517`：用例名改为 `'opens the Network tab, where the network proxy lives'`，期望值改为 `'network'`。

新加一条（Review Focus 3）：

```ts
it('reinitializes Network drafts from saved settings after leaving the tab', () => {
  useSettingsStore.setState({ network: { aiRequestTimeoutMs: 120_000, proxy: { mode: 'manual', url: 'http://saved-proxy:8080' } } })
  render(<Settings />)
  fireEvent.click(screen.getByText('Network'))
  expect(screen.getByDisplayValue('http://saved-proxy:8080')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Proxy URL'), { target: { value: 'http://10.0.0.1:1' } })
  fireEvent.click(screen.getByText('General'))
  fireEvent.click(screen.getByText('Network'))
  expect(screen.getByDisplayValue('http://saved-proxy:8080')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('http://10.0.0.1:1')).not.toBeInTheDocument()
})
```

（按钮和输入框的可访问名以 `:821` 那条用例里的实际写法为准。）

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && bun run test -- --run src/__tests__/generalSettings.test.tsx src/pages/settings/VoiceInputSettings.test.tsx`
Expected：FAIL，报错是找不到文本 `Network` 对应的导航按钮，或者期望 `'network'` 实际得到 `'general'`。

- [ ] **Step 3: 实现**

按「要搬的东西」把三块剪进 `NetworkSettings.tsx`，再把 id、导航、i18n、语音页跳转都接上。

- [ ] **Step 4: 运行，确认通过**

Run: `cd desktop && bun run test -- --run src/__tests__/generalSettings.test.tsx src/pages/settings/VoiceInputSettings.test.tsx src/pages/SettingsNavigation.test.tsx src/stores/uiStore.test.ts src/i18n`
Expected：全部 PASS。Task 1 的「每个 id 一个按钮」测试会自动覆盖 `network`。

- [ ] **Step 5: 类型和 lint**

Run: `cd desktop && bun run lint`
Expected：退出码 0。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/pages/settings/NetworkSettings.tsx
git add -p desktop/src/pages/settings/GeneralSettings.tsx desktop/src/stores/uiStore.ts desktop/src/pages/Settings.tsx desktop/src/pages/settings/VoiceInputSettings.tsx desktop/src/pages/settings/VoiceInputSettings.test.tsx desktop/src/__tests__/generalSettings.test.tsx desktop/src/i18n/locales
git commit -m "feat(desktop): move proxy, WebFetch and WebSearch into a Network settings tab"
```

---

#### Task 3: 「数据与存储」tab

**Files:**
- Create: `desktop/src/pages/settings/DataSettings.tsx`
- Modify: `desktop/src/pages/settings/GeneralSettings.tsx`（剪走会话记录和数据存储两块、三个确认框，以及它们的独占代码）
- Modify: `desktop/src/stores/uiStore.ts`（在 `'network'` 后面插入 `'data'`）
- Modify: `desktop/src/pages/Settings.tsx`（偏好组的 network 后面插入 `{ id: 'data', icon: 'database', label: 'settings.tab.data' }`，并在内容区加上对应渲染）
- Modify: 五个 locale 文件（加 `settings.tab.data`）
- Test: `desktop/src/__tests__/generalSettings.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `SETTINGS_NAV` 和 `SETTINGS_TABS`。
- Produces: `export function DataSettings(): JSX.Element`，无 props。

**要搬的东西：**
- JSX：会话记录区块，包括它前面的注释和外层的 `{!isTouchH5Document() && (...)}`（:1618-1695）；数据存储区块，包括外层的 `{isDesktopRuntime() && (...)}` 和其中的旧版导入（:1696-1852）。
- 确认框：modeSwitch（:1853-1878）、legacyMigration（:1879-1896）、sessionRetention（:1915-1945）。autoDream 的确认框（:1897-1914）留在 `GeneralSettings`。
- state：modeSwitch、pendingMode、pendingPortableDir、portableDirDraft、modeActionRunning、modeError、legacyMigration*（共 5 个）、retention*（共 7 个）这几组 state，以及 `retentionPreviewRequestId` ref（行号见 :141-164、:169）。还有派生值 `activeConfigDir`、`configDirSource`、`isEnvironmentConfigDir`。
- effect：`cleanupPeriodDays → retentionInput`（:213-215）、`fetchAppMode`（:233-236）、`portableDir → draft`（:238-240）。
- handler：`parsedRetentionDays`、`openRetentionConfirm`、`closeRetentionConfirm`、`confirmRetentionChange`、`openPortableDirPicker`、`openModeSwitchConfirm`、`closeModeSwitchConfirm`、`checkLegacyMigration`、`confirmLegacyMigration`、`confirmModeSwitch`。
- store 字段：`cleanupPeriodDays`、`setCleanupPeriodDays`、`appMode`、`appModeRequiresRestart`、`fetchAppMode`、`setAppMode`。
- 这两块原来就有 `border-t pt-8` 分隔线，保留不动。页头写法和 Task 2 相同，用 `settings.tab.data`。
- 新页面在 H5 触屏和非桌面环境下，两个区块可能都不渲染。这种情况下只显示页头，不额外做处理：在 H5 下 `H5Settings` 本来就不会进入这个 tab（`H5Settings.tsx:12`）。

- [ ] **Step 1: 改测试入口（先让测试失败）**

`generalSettings.test.tsx` 中 :903 到 :1381 之间所有关于会话记录、数据存储和旧版导入的用例，入口统一改成 `fireEvent.click(screen.getByText('Data & Storage'))`。

另外两处要改写：
- :1177「keeps data storage at the bottom of General settings」：改名为 `'puts session history above data storage in Data & Storage'`，断言改为 Session History 的 heading 排在 Data Storage Location 之前。原来那条 Windows 说明文字的断言照旧保留。
- :1163「hides the retention controls on a touch-H5 phone browser」：入口改成 Data & Storage，断言不变。

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && bun run test -- --run src/__tests__/generalSettings.test.tsx`
Expected：FAIL，报错为找不到 `Data & Storage`。

- [ ] **Step 3: 实现**

按「要搬的东西」剪进 `DataSettings.tsx`，再把 id、导航、i18n 接上。

- [ ] **Step 4: 运行，确认通过**

Run: `cd desktop && bun run test -- --run src/__tests__/generalSettings.test.tsx src/pages/SettingsNavigation.test.tsx src/stores/uiStore.test.ts src/pages/settings/GeneralSettingsAutoQuestion.test.tsx src/pages/SettingsOutputStyle.test.tsx src/i18n`
Expected：全部 PASS。后两个测试文件直接渲染 `<GeneralSettings />`，用来证明拆分后剩下的部分仍然能独立工作。

- [ ] **Step 5: 类型和 lint**

Run: `cd desktop && bun run lint`
Expected：退出码 0。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/pages/settings/DataSettings.tsx
git add -p desktop/src/pages/settings/GeneralSettings.tsx desktop/src/stores/uiStore.ts desktop/src/pages/Settings.tsx desktop/src/__tests__/generalSettings.test.tsx desktop/src/i18n/locales
git commit -m "feat(desktop): move session retention and data storage into their own settings tab"
```

---

#### Task 4: Trace 采集开关并入 Trace 页

**Files:**
- Modify: `desktop/src/pages/TraceList.tsx:176-179`（把「设置」按钮换成开关）
- Modify: `desktop/src/pages/settings/GeneralSettings.tsx:1248-1275`（删除 Agent Trace 区块，以及只被它用到的 `traceCapture`、`setTraceCaptureEnabled`）
- Modify: `desktop/src/__tests__/generalSettings.test.tsx:1703-1717`（删除「不离开通用页即可停用 Trace」用例；行为由 TraceList 用例覆盖）
- Modify: `desktop/src/lib/traceNavigation.ts:17-21`（删除 `openTraceCaptureSettings` 和它上面的注释）
- Modify: 五个 locale 文件（加 `trace.list.captureSaveFailed`，删 `trace.list.settings`）
- Test: `desktop/src/pages/TraceList.test.tsx`、`desktop/src/lib/traceNavigation.test.ts:36-41`、`desktop/src/__tests__/generalSettings.test.tsx:1682`

**Interfaces:**
- Consumes: `useSettingsStore` 的 `traceCapture: TraceCaptureSettings` 和 `setTraceCaptureEnabled(enabled: boolean): Promise<void>`。后者失败时会自己回滚再抛错（`settingsStore.ts:602-612`）。
- Produces: 无新导出。

**实现要点：**
- 开关用 `@/components/ui/Switch`，传 `label={t('settings.general.traceEnabled')}`、`description={traceCapture.enabled ? t('settings.general.traceHintOn') : t('settings.general.traceHintOff')}`、`size="sm"`，放在页头右侧按钮组原来「设置」按钮的位置。
- onChange 时先 `await setTraceCaptureEnabled(v)`，成功后调 `load({ silent: true })` 刷新徽标；失败时 `addToast({ type: 'error', message: t('trace.list.captureSaveFailed') })`。
- 徽标照旧读 `state.data.settings.enabled`（:165），不改数据源。

- [ ] **Step 1: 写失败测试**

`TraceList.test.tsx` 顶部需从 `../stores/uiStore` 导入 `useUIStore`，并在现有 `vi.mock('../api/traces', ...)` 中加入 `updateSettings: vi.fn()`；当前 fixture `traceList.settings` 已包含 `enabled` 和 `storageDir`，可直接用于 store/API 断言。测试使用现有 `Switch` 的 `role="switch"` 和 `aria-labelledby` 名称：

```ts
it('turns trace capture off from the list header and refreshes the badge', async () => {
  vi.mocked(tracesApi.updateSettings).mockResolvedValue({ ...traceList.settings, enabled: false })
  vi.mocked(tracesApi.list).mockResolvedValueOnce(traceList).mockResolvedValueOnce({ ...traceList, settings: { ...traceList.settings, enabled: false } })
  useSettingsStore.setState({ traceCapture: { ...traceList.settings, enabled: true } })
  render(<TraceList />)
  await screen.findByText('Collecting')
  fireEvent.click(screen.getByRole('switch', { name: 'Collect agent traces' }))
  await waitFor(() => expect(tracesApi.updateSettings).toHaveBeenCalledWith({ enabled: false }))
  await waitFor(() => expect(useSettingsStore.getState().traceCapture.enabled).toBe(false))
  expect(await screen.findByText('Paused')).toBeInTheDocument()
})

it('keeps the switch on and reports the error when saving fails', async () => {
  vi.mocked(tracesApi.updateSettings).mockRejectedValue(new Error('boom'))
  useSettingsStore.setState({ traceCapture: { ...traceList.settings, enabled: true } })
  render(<TraceList />)
  await screen.findByText('Collecting')
  fireEvent.click(screen.getByRole('switch', { name: 'Collect agent traces' }))
  await waitFor(() => expect(tracesApi.updateSettings).toHaveBeenCalledWith({ enabled: false }))
  await waitFor(() => expect(useUIStore.getState().toasts.at(-1)?.message).toBe("Couldn't save the trace capture setting"))
  expect(useSettingsStore.getState().traceCapture.enabled).toBe(true)
  expect(screen.getByRole('switch', { name: 'Collect agent traces' })).toBeChecked()
  expect(screen.getByText('Collecting')).toBeInTheDocument()
})
```

API 的 `updateSettings` 由 `settingsStore.setTraceCaptureEnabled` 调用；失败会回滚 store 并抛出错误。若通过 `<ToastViewport />` 验证可见 toast，测试需按本文件现有 setup 渲染 viewport；上例直接断言 `useUIStore` 的 toast 状态，避免假设 TraceList 自己渲染全局 toast。fixture 与 switch 的字段、可访问名已由当前源码确认。

`traceNavigation.test.ts:36-41`：删掉 `sends the capture switches to General` 这条用例，并删掉 :3 处的 import。

`generalSettings.test.tsx:1682`：从 label 列表里移出 `'Collect agent traces'`。

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && bun run test -- --run src/pages/TraceList.test.tsx`
Expected：FAIL，找不到 `switch` `Collect agent traces`。

- [ ] **Step 3: 实现**

按「实现要点」改 `TraceList.tsx`。在 `GeneralSettings.tsx` 删掉 Trace 区块和两个 store 字段，在 `traceNavigation.ts` 删掉 `openTraceCaptureSettings`，在 locale 文件里加一个 key、删一个 key。

- [ ] **Step 4: 运行，确认通过**

Run: `cd desktop && bun run test -- --run src/pages/TraceList.test.tsx src/lib/traceNavigation.test.ts src/__tests__/generalSettings.test.tsx src/i18n`
Expected：全部 PASS。

- [ ] **Step 5: 确认没有遗留引用**

Run: `rg -n "openTraceCaptureSettings|trace\.list\.settings'" desktop/src`
Expected：无输出。

- [ ] **Step 6: 类型和 lint**

Run: `cd desktop && bun run lint`
Expected：退出码 0。

- [ ] **Step 7: Commit**

```bash
git add -p desktop/src/pages/TraceList.tsx desktop/src/pages/TraceList.test.tsx desktop/src/pages/settings/GeneralSettings.tsx desktop/src/lib/traceNavigation.ts desktop/src/lib/traceNavigation.test.ts desktop/src/__tests__/generalSettings.test.tsx desktop/src/i18n/locales
git commit -m "feat(desktop): toggle trace capture from the Trace list instead of General"
```

---

#### Task 5: 用户文档跟上新结构

**Files:**
- Modify: `docs/desktop/settings.md`（:10「左边 19 个分栏，顺序固定」改成按分组介绍；「通用」一节里的网络和数据小节分别挪成 `## 网络`、`## 数据与存储`；Trace 开关位置改为「Trace 页」；应用更新代理仍和「网络」不同；「配置生成器」一节已随用户现有改动删除，不恢复）
- Modify: `docs/en/desktop/settings.md`（同上，英文；同步修正语音识别下载说明中的 `Network proxy from General` → `Network`）
- Modify: `docs/desktop/settings.md:85`（「下载请求走「通用」里的网络代理」改为「走「网络」里的代理」）
- `docs/en/mobile/index.md` 保持不改：第 34 行描述的是在桌面端 Settings 中开启 H5 Access；`H5Settings.tsx` 是手机端连接后的设置界面，只显示 Providers 和 General，与桌面端入口不是同一个设置页。
- 不改：`docs/desktop/sessions.md:105`（发送方式）、`docs/desktop/schedule.md:36`（系统通知），这两项仍在「通用」。`docs/start/models.md:148` 写的是运行时在「通用」里，与当前 `Settings.tsx` 中的实际页面位置不符；此为既存错误，单独修正文档时再改，不随本任务扩大范围。
- `site/src/generated/**` 由 site build 生成，不手改。

- [ ] **Step 1: 改文档**

按上面的列表改。设置导航和 General 内容发生变化，按 `docs/AGENTS.md` 重拍 `settings-general.webp`：从本次桌面构建截图并检查无敏感信息，再更新中英文文档实际引用该图的位置。若截图引用的区块已拆分或不再对应 General，不要保留旧世代截图；改用能准确展示新 General 页的截图，并同步更新引用。

- [ ] **Step 2: 文档门禁**

Run: `bun run check:docs`
Expected：退出码 0。这个命令会跑 `npm ci`，不要和其他依赖 root `node_modules` 的检查并行执行。

- [ ] **Step 3: Commit**

```bash
git add docs/desktop/settings.md docs/en/desktop/settings.md
git commit -m "docs: describe the grouped settings rail and the new Network and Data tabs"
```

---

#### Task 6: 收尾验证

- [ ] **Step 1: 桌面门禁**

Run: `bun run check:desktop`
Expected：lint、全部 vitest 和 build 都通过，退出码 0。

- [ ] **Step 2: 影响报告**

Run: `bun run check:impact`
Expected：先读完整报告，再运行报告选出的所有本地门禁；每项都记录 PASS / FAIL / BLOCKED / NOT RUN 和原因，不只补 `check:persistence-upgrade`。若门禁因当前分支审批标签、环境或工具缺失而阻塞，记录明确阻塞和维护者补跑命令；不得把未运行报告为通过。`check:docs` 会跑 npm 安装，需顺序运行，不与依赖 root `node_modules` 的检查并行。

- [ ] **Step 3: 真实界面检查**

用当前会话可用的浏览器自动化工具，或运行 `bun run check:desktop-ui-smoke`，打开设置页，确认以下几点：5 个分组标题都在，左栏宽 195px 时没有文字被截断；网络、数据与存储、Trace 开关都能正常操作；把 localStorage 里的 `echoflow-code-active-settings-tab` 设为 `general` 后刷新，能落在「通用」页。截图放进交接说明。如果这一步做不了，按 AGENTS.md 写明原因，不要说跑过。

- [ ] **Step 4: 交接**

交接内容包括：改动文件、新增和修改的测试、各门禁四态结果（PASS / FAIL / BLOCKED / NOT RUN）、截图或没有截图的原因，以及还剩的风险。剩余风险至少要写明这两点：「通用」页仍有约 15 个区块；`docs/start/models.md:148` 与现状不符。

---

<a id="specs-2026-05-09-h5-access-design"></a>

## H5 Access Design

来源：`specs/2026-05-09-h5-access-design.md`。

### Goal

Add a simple H5 access mode for personal and team use. A desktop user can enable H5 access in Settings, generate a token, expose the frontend/backend through LAN or their own reverse proxy, and open the same chat experience from a phone browser.

This is not a public multi-tenant product login system. The design intentionally keeps the first version small while avoiding accidental exposure of the existing desktop API.

### Non-Goals

- Do not change the default desktop/Tauri local flow.
- Do not add account login, OAuth, user management, or short-lived session exchange in the first version.
- Do not make every desktop-only feature mobile-first in the first version.
- Do not expose unauthenticated remote API access.

### Current Context

The desktop frontend is already a Vite SPA under `desktop/`. In non-Tauri browser mode, `desktop/src/lib/desktopRuntime.ts` accepts `?serverUrl=` and points the API client at that backend. The backend in `src/server/index.ts` can bind to a configured host and already requires auth for non-localhost hosts. The missing pieces are productized H5 settings, H5 token handling in the frontend, configurable CORS, WebSocket token support, and mobile-safe layout.

### Product Shape

Settings gets a new `H5 Access` section:

- Enable/disable H5 access.
- Generate a strong random token when enabling.
- Show masked token with copy and regenerate actions.
- Show an H5 URL that can be copied.
- Allow an optional public frontend/base URL override for users running a reverse proxy.
- Show a concise safety note: this is intended for LAN or self-managed reverse proxy use, and anyone with the token can operate the exposed chat surface.

The H5 browser entry shows a connection screen when no token is stored:

- Server URL field.
- Token field.
- Connect button.
- Clear, non-secret error messages for unreachable server, bad token, CORS block, and WebSocket failure.

After connection, the phone opens the existing chat product with a mobile-optimized shell.

### Architecture

#### Server Configuration

Persist H5 settings in the existing cc-haha managed settings path (`~/.claude/cc-haha/settings.json`), preserving unknown fields and keeping the user-owned `~/.claude/settings.json` untouched:

```ts
type H5AccessSettings = {
  enabled: boolean
  tokenHash: string | null
  tokenPreview: string | null
  allowedOrigins: string[]
  publicBaseUrl: string | null
}
```

Store only a hash of the token. The raw token is shown only when generated or copied immediately after regeneration. If the user loses it, they regenerate it.

Server behavior:

- Localhost desktop mode remains unchanged.
- When H5 is disabled, remote browser origins are not allowed by CORS.
- When H5 is enabled, configured `allowedOrigins` can pass CORS.
- Remote `/api/*`, `/proxy/*`, and `/ws/*` require `Authorization: Bearer <h5-token>` or a WebSocket `token` query parameter.
- `/health` remains useful for local desktop startup, but when the request is non-local and H5 is enabled it should return only minimal service status and no sensitive diagnostics.

#### Client Runtime

Extend the existing browser-mode startup:

- Keep Tauri mode using `get_server_url`.
- In browser mode, read `serverUrl` from query string or localStorage.
- Read H5 token from localStorage.
- If missing or invalid, render the H5 connection screen.
- Add the token to REST requests through the central API client.
- Add the token to WebSocket connections with a query parameter.
- Fix WebSocket URL construction so `https://` backends become `wss://`, not an invalid `wss` derived by string accident.

#### API Surface

First version grants token holders the same core desktop API needed for chat:

- sessions list/detail/messages/create/delete/rename
- chat WebSocket
- slash commands and inspection endpoints used by the chat UI
- settings reads needed for model and permission controls
- provider/model selection paths used by the composer

High-risk or desktop-native surfaces should be hidden or disabled in the H5 UI unless they are already required by chat:

- terminal
- doctor repair
- native updater
- native file dialogs
- broad filesystem browsing
- plugin, MCP, and skill management

The server can still protect these with the same H5 token in the first implementation, but the UI should not present them as primary H5 workflows until mobile handling and risk review are done.

### Mobile UI Design

The H5 shell should be mobile-first without rewriting the desktop UI.

#### Layout Rules

- Replace mobile `h-screen` usage with a `100dvh`/safe-area shell.
- Add a viewport hook or CSS breakpoint around 768px.
- On mobile, sidebar becomes a drawer with a backdrop instead of a fixed rail.
- Main chat is a single column.
- Workspace and terminal split panels are not shown as side-by-side panes on mobile; first version hides them from the mobile chat shell.
- Keep desktop layout unchanged above the breakpoint.

#### Chat Priority

The first version optimizes:

- session list access
- open/create session
- message history
- streaming assistant response
- send/stop
- attachments if existing browser file input works safely
- permission confirmation dialogs
- model and permission selectors with mobile-safe popovers

#### Touch And Typography

- Primary icon buttons on mobile use at least 44px hit targets.
- Menu rows use enough vertical padding for touch.
- Body text uses a readable 16px baseline where practical.
- Tiny metadata can remain smaller, but it must not be required to operate the chat.
- Fixed-width popovers such as permission mode selectors become full-width-with-margin sheets on mobile.

### Error Handling

H5 startup errors should be actionable:

- Server unreachable: show the current server URL and suggest checking LAN/reverse proxy.
- Unauthorized: ask the user to re-enter token.
- CORS blocked: explain that the backend has not allowed this H5 origin.
- WebSocket failed: show REST health status separately from chat socket status.
- H5 disabled: show that H5 access must be enabled in desktop Settings.

Do not show raw secrets in diagnostics or error text.

### Security Notes

- H5 access is opt-in.
- Token must be generated with high entropy.
- Store only a hash server-side.
- Token regeneration invalidates the old token.
- CORS must be explicit, not wildcard.
- The default bind remains localhost.
- Documentation should recommend a reverse proxy with TLS for domain access.
- This feature is suitable for personal/team controlled environments, not public internet exposure without additional controls.

### Implementation Boundaries

Implementation should be split into independent lanes:

1. Server and persistence: H5 settings, token hash, auth validation, CORS origin handling, WebSocket token handling.
2. Desktop settings UI: enable switch, token generation/reset/copy, URL display, safety note.
3. H5 browser runtime: connection screen, localStorage token/server URL, REST and WebSocket auth injection.
4. Mobile shell: drawer sidebar, `dvh` shell, chat column constraints, mobile popover/sheet fixes.
5. Tests and verification: server auth/CORS tests, API client/WebSocket tests, settings UI tests, mobile browser smoke.

Each lane should avoid changing unrelated desktop behavior. Desktop/Tauri tests must remain green.

### Verification Plan

Narrow checks:

- Server tests for H5 enabled/disabled, good token, bad token, CORS allowed/disallowed, WebSocket token accepted/rejected.
- Desktop API client tests for Authorization injection and no-token local behavior.
- WebSocket client tests for `https -> wss` and token query parameter.
- Settings UI tests for enable/regenerate/copy state.
- Mobile layout tests or browser smoke at 390x844 and 430x932.

Full checks before handoff:

- `cd desktop && bun run test`
- `bun run check:server`
- `bun run check:desktop`
- `bun run verify` when the targeted lanes are green or report any pre-existing quality gate blocker explicitly.

Manual smoke:

1. Start backend locally with default localhost and verify desktop still works.
2. Enable H5 in Settings and generate token.
3. Start backend bound for LAN or via a local reverse-proxy equivalent.
4. Open H5 URL in browser/mobile viewport, enter token, list sessions, create/open session, send a message, stop a running turn, reconnect.

### Rollout

Ship as opt-in beta wording in Settings. Keep H5 disabled by default. The first version should document LAN and reverse-proxy setup, but should not promise production public hosting.

---

<a id="specs-2026-05-13-desktop-open-project-targets-design"></a>

## Desktop Open Project Targets Design

来源：`specs/2026-05-13-desktop-open-project-targets-design.md`。

### Summary

Add a Codex app style project-open control to the desktop top-right toolbar. The control opens the project directory in a detected local IDE/editor or in the platform file manager. It must use the same directory the agent is actually working in, including a materialized session worktree, so the user never opens a different checkout from the one Claude is editing.

### Goals

- Show a compact top-right toolbar button modelled after the Codex app UI: primary app icon plus a dropdown affordance when multiple targets exist.
- Detect common local IDE/editor targets silently and display only installed, openable IDEs.
- Always provide a platform file manager fallback: Finder on macOS, Explorer on Windows, and a generic file manager on Linux if supported.
- Open the current session's effective working directory first. For active repository sessions this means the materialized worktree path when present; otherwise the session cwd/workDir. Before a session starts, use the launch workDir currently selected in the composer.
- Keep this feature independent from Computer Use and from IDE MCP/extension connection state.
- Avoid changing branches, creating worktrees, modifying repo state, or writing persistent user settings.

### Non-Goals

- No external Terminal/iTerm/Warp launch in the first version.
- No custom user-defined open commands.
- No automatic IDE/plugin installation.
- No H5/mobile browser access to local app launching.
- No persistent global preference file in the first version. In-memory cache is enough.

### Current Code Context

- `desktop/src/components/layout/TabBar.tsx` already owns the top-right toolbar area with terminal and workspace-panel buttons.
- `desktop/src/components/shared/RepositoryLaunchControls.tsx` owns the pre-session workDir, branch, and worktree launch controls.
- Active sessions expose working-directory context through session data, `SessionGitInfo`, and the existing `ProjectContextChip` usage in chat surfaces.
- Server-side repository launch logic in `src/server/services/repositoryLaunchService.ts` already distinguishes source repo, requested workDir, and worktree path.
- The current Tauri app already includes `@tauri-apps/plugin-shell` and `shell:allow-open`, but Tauri's current recommendation is the opener plugin for path/file-manager opening. The implementation plan can choose either a server API route or a Tauri command; the preferred design keeps platform detection and launching in the server/native boundary rather than scattering it through UI components.

### Product Behavior

#### Toolbar Control

The top-right toolbar gets a new project-open control before the existing terminal/workspace buttons.

- If at least one IDE/editor is detected, show the highest-priority detected IDE as the primary icon and include a dropdown chevron.
- If no IDE/editor is detected, show the platform file manager icon and behave as a single-click file-manager opener.
- The dropdown only lists detected IDE/editor targets plus the file-manager fallback. It does not show unsupported or missing IDEs.
- The visual style follows the Codex app reference: compact rounded segmented button, icon-first, subtle hover, dropdown menu with app icons and labels.

#### Target Priority

Initial IDE/editor target registry:

- macOS: VS Code, Cursor, Sublime Text, Antigravity, GoLand, PyCharm, Finder.
- Windows: VS Code, Cursor, Sublime Text, GoLand, PyCharm, Explorer.
- Linux: VS Code, Cursor, Sublime Text, file manager fallback if available.

Ordering:

1. Last successfully opened IDE target during this app runtime, if still detected.
2. VS Code.
3. Cursor.
4. Antigravity.
5. Sublime Text.
6. GoLand.
7. PyCharm.
8. File manager fallback.

The first version stores the last successful target only in memory.

#### Effective Path Resolution

The open path must match the agent's active working directory.

Resolution order:

1. Active session materialized worktree path when present.
2. Active session cwd/workDir from session metadata.
3. Active session git workDir if exposed by `SessionGitInfo`.
4. Pre-session launch workDir selected in the composer.
5. No target path: disable the control and show no menu.

The server revalidates the path before launching:

- It must exist.
- It must be a directory.
- It must not require any branch switch or worktree creation.

### Architecture

#### Server API

Add a focused server API surface, tentatively under `src/server/api/open-targets.ts`.

Endpoints:

- `GET /api/open-targets`
  - Returns platform, detected open targets, file-manager fallback, cache metadata.
  - Performs silent detection and uses a short in-memory cache.
- `POST /api/open-targets/open`
  - Body: `{ targetId: string, path: string }`.
  - Validates the target is currently supported or is the file-manager fallback.
  - Validates the path is an existing directory.
  - Opens the path with the selected target.
  - Returns `{ ok: true, targetId, path }` or a typed error.

The route should be deny-by-default: only known target IDs from the registry are accepted.

#### Target Registry

Create a small registry with one responsibility: platform-specific detection and open command metadata.

Suggested module:

- `src/server/services/openTargetService.ts`

Responsibilities:

- Define target IDs, display names, platform support, icon keys, detection candidates, and open behavior.
- Detect installed/openable targets without requiring Computer Use Python helpers.
- Cache detection results in memory for a short TTL.
- Open the selected target using safe argument arrays, never shell-concatenated strings.

Detection examples:

- macOS:
  - Check common `.app` paths under `/Applications` and `~/Applications`.
  - For VS Code-family apps, also check CLI commands such as `code`, `cursor`, and `antigravity` when available.
  - Finder is always available.
- Windows:
  - Check PATH commands such as `code.cmd`, `cursor.cmd`, `subl.exe`, and JetBrains launcher commands when available.
  - Check common install locations only where cheap and deterministic.
  - Explorer is always available.
- Linux:
  - Check PATH commands for known targets.
  - Use `xdg-open` or platform file manager fallback only when available.

Opening examples:

- IDE/editor: launch known executable/CLI with the directory path as a single argument.
- Finder/Explorer:
  - macOS: `open <path>` or equivalent native opener.
  - Windows: `explorer.exe <path>`.
  - Linux: `xdg-open <path>` when available.

#### Desktop UI

Create a dedicated component rather than expanding `TabBar.tsx` with detection logic.

Suggested files:

- `desktop/src/api/openTargets.ts`
- `desktop/src/stores/openTargetStore.ts`
- `desktop/src/components/layout/OpenProjectMenu.tsx`
- tests next to the component/store or in existing desktop test locations.

Responsibilities:

- `openTargetsApi`: typed API client.
- `openTargetStore`: in-memory target list, loading/error state, short TTL, last successful target for this runtime.
- `OpenProjectMenu`: renders the Codex app style control and dropdown.
- `TabBar`: passes active-session path context into `OpenProjectMenu` and keeps layout ownership.

The component should be disabled outside Tauri/desktop runtime and hidden if no valid path is available.

### Error Handling

- Detection failure: keep Finder/Explorer fallback if platform supports it; do not block the toolbar.
- Open target disappeared after cache: refresh targets once, then show a toast-style error if still unavailable.
- Path missing: show a concise failure message and disable retry until session/path changes.
- Unsupported target ID: server returns 400; UI treats it as stale cache and refreshes.
- Command failure: server returns typed message with stderr redacted to a short detail.

### Testing

Server tests:

- Registry returns only installed/detected IDE targets plus file-manager fallback.
- Missing IDEs are not returned.
- File-manager fallback is returned when no IDE is detected.
- `POST /api/open-targets/open` rejects unknown target IDs.
- `POST /api/open-targets/open` rejects missing or non-directory paths.
- Open command uses argument arrays and never shell-concatenated user paths.

Desktop tests:

- `OpenProjectMenu` shows IDE icon and dropdown when IDE targets exist.
- `OpenProjectMenu` degrades to Finder/Explorer single action when only file-manager fallback exists.
- Missing targets are not rendered.
- `TabBar` renders the control for active session tabs and passes the effective worktree path.
- Store caches target detection and refreshes after TTL or stale-target failure.

Verification:

- Run narrow server tests for open-target service/API.
- Run narrow desktop tests for `OpenProjectMenu`, store, and TabBar integration.
- Run `bun run check:server` and `bun run check:desktop`.
- Run `bun run verify` before final completion unless blocked by unrelated existing failures.

### Risks

- IDE command names differ by installation method, especially JetBrains and Windows. Mitigation: start with known common commands and deterministic app paths, keep fallback always available.
- Tauri shell/open APIs differ from current recommendations. Mitigation: centralize opening server-side first; evaluate Tauri opener plugin only if the implementation needs native path reveal behavior.
- Top-right toolbar can get crowded. Mitigation: compact icon-only control, dropdown only when useful, no text labels in toolbar.

### References

- Tauri Opener plugin docs: https://v2.tauri.app/plugin/opener/
- Tauri Shell plugin docs: https://v2.tauri.app/zh-cn/plugin/shell/

---

<a id="specs-2026-10-26-ui-layer-hardening-design"></a>

## EchoFlow Code UI 层改造设计（不做框架迁移）

来源：`specs/2026-10-26-ui-layer-hardening-design.md`。

- 日期：2026-10-26
- 状态：已批准方向，待实现
- 关联调研：本文件「证据」一节列出的仓库实测数据

### 意图与为什么

维护者提出三个诉求：**写 UI 难受、包太大、想做多平台**，并怀疑应该整体迁移到 Flutter
或更好的框架。

调研结论是：这三个诉求都不是框架问题。把它们当框架问题解，代价是 3-4 人年的 UI 重写、
26k 行 Electron host 重写、117-119 个 IPC channel 重写，且必须正面回答一个 fatal 问题——
Flutter / Compose Multiplatform desktop 都不产出可被 `src/server/staticH5.ts`
与 Android WebView 消费的 bundle，等于要么永久维护两套 UI，要么删掉 H5 远程访问。

本设计把三个诉求拆成三个工程问题分别解决，全部在 `desktop/` 与 `src/server/` 内完成，
不触碰 root `src/`（cli-core），不需要 `allow-cli-core-change` label。

### 目标 / 非目标 / 反目标

#### 目标

1. 安装包体积显著下降，且有 gate 防止回涨。
2. 桌面 UI 开发体验改善：消除超大组件、收口设计 token、浮层行为统一。
3. H5 / Android WebView 作为一等表面被显式对待，不再偶然耦合。
4. 多平台诉求得到诚实回答：现状已覆盖什么，缺什么，缺的那部分值不值得补。

#### 非目标

- 不迁移到 Flutter / Compose Multiplatform / React Native / Tauri。
- 不重写 root `src/`（826k 行 agent 运行时）。
- 不新增 UI 依赖；设计系统化用现有 Tailwind v4 + 已有 `ui/` 组件完成。
- 不做一次性 shadcn 迁移（已被 revert 过，见证据 E12）。
- 不做 iOS 客户端。

#### 反目标（即使技术上可行也不算成功）

- 为了瘦身删掉任何用户可见功能（含 H5 远程访问、IM adapters、语音听写、Computer Use）。
- 为了统一浮层一次性替换 31 个手写浮层导致回归。
- 为了拆组件把一个 4061 行文件切成 40 个互看不顺眼的碎片，或引入新的抽象层。
- 把 `desktop/dist` 从 H5 静态根目录挪走却不做迁移路径（会静默毁掉手机端）。

### 约束（逐条可从仓库验证）

- root `src/` 是 cli-core：改动被阻塞，除非 PR 带 `allow-cli-core-change` label 且
  maintainer 批准。本设计不触碰。
- `desktop/package.json` 在 `desktopNativeExactPaths`：打包脚本改动会同时触发
  `check:desktop` 与完整 `check:native`（真实 `electron:package:dir` + package-smoke）。
- 仓库**没有任何 size-budget gate**，所以瘦身成果必须自带断言，否则会悄悄长回来。
- `desktop/src-tauri/binaries/` 是持久的 staging 目录，`prepare-ripgrep.ts` 只在
  `ECHOFLOW_RIPGREP_ARCHIVE` 或下载成功时才清理异 target 变体；`build-sidecars.ts`
  的 dev fallback 路径只写不删。这是 rg.exe 混入 Linux 包的根因。
- `src/server/staticH5.ts` 把 `desktop/dist` 当 H5 静态根，且是 `src/` 内文件。
  本设计不改它的职责，只改桌面侧产物。
- AGENTS.md：Desktop UI 变更走 `bun run check:desktop`；native/packaging 走
  `bun run check:native`；docs 走 `bun run check:docs`。
- 持久化契约：`echoflow-code-*` localStorage 键是 active persistence contract，
  任何 WebView origin / 存储位置变动必须有 forward migration + 旧 fixture 回归 +
  `bun run check:persistence-upgrade`。本设计不改 origin。

### 证据（仓库实测，2026-10-26）

| ID | 事实 |
|---|---|
| E1 | `desktop/src` 生产代码 156,127 行，测试 151,266 行（近 1:1） |
| E2 | 四个超大组件：`MessageList.tsx` 4061、`Sidebar.tsx` 2528、`ProviderSettings.tsx` 2451、`GeneralSettings.tsx` 2002 |
| E3 | 上述四个文件对 `xterm`/`prosemirror`/`mermaid`/`katex`/`shiki`/`marked` 的 import 数为 **0**（逐个 grep 复现） |
| E4 | 三类 web-heavy 栈（terminal / rich text / markdown-render）合计 11 个文件 / 3,708 行 = `desktop/src` 的 **2.4%** |
| E5 | linux-unpacked 709MB = Electron runtime 310MB + `app.asar` 187MB + `app.asar.unpacked` 213MB |
| E6 | asar 内 node_modules 178MB，其中 **3,233 个 `.map` 文件**；`lucide-react/dist` 一家 1,756 个 |
| E7 | `desktop/electron-dist/main.cjs` 对 mermaid / lucide-react / cytoscape / katex / html2canvas 引用为 **0**；renderer 真实产物 `desktop/dist/assets` 37MB 已自包含 |
| E8 | `electronLanguages` **未设置**，47MB Chromium locale 全量打包 |
| E9 | `src-tauri/binaries/rg.exe` 4.1MB 躺在 Linux 包里；`ripgrep-manifest.json` 记录 `targetTriple: x86_64-unknown-linux-gnu`，`rg` 与 `rg.exe` 共存 |
| E10 | `asarUnpack` 含 `dist/**`，导致 `desktop/dist` 在 asar 与 unpacked 各存一份（40MB） |
| E11 | bun compile floor 实测 90.2MB；合并 sidecar 112MB 只带 20.5MB 应用码 → **拆 sidecar 是净亏，禁止** |
| E12 | shadcn 一次性迁移已被 revert（`e9b53f684`）；`desktop/docs/component-library-plan.md` 记录 31 个手写浮层 / 21 处 outside-click / 28 个 dropdown 因风险过高被刻意不统一；`useDismissable` 已把 outside-click 从 21 处降到 2 处 |
| E13 | 21 处 `useMobileViewport()` 全部有 guard；0 处无 guard 的移动分支；`html[data-touch-h5]` 仅在 `window.desktopHost` 缺失时设置 → **桌面端没有为手机妥协** |
| E14 | `MarkdownRenderer.tsx:3` 静态 import katex，`MermaidRenderer.tsx:3` 静态 import mermaid；这两个是 H5 bundle 里唯一的重型静态 import |
| E15 | `@ngrok/ngrok` 与 `sharp` 已是 lazy（`await import('@ngrok/ngrok')`、`createRequire(process.execPath)('sharp')`）；收益在平台变体去重，不在改懒加载 |
| E16 | `globals.css` 3,209 行，569 个 `--cc-*` 变量；已有 `@theme`(661) + `:root`(585/641/1206/2102) 分层，z-index 已收敛为 `--z-*` 阶梯，0 处 z-index hack |
| E17 | 13,340 处 Tailwind 实用类 vs 494 个非实用类 className；Tailwind 用得干净，不是要换的东西 |

### 决定（How，已定）

#### D1 打包瘦身（无框架变更）

- **renderer-only 依赖移出 `dependencies`**，或等价地在 `build.files` 加否定 glob
  排除 `**/*.map`。二者选一：优先移动依赖（语义更准确），但移动依赖会影响
  `bun install` 与 dev 行为，因此**本设计选择否定 glob**，理由是不改运行时解析路径。
- `electronLanguages: ["en-US", "zh-CN"]`。
- 打包前清理异 target 的 `rg`/`rg.exe`：在 `clean:electron-output.ts` 或
  `prepare:ripgrep.ts` 里做（二者都改，见 plan），依据 `ripgrep-manifest.json`
  的 `targetTriple` 删除不匹配的变体。
- `dist/**` 从 `asarUnpack` 移除或改为精确白名单——H5 只需要 `dist/assets/**` 与
  `dist/index.html`；electron 直接从 asar 内 `dist/` 读。**这一步必须先验证
  `staticH5.ts` 的候选路径仍能解析**（它已尝试 `.asar` → `.asar.unpacked` 回退）。
- sharp / ngrok 的平台变体去重：按 electron-builder target 而非 host 裁剪。
- 加一条 size-budget 断言，落在 `scripts/quality-gate/package-smoke/`，作为
  `check:native` 的一部分。

#### D2 React 原地设计系统化

- 拆四个超大组件，一次一个，每次伴随行为保持的回归测试。
- 审计 569 个 `--cc-*` 变量：**是审计不是重写**。产出是「哪些变量无引用」「哪些
  重复」「哪些该合并为语义 token」，删除无引用的，合并重复的，不新建 token 体系。
- 浮层统一：按 `desktop/src/components/AGENTS.md` 的组件索引，**一次只替换一个**
  手写浮层为 `ui/` 组件。E12 是这次的硬约束。

#### D3 H5 / Android 提升为一等表面

- `MermaidRenderer` 与 katex 改 `React.lazy` 动态 import，使手机端不再下载 mermaid。
- 给 `mobile/` WebView 的 patch 契约（`WebSocket` / `EchoFlowMobile` monkey-patch）
  从零覆盖提升为有 gate 的表面：补 smoke 或 contract test。
- H5 分发路径落 `desktop/src` + `src/server/`（server area，不需 cli-core label）；
  `staticH5.ts` 的 `.asar` 路径分支在 cli-core 内，**不改**。

#### D4 多平台的诚实回答

- 现状：一个 bundle 已覆盖桌面 + 手机浏览器 + Android WebView，且桌面端没有为手机
  妥协（E13）。
- 差距：手机是 chat-only remote client，不能跑 agent，需桌面常开在可信 LAN/VPN/ngrok。
- 若要真原生手机端，唯一比 Flutter/CMP 便宜一个数量级的路径是 Tauri v2 mobile
  复用同一个 `desktop/dist`。**本设计不做，只记录为观察项**，触发条件是 D1-D3
  完成后手机端仍是被抱怨的表面。

#### D5 明确拒绝并记录

Flutter / CMP / React Native 的 UI 重写，以及 Tauri desktop cut-over。
记录在本文档，避免再次立项。Tauri desktop 仅保留为「若 D1-D3 做完后 Electron
runtime 仍是最大单项」时的 2 周 spike 选项，且必须先验 Linux WebKitGTK 与
localStorage origin 迁移两个 lane。

### 留给实现者的判断空间

- 拆组件的具体边界：由实现者按职责划，plan 只锁定「文件必须变小」与「行为不变」。
- 哪些 CSS 变量算重复：由审计结果决定，plan 只锁定「不许新增变量、不许改已发布的
  token 名」（改了会影响 `globals.test.ts` / `contrast.test.ts` / `paletteEscapes.test.ts`）。
- size-budget 的具体 MB 数值：plan 给一个当前实测基线 + 收紧目标，实现者按第一轮
  实测结果定最终值，但必须比基线低。

### 验收

1. `bun run check:native` 通过，且新 size 断言给出实测 MB 数。
2. `bun run check:desktop` 通过，覆盖拆组件与 lazy import。
3. `bun run check:server` 通过（H5 分发路径若触及）。
4. `bun run check:persistence-upgrade` 通过（若触及 localStorage，预期不触及）。
5. `bun run check:agent-flow` 与 `check:desktop-ui-smoke` 通过，证明打包改动没有
   破坏真实启动路径。
6. H5 bundle 不再静态包含 mermaid（入口 chunk 体积可证）。
7. 手写浮层数量下降，且每次下降都有对应测试。
