import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleEchoFlowApi } from './echoflow.js'

let temporaryConfigDir: string
let previousConfigDir: string | undefined
let previousBridgeToken: string | undefined
let originalFetch: typeof fetch

beforeEach(async () => {
  temporaryConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-api-route-test-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  previousBridgeToken = process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN
  process.env.CLAUDE_CONFIG_DIR = temporaryConfigDir
  process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN = 'bridge-token'
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  if (previousBridgeToken === undefined) delete process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN
  else process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN = previousBridgeToken
  await fs.rm(temporaryConfigDir, { recursive: true, force: true })
})

function stubSite(options: { selfStatus?: number } = {}) {
  const calls: { url: string; headers: Headers }[] = []
  let tokens: unknown[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: new Headers(init?.headers) })
    if (url.endsWith('/api/user/self')) {
      if (options.selfStatus && options.selfStatus !== 200) {
        return Response.json(
          { success: false, message: '无权进行此操作，未登录且未提供 access token' },
          { status: options.selfStatus },
        )
      }
      return Response.json({ success: true, data: { id: 851842, username: 'zhijun2003', quota: 1_000_000 } })
    }
    if (url.endsWith('/api/token/') && init?.method === 'POST') {
      tokens = [{ id: 9, name: 'echoflow-code', key: 'sk-created', status: 'enabled' }]
      return Response.json({ success: true, message: '', data: 'sk-created' })
    }
    return Response.json({ success: true, data: { items: tokens } })
  }) as typeof fetch
  return calls
}

function route(pathname: string, init: RequestInit = {}): Promise<Response> {
  const segments = pathname.split('/').filter(Boolean)
  return handleEchoFlowApi(new Request(`http://localhost${pathname}`, init), new URL(`http://localhost${pathname}`), segments)
}

function signIn(extra: Record<string, unknown> = {}): Promise<Response> {
  return route('/api/echoflow/account/credential', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-echoflow-site-session-bridge': 'bridge-token' },
    body: JSON.stringify({ endpoint: 'main', kind: 'session', cookie: 'session=live', userId: '851842', ...extra }),
  })
}

describe('EchoFlow account routes', () => {
  test('creates a call token through the signed-in session and returns the refreshed account', async () => {
    stubSite()
    expect((await signIn()).status).toBe(200)

    const response = await route('/api/echoflow/create-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'main' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { account: { tokens: { name: string; keyPreview: string }[] } }
    expect(body.account.tokens.map((token) => token.name)).toEqual(['echoflow-code'])
    // The renderer must never receive the raw key.
    expect(JSON.stringify(body)).not.toContain('sk-created')
  })

  test('replays the sign-in window fingerprint on every gateway call', async () => {
    const calls = stubSite()
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/134.0.0.0 Safari/537.36 EchoFlow Code/0.7.2'

    expect((await signIn({ userAgent, acceptLanguage: 'zh-CN' })).status).toBe(200)

    const self = calls.find((call) => call.url.endsWith('/api/user/self'))
    expect(self?.headers.get('user-agent')).toBe(userAgent)
    expect(self?.headers.get('accept-language')).toBe('zh-CN')
  })

  test('refuses a fingerprint header that could split the request apart', async () => {
    stubSite()

    const response = await signIn({ userAgent: 'Mozilla/5.0\r\nX-Injected: 1' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })

  test('passes the gateway message back when it refuses the sign-in', async () => {
    stubSite({ selfStatus: 401 })

    const response = await signIn()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'token_invalid',
      detail: '无权进行此操作，未登录且未提供 access token',
    })
  })

  test('rejects a token request for an unknown endpoint before it reaches the gateway', async () => {
    stubSite()

    const response = await route('/api/echoflow/create-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'elsewhere' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })
})
