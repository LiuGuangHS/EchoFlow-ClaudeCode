import { api } from './client'

export interface EchoFlowModelOption {
  id: string
  name: string
  type: 'chat' | 'image' | 'embedding' | 'other'
  owned_by?: string
}

export type EchoFlowValidationError = 'missing_token' | 'token_invalid' | 'service_unavailable' | 'invalid_response'

export interface EchoFlowValidationResult {
  valid: boolean
  balance?: number
  userGroup?: string
  username?: string
  models?: EchoFlowModelOption[]
  error?: EchoFlowValidationError
}

export const echoflowApi = {
  validateManagementToken: (managementToken: string) =>
    api.post<EchoFlowValidationResult>('/api/echoflow/validate-management-token', { managementToken }),
}
