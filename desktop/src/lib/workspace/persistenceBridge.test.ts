import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_VERSION } from './storageKey'

vi.mock('../terminalRuntime', () => ({ destroyTerminalRuntime: vi.fn() }))
vi.mock('./browserHost', () => ({ releaseWorkspaceBrowserTab: vi.fn() }))

const future = ' { "version": 99, "navigation": {"newShape":true} }\n'
const supported = () => ({
  version: WORKSPACE_STORAGE_VERSION,
  sideWidth: 720,
  bottomHeight: 300,
  sessions: {
    s1: {
      layout: 'split',
      tabs: [
        { kind: 'file', id: 'f1', path: 'a.ts', preview: true },
        { kind: 'file', id: 'f2', path: 'b.ts', preview: false },
      ],
    },
  },
})

const stops: (() => void)[] = []
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

// Import the real bridge/store before migrations, matching main.tsx's eager imports.
async function start() {
  const { initWorkspacePersistence } = await import('./persistenceBridge')
  const { useWorkspaceStore } = await import('../../stores/workspaceStore')
  const { runDesktopPersistenceMigrations } = await import('../persistenceMigrations')
  runDesktopPersistenceMigrations()
  const stop = initWorkspacePersistence()
  stops.push(stop)
  return { store: useWorkspaceStore, stop, initWorkspacePersistence }
}

function externalReplace(raw: string) {
  const oldValue = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  localStorage.setItem(WORKSPACE_STORAGE_KEY, raw)
  window.dispatchEvent(new StorageEvent('storage', {
    key: WORKSPACE_STORAGE_KEY, oldValue, newValue: raw, storageArea: localStorage,
  }))
}

function finishPending(mode: string, stop: () => void) {
  if (mode === 'timer') vi.advanceTimersByTime(250)
  else if (mode === 'pagehide') window.dispatchEvent(new Event('pagehide'))
  else stop()
}

