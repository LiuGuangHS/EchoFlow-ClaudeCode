import type { OpenAIOAuthTokens } from './types.js'

export function normalizeTokenFile(value: unknown): OpenAIOAuthTokens | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.accessToken !== 'string' || typeof record.refreshToken !== 'string' ||
      typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) return null

  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    ...(typeof record.idToken === 'string' && { idToken: record.idToken }),
    ...(typeof record.accountId === 'string' && { accountId: record.accountId }),
    ...(typeof record.email === 'string' && { email: record.email }),
    ...(typeof record.clientId === 'string' && { clientId: record.clientId }),
  }
}
