import { api } from './client'

export type LegacyMigrationStatus =
  | 'ready'
  | 'target-exists'
  | 'missing'
  | 'invalid'
  | 'failed'
  | 'migrated'
  | 'skipped'

export type LegacyMigrationSource =
  | 'current-cc-haha'
  | 'legacy-home-cc-haha'
  | 'current-root-providers'
  | 'legacy-home-root-providers'

export type LegacyMigrationTarget =
  | 'providers'
  | 'settings'
  | 'oauth'
  | 'openai-oauth'
  | 'desktop-ui'

export type LegacyMigrationItem = {
  id: string
  label: string
  source: LegacyMigrationSource
  target: LegacyMigrationTarget
  status: LegacyMigrationStatus
  message?: string
}

export type LegacyMigrationResult = {
  items: LegacyMigrationItem[]
  summary: Record<LegacyMigrationStatus, number>
}

export const legacyMigrationApi = {
  getStatus() {
    return api.get<LegacyMigrationResult>('/api/legacy-migration/status')
  },

  run() {
    return api.post<LegacyMigrationResult>('/api/legacy-migration/run', {})
  },
}
