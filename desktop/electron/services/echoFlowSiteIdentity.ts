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
/** The client profile the sign-in window sends; the session is bound to it. */
export type SiteClientProfile = {
  userAgent?: string
  acceptLanguage?: string
}

export async function resolveSiteIdentity(
  cookieHeader: string,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  browser?: SiteClientProfile,
): Promise<EchoFlowLoginIdentity | null> {
  if (!cookieHeader) return null

  const url = new URL(ECHOFLOW_SELF_URL)
  // The gateway picks the tenant from X-Forwarded-Host and binds the session to
  // the client that signed in, so the probe carries the console page's own
  // headers; a bare cookie comes back as "not signed in".
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookieHeader,
    'X-Forwarded-Host': url.host,
    'Cache-Control': 'no-store',
  }
  if (browser) {
    if (browser.userAgent) headers['User-Agent'] = browser.userAgent
    headers['Accept-Language'] = browser.acceptLanguage ?? 'zh-CN'
    headers.Origin = url.origin
    headers.Referer = `${url.origin}/console`
    headers['Sec-Fetch-Dest'] = 'empty'
    headers['Sec-Fetch-Mode'] = 'cors'
    headers['Sec-Fetch-Site'] = 'same-origin'
  }

  let response: Response
  try {
    response = await fetchImpl(ECHOFLOW_SELF_URL, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!response.ok) {
    // Diagnostic only: status and the gateway's own message, never credentials.
    const detail = await response.text().catch(() => '')
    let message: string | undefined
    try {
      const parsed = JSON.parse(detail) as { message?: unknown }
      if (typeof parsed.message === 'string') message = parsed.message.slice(0, 200)
    } catch {}
    console.info('[echoFlowLogin] identity-probe:', JSON.stringify({ status: response.status, message }))
    return null
  }

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
