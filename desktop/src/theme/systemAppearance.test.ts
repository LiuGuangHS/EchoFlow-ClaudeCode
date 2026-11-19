import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DARK_SCHEME_QUERY,
  readThemeSnapshot,
  updateThemePreferences,
  THEME_PREFERENCES_STORAGE_KEY,
  THEME_MIRROR_KEYS,
  type ThemePreferences,
  getSystemAppearance,
  readStoredDarkTheme,
  readStoredFollowSystemTheme,
  readStoredLightTheme,
  readStoredTheme,
  resolveAppliedTheme,
  subscribeSystemAppearance,
} from './systemAppearance'

type Listener = (event: { matches: boolean }) => void

/** Install a matchMedia jsdom does not ship, in either of its two API shapes. */
function stubMatchMedia(matches: boolean, api: 'modern' | 'legacy' = 'modern') {
  const listeners = new Set<Listener>()
  const query = api === 'modern'
    ? {
        matches,
        media: DARK_SCHEME_QUERY,
        addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
        removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      }
    : {
        matches,
        media: DARK_SCHEME_QUERY,
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      }

  const matchMedia = vi.fn(() => query as unknown as MediaQueryList)
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })

  return {
    matchMedia,
    emit: (nextMatches: boolean) => {
      for (const listener of listeners) listener({ matches: nextMatches })
    },
    listenerCount: () => listeners.size,
  }
}

function clearMatchMedia() {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia')
}

afterEach(() => {
  clearMatchMedia()
  window.localStorage.clear()
})

describe('resolveAppliedTheme', () => {
  it('returns the manual pick untouched when not following the system', () => {
    for (const systemAppearance of ['dark', 'light'] as const) {
      expect(resolveAppliedTheme({
        followSystem: false,
        theme: 'warm-classic',
        lightTheme: 'white',
        darkTheme: 'dark',
        systemAppearance,
      })).toBe('warm-classic')
    }
  })

  it('resolves each ground to the palette chosen for it', () => {
    // Two palettes sit on each ground, so a dark OS does not simply mean the
    // one literally named `dark`.
    expect(resolveAppliedTheme({
      followSystem: true,
      theme: 'white',
      lightTheme: 'celadon',
      darkTheme: 'ink-blue',
      systemAppearance: 'dark',
    })).toBe('ink-blue')

    expect(resolveAppliedTheme({
      followSystem: true,
      theme: 'white',
      lightTheme: 'celadon',
      darkTheme: 'ink-blue',
      systemAppearance: 'light',
    })).toBe('celadon')
  })

  it('resolves a ground to its preference, not to the last applied palette', () => {
    // Evening: the app is on ink-blue. Morning: it must return to warm
    // classic rather than to the palette it happens to be sitting on.
    expect(resolveAppliedTheme({
      followSystem: true,
      theme: 'ink-blue',
      lightTheme: 'warm-classic',
      darkTheme: 'ink-blue',
      systemAppearance: 'light',
    })).toBe('warm-classic')
  })
})

describe('getSystemAppearance', () => {
  it('reports dark when the OS prefers dark', () => {
    stubMatchMedia(true)
    expect(getSystemAppearance()).toBe('dark')
  })

  it('reports light when the OS prefers light', () => {
    stubMatchMedia(false)
    expect(getSystemAppearance()).toBe('light')
  })

  it('falls back to light where matchMedia is unavailable', () => {
    clearMatchMedia()
    expect(getSystemAppearance()).toBe('light')
  })

  it('falls back to light when the query itself throws', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: () => { throw new Error('unsupported query') },
      configurable: true,
      writable: true,
    })
    expect(getSystemAppearance()).toBe('light')
  })
})

describe('subscribeSystemAppearance', () => {
  it('reports OS flips and detaches on unsubscribe', () => {
    const media = stubMatchMedia(false)
    const onChange = vi.fn()

    const unsubscribe = subscribeSystemAppearance(onChange)
    media.emit(true)
    expect(onChange).toHaveBeenCalledWith('dark')

    media.emit(false)
    expect(onChange).toHaveBeenLastCalledWith('light')

    unsubscribe()
    expect(media.listenerCount()).toBe(0)
  })

  it('supports the deprecated addListener pair used by older WebKit', () => {
    const media = stubMatchMedia(false, 'legacy')
    const onChange = vi.fn()

    const unsubscribe = subscribeSystemAppearance(onChange)
    media.emit(true)
    expect(onChange).toHaveBeenCalledWith('dark')

    unsubscribe()
    expect(media.listenerCount()).toBe(0)
  })

  it('returns a usable unsubscribe where matchMedia is unavailable', () => {
    clearMatchMedia()
    expect(() => subscribeSystemAppearance(vi.fn())()).not.toThrow()
  })
})

