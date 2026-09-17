import { api } from './client'

export type EchoFlowEndpoint = 'main' | 'dedicated'

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
  endpoint?: EchoFlowEndpoint
}

export const echoflowApi = {
  getAccount: () => api.get<{ account: EchoFlowAccount | null }>('/api/echoflow'),
  bindAccount: (userId: string, managementToken: string, endpoint?: EchoFlowEndpoint) =>
    api.post<{ account: EchoFlowAccount }>('/api/echoflow/account', { userId, managementToken, endpoint }),
  refreshAccount: () => api.put<{ account: EchoFlowAccount }>('/api/echoflow/account', {}),
  updateEndpoint: (endpoint: EchoFlowEndpoint) =>
    api.patch<{ account: EchoFlowAccount }>('/api/echoflow/account', { endpoint }),
  selectToken: (tokenId: string, providerId?: string) =>
    api.post<{ provider: { id: string } }>('/api/echoflow/select-token', { tokenId, ...(providerId ? { providerId } : {}) }),
  disconnectAccount: () => api.delete<{ ok: true }>('/api/echoflow/account'),
}
