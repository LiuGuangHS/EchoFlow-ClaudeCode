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

export type EchoFlowAccount = {
  userId: string
  balance?: number
  userGroup?: string
  username?: string
  tokens?: EchoFlowTokenSummary[]
  refreshedAt?: number
}

type StoredEchoFlowAccount = {
  userId: string
  managementToken: string
  balance?: number
  userGroup?: string
  username?: string
  tokens?: EchoFlowTokenOption[]
  refreshedAt?: number
}

export class EchoFlowApiService {
  constructor(private baseUrl = 'https://api.echoflowai.cc') {}

  async getAccount(): Promise<EchoFlowAccount | null> {
    const account = await this.readAccount()
    return account ? toPublicAccount(account) : null
  }

  async bindAccount(userId: string, managementToken: string): Promise<EchoFlowAccount> {
    const account = await this.refreshWithCredentials(userId, managementToken)
    const stored = { ...account, managementToken }
    await this.writeAccount(stored)
    return toPublicAccount(stored)
  }

  async refreshAccount(): Promise<EchoFlowAccount> {
    const account = await this.readAccount()
    if (!account) throw new EchoFlowApiError('token_invalid')
    const refreshed = await this.refreshWithCredentials(account.userId, account.managementToken)
    const stored = { ...refreshed, managementToken: account.managementToken }
    await this.writeAccount(stored)
    return toPublicAccount(stored)
  }

  async selectAccountToken(id: string): Promise<EchoFlowTokenOption> {
    const account = await this.readAccount()
    const token = account?.tokens?.find((candidate) => candidate.id === id)
    if (!token) throw new EchoFlowApiError('token_invalid')
    return token
  }

  async disconnectAccount(): Promise<void> {
    try {
      await fs.unlink(this.getAccountPath())
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error
    }
  }

  async validateManagementToken(userId: string, token: string): Promise<EchoFlowUserInfo> {
    const data = await this.fetchManagementApi<{ success?: boolean; message?: string; data?: { quota?: number; group?: string; username?: string } }>(
      '/api/user/self',
      userId,
      token,
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

  async listTokens(userId: string, token: string): Promise<EchoFlowTokenOption[]> {
    const data = await this.fetchManagementApi<{
      success?: boolean
      data?: unknown[] | { items?: unknown[]; tokens?: unknown[]; records?: unknown[] }
    }>('/api/token/?p=0&size=100', userId, token)

    if (!data.success) return []
    const rawList = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.data?.items)
        ? data.data.items
        : Array.isArray(data.data?.tokens)
          ? data.data.tokens
          : Array.isArray(data.data?.records)
            ? data.data.records
            : []

    return rawList.map(normalizeToken).filter((item): item is EchoFlowTokenOption => !!item)
  }

  private async refreshWithCredentials(userId: string, managementToken: string): Promise<EchoFlowAccount> {
    const trimmedUserId = userId.trim()
    const trimmedToken = managementToken.trim()
    if (!trimmedUserId || !trimmedToken) throw new EchoFlowApiError('token_invalid')

    const user = await this.validateManagementToken(trimmedUserId, trimmedToken)
    const tokens = await this.listTokens(trimmedUserId, trimmedToken)
    return {
      ...user,
      userId: trimmedUserId,
      tokens,
      refreshedAt: Date.now(),
    }
  }

  private getAccountPath(): string {
    return path.join(getEchoFlowInternalDir(getEchoFlowConfigDir()), 'echoflow-account.json')
  }

  private getLegacyAccountPath(): string {
    return path.join(getEchoFlowInternalDir(getEchoFlowConfigDir()), 'qingyun-account.json')
  }

  private async readAccount(): Promise<StoredEchoFlowAccount | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.getAccountPath(), 'utf-8')) as unknown
      return isStoredAccount(parsed) ? parsed : null
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error
    }

    try {
      const parsed = JSON.parse(await fs.readFile(this.getLegacyAccountPath(), 'utf-8')) as unknown
      if (!isStoredAccount(parsed)) return null
      await this.writeAccount(parsed)
      await fs.unlink(this.getLegacyAccountPath()).catch((error) => {
        if (errnoCode(error) !== 'ENOENT') throw error
      })
      return parsed
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return null
      throw error
    }
  }

  private async writeAccount(account: StoredEchoFlowAccount): Promise<void> {
    const accountPath = this.getAccountPath()
    await fs.mkdir(path.dirname(accountPath), { recursive: true })
    const temporaryPath = `${accountPath}.tmp.${randomBytes(3).toString('hex')}`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(account, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
      await fs.rename(temporaryPath, accountPath)
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  private async fetchManagementApi<T>(pathname: string, userId: string, token: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
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
  }
}

function toTokenSummary(token: EchoFlowTokenOption): EchoFlowTokenSummary {
  return {
    id: token.id,
    name: token.name,
    ...(token.status ? { status: token.status } : {}),
    ...(typeof token.remainQuota === 'number' ? { remainQuota: token.remainQuota } : {}),
    ...(typeof token.unlimitedQuota === 'boolean' ? { unlimitedQuota: token.unlimitedQuota } : {}),
    keyPreview: maskKey(token.key),
  }
}

function maskKey(key: string): string {
  return key.length <= 8 ? '••••••••' : `${key.slice(0, 3)}-••••${key.slice(-4)}`
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
