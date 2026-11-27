import { parseSiteIdentity, type EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export type { EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export type EchoFlowLoginResult = 'authenticated' | 'cancelled' | 'failed' | 'unknown'

export type EchoFlowLoginEndpoint = 'main' | 'dedicated'

export type SiteCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
}

/**
 * The one credential a login profile can hand back to the host. A page may
 * expose either the main site's session cookie or the gateway's access token;
 * the host decides what each endpoint accepts.
 */
export type EchoFlowLoginCredential =
  | { kind: 'session'; userId: string; username?: string; cookie: string; userAgent?: string; acceptLanguage?: string }
  | { kind: 'bearer'; userId: string; username?: string; accessToken: string }

export type EchoFlowLoginProfile = {
  endpoint: EchoFlowLoginEndpoint
  url: string
  origin: string
  partition: string
  allowedHosts: ReadonlySet<string>
}

/**
 * The site's OAuth buttons navigate the login window itself, so these hosts
 * must survive the navigation guard. Keep this list exact: a suffix match
 * would turn `evilgithub.com` into a trusted destination.
 */
const MAIN_ALLOWED_OAUTH_HOSTS = new Set([
  'github.com',
  'accounts.google.com',
  'oauth.telegram.org',
])

export const MAIN_LOGIN_PROFILE: EchoFlowLoginProfile = {
  endpoint: 'main',
  url: 'https://api.echoflowai.cc/login',
  origin: 'https://api.echoflowai.cc',
  partition: 'persist:echoflow-site-login',
  allowedHosts: MAIN_ALLOWED_OAUTH_HOSTS,
}

export const DEDICATED_LOGIN_PROFILE: EchoFlowLoginProfile = {
  endpoint: 'dedicated',
  url: 'https://expapi.echoflowai.cc/login',
  origin: 'https://expapi.echoflowai.cc',
  partition: 'persist:echoflow-dedicated-login',
  allowedHosts: new Set(),
}

export const ECHOFLOW_LOGIN_PROFILES: Record<EchoFlowLoginEndpoint, EchoFlowLoginProfile> = {
  main: MAIN_LOGIN_PROFILE,
  dedicated: DEDICATED_LOGIN_PROFILE,
}

export type EchoFlowWindowOpenResult =
  | { action: 'deny' }
  | { action: 'allow'; overrideBrowserWindowOptions?: Record<string, unknown> }

/**
 * `unavailable` permits another check. `unknown` means a submitted request
 * lost its answer, so the attempt must stop and reconcile without replay.
 */
export type EchoFlowLoginVerification = 'ok' | 'rejected' | 'unavailable' | 'unknown'

export async function loginBootstrapVerdict(response: Response): Promise<EchoFlowLoginVerification> {
  if (response.ok) return 'ok'
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  if (response.status === 400 && body?.error === 'token_invalid') return 'rejected'
  // Only a known pre-commit gateway failure may be retried automatically.
  if (response.status === 502 && (body?.error === 'service_unavailable' || body?.error === 'invalid_response')) return 'unavailable'
  return 'unknown'
}

type Verification = { sent: boolean; result: Promise<EchoFlowLoginVerification> }
type Restore = { signal?: AbortSignal; abort: AbortController; verification?: Verification; result: Promise<EchoFlowLoginVerification> }

export interface EchoFlowLoginWindow {
  webContents: {
    on(event: 'will-navigate' | 'will-redirect', listener: (navigation: { preventDefault(): void }, url: string) => void): void
    on(event: 'did-fail-load', listener: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void): void
    on(event: 'did-finish-load' | 'dom-ready', listener: () => void): void
    setWindowOpenHandler(handler: (details: { url: string }) => EchoFlowWindowOpenResult): void
    getURL(): string
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  }
  on(event: 'closed', listener: () => void): void
  loadURL(url: string): Promise<void>
  focus(): void
  close(): void
}

export type EchoFlowLoginSessionDeps = {
  createWindow: (partition: string) => Promise<EchoFlowLoginWindow> | EchoFlowLoginWindow
  profiles: Record<EchoFlowLoginEndpoint, EchoFlowLoginProfile>
  /** Reads the signed-in credential from a live window, or from the persistent jar when `window` is null. */
  readCredential: (endpoint: EchoFlowLoginEndpoint, window: EchoFlowLoginWindow | null, signal?: AbortSignal) => Promise<EchoFlowLoginCredential | null>
  /** Call before sending the account write. A false return means it must not be sent. */
  verifySession: (endpoint: EchoFlowLoginEndpoint, credential: EchoFlowLoginCredential, beginRequest: () => boolean, fromRestore: boolean) => Promise<EchoFlowLoginVerification>
  clearCookies?: (endpoint: EchoFlowLoginEndpoint) => Promise<void>
  /** Wipes the partition's page storage, where the gateway keeps its token. */
  clearStorage?: (endpoint: EchoFlowLoginEndpoint) => Promise<void>
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
 * A signed-in site credential that the local bridge rejects three times in a
 * row is a real configuration failure, not a slow handshake. Waiting for the
 * login timeout would leave the user staring at a signed-in console for ten
 * minutes.
 */
const MAX_IDENTITY_REJECTIONS = 3
/**
 * A page that finished loading and still renders no text is the known
 * blank-consoles failure; three polls is long enough to rule out a paint in
 * progress and short enough that the user does not stare at white.
 */
const BLANK_POLLS_BEFORE_RELOAD = 3

type LoginDestinations = { origin: string; allowedHosts?: ReadonlySet<string> }

export function isAllowedProfileNavigation(profile: LoginDestinations, value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.origin === profile.origin || profile.allowedHosts?.has(url.host) === true)
  } catch {
    return false
  }
}

