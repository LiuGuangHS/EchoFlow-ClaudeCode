const ECHOFLOW_MAIN_ORIGIN = 'https://api.echoflowai.cc'
const SITE_ACCOUNT_TIMEOUT_MS = 10_000
const MAX_SITE_RESPONSE_BYTES = 64 * 1024
const MAX_SITE_COOKIE_LENGTH = 16 * 1024

export type EchoFlowSiteAccount = {
  userId: string
  username: string
  balance: number
  refreshedAt: number
}

export type EchoFlowSiteSessionErrorCode = 'session_invalid' | 'service_unavailable' | 'invalid_response'

export class EchoFlowSiteSessionError extends Error {
  constructor(readonly code: EchoFlowSiteSessionErrorCode) {
    super(code)
    this.name = 'EchoFlowSiteSessionError'
  }
}

type EchoFlowSiteSessionDeps = {
  fetch?: typeof fetch
  now?: () => number
}

type SelfResponse = {
  success?: unknown
  data?: {
    id?: unknown
    username?: unknown
    quota?: unknown
  }
}

/** Keeps the authenticated main-site cookie in memory and exposes only account display data. */
export class EchoFlowSiteSession {
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private cookie: string | null = null
  private userId: string | null = null
  private account: EchoFlowSiteAccount | null = null

  constructor(deps: EchoFlowSiteSessionDeps = {}) {
    this.fetcher = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.now = deps.now ?? Date.now
  }

  async setSession(input: { cookie: string; userId: string }): Promise<EchoFlowSiteAccount> {
    if (!isValidCookie(input.cookie) || !isValidUserId(input.userId)) throw new EchoFlowSiteSessionError('invalid_response')
    const account = await this.readAccount(input.cookie, input.userId)
    this.cookie = input.cookie
    this.userId = input.userId
    this.account = account
    return account
  }

  getStatus(): EchoFlowSiteAccount | null {
    return this.account
  }

  async refresh(): Promise<EchoFlowSiteAccount> {
    if (!this.cookie || !this.userId) throw new EchoFlowSiteSessionError('session_invalid')
    const account = await this.readAccount(this.cookie, this.userId)
    this.account = account
    return account
  }

  clear(): void {
    this.cookie = null
    this.userId = null
    this.account = null
  }

  private async readAccount(cookie: string, expectedUserId: string): Promise<EchoFlowSiteAccount> {
    let response: Response
    try {
      response = await this.fetcher(`${ECHOFLOW_MAIN_ORIGIN}/api/user/self`, {
        method: 'GET',
        headers: { Accept: 'application/json', Cookie: cookie, 'New-Api-User': expectedUserId },
        signal: AbortSignal.timeout(SITE_ACCOUNT_TIMEOUT_MS),
      })
    } catch {
      throw new EchoFlowSiteSessionError('service_unavailable')
    }

    if (response.status === 401 || response.status === 403) throw new EchoFlowSiteSessionError('session_invalid')
    if (!response.ok) throw new EchoFlowSiteSessionError('service_unavailable')

    let payload: SelfResponse
    try {
      const body = await response.text()
      if (Buffer.byteLength(body) > MAX_SITE_RESPONSE_BYTES) throw new Error('response too large')
      payload = JSON.parse(body) as SelfResponse
    } catch {
      throw new EchoFlowSiteSessionError('invalid_response')
    }

    const data = payload.data
    const userId = data?.id
    const username = data?.username
    const quota = data?.quota
    if (payload.success !== true
      || !(typeof userId === 'string' && userId.trim() !== '' || typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0)
      || String(userId) !== expectedUserId
      || typeof username !== 'string' || username.trim() === ''
      || typeof quota !== 'number' || !Number.isFinite(quota) || quota < 0) {
      throw new EchoFlowSiteSessionError('invalid_response')
    }

    return {
      userId: String(userId),
      username: username.trim(),
      balance: quota / 500_000,
      refreshedAt: this.now(),
    }
  }
}

function isValidCookie(cookie: string): boolean {
  return cookie.trim() !== ''
    && cookie.length <= MAX_SITE_COOKIE_LENGTH
    && !/[\r\n\0]/.test(cookie)
}

function isValidUserId(userId: string): boolean {
  return userId.trim() !== '' && userId.length <= 128 && !/[\r\n\0]/.test(userId)
}