describe('versioned theme authority and bounded mirror recovery', () => {
  const target: ThemePreferences = { theme: 'celadon', lightTheme: 'celadon', darkTheme: 'ink-blue', followSystem: false }
  const targetTuple = ['celadon', 'celadon', 'ink-blue', '0']
  const baseline = ['paper', 'paper', 'dark', '1']

  function fixture() {
    const data = new Map<string, string>(THEME_MIRROR_KEYS.map((key, i) => [key, baseline[i]!]))
    let failKey: string | null = null
    let recordWrites = 0
    let failCompletion = false
    const writes: string[] = []
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push(key)
        if (key === THEME_PREFERENCES_STORAGE_KEY) recordWrites++
        if (key === failKey || (failCompletion && recordWrites === 2)) throw new Error('fixture write failure')
        data.set(key, value)
      },
    }
    return { data, storage, writes, fail: (key: string | null) => { failKey = key }, completionFailure: () => { failCompletion = true } }
  }

  it('does not touch any mirror if the initial authority write fails', () => {
    const f = fixture()
    f.fail(THEME_PREFERENCES_STORAGE_KEY)
    expect(updateThemePreferences(() => target, f.storage)).toEqual({ status: 'failed', stage: 'record', key: THEME_PREFERENCES_STORAGE_KEY })
    expect(f.writes).toEqual([THEME_PREFERENCES_STORAGE_KEY])
    expect(THEME_MIRROR_KEYS.map(key => f.storage.getItem(key))).toEqual(baseline)
  })

  it.each([0, 1, 2, 3])('recovers mirror failure %s after recreation, preserving the committed target and extensions', (index) => {
    const f = fixture()
    f.data.set(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, ...target, theme: 'paper', lightTheme: 'paper', darkTheme: 'dark', followSystem: true, extra: { keep: true }, mirrorSync: { baseline, pending: false, note: 'retain' } }))
    f.fail(THEME_MIRROR_KEYS[index]!)
    expect(updateThemePreferences(() => target, f.storage)).toEqual({ status: 'pending', stage: 'mirror', key: THEME_MIRROR_KEYS[index] })
    expect(f.writes).toEqual([THEME_PREFERENCES_STORAGE_KEY, ...THEME_MIRROR_KEYS.slice(0, index + 1)])
    expect(readThemeSnapshot(f.storage).preferences).toEqual(target)
    f.fail(null)
    // A new reader/writer instance has only the persisted bytes as evidence.
    expect(updateThemePreferences(p => p, { ...f.storage })).toEqual({ status: 'saved' })
    expect(THEME_MIRROR_KEYS.map(key => f.storage.getItem(key))).toEqual(targetTuple)
    expect(JSON.parse(f.storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)).toEqual({ version: 1, ...target, extra: { keep: true }, mirrorSync: { baseline: targetTuple, pending: false, note: 'retain' } })
  })

  it('keeps completion failure pending and retries only the completion record', () => {
    const f = fixture()
    f.completionFailure()
    expect(updateThemePreferences(() => target, f.storage)).toEqual({ status: 'pending', stage: 'completion', key: THEME_PREFERENCES_STORAGE_KEY })
    expect(JSON.parse(f.storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!).mirrorSync.pending).toBe(true)
    f.writes.length = 0
    expect(updateThemePreferences(p => p, f.storage)).toEqual({ status: 'saved' })
    expect(f.writes).toEqual([THEME_PREFERENCES_STORAGE_KEY])
  })

  it('imports sequential scalar-only downgrade edits and retains unknown fields', () => {
    const f = fixture()
    expect(updateThemePreferences(() => target, f.storage).status).toBe('saved')
    const record = JSON.parse(f.storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)
    f.data.set(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...record, extra: 'keep', mirrorSync: { ...record.mirrorSync, note: 7 } }))
    f.data.set(THEME_MIRROR_KEYS[0]!, 'paper')
    f.data.set(THEME_MIRROR_KEYS[1]!, 'paper')
    expect(readThemeSnapshot(f.storage).preferences).toEqual({ ...target, theme: 'paper', lightTheme: 'paper' })
    expect(updateThemePreferences(p => p, f.storage).status).toBe('saved')
    expect(JSON.parse(f.storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)).toMatchObject({ extra: 'keep', theme: 'paper', mirrorSync: { pending: false, note: 7 } })
  })

  it.each([
    ['celadon', 'paper', 'ink-blue', '1'], // Per-field baseline/target is not necessarily a prefix.
    ['ink-blue', 'paper', 'dark', '1'],
  ])('preserves all bytes for an out-of-prefix external edit %j', (...tuple) => {
    const f = fixture()
    f.fail(THEME_MIRROR_KEYS[1]!)
    updateThemePreferences(() => target, f.storage)
    tuple.forEach((value, i) => f.data.set(THEME_MIRROR_KEYS[i]!, value))
    const before = [...f.data]
    f.writes.length = 0
    f.fail(null)
    expect(updateThemePreferences(p => p, f.storage)).toEqual({ status: 'blocked', reason: 'conflicting-mirrors' })
    expect([...f.data]).toEqual(before)
    expect(f.writes).toEqual([])
    expect(readThemeSnapshot(f.storage).preferences).toEqual(target)
  })

  it.each(['future', 'corrupt', 'invalid-sync', 'pending-invalid-preferences', 'record-read', 'mirror-read'])('blocks all writes for %s without treating a failed read as absence', (kind) => {
    const f = fixture()
    const record = { version: 1, ...target, mirrorSync: { baseline, pending: false } }
    f.data.set(THEME_PREFERENCES_STORAGE_KEY, kind === 'future' ? '{"version":2,"opaque":true}' : kind === 'corrupt' ? '{bad' : JSON.stringify(kind === 'invalid-sync' ? { ...record, mirrorSync: {} } : kind === 'pending-invalid-preferences' ? { ...record, theme: 'neon', mirrorSync: { baseline, pending: true } } : record))
    const storage = { ...f.storage, getItem: (key: string) => {
      if ((kind === 'record-read' && key === THEME_PREFERENCES_STORAGE_KEY) || (kind === 'mirror-read' && key === THEME_MIRROR_KEYS[2])) throw new Error('fixture read failure')
      return f.storage.getItem(key)
    } }
    const before = [...f.data]
    expect(updateThemePreferences(() => target, storage).status).toBe('blocked')
    expect(f.writes).toEqual([])
    expect([...f.data]).toEqual(before)
    if (kind === 'mirror-read') expect(readThemeSnapshot(storage).preferences).toEqual(target)
  })

  it.each(THEME_MIRROR_KEYS)('blocks the whole domain for an incomplete read of %s, with and without an authority record', (failedKey) => {
    for (const present of [false, true]) {
      const f = fixture()
      if (present) f.data.set(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, ...target, mirrorSync: { baseline, pending: false } }))
      const storage = { ...f.storage, getItem: (key: string) => {
        if (key === failedKey) throw new Error('fixture partial read')
        return f.storage.getItem(key)
      } }
      const before = [...f.data]
      expect(readThemeSnapshot(storage).persistence).toEqual({ status: 'blocked', reason: 'incomplete-mirrors' })
      expect(updateThemePreferences(() => target, storage)).toEqual({ status: 'blocked', reason: 'incomplete-mirrors' })
      expect(f.writes).toEqual([])
      expect([...f.data]).toEqual(before)
      if (present) expect(readThemeSnapshot(storage).preferences).toEqual(target)
    }
  })

  it('updates sync evidence when a clean downgrade edit already matches the record preferences', () => {
    const f = fixture()
    f.data.set(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, ...target, mirrorSync: { baseline, pending: false } }))
    targetTuple.forEach((value, i) => f.data.set(THEME_MIRROR_KEYS[i]!, value))
    expect(updateThemePreferences(p => p, f.storage)).toEqual({ status: 'saved' })
    expect(JSON.parse(f.storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!).mirrorSync).toEqual({ baseline: targetTuple, pending: false })
    expect(f.writes).toEqual([THEME_PREFERENCES_STORAGE_KEY, THEME_PREFERENCES_STORAGE_KEY])
  })

  it('finishes the previous immutable target before accepting a subsequent update', () => {
    const f = fixture()
    f.fail(THEME_MIRROR_KEYS[2]!)
    updateThemePreferences(() => target, f.storage)
    f.fail(null)
    const records: Array<Record<string, unknown>> = []
    expect(updateThemePreferences(current => {
      expect(current).toEqual(target)
      return { ...current, theme: 'paper', lightTheme: 'paper' }
    }, { ...f.storage, setItem: (key, value) => {
      if (key === THEME_PREFERENCES_STORAGE_KEY) records.push(JSON.parse(value))
      f.storage.setItem(key, value)
    } })).toEqual({ status: 'saved' })
    expect(records).toMatchObject([
      { ...target, mirrorSync: { pending: false, baseline: targetTuple } },
      { theme: 'paper', lightTheme: 'paper', mirrorSync: { pending: true, baseline: targetTuple } },
      { theme: 'paper', lightTheme: 'paper', mirrorSync: { pending: false, baseline: ['paper', 'paper', 'ink-blue', '0'] } },
    ])
  })

  it('normalizes supported clean preference fields without inventing sync evidence', () => {
    const f = fixture()
    f.data.set(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, theme: 'neon', lightTheme: 'ink-blue', darkTheme: 'celadon', followSystem: 'yes', mirrorSync: { baseline, pending: false } }))
    expect(readThemeSnapshot(f.storage).preferences).toEqual({ theme: 'white', lightTheme: 'white', darkTheme: 'dark', followSystem: false })
    expect(updateThemePreferences(p => p, f.storage).status).toBe('saved')
  })
})