export function loginNavigationGuard(profile: LoginDestinations) {
  return (navigation: { preventDefault(): void }, target: string) => {
    if (!isAllowedProfileNavigation(profile, target)) navigation.preventDefault()
  }
}

/**
 * Reads the signed-in record the main site stores for its own route guard.
 * Only the id and username are read.
 */
export async function readPageIdentity(
  window: EchoFlowLoginWindow,
  origin: string,
): Promise<EchoFlowLoginIdentity | null> {
  try {
    if (new URL(window.webContents.getURL()).origin !== origin) return null
    const raw = await window.webContents.executeJavaScript(
      'window.localStorage.getItem("user")',
      true,
    )
    return parseSiteIdentity(raw)
  } catch {
    return null
  }
}

/**
 * The dedicated gateway keeps its JWT on the page: `auth_token`, `auth_user`
 * and `token_expires_at` are its own storage keys. The values are read and
 * handed to the local server; nothing here is logged.
 */
export type DedicatedStorageSnapshot = {
  token: string | null
  user: string | null
  expiresAt: string | null
}

function dedicatedExpiry(value: string | null): number | null {
  if (!value) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    // Seconds and milliseconds are both plausible; below 1e12 it is seconds.
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function parseDedicatedCredential(
  snapshot: DedicatedStorageSnapshot | null,
  now = Date.now(),
): EchoFlowLoginCredential | null {
  const accessToken = snapshot?.token?.trim()
  if (!snapshot || !accessToken) return null
  // An expired token is the page mid-refresh, not a completed sign-in: keep
  // polling and let the fresh token finish the login.
  const expiry = dedicatedExpiry(snapshot.expiresAt)
  if (expiry !== null && expiry <= now) return null

  let user: unknown
  try {
    user = snapshot.user ? JSON.parse(snapshot.user) : null
  } catch {
    return null
  }
  if (!user || typeof user !== 'object') return null

  const record = user as Record<string, unknown>
  const rawId = record.id ?? record.user_id ?? record.userId
  const userId = typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' ? rawId.trim() : ''
  if (!userId) return null
  const rawName = record.username ?? record.name
  const username = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined

  return { kind: 'bearer', userId, ...(username ? { username } : {}), accessToken }
}

export async function readDedicatedCredential(
  window: { webContents: Pick<EchoFlowLoginWindow['webContents'], 'getURL' | 'executeJavaScript'> },
  origin: string,
  now = Date.now(),
): Promise<EchoFlowLoginCredential | null> {
  try {
    if (new URL(window.webContents.getURL()).origin !== origin) return null
    const raw = await window.webContents.executeJavaScript(
      '(() => ({ token: localStorage.getItem("auth_token"), user: localStorage.getItem("auth_user"), expiresAt: localStorage.getItem("token_expires_at") }))()',
      true,
    )
    if (!raw || typeof raw !== 'object') return null
    const snapshot = raw as Partial<DedicatedStorageSnapshot>
    return parseDedicatedCredential({
      token: typeof snapshot.token === 'string' ? snapshot.token : null,
      user: typeof snapshot.user === 'string' ? snapshot.user : null,
      expiresAt: typeof snapshot.expiresAt === 'string' ? snapshot.expiresAt : null,
    }, now)
  } catch {
    return null
  }
}

/**
 * Owns the site login window and its credential.
 *
 * Completion is decided by the credential the profile resolves, not by one
 * observed request. A page can sign users in through several paths (its own
 * form, GitHub, Google, Telegram, an already-valid session), and only some of
 * them produce a request the host can observe. Polling the profile covers all
 * of them; every failure path ends in an explicit result so the renderer can
 * stop waiting.
 */
type LoginAttempt = {
  profile: EchoFlowLoginProfile
  result: Promise<EchoFlowLoginResult>
  resolve: (result: EchoFlowLoginResult) => void
  finishing?: boolean
  window?: EchoFlowLoginWindow
  focusOnOpen?: boolean
  timers: {
    load?: ReturnType<typeof setTimeout>
    retry?: ReturnType<typeof setTimeout>
    failure?: ReturnType<typeof setTimeout>
    login?: ReturnType<typeof setTimeout>
    poll?: ReturnType<typeof setInterval>
  }
  loadId: number
  loadRetries: number
  loadFailed?: boolean
  pageLoaded?: boolean
  blankPolls: number
  blankReloaded?: boolean
  checkingBlank?: boolean
  verification?: Verification
  cleanup?: Promise<void>
  identityRejections: number
  lastCredentialKey?: string
  lastIdentityAttemptAt: number
}

export class EchoFlowLoginSession {
  private active?: LoginAttempt
  private readonly restoring = new Map<EchoFlowLoginEndpoint, Restore>()
  private readonly signingOut = new Map<EchoFlowLoginEndpoint, Promise<void>>()
  private readonly generations = new Map<EchoFlowLoginEndpoint, number>()

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

  async open(endpoint: EchoFlowLoginEndpoint = 'main', signal?: AbortSignal): Promise<EchoFlowLoginResult> {
    if (signal?.aborted || this.signingOut.has(endpoint)) return 'cancelled'
    if (this.active) return this.focusAttempt(this.active, endpoint)

    let attempt: LoginAttempt | undefined
    const generation = this.generations.get(endpoint)
    const restore = this.restoreSession(endpoint, signal)
    let resolveCancelled!: () => void
    const cancelled = new Promise<void>(resolve => { resolveCancelled = resolve })
    const onAbort = () => {
      if (!restore.verification?.sent) {
        resolveCancelled()
        if (restore.signal === signal) restore.abort.abort()
      }
      if (attempt) this.finish(attempt, 'cancelled')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const verdict = await Promise.race([restore.result, cancelled])
      if (this.generations.get(endpoint) !== generation) return 'cancelled'
      if (verdict === 'ok') return 'authenticated'
      if (verdict === 'unknown') return 'unknown'
      if (signal?.aborted) return 'cancelled'
      if (this.active) return this.focusAttempt(this.active, endpoint)

      let resolve!: LoginAttempt['resolve']
      const result = new Promise<EchoFlowLoginResult>(done => { resolve = done })
      attempt = this.active = {
        profile: this.deps.profiles[endpoint], result, resolve, timers: {},
        loadId: 0, loadRetries: 0, blankPolls: 0, identityRejections: 0, lastIdentityAttemptAt: 0,
      }
      void this.startWindow(attempt)
      return await result
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async rehydrate(endpoint: EchoFlowLoginEndpoint = 'main'): Promise<boolean> {
    if (this.signingOut.has(endpoint) || this.active?.profile.endpoint === endpoint) return false
    const verdict = await this.restoreSession(endpoint).result
    // Both outcomes warrant a fresh account snapshot from the sidecar.
    return verdict === 'ok' || verdict === 'unknown'
  }

  async clear(endpoint: EchoFlowLoginEndpoint = 'main', disconnect?: () => Promise<void>): Promise<void> {
    const signingOut = this.signingOut.get(endpoint)
    if (signingOut) return signingOut
    const restore = this.restoring.get(endpoint)
    const attempt = this.active?.profile.endpoint === endpoint ? this.active : undefined
    const identity = attempt?.verification
    this.generations.set(endpoint, (this.generations.get(endpoint) ?? 0) + 1)
    this.restoring.delete(endpoint)
    if (!restore?.verification?.sent) restore?.abort.abort()
    const clearing = (async () => {
      // An already-sent write must settle before the explicit sign-out deletes it.
      await Promise.all([
        restore?.verification?.sent ? restore.result : undefined,
        identity?.sent ? identity.result : undefined,
        attempt?.cleanup,
      ])
      await disconnect?.()
      await this.clearEndpointState(endpoint)
    })().finally(() => this.signingOut.delete(endpoint))
    this.signingOut.set(endpoint, clearing)
    if (attempt) this.finish(attempt, 'cancelled')
    await clearing
  }

  private focusAttempt(attempt: LoginAttempt, endpoint: EchoFlowLoginEndpoint): Promise<EchoFlowLoginResult> {
    if (attempt.profile.endpoint !== endpoint) return Promise.resolve('cancelled')
    if (!attempt.finishing) {
      if (attempt.window) attempt.window.focus()
      else attempt.focusOnOpen = true
    }
    return attempt.result
  }

  private restoreSession(endpoint: EchoFlowLoginEndpoint, signal?: AbortSignal): Restore {
    const existing = this.restoring.get(endpoint)
    if (existing && (!existing.signal?.aborted || existing.verification?.sent)) {
      if (!signal) existing.signal = undefined
      return existing
    }
    const generation = this.generations.get(endpoint)
    const restore: Restore = { signal, abort: new AbortController(), result: Promise.resolve('unavailable') }
    const isCurrent = () => !restore.abort.signal.aborted
      && this.generations.get(endpoint) === generation
      && this.active?.profile.endpoint !== endpoint
    restore.result = (async () => {
      const credential = await this.deps.readCredential(endpoint, null, restore.abort.signal)
      if (!credential || !isCurrent()) return 'unavailable' as const
      const verification = restore.verification = this.verify(endpoint, credential, isCurrent, true)
      const verdict = await verification.result
      if (this.generations.get(endpoint) !== generation) return 'unavailable' as const
      if (verdict === 'rejected' && isCurrent()) await this.clearEndpointState(endpoint)
      return verdict
    })().catch(() => 'unavailable' as const).finally(() => {
      if (this.restoring.get(endpoint) === restore) this.restoring.delete(endpoint)
    })
    this.restoring.set(endpoint, restore)
    return restore
  }

  private verify(endpoint: EchoFlowLoginEndpoint, credential: EchoFlowLoginCredential, isCurrent: () => boolean, fromRestore = false): Verification {
    let sent = false
    const result = (async () => this.deps.verifySession(endpoint, credential, () => {
      if (sent || !isCurrent()) return false
      sent = true
      return true
    }, fromRestore))().catch(() => sent ? 'unknown' as const : 'unavailable' as const)
    return { get sent() { return sent }, result }
  }

  private async clearEndpointState(endpoint: EchoFlowLoginEndpoint): Promise<void> {
    await Promise.all([
      this.deps.clearCookies?.(endpoint),
      this.deps.clearStorage?.(endpoint),
    ])
  }

  private async startWindow(attempt: LoginAttempt): Promise<void> {
    const { profile, timers } = attempt
    try {
      const window = await this.deps.createWindow(profile.partition)
      if (this.active !== attempt || attempt.finishing) {
        window.close()
        return
      }
      attempt.window = window
      const isOpen = () => attempt.window === window
      window.webContents.setWindowOpenHandler(details => this.onWindowOpen(profile, details.url))
      for (const event of ['will-navigate', 'will-redirect'] as const) {
        window.webContents.on(event, loginNavigationGuard(profile))
      }
      window.webContents.on('dom-ready', () => {
        // The page can be usable while subresources are still loading.
        if (isOpen() && !attempt.loadFailed && isAllowedProfileNavigation(profile, window.webContents.getURL())) {
          clearTimeout(timers.load)
        }
      })
      window.webContents.on('did-finish-load', () => {
        if (isOpen()) this.markPageLoaded(attempt)
      })
      window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isOpen() && isMainFrame && code !== -3) this.onLoadFailed(attempt, window, code, description)
      })
      window.on('closed', () => {
        if (!isOpen()) return
        attempt.window = undefined
        this.finish(attempt, 'cancelled')
      })
      if (attempt.focusOnOpen) window.focus()
      timers.login = setTimeout(() => this.finish(attempt, 'failed', 'login-timeout'), this.loginTimeoutMs)
      let polling = false
      timers.poll = setInterval(() => {
        if (!polling) {
          polling = true
          void this.pollSession(attempt, window).finally(() => { polling = false })
        }
        void this.checkBlankLoginPage(attempt, window)
      }, this.pollIntervalMs)
      await this.loadLoginPage(attempt, window)
    } catch {
      this.finish(attempt, 'failed', 'window-start-failed')
    }
  }

  private async loadLoginPage(attempt: LoginAttempt, window: EchoFlowLoginWindow): Promise<void> {
    if (attempt.window !== window) return
    const { timers, profile } = attempt
    const loadId = ++attempt.loadId
    attempt.loadFailed = false
    attempt.pageLoaded = false
    attempt.blankPolls = 0
    clearTimeout(timers.failure)
    clearTimeout(timers.load)
    timers.load = setTimeout(() => this.finish(attempt, 'failed', 'load-timeout'), this.loadTimeoutMs)
    const isCurrent = () => attempt.window === window && attempt.loadId === loadId && !attempt.loadFailed
    try {
      await window.loadURL(profile.url)
      if (isCurrent() && !attempt.pageLoaded) this.markPageLoaded(attempt)
    } catch {
      // Electron can reject loadURL before dispatching its paired did-fail-load.
      if (isCurrent()) {
        timers.failure = setTimeout(() => {
          if (isCurrent()) this.finish(attempt, 'failed', 'load-failed')
        }, this.loadRetryDelayMs)
      }
    }
  }

  private markPageLoaded(attempt: LoginAttempt): void {
    // Electron can finish loading an error document after did-fail-load.
    if (attempt.loadFailed) return
    clearTimeout(attempt.timers.load)
    attempt.pageLoaded = true
    attempt.blankPolls = 0
  }

  private onLoadFailed(
    attempt: LoginAttempt,
    window: EchoFlowLoginWindow,
    errorCode: number,
    description: string,
  ): void {
    attempt.loadFailed = true
    clearTimeout(attempt.timers.failure)
    attempt.pageLoaded = false
    attempt.blankPolls = 0
    if (attempt.loadRetries >= this.loadRetryLimit) {
      this.finish(attempt, 'failed', `load-failed:${errorCode}:${description}`)
      return
    }
    clearTimeout(attempt.timers.retry)
    attempt.timers.retry = setTimeout(() => {
      void this.loadLoginPage(attempt, window)
    }, this.loadRetryDelayMs * ++attempt.loadRetries)
  }

  private async checkBlankLoginPage(attempt: LoginAttempt, window: EchoFlowLoginWindow): Promise<void> {
    if (attempt.window !== window || !attempt.pageLoaded || attempt.checkingBlank) return
    const loadId = attempt.loadId
    attempt.checkingBlank = true
    try {
      const length = await window.webContents.executeJavaScript(
        'document.body?.innerText?.trim().length ?? 0',
        true,
      )
      if (attempt.window !== window || attempt.loadId !== loadId || !attempt.pageLoaded) return
      if (typeof length !== 'number' || length > 0) {
        attempt.blankPolls = 0
        return
      }
      if (++attempt.blankPolls < BLANK_POLLS_BEFORE_RELOAD) return
      if (attempt.blankReloaded) {
        this.finish(attempt, 'failed', 'blank-page')
        return
      }
      // shortcut: host-side blank check, replace with the site's own preload-error handler once the site repo ships it.
      attempt.blankReloaded = true
      await this.loadLoginPage(attempt, window)
    } catch {
      // Mid-navigation; the next poll checks again.
    } finally {
      attempt.checkingBlank = false
    }
  }

  private async pollSession(attempt: LoginAttempt, window: EchoFlowLoginWindow): Promise<void> {
    if (attempt.window !== window) return
    const { endpoint } = attempt.profile
    let credential: EchoFlowLoginCredential | null
    try {
      credential = await this.deps.readCredential(endpoint, window)
    } catch {
      return
    }
    if (attempt.window !== window || !credential) return

    const fingerprint = credentialFingerprint(credential)
    const now = Date.now()
    if (fingerprint === attempt.lastCredentialKey && now - attempt.lastIdentityAttemptAt < this.identityRetryMs) return
    if (fingerprint !== attempt.lastCredentialKey) attempt.identityRejections = 0
    attempt.lastCredentialKey = fingerprint
    attempt.lastIdentityAttemptAt = now

    const verification = attempt.verification = this.verify(endpoint, credential, () => attempt.window === window)
    try {
      const verdict = await verification.result
      if (attempt.window !== window) return
      if (verdict === 'ok') this.finish(attempt, 'authenticated')
      if (verdict === 'unknown') this.finish(attempt, 'unknown')
      if (verdict === 'rejected' && ++attempt.identityRejections >= MAX_IDENTITY_REJECTIONS) {
        attempt.cleanup = this.clearEndpointState(endpoint).catch(() => {})
        await attempt.cleanup
        this.finish(attempt, 'failed', 'bootstrap-rejected')
      }
    } finally {
      attempt.verification = undefined
    }
  }

  private onWindowOpen(profile: EchoFlowLoginProfile, url: string): EchoFlowWindowOpenResult {
    if (!isAllowedProfileNavigation(profile, url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          partition: profile.partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    }
  }

  private finish(attempt: LoginAttempt, result: EchoFlowLoginResult, reason?: string): void {
    if (this.active !== attempt || attempt.finishing) return
    attempt.finishing = true
    for (const timer of Object.values(attempt.timers)) clearTimeout(timer)
    attempt.timers = {}
    attempt.lastCredentialKey = undefined
    const window = attempt.window
    attempt.window = undefined
    try {
      window?.close()
    } catch {
      // The view may already be gone.
    }
    if (reason) console.warn(`[echoFlowLogin] ${reason}`)

    const complete = (outcome: EchoFlowLoginResult) => {
      this.active = undefined
      attempt.resolve(outcome)
    }
    const { verification, profile, cleanup } = attempt
    if (cleanup) {
      // Do not let a new login race a partition wipe already in progress.
      void cleanup.then(() => complete(result))
      return
    }
    if (result === 'authenticated' || result === 'unknown' || !verification?.sent) {
      complete(result)
      return
    }
    void verification.result.then(verdict => {
      if (this.signingOut.has(profile.endpoint)) complete('cancelled')
      else if (verdict === 'ok') complete('authenticated')
      else if (verdict === 'unknown') complete('unknown')
      else complete(result)
    })
  }
}

function credentialFingerprint(credential: EchoFlowLoginCredential): string {
  return credential.kind === 'session'
    ? `session:${credential.userId}:${credential.cookie}`
    : `bearer:${credential.userId}:${credential.accessToken}`
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Convert Electron's host-only cookie records to a safe Cookie request header. */
export function siteCookieHeader(cookies: readonly SiteCookie[]): string {
  return cookies
    .filter(cookie => COOKIE_NAME_PATTERN.test(cookie.name) && !/[;\r\n\0]/.test(cookie.value))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}
