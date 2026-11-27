import * as fs from 'fs/promises'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
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
  private readonly credentialVersions: Record<EchoFlowEndpoint, number> = { main: 0, dedicated: 0 }
  // Do not reuse an old credential under a login's new version while it is being verified.
  private readonly pendingCredentials = new Map<EchoFlowEndpoint, number>()
  // shortcut: in-process writers only, add a file lock before introducing another writer process.
  private static readonly accountFileLocks = new Map<string, Promise<void>>()

  private assertCredentialVersion(endpoint: EchoFlowEndpoint, version: number): void {
    if (this.credentialVersions[endpoint] !== version) throw new EchoFlowApiError('token_invalid')
  }

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
      const credential = this.credentials.get(endpoint)
      return credential?.kind === account.credential && credential.userId === account.userId
    }
    return true
  }

  async getAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount | null> {
    const accounts = await this.getAccounts()
    return accounts[endpoint]
  }

  clearCredential(endpoint: EchoFlowEndpoint): void {
    this.credentialVersions[endpoint] += 1
    this.pendingCredentials.delete(endpoint)
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

    const version = ++this.credentialVersions[endpoint]
    this.pendingCredentials.set(endpoint, version)
    try {
      const user = await this.validateCredential(trimmed, endpoint)
      this.assertCredentialVersion(endpoint, version)
      const tokens = trimmed.kind === 'token' ? await this.listTokensForCredential(trimmed, endpoint) : undefined

      return await this.commitAccount(endpoint, version, trimmed, (previous) => {
        const sameAccount = previous?.userId === trimmed.userId ? previous : undefined
        const { managementToken: _previousToken, ...metadata } = sameAccount ?? {}
        return trimmed.kind === 'token'
        ? {
            ...metadata,
            userId: trimmed.userId,
            credential: 'token',
            managementToken: trimmed.managementToken,
            ...user,
            tokens: reattachStoredTokenKeys(tokens ?? [], previous?.tokens, previous?.userId === trimmed.userId),
            refreshedAt: Date.now(),
            endpoint,
          }
        : {
            ...metadata,
            userId: trimmed.userId,
            credential: trimmed.kind,
            username: user.username || sameAccount?.username,
            endpoint,
          }
      })
    } finally {
      if (this.pendingCredentials.get(endpoint) === version) this.pendingCredentials.delete(endpoint)
    }
  }

  async bindAccount(userId: string, managementToken: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount> {
    const trimmedToken = managementToken.trim()
    if (!trimmedToken) throw new EchoFlowApiError('token_invalid')
    return this.setCredential(endpoint, { kind: 'token', userId, managementToken: trimmedToken })
  }

  // Kept as a compatibility boundary for older clients. It only reads the
  // requested account now; it never changes credentials or aliases a route.
  async updateEndpoint(endpoint: EchoFlowEndpoint): Promise<EchoFlowAccount> {
    const account = await this.getAccount(endpoint)
    if (!account) throw new EchoFlowApiError('token_invalid')
    return account
  }

  async refreshAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount> {
    const version = this.credentialVersions[endpoint]
    if (this.pendingCredentials.has(endpoint)) throw new EchoFlowApiError('token_invalid')
    const accounts = await this.readAccounts()
    this.assertCredentialVersion(endpoint, version)
    const account = accounts.accounts[endpoint]
    if (!account) throw new EchoFlowApiError('token_invalid')
    const credential = this.credentials.get(endpoint) ?? storedCredential(account)
    if (!credential) throw new EchoFlowApiError('token_invalid')

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
      if (error instanceof EchoFlowApiError && error.code === 'token_invalid' && this.credentialVersions[endpoint] === version) {
        this.clearCredential(endpoint)
      }
      throw error
    }
    this.assertCredentialVersion(endpoint, version)
    return this.refreshTokens(endpoint, version, credential, user)
  }

  private async refreshTokens(endpoint: EchoFlowEndpoint, version: number, credential: EchoFlowCredential,
    user?: EchoFlowUserInfo, created?: { id?: string; name: string; key: string }): Promise<EchoFlowAccount> {
    const tokens = await this.listTokensForCredential(credential, endpoint).catch((error) => {
      // The create response is the only copy of that key; a list that
      // fails right after must not take it down with it.
      if (!created) throw error
      console.warn('[echoflow-api] token-list-after-create-failed:', JSON.stringify({
        endpoint,
        code: error instanceof EchoFlowApiError ? error.code : 'unexpected',
        status: error instanceof EchoFlowApiError ? error.status : undefined,
      }))
      return null
    })
    return this.commitAccount(endpoint, version, credential, (previous) => {
      if (!previous || previous.userId !== credential.userId || previous.credential !== credential.kind) throw new EchoFlowApiError('token_invalid')
      return {
        ...previous,
        userId: credential.userId,
        credential: credential.kind,
        ...(credential.kind === 'token' ? { managementToken: credential.managementToken } : {}),
        ...user,
        tokens: rememberCreatedToken(
          reattachStoredTokenKeys(tokens ?? previous.tokens ?? [], previous.tokens, previous.userId === credential.userId),
          created,
        ),
        ...(user ? { refreshedAt: Date.now() } : {}),
        endpoint,
      }
    })
  }

  /**
   * Creates a call token with the same defaults the site's own console uses.
   * `unlimited_quota` is not optional: without it the gateway makes a token
   * with zero quota, which authenticates and then refuses every request.
   * `routing_priority: 'auto'` is the console's answer to "At least one group
   * must be selected when smart routing is disabled" — smart routing on.
   */
  async createAccountToken(endpoint: EchoFlowEndpoint = 'main', name = 'echoflow-code'): Promise<EchoFlowAccount> {
    // A management-token account keeps its credential on disk, so creating a
    // token must work right after a restart, before any refresh loads it.
    const version = this.credentialVersions[endpoint]
    if (this.pendingCredentials.has(endpoint)) throw new EchoFlowApiError('token_invalid')
    let credential = this.credentials.get(endpoint)
    if (!credential) {
      const stored = (await this.readAccounts()).accounts[endpoint]
      credential = stored ? storedCredential(stored) ?? undefined : undefined
    }
    if (!credential) throw new EchoFlowApiError('token_invalid')
    this.assertCredentialVersion(endpoint, version)
    const body = endpoint === 'dedicated'
      ? { name, group_id: await this.getDedicatedGroupId(credential) }
      : { name, expired_time: -1, remain_quota: 0, unlimited_quota: true, model_limits_enabled: false, model_limits: '', routing_priority: 'auto' }
    this.assertCredentialVersion(endpoint, version)
    const uncertainCreate = (status?: number) => new EchoFlowApiError(
      'service_unavailable', status, 'create outcome is uncertain; check the gateway token list before retrying',
    )
    let response: unknown
    try {
      response = await this.fetchManagementApi(endpoint === 'dedicated' ? '/api/v1/keys' : '/api/token/', credential, endpoint, {
        method: 'POST', body: JSON.stringify(body),
      })
    } catch (error) {
      if (!(error instanceof EchoFlowApiError)) throw error
      const unreadableSuccess = error.code === 'invalid_response' && error.status !== undefined && error.status >= 200 && error.status < 300
      if (error.code !== 'service_unavailable' && !unreadableSuccess) throw error
      throw uncertainCreate(error.status)
    }
    this.assertCredentialVersion(endpoint, version)
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw uncertainCreate()
    const created: { success?: boolean; code?: unknown; message?: unknown; data?: unknown } = response
    const refusal = gatewayRefusal(created)
    if (refusal) throw new EchoFlowApiError('invalid_response', undefined, safeGatewayDetail(refusal, credential))
    console.info('[echoflow-api] token-created:', JSON.stringify({
      endpoint,
      success: created.success,
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
    const account = await this.refreshTokens(endpoint, version, credential, undefined, createdKey ? { id: createdToken?.id, name, key: createdKey } : undefined)
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
  private async getDedicatedGroupId(credential: EchoFlowCredential) {
    const groups = await this.fetchManagementApi<{ success?: boolean; code?: unknown; message?: unknown; data?: unknown }>(
      '/api/v1/groups/available', credential, 'dedicated',
    )
    const refusal = gatewayRefusal(groups)
    if (refusal) throw new EchoFlowApiError('invalid_response', undefined, safeGatewayDetail(refusal, credential))
    const groupId = firstGroupId(groups.data ?? groups)
    if (groupId === null) {
      throw new EchoFlowApiError('invalid_response', undefined, 'the gateway offers no group to create a call token in')
    }
    return groupId
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
    this.clearCredential(endpoint)
    await this.withAccountFile(async (accountPath) => {
      const accounts = await this.readAccountsFile(accountPath)
      accounts.accounts[endpoint] = null
      await this.writeAccounts(accounts, accountPath)
    })
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
        throw new EchoFlowApiError(isAuthFailure(refusal) ? 'token_invalid' : 'service_unavailable', undefined, safeGatewayDetail(refusal, credential))
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

    const data = await this.fetchManagementApi<{ success?: boolean; message?: string; data?: { id?: number | string; user_id?: number | string; quota?: number; group?: string; username?: string } }>(
      '/api/user/self',
      credential,
      endpoint,
    )

    if (!data.success) {
      throw new EchoFlowApiError(isAuthFailure(data.message) ? 'token_invalid' : 'service_unavailable')
    }

    const account = data.data ?? {}
    // A restored cookie and the userId next to it must name the same user: a
    // login window closed after signing into another account leaves the new
    // cookie in the partition while the account file still holds the old id.
    // The sign-in path reads this id too, so a gateway that omits it cannot
    // have produced a session that should be trusted.
    if (credential.kind === 'session') {
      // The desktop identity parser accepts either field name, so the guard
      // must read the same pair or a valid sign-in would be rejected here.
      const reportedId = account.id ?? account.user_id
      if (reportedId === undefined || reportedId === null) {
        throw new EchoFlowApiError('token_invalid', undefined, 'the gateway did not report which account the session belongs to')
      }
      if (String(reportedId) !== credential.userId) {
        throw new EchoFlowApiError('token_invalid', undefined, 'the sign-in belongs to another account')
      }
    }
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
      if (refusal) throw new EchoFlowApiError('invalid_response', undefined, safeGatewayDetail(refusal, credential))
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

  private async commitAccount(
    endpoint: EchoFlowEndpoint,
    version: number,
    credential: EchoFlowCredential,
    update: (previous: StoredEchoFlowAccount | null) => StoredEchoFlowAccount,
  ): Promise<EchoFlowAccount> {
    return this.withAccountFile(async (accountPath) => {
      this.assertCredentialVersion(endpoint, version)
      const accounts = await this.readAccountsFile(accountPath)
      this.assertCredentialVersion(endpoint, version)
      const stored = update(accounts.accounts[endpoint])
      accounts.accounts[endpoint] = stored
      await this.writeAccounts(accounts, accountPath, () => this.assertCredentialVersion(endpoint, version))
      this.assertCredentialVersion(endpoint, version)
      this.credentials.set(endpoint, credential)
      return toPublicAccount(stored, true)
    })
  }

  private async withAccountFile<T>(task: (accountPath: string) => Promise<T>): Promise<T> {
    const accountPath = this.getAccountPath()
    const previous = EchoFlowApiService.accountFileLocks.get(accountPath) ?? Promise.resolve()
    const next = previous.then(() => task(accountPath))
    const tracked = next.then(() => {}, () => {})
    EchoFlowApiService.accountFileLocks.set(accountPath, tracked)
    try {
      return await next
    } finally {
      if (EchoFlowApiService.accountFileLocks.get(accountPath) === tracked) {
        EchoFlowApiService.accountFileLocks.delete(accountPath)
      }
    }
  }

  private getAccountPath(): string {
    return path.join(getEchoFlowInternalDir(getEchoFlowConfigDir()), 'echoflow-account.json')
  }

  private readAccounts(): Promise<StoredEchoFlowAccounts> {
    return this.withAccountFile((accountPath) => this.readAccountsFile(accountPath))
  }

  private async readAccountsFile(accountPath: string): Promise<StoredEchoFlowAccounts> {
    try {
      const parsed = JSON.parse(await fs.readFile(accountPath, 'utf-8')) as unknown
      const normalized = normalizeStoredAccounts(parsed)
      if (normalized) {
        if ((parsed as { schemaVersion?: unknown }).schemaVersion !== 3) {
          await this.backupAccountsFile(accountPath)
          await this.writeAccounts(normalized, accountPath)
        }
        return normalized
      }
      if (isStoredAccount(parsed) && !('schemaVersion' in parsed) && !('accounts' in parsed)) {
        await this.backupAccountsFile(accountPath)
        const endpoint: EchoFlowEndpoint = parsed.endpoint === 'dedicated' ? 'dedicated' : 'main'
        const account = { ...parsed, credential: parsed.credential ?? 'token', endpoint }
        const migrated: StoredEchoFlowAccounts = {
          schemaVersion: 3,
          accounts: {
            main: endpoint === 'dedicated' ? null : account,
            dedicated: endpoint === 'dedicated' ? account : null,
          },
        }
        await this.writeAccounts(migrated, accountPath)
        return migrated
      }
      throw new EchoFlowApiError('invalid_response', undefined, 'unrecognized local account store')
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error
    }

    return { ...EMPTY_ACCOUNTS, accounts: { ...EMPTY_ACCOUNTS.accounts } }
  }

  private async backupAccountsFile(accountPath: string): Promise<void> {
    const backupPath = `${accountPath}.bak-before-migration-${Date.now()}`
    await fs.copyFile(accountPath, backupPath)
    await fs.chmod(backupPath, 0o600)
  }

  private async writeAccounts(accounts: StoredEchoFlowAccounts, accountPath: string, beforeCommit?: () => void): Promise<void> {
    await fs.mkdir(path.dirname(accountPath), { recursive: true })
    const temporaryPath = `${accountPath}.tmp.${randomBytes(3).toString('hex')}`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(accounts, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
      // Sign-out or a newer login can invalidate this operation during disk I/O.
      beforeCommit?.()
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

      if (!response.ok) throw failureFromUpstream(response.status, await response.text().catch(() => ''), credential)

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

  if (!response.ok) throw new EchoFlowApiError('service_unavailable', response.status)

  const relay = await response.json().catch(() => {
    throw new EchoFlowApiError('invalid_response', response.status)
  }) as { status?: unknown; body?: unknown }
  const status = typeof relay.status === 'number' ? relay.status : 0
  const text = typeof relay.body === 'string' ? relay.body : ''
  // The gateway's answer travels as a string; keep its status so a refused
  // sign-in still reports the reason the gateway gave.
  if (status < 200 || status >= 300) {
    throw failureFromUpstream(status, text, credential)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new EchoFlowApiError('invalid_response', status)
  }
}

function failureFromUpstream(status: number, text: string, credential: EchoFlowCredential): EchoFlowApiError {
  const message = parseUpstreamMessage(text)
  const detail = safeGatewayDetail(message, credential)
  const code = status === 401 || (status === 403 && isAuthFailure(message)) ? 'token_invalid'
    : status === 0 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500 ? 'service_unavailable'
    : 'invalid_response'
  return new EchoFlowApiError(code, status, detail)
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

function safeGatewayDetail(message: unknown, credential: EchoFlowCredential): string | undefined {
  if (typeof message !== 'string' || message.length > 300 || /[\x00-\x1f\x7f<>]|\b(?:sk-|Bearer\s|Basic\s|eyJ[\w-]*\.)|\b(?:cookie|session|authorization|[\w-]*token|[\w-]*key)\s*[:=]/i.test(message)) return undefined
  const secrets = credential.kind === 'session'
    ? [credential.cookie, ...credential.cookie.split(';').map(pair => pair.slice(pair.indexOf('=') + 1).trim())]
    : [credential.kind === 'bearer' ? credential.accessToken : credential.managementToken]
  return secrets.some(secret => secret && message.includes(secret)) ? undefined : message.trim() || undefined
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
    return typeof message === 'string' ? message : undefined
  } catch {
    return undefined
  }
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
  return { ...record, schemaVersion: 3, accounts: { ...accounts, main, dedicated } }
}

function toStoredAccount(value: unknown): StoredEchoFlowAccount | null {
  if (value === null) return null
  if (!isStoredAccount(value)) return null
  return { ...value, credential: value.credential ?? 'token' }
}

function isStoredAccount(value: unknown): value is StoredEchoFlowAccount {
  return storedAccountSchema.safeParse(value).success
}

const storedAccountSchema = z.object({
  userId: z.string().min(1),
  managementToken: z.string().min(1).optional(),
  credential: z.enum(['token', 'session', 'bearer']).optional(),
  endpoint: z.enum(['main', 'dedicated']).optional(),
  balance: z.number().optional(),
  userGroup: z.string().optional(),
  username: z.string().optional(),
  refreshedAt: z.number().optional(),
  tokens: z.array(z.object({
    id: z.string(), name: z.string(), key: z.string().optional(), status: z.string().optional(),
    remainQuota: z.number().optional(), unlimitedQuota: z.boolean().optional(),
  })).optional(),
}).refine(account => account.credential === 'session' || account.credential === 'bearer' || !!account.managementToken)

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
  const storedById = new Map(stored.map((token) => [token.id, token]))
  const syntheticByName = new Map(
    keyedStored.filter((token) => token.id === token.name || token.id === `created:${token.name}`).map((token) => [token.name, token.key!]),
  )
  return tokens.map((token) => {
    const previous = storedById.get(token.id)
    const key = token.key ?? previous?.key
      ?? (tokens.filter((candidate) => candidate.name === token.name).length === 1 ? syntheticByName.get(token.name) : undefined)
    return { ...previous, ...token, ...(key ? { key } : {}) }
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
  return /unauthorized|not authenticated|(?:invalid|expired|revoked|missing) (?:access |api )?(?:token|session|credentials?)|(?:token|session|credentials?) (?:is |has )?(?:invalid|expired|revoked)|未登录|无权进行此操作|未授权|(?:令牌|凭据|会话)(?:无效|已?过期)|(?:认证|鉴权)失败/i.test(message ?? '')
}
