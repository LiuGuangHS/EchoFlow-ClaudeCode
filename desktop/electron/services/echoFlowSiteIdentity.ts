/**
 * Resolves the signed-in EchoFlow site account from the session cookie.
 *
 * The old login flow read the identity out of the site's login response body
 * through the Chrome DevTools Protocol. That coupled login completion to one
 * particular request and left the window hanging whenever the response body
 * was unavailable. The account identity is already available to any request
 * that carries the session cookie, so this module asks the site directly.
 *
 * Only the two fields the desktop app displays are returned; the rest of the
 * user record stays in the main process.
 */

export type EchoFlowLoginIdentity = { userId: string; username: string }

const ECHOFLOW_SELF_URL = 'https://api.echoflowai.cc/api/user/self'
const IDENTITY_TIMEOUT_MS = 10_000
const MAX_IDENTITY_RESPONSE_BYTES = 64 * 1024
const MAX_USERNAME_LENGTH = 128

type SelfResponse = {
  success?: unknown
  data?: unknown
}

/**
 * Accepts either the parsed site user record or the JSON string the site keeps
 * in `localStorage.user`, because both call sites hand us different shapes.
 */
export function parseSiteIdentity(value: unknown): EchoFlowLoginIdentity | null {
  let candidate = value
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (candidate === null || typeof candidate !== 'object') return null

  const record = candidate as Record<string, unknown>
  const rawId = record.id ?? record.user_id
  const userId = typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0
    ? String(rawId)
    : typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId.trim())
      ? rawId.trim()
      : null
  const username = typeof record.username === 'string' ? record.username.trim() : ''
  if (!userId || !username || username.length > MAX_USERNAME_LENGTH) return null

  return { userId, username }
}

/**
 * The site's own account endpoint accepts the session cookie by itself; the
 * `New-Api-User` header is only needed by callers that do not hold a session.
 * A failed read is deliberately indistinguishable from an unauthenticated one:
 * the login window keeps polling either way.
 */
export async function resolveSiteIdentity(
  cookieHeader: string,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<EchoFlowLoginIdentity | null> {
  if (!cookieHeader) return null

  let response: Response
  try {
    response = await fetchImpl(ECHOFLOW_SELF_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', Cookie: cookieHeader },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  let body: string
  try {
    body = await response.text()
  } catch {
    return null
  }
  if (new TextEncoder().encode(body).byteLength > MAX_IDENTITY_RESPONSE_BYTES) return null

  let payload: SelfResponse
  try {
    payload = JSON.parse(body) as SelfResponse
  } catch {
    return null
  }
  if (payload.success !== true) return null

  return parseSiteIdentity(payload.data)
}
