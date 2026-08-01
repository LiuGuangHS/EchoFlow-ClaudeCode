/**
 * Integration tests for /api/echoflow-oauth/* endpoints.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { handleEchoFlowOAuthApi } from '../api/echoflow-oauth.js'
import { handleApiRequest } from '../router.js'
import { echoFlowOAuthService } from '../services/echoFlowOAuthService.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-oauth-api-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
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

describe('POST /api/echoflow-oauth/start', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns authorize URL with PKCE challenge', async () => {
    const { req, url, segments } = buildReq('POST', '/api/echoflow-oauth/start', {
      serverPort: 54321,
    })
    const res = await handleEchoFlowOAuthApi(req, url, segments)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { authorizeUrl: string; state: string }
    expect(data.authorizeUrl).toContain('code_challenge_method=S256')
    expect(data.authorizeUrl).toContain(
      encodeURIComponent('http://localhost:54321/callback'),
    )
    expect(data.state).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('400 if serverPort missing', async () => {
    const { req, url, segments } = buildReq('POST', '/api/echoflow-oauth/start', {})
    const res = await handleEchoFlowOAuthApi(req, url, segments)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; message?: string }
    expect(body.error).toBe('BAD_REQUEST')
  })
})

describe('GET /api/echoflow-oauth/status', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('keeps the legacy resource route compatible with the canonical route', async () => {
    const canonicalUrl = new URL('http://localhost:3456/api/echoflow-oauth')
    const legacyUrl = new URL('http://localhost:3456/api/haha-oauth')

    const canonical = await handleApiRequest(new Request(canonicalUrl), canonicalUrl)
    const legacy = await handleApiRequest(new Request(legacyUrl), legacyUrl)

    expect(legacy.status).toBe(canonical.status)
    expect(await legacy.json()).toEqual(await canonical.json())
  })

  test('returns loggedIn=false when no token file', async () => {
    const { req, url, segments } = buildReq('GET', '/api/echoflow-oauth/status')
    const res = await handleEchoFlowOAuthApi(req, url, segments)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { loggedIn: boolean }
    expect(data.loggedIn).toBe(false)
  })

  test('returns loggedIn=true + metadata when token saved', async () => {
    await echoFlowOAuthService.saveTokens({
      accessToken: 'sk-ant-oat01-xxx',
      refreshToken: 'sk-ant-ort01-xxx',
      expiresAt: Date.now() + 3600_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const { req, url, segments } = buildReq('GET', '/api/echoflow-oauth/status')
    const res = await handleEchoFlowOAuthApi(req, url, segments)
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      loggedIn: boolean
      subscriptionType: string | null
      scopes: string[]
    }
    expect(data.loggedIn).toBe(true)
    expect(data.subscriptionType).toBe('max')
    expect(data.scopes).toEqual(['user:inference'])
    expect(JSON.stringify(data)).not.toContain('sk-ant-oat01')
    expect(JSON.stringify(data)).not.toContain('sk-ant-ort01')
  })

  test('returns loggedIn=false when stored token is expired and refresh fails', async () => {
    await echoFlowOAuthService.saveTokens({
      accessToken: 'expired-token',
      refreshToken: 'revoked-refresh-token',
      expiresAt: Date.now() - 1_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })
    echoFlowOAuthService.setRefreshFn(async () => {
      throw new Error('refresh revoked')
    })

    const { req, url, segments } = buildReq('GET', '/api/echoflow-oauth/status')
    const res = await handleEchoFlowOAuthApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ loggedIn: false })
  })
})

describe('DELETE /api/echoflow-oauth', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('clears token file', async () => {
    await echoFlowOAuthService.saveTokens({
      accessToken: 'a',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      subscriptionType: null,
    })

    const { req, url, segments } = buildReq('DELETE', '/api/echoflow-oauth')
    const res = await handleEchoFlowOAuthApi(req, url, segments)
    expect(res.status).toBe(200)
    expect(await echoFlowOAuthService.loadTokens()).toBeNull()
  })
})
