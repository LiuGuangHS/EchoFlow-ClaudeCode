import { describe, expect, it, vi } from 'vitest'
import {
  EchoFlowLoginSession,
  siteCookieHeader,
  type EchoFlowLoginIdentity,
  type EchoFlowLoginWindow,
  type EchoFlowWindowOpenResult,
  type SiteCookie,
} from './echoFlowLogin'

type VerifySessionFn = (
  cookies: readonly SiteCookie[],
  identity: EchoFlowLoginIdentity,
) => Promise<boolean>
type ResolveIdentityFn = (cookies: readonly SiteCookie[]) => Promise<EchoFlowLoginIdentity | null>

class FakeLoginWindow implements EchoFlowLoginWindow {
  readonly navigation = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
  closed?: () => void
  windowOpen?: (details: { url: string }) => EchoFlowWindowOpenResult
  loadedUrl = ''
  focused = false
  closedCount = 0
  loadCount = 0
  loadFailed?: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void
  loadFinished?: () => void
  cookies: SiteCookie[] = []
  pageUrl = 'https://api.echoflowai.cc/login'
  localStorageUser: string | null = null
  removeCookie = vi.fn(async (_url: string, _name: string) => { this.cookies = [] })

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
    executeJavaScript: vi.fn(async (_code: string, _userGesture?: boolean) => this.localStorageUser),
  }

  session = {
    cookies: {
      get: vi.fn(async (_filter: { url: string }) => this.cookies),
      remove: this.removeCookie,
    },
  }

  on(event: 'closed', listener: () => void) {
    if (event === 'closed') this.closed = listener
  }

  async loadURL(url: string) {
    this.loadedUrl = url
    this.loadCount += 1
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

  addSessionCookie() {
    this.cookies = [{
      name: 'session',
      value: 'private-cookie',
      domain: 'api.echoflowai.cc',
      path: '/',
      secure: true,
      httpOnly: true,
    }]
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function makeLogin(options: {
  verifySession?: VerifySessionFn
  resolveIdentity?: ResolveIdentityFn
  readCookies?: () => Promise<SiteCookie[]>
  clearCookies?: () => Promise<void>
  loadRetries?: number
  loadTimeoutMs?: number
  loginTimeoutMs?: number
} = {}) {
  const window = new FakeLoginWindow()
  const createWindow = vi.fn(async () => window)
  const verifySession = vi.fn(options.verifySession
    ?? (async (cookies: readonly SiteCookie[], identity: EchoFlowLoginIdentity) =>
      cookies.length > 0 && identity.userId !== ''))
  const resolveIdentity = vi.fn(options.resolveIdentity
    ?? (async (): Promise<EchoFlowLoginIdentity | null> => ({ userId: '106452', username: 'site-user' })))
  const login = new EchoFlowLoginSession({
    createWindow,
    verifySession,
    resolveIdentity,
    readCookies: options.readCookies,
    clearCookies: options.clearCookies,
    pollIntervalMs: 10,
    identityRetryMs: 10,
    loadTimeoutMs: options.loadTimeoutMs ?? 500,
    loginTimeoutMs: options.loginTimeoutMs ?? 2_000,
    loadRetryDelayMs: 5,
    loadRetries: options.loadRetries ?? 3,
  })
  return { login, window, createWindow, verifySession, resolveIdentity }
}

describe('EchoFlow site login session', () => {
  it('serializes only syntactically safe cookie pairs', () => {
    expect(siteCookieHeader([
      { name: 'session', value: 'opaque==' },
      { name: 'bad name', value: 'x' },
      { name: 'csrf', value: 'line\nbreak' },
    ])).toBe('session=opaque==')
  })

  it('opens the fixed main-site login page and authenticates once the site session appears', async () => {
    const { login, window, createWindow, verifySession } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    expect(createWindow).toHaveBeenCalledWith('persist:echoflow-site-login')
    expect(window.loadedUrl).toBe('https://api.echoflowai.cc/login')

    window.addSessionCookie()
    await expect(result).resolves.toBe('authenticated')
    expect(verifySession).toHaveBeenCalledWith(window.cookies, { userId: '106452', username: 'site-user' })
    expect(window.closedCount).toBe(1)
  })

  it('allows only the site and its OAuth providers to navigate the login window', async () => {
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

  it('denies arbitrary popups and keeps OAuth popups inside the login partition', async () => {
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

  it('keeps waiting when the site session cannot be resolved into an identity', async () => {
    const { login, window, createWindow, verifySession } = makeLogin({
      resolveIdentity: async () => null,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.addSessionCookie()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(verifySession).not.toHaveBeenCalled()
    expect(window.closedCount).toBe(0)

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('falls back to the identity the site stores in its own page', async () => {
    const { login, window, createWindow, verifySession } = makeLogin({
      resolveIdentity: async () => null,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.localStorageUser = JSON.stringify({ id: 2001, username: 'page-user' })
    window.addSessionCookie()
    await expect(result).resolves.toBe('authenticated')
    expect(verifySession).toHaveBeenCalledWith(window.cookies, { userId: '2001', username: 'page-user' })
  })

  it('keeps the login window open when session verification is unavailable', async () => {
    const { login, window, createWindow } = makeLogin({
      verifySession: async () => { throw new Error('offline') },
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.addSessionCookie()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(window.closedCount).toBe(0)

    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('fails after three rejected session bootstraps instead of waiting for the login timeout', async () => {
    const { login, window, createWindow, verifySession } = makeLogin({
      verifySession: async () => false,
      loginTimeoutMs: 60_000,
    })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.addSessionCookie()

    await expect(result).resolves.toBe('failed')
    expect(verifySession).toHaveBeenCalledTimes(3)
    expect(window.closedCount).toBe(1)
  })

  it('retries a transient main-frame load failure instead of failing the login', async () => {
    const { login, window, createWindow } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.failLoad(-21, 'ERR_NETWORK_CHANGED')
    expect(window.closedCount).toBe(0)
    await waitFor(() => window.loadCount === 2)

    window.addSessionCookie()
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

  it('fails instead of hanging when no session appears before the login timeout', async () => {
    const { login, window, createWindow } = makeLogin({ loginTimeoutMs: 40 })
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    window.finishLoad()
    await expect(result).resolves.toBe('failed')
    expect(window.closedCount).toBe(1)
  })

  it('reuses one login window and resolves cancellation when the user closes it', async () => {
    const { login, window, createWindow } = makeLogin()
    const first = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)

    const second = login.open()
    await waitFor(() => window.focused)
    expect(createWindow).toHaveBeenCalledOnce()

    window.close()
    await expect(first).resolves.toBe('cancelled')
    await expect(second).resolves.toBe('cancelled')
  })

  it('restores an existing site session without opening the login window', async () => {
    const cookies: SiteCookie[] = [{ name: 'session', value: 'existing-cookie' }]
    const { login, createWindow, verifySession, resolveIdentity } = makeLogin({
      readCookies: async () => cookies,
    })

    await expect(login.open()).resolves.toBe('authenticated')
    expect(createWindow).not.toHaveBeenCalled()
    expect(resolveIdentity).toHaveBeenCalledWith(cookies)
    expect(verifySession).toHaveBeenCalledWith(cookies, { userId: '106452', username: 'site-user' })
  })

  it('rehydrates only after validating cookies from the persistent jar', async () => {
    const cookies: SiteCookie[] = [{ name: 'session', value: 'existing-cookie' }]
    const { login, verifySession } = makeLogin({ readCookies: async () => cookies })

    await expect(login.rehydrate()).resolves.toBe(true)
    expect(verifySession).toHaveBeenCalledWith(cookies, { userId: '106452', username: 'site-user' })
    await expect(login.getCookies()).resolves.toEqual(cookies)
  })

  it('does not report cookies before the session is verified', async () => {
    const cookies: SiteCookie[] = [{ name: 'session', value: 'existing-cookie' }]
    const { login } = makeLogin({ readCookies: async () => cookies })

    await expect(login.getCookies()).resolves.toEqual([])
  })

  it('does not rehydrate when the jar has no cookies or verification fails', async () => {
    const empty = makeLogin({ readCookies: async () => [] })
    await expect(empty.login.rehydrate()).resolves.toBe(false)
    await expect(empty.login.getCookies()).resolves.toEqual([])

    const rejected = makeLogin({
      readCookies: async () => [{ name: 'session', value: 'expired-cookie' }],
      verifySession: async () => false,
    })
    await expect(rejected.login.rehydrate()).resolves.toBe(false)
  })

  it('signs out through the host cookie hook when one is provided', async () => {
    const clearCookies = vi.fn(async () => {})
    const { login } = makeLogin({ clearCookies })

    await login.clear()
    expect(clearCookies).toHaveBeenCalledOnce()
    await expect(login.getCookies()).resolves.toEqual([])
  })

  it('cancels a pending login and removes partition cookies on sign-out', async () => {
    const { login, window, createWindow } = makeLogin()
    const result = login.open()
    await waitFor(() => createWindow.mock.calls.length === 1)
    window.addSessionCookie()

    await login.clear()
    await expect(result).resolves.toBe('cancelled')
    expect(window.removeCookie).toHaveBeenCalledWith('https://api.echoflowai.cc/', 'session')
    await expect(login.getCookies()).resolves.toEqual([])
  })
})
