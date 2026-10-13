import { api } from './client'
import type {
  CreateProviderInput,
  ProviderModelsResult,
  ProviderTestResult,
  SavedProvider,
  TestProviderConfigInput,
} from '../types/provider'

export type EchoFlowEndpoint = 'main' | 'dedicated'

export type EchoFlowSiteAccount = {
  userId: string
  username: string
  balance: number
  refreshedAt: number
}

export const ECHOFLOW_BASE_URLS: Record<EchoFlowEndpoint, string> = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
}

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

export type EchoFlowTokenSource = {
  endpoint: EchoFlowEndpoint
  tokenId: string
  tokenName: string
  keyPreview: string
  remainQuota?: number
  unlimitedQuota?: boolean
}

export type EchoFlowProviderCreateInput = Omit<CreateProviderInput, 'presetId' | 'apiKey'> & EchoFlowTokenSource
export type EchoFlowProviderTestInput = Omit<TestProviderConfigInput, 'apiKey'> & Pick<EchoFlowTokenSource, 'endpoint' | 'tokenId'>
export type EchoFlowProviderModelsInput = Pick<EchoFlowTokenSource, 'endpoint' | 'tokenId'>

type EchoFlowTokenSelectionResponse =
  | { token: Pick<EchoFlowTokenOption, 'id' | 'name' | 'keyPreview'> }
  | { provider: { id: string } }

export const echoflowApi = {
  getSiteSession: () => api.get<{ account: EchoFlowSiteAccount | null }>('/api/echoflow/site-session'),
  refreshSiteSession: () => api.post<{ account: EchoFlowSiteAccount }>('/api/echoflow/site-session/refresh', {}),
  getAccounts: () => api.get<{
    account: EchoFlowAccount | null
    accounts: Record<EchoFlowEndpoint, EchoFlowAccount | null>
  }>('/api/echoflow'),
  bindAccount: (endpoint: EchoFlowEndpoint, userId: string, managementToken: string) =>
    api.post<{ account: EchoFlowAccount }>('/api/echoflow/account', { userId, managementToken, endpoint }),
  refreshAccount: (endpoint: EchoFlowEndpoint) =>
    api.put<{ account: EchoFlowAccount }>('/api/echoflow/account', { endpoint }),
  updateEndpoint: (endpoint: EchoFlowEndpoint) =>
    api.patch<{ account: EchoFlowAccount }>('/api/echoflow/account', { endpoint }),
  selectToken: (endpoint: EchoFlowEndpoint, tokenId: string, providerId?: string) =>
    api.post<EchoFlowTokenSelectionResponse>('/api/echoflow/select-token', { endpoint, tokenId, ...(providerId ? { providerId } : {}) }),
  getTokenKey: (endpoint: EchoFlowEndpoint, tokenId: string) =>
    api.post<{ token: { id: string; name: string; key: string } }>('/api/echoflow/token', { endpoint, tokenId }),
  createProviderFromToken: (input: EchoFlowProviderCreateInput) =>
    api.post<{ provider: SavedProvider }>('/api/echoflow/provider', input),
  testProviderFromToken: (input: EchoFlowProviderTestInput) =>
    api.post<{ result: ProviderTestResult }>('/api/echoflow/test-provider', input),
  fetchModelsFromToken: (input: EchoFlowProviderModelsInput) =>
    api.post<ProviderModelsResult>('/api/echoflow/models', input),
  disconnectAccount: (endpoint: EchoFlowEndpoint) =>
    api.delete<{ ok: true }>('/api/echoflow/account', { endpoint }),
}
