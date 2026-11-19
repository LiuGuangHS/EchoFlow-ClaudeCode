import { beforeEach, describe, expect, test } from 'vitest'
import {
  CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION,
  DESKTOP_PERSISTENCE_VERSION_KEY,
  runDesktopPersistenceMigrations,
} from './persistenceMigrations'
import { WORKSPACE_STORAGE_VERSION } from './workspace/storageKey'
import { CHAT_APPEARANCE_STORAGE_KEY, DEFAULT_CHAT_APPEARANCE } from './chatAppearance'
import { PREVENT_SLEEP_STORAGE_KEY } from './preventSleepPreference'

describe('desktop persistence migrations', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('migrates legacy appearance keys to canonical keys without overwriting a newer preference', () => {
    localStorage.setItem('cc-haha-theme', 'light')
    localStorage.setItem('cc-haha-follow-system-theme', '0')
    localStorage.setItem('cc-haha-light-theme', 'light')
    localStorage.setItem('cc-haha-dark-theme', 'ink-blue')
    localStorage.setItem('echoflow-code-dark-theme', 'dark')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem('echoflow-code-theme')).toBe('warm-classic')
    expect(localStorage.getItem('echoflow-code-follow-system-theme')).toBe('0')
    expect(localStorage.getItem('echoflow-code-light-theme')).toBe('warm-classic')
    expect(localStorage.getItem('echoflow-code-dark-theme')).toBe('dark')
    expect(localStorage.getItem('cc-haha-theme')).toBe('light')
    expect(localStorage.getItem('cc-haha-light-theme')).toBe('light')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem('echoflow-code-dark-theme')).toBe('dark')
  })

  test('normalizes malformed canonical appearance without replacing it with a stale legacy value', () => {
    localStorage.setItem('cc-haha-theme', 'dark')
    localStorage.setItem('echoflow-code-theme', 'not-a-theme')
    localStorage.setItem('echoflow-code-light-theme', 'light')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem('echoflow-code-theme')).toBeNull()
    expect(localStorage.getItem('echoflow-code-light-theme')).toBe('warm-classic')
    expect(localStorage.getItem('cc-haha-theme')).toBe('dark')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem('echoflow-code-theme')).toBeNull()
  })

  test.each(['supported', 'future', 'corrupt', 'unreadable'])('reserves the theme domain before any legacy copy or scalar normalization for %s records', (kind) => {
    const key = 'echoflow-code-theme-preferences'
    const mirrors = ['echoflow-code-theme', 'echoflow-code-light-theme', 'echoflow-code-dark-theme', 'echoflow-code-follow-system-theme']
    const raw = kind === 'future' ? '{"version":2,"opaque":true}' : kind === 'corrupt' ? '{broken' : JSON.stringify({ version: 1, theme: 'paper', lightTheme: 'paper', darkTheme: 'dark', followSystem: false, mirrorSync: { baseline: ['light', null, 'bad', 'true'], pending: false } })
    localStorage.setItem(key, raw)
    localStorage.setItem('cc-haha-light-theme', 'celadon')
    localStorage.setItem(mirrors[0]!, 'light')
    localStorage.setItem(mirrors[2]!, 'bad')
    localStorage.setItem(mirrors[3]!, 'true')
    const before = [key, ...mirrors].map(name => localStorage.getItem(name))
    const storage = {
      getItem: (name: string) => { if (kind === 'unreadable' && name === key) throw new Error('fixture read failure'); return localStorage.getItem(name) },
      setItem: (name: string, value: string) => localStorage.setItem(name, value),
      removeItem: (name: string) => localStorage.removeItem(name),
    }
    const report = runDesktopPersistenceMigrations(storage)
    expect([key, ...mirrors].map(name => localStorage.getItem(name))).toEqual(before)
    if (kind === 'future') expect(report.unsupportedKeys).toContain(key)
    if (kind === 'corrupt') expect(report.blockedKeys).toContain(key)
    if (kind === 'unreadable') expect(report.failedKeys).toContain(key)
    if (kind !== 'supported') expect(report.status).not.toBe('completed')
    expect(report.migratedKeys).not.toContain(key)
    expect(report.unchangedKeys.includes(key)).toBe(kind === 'supported')
  })

  test.each(['echoflow-code-theme', 'echoflow-code-light-theme', 'echoflow-code-dark-theme', 'echoflow-code-follow-system-theme'])('blocks the missing-authority theme domain when %s cannot be read', (failedKey) => {
    const key = 'echoflow-code-theme-preferences'
    const mirrors = ['echoflow-code-theme', 'echoflow-code-light-theme', 'echoflow-code-dark-theme', 'echoflow-code-follow-system-theme']
    const domain = [key, ...mirrors]
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '6')
    ;['light', 'light', 'invalid', 'true'].forEach((value, i) => localStorage.setItem(mirrors[i]!, value))
    const before = domain.map(name => localStorage.getItem(name))
    const mutations: string[] = []
    const storage = {
      getItem: (name: string) => { if (name === failedKey) throw new Error('fixture incomplete theme snapshot'); return localStorage.getItem(name) },
      setItem: (name: string, value: string) => { mutations.push(name); localStorage.setItem(name, value) },
      removeItem: (name: string) => { mutations.push(name); localStorage.removeItem(name) },
    }
    const report = runDesktopPersistenceMigrations(storage)
    expect(domain.map(name => localStorage.getItem(name))).toEqual(before)
    expect(mutations.filter(name => domain.includes(name))).toEqual([])
    expect(report.status).toBe('blocked')
    expect(report.blockedKeys).toEqual([key])
    expect(report.migratedKeys.filter(name => domain.includes(name))).toEqual([])
    expect(report.unchangedKeys.filter(name => domain.includes(name))).toEqual([])
    expect(report.failedKeys.filter(name => domain.includes(name))).toEqual([])
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe('6')
    expect(localStorage.getItem(PREVENT_SLEEP_STORAGE_KEY)).toBe('0')
    expect(report.migratedKeys).toContain(PREVENT_SLEEP_STORAGE_KEY)
  })

  test('upgrades a frozen schema-6 install with prevent sleep off and preserves existing preferences', () => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '6')
    localStorage.setItem('cc-haha-theme', 'ink-blue')
    localStorage.setItem('unrelated-user-key', 'keep')
    expect(runDesktopPersistenceMigrations().migratedKeys).toContain(PREVENT_SLEEP_STORAGE_KEY)
    expect(localStorage.getItem(PREVENT_SLEEP_STORAGE_KEY)).toBe('0')
    expect(localStorage.getItem('cc-haha-theme')).toBe('ink-blue')
    expect(localStorage.getItem('unrelated-user-key')).toBe('keep')
    expect(runDesktopPersistenceMigrations().migratedKeys).not.toContain(PREVENT_SLEEP_STORAGE_KEY)
    localStorage.setItem(PREVENT_SLEEP_STORAGE_KEY, '1')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem(PREVENT_SLEEP_STORAGE_KEY)).toBe('1')
    localStorage.setItem(PREVENT_SLEEP_STORAGE_KEY, 'true')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem(PREVENT_SLEEP_STORAGE_KEY)).toBe('0')
  })

  test('upgrades a frozen schema-4 install with reading defaults without changing zoom or theme', () => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '4')
    localStorage.setItem('cc-haha-app-zoom', '1.25')
    localStorage.setItem('cc-haha-theme', 'ink-blue')
    localStorage.setItem('unrelated-user-key', 'keep')
    runDesktopPersistenceMigrations()
    expect(JSON.parse(localStorage.getItem(CHAT_APPEARANCE_STORAGE_KEY)!)).toEqual({ version: 1, ...DEFAULT_CHAT_APPEARANCE })
    expect(localStorage.getItem('cc-haha-app-zoom')).toBe('1.25')
    expect(localStorage.getItem('cc-haha-theme')).toBe('ink-blue')
    expect(localStorage.getItem('unrelated-user-key')).toBe('keep')
    expect(runDesktopPersistenceMigrations().migratedKeys).not.toContain(CHAT_APPEARANCE_STORAGE_KEY)
  })

  test('normalizes unversioned reading preferences and preserves a future schema', () => {
    localStorage.setItem(CHAT_APPEARANCE_STORAGE_KEY, JSON.stringify({ font: 'serif', fontSize: 80, extra: true }))
    runDesktopPersistenceMigrations()
    expect(JSON.parse(localStorage.getItem(CHAT_APPEARANCE_STORAGE_KEY)!)).toEqual({ version: 1, font: 'serif', fontSize: 24, width: 'standard', extra: true })
    const future = '{"version":2,"font":"future","extra":true}'
    localStorage.setItem(CHAT_APPEARANCE_STORAGE_KEY, future)
    const report = runDesktopPersistenceMigrations()
    expect(report.unsupportedKeys).toContain(CHAT_APPEARANCE_STORAGE_KEY)
    expect(report.unchangedKeys).not.toContain(CHAT_APPEARANCE_STORAGE_KEY)
    expect(localStorage.getItem(CHAT_APPEARANCE_STORAGE_KEY)).toBe(future)
  })

  test('migrates legacy open-tab arrays into the current tab persistence shape', () => {
    window.localStorage.setItem('cc-haha-open-tabs', JSON.stringify([
      { sessionId: 'session-1', title: 'Old tab' },
      { sessionId: '__terminal__legacy', title: 'Terminal 1', type: 'terminal' },
      { sessionId: 123, title: 'bad' },
    ]))

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('cc-haha-open-tabs')
    expect(JSON.parse(window.localStorage.getItem('cc-haha-open-tabs') || '{}')).toEqual({
      openTabs: [{ sessionId: 'session-1', title: 'Old tab', type: 'session' }],
      activeTabId: 'session-1',
    })
    expect(window.localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe(String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))
  })

  test.each([undefined, 'session', 'connectors'])('preserves connector identities from legacy startup fixtures with type %s', (type) => {
    window.localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: 'session-1', title: 'Task' },
        { sessionId: '__connectors__', title: 'Connectors', ...(type ? { type } : {}) },
      ],
      activeTabId: '__connectors__',
    }))
    runDesktopPersistenceMigrations()
    const expected = {
      openTabs: [
        { sessionId: 'session-1', title: 'Task', type: 'session' },
        { sessionId: '__market__', title: 'Connectors', type: 'market' },
      ],
      activeTabId: '__market__',
    }
    expect(JSON.parse(window.localStorage.getItem('cc-haha-open-tabs')!)).toEqual(expected)
    runDesktopPersistenceMigrations()
    expect(JSON.parse(window.localStorage.getItem('cc-haha-open-tabs')!)).toEqual(expected)
  })

  test('preserves persisted market tabs during startup migration', () => {
    window.localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: '__market__', title: 'Market', type: 'market' },
      ],
      activeTabId: '__market__',
    }))

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('cc-haha-open-tabs')
    expect(report.unchangedKeys).toContain('cc-haha-open-tabs')
    expect(JSON.parse(window.localStorage.getItem('cc-haha-open-tabs') || '{}')).toEqual({
      openTabs: [
        { sessionId: '__market__', title: 'Market', type: 'market' },
      ],
      activeTabId: '__market__',
    })
  })

  test('upgrades a frozen schema-5 install, retiring per-session Trace tabs but preserving the restored Trace Settings entry', () => {
    // Exactly what a schema-5 build persisted with the Trace list open, two
    // per-session trace tabs (one of whose sessions also has a chat tab), and
    // a trace tab focused. Per-session traces live in the chat's 轨迹 view, so
    // those tabs must reopen as their session's chat tab. The standalone Trace
    // Settings entry is restored, however, so a persisted 'trace' settings tab
    // must survive untouched instead of being rewritten to 'general'.
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '5')
    localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: 'session-a', title: 'Chat A', type: 'session' },
        { sessionId: '__traces__', title: 'Traces', type: 'traces' },
        { sessionId: '__trace__session-a', title: 'Chat A', type: 'trace', traceSessionId: 'session-a' },
        { sessionId: '__trace__session-b', title: 'Chat B', type: 'trace', traceSessionId: 'session-b' },
        { sessionId: '__settings__', title: 'Settings', type: 'settings' },
      ],
      activeTabId: '__trace__session-b',
    }))
    localStorage.setItem('cc-haha-active-settings-tab', 'trace')

    const report = runDesktopPersistenceMigrations()

    const expected = {
      openTabs: [
        { sessionId: 'session-a', title: 'Chat A', type: 'session' },
        { sessionId: 'session-b', title: 'Chat B', type: 'session' },
        { sessionId: '__settings__', title: 'Settings', type: 'settings' },
      ],
      activeTabId: 'session-b',
    }
    expect(JSON.parse(localStorage.getItem('cc-haha-open-tabs')!)).toEqual(expected)
    expect(localStorage.getItem('cc-haha-active-settings-tab')).toBe('trace')
    expect(report.migratedKeys).not.toContain('cc-haha-active-settings-tab')
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe(String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))

    // Idempotent: a second launch leaves both keys alone.
    const second = runDesktopPersistenceMigrations()
    expect(JSON.parse(localStorage.getItem('cc-haha-open-tabs')!)).toEqual(expected)
    expect(second.migratedKeys).not.toContain('cc-haha-active-settings-tab')
  })

  test.each([
    ['the Trace list', '__traces__'],
    ['an unresolvable trace tab', '__trace__'],
  ])('falls back to the first surviving tab when %s was focused', (_label, activeTabId) => {
    localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: '__traces__', title: 'Traces', type: 'traces' },
        { sessionId: '__trace__', title: 'Broken', type: 'trace' },
        { sessionId: 'session-a', title: 'Chat A', type: 'session' },
      ],
      activeTabId,
    }))

    runDesktopPersistenceMigrations()

    expect(JSON.parse(localStorage.getItem('cc-haha-open-tabs')!)).toEqual({
      openTabs: [{ sessionId: 'session-a', title: 'Chat A', type: 'session' }],
      activeTabId: 'session-a',
    })
  })

  test('drops the open-tabs key when only retired Trace tabs were open', () => {
    localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [{ sessionId: '__traces__', title: 'Traces', type: 'traces' }],
      activeTabId: '__traces__',
    }))

    runDesktopPersistenceMigrations()

    expect(localStorage.getItem('cc-haha-open-tabs')).toBeNull()
  })

  test('canonicalizes mismatched persisted special tab ids and types during startup migration', () => {
    window.localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: '__settings__', title: 'Settings', type: 'market' },
        { sessionId: '__market__', title: 'Skills', type: 'settings' },
      ],
      activeTabId: '__settings__',
    }))

    runDesktopPersistenceMigrations()

    expect(JSON.parse(window.localStorage.getItem('cc-haha-open-tabs') || '{}')).toEqual({
      openTabs: [
        { sessionId: '__settings__', title: 'Settings', type: 'settings' },
        { sessionId: '__market__', title: 'Skills', type: 'market' },
      ],
      activeTabId: '__settings__',
    })
  })

  test('filters stale session runtime selections without clearing unrelated keys', () => {
    window.localStorage.setItem('unrelated-user-key', 'keep')
    window.localStorage.setItem('cc-haha-session-runtime', JSON.stringify({
      good: { providerId: null, modelId: 'claude-sonnet' },
      alsoGood: { providerId: 'openai-official', modelId: 'gpt-5.6-sol', effortLevel: 'xhigh' },
      bad: { providerId: 'provider-2' },
    }))

    runDesktopPersistenceMigrations()

    expect(JSON.parse(window.localStorage.getItem('cc-haha-session-runtime') || '{}')).toEqual({
      alsoGood: { providerId: 'openai-official', modelId: 'gpt-5.6-sol', effortLevel: 'xhigh' },
      good: { providerId: null, modelId: 'claude-sonnet' },
    })
    expect(window.localStorage.getItem('unrelated-user-key')).toBe('keep')
  })

  test('removes malformed known keys without throwing during startup', () => {
    window.localStorage.setItem('cc-haha-open-tabs', '{"openTabs":')
    window.localStorage.setItem('cc-haha-theme', 'sepia')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('cc-haha-open-tabs')
    expect(report.migratedKeys).toContain('echoflow-code-theme')
    expect(window.localStorage.getItem('cc-haha-open-tabs')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-theme')).toBeNull()
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('sepia')
  })

  test('preserves the pure white theme as a valid persisted theme', () => {
    window.localStorage.setItem('cc-haha-theme', 'white')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('cc-haha-theme')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('white')
  })

  test('renames the retired light theme to warm-classic instead of resetting it', () => {
    // `light` was the warm workspace, labelled 经典暖色 in the picker. Falling
    // through to the enum check would drop it and silently reset those
    // installs to pure white, which reads as the app forgetting the setting.
    window.localStorage.setItem('cc-haha-theme', 'light')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-theme')
    expect(window.localStorage.getItem('echoflow-code-theme')).toBe('warm-classic')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('light')
  })

  test('applies the same rename to the light half of follow-the-system', () => {
    // The preference holds a theme name too, so a rename that only reached the
    // applied theme would silently reset which palette daytime returns to.
    window.localStorage.setItem('cc-haha-light-theme', 'light')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-light-theme')
    expect(window.localStorage.getItem('echoflow-code-light-theme')).toBe('warm-classic')
    expect(window.localStorage.getItem('cc-haha-light-theme')).toBe('light')
  })

  test('preserves every palette introduced by the redesign', () => {
    for (const theme of ['white', 'paper', 'warm-classic', 'celadon', 'dark', 'ink-blue']) {
      window.localStorage.setItem('cc-haha-theme', theme)

      const report = runDesktopPersistenceMigrations()

      expect(report.migratedKeys, `${theme} should survive startup migration`).not.toContain('cc-haha-theme')
      expect(window.localStorage.getItem('cc-haha-theme')).toBe(theme)
    }
  })

  test('drops a malformed follow-the-system flag rather than reading it as opted in', () => {
    // Anything but 0/1 has to go: an unset flag is how a fresh install is
    // recognised, and a junk value would make that inference unpredictable.
    window.localStorage.setItem('cc-haha-follow-system-theme', 'yes')
    // A dark palette is not a valid light half, and vice versa.
    window.localStorage.setItem('cc-haha-light-theme', 'ink-blue')
    window.localStorage.setItem('cc-haha-dark-theme', 'celadon')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-follow-system-theme')
    expect(report.migratedKeys).toContain('echoflow-code-light-theme')
    expect(report.migratedKeys).toContain('echoflow-code-dark-theme')
    expect(window.localStorage.getItem('echoflow-code-follow-system-theme')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-light-theme')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-dark-theme')).toBeNull()
    expect(window.localStorage.getItem('cc-haha-follow-system-theme')).toBe('yes')
    expect(window.localStorage.getItem('cc-haha-light-theme')).toBe('ink-blue')
    expect(window.localStorage.getItem('cc-haha-dark-theme')).toBe('celadon')
  })

  test('preserves a valid follow-the-system flag and both ground preferences', () => {
    window.localStorage.setItem('cc-haha-follow-system-theme', '1')
    window.localStorage.setItem('cc-haha-light-theme', 'celadon')
    window.localStorage.setItem('cc-haha-dark-theme', 'ink-blue')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('cc-haha-follow-system-theme')
    expect(report.migratedKeys).not.toContain('cc-haha-light-theme')
    expect(report.migratedKeys).not.toContain('cc-haha-dark-theme')
    expect(window.localStorage.getItem('cc-haha-follow-system-theme')).toBe('1')
    expect(window.localStorage.getItem('cc-haha-light-theme')).toBe('celadon')
    expect(window.localStorage.getItem('cc-haha-dark-theme')).toBe('ink-blue')
  })

  test.each([null, '7', '8'])('restores legacy preferences from schema %s without deleting old or unrelated values', (version) => {
    if (version !== null) localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, version)
    localStorage.setItem('echoflow-code-locale', 'zh')
    localStorage.setItem('echoflow-code-sidebar-width', '367.5')
    localStorage.setItem('unrelated-user-key', '{"future":true}')

    const report = runDesktopPersistenceMigrations()

    expect(localStorage.getItem('cc-haha-locale')).toBe('zh')
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBe('367.5')
    expect(report.migratedKeys).toEqual(expect.arrayContaining(['cc-haha-locale', 'cc-haha-sidebar-width']))
    expect(localStorage.getItem('echoflow-code-locale')).toBe('zh')
    expect(localStorage.getItem('echoflow-code-sidebar-width')).toBe('367.5')
    expect(localStorage.getItem('unrelated-user-key')).toBe('{"future":true}')
    const second = runDesktopPersistenceMigrations()
    expect(second.migratedKeys).not.toContain('cc-haha-locale')
    expect(second.migratedKeys).not.toContain('cc-haha-sidebar-width')
    expect(localStorage.getItem('cc-haha-locale')).toBe('zh')
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBe('367.5')
  })

  test.each([
    ['en', '320', 'en', '320'],
    ['invalid', 'invalid', null, 'invalid'],
  ] as const)('keeps current preference precedence even for %s / %s', (locale, width, expectedLocale, expectedWidth) => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '8')
    localStorage.setItem('echoflow-code-locale', 'zh')
    localStorage.setItem('echoflow-code-sidebar-width', '400')
    localStorage.setItem('cc-haha-locale', locale)
    localStorage.setItem('cc-haha-sidebar-width', width)

    for (let launch = 0; launch < 2; launch++) {
      runDesktopPersistenceMigrations()
      expect(localStorage.getItem('cc-haha-locale')).toBe(expectedLocale)
      expect(localStorage.getItem('cc-haha-sidebar-width')).toBe(expectedWidth)
      expect(localStorage.getItem('echoflow-code-locale')).toBe('zh')
      expect(localStorage.getItem('echoflow-code-sidebar-width')).toBe('400')
    }
  })

  test.each(['', '0', '-1', 'NaN', 'Infinity', 'wide'])('does not copy invalid legacy preferences (%s)', (width) => {
    localStorage.setItem('echoflow-code-locale', 'unsupported')
    localStorage.setItem('echoflow-code-sidebar-width', width)
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem('cc-haha-locale')).toBeNull()
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBeNull()
    expect(localStorage.getItem('echoflow-code-locale')).toBe('unsupported')
    expect(localStorage.getItem('echoflow-code-sidebar-width')).toBe(width)
  })

  test('does not resurrect legacy preferences after a migrated install clears its selections', () => {
    localStorage.setItem('echoflow-code-locale', 'zh')
    localStorage.setItem('echoflow-code-sidebar-width', '400')
    runDesktopPersistenceMigrations()
    localStorage.removeItem('cc-haha-locale')
    localStorage.removeItem('cc-haha-sidebar-width')
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem('cc-haha-locale')).toBeNull()
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBeNull()
  })

  test('preserves every supported locale during startup migration', () => {
    for (const locale of ['en', 'zh', 'zh-TW', 'jp', 'kr']) {
      window.localStorage.setItem('cc-haha-locale', locale)

      const report = runDesktopPersistenceMigrations()

      expect(report.migratedKeys).not.toContain('cc-haha-locale')
      expect(window.localStorage.getItem('cc-haha-locale')).toBe(locale)
    }
  })

  test('preserves valid app zoom and removes invalid app zoom values', () => {
    window.localStorage.setItem('cc-haha-app-zoom', '1.2')

    const validReport = runDesktopPersistenceMigrations()

    expect(validReport.migratedKeys).not.toContain('cc-haha-app-zoom')
    expect(window.localStorage.getItem('cc-haha-app-zoom')).toBe('1.2')

    window.localStorage.setItem('cc-haha-app-zoom', '4')

    const invalidReport = runDesktopPersistenceMigrations()

    expect(invalidReport.migratedKeys).toContain('cc-haha-app-zoom')
    expect(window.localStorage.getItem('cc-haha-app-zoom')).toBeNull()
  })

  test('migrates the legacy UI zoom key into app zoom storage', () => {
    window.localStorage.setItem('cc-haha-ui-zoom', '1.25')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toEqual(expect.arrayContaining([
      'cc-haha-app-zoom',
      'cc-haha-ui-zoom',
    ]))
    expect(window.localStorage.getItem('cc-haha-app-zoom')).toBe('1.25')
    expect(window.localStorage.getItem('cc-haha-ui-zoom')).toBeNull()
  })

  test('does not throw if schema version persistence is blocked', () => {
    const storage = {
      getItem: window.localStorage.getItem.bind(window.localStorage),
      removeItem: window.localStorage.removeItem.bind(window.localStorage),
      setItem: (key: string, value: string) => {
        if (key === DESKTOP_PERSISTENCE_VERSION_KEY) {
          throw new Error('storage blocked')
        }
        window.localStorage.setItem(key, value)
      },
    }

    expect(() => runDesktopPersistenceMigrations(storage)).not.toThrow()
    const report = runDesktopPersistenceMigrations(storage)
    expect(report.migratedKeys).not.toContain(DESKTOP_PERSISTENCE_VERSION_KEY)
    expect(report.blockedKeys).toContain(DESKTOP_PERSISTENCE_VERSION_KEY)
    expect(report.status).toBe('blocked')
  })

  test('does not throw if storage reads and writes are blocked', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      removeItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
    }

    const report = runDesktopPersistenceMigrations(storage)

    expect(report.migratedKeys).toEqual([])
    expect(report.failedKeys).toEqual([DESKTOP_PERSISTENCE_VERSION_KEY])
    expect(report.blockedKeys).toEqual([DESKTOP_PERSISTENCE_VERSION_KEY])
    expect(report.status).toBe('blocked')
  })
  test('keeps a schema-1 install usable: no workspace key means nothing to migrate', () => {
    window.localStorage.setItem('cc-haha-open-tabs', JSON.stringify({
      openTabs: [{ sessionId: 'session-1', title: 'Chat', type: 'session' }],
      activeTabId: 'session-1',
    }))
    window.localStorage.setItem('cc-haha-theme', 'ink-blue')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('echoflow-code.workspace')
    expect(window.localStorage.getItem('echoflow-code.workspace')).toBeNull()
    // The schema-1 keys a v0.6.2 install carries must survive untouched.
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('ink-blue')
    expect(JSON.parse(window.localStorage.getItem('cc-haha-open-tabs')!).openTabs).toHaveLength(1)
    expect(window.localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe(String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))
  })

  test('leaves a workspace entry written by a newer schema untouched', () => {
    const future = JSON.stringify({
      version: WORKSPACE_STORAGE_VERSION + 1,
      sessions: { s1: { tabs: [{ kind: 'file', id: 'f1', path: 'a.ts' }] } },
    })
    window.localStorage.setItem('echoflow-code.workspace', future)

    const report = runDesktopPersistenceMigrations()

    // The hydrator already refuses an unknown version. Deleting it here would
    // mean a single downgrade launch permanently discards the workspace the
    // newer build is still using.
    expect(report.migratedKeys).not.toContain('echoflow-code.workspace')
    expect(window.localStorage.getItem('echoflow-code.workspace')).toBe(future)
  })

  test.each([undefined, null, [], 'new-shape'])('protects a future workspace before validating old sessions (%s)', (sessions) => {
    const future = ` ${JSON.stringify({ version: WORKSPACE_STORAGE_VERSION + 1, navigation: { keep: true }, sessions })}\n`
    localStorage.setItem('echoflow-code.workspace', future)

    for (let launch = 0; launch < 2; launch++) {
      expect(runDesktopPersistenceMigrations().migratedKeys).not.toContain('echoflow-code.workspace')
      expect(localStorage.getItem('echoflow-code.workspace')).toBe(future)
    }
  })

  test('upgrades workspace v1 without losing the Files launcher, turns, or unknown metadata', () => {
    window.localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '2')
    window.localStorage.setItem('echoflow-code.workspace', JSON.stringify({
      version: 1,
      futureMetadata: { keep: true },
      sessions: {
        s1: {
          layout: 'full',
          activeSideTabId: 'files',
          futureSetting: 42,
          tabs: [
            { kind: 'file', id: 'files', path: '', preview: true },
            { kind: 'review', id: 'review', source: { kind: 'turn', turnKey: 'message-1' }, selectedPath: 'a.ts' },
          ],
        },
      },
    }))

    runDesktopPersistenceMigrations()
    const stored = JSON.parse(window.localStorage.getItem('echoflow-code.workspace')!)
    expect(stored).toMatchObject({
      version: WORKSPACE_STORAGE_VERSION,
      futureMetadata: { keep: true },
      sessions: {
        s1: {
          layout: 'full',
          activeSideTabId: 'files',
          futureSetting: 42,
          tabs: [
            { id: 'files', path: '', preview: true },
            { id: 'review', source: { kind: 'turn', turnKey: 'message-1' }, viewedPaths: [] },
          ],
        },
      },
    })
    expect(window.localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY))
      .toBe(String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))
    const once = window.localStorage.getItem('echoflow-code.workspace')
    runDesktopPersistenceMigrations()
    expect(window.localStorage.getItem('echoflow-code.workspace')).toBe(once)
  })

  test('strips tab entries that name a host resource the previous run owned', () => {
    window.localStorage.setItem('echoflow-code.workspace', JSON.stringify({
      version: 1,
      sideWidth: 860,
      bottomHeight: 420,
      sessions: {
        s1: {
          layout: 'split',
          bottomOpen: false,
          activeSideTabId: 'f1',
          activeBottomTabId: null,
          nextTerminalOrdinal: 2,
          tabs: [
            { kind: 'file', id: 'f1', preview: false, path: 'a.ts' },
            { kind: 'terminal', id: 't1', dock: 'side', cwd: '/repo', ordinal: 1, runtimeId: 'stale-pty' },
            { kind: 'browser', id: 'b1', preview: false, storageId: 'p1', restoreUrl: null, title: null, browserTabId: 'stale-view' },
          ],
        },
      },
    }))

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code.workspace')
    const stored = JSON.parse(window.localStorage.getItem('echoflow-code.workspace')!)
    expect(stored.sessions.s1.tabs.map((tab: { id: string }) => tab.id)).toEqual(['f1'])
  })

  test('removes a corrupt workspace entry rather than throwing at startup', () => {
    window.localStorage.setItem('echoflow-code.workspace', '{not json')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code.workspace')
    expect(window.localStorage.getItem('echoflow-code.workspace')).toBeNull()
  })

})

