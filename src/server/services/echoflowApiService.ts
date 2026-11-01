import * as fs from 'fs/promises'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import { getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot.js'
import { diagnosticsService } from './diagnosticsService.js'

export type EchoFlowApiErrorCode = 'token_invalid' | 'service_unavailable' | 'invalid_response'

export class EchoFlowApiError extends Error {
  constructor(
    public readonly code: EchoFlowApiErrorCode,
    public readonly status?: number,
    /** The gateway's own message, kept so a rejected sign-in can be explained. */
    public readonly detail?: string,
  ) {
    super(code)
    this.name = 'EchoFlowApiError'
  }
}

export interface EchoFlowUserInfo {
  balance: number
  userGroup: string
  username: string
}

export interface EchoFlowTokenOption {
  id: string
  name: string
  /** The gateway hands the key out once, at create time; a listed token may not have one. */
  key?: string
  status?: string
  remainQuota?: number
  unlimitedQuota?: boolean
}

export type EchoFlowTokenSummary = Omit<EchoFlowTokenOption, 'key'> & {
  keyPreview: string
}

export type EchoFlowEndpoint = 'main' | 'dedicated'

export type EchoFlowAccount = {
  userId: string
  balance?: number
  userGroup?: string
  username?: string
  tokens?: EchoFlowTokenSummary[]
  refreshedAt?: number
  endpoint?: EchoFlowEndpoint
  /** A session or bearer account is usable only while this process holds it. */
  live?: boolean
}

export type EchoFlowCredential =
  | { kind: 'token'; userId: string; managementToken: string }
  | { kind: 'session'; userId: string; cookie: string; browser?: EchoFlowBrowserProfile }
  | { kind: 'bearer'; userId: string; accessToken: string }

/**
 * The gateway binds a browser session to the network fingerprint it was
 * created with — client address plus the request's own headers — and answers
 * `Session network fingerprint changed` once they differ. These are the values
 * the Electron sign-in window used, replayed on every server-side call.
 */
export type EchoFlowBrowserProfile = {
  userAgent: string
  acceptLanguage?: string
}

type EchoFlowCredentialKind = EchoFlowCredential['kind']

type StoredEchoFlowAccount = {
  userId: string
  credential?: EchoFlowCredentialKind
  managementToken?: string
  balance?: number
  userGroup?: string
  username?: string
  tokens?: EchoFlowTokenOption[]
  refreshedAt?: number
  endpoint?: EchoFlowEndpoint
}

type StoredEchoFlowAccounts = {
  schemaVersion: 3
  accounts: Record<EchoFlowEndpoint, StoredEchoFlowAccount | null>
}

const EMPTY_ACCOUNTS: StoredEchoFlowAccounts = {
  schemaVersion: 3,
  accounts: { main: null, dedicated: null },
}

export const ECHOFLOW_BASE_URLS: Record<EchoFlowEndpoint, string> = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
}

export class EchoFlowApiService {
  constructor(private defaultBaseUrl = ECHOFLOW_BASE_URLS.main) {}

  private readonly credentials = new Map<EchoFlowEndpoint, EchoFlowCredential>()

  private getBaseUrl(endpoint?: EchoFlowEndpoint): string {
    if (!endpoint) return this.defaultBaseUrl
    return ECHOFLOW_BASE_URLS[endpoint] || this.defaultBaseUrl
  }

  async getAccounts(): Promise<Record<EchoFlowEndpoint, EchoFlowAccount | null>> {
    const stored = await this.readAccounts()
    return {
      main: stored.accounts.main ? toPublicAccount(stored.accounts.main, this.isLive('main', stored.accounts.main)) : null,
      dedicated: stored.accounts.dedicated ? toPublicAccount(stored.accounts.dedicated, this.isLive('dedicated', stored.accounts.dedicated)) : null,
    }
  }

  private isLive(endpoint: EchoFlowEndpoint, account: StoredEchoFlowAccount): boolean {
    // Token accounts keep their credential on disk; session and bearer
    // credentials live in memory only, so they are usable only in this process.
    if (account.credential === 'session' || account.credential === 'bearer') {
      return this.credentials.has(endpoint)
    }
    return true
  }

  async getAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount | null> {
    const accounts = await this.getAccounts()
    return accounts[endpoint]
  }

