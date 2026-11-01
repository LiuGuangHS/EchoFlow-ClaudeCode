import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

/**
 * The site binds a browser session to the client that created it: a call made
 * from Bun's fetch is answered with "Session network fingerprint changed", even
 * when it replays the sign-in window's headers. This bridge forwards those calls
 * through Chromium's own network stack instead, so the gateway sees the same
 * TLS/HTTP2 fingerprint, cookies, proxy and headers the signed-in page used.
 *
 * It listens on loopback only and requires the shared bridge token, because it
 * can issue authenticated requests with the user's site session.
 */
export type SiteNetworkBridge = {
  url: string
  token: string
  close: () => void
}

export type SiteNetworkFetch = (url: string, init: RequestInit) => Promise<Response>

const MAX_REQUEST_BYTES = 256 * 1024
const FORWARD_TIMEOUT_MS = 20_000

type BridgePayload = {
  url?: unknown
  method?: unknown
  body?: unknown
  headers?: unknown
}

function tokenMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false
  const provided = Buffer.from(actual)
  const secret = Buffer.from(expected)
  return provided.length === secret.length && timingSafeEqual(provided, secret)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('request too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    request.on('error', reject)
  })
}

export async function startSiteNetworkBridge(options: {
  token: string
  allowedOrigins: readonly string[]
  forward: SiteNetworkFetch
}): Promise<SiteNetworkBridge> {
  const allowedOrigins = new Set(options.allowedOrigins)

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }

    if (request.method !== 'POST' || request.url !== '/fetch') return reply(404, { error: 'not_found' })
    if (!tokenMatches(options.token, request.headers['x-echoflow-site-bridge'] as string | undefined)) {
      return reply(401, { error: 'unauthorized' })
    }

    let payload: BridgePayload
    try {
      payload = JSON.parse(await readBody(request)) as BridgePayload
    } catch {
      return reply(400, { error: 'invalid_request' })
    }

    if (typeof payload.url !== 'string') return reply(400, { error: 'invalid_request' })
    let target: URL
    try {
      target = new URL(payload.url)
    } catch {
      return reply(400, { error: 'invalid_request' })
    }
    // Only the two EchoFlow gateways; the token must not become a general
    // authenticated-request proxy for any local process.
    if (!allowedOrigins.has(target.origin)) return reply(403, { error: 'forbidden_origin' })

    const method = payload.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') return reply(400, { error: 'invalid_request' })
    if (payload.body !== undefined && typeof payload.body !== 'string') return reply(400, { error: 'invalid_request' })
    if (payload.headers !== undefined && (typeof payload.headers !== 'object' || payload.headers === null)) {
      return reply(400, { error: 'invalid_request' })
    }

    const headers = new Headers()
    for (const [name, value] of Object.entries(payload.headers as Record<string, unknown> | undefined ?? {})) {
      // The partition's cookie jar is the credential; forwarding a stale
      // Cookie header would override it.
      if (name.toLowerCase() === 'cookie') continue
      if (typeof value !== 'string' || /[\r\n\0]/.test(value)) return reply(400, { error: 'invalid_request' })
      headers.set(name, value)
    }

    try {
      const forwarded = await options.forward(target.toString(), {
        method,
        headers,
        credentials: 'include',
        ...(typeof payload.body === 'string' ? { body: payload.body } : {}),
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      })
      reply(200, { status: forwarded.status, body: await forwarded.text() })
    } catch {
      reply(502, { error: 'upstream_unavailable' })
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'bridge_failed' }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    token: options.token,
    close: () => { server.close() },
  }
}
