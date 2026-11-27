/**
 * HahaOAuthService — 桌面端自管 Claude OAuth token
 *
 * 为什么存在: macOS Keychain ACL 在 .app 被打上 quarantine 属性后
 * 对无 UI sidecar 静默拒绝,导致 CLI 读不到 OAuth token → 403。
 * 这个 service 把 token 存到 haha 自己的目录,并通过 env 注入给 CLI。
 *
 * 复用 src/services/oauth/{crypto,client}.ts 里的 PKCE + token exchange 逻辑,
 * 不复制粘贴 —— 保证跟 CLI 走同一套协议实现。
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import * as fs from 'fs/promises'
import { getEchoFlowInternalDir } from '../../utils/echoFlowConfigRoot.js'
import * as path from 'path'
import { logTokenRefreshFailure } from './oauthRefreshLog.js'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../../services/oauth/crypto.js'
import axios from 'axios'
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchProfileInfo,
  refreshOAuthToken,
  isOAuthTokenExpired,
  parseScopes,
} from '../../services/oauth/client.js'
import type {
  OAuthTokens,
  OAuthTokenExchangeResponse,
  SubscriptionType,
} from '../../services/oauth/types.js'
import { CLAUDE_AI_PROFILE_SCOPE, getOauthConfig } from '../../constants/oauth.js'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import { getNoProxy, shouldBypassProxy } from '../../utils/proxy.js'
import { getNetworkProxyUrl, loadNetworkSettings, mergeLoopbackNoProxy } from './networkSettings.js'

export type StoredOAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
}

export type OAuthSession = {
  state: string
  codeVerifier: string
  authorizeUrl: string
  serverPort: number
  createdAt: number
}

type RefreshFn = (
  refreshToken: string,
  opts?: { scopes?: string[]; proxyUrl?: string | null },
) => Promise<OAuthTokens>
type ExchangeFn = (
  authorizationCode: string,
  state: string,
  codeVerifier: string,
  port: number,
  useManualRedirect?: boolean,
  expiresIn?: number,
  opts?: { proxyUrl?: string | null },
) => Promise<OAuthTokenExchangeResponse>
type FetchProfileFn = (
  accessToken: string,
  opts?: { proxyUrl?: string | null },
) => Promise<{ subscriptionType: SubscriptionType | null }>

type FetchAccountUuidFn = (
  accessToken: string,
  opts?: { proxyUrl?: string | null },
) => Promise<string | null>

const SESSION_TTL_MS = 5 * 60 * 1000
const ACCOUNT_UUID_LOOKUP_TIMEOUT_MS = 3_000
const ACCOUNT_UUID_RETRY_BACKOFF_MS = 60_000

async function fetchAccountUuid(
  accessToken: string,
  opts: { proxyUrl?: string | null } = {},
): Promise<string | null> {
  const profile = await getOauthProfileFromOauthToken(accessToken, opts)
  return profile?.account?.uuid ?? null
}

export class HahaOAuthService {
  private sessions = new Map<string, OAuthSession>()
  private tokenRefreshes = new Map<string, Promise<StoredOAuthTokens | null>>()
  private generation = 0
  private accountUuid: string | null = null
  private accountUuidRetryAt = 0
  private refreshFn: RefreshFn = refreshOAuthToken
  private exchangeFn: ExchangeFn = exchangeCodeForTokens
  private fetchProfileFn: FetchProfileFn = fetchProfileInfo
  private fetchAccountUuidFn: FetchAccountUuidFn = fetchAccountUuid

  setFetchAccountUuidFn(fn: FetchAccountUuidFn = fetchAccountUuid): void {
    this.fetchAccountUuidFn = fn
    this.forgetAccountUuid()
  }

  private forgetAccountUuid(): void {
    this.accountUuid = null
    this.accountUuidRetryAt = 0
  }

  setRefreshFn(fn: RefreshFn): void {
    this.refreshFn = fn
  }

  setExchangeFn(fn: ExchangeFn): void {
    this.exchangeFn = fn
  }

  setFetchProfileFn(fn: FetchProfileFn): void {
    this.fetchProfileFn = fn
  }

  private getOAuthFilePath(): string {
    return path.join(getEchoFlowInternalDir(), 'oauth.json')
  }

  async loadTokens(): Promise<StoredOAuthTokens | null> {
    try {
      const raw = await fs.readFile(this.getOAuthFilePath(), 'utf-8')
      return JSON.parse(raw) as StoredOAuthTokens
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    this.writeTokens(tokens)
    this.generation++
    this.tokenRefreshes.clear()
    this.forgetAccountUuid()
  }

  private writeTokens(tokens: StoredOAuthTokens): void {
    const filePath = this.getOAuthFilePath()
    mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}`
    try {
      writeFileSync(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
      renameSync(tmp, filePath)
    } finally {
      rmSync(tmp, { force: true })
    }
  }

  async deleteTokens(): Promise<void> {
    this.generation++
    this.sessions.clear()
    this.tokenRefreshes.clear()
    this.forgetAccountUuid()
    rmSync(this.getOAuthFilePath(), { force: true })
  }

  startSession({ serverPort }: { serverPort: number }): OAuthSession {
    this.sessions.clear()
    this.generation++
    this.tokenRefreshes.clear()

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    const authorizeUrl = buildAuthUrl({
      codeChallenge,
      state,
      port: serverPort,
      isManual: false,
      loginWithClaudeAi: true,
    })

    const session: OAuthSession = {
      state,
      codeVerifier,
      authorizeUrl,
      serverPort,
      createdAt: Date.now(),
    }
    this.sessions.set(state, session)
    return session
  }

  getSession(state: string): OAuthSession | null {
    const s = this.sessions.get(state)
    if (!s) return null
    if (Date.now() - s.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(state)
      return null
    }
    return s
  }

  consumeSession(state: string): OAuthSession | null {
    const s = this.getSession(state)
    if (s) this.sessions.delete(state)
    return s
  }

  async completeSession(
    authorizationCode: string,
    state: string,
  ): Promise<StoredOAuthTokens> {
    const session = this.consumeSession(state)
    if (!session) {
      throw new Error('OAuth session not found or expired')
    }

    const generation = this.generation
    const response = await this.exchangeWithCustomCallback(
      authorizationCode,
      state,
      session.codeVerifier,
      session.serverPort,
    )
    const networkSettings = await loadNetworkSettings()
    const profile = await this.fetchProfileFn(response.access_token, {
      proxyUrl: getNetworkProxyUrl(networkSettings),
    })

    const tokens: StoredOAuthTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: parseScopes(response.scope),
      subscriptionType: profile.subscriptionType,
    }
    if (generation !== this.generation) throw new Error('OAuth sign-in was cancelled')
    await this.saveTokens(tokens)
    return tokens
  }

  /**
   * The same axios request the CLI makes (`exchangeCodeForTokens`), so the wire
   * identity — User-Agent, Accept, body — is the CLI's. Only the proxy comes
   * from the desktop network settings.
   */
  private async exchangeWithCustomCallback(
    code: string,
    state: string,
    verifier: string,
    port: number,
  ): Promise<OAuthTokenExchangeResponse> {
    const networkSettings = await loadNetworkSettings()
    try {
      const configuredProxy = getNetworkProxyUrl(networkSettings)
      const bypass = shouldBypassProxy(getOauthConfig().TOKEN_URL, mergeLoopbackNoProxy(getNoProxy()))
      return await this.exchangeFn(code, state, verifier, port, false, undefined, {
        proxyUrl: bypass ? null : configuredProxy,
      })
    } catch (err) {
      // axios only reports "Request failed with status code N"; the token
      // endpoint's own error body is what makes a failed login diagnosable.
      if (axios.isAxiosError(err) && err.response) {
        const { status, data } = err.response
        const body = typeof data === 'string' ? data : JSON.stringify(data)
        throw new Error(`Token exchange failed (${status}): ${body}`)
      }
      throw err
    }
  }

  async ensureFreshTokens(): Promise<StoredOAuthTokens | null> {
    const generation = this.generation
    const tokens = await this.loadTokens()
    if (!tokens || generation !== this.generation) return null

    if (tokens.expiresAt === null) return tokens

    if (!isOAuthTokenExpired(tokens.expiresAt)) return tokens

    if (!tokens.refreshToken) return null

    return this.refreshTokensOnce(tokens)
  }

  async recoverFromUnauthorized(
    failedAccessToken: string,
  ): Promise<StoredOAuthTokens | null> {
    const rejectedToken = failedAccessToken.trim()
    if (!rejectedToken) return null
    return this.refreshRejectedToken(rejectedToken)
  }

  private async refreshRejectedToken(
    rejectedToken: string,
  ): Promise<StoredOAuthTokens | null> {
    const generation = this.generation
    const tokens = await this.loadTokens()
    if (!tokens || generation !== this.generation) return null

    // Another session may already have rotated the shared token while this
    // 401 event was in flight. Reuse that value instead of rotating again.
    if (tokens.accessToken !== rejectedToken) return tokens
    if (!tokens.refreshToken) return null

    return this.refreshTokensOnce(tokens)
  }

  private async refreshTokensOnce(
    tokens: StoredOAuthTokens,
  ): Promise<StoredOAuthTokens | null> {
    const pending = this.tokenRefreshes.get(tokens.accessToken)
    if (pending) return pending

    const refresh = (async () => {
      try {
        return await this.refreshStoredTokens(tokens)
      } catch (err) {
        logTokenRefreshFailure('[HahaOAuthService]', err)
        return null
      }
    })()
    this.tokenRefreshes.set(tokens.accessToken, refresh)
    try {
      return await refresh
    } finally {
      if (this.tokenRefreshes.get(tokens.accessToken) === refresh) {
        this.tokenRefreshes.delete(tokens.accessToken)
      }
    }
  }

  private async refreshStoredTokens(
    tokens: StoredOAuthTokens,
  ): Promise<StoredOAuthTokens | null> {
    const generation = this.generation
    if (!tokens.refreshToken) {
      throw new Error('Claude OAuth refresh token is unavailable')
    }
    const networkSettings = await loadNetworkSettings()
    const refreshed = await this.refreshFn(tokens.refreshToken, {
      scopes: tokens.scopes,
      proxyUrl: getNetworkProxyUrl(networkSettings),
    })
    const updated: StoredOAuthTokens = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes,
      subscriptionType: refreshed.subscriptionType ?? tokens.subscriptionType,
    }
    if (generation !== this.generation) return null
    this.writeTokens(updated)
    return updated
  }

  /**
   * UUID of the account the stored token belongs to, for the CLI child's
   * `metadata.user_id`. A token injected through CLAUDE_CODE_OAUTH_TOKEN has no
   * profile scope on the CLI side, so the CLI cannot look this up itself.
   *
   * Best effort: the answer is cached for the life of the process (it only
   * changes on login or logout), a slow profile endpoint is not allowed to hold
   * up a session start, and any failure just leaves the UUID unset. A failed
   * lookup is not repeated for a while, so an unreachable or refusing endpoint
   * costs one wait rather than one per session.
   */
  async getAccountUuid(accessToken: string): Promise<string | null> {
    if (this.accountUuid) return this.accountUuid
    if (Date.now() < this.accountUuidRetryAt) return null

    // A token issued before `user:profile` was requested is refused by the
    // profile endpoint; do not ask.
    const generation = this.generation
    const stored = await this.loadTokens().catch(() => null)
    if (generation !== this.generation || (stored && stored.accessToken !== accessToken)) return null
    if (stored && !stored.scopes.includes(CLAUDE_AI_PROFILE_SCOPE)) return null

    const lookup = (async () => {
      const networkSettings = await loadNetworkSettings()
      const uuid = await this.fetchAccountUuidFn(accessToken, {
        proxyUrl: getNetworkProxyUrl(networkSettings),
      })
      // A late answer still warms the cache for the next session.
      if (generation !== this.generation) return null
      if (uuid) this.accountUuid = uuid
      return uuid
    })().catch(() => null)

    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ACCOUNT_UUID_LOOKUP_TIMEOUT_MS).unref?.()
    })
    const uuid = await Promise.race([lookup, timeout])
    if (!uuid && generation === this.generation) this.accountUuidRetryAt = Date.now() + ACCOUNT_UUID_RETRY_BACKOFF_MS
    return uuid
  }

  async ensureFreshAccessToken(): Promise<string | null> {
    const tokens = await this.ensureFreshTokens()
    return tokens?.accessToken ?? null
  }
}

export const hahaOAuthService = new HahaOAuthService()