  clearCredential(endpoint: EchoFlowEndpoint): void {
    this.credentials.delete(endpoint)
  }

  async setCredential(endpoint: EchoFlowEndpoint, credential: EchoFlowCredential): Promise<EchoFlowAccount> {
    // The main site signs in with a cookie and the gateway with its own bearer
    // token, so each kind is only valid on the endpoint it comes from.
    if (credential.kind === 'session' && endpoint === 'dedicated') {
      throw new EchoFlowApiError('token_invalid')
    }
    if (credential.kind === 'bearer' && endpoint === 'main') {
      throw new EchoFlowApiError('token_invalid')
    }
    const trimmed: EchoFlowCredential = { ...credential, userId: credential.userId.trim() }
    if (!trimmed.userId) throw new EchoFlowApiError('token_invalid')

    const user = await this.validateCredential(trimmed, endpoint)
    this.credentials.set(endpoint, trimmed)

    const accounts = await this.readAccounts()
    const previous = accounts.accounts[endpoint]
    const stored: StoredEchoFlowAccount = trimmed.kind === 'token'
      ? {
          userId: trimmed.userId,
          credential: 'token',
          managementToken: trimmed.managementToken,
          ...user,
          tokens: reattachStoredTokenKeys(
            await this.listTokensWithCredential(endpoint),
            previous?.tokens,
            previous?.userId === trimmed.userId,
          ),
          refreshedAt: Date.now(),
          endpoint,
        }
      : {
          // The cookie or bearer token stays in memory; only identity is stored.
          userId: trimmed.userId,
          credential: trimmed.kind,
          username: user.username || previous?.username,
          endpoint,
        }
    accounts.accounts[endpoint] = stored
    await this.writeAccounts(accounts)
    return toPublicAccount(stored, true)
  }

