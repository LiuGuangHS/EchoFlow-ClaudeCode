import { parseSiteIdentity, type EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export type { EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export const ECHOFLOW_LOGIN_URL = 'https://api.echoflowai.cc/login'
export const ECHOFLOW_LOGIN_ORIGIN = 'https://api.echoflowai.cc'
export const ECHOFLOW_LOGIN_PARTITION = 'persist:echoflow-site-login'

export type EchoFlowLoginResult = 'authenticated' | 'cancelled' | 'failed'

export type SiteCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
}

export type EchoFlowWindowOpenResult =
  | { action: 'deny' }
  | { action: 'allow'; overrideBrowserWindowOptions?: Record<string, unknown> }

export interface EchoFlowLoginWindow {
  webContents: {
    on(event: 'will-navigate' | 'will-redirect', listener: (navigation: { preventDefault(): void }, url: string) => void): void
    on(event: 'did-fail-load', listener: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void): void
    on(event: 'did-finish-load', listener: () => void): void
    setWindowOpenHandler(handler: (details: { url: string }) => EchoFlowWindowOpenResult): void
    getURL(): string
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  }
  session: {
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
  verifySession: (cookies: readonly SiteCookie[], identity: EchoFlowLoginIdentity) => Promise<boolean>
  resolveIdentity: (cookies: readonly SiteCookie[]) => Promise<EchoFlowLoginIdentity | null>
  readCookies?: () => Promise<SiteCookie[]>
  clearCookies?: () => Promise<void>
  /** Timing knobs exist so tests do not wait on wall-clock seconds. */
  pollIntervalMs?: number
  identityRetryMs?: number
  loadTimeoutMs?: number
  loginTimeoutMs?: number
  loadRetryDelayMs?: number
  loadRetries?: number
}

const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_IDENTITY_RETRY_MS = 3_000
const DEFAULT_LOAD_TIMEOUT_MS = 60_000
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60_000
const DEFAULT_LOAD_RETRY_DELAY_MS = 750
const DEFAULT_LOAD_RETRIES = 3
/**
 * A signed-in site cookie that the local bridge rejects three times in a row is
 * a real configuration failure, not a slow handshake. Waiting for the login
 * timeout would leave the user staring at a signed-in console for ten minutes.
 */
const MAX_IDENTITY_REJECTIONS = 3

/**
 * The site's OAuth buttons navigate the login window itself, so these hosts
 * must survive the navigation guard. Keep this list exact: a suffix match
 * would turn `evilgithub.com` into a trusted destination.
 */
const ALLOWED_OAUTH_HOSTS = new Set([
  'github.com',
  'accounts.google.com',
  'oauth.telegram.org',
])

export function isAllowedSiteNavigation(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === ECHOFLOW_LOGIN_ORIGIN || ALLOWED_OAUTH_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * Owns the site login window and its cookies.
 *
 * Completion is decided by the session cookie, not by one observed request.
 * The site signs users in through several paths (its own form, GitHub, Google,
 * Telegram, an already-valid session), and only some of them produce a
 * `POST /api/user/login`. Polling the partition and resolving the account from
 * the cookie covers all of them; every failure path ends in an explicit result
 * so the renderer can stop waiting.
 */
export class EchoFlowLoginSession {
  private window: EchoFlowLoginWindow | null = null
  private pending: Promise<EchoFlowLoginResult> | null = null
  private opening: Promise<void> | null = null
  private restoring: Promise<boolean> | null = null
  private loginSession: EchoFlowLoginWindow['session'] | null = null
  private settled: ((result: EchoFlowLoginResult) => void) | null = null
  private loginVerified = false
  private loadRetriesUsed = 0
  private loadRetryTimer: ReturnType<typeof setTimeout> | null = null
  private loadTimer: ReturnType<typeof setTimeout> | null = null
  private loginTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private identityInFlight = false
  private identityRejections = 0
  private lastIdentityCookieHeader = ''
  private lastIdentityAttemptAt = 0

  private readonly pollIntervalMs: number
  private readonly identityRetryMs: number
  private readonly loadTimeoutMs: number
  private readonly loginTimeoutMs: number
  private readonly loadRetryDelayMs: number
  private readonly loadRetryLimit: number

  constructor(private readonly deps: EchoFlowLoginSessionDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.identityRetryMs = deps.identityRetryMs ?? DEFAULT_IDENTITY_RETRY_MS
    this.loadTimeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    this.loginTimeoutMs = deps.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
    this.loadRetryDelayMs = deps.loadRetryDelayMs ?? DEFAULT_LOAD_RETRY_DELAY_MS
    this.loadRetryLimit = deps.loadRetries ?? DEFAULT_LOAD_RETRIES
  }

  async open(): Promise<EchoFlowLoginResult> {
    if (this.pending) {
      this.focusWindow()
      return this.pending
    }

    // An existing partition cookie is the common "already signed in" case.
    // Reusing it avoids opening a window that the site would immediately
    // redirect away from the login page.
    if (await this.restoreSession()) return 'authenticated'
    if (this.pending) {
      this.focusWindow()
      return this.pending
    }

    this.loginVerified = false
    this.pending = new Promise(resolve => { this.settled = resolve })
    this.opening = this.startWindow()
    void this.opening.then(() => { this.opening = null })
    return this.pending
  }

  async getCookies(): Promise<SiteCookie[]> {
    if (!this.loginVerified) return []
    return await this.readSiteCookies()
  }

  async rehydrate(): Promise<boolean> {
    this.loginVerified = false
    return await this.restoreSession()
  }

  async clear(): Promise<void> {
    this.cancelLogin()
    if (this.deps.clearCookies) {
      await this.deps.clearCookies()
      this.loginVerified = false
      return
    }
    const session = this.loginSession
    if (!session) {
      this.loginVerified = false
      return
    }
    const cookies = await session.cookies.get({ url: ECHOFLOW_LOGIN_ORIGIN })
    await Promise.all(cookies.map(cookie => session.cookies.remove(
      `${ECHOFLOW_LOGIN_ORIGIN}${cookiePath(cookie)}`,
      cookie.name,
    )))
    this.loginVerified = false
  }

  private focusWindow(): void {
    if (this.window) this.window.focus()
    else void this.opening?.then(() => this.window?.focus())
  }

  private restoreSession(): Promise<boolean> {
    this.restoring ??= this.tryRestoreSession()
      .catch(() => false)
      .finally(() => { this.restoring = null })
    return this.restoring
  }

  private async tryRestoreSession(): Promise<boolean> {
    const cookies = await this.readSiteCookies()
    if (!cookies.length) return false
    const identity = await this.deps.resolveIdentity(cookies)
    if (!identity) return false
    if (!await this.deps.verifySession(cookies, identity)) return false
    this.loginVerified = true
    return true
  }

  private async readSiteCookies(): Promise<SiteCookie[]> {
    if (this.deps.readCookies) return await this.deps.readCookies()
    if (!this.loginSession) return []
    return await this.loginSession.cookies.get({ url: ECHOFLOW_LOGIN_ORIGIN })
  }

  private cancelLogin(): void {
    this.clearTimers()
    if (!this.window) return
    const window = this.window
    this.window = null
    try {
      window.close()
    } catch {
      // The window may already be gone; the pending promise still settles.
    }
    this.finish('cancelled')
  }

  private async startWindow(): Promise<void> {
    let window: EchoFlowLoginWindow | null = null
    try {
      window = await this.deps.createWindow(ECHOFLOW_LOGIN_PARTITION)
      this.window = window
      this.identityRejections = 0
      this.loginSession = window.session
      const loginWindow = window

      window.webContents.setWindowOpenHandler(details => this.onWindowOpen(details.url))
      for (const event of ['will-navigate', 'will-redirect'] as const) {
        window.webContents.on(event, (navigation, target) => {
          if (!isAllowedSiteNavigation(target)) navigation.preventDefault()
        })
      }
      window.webContents.on('did-finish-load', () => {
        this.loadRetriesUsed = 0
        this.clearLoadTimeout()
      })
      window.webContents.on('did-fail-load', (_event, errorCode, description, _url, isMainFrame) => {
        if (this.window === loginWindow) this.onLoadFailed(loginWindow, errorCode, description, isMainFrame)
      })
      window.on('closed', () => this.onWindowClosed(loginWindow))

      this.loadTimer = setTimeout(
        () => this.failAndClose(loginWindow, 'load-timeout'),
        this.loadTimeoutMs,
      )
      this.loginTimer = setTimeout(
        () => this.failAndClose(loginWindow, 'login-timeout'),
        this.loginTimeoutMs,
      )
      this.pollTimer = setInterval(
        () => { void this.pollSession(loginWindow) },
        this.pollIntervalMs,
      )

      await window.loadURL(ECHOFLOW_LOGIN_URL)
    } catch (error) {
      this.failAndClose(window, 'window-start-failed', error)
    }
  }

  private onLoadFailed(
    window: EchoFlowLoginWindow,
    errorCode: number,
    description: string,
    isMainFrame: boolean,
  ): void {
    // -3 is ERR_ABORTED: the window superseded the load, not a network fault.
    if (!isMainFrame || errorCode === -3) return
    if (this.loadRetriesUsed >= this.loadRetryLimit) {
      this.failAndClose(window, `load-failed:${errorCode}:${description}`)
      return
    }
    this.loadRetriesUsed += 1
    if (this.loadRetryTimer) clearTimeout(this.loadRetryTimer)
    this.loadRetryTimer = setTimeout(() => {
      this.loadRetryTimer = null
      if (this.window === window) void window.loadURL(ECHOFLOW_LOGIN_URL).catch(() => {})
    }, this.loadRetryDelayMs * this.loadRetriesUsed)
  }

  private async pollSession(window: EchoFlowLoginWindow): Promise<void> {
    if (this.window !== window || this.identityInFlight || this.loginVerified) return

    let cookies: SiteCookie[]
    try {
      cookies = await this.readSiteCookies()
    } catch {
      return
    }
    if (this.window !== window || !cookies.length) return

    const cookieHeader = siteCookieHeader(cookies)
    if (!cookieHeader) return

    const now = Date.now()
    if (
      cookieHeader === this.lastIdentityCookieHeader
      && now - this.lastIdentityAttemptAt < this.identityRetryMs
    ) return
    // A different cookie means a new sign-in attempt, not a retry of the failure.
    if (cookieHeader !== this.lastIdentityCookieHeader) this.identityRejections = 0
    this.lastIdentityCookieHeader = cookieHeader
    this.lastIdentityAttemptAt = now

    this.identityInFlight = true
    try {
      let identity = await this.deps.resolveIdentity(cookies)
      if (!identity && this.window === window) identity = await this.readPageIdentity(window)
      if (!identity || this.window !== window) return
      if (!await this.deps.verifySession(cookies, identity)) {
        this.identityRejections += 1
        if (this.identityRejections >= MAX_IDENTITY_REJECTIONS) {
          this.failAndClose(window, 'bootstrap-rejected')
        }
        return
      }
      this.identityRejections = 0
      this.loginVerified = true
      this.finishAndClose(window, 'authenticated')
    } catch {
      // Transient read or bridge failures are retried on the next poll.
    } finally {
      this.identityInFlight = false
    }
  }

  /**
   * Fallback for consoles that reject a cookie-only `/api/user/self`. The site
   * already stores the signed-in record it uses for its own route guard; only
   * the id and username are read.
   */
  private async readPageIdentity(window: EchoFlowLoginWindow): Promise<EchoFlowLoginIdentity | null> {
    try {
      if (new URL(window.webContents.getURL()).origin !== ECHOFLOW_LOGIN_ORIGIN) return null
      const raw = await window.webContents.executeJavaScript(
        'window.localStorage.getItem("user")',
        true,
      )
      return parseSiteIdentity(raw)
    } catch {
      return null
    }
  }

  private onWindowOpen(url: string): EchoFlowWindowOpenResult {
    if (!isAllowedSiteNavigation(url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          partition: ECHOFLOW_LOGIN_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    }
  }

  private onWindowClosed(window: EchoFlowLoginWindow): void {
    if (this.window !== window) return
    this.window = null
    this.clearTimers()
    this.finish('cancelled')
  }

  private finishAndClose(window: EchoFlowLoginWindow, result: EchoFlowLoginResult): void {
    if (this.window !== window) return
    this.window = null
    this.clearTimers()
    try {
      window.close()
    } catch {
      // Closing is best-effort; the result is already decided.
    }
    this.finish(result)
  }

  private failAndClose(
    window: EchoFlowLoginWindow | null,
    reason: string,
    error?: unknown,
  ): void {
    const target = window ?? this.window
    if (target && this.window !== target) return
    if (target) this.window = null
    this.clearTimers()
    if (target) {
      try {
        target.close()
      } catch {
        // The window may already be gone.
      }
    }
    const detail = error instanceof Error ? error.message : error === undefined ? '' : String(error)
    console.warn(`[echoFlowLogin] ${reason}${detail ? `: ${detail}` : ''}`)
    this.finish('failed')
  }

  private clearLoadTimeout(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
  }

  private clearTimers(): void {
    this.clearLoadTimeout()
    if (this.loginTimer) {
      clearTimeout(this.loginTimer)
      this.loginTimer = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.loadRetryTimer) {
      clearTimeout(this.loadRetryTimer)
      this.loadRetryTimer = null
    }
  }

  private finish(result: EchoFlowLoginResult): void {
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
