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
    })
    if (!res.ok) {
      throw new Error(`token_invalid:${res.status}`)
    }
    const data = await res.json() as { success?: boolean; message?: string; data?: { quota?: number; group?: string; username?: string } }
    if (!data.success) {
      throw new Error(data.message ?? 'token_invalid')
    }
    const d = data.data ?? {}
    return {
      // New API stores quota as integer tokens; divide by 500000 to get CNY balance
      balance: typeof d.quota === 'number' ? d.quota / 500000 : 0,
      userGroup: d.group ?? 'default',
      username: d.username ?? '',
    }
  }

  async listModels(token: string): Promise<EchoFlowModelOption[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      type: inferModelType(m.id),
      owned_by: m.owned_by,
    }))
  }
}

function inferModelType(modelId: string): EchoFlowModelOption['type'] {
  const lower = modelId.toLowerCase()
  if (lower.includes('embed')) return 'embedding'
  if (lower.includes('dall') || lower.includes('image') || lower.includes('flux') || lower.includes('stable') || lower.includes('midjourney')) return 'image'
  return 'chat'
}
