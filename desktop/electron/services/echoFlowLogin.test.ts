import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEDICATED_LOGIN_PROFILE,
  EchoFlowLoginSession,
  MAIN_LOGIN_PROFILE,
  parseDedicatedCredential,
  readDedicatedCredential,
  readPageIdentity,
  siteCookieHeader,
  type EchoFlowLoginCredential,
  type EchoFlowLoginProfile,
  type EchoFlowLoginVerification,
  type EchoFlowLoginWindow,
  type EchoFlowWindowOpenResult,
} from './echoFlowLogin'

class FakeLoginWindow implements EchoFlowLoginWindow {
  readonly navigation = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
  closed?: () => void
  windowOpen?: (details: { url: string }) => EchoFlowWindowOpenResult
  loadedUrl = ''
  focused = false
  closedCount = 0
  loadCount = 0
  loadAttempt?: () => Promise<void>
  loadFailed?: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void
  loadFinished?: () => void
  pageUrl = MAIN_LOGIN_PROFILE.url
  localStorageUser: string | null = null
  localStorage: Record<string, string | null> = {}
  // A page that rendered something; blank-page tests set this to ''.
  bodyText = 'sign in'
  credential: EchoFlowLoginCredential | null = null

  signIn(credential: EchoFlowLoginCredential) {
    this.credential = credential
  }

  webContents = {
    on: (event: 'will-navigate' | 'will-redirect' | 'did-fail-load' | 'did-finish-load', listener: (...args: never[]) => void) => {
      if (event === 'did-fail-load') this.loadFailed = listener as FakeLoginWindow['loadFailed']
      else if (event === 'did-finish-load') this.loadFinished = listener as FakeLoginWindow['loadFinished']
      else this.navigation.set(event, listener as (event: { preventDefault(): void }, url: string) => void)
    },
    setWindowOpenHandler: (handler: (details: { url: string }) => EchoFlowWindowOpenResult) => {
      this.windowOpen = handler
    },
    getURL: () => this.pageUrl,
    executeJavaScript: vi.fn(async (code: string, _userGesture?: boolean) => {
      if (code.includes('innerText')) return this.bodyText.trim().length
      // Mirrors the expression main.ts evaluates for the dedicated gateway.
      return code.includes('auth_token')
        ? {
            token: this.localStorage.auth_token ?? null,
            user: this.localStorage.auth_user ?? null,
            expiresAt: this.localStorage.token_expires_at ?? null,
          }
        : this.localStorageUser
    }),
  }

  on(event: 'closed', listener: () => void) {
    if (event === 'closed') this.closed = listener
  }

  async loadURL(url: string) {
    this.loadedUrl = url
    this.loadCount += 1
    await this.loadAttempt?.()
  }

  failLoad(errorCode: number, description: string, isMainFrame = true) {
    this.loadFailed?.({}, errorCode, description, this.loadedUrl, isMainFrame)
  }

  finishLoad() {
    this.loadFinished?.()
  }

  focus() {
    this.focused = true
  }

  close() {
    this.closedCount += 1
    this.closed?.()
  }