  async bindAccount(userId: string, managementToken: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount> {
    const account = await this.refreshWithCredentials(userId, managementToken, endpoint)
    const accounts = await this.readAccounts()
    const stored: StoredEchoFlowAccount = {
      ...account,
      credential: 'token' as const,
      managementToken,
      endpoint,
      tokens: reattachStoredTokenKeys(
        account.tokens ?? [],
        accounts.accounts[endpoint]?.tokens,
        accounts.accounts[endpoint]?.userId === account.userId,
      ),
    }
    accounts.accounts[endpoint] = stored
    await this.writeAccounts(accounts)
    return toPublicAccount(stored)
  }

  // Kept as a compatibility boundary for older clients. It only reads the
  // requested account now; it never changes credentials or aliases a route.
  async updateEndpoint(endpoint: EchoFlowEndpoint): Promise<EchoFlowAccount> {
    const account = await this.getAccount(endpoint)
    if (!account) throw new EchoFlowApiError('token_invalid')
    return account
  }

  async refreshAccount(endpoint: EchoFlowEndpoint = 'main', created?: { id?: string; name: string; key: string }): Promise<EchoFlowAccount> {
    const accounts = await this.readAccounts()
    const account = accounts.accounts[endpoint]
    if (!account) throw new EchoFlowApiError('token_invalid')
    const credential = this.credentials.get(endpoint) ?? storedCredential(account)
    if (!credential) throw new EchoFlowApiError('token_invalid')
    this.credentials.set(endpoint, credential)

    let user: EchoFlowUserInfo
    try {
      user = await this.validateCredential(credential, endpoint)
    } catch (error) {
      console.warn('[echoflow-api] account-refresh-failed:', JSON.stringify({
        endpoint,
        kind: credential.kind,
        path: endpoint === 'dedicated' ? '/api/v1/auth/me' : '/api/user/self',
        status: error instanceof EchoFlowApiError ? error.status : undefined,
        code: error instanceof EchoFlowApiError ? error.code : 'unexpected',
      }))
      // A rejected credential must not keep the account looking live: the UI
      // offers sign-in again only when the account is not live.
      if (error instanceof EchoFlowApiError && error.code === 'token_invalid') {
        this.credentials.delete(endpoint)
      }
      throw error
    }
    const stored: StoredEchoFlowAccount = {
      ...account,
      userId: credential.userId,
      credential: credential.kind,
      ...(credential.kind === 'token' ? { managementToken: credential.managementToken } : {}),
      ...user,
      // Both gateways expose a call-token list; the dedicated one is just a
      // different path (`/api/v1/keys`) and is selected by gateway, not by
      // credential kind.
      tokens: rememberCreatedToken(
        reattachStoredTokenKeys(
          await this.listTokensWithCredential(endpoint),
          account.tokens,
          account.userId === credential.userId,
        ),
        created,
      ),
      refreshedAt: Date.now(),
      endpoint,
    }
    accounts.accounts[endpoint] = stored
    await this.writeAccounts(accounts)
    return toPublicAccount(stored, true)
  }

  /**
   * Creates a call token with the same defaults the site's own console uses.
   * `unlimited_quota` is not optional: without it the gateway makes a token
   * with zero quota, which authenticates and then refuses every request.
   * `routing_priority: 'auto'` is the console's answer to "At least one group
   * must be selected when smart routing is disabled" — smart routing on.
   */
  async createAccountToken(endpoint: EchoFlowEndpoint = 'main', name = 'echoflow-code'): Promise<EchoFlowAccount> {
    const credential = this.credentials.get(endpoint)
    if (!credential) throw new EchoFlowApiError('token_invalid')
    const created = endpoint === 'dedicated'
      ? await this.createDedicatedKey(credential, endpoint, name)
      : await this.fetchManagementApi<{ success?: boolean; message?: unknown; data?: unknown }>('/api/token/', credential, endpoint, {
        method: 'POST',
        body: JSON.stringify({
          name,
          expired_time: -1,
          remain_quota: 0,
          unlimited_quota: true,
          model_limits_enabled: false,
          model_limits: '',
          routing_priority: 'auto',
        }),
      })
    const refusal = gatewayRefusal(created)
    if (refusal) throw new EchoFlowApiError('invalid_response', undefined, refusal)
    console.info('[echoflow-api] token-created:', JSON.stringify({
      endpoint,
      success: created.success,
      message: typeof created.message === 'string' ? created.message : undefined,
      result: typeof created.data,
    }))
    // The gateway hands the key out once, right here; its token list never
    // repeats it, so this is the only chance to keep it.
    const createdToken = created.data && typeof created.data === 'object'
      ? {
          id: 'id' in created.data && (typeof created.data.id === 'string' || typeof created.data.id === 'number') ? String(created.data.id) : undefined,
          key: 'key' in created.data && typeof created.data.key === 'string' && created.data.key.startsWith('sk-') ? created.data.key : undefined,
        }
      : undefined
    const createdKey = typeof created.data === 'string' && created.data.startsWith('sk-') ? created.data : createdToken?.key
    const account = await this.refreshAccount(endpoint, createdKey ? { id: createdToken?.id, name, key: createdKey } : undefined)
    console.info('[echoflow-api] token-list-confirmed:', JSON.stringify({
      endpoint,
      expectedName: name,
      names: account.tokens?.map(token => token.name) ?? [],
    }))
    if (!account.tokens?.some((token) => token.name === name)) {
      throw new EchoFlowApiError('invalid_response', undefined, `the gateway accepted the create but ${name} is not present in its call token list`)
    }
    return account
  }

  /** The dedicated gateway's call-token resource is `/api/v1/keys`, and every key needs a group. */
  private async createDedicatedKey(credential: EchoFlowCredential, endpoint: EchoFlowEndpoint, name: string) {
    const groups = await this.fetchManagementApi<{ success?: boolean; code?: unknown; message?: unknown; data?: unknown }>(
      '/api/v1/groups/available', credential, endpoint,
    )
    const refusal = gatewayRefusal(groups)
    if (refusal) throw new EchoFlowApiError('invalid_response', undefined, refusal)
    const groupId = firstGroupId(groups.data ?? groups)
    if (groupId === null) {
      throw new EchoFlowApiError('invalid_response', undefined, 'the gateway offers no group to create a call token in')
    }
    return await this.fetchManagementApi<{ success?: boolean; message?: unknown; data?: unknown }>(
      '/api/v1/keys',
      credential,
      endpoint,
      { method: 'POST', body: JSON.stringify({ name, group_id: groupId }) },
    )
  }

  async selectAccountToken(endpoint: EchoFlowEndpoint, id: string): Promise<EchoFlowTokenOption> {
    const accounts = await this.readAccounts()
    const token = accounts.accounts[endpoint]?.tokens?.find((candidate) => candidate.id === id)
    if (!token) throw new EchoFlowApiError('token_invalid')
    // A literal "sk-" is not a credential. The gateway only returns a key when
    // a token is created, so a listed token without a stored key cannot be
    // turned into a provider; saying so is the only honest answer.
    if (!token.key) {
      throw new EchoFlowApiError(
        'token_invalid',
        undefined,
        'this token has no stored key; its key is only shown when the token is created, so create a new token',
      )
    }
    return { ...token, key: withApiKeyPrefix(token.key) }
  }

  async disconnectAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<void> {
    this.credentials.delete(endpoint)
    const accounts = await this.readAccounts()
    accounts.accounts[endpoint] = null
    await this.writeAccounts(accounts)
  }

  async validateManagementToken(userId: string, token: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowUserInfo> {
    return await this.validateCredential({ kind: 'token', userId, managementToken: token }, endpoint)
  }

  private async validateCredential(credential: EchoFlowCredential, endpoint: EchoFlowEndpoint): Promise<EchoFlowUserInfo> {
    // The account route belongs to the gateway, not to how the caller signed in.
    if (endpoint === 'dedicated') {
      const me = await this.fetchManagementApi<{
        success?: boolean
        code?: unknown
        message?: unknown
        data?: { id?: number | string; quota?: number; balance?: number; group?: string; username?: string; name?: string }
        quota?: number
        balance?: number
        group?: string
        username?: string
        name?: string
      }>('/api/v1/auth/me', credential, endpoint)

      const refusal = gatewayRefusal(me)
      if (refusal) {
        throw new EchoFlowApiError(isAuthFailure(refusal) ? 'token_invalid' : 'service_unavailable', undefined, refusal)
      }
      const account = me.data ?? me
      return {
        balance: typeof account.quota === 'number'
          ? account.quota / 500000
          : typeof account.balance === 'number' ? account.balance : 0,
        userGroup: account.group ?? 'default',
        username: account.username ?? account.name ?? '',
      }
    }

    const data = await this.fetchManagementApi<{ success?: boolean; message?: string; data?: { quota?: number; group?: string; username?: string } }>(
      '/api/user/self',
      credential,
      endpoint,
    )

    if (!data.success) {
      throw new EchoFlowApiError(isAuthFailure(data.message) ? 'token_invalid' : 'service_unavailable')
    }

    const account = data.data ?? {}
    return {
      balance: typeof account.quota === 'number' ? account.quota / 500000 : 0,
      userGroup: account.group ?? 'default',
      username: account.username ?? '',
    }
  }

  async listTokens(userId: string, token: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowTokenOption[]> {
    return await this.listTokensForCredential({ kind: 'token', userId, managementToken: token }, endpoint)
  }

  async listTokensWithCredential(endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowTokenOption[]> {
    const credential = this.credentials.get(endpoint)
    if (!credential) throw new EchoFlowApiError('token_invalid')
    return await this.listTokensForCredential(credential, endpoint)
  }

  private async listTokensForCredential(credential: EchoFlowCredential, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowTokenOption[]> {
    const pageSize = 100
    const tokens: EchoFlowTokenOption[] = []
    const seen = new Set<string>()
    // The dedicated gateway's call-token resource is `/api/v1/keys` (sub2api);
    // `/api/token/` only exists on the main site. The route belongs to the
    // gateway, so a management token bound to the dedicated gateway takes it too.
    // Each one also numbers its own list pages: the main console's first call is
    // `/api/token/?p=0`, the dedicated one starts at `page=1`.
    const [firstPage, listPath] = endpoint === 'dedicated'
      ? [1, (page: number) => `/api/v1/keys?page=${page}&page_size=${pageSize}`]
      : [0, (page: number) => `/api/token/?p=${page}&size=${pageSize}`]

    // Continue while a full page comes back, with a hard cap so a broken
    // upstream cannot create an endless loop.
    for (let page = firstPage; page <= firstPage + 100; page += 1) {
      const data = await this.fetchManagementApi<{
        success?: boolean
        data?: unknown[] | { items?: unknown[]; tokens?: unknown[]; records?: unknown[] }
      }>(listPath(page), credential, endpoint)

      // A refused page is not an empty list: returning the tokens collected so
      // far would tell the user their account has none.
      const refusal = gatewayRefusal(data)
      if (refusal) throw new EchoFlowApiError('invalid_response', undefined, refusal)
      // Both gateways may wrap the payload (`{code:0,data}` / `{success,data}`)
      // or answer with the list itself; read whichever is there.
      const payload = data.data ?? data
      const rawList = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.tokens)
            ? payload.tokens
            : Array.isArray(payload.records)
              ? payload.records
              : []
      const normalized = rawList.map(normalizeToken).filter((item): item is EchoFlowTokenOption => !!item)
      for (const item of normalized) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        tokens.push(item)
      }
      if (rawList.length < pageSize) break
    }

    return tokens
  }

  private async refreshWithCredentials(userId: string, managementToken: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount> {
    const trimmedUserId = userId.trim()
    const trimmedToken = managementToken.trim()
    if (!trimmedUserId || !trimmedToken) throw new EchoFlowApiError('token_invalid')

    const user = await this.validateManagementToken(trimmedUserId, trimmedToken, endpoint)
    const tokens = await this.listTokens(trimmedUserId, trimmedToken, endpoint)
    return {
      ...user,
      userId: trimmedUserId,
      tokens,
      refreshedAt: Date.now(),
      endpoint,
    }
  }

  private getAccountPath(): string {
    return path.join(getEchoFlowInternalDir(getEchoFlowConfigDir()), 'echoflow-account.json')
  }

  private getLegacyAccountPath(): string {
    return path.join(getEchoFlowInternalDir(getEchoFlowConfigDir()), 'qingyun-account.json')
  }

  private async readAccounts(): Promise<StoredEchoFlowAccounts> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.getAccountPath(), 'utf-8')) as unknown
      const normalized = normalizeStoredAccounts(parsed)
      if (normalized) {
        if ((parsed as { schemaVersion?: unknown }).schemaVersion !== 3) {
          await this.backupAccountsFile()
          await this.writeAccounts(normalized)
        }
        return normalized
      }
      if (isStoredAccount(parsed)) {
        await this.backupAccountsFile()
        const endpoint: EchoFlowEndpoint = parsed.endpoint === 'dedicated' ? 'dedicated' : 'main'
        const account = { ...parsed, credential: parsed.credential ?? 'token', endpoint }
        const migrated: StoredEchoFlowAccounts = {
          schemaVersion: 3,
          accounts: {
            main: endpoint === 'dedicated' ? null : account,
            dedicated: endpoint === 'dedicated' ? account : null,
          },
        }
        await this.writeAccounts(migrated)
        return migrated
      }
      return { ...EMPTY_ACCOUNTS, accounts: { ...EMPTY_ACCOUNTS.accounts } }
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error
    }

    try {
      const parsed = JSON.parse(await fs.readFile(this.getLegacyAccountPath(), 'utf-8')) as unknown
      if (!isStoredAccount(parsed)) return { ...EMPTY_ACCOUNTS, accounts: { ...EMPTY_ACCOUNTS.accounts } }
      const migrated: StoredEchoFlowAccounts = {
        schemaVersion: 3,
        accounts: {
          main: { ...parsed, credential: parsed.credential ?? 'token', endpoint: 'main' },
          dedicated: null,
        },
      }
      await this.writeAccounts(migrated)
      await fs.unlink(this.getLegacyAccountPath()).catch((error) => {
        if (errnoCode(error) !== 'ENOENT') throw error
      })
      return migrated
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return { ...EMPTY_ACCOUNTS, accounts: { ...EMPTY_ACCOUNTS.accounts } }
      throw error
    }
  }

