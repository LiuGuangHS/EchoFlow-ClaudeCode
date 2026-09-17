import { api } from './client'

export interface EchoFlowTokenOption {
  id: string
  name: string
  keyPreview: string
  status?: string
  remainQuota?: number
  unlimitedQuota?: boolean
}

export interface EchoFlowAccount {
  userId: string
  balance?: number
  userGroup?: string
  username?: string
  tokens?: EchoFlowTokenOption[]
  refreshedAt?: number
}

export const echoflowApi = {
  getAccount: () => api.get<{ account: EchoFlowAccount | null }>('/api/echoflow'),
  bindAccount: (userId: string, managementToken: string) =>
    api.post<{ account: EchoFlowAccount }>('/api/echoflow/account', { userId, managementToken }),
  refreshAccount: () => api.put<{ account: EchoFlowAccount }>('/api/echoflow/account', {}),
  selectToken: (tokenId: string, providerId?: string) =>
    api.post<{ provider: { id: string } }>('/api/echoflow/select-token', { tokenId, ...(providerId ? { providerId } : {}) }),
  disconnectAccount: () => api.delete<{ ok: true }>('/api/echoflow/account'),
}
