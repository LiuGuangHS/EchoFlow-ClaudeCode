/**
 * Integration tests for /api/echoflow-openai-oauth/* endpoints.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { createServer } from 'net'
import { handleApiRequest } from '../router.js'
import { echoFlowOpenAIOAuthService } from '../services/echoFlowOpenAIOAuthService.js'
import { startServer, stopServerRuntimeForShutdown } from '../index.js'
import { ProviderService } from '../services/providerService.js'
import { echoFlowOAuthService } from '../services/echoFlowOAuthService.js'
import { hahaOAuthService } from '../services/hahaOAuthService.js'
import { hahaOpenAIOAuthService } from '../services/hahaOpenAIOAuthService.js'
import { isPublicBusinessPathAllowed } from '../publicAccess.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'echoflow-openai-oauth-api-test-'),
  )
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  echoFlowOpenAIOAuthService.dispose()
  echoFlowOpenAIOAuthService.resetCallbackPortForTests()
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function buildReq(
  method: string,
  pathname: string,
  body?: unknown,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(`http://localhost:3456${pathname}`)
  const req = new Request(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate test port')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

describe('POST /api/echoflow-openai-oauth/start', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns authorize URL with PKCE challenge', async () => {
    const callbackPort = await getFreePort()
    echoFlowOpenAIOAuthService.setCallbackPortForTests(callbackPort)

    const { req, url } = buildReq(
      'POST',
      '/api/echoflow-openai-oauth/start',
      { serverPort: 54321 },
    )
    const res = await handleApiRequest(req, url)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { authorizeUrl: string; state: string }
    expect(data.authorizeUrl).toContain('code_challenge_method=S256')
    expect(data.authorizeUrl).toContain(
      'codex_cli_simplified_flow=true',
    )
    expect(data.authorizeUrl).toContain(
      encodeURIComponent(`http://localhost:${callbackPort}/auth/callback`),
    )
    expect(data.authorizeUrl).not.toContain(
      encodeURIComponent('http://localhost:54321/auth/callback'),
    )
    expect(data.authorizeUrl).not.toContain('originator=')
    expect(data.state).toMatch(/^[a-f0-9]{64}$/)
  })

  test('400 if serverPort missing', async () => {
    const { req, url } = buildReq(
      'POST',
      '/api/echoflow-openai-oauth/start',
      {},
    )
    const res = await handleApiRequest(req, url)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; message?: string }
    expect(body.error).toBe('BAD_REQUEST')
  })
})

describe('GET /api/echoflow-openai-oauth', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('routes both OAuth resource names while keeping remote browsers out', async () => {
    for (const resource of ['echoflow-openai-oauth', 'haha-openai-oauth']) {
      const url = new URL(`http://localhost:3456/api/${resource}`)
      const response = await handleApiRequest(new Request(url), url)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ loggedIn: false })
      for (const method of ['GET', 'POST', 'DELETE']) {
        const remote = await handleApiRequest(new Request(url, { method }), url, { remoteBrowser: true })
        expect(remote.status).toBe(403)
      }
    }
  })

  test('returns loggedIn=false when no token file', async () => {
    const { req, url } = buildReq('GET', '/api/echoflow-openai-oauth')
    const res = await handleApiRequest(req, url)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { loggedIn: boolean }
    expect(data.loggedIn).toBe(false)
  })

  test('returns loggedIn=true + metadata when token saved', async () => {
    await echoFlowOpenAIOAuthService.saveTokens({
      accessToken: 'openai-access-token-xxx',
      refreshToken: 'openai-refresh-token-xxx',
      expiresAt: Date.now() + 3600_000,
      email: 'test@example.com',
      accountId: 'acct_123',
    })

    const { req, url } = buildReq('GET', '/api/echoflow-openai-oauth')
    const res = await handleApiRequest(req, url)
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      loggedIn: boolean
      expiresAt: number | null
      email: string | null
      accountId: string | null
    }
    expect(data.loggedIn).toBe(true)
    expect(data.email).toBe('test@example.com')
    expect(data.accountId).toBe('acct_123')
    // Never leak token values
    expect(JSON.stringify(data)).not.toContain('openai-access-token')
    expect(JSON.stringify(data)).not.toContain('openai-refresh-token')
  })

  test('returns loggedIn=false when stored token is expired and refresh fails', async () => {
    await echoFlowOpenAIOAuthService.saveTokens({
      accessToken: 'expired-token',
      refreshToken: 'revoked-refresh-token',
      expiresAt: Date.now() - 1_000,
      email: 'test@example.com',
      accountId: 'acct_123',
    })
    echoFlowOpenAIOAuthService.setRefreshFn(async () => {
      throw new Error('refresh revoked')
    })

    const { req, url } = buildReq('GET', '/api/echoflow-openai-oauth')
    const res = await handleApiRequest(req, url)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ loggedIn: false })
  })
})

describe('DELETE /api/echoflow-openai-oauth', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('clears token file', async () => {
    await echoFlowOpenAIOAuthService.saveTokens({
      accessToken: 'a',
      refreshToken: null,
      expiresAt: null,
      email: null,
      accountId: null,
    })

    const { req, url } = buildReq('DELETE', '/api/echoflow-openai-oauth')
    const res = await handleApiRequest(req, url)
    expect(res.status).toBe(200)
    expect(await echoFlowOpenAIOAuthService.loadTokens()).toBeNull()
  })
})

describe('GET /auth/callback', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('dispatches callbacks only to the state owner, with no retry after consumption or failure', async () => {
    const originalServerPort = ProviderService.getServerPort()
    const server = startServer(0, '127.0.0.1')
    const cases = [
      { service: echoFlowOAuthService, callback: '/callback' },
      { service: hahaOAuthService, callback: '/callback' },
      { service: echoFlowOpenAIOAuthService, callback: '/auth/callback' },
      { service: hahaOpenAIOAuthService, callback: '/callback/openai' },
    ]
    const spies = cases.map(({ service }, index) =>
      spyOn(service, 'completeSession').mockImplementation(async (_code, state) => {
        expect(service.consumeSession(state)).not.toBeNull()
        throw new Error(`fixture-exchange-failed-${index}`)
      }),
    )
    try {
      echoFlowOpenAIOAuthService.setCallbackPortForTests(await getFreePort())
      hahaOpenAIOAuthService.setCallbackPortForTests(await getFreePort())
      for (const [index, { service, callback }] of cases.entries()) {
        const session = await service.startSession({ serverPort: server.port! })
        const url = `http://127.0.0.1:${server.port}${callback}?code=fixture-code&state=${session.state}`
        const response = await fetch(url)
        expect(response.status).toBe(200)
        expect(await response.text()).toContain(`fixture-exchange-failed-${index}`)
        expect(spies[index]).toHaveBeenCalledWith('fixture-code', session.state)
        const replay = await fetch(url)
        expect(replay.status).toBe(400)
      }
      for (const callback of ['/callback', '/auth/callback', '/callback/openai']) {
        const unknown = await fetch(`http://127.0.0.1:${server.port}${callback}?code=fixture-code&state=unknown`)
        expect(unknown.status).toBe(400)
      }
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      for (const spy of spies) spy.mockRestore()
      hahaOpenAIOAuthService.dispose()
      hahaOpenAIOAuthService.resetCallbackPortForTests()
      server.stop(true)
      stopServerRuntimeForShutdown()
      ProviderService.setServerPort(originalServerPort)
    }
  })

  test('OAuth resource names remain denied on the public business surface', () => {
    for (const resource of [
      'echoflow-oauth', 'echoflow-openai-oauth', 'echoflow-grok-oauth',
      'haha-oauth', 'haha-openai-oauth', 'haha-grok-oauth', 'haha-deepseek-oauth',
    ]) {
      for (const action of ['', '/start', '/status', '/callback', '/success']) {
        for (const method of ['GET', 'POST', 'DELETE']) {
          const url = new URL(`https://remote.example/api/${resource}${action}`)
          expect(isPublicBusinessPathAllowed(url, method)).toBe(false)
          expect(isPublicBusinessPathAllowed(new URL(url.href.replace('/api/', '/api//')), method)).toBe(false)
        }
      }
    }
  })

  test('routes the OpenAI Codex redirect path to the desktop callback page', async () => {
    const originalServerPort = ProviderService.getServerPort()
    const server = startServer(0, '127.0.0.1')
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/auth/callback`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('OpenAI Login Failed')
      expect(html).toContain('Missing code or state parameter')
    } finally {
      await server.stop(true)
      await stopServerRuntimeForShutdown({ waitForCli: false })
      ProviderService.setServerPort(originalServerPort)
    }
  })
})