  private async backupAccountsFile(): Promise<void> {
    const accountPath = this.getAccountPath()
    const backupPath = `${accountPath}.bak-before-migration-${Date.now()}`
    await fs.copyFile(accountPath, backupPath)
    await fs.chmod(backupPath, 0o600)
  }

  private async writeAccounts(accounts: StoredEchoFlowAccounts): Promise<void> {
    const accountPath = this.getAccountPath()
    await fs.mkdir(path.dirname(accountPath), { recursive: true })
    const temporaryPath = `${accountPath}.tmp.${randomBytes(3).toString('hex')}`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(accounts, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
      await fs.rename(temporaryPath, accountPath)
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  private async fetchManagementApi<T>(
    pathname: string,
    credential: EchoFlowCredential,
    endpoint: EchoFlowEndpoint = 'main',
    init: { method?: string; body?: string } = {},
  ): Promise<T> {
    const baseUrl = this.getBaseUrl(endpoint)
    // Both browser logins are bound to the client that created them. Bearer
    // means the dedicated page's JWT here, not a caller-supplied API key.
    const bridge = siteNetworkBridgeConfig()
    const throughBrowser = bridge && (credential.kind === 'session' || credential.kind === 'bearer')
    const method = init.method ?? 'GET'
    const transport = throughBrowser ? 'chromium-bridge' : 'direct'
    console.info('[echoflow-api] gateway-request:', JSON.stringify({
      endpoint,
      kind: credential.kind,
      method,
      pathname,
      transport,
    }))
    try {
      if (throughBrowser && bridge) {
        return await fetchThroughSiteBridge<T>(bridge, `${baseUrl}${pathname}`, credential, init)
      }
      // The site console sends `New-Api-User`, `X-Forwarded-Host` and
      // `Cache-Control` on every call. The gateway reads the forwarded host to
      // pick the tenant, so a session cookie without it comes back as "not
      // signed in" even though the cookie itself is valid.
      const headers = credential.kind === 'session'
        ? sessionHeaders(baseUrl, credential)
        : credential.kind === 'bearer'
          ? { Authorization: `Bearer ${credential.accessToken}` }
          : { 'new-api-user': credential.userId, Authorization: credential.managementToken }
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(init.body === undefined ? {} : { body: init.body }),
      }).catch(() => { throw new EchoFlowApiError('service_unavailable') })

      if (!response.ok) throw await failureFromUpstream(response)

      return await response.json().catch(() => { throw new EchoFlowApiError('invalid_response', response.status) }) as T
    } catch (error) {
      if (error instanceof EchoFlowApiError) {
        void diagnosticsService.recordEvent({
          type: 'echoflow_gateway_request_failed',
          severity: 'warn',
          summary: 'EchoFlow gateway request failed',
          details: {
            endpoint,
            credentialKind: credential.kind,
            method,
            transport,
            errorCode: error.code,
            ...(error.status === undefined ? {} : { status: error.status }),
          },
        })
      }
      throw error
    }
  }
}

