import { describe, expect, it, vi } from 'vitest'
import { EchoFlowLoginSession, siteCookieHeader, type EchoFlowLoginWindow, type SiteCookie } from './echoFlowLogin'

class FakeLoginWindow implements EchoFlowLoginWindow {
  readonly id = 41
  readonly navigation = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
  completed?: (details: { webContentsId: number; method: string; statusCode: number; resourceType: string; url: string }) => void
  closed?: () => void
  windowOpen?: (details: { url: string }) => { action: 'deny' }
  loadedUrl = ''
  focused = false
  closedCount = 0
  loadCount = 0
  loadFailed?: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void
  loadFinished?: () => void
  cookies: SiteCookie[] = [{ name: 'session', value: 'private-cookie', domain: 'api.echoflowai.cc', path: '/', secure: true, httpOnly: true }]
  removeCookie = vi.fn(async (_url: string, _name: string) => { this.cookies = [] })

  webContents = {
    readIdentity: vi.fn(async () => ({ userId: '106452', username: 'site-user' })),
    on: (event: 'will-navigate' | 'will-redirect' | 'did-fail-load' | 'did-finish-load', listener: (...args: never[]) => void) => {
      if (event === 'did-fail-load') this.loadFailed = listener as FakeLoginWindow['loadFailed']
      else if (event === 'did-finish-load') this.loadFinished = listener as FakeLoginWindow['loadFinished']
      else this.navigation.set(event, listener as (event: { preventDefault(): void }, url: string) => void)
    },
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => { this.windowOpen = handler },
  }
  session = {
    webRequest: {
      onCompleted: (_filter: { urls: string[] }, listener: (details: { webContentsId: number; method: string; statusCode: number; resourceType: string; url: string }) => void) => {
        this.completed = listener
      },
    },
    cookies: {
      get: vi.fn(async (_filter: { url: string }) => this.cookies),
      remove: this.removeCookie,
    },
  }

  on(event: 'closed', listener: () => void) { if (event === 'closed') this.closed = listener }
  async loadURL(url: string) { this.loadedUrl = url; this.loadCount += 1 }
  failLoad(errorCode: number, description: string, isMainFrame = true) {
    this.loadFailed?.({}, errorCode, description, this.loadedUrl, isMainFrame)
  }
  focus() { this.focused = true }
  close() { this.closedCount += 1; this.closed?.() }

  navigate(event: 'will-navigate' | 'will-redirect', url: string) {
    const preventDefault = vi.fn()
    this.navigation.get(event)?.({ preventDefault }, url)
    return preventDefault
  }

  finishLogin(overrides: Partial<NonNullable<FakeLoginWindow['completed']> extends (arg: infer T) => void ? T : never> = {}) {
    this.completed?.({
      webContentsId: this.id,
      method: 'POST',
      statusCode: 200,
      resourceType: 'xhr',
      url: 'https://api.echoflowai.cc/api/user/login',
      ...overrides,
    })
  }
}

function makeLogin(verifySession = vi.fn(async (cookies: readonly SiteCookie[]) => cookies.length > 0)) {
  const window = new FakeLoginWindow()
  const createWindow = vi.fn(async () => window)
  const login = new EchoFlowLoginSession({ createWindow, verifySession })
  return { login, window, createWindow, verifySession }
}