  navigate(event: 'will-navigate' | 'will-redirect', url: string) {
    const preventDefault = vi.fn()
    this.navigation.get(event)?.({ preventDefault }, url)
    return preventDefault
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const TEST_DEDICATED: EchoFlowLoginProfile = {
  endpoint: 'dedicated',
  url: 'https://gateway.example/login',
  origin: 'https://gateway.example',
  partition: 'persist:echoflow-dedicated-login',
  allowedHosts: new Set(),
}

type MakeLoginOptions = {
  persisted?: boolean
  readCredential?: (endpoint: 'main' | 'dedicated', window: EchoFlowLoginWindow | null) => Promise<EchoFlowLoginCredential | null>
  verifySession?: (endpoint: 'main' | 'dedicated', credential: EchoFlowLoginCredential) => Promise<EchoFlowLoginVerification>
  clearCookies?: (endpoint: 'main' | 'dedicated') => Promise<void>
  clearStorage?: (endpoint: 'main' | 'dedicated') => Promise<void>
  loadRetries?: number
  loadTimeoutMs?: number
  loginTimeoutMs?: number
}

function makeLogin(options: MakeLoginOptions = {}) {
  const window = new FakeLoginWindow()
  const createWindow = vi.fn(async () => window)
  const credential: EchoFlowLoginCredential = { kind: 'session', userId: '106452', username: 'site-user', cookie: 'session=live' }
  // A persisted credential belongs to the restore path; a live one appears
  // only after the page signs in, exactly like the real site.
  const readCredential = vi.fn(options.readCredential
    ?? (async (_endpoint: 'main' | 'dedicated', target: EchoFlowLoginWindow | null) =>
      (target as FakeLoginWindow | null)?.credential ?? (options.persisted ? credential : null)))
  const verifySession = vi.fn(options.verifySession ?? (async () => 'ok' as EchoFlowLoginVerification))
  const clearCookies = vi.fn(options.clearCookies ?? (async () => {}))
  const clearStorage = vi.fn(options.clearStorage ?? (async () => {}))
  const login = new EchoFlowLoginSession({
    createWindow,
    profiles: { main: MAIN_LOGIN_PROFILE, dedicated: TEST_DEDICATED },
    readCredential,
    verifySession,
    clearCookies,
    clearStorage,
    pollIntervalMs: 10,
    identityRetryMs: 10,
    loadTimeoutMs: options.loadTimeoutMs ?? 500,
    loginTimeoutMs: options.loginTimeoutMs ?? 2_000,
    loadRetryDelayMs: 5,
    loadRetries: options.loadRetries ?? 3,
  })
  return { login, window, createWindow, readCredential, verifySession, clearCookies, clearStorage, credential }
}

describe('EchoFlow site login session', () => {
  it('serializes only syntactically safe cookie pairs', () => {
    expect(siteCookieHeader([
      { name: 'session', value: 'opaque==' },
      { name: 'bad name', value: 'x' },
      { name: 'csrf', value: 'line\nbreak' },
    ])).toBe('session=opaque==')
  })

  it('opens the main profile in its own partition and authenticates from its credential', async () => {
    const { login, window, createWindow, verifySession, credential } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    expect(createWindow).toHaveBeenCalledWith('persist:echoflow-site-login')
    expect(window.loadedUrl).toBe('https://api.echoflowai.cc/login')

    window.signIn(credential)
    await expect(result).resolves.toBe('authenticated')
    expect(verifySession).toHaveBeenCalledWith('main', credential)
    expect(window.closedCount).toBe(1)
  })

  it('loads the profile of the endpoint it was opened for', async () => {
    const { login, window, createWindow } = makeLogin()
    const result = login.open('dedicated')
    await waitFor(() => window.loadCount === 1)

    expect(createWindow).toHaveBeenCalledWith('persist:echoflow-dedicated-login')
    expect(window.loadedUrl).toBe('https://gateway.example/login')

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('allows only the profile origin and its OAuth hosts to navigate the login window', async () => {
    const { login, window, createWindow } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)
    await waitFor(() => window.navigation.has('will-navigate'))

    expect(window.navigate('will-navigate', 'https://evil.example/callback')).toHaveBeenCalledOnce()
    expect(window.navigate('will-redirect', 'https://api.echoflowai.cc.evil.example/login')).toHaveBeenCalledOnce()
    expect(window.navigate('will-navigate', 'https://github.com/login/oauth/authorize')).not.toHaveBeenCalled()
    expect(window.navigate('will-redirect', 'https://accounts.google.com/o/oauth2/v2/auth')).not.toHaveBeenCalled()
    expect(window.navigate('will-navigate', 'https://oauth.telegram.org/auth')).not.toHaveBeenCalled()
    expect(window.navigate('will-redirect', 'https://api.echoflowai.cc/api/oauth/github/callback')).not.toHaveBeenCalled()

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('denies arbitrary popups and keeps OAuth popups inside the profile partition', async () => {
    const { login, window, createWindow } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)
    await waitFor(() => window.windowOpen !== undefined)

    expect(window.windowOpen!({ url: 'https://evil.example' })).toEqual({ action: 'deny' })
    const allowed = window.windowOpen!({ url: 'https://github.com/login/oauth/authorize' })
    expect(allowed.action).toBe('allow')
    if (allowed.action !== 'allow') throw new Error('expected GitHub to be allowed')
    expect((allowed.overrideBrowserWindowOptions?.webPreferences as { partition?: string } | undefined)?.partition)
      .toBe('persist:echoflow-site-login')

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('keeps waiting when the profile cannot resolve a credential', async () => {
    const { login, window, createWindow, verifySession } = makeLogin({
      readCredential: async () => null,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(verifySession).not.toHaveBeenCalled()
    expect(window.closedCount).toBe(0)

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('reloads a blank login page once, then fails instead of leaving a blank window', async () => {
    const { login, window, createWindow } = makeLogin()
    window.bodyText = ''
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)
    window.finishLoad()

    await waitFor(() => window.loadCount === 2)
    expect(window.loadedUrl).toBe('https://api.echoflowai.cc/login')

    // A second blank page is a real failure: leave the renderer waiting on a
    // window that can no longer paint or hand back a credential.
    await waitFor(() => window.closedCount === 1)
    await expect(result).resolves.toBe('failed')
    expect(window.loadCount).toBe(2)
  })

  it('keeps the login window open when session verification is unavailable', async () => {
    const { login, window, createWindow } = makeLogin({
      verifySession: async () => { throw new Error('offline') },
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(window.closedCount).toBe(0)

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('does not count an unverifiable credential as a rejection', async () => {
    let mode: EchoFlowLoginVerification = 'unavailable'
    const { login, window, createWindow, credential } = makeLogin({
      verifySession: async () => mode,
      loginTimeoutMs: 60_000,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.signIn(credential)
    // Several polls beyond the rejection budget: an unavailable bridge is not
    // a verdict, so the window must stay open rather than authenticate or fail.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(window.closedCount).toBe(0)
    let settled = false
    void result.then(() => { settled = true })
    expect(settled).toBe(false)

    mode = 'ok'
    await expect(result).resolves.toBe('authenticated')
    expect(window.closedCount).toBe(1)
  })

  it('clears a persisted credential when startup verification rejects it', async () => {
    const { login, verifySession, clearCookies, clearStorage } = makeLogin({
      persisted: true,
      verifySession: async () => 'rejected',
    })

    await expect(login.rehydrate('main')).resolves.toBe(false)
    expect(verifySession).toHaveBeenCalledOnce()
    expect(clearCookies).toHaveBeenCalledWith('main')
    expect(clearStorage).toHaveBeenCalledWith('main')
  })

  it('keeps a persisted credential when startup verification is unavailable', async () => {
    const { login, clearCookies, clearStorage } = makeLogin({
      persisted: true,
      verifySession: async () => 'unavailable',
    })

    await expect(login.rehydrate('main')).resolves.toBe(false)
    expect(clearCookies).not.toHaveBeenCalled()
    expect(clearStorage).not.toHaveBeenCalled()
  })

  it('fails after three rejected session bootstraps instead of waiting for the login timeout', async () => {
    const { login, window, createWindow, verifySession, clearCookies, clearStorage, credential } = makeLogin({
      verifySession: async () => 'rejected',
      loginTimeoutMs: 60_000,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.signIn(credential)
    await expect(result).resolves.toBe('failed')
    expect(verifySession).toHaveBeenCalledTimes(3)
    expect(window.closedCount).toBe(1)
    // The rejected credential is wiped before the window closes, so reopening
    // the login page cannot replay it.
    expect(clearCookies).toHaveBeenCalledWith('main')
    expect(clearStorage).toHaveBeenCalledWith('main')
  })

  it('retries a transient main-frame load failure instead of failing the login', async () => {
    const { login, window, createWindow, credential } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.failLoad(-21, 'ERR_NETWORK_CHANGED')
    expect(window.closedCount).toBe(0)
    await waitFor(() => window.loadCount === 2)

    window.signIn(credential)
    await expect(result).resolves.toBe('authenticated')
  })

  it('ignores aborted and subframe load failures', async () => {
    const { login, window, createWindow } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.failLoad(-3, 'ERR_ABORTED')
    window.failLoad(-21, 'ERR_NETWORK_CHANGED', false)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(window.loadCount).toBe(1)
    expect(window.closedCount).toBe(0)

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('fails the login after the load retries are exhausted', async () => {
    const { login, window, createWindow } = makeLogin({ loadRetries: 1 })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.failLoad(-21, 'ERR_NETWORK_CHANGED')
    await waitFor(() => window.loadCount === 2)
    window.failLoad(-21, 'ERR_NETWORK_CHANGED')

    await expect(result).resolves.toBe('failed')
    expect(window.closedCount).toBe(1)
  })

  it('fails instead of hanging when the page never finishes loading', async () => {
    const { login, window } = makeLogin({ loadTimeoutMs: 30 })
    const result = login.open()

    await expect(result).resolves.toBe('failed')
    expect(window.closedCount).toBe(1)
  })

  it('fails instead of hanging when no credential appears before the login timeout', async () => {
    const { login, window, createWindow } = makeLogin({
      readCredential: async () => null,
      loginTimeoutMs: 40,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.finishLoad()
    await expect(result).resolves.toBe('failed')
    expect(window.closedCount).toBe(1)
  })

  it('reuses one login window and resolves cancellation when the user closes it', async () => {
    const { login, window, createWindow } = makeLogin({ readCredential: async () => null })
    const first = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    const second = login.open()
    await waitFor(() => window.focused)
    expect(createWindow).toHaveBeenCalledOnce()

    window.close()
    await expect(first).resolves.toBe('cancelled')
    await expect(second).resolves.toBe('cancelled')
  })

  it('restores an existing main credential without opening the login window', async () => {
    const { login, createWindow, readCredential, verifySession, credential } = makeLogin({ persisted: true })

    await expect(login.open()).resolves.toBe('authenticated')
    expect(createWindow).not.toHaveBeenCalled()
    expect(readCredential).toHaveBeenCalledWith('main', null)
    expect(verifySession).toHaveBeenCalledWith('main', credential)
  })

  it('rehydrates an endpoint only after its credential verifies', async () => {
    const restored = makeLogin({ persisted: true })
    await expect(restored.login.rehydrate('main')).resolves.toBe(true)
    expect(restored.verifySession).toHaveBeenCalledWith('main', restored.credential)

    const empty = makeLogin({ readCredential: async () => null })
    await expect(empty.login.rehydrate('main')).resolves.toBe(false)

    const rejected = makeLogin({ verifySession: async () => 'rejected' })
    await expect(rejected.login.rehydrate('main')).resolves.toBe(false)
  })

  it('clears only the endpoint it was asked to sign out of', async () => {
    const { login, window, createWindow, clearCookies, clearStorage } = makeLogin({ readCredential: async () => null })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    await login.clear('main')
    await expect(result).resolves.toBe('cancelled')
    expect(clearCookies).toHaveBeenCalledWith('main')
    // The gateway keeps its token in page storage, so clearing cookies alone
    // would let the next login silently reuse the signed-out account.
    expect(clearStorage).toHaveBeenCalledWith('main')
    expect(window.closedCount).toBe(1)
  })

  it('reads the identity the main site stores in its own page', async () => {
    const { window } = makeLogin()
    window.localStorageUser = JSON.stringify({ id: 2001, username: 'page-user' })

    await expect(readPageIdentity(window, MAIN_LOGIN_PROFILE.origin))
      .resolves.toEqual({ userId: '2001', username: 'page-user' })
  })

  it('ignores a page identity read from another origin', async () => {
    const { window } = makeLogin()
    window.localStorageUser = JSON.stringify({ id: 2001, username: 'page-user' })
    window.pageUrl = 'https://evil.example/login'

    await expect(readPageIdentity(window, MAIN_LOGIN_PROFILE.origin)).resolves.toBeNull()
  })

  it('keeps the dedicated profile on the gateway origin', () => {
    expect(DEDICATED_LOGIN_PROFILE.url).toBe('https://expapi.echoflowai.cc/login')
    expect(DEDICATED_LOGIN_PROFILE.origin).toBe('https://expapi.echoflowai.cc')
    expect(DEDICATED_LOGIN_PROFILE.partition).toBe('persist:echoflow-dedicated-login')
  })
})

const realSetImmediate = setImmediate

// Bun lacks the async timer API; drain promises between steps to preserve retry ordering.
async function advanceTime(milliseconds: number): Promise<void> {
  for (let elapsed = 0; elapsed <= milliseconds; elapsed++) {
    vi.advanceTimersByTime(elapsed === 0 ? 0 : 1)
    await new Promise<void>(resolve => realSetImmediate(resolve))
  }
}

describe('login navigation and restoration regressions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('starts blank recovery when loadURL resolves without did-finish-load and fails a second blank page', async () => {
    const { login, window } = makeLogin()
    window.bodyText = ''
    const result = login.open()
    const settled = vi.fn()
    void result.then(settled)
    await advanceTime(100)

    expect(window.loadCount).toBe(2)
    expect(window.closedCount).toBe(1)
    expect(settled).toHaveBeenCalledWith('failed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the event-scheduled retry when the same loadURL also rejects', async () => {
    const { login, window, credential } = makeLogin()
    window.loadAttempt = async () => {
      if (window.loadCount === 1) {
        window.failLoad(-21, 'ERR_NETWORK_CHANGED')
        throw new Error('ERR_NETWORK_CHANGED')
      }
      window.finishLoad()
      window.signIn(credential)
    }
    const result = login.open()
    await advanceTime(0)
    expect(window.closedCount).toBe(0)
    await advanceTime(10)
    await expect(result).resolves.toBe('authenticated')
    expect(window.loadCount).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a late failure event paired with an earlier loadURL rejection', async () => {
    const { login, window, credential } = makeLogin()
    window.loadAttempt = async () => {
      if (window.loadCount === 1) {
        setTimeout(() => window.failLoad(-21, 'ERR_NETWORK_CHANGED'), 1)
        throw new Error('ERR_NETWORK_CHANGED')
      }
      window.finishLoad()
      window.signIn(credential)
    }
    const result = login.open()
    await advanceTime(0)
    expect(window.closedCount).toBe(0)
    await advanceTime(10)
    await expect(result).resolves.toBe('authenticated')
    expect(window.loadCount).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['main', 'dedicated'] as const)('bounds offline retries for %s when error documents finish loading', async endpoint => {
    const { login, window, clearCookies, clearStorage } = makeLogin({ loadRetries: 2 })
    window.loadAttempt = async () => {
      window.failLoad(-106, 'ERR_INTERNET_DISCONNECTED')
      window.finishLoad()
      throw new Error('ERR_INTERNET_DISCONNECTED')
    }
    const settled = vi.fn()
    void login.open(endpoint).then(settled)
    await advanceTime(100)

    expect(window.loadCount).toBe(3)
    expect(window.closedCount).toBe(1)
    expect(settled).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledWith('failed')
    expect(vi.getTimerCount()).toBe(0)
    expect(clearCookies).not.toHaveBeenCalled()
    expect(clearStorage).not.toHaveBeenCalled()
  })

  it.each(['main', 'dedicated'] as const)('preserves the %s load timeout after an error document finishes', async endpoint => {
    const { login, window } = makeLogin({ loadTimeoutMs: 2 })
    window.loadAttempt = async () => {
      window.failLoad(-106, 'ERR_INTERNET_DISCONNECTED')
      window.finishLoad()
      throw new Error('ERR_INTERNET_DISCONNECTED')
    }
    const settled = vi.fn()
    void login.open(endpoint).then(settled)
    await advanceTime(3)

    expect(window.loadCount).toBe(1)
    expect(window.closedCount).toBe(1)
    expect(settled).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledWith('failed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds paired event/promise failures and gives a new window a fresh retry budget', async () => {
    const { login, window, credential } = makeLogin({ loadRetries: 2 })
    window.loadAttempt = async () => {
      window.failLoad(-21, 'ERR_NETWORK_CHANGED')
      throw new Error('ERR_NETWORK_CHANGED')
    }
    const first = login.open()
    await advanceTime(100)
    await expect(first).resolves.toBe('failed')
    expect(window.loadCount).toBe(3)
    expect(window.closedCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    window.loadAttempt = async () => {
      if (window.loadCount === 4) {
        window.failLoad(-21, 'ERR_NETWORK_CHANGED')
        throw new Error('ERR_NETWORK_CHANGED')
      }
      window.finishLoad()
      window.signIn(credential)
    }
    const second = login.open()
    await advanceTime(10)
    await expect(second).resolves.toBe('authenticated')
    expect(window.loadCount).toBe(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['initial', 'retry', 'blank reload'] as const)('fails a %s promise rejection with no retry event', async phase => {
    const { login, window } = makeLogin()
    window.loadAttempt = async () => {
      if (phase === 'initial' || window.loadCount === 2) throw new Error('load rejected without event')
      if (phase === 'retry') window.failLoad(-21, 'ERR_NETWORK_CHANGED')
      else {
        window.bodyText = ''
        window.finishLoad()
      }
    }
    const result = login.open()
    const settled = vi.fn()
    void result.then(settled)
    await advanceTime(40)
    expect(settled).toHaveBeenCalledWith('failed')
    expect(window.loadCount).toBe(phase === 'initial' ? 1 : 2)
    expect(window.closedCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['close', 'load timeout', 'login timeout'] as const)('cancels a scheduled retry on %s', async reason => {
    const { login, window } = makeLogin({
      loadTimeoutMs: reason === 'load timeout' ? 2 : 500,
      loginTimeoutMs: reason === 'login timeout' ? 2 : 2_000,
    })
    window.loadAttempt = async () => {
      window.failLoad(-21, 'ERR_NETWORK_CHANGED')
      throw new Error('ERR_NETWORK_CHANGED')
    }
    const result = login.open()
    await advanceTime(0)
    expect(window.closedCount).toBe(0)
    if (reason === 'close') window.close()
    await advanceTime(100)
    await expect(result).resolves.toBe(reason === 'close' ? 'cancelled' : 'failed')
    expect(window.loadCount).toBe(1)
    expect(window.closedCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  describe.each(['main', 'dedicated'] as const)('%s previously verified session', endpoint => {
    it.each(['missing', 'rejected', 'unavailable', 'read error'] as const)('can authenticate interactively after %s restoration without clearing the other endpoint', async failure => {
      const otherEndpoint = endpoint === 'main' ? 'dedicated' : 'main'
      const persisted: EchoFlowLoginCredential = endpoint === 'main'
        ? { kind: 'session', userId: '1', cookie: 'session=old' }
        : { kind: 'bearer', userId: '1', accessToken: 'old-token' }
      const fresh: EchoFlowLoginCredential = endpoint === 'main'
        ? { kind: 'session', userId: '2', cookie: 'session=fresh' }
        : { kind: 'bearer', userId: '2', accessToken: 'fresh-token' }
      let invalid = false
      const { login, window, clearCookies, clearStorage, verifySession } = makeLogin({
        readCredential: async (requested, target) => {
          if (target) return (target as FakeLoginWindow).credential
          if (invalid && requested === endpoint) {
            if (failure === 'missing') return null
            if (failure === 'read error') throw new Error('fixture read failure')
          }
          return persisted
        },
        verifySession: async (requested, credential) => {
          if (invalid && requested === endpoint && credential === persisted) {
            return failure === 'unavailable' ? 'unavailable' : 'rejected'
          }
          return 'ok'
        },
      })
      await expect(login.open(endpoint)).resolves.toBe('authenticated')
      await expect(login.open(otherEndpoint)).resolves.toBe('authenticated')
      invalid = true
      const result = login.open(endpoint)
      const settled = vi.fn()
      void result.then(settled)
      await advanceTime(0)
      expect(window.loadCount).toBe(1)
      window.signIn(fresh)
      await advanceTime(10)
      expect(settled).toHaveBeenCalledWith('authenticated')
      expect(verifySession).toHaveBeenCalledWith(endpoint, fresh)
      expect(vi.getTimerCount()).toBe(0)
      const clearedEndpoints = failure === 'rejected' ? [[endpoint]] : []
      expect(clearCookies.mock.calls).toEqual(clearedEndpoints)
      expect(clearStorage.mock.calls).toEqual(clearedEndpoints)
      await expect(login.open(otherEndpoint)).resolves.toBe('authenticated')
      expect(window.loadCount).toBe(1)
    })
  })
})

describe('dedicated gateway credential', () => {
  it('reads the gateway access token and its user from the login page storage', async () => {
    const window = new FakeLoginWindow()
    window.pageUrl = DEDICATED_LOGIN_PROFILE.url
    window.localStorage = {
      auth_token: 'jwt-access-token',
      auth_user: JSON.stringify({ id: 7, username: 'gateway-user' }),
      token_expires_at: String(Date.now() + 60_000),
    }

    await expect(readDedicatedCredential(window, DEDICATED_LOGIN_PROFILE.origin)).resolves.toEqual({
      kind: 'bearer',
      userId: '7',
      username: 'gateway-user',
      accessToken: 'jwt-access-token',
    })
  })

  it('ignores an expired gateway token so the login keeps waiting for a fresh one', async () => {
    const expiredSeconds = String(Math.floor((Date.now() - 60_000) / 1000))
    await expect(parseDedicatedCredential({
      token: 'jwt-access-token',
      user: '{"id":7}',
      expiresAt: expiredSeconds,
    })).toBeNull()
  })

  it('refuses a gateway session that carries no user id', async () => {
    await expect(parseDedicatedCredential({
      token: 'jwt-access-token',
      user: '{"username":"gateway-user"}',
      expiresAt: null,
    })).toBeNull()
  })

  it('ignores storage from a page that is not the dedicated origin', async () => {
    const window = new FakeLoginWindow()
    window.pageUrl = MAIN_LOGIN_PROFILE.url
    window.localStorage = { auth_token: 'jwt-access-token', auth_user: '{"id":7}' }

    await expect(readDedicatedCredential(window, DEDICATED_LOGIN_PROFILE.origin)).resolves.toBeNull()
  })
})
