export const ECHOFLOW_LOGIN_URL = 'https://api.echoflowai.cc/login'
export const ECHOFLOW_LOGIN_ORIGIN = 'https://api.echoflowai.cc'
export const ECHOFLOW_LOGIN_PARTITION = 'persist:echoflow-site-login'

export type EchoFlowLoginIdentity = { userId: string; username: string }

export type SiteCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
}

type LoginRequestResult = {
  webContentsId: number
  method: string
  statusCode: number
  resourceType: string
  url: string
}

export interface EchoFlowLoginWindow {
  id: number
  webContents: {
    on(event: 'will-navigate' | 'will-redirect' | 'did-fail-load' | 'did-finish-load', listener: ((event: { preventDefault(): void }, url: string) => void) | ((event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void) | (() => void)): void
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
    readIdentity?(): Promise<EchoFlowLoginIdentity>
  }
  session: {
    webRequest: {
      onCompleted(filter: { urls: string[] }, listener: (details: LoginRequestResult) => void): void
    }
    cookies: {
      get(filter: { url: string }): Promise<SiteCookie[]>
      remove(url: string, name: string): Promise<void>
    }
  }
  on(event: 'closed', listener: () => void): void
  loadURL(url: string): Promise<void>
  focus(): void
  close(): void
}

export type EchoFlowLoginSessionDeps = {
  createWindow: (partition: string) => Promise<EchoFlowLoginWindow> | EchoFlowLoginWindow
  verifySession: (cookies: readonly SiteCookie[], identity?: EchoFlowLoginIdentity) => Promise<boolean>
  readCookies?: () => Promise<SiteCookie[]>
  clearCookies?: () => Promise<void>
}

const LOGIN_LOAD_RETRIES = 3
const LOGIN_RETRY_DELAY_MS = 750

/** Owns the site login window and its cookies; callers must keep this in Electron main. */
export class EchoFlowLoginSession {
  private window: EchoFlowLoginWindow | null = null
  private pending: Promise<'authenticated' | 'cancelled'> | null = null
  private opening: Promise<void> | null = null
  private loginSession: EchoFlowLoginWindow['session'] | null = null
  private settled: ((result: 'authenticated' | 'cancelled') => void) | null = null
  private loginVerified = false
  private loginLoadRetries = 0
  private loginRetryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: EchoFlowLoginSessionDeps) {}

  open(): Promise<'authenticated' | 'cancelled'> {
    if (this.pending) {
      if (this.window) this.window.focus()
      else void this.opening?.then(() => this.window?.focus())
      return this.pending
    }

    this.loginVerified = false
    this.pending = new Promise((resolve) => { this.settled = resolve })
    this.opening = this.startWindow()
    void this.opening.then(() => { this.opening = null })
    return this.pending
  }

  async getCookies(): Promise<SiteCookie[]> {
    if (!this.loginVerified) return []
    if (this.deps.readCookies) return await this.deps.readCookies()
    return this.loginSession
      ? await this.loginSession.cookies.get({ url: ECHOFLOW_LOGIN_ORIGIN })
      : []
  }

  async rehydrate(): Promise<boolean> {
    this.loginVerified = false
    try {
      const cookies = this.deps.readCookies
        ? await this.deps.readCookies()
        : this.loginSession ? await this.loginSession.cookies.get({ url: ECHOFLOW_LOGIN_ORIGIN }) : []
      if (!cookies.length || !await this.deps.verifySession(cookies)) return false
      this.loginVerified = true
      return true
    } catch {
      return false
    }
  }

  async clear(): Promise<void> {
    if (this.deps.clearCookies) {
      await this.deps.clearCookies()
      this.loginVerified = false
      return
    }
    const session = this.loginSession
    if (!session) return
    const cookies = await session.cookies.get({ url: ECHOFLOW_LOGIN_ORIGIN })
    await Promise.all(cookies.map(cookie => session.cookies.remove(
      `${ECHOFLOW_LOGIN_ORIGIN}${cookiePath(cookie)}`,
      cookie.name,
    )))
    this.loginVerified = false
  }

  private async startWindow(): Promise<void> {
    try {
      const window = await this.deps.createWindow(ECHOFLOW_LOGIN_PARTITION)
      this.window = window
      this.loginSession = window.session
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      for (const event of ['will-navigate', 'will-redirect'] as const) {
        window.webContents.on(event, (navigation, target) => {
          if (!this.isSiteUrl(target)) navigation.preventDefault()
        })
      }
      window.webContents.on('did-finish-load', () => { this.loginLoadRetries = 0 })
      window.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || this.loginLoadRetries >= LOGIN_LOAD_RETRIES) return
        this.loginLoadRetries += 1
        if (this.loginRetryTimer) clearTimeout(this.loginRetryTimer)
        this.loginRetryTimer = setTimeout(() => {
          this.loginRetryTimer = null
          if (this.window === window) void window.loadURL(ECHOFLOW_LOGIN_URL).catch(() => {})
        }, LOGIN_RETRY_DELAY_MS * this.loginLoadRetries)
      })
      window.session.webRequest.onCompleted(
        { urls: [`${ECHOFLOW_LOGIN_ORIGIN}/api/user/login*`] },
        details => { void this.onLoginResponse(window, details) },
      )
      window.on('closed', () => {
        if (this.window !== window) return
        this.clearLoginRetry()
        this.window = null
        this.finish('cancelled')
      })
      await window.loadURL(ECHOFLOW_LOGIN_URL)
    } catch {
      this.clearLoginRetry()
      this.window?.close()
      this.window = null
      this.finish('cancelled')
    }
  }

  private clearLoginRetry(): void {
    if (this.loginRetryTimer) clearTimeout(this.loginRetryTimer)
    this.loginRetryTimer = null
  }

  private async onLoginResponse(window: EchoFlowLoginWindow, details: LoginRequestResult): Promise<void> {
    if (window !== this.window
      || details.webContentsId !== window.id
      || details.method !== 'POST'
      || details.resourceType !== 'xhr' && details.resourceType !== 'fetch'
      || details.statusCode < 200 || details.statusCode >= 300
      || !this.isLoginUrl(details.url)) return

    try {
      const cookies = await window.session.cookies.get({ url: ECHOFLOW_LOGIN_ORIGIN })
      const identity = await window.webContents.readIdentity?.()
      if (!cookies.length || !await this.deps.verifySession(cookies, identity)) return
      this.loginVerified = true
    } catch {
      return
    }
    this.finish('authenticated')
    window.close()
  }

  private isSiteUrl(value: string): boolean {
    try {
      return new URL(value).origin === ECHOFLOW_LOGIN_ORIGIN
    } catch {
      return false
    }
  }

  private isLoginUrl(value: string): boolean {
    try {
      const url = new URL(value)
      return url.origin === ECHOFLOW_LOGIN_ORIGIN && url.pathname === '/api/user/login'
    } catch {
      return false
    }
  }

  private finish(result: 'authenticated' | 'cancelled'): void {
    const resolve = this.settled
    this.settled = null
    this.pending = null
    resolve?.(result)
  }
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Convert Electron's host-only cookie records to a safe Cookie request header. */
export function siteCookieHeader(cookies: readonly SiteCookie[]): string {
  return cookies
    .filter(cookie => COOKIE_NAME_PATTERN.test(cookie.name) && !/[;\r\n\0]/.test(cookie.value))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

function cookiePath(cookie: SiteCookie): string {
  const value = cookie.path || '/'
  return value.startsWith('/') ? value : `/${value}`
}