test('merges legacy connector and skill market tabs while preserving the active market and unrelated user state', () => {
  localStorage.clear()
  localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '3')
  localStorage.setItem('custom-user-state', JSON.stringify({ selectedSkill: 'my-skill' }))
  localStorage.setItem('cc-haha-open-tabs', JSON.stringify({ openTabs: [
    { sessionId: 'session-1', title: 'Work', type: 'session' },
    { sessionId: '__market__', title: 'Skills', type: 'market' },
    { sessionId: '__connectors__', title: 'Connectors', type: 'connectors' },
  ], activeTabId: '__connectors__' }))
  runDesktopPersistenceMigrations()
  expect(JSON.parse(localStorage.getItem('cc-haha-open-tabs')!)).toEqual({ openTabs: [
    { sessionId: 'session-1', title: 'Work', type: 'session' },
    { sessionId: '__market__', title: 'Skills', type: 'market' },
  ], activeTabId: '__market__' })
  expect(JSON.parse(localStorage.getItem('custom-user-state')!)).toEqual({ selectedSkill: 'my-skill' })
})

describe('v0.7.4 reading, zoom and editor preference forward copy', () => {
  const preferences = [
    {
      legacyKey: 'echoflow-code-chat-appearance',
      currentKey: CHAT_APPEARANCE_STORAGE_KEY,
      legacyValue: JSON.stringify({ version: 1, font: 'serif', fontSize: 18, width: 'wide', extra: { keep: true } }),
      currentValue: JSON.stringify({ version: 1, font: 'mono', fontSize: 16, width: 'full', extra: { current: true } }),
    },
    {
      legacyKey: 'echoflow-code-app-zoom',
      currentKey: 'cc-haha-app-zoom',
      legacyValue: '1.25',
      currentValue: '1.1',
    },
    {
      legacyKey: 'echoflow-code-open-target-preferences',
      currentKey: 'cc-haha-open-target-preferences',
      legacyValue: JSON.stringify({ version: 1, editorTargetId: 'sublime', extra: { keep: true } }),
      currentValue: JSON.stringify({ version: 1, editorTargetId: null, extra: { current: true } }),
    },
  ] as const

  beforeEach(() => localStorage.clear())

  test.each([null, '9'])('copies all three released preferences from schema %s, retaining unknown fields and legacy bytes', (version) => {
    if (version !== null) localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, version)
    for (const preference of preferences) localStorage.setItem(preference.legacyKey, preference.legacyValue)
    localStorage.setItem('unrelated-user-key', 'keep')

    const report = runDesktopPersistenceMigrations()

    for (const preference of preferences) {
      expect(localStorage.getItem(preference.currentKey)).toBe(preference.legacyValue)
      expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
      expect(report.migratedKeys).toContain(preference.currentKey)
    }
    expect(localStorage.getItem('unrelated-user-key')).toBe('keep')
    const second = runDesktopPersistenceMigrations()
    for (const preference of preferences) {
      expect(localStorage.getItem(preference.currentKey)).toBe(preference.legacyValue)
      expect(second.migratedKeys).not.toContain(preference.currentKey)
    }
  })

  test.each(preferences)('keeps the current $currentKey ahead of a stale legacy choice', (preference) => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '9')
    localStorage.setItem(preference.legacyKey, preference.legacyValue)
    localStorage.setItem(preference.currentKey, preference.currentValue)

    for (let launch = 0; launch < 2; launch++) {
      runDesktopPersistenceMigrations()
      expect(localStorage.getItem(preference.currentKey)).toBe(preference.currentValue)
      expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
    }
  })

  test.each([preferences[0], preferences[2]])('preserves a future payload copied to $currentKey and a newer current payload', (preference) => {
    const future = '{"version":99,"custom":{"keep":[1,2]}}'
    localStorage.setItem(preference.legacyKey, future)

    runDesktopPersistenceMigrations()
    expect(localStorage.getItem(preference.currentKey)).toBe(future)
    expect(localStorage.getItem(preference.legacyKey)).toBe(future)

    localStorage.setItem(preference.legacyKey, preference.legacyValue)
    runDesktopPersistenceMigrations()
    expect(localStorage.getItem(preference.currentKey)).toBe(future)
    expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
  })

  test('does not downgrade a future desktop schema or backfill its missing preference keys', () => {
    const futureVersion = String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION + 1)
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, futureVersion)
    for (const preference of preferences) localStorage.setItem(preference.legacyKey, preference.legacyValue)

    runDesktopPersistenceMigrations()

    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe(futureVersion)
    for (const preference of preferences) {
      expect(localStorage.getItem(preference.currentKey)).toBeNull()
      expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
    }
  })

  test.each(['transient', 'persistent'] as const)('blocks all mutations after a %s schema-only read failure', (failure) => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION + 1))
    for (const preference of preferences) localStorage.setItem(preference.legacyKey, preference.legacyValue)
    localStorage.setItem('cc-haha-open-tabs', '{"futureTabs":[1,2]}')
    localStorage.setItem('echoflow-code-theme', 'future-theme')
    localStorage.setItem(CHAT_APPEARANCE_STORAGE_KEY, '{"font":"future-font","extra":true}')
    const before = { ...localStorage }
    const mutations: string[] = []
    const reads: string[] = []
    let blocked = true
    const storage = {
      getItem: (key: string) => {
        reads.push(key)
        if (key === DESKTOP_PERSISTENCE_VERSION_KEY && blocked) {
          if (failure === 'transient') blocked = false
          throw new Error('schema read unavailable')
        }
        return localStorage.getItem(key)
      },
      setItem: (key: string, value: string) => {
        mutations.push(key)
        localStorage.setItem(key, value)
      },
      removeItem: (key: string) => {
        mutations.push(key)
        localStorage.removeItem(key)
      },
    }

    const report = runDesktopPersistenceMigrations(storage)

    expect(report.migratedKeys).toEqual([])
    expect(report.failedKeys).toEqual([DESKTOP_PERSISTENCE_VERSION_KEY])
    expect(report.blockedKeys).toEqual([DESKTOP_PERSISTENCE_VERSION_KEY])
    expect(reads).toEqual([DESKTOP_PERSISTENCE_VERSION_KEY])
    expect(mutations).toEqual([])
    expect({ ...localStorage }).toEqual(before)
    const second = runDesktopPersistenceMigrations(storage)
    if (failure === 'transient') expect(second.migratedKeys).toEqual([])
    expect(mutations).toEqual([])
    expect({ ...localStorage }).toEqual(before)
  })

  test.each(preferences)('retries a failed $currentKey copy without blocking the other preferences', (failedPreference) => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '9')
    for (const preference of preferences) localStorage.setItem(preference.legacyKey, preference.legacyValue)
    let blocked = true
    const storage = {
      getItem: localStorage.getItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      setItem: (key: string, value: string) => {
        if (blocked && key === failedPreference.currentKey) throw new Error('quota exceeded')
        localStorage.setItem(key, value)
      },
    }

    expect(() => runDesktopPersistenceMigrations(storage)).not.toThrow()
    expect(localStorage.getItem(failedPreference.currentKey)).toBeNull()
    for (const preference of preferences) {
      expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
      if (preference.currentKey !== failedPreference.currentKey) {
        expect(localStorage.getItem(preference.currentKey)).toBe(preference.legacyValue)
        localStorage.removeItem(preference.currentKey)
      }
    }

    blocked = false
    runDesktopPersistenceMigrations(storage)
    expect(localStorage.getItem(failedPreference.currentKey)).toBe(failedPreference.legacyValue)
    for (const preference of preferences) {
      if (preference.currentKey !== failedPreference.currentKey) {
        expect(localStorage.getItem(preference.currentKey)).not.toBe(preference.legacyValue)
      }
      expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
    }
  })

  test('does not resurrect any legacy choice after a completed migration clears the current preferences', () => {
    for (const preference of preferences) localStorage.setItem(preference.legacyKey, preference.legacyValue)
    runDesktopPersistenceMigrations()
    for (const preference of preferences) {
      expect(localStorage.getItem(preference.currentKey)).toBe(preference.legacyValue)
      localStorage.removeItem(preference.currentKey)
    }

    for (let launch = 0; launch < 2; launch++) {
      runDesktopPersistenceMigrations()
      expect(JSON.parse(localStorage.getItem(CHAT_APPEARANCE_STORAGE_KEY)!)).toEqual({ version: 1, ...DEFAULT_CHAT_APPEARANCE })
      expect(localStorage.getItem('cc-haha-app-zoom')).toBeNull()
      expect(localStorage.getItem('cc-haha-open-target-preferences')).toBeNull()
      for (const preference of preferences) expect(localStorage.getItem(preference.legacyKey)).toBe(preference.legacyValue)
    }
  })
})

