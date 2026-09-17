export type H5VerificationErrorCode = 'invalid-url' | 'unsupported-protocol' | 'missing-token' | 'unreachable' | 'invalid-token' | 'verify-failed'

import { t } from './i18n'

export class H5VerificationError extends Error {
  readonly code: H5VerificationErrorCode

  constructor(code: H5VerificationErrorCode, message: string) {
    super(message)
    this.name = 'H5VerificationError'
    this.code = code
  }
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new H5VerificationError('invalid-url', t('h5.error.invalidUrl'))
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new H5VerificationError('invalid-url', t('h5.error.invalidFormat'))
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new H5VerificationError('unsupported-protocol', t('h5.error.unsupportedProtocol'))
  }

  parsed.pathname = ''
  parsed.hash = ''
  parsed.search = ''

  return parsed.toString().replace(/\/$/, '')
}

export function isPlainHttp(serverUrl: string): boolean {
  return new URL(serverUrl).protocol === 'http:'
}

export function isPrivateLanHttp(serverUrl: string): boolean {
  const url = new URL(serverUrl)
  if (url.protocol !== 'http:') return false

  const host = url.hostname
  if (host === 'localhost' || host === '127.0.0.1') return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true

  const private172Match = /^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (!private172Match) return false

  const secondOctet = Number(private172Match[1])
  return secondOctet >= 16 && secondOctet <= 31
}

async function verifyHealth(serverUrl: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${serverUrl}/health`, { cache: 'no-store' })
  } catch {
    throw new H5VerificationError('unreachable', t('h5.error.unreachable'))
  }

  if (!response.ok) {
    throw new H5VerificationError('unreachable', `Health check failed with HTTP ${response.status}.`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.toLowerCase().includes('application/json')) {
    const body = await response.json().catch(() => null)
    if (body && typeof body === 'object' && 'status' in body && body.status !== 'ok') {
      throw new H5VerificationError('unreachable', t('h5.error.healthStatus'))
    }
  }
}

async function verifyToken(serverUrl: string, token: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${serverUrl}/api/h5-access/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  } catch {
    throw new H5VerificationError('verify-failed', t('h5.error.verifyFailed'))
  }

  if (response.status === 401 || response.status === 403) {
    throw new H5VerificationError('invalid-token', t('h5.error.invalidToken'))
  }

  if (!response.ok) {
    throw new H5VerificationError('verify-failed', `H5 token verification failed with HTTP ${response.status}.`)
  }
}

export async function verifyH5Connection(serverUrl: string, h5Token: string): Promise<string> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl)
  const normalizedToken = h5Token.trim()

  if (!normalizedToken) {
    throw new H5VerificationError('missing-token', t('h5.error.missingToken'))
  }

  await verifyHealth(normalizedServerUrl)
  await verifyToken(normalizedServerUrl, normalizedToken)

  return normalizedServerUrl
}
