import { api } from './client'

export type EchoFlowMigrationStatus =
  | 'ready'
  | 'target-exists'
  | 'missing'
  | 'invalid'
  | 'failed'
  | 'migrated'
  | 'skipped'

export type EchoFlowMigrationResult = {
  summary: Record<EchoFlowMigrationStatus, number>
}

export const echoFlowMigrationApi = {
  getStatus: () => api.get<EchoFlowMigrationResult>('/api/echoflow/migration'),
  run: () => api.post<EchoFlowMigrationResult>('/api/echoflow/migration', { confirmed: true }),
}
