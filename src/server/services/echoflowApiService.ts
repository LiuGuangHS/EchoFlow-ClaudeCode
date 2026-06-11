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

export class EchoFlowApiService {
  constructor(private baseUrl = 'https://api.echoflow.cn') {}

  async validateManagementToken(token: string): Promise<EchoFlowUserInfo> {
    const res = await fetch(`${this.baseUrl}/api/user/self`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      throw new EchoFlowApiError('service_unavailable')
    })

    if (res.status === 401 || res.status === 403) {
      throw new EchoFlowApiError('token_invalid', res.status)
    }
    if (!res.ok) {
      throw new EchoFlowApiError(res.status >= 500 ? 'service_unavailable' : 'token_invalid', res.status)
    }

    const data = await res.json().catch(() => {
      throw new EchoFlowApiError('invalid_response', res.status)
    }) as { success?: boolean; message?: string; data?: { quota?: number; group?: string; username?: string } }

    if (!data || typeof data !== 'object') {
      throw new EchoFlowApiError('invalid_response', res.status)
    }
    if (!data.success) {
      throw new EchoFlowApiError(isAuthFailureMessage(data.message) ? 'token_invalid' : 'service_unavailable', res.status)
    }

    const d = data.data ?? {}
    return {
      balance: typeof d.quota === 'number' ? d.quota / 500000 : 0,
      userGroup: d.group ?? 'default',
      username: d.username ?? '',
    }
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
}

function isAuthFailureMessage(message: string | undefined): boolean {
  const lower = message?.toLowerCase() ?? ''
  return lower.includes('token') || lower.includes('auth') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid')
}

function inferModelType(modelId: string): EchoFlowModelOption['type'] {
  const lower = modelId.toLowerCase()
  if (lower.includes('embed')) return 'embedding'
  if (lower.includes('dall') || lower.includes('image') || lower.includes('flux') || lower.includes('stable') || lower.includes('midjourney')) return 'image'
  return 'chat'
}
