/**
 * Integration tests for /api/echoflow-openai-oauth/* endpoints.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { createServer } from 'net'
import { handleEchoFlowOpenAIOAuthApi } from '../api/echoflow-openai-oauth.js'
import { handleApiRequest } from '../router.js'
import { echoFlowOpenAIOAuthService } from '../services/echoFlowOpenAIOAuthService.js'
import { startServer, stopServerRuntimeForShutdown } from '../index.js'
import { ProviderService } from '../services/providerService.js'

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

    const { req, url, segments } = buildReq(
      'POST',
      '/api/echoflow-openai-oauth/start',
      { serverPort: 54321 },
    )
    const res = await handleEchoFlowOpenAIOAuthApi(req, url, segments)
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
    const { req, url, segments } = buildReq(
      'POST',
      '/api/echoflow-openai-oauth/start',
      {},
    )
    const res = await handleEchoFlowOpenAIOAuthApi(req, url, segments)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; message?: string }
    expect(body.error).toBe('BAD_REQUEST')
  })
})

describe('GET /api/echoflow-openai-oauth', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('rejects the retired resource route', async () => {
    const legacyUrl = new URL('http://localhost:3456/api/haha-openai-oauth')

    const legacy = await handleApiRequest(new Request(legacyUrl), legacyUrl)

    expect(legacy.status).toBe(404)
  })

  test('returns loggedIn=false when no token file', async () => {
    const { req, url, segments } = buildReq('GET', '/api/echoflow-openai-oauth')
    const res = await handleEchoFlowOpenAIOAuthApi(req, url, segments)
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

    const { req, url, segments } = buildReq('GET', '/api/echoflow-openai-oauth')
    const res = await handleEchoFlowOpenAIOAuthApi(req, url, segments)
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

    const { req, url, segments } = buildReq('GET', '/api/echoflow-openai-oauth')
    const res = await handleEchoFlowOpenAIOAuthApi(req, url, segments)

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

    const { req, url, segments } = buildReq('DELETE', '/api/echoflow-openai-oauth')
    const res = await handleEchoFlowOpenAIOAuthApi(req, url, segments)
    expect(res.status).toBe(200)
    expect(await echoFlowOpenAIOAuthService.loadTokens()).toBeNull()
  })
})

describe('GET /auth/callback', () => {
  beforeEach(setup)
  afterEach(teardown)

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
