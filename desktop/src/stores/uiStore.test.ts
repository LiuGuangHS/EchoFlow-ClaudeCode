import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DARK_THEME_STORAGE_KEY,
  FOLLOW_SYSTEM_THEME_STORAGE_KEY,
  LIGHT_THEME_STORAGE_KEY,
  THEME_BACKGROUNDS,
  THEME_STORAGE_KEY,
} from '../theme/systemAppearance'

type Listener = (event: { matches: boolean }) => void

/**
 * The shipped index.html carries this meta; jsdom starts without it. It colors
 * the iOS status bar and the Android address bar, which under viewport-fit=cover
 * sit directly against the app's own background.
 */
function installThemeColorMeta() {
  document.querySelector('meta[name="theme-color"]')?.remove()
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute('content', '#000000')
  document.head.appendChild(meta)
}

function readThemeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
}

/** jsdom ships no matchMedia; the theme layer treats its absence as light. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<Listener>()
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      matches: prefersDark,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    }),
    configurable: true,
    writable: true,
  })
  return {
    emit: (matches: boolean) => {
      prefersDark = matches
      for (const listener of listeners) listener({ matches })
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia')
  document.querySelector('meta[name="theme-color"]')?.remove()
})

describe('uiStore legacy sidebar width startup', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('hydrates the legacy width through the eager workspace import before startup migrations', async () => {
    localStorage.setItem('cc-haha.persistence.schemaVersion', '8')
    localStorage.setItem('echoflow-code-sidebar-width', '368')
    // main.tsx statically imports this bridge before its migration call runs.
    await import('../lib/workspace/persistenceBridge')
    const { useUIStore } = await import('./uiStore')
    const { runDesktopPersistenceMigrations } = await import('../lib/persistenceMigrations')
    runDesktopPersistenceMigrations()
    expect(useUIStore.getState().sidebarWidth).toBe(368)
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBe('368')
    expect(localStorage.getItem('echoflow-code-sidebar-width')).toBe('368')
  })

  it('does not revive an eagerly imported width on reimport while the global schema remains old', async () => {
    localStorage.setItem('cc-haha.persistence.schemaVersion', '8')
    localStorage.setItem('echoflow-code-sidebar-width', '368')
    const first = await import('./uiStore')
    expect(first.useUIStore.getState().sidebarWidth).toBe(368)
    localStorage.removeItem('cc-haha-sidebar-width')
    vi.resetModules()
    const second = await import('./uiStore')
    expect(second.useUIStore.getState().sidebarWidth).toBe(280)
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBeNull()
    expect(localStorage.getItem('echoflow-code-sidebar-width')).toBe('368')
  })

  it.each([
    ['1', 240],
    ['367.5', 368],
    ['999', 480],
    ['invalid', 280],
    ['0', 280],
    ['-1', 280],
    ['Infinity', 280],
  ])('uses existing validation and clamp semantics for legacy width %s', async (legacy, expected) => {
    localStorage.setItem('echoflow-code-sidebar-width', legacy)
    const { useUIStore } = await import('./uiStore')
    expect(useUIStore.getState().sidebarWidth).toBe(expected)
    expect(localStorage.getItem('echoflow-code-sidebar-width')).toBe(legacy)
  })

  it.each([['320', 320], ['invalid', 280]])('never substitutes a stale width for current %s', async (current, expected) => {
    localStorage.setItem('echoflow-code-sidebar-width', '400')
    localStorage.setItem('cc-haha-sidebar-width', current)
    const { useUIStore } = await import('./uiStore')
    expect(useUIStore.getState().sidebarWidth).toBe(expected)
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBe(current)
  })
})

describe('uiStore theme handling', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    installThemeColorMeta()
  })

  it('defaults new installs to the pure white theme', async () => {
    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('hydrates and applies the pure white theme as a light color scheme', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'white')

    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('cycles through all six palettes and wraps back to pure white', async () => {
    const { useUIStore } = await import('./uiStore')

    const cycle = ['paper', 'warm-classic', 'celadon', 'dark', 'ink-blue', 'white']
    for (const expected of cycle) {
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe(expected)
    }
  })

  it('reports a dark color scheme for both ink palettes, not just the one named dark', async () => {
    // `ink-blue` is a dark ground under a name that does not contain "dark".
    // Testing `theme === 'dark'` leaves native scrollbars and form controls in
    // their light variant against a near-black page.
    const { useUIStore } = await import('./uiStore')

    // Pick palettes by hand: while following the system the OS chooses the
    // ground, so a manual pick lands in a preference instead of on screen.
    useUIStore.getState().setFollowSystemTheme(false)
    useUIStore.getState().setTheme('ink-blue')
    expect(document.documentElement.getAttribute('data-theme')).toBe('ink-blue')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    useUIStore.getState().setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    useUIStore.getState().setTheme('celadon')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  // Under viewport-fit=cover the page runs under the status bar, so a stale
  // theme-color reads as a mismatched band above the header on every switch.
  it('repaints the browser chrome for every palette', async () => {
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().setFollowSystemTheme(false)

    for (const [theme, background] of Object.entries(THEME_BACKGROUNDS)) {
      useUIStore.getState().setTheme(theme as keyof typeof THEME_BACKGROUNDS)
      expect(readThemeColor(), `${theme} left the browser chrome unpainted`).toBe(background)
    }
  })

  it('applies a theme even when the document carries no theme-color meta', async () => {
    document.querySelector('meta[name="theme-color"]')?.remove()

    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().setFollowSystemTheme(false)
    useUIStore.getState().setTheme('dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('uiStore following the system appearance', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
    installThemeColorMeta()
  })

  it('starts a fresh install on the dark theme when the OS is dark', async () => {
    // The reported bug: at night the app opened white and had to be switched
    // by hand every time.
    stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')

    expect(useUIStore.getState().followSystemTheme).toBe(true)
    expect(useUIStore.getState().theme).toBe('dark')

    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    teardownTheme()
  })

  it('leaves an existing install on its fixed theme', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'white')
    stubMatchMedia(true)

    const { useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().followSystemTheme).toBe(false)
    expect(useUIStore.getState().theme).toBe('white')
  })

  it('preserves a v0.7.4 fixed palette through initialization and restart', async () => {
    // 保留历史版本的字面量键，避免运行时和测试常量一起改名时掩盖数据丢失。
    window.localStorage.setItem('echoflow-code-theme', 'celadon')
    stubMatchMedia(true)

    const first = await import('./uiStore')
    expect(first.useUIStore.getState()).toMatchObject({
      theme: 'celadon',
      lightTheme: 'celadon',
      followSystemTheme: false,
    })
    first.initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('celadon')
    expect(window.localStorage.getItem('echoflow-code-theme')).toBe('celadon')
    expect(window.localStorage.getItem('echoflow-code-follow-system-theme')).toBe('0')
    first.teardownTheme()

    vi.resetModules()
    const recreated = await import('./uiStore')
    expect(recreated.useUIStore.getState()).toMatchObject({ theme: 'celadon', followSystemTheme: false })
  })

  it('preserves both v0.7.4 ground preferences and its explicit system switch', async () => {
    window.localStorage.setItem('echoflow-code-theme', 'warm-classic')
    window.localStorage.setItem('echoflow-code-light-theme', 'warm-classic')
    window.localStorage.setItem('echoflow-code-dark-theme', 'ink-blue')
    window.localStorage.setItem('echoflow-code-follow-system-theme', '1')
    const media = stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    expect(useUIStore.getState()).toMatchObject({
      theme: 'ink-blue',
      lightTheme: 'warm-classic',
      darkTheme: 'ink-blue',
      followSystemTheme: true,
    })
    initializeTheme()
    media.emit(false)
    expect(useUIStore.getState().theme).toBe('warm-classic')
    expect(window.localStorage.getItem('echoflow-code-light-theme')).toBe('warm-classic')
    expect(window.localStorage.getItem('echoflow-code-dark-theme')).toBe('ink-blue')
    expect(window.localStorage.getItem('echoflow-code-follow-system-theme')).toBe('1')
    teardownTheme()
  })

  it('repaints when the OS flips while the app is open', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('white')

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    media.emit(false)
    expect(useUIStore.getState().theme).toBe('white')
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    teardownTheme()
  })

  it('ignores OS flips once the user opts out', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    useUIStore.getState().setFollowSystemTheme(false)

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })

  it('freezes the theme on screen when the switch is turned off', async () => {
    // Turning it off at night should keep the dark theme, not snap back to
    // the light half.
    stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('dark')

    useUIStore.getState().setFollowSystemTheme(false)
    expect(useUIStore.getState().theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(window.localStorage.getItem(FOLLOW_SYSTEM_THEME_STORAGE_KEY)).toBe('0')
    teardownTheme()
  })

  it('stores a light pick as the light half without overriding a dark OS', async () => {
    stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()

    useUIStore.getState().setTheme('warm-classic')

    // Still dark on screen — the OS says so — but tomorrow morning it is warm
    // classic rather than pure white.
    expect(useUIStore.getState().theme).toBe('dark')
    expect(useUIStore.getState().lightTheme).toBe('warm-classic')
    expect(window.localStorage.getItem(LIGHT_THEME_STORAGE_KEY)).toBe('warm-classic')
    teardownTheme()
  })

  it('stores a dark pick as the dark half without overriding a light OS', async () => {
    // The symmetric case: ink-blue chosen at noon is remembered for tonight.
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()

    useUIStore.getState().setTheme('ink-blue')

    expect(useUIStore.getState().theme).toBe('white')
    expect(useUIStore.getState().darkTheme).toBe('ink-blue')
    expect(window.localStorage.getItem(DARK_THEME_STORAGE_KEY)).toBe('ink-blue')
    teardownTheme()
  })

  it('applies a light pick immediately when the OS is already light', async () => {
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()

    useUIStore.getState().setTheme('warm-classic')

    expect(useUIStore.getState().theme).toBe('warm-classic')
    expect(document.documentElement.getAttribute('data-theme')).toBe('warm-classic')
    teardownTheme()
  })

  it('rehydrates the switch and the light half after a restart', async () => {
    stubMatchMedia(false)

    const first = await import('./uiStore')
    first.initializeTheme()
    first.useUIStore.getState().setTheme('warm-classic')
    first.teardownTheme()

    vi.resetModules()
    stubMatchMedia(true)
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().followSystemTheme).toBe(true)
    expect(recreated.useUIStore.getState().lightTheme).toBe('warm-classic')
    expect(recreated.useUIStore.getState().theme).toBe('dark')
  })

  it('releases the switch when the theme is cycled by hand', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().followSystemTheme).toBe(true)

    // white -> paper, the next palette in the rotation.
    useUIStore.getState().toggleTheme()

    expect(useUIStore.getState().followSystemTheme).toBe(false)
    media.emit(true)
    expect(useUIStore.getState().theme).toBe('paper')
    teardownTheme()
  })

  it('drops the OS listener from a previous initialize', async () => {
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    teardownTheme()

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('white')
  })

  it('does not revive the switch from a window whose store went stale', async () => {
    // The pet window is long-lived and runs the same bootstrap with its own
    // store over the shared localStorage. When the main window turns the
    // switch off, this window's in-memory copy still says "on" — acting on it
    // would write the user's choice straight back out.
    const media = stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().followSystemTheme).toBe(true)

    // Another window opted out; only storage reflects it.
    window.localStorage.setItem(FOLLOW_SYSTEM_THEME_STORAGE_KEY, '0')

    media.emit(true)

    expect(window.localStorage.getItem(FOLLOW_SYSTEM_THEME_STORAGE_KEY)).toBe('0')
    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })

  it('picks up the ground preferences another window chose', async () => {
    const media = stubMatchMedia(true)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('dark')

    window.localStorage.setItem(LIGHT_THEME_STORAGE_KEY, 'celadon')
    window.localStorage.setItem(DARK_THEME_STORAGE_KEY, 'ink-blue')

    media.emit(false)
    expect(useUIStore.getState().theme).toBe('celadon')
    expect(useUIStore.getState().lightTheme).toBe('celadon')

    media.emit(true)
    expect(useUIStore.getState().theme).toBe('ink-blue')
    expect(useUIStore.getState().darkTheme).toBe('ink-blue')
    teardownTheme()
  })

  it('catches up when another window changes the appearance', async () => {
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()
    expect(useUIStore.getState().theme).toBe('white')

    // A storage event is what the browser delivers to the windows that did
    // not perform the write.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'celadon')
    window.localStorage.setItem(LIGHT_THEME_STORAGE_KEY, 'celadon')
    window.dispatchEvent(new StorageEvent('storage', { key: LIGHT_THEME_STORAGE_KEY }))

    expect(useUIStore.getState().theme).toBe('celadon')
    expect(useUIStore.getState().lightTheme).toBe('celadon')
    expect(document.documentElement.getAttribute('data-theme')).toBe('celadon')
    // The window that performed the write repaints through applyTheme; this one
    // only ever sees the storage event, so it needs the same repaint.
    expect(readThemeColor()).toBe(THEME_BACKGROUNDS.celadon)
    teardownTheme()
  })

  it('ignores storage events for unrelated keys', async () => {
    stubMatchMedia(false)

    const { initializeTheme, useUIStore, teardownTheme } = await import('./uiStore')
    initializeTheme()

    window.localStorage.setItem(THEME_STORAGE_KEY, 'celadon')
    window.dispatchEvent(new StorageEvent('storage', { key: 'cc-haha-open-tabs' }))

    expect(useUIStore.getState().theme).toBe('white')
    teardownTheme()
  })
})

describe('uiStore versioned theme lifecycle', () => {
  const recordKey = 'echoflow-code-theme-preferences'
  const keys = [recordKey, THEME_STORAGE_KEY, LIGHT_THEME_STORAGE_KEY, DARK_THEME_STORAGE_KEY, FOLLOW_SYSTEM_THEME_STORAGE_KEY]
  let teardown: (() => void) | undefined
  const record = (overrides = {}) => ({ version: 1, theme: 'celadon', lightTheme: 'celadon', darkTheme: 'ink-blue', followSystem: false, mirrorSync: { baseline: ['paper', 'paper', 'dark', '0'], pending: false }, ...overrides })
  function seed() {
    ;['paper', 'paper', 'dark', '0'].forEach((value, i) => localStorage.setItem(keys[i + 1]!, value))
  }
  beforeEach(() => { vi.resetModules(); localStorage.clear(); installThemeColorMeta() })
  afterEach(() => { teardown?.(); teardown = undefined; vi.restoreAllMocks() })
  async function owner() {
    const ui = await import('./uiStore')
    teardown = ui.teardownTheme
    return ui
  }

  it.each([false, true])('preserves future bytes throughout the lifecycle (inserted after eager hydration=%s)', async (afterEager) => {
    const media = stubMatchMedia(false)
    seed()
    const future = '{ "version": 8, "opaque": [1,2] }'
    if (!afterEager) localStorage.setItem(recordKey, future)
    const ui = await owner()
    localStorage.setItem(recordKey, future)
    const before = keys.map(key => localStorage.getItem(key))
    const migrations = await import('../lib/persistenceMigrations')
    expect(migrations.runDesktopPersistenceMigrations().unsupportedKeys).toContain(recordKey)
    ui.initializeTheme()
    ui.useUIStore.getState().setTheme('ink-blue')
    ui.useUIStore.getState().setTheme('celadon', false)
    ui.useUIStore.getState().setFollowSystemTheme(true)
    ui.useUIStore.getState().setFollowSystemTheme(false)
    ui.useUIStore.getState().toggleTheme()
    media.emit(true)
    for (const key of [...keys, null]) window.dispatchEvent(new StorageEvent('storage', { key }))
    expect(ui.useUIStore.getState().themePersistence).toEqual({ status: 'blocked', reason: 'unsupported-record' })
    expect(keys.map(key => localStorage.getItem(key))).toEqual(before)
    ui.teardownTheme()
    vi.resetModules()
    const recreated = await owner()
    recreated.initializeTheme()
    expect(keys.map(key => localStorage.getItem(key))).toEqual(before)
  })

  it('re-reads newer supported authority between eager hydration and initialize', async () => {
    stubMatchMedia(true)
    seed()
    const ui = await owner()
    expect(ui.useUIStore.getState().theme).toBe('paper')
    localStorage.setItem(recordKey, JSON.stringify(record()))
    ui.initializeTheme()
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'celadon', lightTheme: 'celadon', darkTheme: 'ink-blue', followSystemTheme: false, themePersistence: { status: 'saved' } })
    expect(document.documentElement.dataset.theme).toBe('celadon')
  })

  it('reports initial failure rather than applying an uncommitted requested palette', async () => {
    seed()
    const ui = await owner()
    const write = Storage.prototype.setItem
    const calls: string[] = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      calls.push(key)
      if (key === recordKey) throw new Error('quota fixture')
      write.call(this, key, value)
    })
    ui.useUIStore.getState().setTheme('ink-blue', false)
    expect(calls).toEqual([recordKey])
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'paper', themePersistence: { status: 'failed', stage: 'record', key: recordKey } })
  })

  it.each([0, 1, 2, 3, 4])('exposes unfinished mirror/completion stage %s and recovers after recreation', async (stage) => {
    stubMatchMedia(false)
    const ui = await owner()
    const write = Storage.prototype.setItem
    let records = 0
    const failedKey = stage === 4 ? recordKey : keys[stage + 1]!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === recordKey) records++
      if ((stage < 4 && key === failedKey) || (stage === 4 && key === recordKey && records === 2)) throw new Error('fixture interruption')
      write.call(this, key, value)
    })
    ui.useUIStore.getState().setTheme('celadon', false)
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'celadon', themePersistence: { status: 'pending', stage: stage === 4 ? 'completion' : 'mirror', key: failedKey } })
    expect(JSON.parse(localStorage.getItem(recordKey)!).mirrorSync.pending).toBe(true)
    vi.restoreAllMocks()
    ui.teardownTheme()
    vi.resetModules()
    const recreated = await owner()
    expect(recreated.useUIStore.getState().themePersistence?.status).toBe('pending')
    recreated.initializeTheme()
    expect(recreated.useUIStore.getState()).toMatchObject({ theme: 'celadon', themePersistence: { status: 'saved' } })
    expect(JSON.parse(localStorage.getItem(recordKey)!).mirrorSync).toEqual({ baseline: ['celadon', 'celadon', 'dark', '0'], pending: false })
  })

  it.each([recordKey, THEME_STORAGE_KEY, LIGHT_THEME_STORAGE_KEY, DARK_THEME_STORAGE_KEY, FOLLOW_SYSTEM_THEME_STORAGE_KEY])('hydrates from one snapshot and blocks persistence on a failed read of %s', async (failedKey) => {
    stubMatchMedia(false)
    seed()
    localStorage.setItem(recordKey, JSON.stringify(record()))
    const before = keys.map(key => localStorage.getItem(key))
    const read = Storage.prototype.getItem
    const reads: string[] = []
    const reader = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (keys.includes(key)) reads.push(key)
      if (key === failedKey) throw new Error('fixture incomplete snapshot')
      return read.call(this, key)
    })
    const ui = await owner()
    expect(reads.sort()).toEqual([...keys].sort())
    expect(ui.useUIStore.getState()).toMatchObject({ theme: failedKey === recordKey ? 'paper' : 'celadon', themePersistence: { status: 'blocked' } })
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    ui.initializeTheme()
    ui.useUIStore.getState().setTheme('ink-blue', false)
    expect(writes.mock.calls.filter(([key]) => keys.includes(key))).toEqual([])
    reader.mockRestore()
    expect(keys.map(key => localStorage.getItem(key))).toEqual(before)
  })

  it('keeps a pending target immutable through recovery when the OS has changed', async () => {
    stubMatchMedia(true)
    seed()
    localStorage.setItem(recordKey, JSON.stringify(record({ theme: 'paper', lightTheme: 'paper', darkTheme: 'dark', followSystem: true, mirrorSync: { baseline: ['paper', 'paper', 'dark', '0'], pending: true } })))
    const ui = await owner()
    const write = Storage.prototype.setItem
    const records: Array<{ theme: string; mirrorSync: { pending: boolean } }> = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === recordKey) records.push(JSON.parse(value))
      write.call(this, key, value)
    })
    ui.initializeTheme()
    expect(records[0]).toMatchObject({ theme: 'paper', mirrorSync: { pending: false } })
    expect(ui.useUIStore.getState().theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem(recordKey)!).theme).toBe('dark')
  })

  it('uses fresh authority for stale-window manual decisions and freezes the displayed palette', async () => {
    stubMatchMedia(true)
    seed()
    const ui = await owner()
    localStorage.setItem(recordKey, JSON.stringify(record({ theme: 'ink-blue', followSystem: true })))
    ui.useUIStore.getState().setFollowSystemTheme(false)
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'ink-blue', followSystemTheme: false, lightTheme: 'celadon', darkTheme: 'ink-blue' })
    expect(JSON.parse(localStorage.getItem(recordKey)!).theme).toBe('ink-blue')
    // Another window turned following back on; this store must not turn it off.
    const next = JSON.parse(localStorage.getItem(recordKey)!)
    localStorage.setItem(recordKey, JSON.stringify({ ...next, followSystem: true }))
    ui.useUIStore.getState().setTheme('paper')
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'ink-blue', followSystemTheme: true, lightTheme: 'paper' })
  })

  it('refreshes every preference on same-palette OS events and keeps storage events read-only', async () => {
    const media = stubMatchMedia(false)
    const ui = await owner()
    ui.initializeTheme()
    const current = JSON.parse(localStorage.getItem(recordKey)!)
    localStorage.setItem(recordKey, JSON.stringify({ ...current, darkTheme: 'ink-blue' }))
    media.emit(false)
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'white', darkTheme: 'ink-blue' })
    const write = vi.spyOn(Storage.prototype, 'setItem')
    for (const key of [...keys, null]) window.dispatchEvent(new StorageEvent('storage', { key }))
    expect(write).not.toHaveBeenCalled()
    localStorage.clear()
    write.mockClear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(ui.useUIStore.getState()).toMatchObject({ theme: 'white', followSystemTheme: true, darkTheme: 'dark' })
    expect(write).not.toHaveBeenCalled()
  })

  it('repeated initialization removes both previous listeners and teardown removes all', async () => {
    const media = stubMatchMedia(false)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const ui = await owner()
    ui.initializeTheme()
    ui.initializeTheme()
    expect(media.listenerCount()).toBe(1)
    const listeners = add.mock.calls.filter(([type]) => type === 'storage').map(([, fn]) => fn)
    expect(listeners).toHaveLength(2)
    expect(remove).toHaveBeenCalledWith('storage', listeners[0])
    ui.teardownTheme()
    expect(remove).toHaveBeenCalledWith('storage', listeners[1])
    expect(media.listenerCount()).toBe(0)
    localStorage.setItem(THEME_STORAGE_KEY, 'paper')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }))
    expect(ui.useUIStore.getState().theme).toBe('white')
  })
})

describe('uiStore settings tab persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('hydrates the last selected Settings tab after the renderer store is recreated', async () => {
    const first = await import('./uiStore')

    first.useUIStore.getState().setActiveSettingsTab('general')

    expect(window.localStorage.getItem('cc-haha-active-settings-tab')).toBe('general')

    vi.resetModules()
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().activeSettingsTab).toBe('general')
  })

  it('persists the pets Settings tab', async () => {
    const first = await import('./uiStore')

    first.useUIStore.getState().setActiveSettingsTab('pets')

    expect(window.localStorage.getItem('cc-haha-active-settings-tab')).toBe('pets')

    vi.resetModules()
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().activeSettingsTab).toBe('pets')
  })

  it('ignores an invalid persisted Settings tab', async () => {
    window.localStorage.setItem('cc-haha-active-settings-tab', 'not-a-settings-tab')

    const { useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().activeSettingsTab).toBe('providers')
  })

  // The standalone Network/Runtime/Data/Trace sections were restored. A tab
  // persisted by v0.7.4 (or by any build that still offered these sections)
  // must reopen that same section, not silently fall back to General/providers.
  for (const tab of ['network', 'runtime', 'data', 'trace'] as const) {
    it(`restores a persisted ${tab} Settings tab to its own section`, async () => {
      window.localStorage.setItem('cc-haha-active-settings-tab', tab)

      const { useUIStore } = await import('./uiStore')

      expect(useUIStore.getState().activeSettingsTab).toBe(tab)
    })
  }
})

describe('uiStore new-session draft navigation', () => {
  // An empty draft is only a seed: "New session" in another project has to
  // land there. It used to keep the first project, which was usually the
  // project-less draft made at launch before the tabs were restored.
  it('moves an empty draft to the requested project in place', async () => {
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().startNewSessionDraft('/workspace/first')
    const draft = useUIStore.getState().newSessionDraft!
    expect(draft).toMatchObject({ workDir: '/workspace/first', hasContent: false })

    useUIStore.getState().startNewSessionDraft('/workspace/other')
    // Same revision: the composer is moved, not remounted, so its mode and
    // permission picks survive.
    expect(useUIStore.getState().newSessionDraft).toEqual({ ...draft, workDir: '/workspace/other' })

    // No target (a page with no chat of its own) returns to the draft as it is.
    useUIStore.getState().startNewSessionDraft()
    expect(useUIStore.getState().newSessionDraft?.workDir).toBe('/workspace/other')
    useUIStore.setState({ newSessionDraft: null })
  })

  it('keeps the project of a draft holding unsent content', async () => {
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().startNewSessionDraft('/workspace/first')
    const { revision } = useUIStore.getState().newSessionDraft!
    useUIStore.getState().setNewSessionDraftContent(revision, true)
    const draft = useUIStore.getState().newSessionDraft
    expect(draft).toMatchObject({ workDir: '/workspace/first', hasContent: true })

    useUIStore.getState().startNewSessionDraft('/workspace/other')
    expect(useUIStore.getState().newSessionDraft).toBe(draft)

    // Emptied again, it follows the next request.
    useUIStore.getState().setNewSessionDraftContent(revision, false)
    useUIStore.getState().startNewSessionDraft('/workspace/other')
    expect(useUIStore.getState().newSessionDraft).toMatchObject({ workDir: '/workspace/other', revision })
    useUIStore.setState({ newSessionDraft: null })
  })

  it('ignores a content report from a composer of an older draft', async () => {
    vi.resetModules()
    const { useUIStore } = await import('./uiStore')
    useUIStore.getState().startNewSessionDraft('/workspace/first')
    const first = useUIStore.getState().newSessionDraft!
    // Successful first send consumes this draft. The next request is a new chat.
    useUIStore.setState({ newSessionDraft: null })
    useUIStore.getState().startNewSessionDraft('/workspace/next')
    const next = useUIStore.getState().newSessionDraft!
    expect(next.workDir).toBe('/workspace/next')
    expect(next.revision).not.toBe(first.revision)

    useUIStore.getState().setNewSessionDraftContent(first.revision, true)
    expect(useUIStore.getState().newSessionDraft).toBe(next)
    useUIStore.setState({ newSessionDraft: null })
  })
})