describe('workspace writer lifecycle', () => {
  it.each(['timer', 'pagehide', 'dispose'])('keeps a future shape byte-for-byte through migration, %s and recreation', async (mode) => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, future)
    const { store, stop, initWorkspacePersistence } = await start()
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(future)
    expect(store.getState().bySession).toEqual({})
    store.getState().openTarget('s1', { kind: 'file', path: 'new.ts' })
    finishPending(mode, stop)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(future)
    stop()
    stops.push(initWorkspacePersistence())
    store.getState().setSideWidth(800)
    vi.advanceTimersByTime(250)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(future)
  })

  it.each(['timer', 'pagehide', 'dispose'])('rechecks storage when another window replaces a pending %s write', async (mode) => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(supported()))
    const { store, stop, initWorkspacePersistence } = await start()
    expect(store.getState().getTabs('s1', 'side')).toHaveLength(2)
    store.getState().setSideWidth(800)
    vi.advanceTimersByTime(249)
    externalReplace(future)
    finishPending(mode, stop)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(future)
    stop()
    stops.push(initWorkspacePersistence())
    expect(store.getState().bySession).toEqual({})
    store.getState().openTarget('s2', { kind: 'file', path: 'new.ts' })
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(future)
  })

  it.each(['timer', 'pagehide', 'dispose'])('fails closed on a %s writer read failure even when writes are available', async (mode) => {
    const original = JSON.stringify(supported())
    localStorage.setItem(WORKSPACE_STORAGE_KEY, original)
    const { store, stop } = await start()
    const getItem = Storage.prototype.getItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const blockedRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === WORKSPACE_STORAGE_KEY) throw new Error('read unavailable')
      return getItem.call(this, key)
    })
    store.getState().setSideWidth(800)
    finishPending(mode, stop)
    expect(setItem).not.toHaveBeenCalled()
    blockedRead.mockRestore()
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(original)
    stop()
  })

  it('writes a missing document at 250ms and flushes pending edits on pagehide and dispose', async () => {
    const { store, stop } = await start()
    store.getState().openTarget('s1', { kind: 'file', path: 'new.ts' })
    vi.advanceTimersByTime(249)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull()
    vi.advanceTimersByTime(1)
    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).sessions.s1.tabs).toHaveLength(1)
    store.getState().setSideWidth(800)
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).sideWidth).toBe(800)
    store.getState().clearSession('s1')
    stop()
    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).sessions).toEqual({})
    const final = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    store.getState().setSideWidth(900)
    window.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersByTime(500)
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(final)
  })

  it('preserves root/session/tab extensions by identity without reviving deleted entries', async () => {
    const fixture = supported()
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      ...fixture,
      rootExtra: { keep: true },
      sessions: {
        s1: { ...fixture.sessions.s1, sessionExtra: { keep: 42 }, tabs: [
          { ...fixture.sessions.s1.tabs[0], tabExtra: { keep: 'first' }, line: 9 },
          { ...fixture.sessions.s1.tabs[1], tabExtra: { keep: 'second' } },
          { kind: 'file', id: 'deleted', path: 'deleted.ts', tabExtra: 'do not revive' },
        ] },
        deletedSession: { layout: 'split', tabs: [{ kind: 'file', id: 'gone', path: 'gone.ts' }] },
      },
    }))
    const { store, stop, initWorkspacePersistence } = await start()
    store.getState().closeTab('s1', 'deleted')
    store.getState().clearSession('deletedSession')
    store.getState().moveTab('s1', 'f2', 0)
    store.getState().pinTab('s1', 'f1')
    // Unknown metadata is read at the write boundary too, not cached at hydrate.
    const external = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!)
    external.rootExtra.otherWindow = true
    externalReplace(JSON.stringify(external))
    vi.advanceTimersByTime(250)
    const written = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!)
    expect(written.rootExtra).toEqual({ keep: true, otherWindow: true })
    expect(written.sessions.deletedSession).toBeUndefined()
    expect(written.sessions.s1.sessionExtra).toEqual({ keep: 42 })
    expect(written.sessions.s1.tabs).toEqual([
      expect.objectContaining({ id: 'f2', tabExtra: { keep: 'second' } }),
      expect.objectContaining({ id: 'f1', preview: false, tabExtra: { keep: 'first' }, line: 9 }),
    ])
    stop()
    stops.push(initWorkspacePersistence())
    store.getState().setBottomHeight(350)
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).sessions.s1.tabs).toEqual(written.sessions.s1.tabs)
  })

  it('does not copy forbidden resources from supported extension fields back to storage', async () => {
    const fixture = supported()
    const resources = {
      runtimeId: 'old-runtime', browserTabId: 'old-browser', webContentsId: 123,
      pty: 'old-pty', handle: 'old-handle', fileBytes: [1, 2], cookies: ['private'],
    }
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(fixture))
    const { store } = await start()
    // Simulate another writer adding stale resources after migration has finished.
    externalReplace(JSON.stringify({
      ...fixture, ...resources, extension: { keep: true, ...resources },
      sessions: { s1: { ...fixture.sessions.s1, ...resources, tabs: [
        { ...fixture.sessions.s1.tabs[0], ...resources, extension: { keep: true, ...resources } },
        fixture.sessions.s1.tabs[1],
      ] } },
    }))
    store.getState().pinTab('s1', 'f1')
    vi.advanceTimersByTime(250)
    const encoded = localStorage.getItem(WORKSPACE_STORAGE_KEY)!
    const written = JSON.parse(encoded)
    for (const key of Object.keys(resources)) expect(encoded).not.toContain(`"${key}"`)
    expect(written.extension).toEqual({ keep: true })
    expect(written.sessions.s1.tabs[0]).toMatchObject({ id: 'f1', preview: false, extension: { keep: true } })
  })

  it('upgrades a legacy workspace before hydration and keeps extensions on the next write', async () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      ...supported(), version: 1, legacyExtra: { keep: true },
    }))
    const { store } = await start()
    expect(store.getState().getTabs('s1', 'side')).toHaveLength(2)
    store.getState().setSideWidth(800)
    vi.advanceTimersByTime(250)
    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!)).toMatchObject({
      version: WORKSPACE_STORAGE_VERSION, sideWidth: 800, legacyExtra: { keep: true },
    })
  })
})