describe('v0.7.4 legacy key forward copy', () => {
  // Frozen v0.7.4 fixture keys, before the product prefix rename.
  const LEGACY_TAB_KEY = 'echoflow-code-open-tabs'
  const LEGACY_SESSION_RUNTIME_KEY = 'echoflow-code-session-runtime'
  const CURRENT_TAB_KEY = 'cc-haha-open-tabs'
  const CURRENT_SESSION_RUNTIME_KEY = 'cc-haha-session-runtime'

  const legacyTabs = JSON.stringify({
    openTabs: [{ sessionId: 'session-legacy', title: 'Legacy tab' }],
    activeTabId: 'session-legacy',
  })
  const legacyRuntimes = JSON.stringify({
    'session-legacy': { providerId: null, modelId: 'claude' },
  })

  beforeEach(() => {
    window.localStorage.clear()
  })

  test('copies v0.7.4 tab and session-runtime values forward only when the new keys are missing', () => {
    window.localStorage.setItem(LEGACY_TAB_KEY, legacyTabs)
    window.localStorage.setItem(LEGACY_SESSION_RUNTIME_KEY, legacyRuntimes)

    const report = runDesktopPersistenceMigrations()

    expect(JSON.parse(window.localStorage.getItem(CURRENT_TAB_KEY)!)).toEqual({
      openTabs: [{ sessionId: 'session-legacy', title: 'Legacy tab', type: 'session' }],
      activeTabId: 'session-legacy',
    })
    expect(JSON.parse(window.localStorage.getItem(CURRENT_SESSION_RUNTIME_KEY)!)).toEqual({
      'session-legacy': { providerId: null, modelId: 'claude' },
    })
    // A downgrade must still find its data: never delete the legacy source.
    expect(window.localStorage.getItem(LEGACY_TAB_KEY)).toBe(legacyTabs)
    expect(window.localStorage.getItem(LEGACY_SESSION_RUNTIME_KEY)).toBe(legacyRuntimes)
    expect(report.migratedKeys).toContain(CURRENT_TAB_KEY)
    expect(report.migratedKeys).toContain(CURRENT_SESSION_RUNTIME_KEY)
  })

  test('prefers an existing new value and leaves the legacy value untouched', () => {
    const currentTabs = JSON.stringify({
      openTabs: [{ sessionId: 'session-new', title: 'New tab', type: 'session' }],
      activeTabId: 'session-new',
    })
    const currentRuntimes = JSON.stringify({
      'session-new': { providerId: null, modelId: 'gpt-5' },
    })
    window.localStorage.setItem(LEGACY_TAB_KEY, legacyTabs)
    window.localStorage.setItem(LEGACY_SESSION_RUNTIME_KEY, legacyRuntimes)
    window.localStorage.setItem(CURRENT_TAB_KEY, currentTabs)
    window.localStorage.setItem(CURRENT_SESSION_RUNTIME_KEY, currentRuntimes)

    runDesktopPersistenceMigrations()

    expect(JSON.parse(window.localStorage.getItem(CURRENT_TAB_KEY)!)).toEqual({
      openTabs: [{ sessionId: 'session-new', title: 'New tab', type: 'session' }],
      activeTabId: 'session-new',
    })
    expect(JSON.parse(window.localStorage.getItem(CURRENT_SESSION_RUNTIME_KEY)!)).toEqual({
      'session-new': { providerId: null, modelId: 'gpt-5' },
    })
    expect(window.localStorage.getItem(LEGACY_TAB_KEY)).toBe(legacyTabs)
    expect(window.localStorage.getItem(LEGACY_SESSION_RUNTIME_KEY)).toBe(legacyRuntimes)
  })

  test('tolerates an invalid v0.7.4 legacy payload without losing unrelated state', () => {
    window.localStorage.setItem(LEGACY_TAB_KEY, '{"openTabs":')
    window.localStorage.setItem(LEGACY_SESSION_RUNTIME_KEY, 'not-json')
    window.localStorage.setItem('custom-user-state', 'keep')

    expect(() => runDesktopPersistenceMigrations()).not.toThrow()

    expect(window.localStorage.getItem(CURRENT_TAB_KEY)).toBeNull()
    expect(window.localStorage.getItem(CURRENT_SESSION_RUNTIME_KEY)).toBeNull()
    expect(window.localStorage.getItem(LEGACY_TAB_KEY)).toBe('{"openTabs":')
    expect(window.localStorage.getItem(LEGACY_SESSION_RUNTIME_KEY)).toBe('not-json')
    expect(window.localStorage.getItem('custom-user-state')).toBe('keep')
    expect(window.localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe(
      String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION),
    )
  })
})