function siteNetworkBridgeConfig(): { url: string; token: string } | null {
  const url = process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_URL
  const token = process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN
  return url && token ? { url, token } : null
}

async function fetchThroughSiteBridge<T>(
  bridge: { url: string; token: string },
  url: string,
  credential: EchoFlowCredential,
  init: { method?: string; body?: string },
): Promise<T> {
  const target = new URL(url)
  const response = await fetch(`${bridge.url}/fetch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-echoflow-site-bridge': bridge.token },
    body: JSON.stringify({
      url,
      method: init.method ?? 'GET',
      ...(init.body === undefined ? {} : { body: init.body }),
      headers: credential.kind === 'bearer'
        ? { Authorization: `Bearer ${credential.accessToken}` }
        : {
            'New-Api-User': credential.userId,
            'X-Forwarded-Host': target.host,
            'Cache-Control': 'no-store',
          },
    }),
  }).catch(() => { throw new EchoFlowApiError('service_unavailable') })

  if (!response.ok) throw await failureFromUpstream(response)

  const relay = await response.json().catch(() => {
    throw new EchoFlowApiError('invalid_response', response.status)
  }) as { status?: unknown; body?: unknown }
  const status = typeof relay.status === 'number' ? relay.status : 0
  const text = typeof relay.body === 'string' ? relay.body : ''
  // The gateway's answer travels as a string; keep its status so a refused
  // sign-in still reports the reason the gateway gave.
  if (status < 200 || status >= 300) {
    throw new EchoFlowApiError(
      status >= 500 ? 'service_unavailable' : 'token_invalid',
      status,
      parseUpstreamMessage(text),
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new EchoFlowApiError('invalid_response', status)
  }
}

async function failureFromUpstream(response: Response): Promise<EchoFlowApiError> {
  return new EchoFlowApiError(
    response.status >= 500 ? 'service_unavailable' : 'token_invalid',
    response.status,
    await readUpstreamMessage(response),
  )
}

function sessionHeaders(
  baseUrl: string,
  credential: { userId: string; cookie: string; browser?: EchoFlowBrowserProfile },
): Record<string, string> {
  const url = new URL(baseUrl)
  const headers: Record<string, string> = {
    Cookie: credential.cookie,
    'New-Api-User': credential.userId,
    'X-Forwarded-Host': url.host,
    'Cache-Control': 'no-store',
  }
  if (!credential.browser) return headers
  // What Chromium sends from the console page. Without it the gateway sees a
  // different client than the one that signed in and drops the session.
  return {
    ...headers,
    'User-Agent': credential.browser.userAgent,
    'Accept-Language': credential.browser.acceptLanguage ?? 'zh-CN',
    Accept: 'application/json, text/plain, */*',
    Origin: url.origin,
    Referer: `${url.origin}/console`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  }
}

async function readUpstreamMessage(response: Response): Promise<string | undefined> {
  return parseUpstreamMessage(await response.text().catch(() => ''))
}

function parseUpstreamMessage(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } | unknown }
    // Two envelopes on this gateway: management calls answer
    // `{success, message}`, OpenAI-compatible ones answer
    // `{error: {message, type}}`. Both carry the reason; neither is optional.
    const message = typeof body.error === 'object' && body.error !== null && 'message' in body.error
      ? body.error.message
      : body.message
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300)
  } catch {}
  return text.trim().slice(0, 300) || undefined
}

function toPublicAccount(account: StoredEchoFlowAccount, live = true): EchoFlowAccount {
  return {
    userId: account.userId,
    live,
    ...(typeof account.balance === 'number' ? { balance: account.balance } : {}),
    ...(account.userGroup ? { userGroup: account.userGroup } : {}),
    ...(account.username ? { username: account.username } : {}),
    ...(account.tokens ? { tokens: account.tokens.map(toTokenSummary) } : {}),
    ...(typeof account.refreshedAt === 'number' ? { refreshedAt: account.refreshedAt } : {}),
    ...(account.endpoint ? { endpoint: account.endpoint } : { endpoint: 'main' as EchoFlowEndpoint }),
  }
}

function toTokenSummary(token: EchoFlowTokenOption): EchoFlowTokenSummary {
  return {
    id: token.id,
    name: token.name,
    ...(token.status ? { status: token.status } : {}),
    ...(typeof token.remainQuota === 'number' ? { remainQuota: token.remainQuota } : {}),
    ...(typeof token.unlimitedQuota === 'boolean' ? { unlimitedQuota: token.unlimitedQuota } : {}),
    keyPreview: token.key ? maskKey(withApiKeyPrefix(token.key)) : '',
  }
}

function withApiKeyPrefix(key: string): string {
  return key.startsWith('sk-') ? key : `sk-${key}`
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return key.startsWith('sk-') ? `sk-${'•'.repeat(Math.max(4, key.length - 3))}` : '••••••••'
  // 保留 sk- 前缀（如果有的话）加上后面几个字符
  if (key.startsWith('sk-')) {
    return `sk-${key.slice(3, 6)}****${key.slice(-4)}`
  }
  return `${key.slice(0, 6)}****${key.slice(-4)}`
}

function normalizeStoredAccounts(value: unknown): StoredEchoFlowAccounts | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { schemaVersion?: unknown; accounts?: unknown }
  if ((record.schemaVersion !== 2 && record.schemaVersion !== 3) || !record.accounts || typeof record.accounts !== 'object') return null
  const accounts = record.accounts as Record<string, unknown>
  const main = toStoredAccount(accounts.main)
  const dedicated = toStoredAccount(accounts.dedicated)
  if (accounts.main !== null && !main) return null
  if (accounts.dedicated !== null && !dedicated) return null
  // Root-level unknown fields survive the v2 -> v3 rewrite.
  return { ...record, schemaVersion: 3, accounts: { main, dedicated } }
}

function toStoredAccount(value: unknown): StoredEchoFlowAccount | null {
  if (value === null) return null
  if (!isStoredAccount(value)) return null
  return { ...value, credential: value.credential ?? 'token' }
}

function isStoredAccount(value: unknown): value is StoredEchoFlowAccount {
  if (!value || typeof value !== 'object') return false
  const record = value as { userId?: unknown; managementToken?: unknown; credential?: unknown }
  if (typeof record.userId !== 'string') return false
  if (record.credential === 'session' || record.credential === 'bearer') return true
  return typeof record.managementToken === 'string'
}

/** Only a token account can be rebuilt from disk; session and bearer cannot. */
function storedCredential(account: StoredEchoFlowAccount): EchoFlowCredential | null {
  if ((account.credential ?? 'token') === 'token' && account.managementToken) {
    return { kind: 'token', userId: account.userId, managementToken: account.managementToken }
  }
  return null
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function normalizeToken(value: unknown): EchoFlowTokenOption | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const key = stringFrom(record.key) ?? stringFrom(record.token) ?? stringFrom(record.value)
  // Identity is what makes a listed entry a token. The gateway hands the key out
  // once at create time, so requiring one here emptied every token list.
  const id = stringFrom(record.id) ?? key ?? stringFrom(record.name)
  if (!id) return null
  return {
    id,
    name: stringFrom(record.name) ?? id,
    ...(key ? { key } : {}),
    status: stringFrom(record.status),
    remainQuota: numberFrom(record.remain_quota),
    unlimitedQuota: booleanFrom(record.unlimited_quota),
  }
}

/** A rejected create carries the gateway's own reason; keep it for the UI. */
function gatewayRefusal(body: { success?: boolean; code?: unknown; message?: unknown }): string | undefined {
  const refused = body.success === false || (typeof body.code === 'number' && body.code !== 0)
  if (!refused) return undefined
  // A refusal with no reason is still a refusal: callers decide on the string,
  // so returning nothing here reads as "succeeded, nothing to report".
  return typeof body.message === 'string' && body.message
    ? body.message
    : 'the gateway refused the request without a reason'
}

/**
 * The gateway's token list never repeats a key, but the key we captured at
 * create time is still valid. Keep it on the same id so a refresh does not
 * turn every stored token back into an unusable one. Keys belong to the user
 * that created them, so a sign-in for a different account must drop them.
 */
function reattachStoredTokenKeys(
  tokens: EchoFlowTokenOption[],
  stored?: EchoFlowTokenOption[],
  sameUser = true,
): EchoFlowTokenOption[] {
  if (!sameUser || !stored?.length) return tokens
  const keyedStored = stored.filter((token) => token.key)
  const keysById = new Map(keyedStored.map((token) => [token.id, token.key!]))
  const syntheticByName = new Map(
    keyedStored.filter((token) => token.id === token.name || token.id === `created:${token.name}`).map((token) => [token.name, token.key!]),
  )
  return tokens.map((token) => {
    const key = keysById.get(token.id)
      ?? (tokens.filter((candidate) => candidate.name === token.name).length === 1 ? syntheticByName.get(token.name) : undefined)
    return !token.key && key ? { ...token, key } : token
  })
}

function rememberCreatedToken(
  tokens: EchoFlowTokenOption[],
  created?: { id?: string; name: string; key: string },
): EchoFlowTokenOption[] {
  if (!created) return tokens
  if (created.id) {
    const byId = tokens.find((token) => token.id === created.id)
    if (byId) {
      return tokens.map((token) => token === byId ? { ...token, key: token.key ?? created.key } : token)
    }
  }
  const matches = tokens.filter((token) => token.name === created.name)
  // Two same-named tokens cannot be told apart by name. The create response
  // carries only the key, so attaching it to either one risks giving a
  // provider the wrong credential; keep it under its own name instead. A
  // single match that already holds a different key is an older token, not
  // this one — only the same key or no key identifies it.
  const match = matches.length === 1 ? matches[0] : undefined
  if (match && (!match.key || match.key === created.key)) {
    return match.key
      ? tokens
      : tokens.map((token) => (token === match ? { ...token, key: created.key } : token))
  }
  return [...tokens, { id: created.id ?? `created:${created.name}`, name: created.name, key: created.key }]
}

/** `/api/v1/groups/available` answers with a bare list or an envelope around one. */
function firstGroupId(value: unknown): number | string | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : []
  for (const entry of list) {
    const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined
    if (typeof id === 'number' || (typeof id === 'string' && id)) return id
  }
  return null
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function booleanFrom(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function isAuthFailure(message: string | undefined): boolean {
  const lower = message?.toLowerCase() ?? ''
  return lower.includes('token') ||
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('invalid') ||
    lower.includes('令牌') ||
    lower.includes('无效') ||
    lower.includes('无权') ||
    lower.includes('未授权') ||
    lower.includes('认证') ||
    lower.includes('鉴权')
}
