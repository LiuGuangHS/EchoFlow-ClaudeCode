import { api } from './client'

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

export type EchoFlowValidationError = 'missing_token' | 'token_invalid' | 'service_unavailable' | 'invalid_response'

export interface EchoFlowValidationResult {
  valid: boolean
  balance?: number
  userGroup?: string
  username?: string
  models?: EchoFlowModelOption[]
  tokens?: EchoFlowTokenOption[]
  error?: EchoFlowValidationError
}

export const echoflowApi = {
  validateManagementToken: (userId: string, managementToken: string) =>
    api.post<EchoFlowValidationResult>('/api/echoflow/validate-management-token', { userId, managementToken }),
}
