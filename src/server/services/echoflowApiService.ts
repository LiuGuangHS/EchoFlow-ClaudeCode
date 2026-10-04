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
}

type StoredEchoFlowAccount = {
  userId: string
  managementToken: string
  balance?: number
  userGroup?: string
  username?: string
  tokens?: EchoFlowTokenOption[]
  refreshedAt?: number
  endpoint?: EchoFlowEndpoint
}

type StoredEchoFlowAccounts = {
  schemaVersion: 2
  accounts: Record<EchoFlowEndpoint, StoredEchoFlowAccount | null>
}

const EMPTY_ACCOUNTS: StoredEchoFlowAccounts = {
  schemaVersion: 2,
  accounts: { main: null, dedicated: null },
}

const ENDPOINTS = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
}

export class EchoFlowApiService {
  constructor(private defaultBaseUrl = ENDPOINTS.main) {}

  private getBaseUrl(endpoint?: EchoFlowEndpoint): string {
    if (!endpoint) return this.defaultBaseUrl
    return ENDPOINTS[endpoint] || this.defaultBaseUrl
  }

  async getAccounts(): Promise<Record<EchoFlowEndpoint, EchoFlowAccount | null>> {
    const stored = await this.readAccounts()
    return {
      main: stored.accounts.main ? toPublicAccount(stored.accounts.main) : null,
      dedicated: stored.accounts.dedicated ? toPublicAccount(stored.accounts.dedicated) : null,
    }
  }

  async getAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount | null> {
    const accounts = await this.getAccounts()
    return accounts[endpoint]
  }

  async bindAccount(userId: string, managementToken: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowAccount> {
    const account = await this.refreshWithCredentials(userId, managementToken, endpoint)
    const stored = { ...account, managementToken, endpoint }
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
    const refreshed = await this.refreshWithCredentials(account.userId, account.managementToken, endpoint)
    const stored = { ...refreshed, managementToken: account.managementToken, endpoint }
    accounts.accounts[endpoint] = stored
    await this.writeAccounts(accounts)
    return toPublicAccount(stored)
  }

  async selectAccountToken(endpoint: EchoFlowEndpoint, id: string): Promise<EchoFlowTokenOption> {
    const accounts = await this.readAccounts()
    const token = accounts.accounts[endpoint]?.tokens?.find((candidate) => candidate.id === id)
    if (!token) throw new EchoFlowApiError('token_invalid')
    return { ...token, key: withApiKeyPrefix(token.key) }
  }

  async disconnectAccount(endpoint: EchoFlowEndpoint = 'main'): Promise<void> {
    const accounts = await this.readAccounts()
    accounts.accounts[endpoint] = null
    await this.writeAccounts(accounts)
  }

  async validateManagementToken(userId: string, token: string, endpoint: EchoFlowEndpoint = 'main'): Promise<EchoFlowUserInfo> {
    const data = await this.fetchManagementApi<{ success?: boolean; message?: string; data?: { quota?: number; group?: string; username?: string } }>(
      '/api/user/self',
      userId,
      token,
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
      }>(`/api/token/?p=${page}&size=${pageSize}`, userId, token, endpoint)

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
      if (isStoredAccounts(parsed)) return parsed
      if (isStoredAccount(parsed)) {
        const endpoint: EchoFlowEndpoint = parsed.endpoint === 'dedicated' ? 'dedicated' : 'main'
        const migrated: StoredEchoFlowAccounts = {
          schemaVersion: 2,
          accounts: {
            main: endpoint === 'dedicated' ? null : { ...parsed, endpoint },
            dedicated: endpoint === 'dedicated' ? { ...parsed, endpoint } : null,
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
        schemaVersion: 2,
        accounts: { main: { ...parsed, endpoint: 'main' }, dedicated: null },
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

  private async fetchManagementApi<T>(pathname: string, userId: string, token: string, endpoint: EchoFlowEndpoint = 'main'): Promise<T> {
    const baseUrl = this.getBaseUrl(endpoint)
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: {
        'content-type': 'application/json',
        'new-api-user': userId,
        Authorization: token,
      },
    }).catch(() => { throw new EchoFlowApiError('service_unavailable') })

    if (response.status === 401 || response.status === 403) throw new EchoFlowApiError('token_invalid', response.status)
    if (!response.ok) throw new EchoFlowApiError(response.status >= 500 ? 'service_unavailable' : 'token_invalid', response.status)

    return await response.json().catch(() => { throw new EchoFlowApiError('invalid_response', response.status) }) as T
  }
}

function toPublicAccount(account: StoredEchoFlowAccount): EchoFlowAccount {
  return {
    userId: account.userId,
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

function isStoredAccounts(value: unknown): value is StoredEchoFlowAccounts {
  if (!value || typeof value !== 'object') return false
  const record = value as { schemaVersion?: unknown; accounts?: unknown }
  if (record.schemaVersion !== 2 || !record.accounts || typeof record.accounts !== 'object') return false
  const accounts = record.accounts as Record<string, unknown>
  return (accounts.main === null || isStoredAccount(accounts.main)) &&
    (accounts.dedicated === null || isStoredAccount(accounts.dedicated))
}

function isStoredAccount(value: unknown): value is StoredEchoFlowAccount {
  return !!value && typeof value === 'object' &&
    typeof (value as { userId?: unknown }).userId === 'string' &&
    typeof (value as { managementToken?: unknown }).managementToken === 'string'
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
