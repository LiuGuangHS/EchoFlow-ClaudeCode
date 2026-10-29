import * as fs from 'fs/promises'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import { getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot.js'

export type EchoFlowApiErrorCode = 'token_invalid' | 'service_unavailable' | 'invalid_response'

export class EchoFlowApiError extends Error {
  constructor(
    public readonly code: EchoFlowApiErrorCode,
    public readonly status?: number,
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
  key: string
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
  | { kind: 'session'; userId: string; cookie: string }
  | { kind: 'bearer'; userId: string; accessToken: string }

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

const ENDPOINTS = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
}

export class EchoFlowApiService {
  constructor(private defaultBaseUrl = ENDPOINTS.main) {}

  private readonly credentials = new Map<EchoFlowEndpoint, EchoFlowCredential>()

  private getBaseUrl(endpoint?: EchoFlowEndpoint): string {
    if (!endpoint) return this.defaultBaseUrl
    return ENDPOINTS[endpoint] || this.defaultBaseUrl
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
          tokens: await this.listTokensWithCredential(endpoint),
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
    const stored = { ...account, credential: 'token' as const, managementToken, endpoint }
    const accounts = await this.readAccounts()
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

  async refreshAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount> {
    const accounts = await this.readAccounts()
    const account = accounts.accounts[endpoint]
    if (!account) throw new EchoFlowApiError('token_invalid')
    const credential = this.credentials.get(endpoint) ?? storedCredential(account)
    if (!credential) throw new EchoFlowApiError('token_invalid')
    this.credentials.set(endpoint, credential)

    const user = await this.validateCredential(credential, endpoint)
    const stored: StoredEchoFlowAccount = {
      ...account,
      userId: credential.userId,
      credential: credential.kind,
      ...(credential.kind === 'token' ? { managementToken: credential.managementToken } : {}),
      ...user,
      // The gateway has no token list; a bearer account keeps the metadata it
      // was created with instead of asking an endpoint that does not exist.
      tokens: credential.kind === 'bearer' ? account.tokens : await this.listTokensWithCredential(endpoint),
      refreshedAt: Date.now(),
      endpoint,
    }
    accounts.accounts[endpoint] = stored
    await this.writeAccounts(accounts)
    return toPublicAccount(stored, true)
  }

  async selectAccountToken(endpoint: EchoFlowEndpoint, id: string): Promise<EchoFlowTokenOption> {
    const accounts = await this.readAccounts()
    const token = accounts.accounts[endpoint]?.tokens?.find((candidate) => candidate.id === id)
    if (!token) throw new EchoFlowApiError('token_invalid')
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
    if (credential.kind === 'bearer') {
      const me = await this.fetchManagementApi<{
        data?: { id?: number | string; quota?: number; balance?: number; group?: string; username?: string; name?: string }
        quota?: number
        balance?: number
        group?: string
        username?: string
        name?: string
      }>('/api/v1/auth/me', credential, endpoint)

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

    // The site uses a zero-based `p` page parameter. Continue while a full page
    // is returned, with a hard cap so a broken upstream cannot create an endless
    // refresh loop.
    for (let page = 0; page < 100; page += 1) {
      const data = await this.fetchManagementApi<{
        success?: boolean
        data?: unknown[] | { items?: unknown[]; tokens?: unknown[]; records?: unknown[] }
      }>(`/api/token/?p=${page}&size=${pageSize}`, credential, endpoint)

      if (!data.success) break
      const rawList = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.data?.items)
          ? data.data.items
          : Array.isArray(data.data?.tokens)
            ? data.data.tokens
            : Array.isArray(data.data?.records)
              ? data.data.records
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

  private async fetchManagementApi<T>(pathname: string, credential: EchoFlowCredential, endpoint: EchoFlowEndpoint = 'main'): Promise<T> {
    const baseUrl = this.getBaseUrl(endpoint)
    const headers = credential.kind === 'session'
      ? { Cookie: credential.cookie, 'New-Api-User': credential.userId }
      : credential.kind === 'bearer'
        ? { Authorization: `Bearer ${credential.accessToken}` }
        : { 'new-api-user': credential.userId, Authorization: credential.managementToken }
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { 'content-type': 'application/json', ...headers },
    }).catch(() => { throw new EchoFlowApiError('service_unavailable') })

    if (response.status === 401 || response.status === 403) throw new EchoFlowApiError('token_invalid', response.status)
    if (!response.ok) throw new EchoFlowApiError(response.status >= 500 ? 'service_unavailable' : 'token_invalid', response.status)

    return await response.json().catch(() => { throw new EchoFlowApiError('invalid_response', response.status) }) as T
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
    keyPreview: maskKey(withApiKeyPrefix(token.key)),
  }
}

function withApiKeyPrefix(key: string): string {
  return key.startsWith('sk-') ? key : `sk-${key}`
}

function maskKey(key: string): string {
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
  if (!key) return null
  const id = stringFrom(record.id) ?? key
  return {
    id,
    key,
    name: stringFrom(record.name) ?? id,
    status: stringFrom(record.status),
    remainQuota: numberFrom(record.remain_quota),
    unlimitedQuota: booleanFrom(record.unlimited_quota),
  }
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
