import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { EchoFlowApiService } from '../services/echoflowApiService.js'

let configDir: string
let oldConfigDir: string | undefined
let oldHome: string | undefined
let oldBridge: string | undefined
let oldFetch: typeof fetch

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-remote-browser-'))
  oldConfigDir = process.env.CLAUDE_CONFIG_DIR
  oldHome = process.env.HOME
  oldBridge = process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN
  process.env.HOME = path.join(configDir, 'home')
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN = 'bridge-test'
  oldFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = oldFetch
  if (oldConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = oldConfigDir
  if (oldHome === undefined) delete process.env.HOME
  else process.env.HOME = oldHome
  if (oldBridge === undefined) delete process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN
  else process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN = oldBridge
  await fs.rm(configDir, { recursive: true, force: true })
})

function request(pathname: string, method: string, body?: unknown, remoteBrowser = false) {
  const url = new URL(`http://localhost${pathname}`)
  const req = new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handleApiRequest(req, url, { remoteBrowser })
}

describe('EchoFlow remote browser authorization', () => {
  test.each([
    ['/api/echoflow/token', { endpoint: 'main', tokenId: 'token-1' }],
    ['/api/echoflow/create-token', { endpoint: 'main', name: 'new-token' }],
    ['/api/echoflow/account', { userId: '123', managementToken: 'management-secret' }],
    ['/api/echoflow/account', { endpoint: 'main' }, 'PUT'],
    ['/api/echoflow/account', { endpoint: 'main' }, 'DELETE'],
    ['/api/echoflow/account', { endpoint: 'dedicated' }, 'PATCH'],
    ['/api/echoflow/provider', { endpoint: 'main', tokenId: 'token-1', name: 'provider', models: [] }],
    ['/api/echoflow/models', { endpoint: 'main', tokenId: 'token-1' }],
    ['/api/echoflow/test-provider', { endpoint: 'main', tokenId: 'token-1', name: 'provider', models: [] }],
    ['/api/echoflow/select-token', { endpoint: 'main', tokenId: 'token-1' }],
  ] as [string, unknown, string?][])('blocks remote %s %s before credential access', async (pathname, body, method = 'POST') => {
    let fetchCalls = 0
    globalThis.fetch = mock(async () => {
      fetchCalls += 1
      return Response.json({ success: true, data: { items: [{ id: 'token-1', key: 'sk-secret-key' }] } })
    }) as typeof fetch

    const response = await request(pathname, method, body, true)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'desktop_only' })
    expect(fetchCalls).toBe(0)
    expect((await new EchoFlowApiService().getAccounts()).main).toBeNull()
    expect(await fs.readdir(path.join(configDir, 'echoflow-code')).catch(() => [])).toEqual([])
  })

  test('keeps local token retrieval and account binding functional', async () => {
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { id: '123', username: 'test' } })
      }
      if (String(input).endsWith('/api/token/') && init?.method === 'POST') {
        return Response.json({ success: true, data: 'new-secret-key' })
      }
      return Response.json({ success: true, data: { items: [{ id: 'token-1', name: 'test-token', key: 'sk-secret-key' }] } })
    }) as typeof fetch

    const bind = await request('/api/echoflow/account', 'POST', { userId: '123', managementToken: 'fake-management-token' })
    expect(bind.status).toBe(200)
    const token = await request('/api/echoflow/token', 'POST', { endpoint: 'main', tokenId: 'token-1' })
    expect(token.status).toBe(200)
    expect(await token.json()).toEqual({ token: { id: 'token-1', name: 'test-token', key: 'sk-secret-key' } })
  })

  test('allows remote account status only as a secret-safe projection', async () => {
    const managementToken = 'fake-management-token'
    globalThis.fetch = mock(async () => Response.json({
      success: true,
      data: {
        id: '123',
        username: 'test',
        items: [{ id: 'token-1', name: 'test-token', key: 'sk-secret-key' }],
      },
    })) as typeof fetch

    const bind = await request('/api/echoflow/account', 'POST', { userId: '123', managementToken })
    expect(bind.status).toBe(200)

    const response = await request('/api/echoflow', 'GET', undefined, true)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      account: {
        userId: '123',
        tokens: [{ id: 'token-1', name: 'test-token', keyPreview: expect.any(String) }],
      },
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(managementToken)
    expect(serialized).not.toContain('sk-secret-key')
    expect(body.account).not.toHaveProperty('managementToken')
    expect(body.accounts.main).toEqual(body.account)
    expect(body.account.tokens[0].key).toBeUndefined()
    expect(body.account.tokens[0].keyPreview).not.toBe('sk-secret-key')
  })
})
