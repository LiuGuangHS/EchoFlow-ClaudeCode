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

export interface EchoFlowModelOption {
  id: string
  name: string
  type: 'chat' | 'image' | 'embedding' | 'other'
  owned_by?: string
}

export interface EchoFlowTokenOption {
  id: string
  name: string
  key: string
  status?: string
  remainQuota?: number
  unlimitedQuota?: boolean
}

export class EchoFlowApiService {
  constructor(private baseUrl = 'https://api.echoflow.cn') {}

  async validateManagementToken(userId: string, token: string): Promise<EchoFlowUserInfo> {
    const data = await this.fetchManagementApi<{ success?: boolean; message?: string; data?: { quota?: number; group?: string; username?: string } }>(
      '/api/user/self',
      userId,
      token,
    )

    if (!data.success) {
      throw new EchoFlowApiError(isAuthFailure(data.message) ? 'token_invalid' : 'service_unavailable')
    }

    const d = data.data ?? {}
    return {
      balance: typeof d.quota === 'number' ? d.quota / 500000 : 0,
      userGroup: d.group ?? 'default',
      username: d.username ?? '',
    }
  }

  async listTokens(userId: string, token: string): Promise<EchoFlowTokenOption[]> {
    const data = await this.fetchManagementApi<{
      success?: boolean
      message?: string
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

  async listModels(token: string): Promise<EchoFlowModelOption[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    if (!res?.ok) return []
    const data = await res.json().catch(() => null) as { data?: Array<{ id: string; owned_by?: string }> } | null
    return (data?.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      type: inferModelType(m.id),
      owned_by: m.owned_by,
    }))
  }

  private async fetchManagementApi<T>(path: string, userId: string, token: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'content-type': 'application/json',
        'new-api-user': userId,
        Authorization: token,
      },
    }).catch(() => { throw new EchoFlowApiError('service_unavailable') })

    if (res.status === 401 || res.status === 403) throw new EchoFlowApiError('token_invalid', res.status)
    if (!res.ok) throw new EchoFlowApiError(res.status >= 500 ? 'service_unavailable' : 'token_invalid', res.status)

    return await res.json().catch(() => { throw new EchoFlowApiError('invalid_response', res.status) }) as T
  }
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

function inferModelType(id: string): EchoFlowModelOption['type'] {
  const lower = id.toLowerCase()
  if (lower.includes('embed')) return 'embedding'
  if (lower.includes('dall') || lower.includes('image') || lower.includes('flux') || lower.includes('stable') || lower.includes('midjourney')) return 'image'
  return 'chat'
}