describe('B2 truthful outcomes and bounded legacy retries', () => {
  beforeEach(() => localStorage.clear())

  const imports = [
    ['cc-haha-theme', 'echoflow-code-theme', 'dark'],
    ['cc-haha-follow-system-theme', 'echoflow-code-follow-system-theme', '0'],
    ['cc-haha-light-theme', 'echoflow-code-light-theme', 'paper'],
    ['cc-haha-dark-theme', 'echoflow-code-dark-theme', 'ink-blue'],
    ['echoflow-code-locale', 'cc-haha-locale', 'zh'],
    ['echoflow-code-sidebar-width', 'cc-haha-sidebar-width', '368'],
    ['echoflow-code-open-tabs', 'cc-haha-open-tabs', JSON.stringify([{ sessionId: 's', title: 'Keep' }])],
    ['echoflow-code-session-runtime', 'cc-haha-session-runtime', JSON.stringify({ s: { providerId: null, modelId: 'model' } })],
  ] as const

  test.each(imports)('retries only the failed import %s and never revives cleared successful imports', (_source, failedKey) => {
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '7')
    for (const [source, , value] of imports) localStorage.setItem(source, value)
    let blocked = true
    const storage = {
      getItem: localStorage.getItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      setItem: (key: string, value: string) => {
        if (blocked && key === failedKey) throw new Error('selective target failure')
        localStorage.setItem(key, value)
      },
    }
    const first = runDesktopPersistenceMigrations(storage)
    expect(first.migratedKeys).not.toContain(failedKey)
    expect(first.failedKeys).toContain(failedKey)
    expect(first.status).toBe('blocked')
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe('7')
    for (const [, key] of imports) if (key !== failedKey) localStorage.removeItem(key)
    blocked = false
    const second = runDesktopPersistenceMigrations(storage)
    expect(second.failedKeys).toEqual([])
    expect(second.status).toBe('completed')
    expect(localStorage.getItem(failedKey)).not.toBeNull()
    for (const [source, key, value] of imports) {
      if (key !== failedKey) expect(localStorage.getItem(key)).toBeNull()
      expect(localStorage.getItem(source)).toBe(value)
    }
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe('9')
  })

  test('retains explicit retry eligibility even if another startup has already written schema 9', () => {
    localStorage.setItem('cc-haha-theme', 'dark')
    localStorage.setItem('echoflow-code-locale', 'zh')
    localStorage.setItem('echoflow-code-sidebar-width', '368')
    const targets = ['echoflow-code-theme', 'cc-haha-locale', 'cc-haha-sidebar-width']
    runDesktopPersistenceMigrations({
      getItem: localStorage.getItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      setItem: (key, value) => {
        if (targets.includes(key)) throw new Error('quota')
        localStorage.setItem(key, value)
      },
    })
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, '9')
    const retry = runDesktopPersistenceMigrations()
    expect(retry.status).toBe('completed')
    expect(localStorage.getItem('echoflow-code-theme')).toBe('dark')
    expect(localStorage.getItem('cc-haha-locale')).toBe('zh')
    expect(localStorage.getItem('cc-haha-sidebar-width')).toBe('368')
  })

  test.each([
    ['cc-haha-open-tabs', '[{"sessionId":"s","title":"Keep"}]'],
    ['cc-haha-session-runtime', '{"s":{"providerId":null,"modelId":"m"},"bad":{}}'],
    ['echoflow-code.workspace', '{"version":1,"sessions":{"s":{"tabs":[{"id":"f","kind":"file","path":""}]}}}'],
  ])('does not treat a failed normalization write as malformed JSON for %s', (key, raw) => {
    localStorage.setItem(key, raw)
    const report = runDesktopPersistenceMigrations({
      getItem: localStorage.getItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      setItem: (target, value) => {
        if (target === key) throw new Error('quota')
        localStorage.setItem(target, value)
      },
    })
    expect(localStorage.getItem(key)).toBe(raw)
    expect(report.migratedKeys).not.toContain(key)
    expect(report.failedKeys).toContain(key)
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBeNull()
  })

  test.each(['intent', 'completion'])('blocks an uncertain %s marker write without reporting the import as successful', (phase) => {
    const target = 'cc-haha-locale'
    const marker = `cc-haha.persistence.legacyCopied.${target}`
    localStorage.setItem('echoflow-code-locale', 'zh')
    let blocked = true
    const storage = {
      getItem: localStorage.getItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      setItem: (key: string, value: string) => {
        if (blocked && key === marker && (phase === 'intent' || value === '1')) throw new Error('marker unavailable')
        localStorage.setItem(key, value)
      },
    }
    const report = runDesktopPersistenceMigrations(storage)
    expect(report.status).toBe('blocked')
    expect(report.blockedKeys).toContain(target)
    expect(report.migratedKeys).not.toContain(target)
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBeNull()
    if (phase === 'intent') expect(localStorage.getItem(target)).toBeNull()
    else {
      expect(localStorage.getItem(target)).toBe('zh')
      // A clear after the copy cannot safely be distinguished from an interrupted copy.
      localStorage.removeItem(target)
    }
    blocked = false
    const retry = runDesktopPersistenceMigrations(storage)
    if (phase === 'intent') expect(retry.status).toBe('completed')
    else {
      expect(retry.status).toBe('blocked')
      expect(localStorage.getItem(target)).toBeNull()
    }
  })

  test('reports unsupported workspace before old-shape validation and leaves the schema promise incomplete', () => {
    const raw = ' {"version":99,"navigation":{"keep":true}}\n'
    localStorage.setItem('echoflow-code.workspace', raw)
    const report = runDesktopPersistenceMigrations()
    expect(report.unsupportedKeys).toContain('echoflow-code.workspace')
    expect(report.migratedKeys).not.toContain('echoflow-code.workspace')
    expect(localStorage.getItem('echoflow-code.workspace')).toBe(raw)
    expect(localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBeNull()
  })

  test('reports unchanged keys and preserves a future global marker byte-for-byte', () => {
    const first = runDesktopPersistenceMigrations()
    expect(first.status).toBe('completed')
    const second = runDesktopPersistenceMigrations()
    expect(second.migratedKeys).toEqual([])
    expect(second.unchangedKeys).toContain('cc-haha-locale')
    const future = ' 10\n'
    localStorage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, future)
    const before = { ...localStorage }
    const report = runDesktopPersistenceMigrations()
    expect(report.status).toBe('unsupported')
    expect(report.unsupportedKeys).toContain(DESKTOP_PERSISTENCE_VERSION_KEY)
    expect(report.migratedKeys).toEqual([])
    expect({ ...localStorage }).toEqual(before)
  })
})
