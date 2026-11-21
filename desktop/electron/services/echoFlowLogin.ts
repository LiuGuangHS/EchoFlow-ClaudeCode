import { parseSiteIdentity, type EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export type { EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export type EchoFlowLoginResult = 'authenticated' | 'cancelled' | 'failed'

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

type Verification = { sent: boolean; result: Promise<EchoFlowLoginVerification> }
type Restore = { signal?: AbortSignal; verification?: Verification; result: Promise<EchoFlowLoginVerification> }

export interface EchoFlowLoginWindow {
  webContents: {
    on(event: 'will-navigate' | 'will-redirect', listener: (navigation: { preventDefault(): void }, url: string) => void): void
    on(event: 'did-fail-load', listener: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void): void
    on(event: 'did-finish-load', listener: () => void): void
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
  readCredential: (endpoint: EchoFlowLoginEndpoint, window: EchoFlowLoginWindow | null) => Promise<EchoFlowLoginCredential | null>
  /** Call before sending the account write. A false return means it must not be sent. */
  verifySession: (endpoint: EchoFlowLoginEndpoint, credential: EchoFlowLoginCredential, beginRequest: () => boolean) => Promise<EchoFlowLoginVerification>
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

export function isAllowedProfileNavigation(profile: EchoFlowLoginProfile, value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === profile.origin || profile.allowedHosts.has(url.hostname)
  } catch {
    return false
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
  window: EchoFlowLoginWindow,
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
export class EchoFlowLoginSession {
  private window: EchoFlowLoginWindow | null = null
  private activeProfile: EchoFlowLoginProfile | null = null
  private pending: Promise<EchoFlowLoginResult> | null = null
  private opening: Promise<void> | null = null
  private readonly restoring = new Map<EchoFlowLoginEndpoint, Restore>()
  private readonly signingOut = new Map<EchoFlowLoginEndpoint, Promise<void>>()
  private readonly generations = new Map<EchoFlowLoginEndpoint, number>()
  private settled: ((result: EchoFlowLoginResult) => void) | null = null
  private readonly verified = new Set<EchoFlowLoginEndpoint>()
  private loadRetriesUsed = 0
  private loadRetryTimer: ReturnType<typeof setTimeout> | null = null
  private loadFailureFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private loadAttemptId = 0
  private loadFailureEventReceived = false
  private loadTimer: ReturnType<typeof setTimeout> | null = null
  private loginTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private identityInFlight: Verification | null = null
  private identityRejections = 0
  private lastCredentialKey = ''
  private pageLoaded = false
  private blankPolls = 0
  private blankReloaded = false
  private blankCheckInFlight = false
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

  async open(endpoint: EchoFlowLoginEndpoint = 'main', signal?: AbortSignal): Promise<EchoFlowLoginResult> {
    if (signal?.aborted || this.signingOut.has(endpoint)) return 'cancelled'
    if (this.pending) {
      this.focusWindow()
      return this.pending
    }

    let pending: Promise<EchoFlowLoginResult> | undefined
    const generation = this.generations.get(endpoint)
    const restore = this.restoreSession(endpoint, signal)
    let resolveCancelled!: () => void
    const cancelled = new Promise<void>(resolve => { resolveCancelled = resolve })
    const onAbort = () => {
      if (!restore.verification?.sent) resolveCancelled()
      if (pending && this.pending === pending) this.cancelLogin()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const verdict = await Promise.race([restore.result, cancelled])
      if (this.generations.get(endpoint) !== generation) return 'cancelled'
      if (verdict === 'ok') return 'authenticated'
      if (verdict === 'unknown') return 'failed'
      if (signal?.aborted) return 'cancelled'
      if (this.pending) {
        this.focusWindow()
        return await this.pending
      }

      pending = this.pending = new Promise(resolve => { this.settled = resolve })
      const opening = this.opening = this.startWindow(endpoint, pending)
      void opening.then(() => { if (this.opening === opening) this.opening = null })
      return await pending
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async rehydrate(endpoint: EchoFlowLoginEndpoint = 'main'): Promise<boolean> {
    if (this.signingOut.has(endpoint)) return false
    return await this.restoreSession(endpoint).result === 'ok'
  }

  async clear(endpoint: EchoFlowLoginEndpoint = 'main', disconnect?: () => Promise<void>): Promise<void> {
    const signingOut = this.signingOut.get(endpoint)
    if (signingOut) return signingOut
    const restore = this.restoring.get(endpoint)
    const active = this.activeProfile?.endpoint === endpoint
    const identity = active ? this.identityInFlight : null
    this.generations.set(endpoint, (this.generations.get(endpoint) ?? 0) + 1)
    this.restoring.delete(endpoint)
    this.verified.delete(endpoint)
    if (active) this.cancelLogin()
    const clearing = (async () => {
      // An already-sent write must settle before the explicit sign-out deletes it.
      await Promise.all([restore?.verification?.sent ? restore.result : undefined, identity?.sent ? identity.result : undefined])
      await disconnect?.()
      await this.clearEndpointState(endpoint)
    })().finally(() => this.signingOut.delete(endpoint))
    this.signingOut.set(endpoint, clearing)
    await clearing
  }

  private focusWindow(): void {
    if (this.window) this.window.focus()
    else {
      const pending = this.pending
      void this.opening?.then(() => { if (this.pending === pending) this.window?.focus() })
    }
  }

  private restoreSession(endpoint: EchoFlowLoginEndpoint, signal?: AbortSignal): Restore {
    const existing = this.restoring.get(endpoint)
    if (existing && (!existing.signal?.aborted || existing.verification?.sent)) {
      if (!signal) existing.signal = undefined
      return existing
    }
    const generation = this.generations.get(endpoint)
    const restore: Restore = { signal, result: Promise.resolve('unavailable') }
    const isCurrent = () => !restore.signal?.aborted && this.generations.get(endpoint) === generation
    this.verified.delete(endpoint)
    restore.result = (async () => {
      const credential = await this.deps.readCredential(endpoint, null)
      if (!credential || !isCurrent()) return 'unavailable' as const
      const verification = restore.verification = this.verify(endpoint, credential, isCurrent)
      const verdict = await verification.result
      if (this.generations.get(endpoint) !== generation) return 'unavailable' as const
      if (verdict === 'ok') this.verified.add(endpoint)
      if (verdict === 'rejected' && isCurrent()) await this.clearEndpointState(endpoint)
      return verdict
    })().catch(() => 'unavailable' as const).finally(() => {
      if (this.restoring.get(endpoint) === restore) this.restoring.delete(endpoint)
    })
    this.restoring.set(endpoint, restore)
    return restore
  }

  private verify(endpoint: EchoFlowLoginEndpoint, credential: EchoFlowLoginCredential, isCurrent: () => boolean): Verification {
    let sent = false
    const result = (async () => this.deps.verifySession(endpoint, credential, () => {
      if (sent || !isCurrent()) return false
      sent = true
      return true
    }))().catch(() => sent ? 'unknown' as const : 'unavailable' as const)
    return { get sent() { return sent }, result }
  }

  private async clearEndpointState(endpoint: EchoFlowLoginEndpoint): Promise<void> {
    await Promise.all([
      this.deps.clearCookies?.(endpoint),
      this.deps.clearStorage?.(endpoint),
    ])
  }

  private cancelLogin(): void {
    if (this.window) this.finishAndClose(this.window, 'cancelled')
    else this.finish('cancelled')
  }

  private async startWindow(endpoint: EchoFlowLoginEndpoint, pending: Promise<EchoFlowLoginResult>): Promise<void> {
    const profile = this.activeProfile = this.deps.profiles[endpoint]
    let window: EchoFlowLoginWindow | null = null
    try {
      window = await this.deps.createWindow(profile.partition)
      if (this.pending !== pending) {
        window.close()
        return
      }
      this.window = window
      this.loadRetriesUsed = 0
      this.loadAttemptId = 0
      this.loadFailureEventReceived = false
      this.identityRejections = 0
      this.lastCredentialKey = ''
      this.pageLoaded = false
      this.blankPolls = 0
      this.blankReloaded = false
      const loginWindow = window

      window.webContents.setWindowOpenHandler(details => this.onWindowOpen(profile, details.url))
      for (const event of ['will-navigate', 'will-redirect'] as const) {
        window.webContents.on(event, (navigation, target) => {
          if (!isAllowedProfileNavigation(profile, target)) navigation.preventDefault()
        })
      }
      window.webContents.on('did-finish-load', () => {
        // Electron can finish loading an error document after did-fail-load.
        if (this.window !== loginWindow || this.loadFailureEventReceived) return
        this.clearLoadTimeout()
        this.pageLoaded = true
        this.blankPolls = 0
      })
      window.webContents.on('did-fail-load', (_event, errorCode, description, _url, isMainFrame) => {
        if (this.window === loginWindow) this.onLoadFailed(loginWindow, errorCode, description, isMainFrame)
      })
      window.on('closed', () => this.onWindowClosed(loginWindow))

      this.loginTimer = setTimeout(
        () => this.failAndClose(loginWindow, 'login-timeout'),
        this.loginTimeoutMs,
      )
      this.pollTimer = setInterval(
        () => {
          void this.pollSession(loginWindow, endpoint)
          void this.checkBlankLoginPage(loginWindow)
        },
        this.pollIntervalMs,
      )

      await this.loadLoginPage(loginWindow, profile)
    } catch (error) {
      if (this.pending === pending) this.failAndClose(window, 'window-start-failed', error)
    }
  }

  private async loadLoginPage(window: EchoFlowLoginWindow, profile: EchoFlowLoginProfile): Promise<void> {
    if (this.window !== window) return
    const attemptId = ++this.loadAttemptId
    this.loadFailureEventReceived = false
    this.clearLoadFailureFallback()
    this.pageLoaded = false
    this.blankPolls = 0
    this.clearLoadTimeout()
    this.loadTimer = setTimeout(
      () => this.failAndClose(window, 'load-timeout'),
      this.loadTimeoutMs,
    )
    try {
      await window.loadURL(profile.url)
      // Some Electron/test implementations resolve loadURL without emitting
      // did-finish-load; a resolved navigation is still eligible for blank recovery.
      if (this.window === window && !this.pageLoaded) this.pageLoaded = true
    } catch (error) {
      // Electron can reject loadURL before dispatching its paired did-fail-load.
      // Give that event one retry window, then fail if no event belongs to this load.
      if (
        this.window === window
        && this.loadAttemptId === attemptId
        && !this.loadFailureEventReceived
      ) {
        this.loadFailureFallbackTimer = setTimeout(() => {
          this.loadFailureFallbackTimer = null
          if (
            this.window === window
            && this.loadAttemptId === attemptId
            && !this.loadFailureEventReceived
          ) this.failAndClose(window, 'load-failed', error)
        }, this.loadRetryDelayMs)
      }
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
    this.loadFailureEventReceived = true
    this.clearLoadFailureFallback()
    this.pageLoaded = false
    this.blankPolls = 0
    if (this.loadRetriesUsed >= this.loadRetryLimit) {
      this.failAndClose(window, `load-failed:${errorCode}:${description}`)
      return
    }
    this.loadRetriesUsed += 1
    if (this.loadRetryTimer) clearTimeout(this.loadRetryTimer)
    this.loadRetryTimer = setTimeout(() => {
      this.loadRetryTimer = null
      const profile = this.activeProfile
      if (this.window === window && profile) void this.loadLoginPage(window, profile)
    }, this.loadRetryDelayMs * this.loadRetriesUsed)
  }

  /**
   * The site bundle sometimes finishes loading without painting anything, and
   * the window then sits white until the login timeout. One reload recovers
   * that; a second blank page is a real failure and keeps waiting.
   */
  private async checkBlankLoginPage(window: EchoFlowLoginWindow): Promise<void> {
    if (this.window !== window || !this.pageLoaded || this.blankCheckInFlight) return
    this.blankCheckInFlight = true
    try {
      const length = await window.webContents.executeJavaScript(
        'document.body?.innerText?.trim().length ?? 0',
        true,
      )
      if (this.window !== window || !this.pageLoaded) return
      if (typeof length !== 'number' || length > 0) {
        this.blankPolls = 0
        return
      }
      this.blankPolls += 1
      if (this.blankPolls < BLANK_POLLS_BEFORE_RELOAD) return
      this.blankPolls = 0
      if (this.blankReloaded) {
        this.failAndClose(window, 'blank-page')
        return
      }
      // shortcut: host-side blank check, replace with the site's own preload-error handler once the site repo ships it.
      this.blankReloaded = true
      const profile = this.activeProfile
      if (profile) await this.loadLoginPage(window, profile)
    } catch {
      // Mid-navigation; the next poll checks again.
    } finally {
      this.blankCheckInFlight = false
    }
  }

  private async pollSession(window: EchoFlowLoginWindow, endpoint: EchoFlowLoginEndpoint): Promise<void> {
    if (this.window !== window || this.identityInFlight || this.verified.has(endpoint)) return

    let credential: EchoFlowLoginCredential | null
    try {
      credential = await this.deps.readCredential(endpoint, window)
    } catch {
      return
    }
    if (this.window !== window || this.identityInFlight || !credential) return

    const fingerprint = credentialFingerprint(credential)
    const now = Date.now()
    if (
      fingerprint === this.lastCredentialKey
      && now - this.lastIdentityAttemptAt < this.identityRetryMs
    ) return
    // A different credential means a new sign-in attempt, not a retry of the failure.
    if (fingerprint !== this.lastCredentialKey) this.identityRejections = 0
    this.lastCredentialKey = fingerprint
    this.lastIdentityAttemptAt = now

    const verification = this.identityInFlight = this.verify(endpoint, credential, () => this.window === window)
    try {
      const verdict = await verification.result
      if (this.window !== window) return
      if (verdict === 'unknown') {
        this.finishAndClose(window, 'failed')
        return
      }
      if (verdict === 'rejected') {
        this.identityRejections += 1
        if (this.identityRejections >= MAX_IDENTITY_REJECTIONS) {
          // The credential the page handed back is the old one; wipe it before
          // closing so a retry cannot replay the same rejection loop.
          try {
            await Promise.all([
              this.deps.clearCookies?.(endpoint),
              this.deps.clearStorage?.(endpoint),
            ])
          } catch {
            // Wiping is best-effort; the window still has to close.
          }
          this.failAndClose(window, 'bootstrap-rejected')
        }
        return
      }
      // `unavailable` is the bridge not answering, not a verdict: keep waiting.
      if (verdict !== 'ok') return
      this.identityRejections = 0
      this.verified.add(endpoint)
      this.finishAndClose(window, 'authenticated')
    } catch {
      // Transient read or bridge failures are retried on the next poll.
    } finally {
      if (this.identityInFlight === verification) this.identityInFlight = null
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

  private clearLoadFailureFallback(): void {
    if (this.loadFailureFallbackTimer) {
      clearTimeout(this.loadFailureFallbackTimer)
      this.loadFailureFallbackTimer = null
    }
  }

  private clearTimers(): void {
    this.clearLoadTimeout()
    this.clearLoadFailureFallback()
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
    if (!resolve) return
    this.settled = null
    const endpoint = this.activeProfile?.endpoint
    const verification = this.identityInFlight
    const complete = (outcome: EchoFlowLoginResult) => {
      this.activeProfile = null
      this.pending = null
      if (this.identityInFlight === verification) this.identityInFlight = null
      resolve(outcome)
    }
    if (result !== 'authenticated' && verification?.sent) {
      void verification.result.then(verdict => {
        if (endpoint && this.signingOut.has(endpoint)) complete('cancelled')
        else if (verdict === 'ok') complete('authenticated')
        else if (verdict === 'unknown') complete('failed')
        else complete(result)
      })
    } else complete(result)
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
