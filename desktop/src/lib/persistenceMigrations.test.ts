import { beforeEach, describe, expect, test } from 'vitest'
import {
  CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION,
  DESKTOP_PERSISTENCE_VERSION_KEY,
  runDesktopPersistenceMigrations,
} from './persistenceMigrations'

describe('desktop persistence migrations', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('migrates legacy open-tab arrays into the current tab persistence shape', () => {
    window.localStorage.setItem('echoflow-code-open-tabs', JSON.stringify([
      { sessionId: 'session-1', title: 'Old tab' },
      { sessionId: '__terminal__legacy', title: 'Terminal 1', type: 'terminal' },
      { sessionId: 123, title: 'bad' },
    ]))

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-open-tabs')
    expect(JSON.parse(window.localStorage.getItem('echoflow-code-open-tabs') || '{}')).toEqual({
      openTabs: [{ sessionId: 'session-1', title: 'Old tab', type: 'session' }],
      activeTabId: 'session-1',
    })
    expect(window.localStorage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)).toBe(String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))
  })

  test('preserves persisted market tabs during startup migration', () => {
    window.localStorage.setItem('echoflow-code-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: '__market__', title: 'Market', type: 'market' },
        { sessionId: '__traces__', title: 'Traces', type: 'traces' },
      ],
      activeTabId: '__market__',
    }))

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-open-tabs')
    expect(JSON.parse(window.localStorage.getItem('echoflow-code-open-tabs') || '{}')).toEqual({
      openTabs: [
        { sessionId: '__market__', title: 'Market', type: 'market' },
        { sessionId: '__traces__', title: 'Traces', type: 'traces' },
      ],
      activeTabId: '__market__',
    })
  })

  test('canonicalizes mismatched persisted special tab ids and types during startup migration', () => {
    window.localStorage.setItem('echoflow-code-open-tabs', JSON.stringify({
      openTabs: [
        { sessionId: '__settings__', title: 'Settings', type: 'market' },
        { sessionId: '__market__', title: 'Skills', type: 'settings' },
      ],
      activeTabId: '__settings__',
    }))

    runDesktopPersistenceMigrations()

    expect(JSON.parse(window.localStorage.getItem('echoflow-code-open-tabs') || '{}')).toEqual({
      openTabs: [
        { sessionId: '__settings__', title: 'Settings', type: 'settings' },
        { sessionId: '__market__', title: 'Skills', type: 'market' },
      ],
      activeTabId: '__settings__',
    })
  })

  test('filters stale session runtime selections without clearing unrelated keys', () => {
    window.localStorage.setItem('unrelated-user-key', 'keep')
    window.localStorage.setItem('echoflow-code-session-runtime', JSON.stringify({
      good: { providerId: null, modelId: 'claude-sonnet' },
      alsoGood: { providerId: 'openai-official', modelId: 'gpt-5.6-sol', effortLevel: 'xhigh' },
      bad: { providerId: 'provider-2' },
    }))

    runDesktopPersistenceMigrations()

    expect(JSON.parse(window.localStorage.getItem('echoflow-code-session-runtime') || '{}')).toEqual({
      alsoGood: { providerId: 'openai-official', modelId: 'gpt-5.6-sol', effortLevel: 'xhigh' },
      good: { providerId: null, modelId: 'claude-sonnet' },
    })
    expect(window.localStorage.getItem('unrelated-user-key')).toBe('keep')
  })

  test('removes malformed known keys without throwing during startup', () => {
    window.localStorage.setItem('echoflow-code-open-tabs', '{"openTabs":')
    window.localStorage.setItem('echoflow-code-theme', 'sepia')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-open-tabs')
    expect(report.migratedKeys).toContain('echoflow-code-theme')
    expect(window.localStorage.getItem('echoflow-code-open-tabs')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-theme')).toBeNull()
  })

  test('preserves the pure white theme as a valid persisted theme', () => {
    window.localStorage.setItem('echoflow-code-theme', 'white')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('echoflow-code-theme')
    expect(window.localStorage.getItem('echoflow-code-theme')).toBe('white')
  })

  test('renames the retired light theme to warm-classic instead of resetting it', () => {
    // `light` was the warm workspace, labelled 经典暖色 in the picker. Falling
    // through to the enum check would drop it and silently reset those
    // installs to pure white, which reads as the app forgetting the setting.
    window.localStorage.setItem('echoflow-code-theme', 'light')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-theme')
    expect(window.localStorage.getItem('echoflow-code-theme')).toBe('warm-classic')
  })

  test('applies the same rename to the light half of follow-the-system', () => {
    // The preference holds a theme name too, so a rename that only reached the
    // applied theme would silently reset which palette daytime returns to.
    window.localStorage.setItem('echoflow-code-light-theme', 'light')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-light-theme')
    expect(window.localStorage.getItem('echoflow-code-light-theme')).toBe('warm-classic')
  })

  test('preserves every palette introduced by the redesign', () => {
    for (const theme of ['white', 'paper', 'warm-classic', 'celadon', 'dark', 'ink-blue']) {
      window.localStorage.setItem('echoflow-code-theme', theme)

      const report = runDesktopPersistenceMigrations()

      expect(report.migratedKeys, `${theme} should survive startup migration`).not.toContain('echoflow-code-theme')
      expect(window.localStorage.getItem('echoflow-code-theme')).toBe(theme)
    }
  })

  test('drops a malformed follow-the-system flag rather than reading it as opted in', () => {
    // Anything but 0/1 has to go: an unset flag is how a fresh install is
    // recognised, and a junk value would make that inference unpredictable.
    window.localStorage.setItem('echoflow-code-follow-system-theme', 'yes')
    // A dark palette is not a valid light half, and vice versa.
    window.localStorage.setItem('echoflow-code-light-theme', 'ink-blue')
    window.localStorage.setItem('echoflow-code-dark-theme', 'celadon')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).toContain('echoflow-code-follow-system-theme')
    expect(report.migratedKeys).toContain('echoflow-code-light-theme')
    expect(report.migratedKeys).toContain('echoflow-code-dark-theme')
    expect(window.localStorage.getItem('echoflow-code-follow-system-theme')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-light-theme')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-dark-theme')).toBeNull()
  })

  test('preserves a valid follow-the-system flag and both ground preferences', () => {
    window.localStorage.setItem('echoflow-code-follow-system-theme', '1')
    window.localStorage.setItem('echoflow-code-light-theme', 'celadon')
    window.localStorage.setItem('echoflow-code-dark-theme', 'ink-blue')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('echoflow-code-follow-system-theme')
    expect(report.migratedKeys).not.toContain('echoflow-code-light-theme')
    expect(report.migratedKeys).not.toContain('echoflow-code-dark-theme')
    expect(window.localStorage.getItem('echoflow-code-follow-system-theme')).toBe('1')
    expect(window.localStorage.getItem('echoflow-code-light-theme')).toBe('celadon')
    expect(window.localStorage.getItem('echoflow-code-dark-theme')).toBe('ink-blue')
  })

  test('preserves every supported locale during startup migration', () => {
    for (const locale of ['en', 'zh', 'zh-TW', 'jp', 'kr']) {
      window.localStorage.setItem('echoflow-code-locale', locale)

      const report = runDesktopPersistenceMigrations()

      expect(report.migratedKeys).not.toContain('echoflow-code-locale')
      expect(window.localStorage.getItem('echoflow-code-locale')).toBe(locale)
    }
  })

  test('preserves valid app zoom and removes invalid app zoom values', () => {
    window.localStorage.setItem('echoflow-code-app-zoom', '1.2')

    const validReport = runDesktopPersistenceMigrations()

    expect(validReport.migratedKeys).not.toContain('echoflow-code-app-zoom')
    expect(window.localStorage.getItem('echoflow-code-app-zoom')).toBe('1.2')

    window.localStorage.setItem('echoflow-code-app-zoom', '4')

    const invalidReport = runDesktopPersistenceMigrations()

    expect(invalidReport.migratedKeys).toContain('echoflow-code-app-zoom')
    expect(window.localStorage.getItem('echoflow-code-app-zoom')).toBeNull()
  })

  test('does not auto-migrate legacy echoflow-code UI zoom storage', () => {
    window.localStorage.setItem('echoflow-code-ui-zoom', '1.25')

    const report = runDesktopPersistenceMigrations()

    expect(report.migratedKeys).not.toContain('echoflow-code-ui-zoom')
    expect(report.migratedKeys).not.toContain('echoflow-code-app-zoom')
    expect(window.localStorage.getItem('echoflow-code-app-zoom')).toBeNull()
    expect(window.localStorage.getItem('echoflow-code-ui-zoom')).toBe('1.25')
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
    expect(runDesktopPersistenceMigrations(storage).migratedKeys).toContain(DESKTOP_PERSISTENCE_VERSION_KEY)
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

    expect(report.migratedKeys).toEqual(expect.arrayContaining([
      'echoflow-code-open-tabs',
      'echoflow-code-session-runtime',
      'echoflow-code-theme',
      'echoflow-code-locale',
      'echoflow-code-app-zoom',
      DESKTOP_PERSISTENCE_VERSION_KEY,
    ]))
  })
})