describe('EchoFlow site login session', () => {
  it('serializes only syntactically safe cookie pairs', () => {
    expect(siteCookieHeader([
      { name: 'session', value: 'opaque==', domain: 'api.echoflowai.cc', path: '/', secure: true, httpOnly: true },
      { name: 'bad;name', value: 'x', domain: 'api.echoflowai.cc', path: '/', secure: true, httpOnly: true },
      { name: 'bad-value', value: 'x; injected=y', domain: 'api.echoflowai.cc', path: '/', secure: true, httpOnly: true },
    ])).toBe('session=opaque==')
  })
  it('opens the fixed main-site login page in a dedicated persistent partition', async () => {
    const { login, window, createWindow, verifySession } = makeLogin()
    const result = login.open()
    await Promise.resolve()
    expect(createWindow).toHaveBeenCalledWith('persist:echoflow-site-login')
    expect(window.loadedUrl).toBe('https://api.echoflowai.cc/login')
    window.finishLogin()
    await expect(result).resolves.toBe('authenticated')
    expect(verifySession).toHaveBeenCalledWith(window.cookies, { userId: '106452', username: 'site-user' })
  })

  it('does not treat an arbitrary origin or unsuccessful login response as authentication', async () => {
    const { login, window, verifySession } = makeLogin(vi.fn(async () => false))
    const result = login.open()
    await Promise.resolve()
    expect(window.navigate('will-navigate', 'https://evil.example/callback')).toHaveBeenCalledOnce()
    expect(window.navigate('will-redirect', 'https://api.echoflowai.cc.evil.example/login')).toHaveBeenCalledOnce()
    window.finishLogin({ url: 'https://evil.example/api/user/login' })
    window.finishLogin({ statusCode: 401 })
    expect(verifySession).not.toHaveBeenCalled()
    window.finishLogin()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(verifySession).toHaveBeenCalledOnce()
    expect(window.closedCount).toBe(0)
    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('keeps the login window open when the site reports a transient main-frame network failure', async () => {
    const { login, window, createWindow } = makeLogin()
    const first = login.open()
    await new Promise(resolve => setTimeout(resolve, 0))

    window.failLoad(-21, 'ERR_NETWORK_CHANGED')
    expect(window.closedCount).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 800))
    expect(window.loadCount).toBe(2)

    const second = login.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(createWindow).toHaveBeenCalledOnce()
    expect(window.loadCount).toBe(2)
    expect(window.focused).toBe(true)

    window.close()
    await expect(first).resolves.toBe('cancelled')
    await expect(second).resolves.toBe('cancelled')
  })

  it('keeps the login window open when session verification is unavailable', async () => {
    const { login, window } = makeLogin(vi.fn(async () => { throw new Error('offline') }))
    const result = login.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(window.completed).toBeTypeOf('function')
    window.finishLogin()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(window.session.cookies.get).toHaveBeenCalled()
    expect(window.closedCount).toBe(0)
    window.close()
    await expect(result).resolves.toBe('cancelled')
  })

  it('reuses one login window and resolves cancellation when the user closes it', async () => {
    const { login, window, createWindow } = makeLogin()
    const first = login.open()
    const second = login.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(createWindow).toHaveBeenCalledOnce()
    expect(window.focused).toBe(true)
    window.close()
    await expect(first).resolves.toBe('cancelled')
    await expect(second).resolves.toBe('cancelled')
  })

  it('rehydrates the server only after validating cookies from the persistent jar', async () => {
    const cookies: SiteCookie[] = [{ name: 'session', value: 'persisted-private', domain: 'api.echoflowai.cc', path: '/', secure: true, httpOnly: true }]
    const readCookies = vi.fn(async () => cookies)
    const verifySession = vi.fn(async (received: readonly SiteCookie[]) => received === cookies)
    const login = new EchoFlowLoginSession({ createWindow: () => new FakeLoginWindow(), readCookies, verifySession })

    await expect(login.getCookies()).resolves.toEqual([])
    await expect(login.rehydrate()).resolves.toBe(true)
    expect(verifySession).toHaveBeenCalledWith(cookies)
    await expect(login.getCookies()).resolves.toEqual(cookies)
  })

  it('returns only main-site cookies to the host and clears them on sign-out', async () => {
    const { login, window } = makeLogin()
    const opened = login.open()
    await Promise.resolve()
    window.finishLogin()
    await opened
    await expect(login.getCookies()).resolves.toEqual(window.cookies)
    await login.clear()
    expect(window.removeCookie).toHaveBeenCalledWith('https://api.echoflowai.cc/', 'session')
  })
})