describe('stored appearance preferences', () => {
  it('follows the system on a fresh install', () => {
    expect(readStoredFollowSystemTheme(window.localStorage)).toBe(true)
  })

  it('leaves an existing install on its fixed theme until it opts in', () => {
    // Upgrading must never silently repaint someone's app.
    window.localStorage.setItem('echoflow-code-theme', 'warm-classic')
    expect(readStoredFollowSystemTheme(window.localStorage)).toBe(false)
  })

  it('honours an explicit opt-in and opt-out', () => {
    window.localStorage.setItem('echoflow-code-theme', 'warm-classic')
    window.localStorage.setItem('echoflow-code-follow-system-theme', '1')
    expect(readStoredFollowSystemTheme(window.localStorage)).toBe(true)

    window.localStorage.setItem('echoflow-code-follow-system-theme', '0')
    expect(readStoredFollowSystemTheme(window.localStorage)).toBe(false)
  })

  it('seeds each ground from a manual theme sitting on it', () => {
    window.localStorage.setItem('echoflow-code-theme', 'celadon')
    expect(readStoredLightTheme(window.localStorage)).toBe('celadon')

    window.localStorage.setItem('echoflow-code-theme', 'ink-blue')
    expect(readStoredDarkTheme(window.localStorage)).toBe('ink-blue')
  })

  it('falls back to the defaults when the manual theme is on the other ground', () => {
    window.localStorage.setItem('echoflow-code-theme', 'ink-blue')
    expect(readStoredLightTheme(window.localStorage)).toBe('white')

    window.localStorage.setItem('echoflow-code-theme', 'celadon')
    expect(readStoredDarkTheme(window.localStorage)).toBe('dark')
  })

  it('rejects stored values outside their own ground', () => {
    window.localStorage.setItem('echoflow-code-theme', 'solarized')
    window.localStorage.setItem('echoflow-code-light-theme', 'ink-blue')
    window.localStorage.setItem('echoflow-code-dark-theme', 'celadon')

    expect(readStoredTheme(window.localStorage)).toBe('white')
    expect(readStoredLightTheme(window.localStorage)).toBe('white')
    expect(readStoredDarkTheme(window.localStorage)).toBe('dark')
  })

  it('survives storage that throws instead of returning a value', () => {
    const storage = {
      getItem: () => { throw new Error('storage disabled') },
      setItem: () => {},
    }

    expect(readStoredTheme(storage)).toBe('white')
    expect(readStoredLightTheme(storage)).toBe('white')
    expect(readStoredDarkTheme(storage)).toBe('dark')
    expect(readStoredFollowSystemTheme(storage)).toBe(true)
  })
})
