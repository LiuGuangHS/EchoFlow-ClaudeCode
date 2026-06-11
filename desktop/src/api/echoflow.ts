import { api } from './client'

export interface EchoFlowModelOption {
  id: string
  name: string
  type: 'chat' | 'image' | 'embedding' | 'other'
  owned_by?: string
}

export interface EchoFlowValidationResult {
  valid: boolean
  balance?: number
  userGroup?: string
  username?: string
  models?: EchoFlowModelOption[]
  error?: string
}

export const echoflowApi = {
  validateManagementToken: (managementToken: string) =>
    api.post<EchoFlowValidationResult>('/api/echoflow/validate-management-token', { managementToken }),
}
