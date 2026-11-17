import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getInitialLocale,
  initializeLocale,
  migrateLegacyLocalePreference,
  readStoredLocale,
  resolveSupportedLocale,
  subscribeLocaleChanges,
} from './locale'

function mockBrowserLanguages(languages: string[], language = languages[0] ?? '') {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(language)
}

describe('locale detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it.each([null, '8'])('restores a legacy Chinese choice before English browser detection for schema %s', async (version) => {
    mockBrowserLanguages(['en-US'])
    if (version !== null) localStorage.setItem('cc-haha.persistence.schemaVersion', version)
    localStorage.setItem('echoflow-code-locale', 'zh')
    const host = {
      getLocalePreference: vi.fn().mockResolvedValue(null),
      getPreferredSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    }

    expect(getInitialLocale()).toBe('zh')
    await expect(initializeLocale(host)).resolves.toBe('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(host.setLocalePreference).toHaveBeenCalledWith('zh')
    expect(localStorage.getItem('cc-haha-locale')).toBe('zh')
    expect(localStorage.getItem('echoflow-code-locale')).toBe('zh')
  })

  it('prefers the current locale over the retained legacy choice', async () => {
    localStorage.setItem('echoflow-code-locale', 'zh')
    localStorage.setItem('cc-haha-locale', 'kr')
    await expect(initializeLocale({
      getLocalePreference: vi.fn().mockResolvedValue(null),
      getPreferredSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    })).resolves.toBe('kr')
    expect(localStorage.getItem('echoflow-code-locale')).toBe('zh')
  })

  it('does not revive an eagerly imported locale when another migration keeps the global schema old', () => {
    localStorage.setItem('cc-haha.persistence.schemaVersion', '8')
    localStorage.setItem('echoflow-code-locale', 'zh')
    expect(readStoredLocale()).toBe('zh')
    localStorage.removeItem('cc-haha-locale')
    expect(readStoredLocale()).toBeNull()
    expect(localStorage.getItem('echoflow-code-locale')).toBe('zh')
  })

  it('retries an eager target failure without importing through an unreadable schema', () => {
    localStorage.setItem('echoflow-code-locale', 'zh')
    const setItem = localStorage.setItem.bind(localStorage)
    expect(() => migrateLegacyLocalePreference({
      getItem: localStorage.getItem.bind(localStorage),
      setItem: (key, value) => {
        if (key === 'cc-haha-locale') throw new Error('quota')
        setItem(key, value)
      },
    })).toThrow()
    expect(readStoredLocale()).toBe('zh')
    const write = vi.fn()
    expect(() => migrateLegacyLocalePreference({
      getItem: () => { throw new Error('schema unavailable') },
      setItem: write,
    })).toThrow()
    expect(write).not.toHaveBeenCalled()
  })

  it('leaves a future global schema and all locale bytes untouched during eager reads', () => {
    localStorage.setItem('cc-haha.persistence.schemaVersion', ' 10\n')
    localStorage.setItem('echoflow-code-locale', 'zh')
    const before = { ...localStorage }
    expect(readStoredLocale()).toBeNull()
    expect({ ...localStorage }).toEqual(before)
  })

  it('normalizes BCP 47 tags and selects the first supported language', () => {
    expect(resolveSupportedLocale(['fr-FR', 'zh_Hant_HK', 'en-US'])).toBe('zh-TW')
    expect(resolveSupportedLocale(['zh-Hans-HK'])).toBe('zh')
  })

  it('uses Electron preferred system languages before the renderer fallback', async () => {
    mockBrowserLanguages(['en-US'])
    const host = {
      getLocalePreference: vi.fn().mockResolvedValue(null),
      getPreferredSystemLanguages: vi.fn().mockResolvedValue(['fr-FR', 'ko-KR']),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    }

    await expect(initializeLocale(host)).resolves.toBe('kr')

    expect(document.documentElement.lang).toBe('ko')
  })

  it('falls back to renderer languages when the native lookup fails', async () => {
    mockBrowserLanguages(['ja-JP'])

    await expect(initializeLocale({
      getLocalePreference: () => Promise.reject(new Error('IPC unavailable')),
      getPreferredSystemLanguages: () => Promise.reject(new Error('IPC unavailable')),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    })).resolves.toBe('jp')

    expect(document.documentElement.lang).toBe('ja')
  })

  it('migrates a stored main-window choice without consulting the system again', async () => {
    window.localStorage.setItem('cc-haha-locale', 'zh-TW')
    const host = {
      getLocalePreference: vi.fn().mockResolvedValue(null),
      getPreferredSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    }

    await expect(initializeLocale(host)).resolves.toBe('zh-TW')

    expect(host.setLocalePreference).toHaveBeenCalledWith('zh-TW')
    expect(host.getLocalePreference).not.toHaveBeenCalled()
    expect(host.getPreferredSystemLanguages).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe('zh-TW')
  })

  it('uses the app-level manual preference in an isolated companion partition', async () => {
    mockBrowserLanguages(['zh-CN'])

    await expect(initializeLocale({
      getLocalePreference: vi.fn().mockResolvedValue('jp'),
      getPreferredSystemLanguages: vi.fn().mockResolvedValue(['zh-CN']),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    })).resolves.toBe('jp')

    expect(document.documentElement.lang).toBe('ja')
  })

  it('applies app-level locale changes to an already running companion window', async () => {
    let onLocaleChanged: ((locale: 'kr') => void) | undefined
    const listener = vi.fn()
    const unsubscribe = subscribeLocaleChanges(listener)

    await initializeLocale({
      getLocalePreference: vi.fn().mockResolvedValue('en'),
      getPreferredSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn(async (handler) => {
        onLocaleChanged = handler
        return () => {}
      }),
    })

    onLocaleChanged?.('kr')

    expect(listener).toHaveBeenLastCalledWith('kr')
    expect(document.documentElement.lang).toBe('ko')
    unsubscribe()
  })

  it('uses navigator.language when navigator.languages is unavailable', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockImplementation(() => {
      throw new Error('languages unavailable')
    })
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('ja-JP')

    await expect(initializeLocale({
      getLocalePreference: vi.fn().mockResolvedValue(null),
      getPreferredSystemLanguages: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
      setLocalePreference: vi.fn().mockResolvedValue(undefined),
      onLocaleChanged: vi.fn().mockResolvedValue(() => {}),
    })).resolves.toBe('jp')
  })
})
