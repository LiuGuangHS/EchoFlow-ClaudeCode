import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleEchoFlowApi } from '../api/echoflow.js'
import { ProviderService } from '../services/providerService.js'
import { EchoFlowApiService } from '../services/echoflowApiService.js'

let temporaryConfigDir: string
let previousConfigDir: string | undefined

beforeEach(async () => {
  temporaryConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-api-test-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = temporaryConfigDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await fs.rm(temporaryConfigDir, { recursive: true, force: true })
})

function makeApiRequest(
  pathname: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
) {
  const req = new Request(`http://localhost:3456${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const url = new URL(req.url)
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

function makeRequest(body: Record<string, unknown>) {
  return makeApiRequest('/api/echoflow/account', 'POST', body)
}

async function readStoredJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(temporaryConfigDir, 'echoflow-code', relativePath), 'utf-8')) as T
}

describe('EchoFlow account API', () => {
  test('preserves boolean token quota flags while binding an account', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: { quota: 500_000, group: 'default', username: 'echo' },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'token-1', key: 'sk-test', unlimited_quota: true }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const { req, url, segments } = makeRequest({ userId: '106452', managementToken: 'token' })
      const response = await handleEchoFlowApi(req, url, segments)
      const body = await response.json() as { account: { tokens: Array<{ key?: string; keyPreview?: string; unlimitedQuota?: boolean }> } }

      expect(response.status).toBe(200)
      expect(body.account.tokens).toEqual([expect.objectContaining({ keyPreview: 'sk-••••', unlimitedQuota: true })])
      expect(body.account.tokens[0]?.key).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('loads all token pages and removes duplicate ids', async () => {
    const originalFetch = globalThis.fetch
    const requested: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      requested.push(url)
      const page = new URL(url).searchParams.get('p')
      const data = page === '0'
        ? Array.from({ length: 100 }, (_, index) => ({ id: 'token-' + index, key: 'key-' + index }))
        : [{ id: 'token-99', key: 'duplicate-key' }, { id: 'token-100', key: 'key-100' }]
      return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    try {
      const tokens = await new EchoFlowApiService().listTokens('user', 'management')
      expect(tokens).toHaveLength(101)
      expect(tokens.at(-1)?.id).toBe('token-100')
      expect(requested).toEqual([
        'https://api.echoflowai.cc/api/token/?p=0&size=100',
        'https://api.echoflowai.cc/api/token/?p=1&size=100',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('classifies management-token auth failures as token_invalid', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      success: false,
      message: '无权进行此操作',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

    try {
      const { req, url, segments } = makeRequest({
        userId: '106452',
        managementToken: 'bad-management-token',
      })
      const response = await handleEchoFlowApi(req, url, segments)
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'token_invalid' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps main and dedicated credentials, balances, and token namespaces isolated', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const userId = headers.get('new-api-user')
      const managementToken = headers.get('authorization')
      if (url.endsWith('/api/user/self')) {
        const isDedicated = userId === 'dedicated-user'
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: isDedicated ? 1_000_000 : 500_000,
            group: isDedicated ? 'dedicated' : 'main',
            username: isDedicated ? 'dedicated-name' : 'main-name',
          },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      const isDedicated = managementToken === 'dedicated-management-token'
      return new Response(JSON.stringify({
        success: true,
        data: [{
          id: 'shared-token-id',
          name: isDedicated ? 'Dedicated key' : 'Main key',
          key: isDedicated ? 'dedicated-api-key' : 'main-api-key',
        }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      for (const account of [
        { endpoint: 'main', userId: 'main-user', managementToken: 'main-management-token' },
        { endpoint: 'dedicated', userId: 'dedicated-user', managementToken: 'dedicated-management-token' },
      ]) {
        const { req, url, segments } = makeRequest(account)
        const response = await handleEchoFlowApi(req, url, segments)
        expect(response.status).toBe(200)
      }

      const loaded = makeApiRequest('/api/echoflow', 'GET')
      const loadedResponse = await handleEchoFlowApi(loaded.req, loaded.url, loaded.segments)
      const loadedBody = await loadedResponse.json() as {
        accounts: Record<'main' | 'dedicated', { userId: string; balance?: number; userGroup?: string; tokens?: Array<{ id: string; name: string; key?: string; keyPreview?: string }> } | null>
      }
      expect(loadedBody.accounts.main).toMatchObject({ userId: 'main-user', balance: 1, userGroup: 'main' })
      expect(loadedBody.accounts.dedicated).toMatchObject({ userId: 'dedicated-user', balance: 2, userGroup: 'dedicated' })
      expect(loadedBody.accounts.main?.tokens).toEqual([expect.objectContaining({ id: 'shared-token-id', name: 'Main key', keyPreview: expect.any(String) })])
      expect(loadedBody.accounts.dedicated?.tokens).toEqual([expect.objectContaining({ id: 'shared-token-id', name: 'Dedicated key', keyPreview: expect.any(String) })])
      expect(loadedBody.accounts.main?.tokens?.[0]?.key).toBeUndefined()
      expect(loadedBody.accounts.dedicated?.tokens?.[0]?.key).toBeUndefined()
      expect(JSON.stringify(loadedBody)).not.toContain('main-management-token')
      expect(JSON.stringify(loadedBody)).not.toContain('dedicated-management-token')

      const dedicatedSelection = makeApiRequest('/api/echoflow/select-token', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'shared-token-id',
      })
      const dedicatedSelectionResponse = await handleEchoFlowApi(dedicatedSelection.req, dedicatedSelection.url, dedicatedSelection.segments)
      expect(await dedicatedSelectionResponse.json()).toEqual({
        token: expect.objectContaining({ id: 'shared-token-id', name: 'Dedicated key' }),
      })

      const mainDisconnect = makeApiRequest('/api/echoflow/account', 'DELETE', { endpoint: 'main' })
      const mainDisconnectResponse = await handleEchoFlowApi(mainDisconnect.req, mainDisconnect.url, mainDisconnect.segments)
      expect(mainDisconnectResponse.status).toBe(200)
      const afterDisconnect = makeApiRequest('/api/echoflow', 'GET')
      const afterDisconnectResponse = await handleEchoFlowApi(afterDisconnect.req, afterDisconnect.url, afterDisconnect.segments)
      const afterDisconnectBody = await afterDisconnectResponse.json() as { accounts: Record<'main' | 'dedicated', unknown> }
      expect(afterDisconnectBody.accounts.main).toBeNull()
      expect(afterDisconnectBody.accounts.dedicated).toMatchObject({ userId: 'dedicated-user' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('migrates both legacy endpoint account shapes before returning public data', async () => {
    const service = new EchoFlowApiService()
    const accountPath = path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json')

    for (const endpoint of ['main', 'dedicated'] as const) {
      await fs.mkdir(path.dirname(accountPath), { recursive: true })
      await fs.writeFile(accountPath, JSON.stringify({
        userId: `legacy-${endpoint}`,
        managementToken: `legacy-management-${endpoint}`,
        balance: endpoint === 'main' ? 3 : 4,
        userGroup: endpoint,
        tokens: [{ id: 'legacy-token', name: 'Legacy key', key: `legacy-api-${endpoint}` }],
        endpoint,
      }))

      const accounts = await service.getAccounts()
      expect(accounts[endpoint]).toMatchObject({ userId: `legacy-${endpoint}`, endpoint })
      expect(accounts[endpoint]?.tokens).toEqual([expect.objectContaining({ keyPreview: expect.any(String) })])
      expect(JSON.stringify(accounts)).not.toContain('legacy-management-')

      const stored = await readStoredJson<{ schemaVersion: number; accounts: Record<'main' | 'dedicated', { userId: string; managementToken: string; endpoint?: string } | null> }>('echoflow-account.json')
      expect(stored.schemaVersion).toBe(2)
      expect(stored.accounts[endpoint]).toMatchObject({ userId: `legacy-${endpoint}`, managementToken: `legacy-management-${endpoint}`, endpoint })
      expect(stored.accounts[endpoint === 'main' ? 'dedicated' : 'main']).toBeNull()
    }
  })

  test('migrates the legacy qingyun account file to the main EchoFlow account', async () => {
    const internalDir = path.join(temporaryConfigDir, 'echoflow-code')
    const legacyPath = path.join(internalDir, 'qingyun-account.json')
    const currentPath = path.join(internalDir, 'echoflow-account.json')
    await fs.mkdir(internalDir, { recursive: true })
    await fs.writeFile(legacyPath, JSON.stringify({
      userId: 'legacy-user',
      managementToken: 'legacy-management-token',
      username: 'legacy-name',
    }))

    const request = makeApiRequest('/api/echoflow', 'GET')
    const response = await handleEchoFlowApi(request.req, request.url, request.segments)
    const body = await response.json() as { account: { userId: string; username: string; endpoint?: string } }

    expect(response.status).toBe(200)
    expect(body.account).toMatchObject({ userId: 'legacy-user', username: 'legacy-name', endpoint: 'main' })
    expect(await fs.readFile(currentPath, 'utf8')).toContain('legacy-management-token')
    await expect(fs.access(legacyPath)).rejects.toThrow()
  })

  test('select-token only returns metadata without providerId and rejects non-EchoFlow updates', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: { quota: 500_000, group: 'dedicated', username: 'dedicated-user' },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'dedicated-token', name: 'Dedicated key', key: 'sk-test' }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({
        endpoint: 'dedicated',
        userId: 'dedicated-user',
        managementToken: 'dedicated-management-token',
      })
      const bindResponse = await handleEchoFlowApi(bind.req, bind.url, bind.segments)
      expect(bindResponse.status).toBe(200)

      const selection = makeApiRequest('/api/echoflow/select-token', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'dedicated-token',
      })
      const selectionResponse = await handleEchoFlowApi(selection.req, selection.url, selection.segments)
      const selectionBody = await selectionResponse.json() as { token: Record<string, unknown> }

      expect(selectionResponse.status).toBe(200)
      expect(selectionBody).toEqual({
        token: expect.objectContaining({ id: 'dedicated-token', name: 'Dedicated key', keyPreview: 'sk-••••' }),
      })
      expect(selectionBody).not.toHaveProperty('providerId')
      expect(selectionBody.token).not.toHaveProperty('key')

      const ordinaryProvider = await new ProviderService().addProvider({
        presetId: 'custom',
        name: 'Ordinary provider',
        apiKey: 'ordinary-api-key',
        baseUrl: 'https://ordinary.example.test',
        apiFormat: 'anthropic',
        authStrategy: 'api_key',
        models: {
          main: 'ordinary-model',
          haiku: 'ordinary-model',
          sonnet: 'ordinary-model',
          opus: 'ordinary-model',
        },
      })
      const invalidUpdate = makeApiRequest('/api/echoflow/select-token', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'dedicated-token',
        providerId: ordinaryProvider.id,
      })
      const invalidUpdateResponse = await handleEchoFlowApi(invalidUpdate.req, invalidUpdate.url, invalidUpdate.segments)

      expect(invalidUpdateResponse.status).toBe(400)
      expect(await invalidUpdateResponse.json()).toEqual({ error: 'invalid_provider' })
      await expect(new ProviderService().getProvider(ordinaryProvider.id)).resolves.toMatchObject({
        apiKey: 'ordinary-api-key',
        baseUrl: 'https://ordinary.example.test',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('creates a provider with the server-resolved endpoint token', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({ success: true, data: { quota: 500_000, group: 'default', username: 'echo' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'same-token', name: 'Dedicated key', key: 'server-dedicated-key' }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'dedicated', userId: 'dedicated-user', managementToken: 'dedicated-management-token' })
      await handleEchoFlowApi(bind.req, bind.url, bind.segments)

      const create = makeApiRequest('/api/echoflow/provider', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'same-token',
        apiKey: 'client-forged-key',
        presetId: 'client-forged-preset',
        name: 'Dedicated channel',
        baseUrl: 'https://api.echoflowai.cc',
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
        models: { main: 'model-main', haiku: 'model-haiku', sonnet: 'model-sonnet', opus: 'model-opus' },
        imageGeneration: { model: 'image-model', apiKey: 'client-image-secret' },
      })
      const response = await handleEchoFlowApi(create.req, create.url, create.segments)
      const body = await response.json() as { provider: { id: string; presetId: string; baseUrl: string; apiKey: string } }
      expect(response.status).toBe(201)
      expect(body.provider).toMatchObject({
        presetId: 'echoflowai',
        baseUrl: 'https://expapi.echoflowai.cc',
      })
      expect(body.provider.apiKey).not.toBe('server-dedicated-key')
      expect(body.provider.apiKey).not.toBe('client-forged-key')
      expect(JSON.stringify(body)).not.toContain('client-image-secret')

      const stored = await readStoredJson<{ providers: Array<{ presetId: string; baseUrl: string; apiKey: string }> }>('providers.json')
      expect(stored.providers).toEqual([expect.objectContaining({
        presetId: 'echoflowai',
        baseUrl: 'https://expapi.echoflowai.cc',
        apiKey: 'server-dedicated-key',
      })])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('fetches models with the endpoint-scoped server token', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; authorization: string | null }> = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      requests.push({ url, authorization: headers.get('authorization') })
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({ success: true, data: { quota: 500_000, group: 'default', username: 'echo' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/token/?p=0&size=100')) {
        return new Response(JSON.stringify({ success: true, data: [{ id: 'model-token', name: 'Model key', key: 'server-model-key' }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: [{ id: 'echo-model', owned_by: 'echo' }] }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'dedicated', userId: 'user', managementToken: 'management' })
      await handleEchoFlowApi(bind.req, bind.url, bind.segments)
      const models = makeApiRequest('/api/echoflow/models', 'POST', { endpoint: 'dedicated', tokenId: 'model-token' })
      const response = await handleEchoFlowApi(models.req, models.url, models.segments)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        models: [{ id: 'echo-model', ownedBy: 'echo' }],
        endpoint: 'https://expapi.echoflowai.cc/v1/models',
      })
      expect(requests).toContainEqual({
        url: 'https://expapi.echoflowai.cc/v1/models',
        authorization: 'Bearer server-model-key',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not resolve a token from another endpoint namespace', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: { quota: 500_000, group: 'default', username: headers.get('new-api-user') ?? '' },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'shared-token-id', name: 'Endpoint key', key: `${headers.get('authorization')}-api-key` }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'main', userId: 'main-user', managementToken: 'main-management-token' })
      const bindResponse = await handleEchoFlowApi(bind.req, bind.url, bind.segments)
      expect(bindResponse.status).toBe(200)

      const create = makeApiRequest('/api/echoflow/provider', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'shared-token-id',
        name: 'Cross-endpoint channel',
        baseUrl: 'https://api.echoflowai.cc',
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
        models: { main: 'model-main', haiku: 'model-haiku', sonnet: 'model-sonnet', opus: 'model-opus' },
      })
      const response = await handleEchoFlowApi(create.req, create.url, create.segments)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'token_invalid' })
      await expect(new ProviderService().listProviders()).resolves.toMatchObject({ providers: [] })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects cross-endpoint model discovery and connection tests', async () => {
    const originalFetch = globalThis.fetch
    let upstreamCalls = 0
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({ success: true, data: { quota: 500_000, group: 'main', username: 'main-user' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/token/?p=0&size=100')) {
        return new Response(JSON.stringify({ success: true, data: [{ id: 'main-token', name: 'Main key', key: 'main-api-key' }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      upstreamCalls += 1
      return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'main', userId: 'main-user', managementToken: 'main-management-token' })
      await handleEchoFlowApi(bind.req, bind.url, bind.segments)

      const models = makeApiRequest('/api/echoflow/models', 'POST', { endpoint: 'dedicated', tokenId: 'main-token' })
      const modelsResponse = await handleEchoFlowApi(models.req, models.url, models.segments)
      expect(modelsResponse.status).toBe(400)
      expect(await modelsResponse.json()).toEqual({ error: 'token_invalid' })

      const testProvider = makeApiRequest('/api/echoflow/test-provider', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'main-token',
        baseUrl: 'https://api.echoflowai.cc',
        modelId: 'main-model',
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
      })
      const testResponse = await handleEchoFlowApi(testProvider.req, testProvider.url, testProvider.segments)
      expect(testResponse.status).toBe(400)
      expect(await testResponse.json()).toEqual({ error: 'token_invalid' })
      expect(upstreamCalls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('tests OpenAI Responses with the server token and forced endpoint URL', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; authorization: string | null }> = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({ success: true, data: { quota: 500_000, group: 'dedicated', username: 'dedicated-user' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/token/?p=0&size=100')) {
        return new Response(JSON.stringify({ success: true, data: [{ id: 'responses-token', name: 'Responses key', key: 'server-responses-key' }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      requests.push({ url, authorization: headers.get('authorization') })
      return new Response(JSON.stringify({ output: [], model: 'responses-model' }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'dedicated', userId: 'dedicated-user', managementToken: 'dedicated-management-token' })
      await handleEchoFlowApi(bind.req, bind.url, bind.segments)

      const testProvider = makeApiRequest('/api/echoflow/test-provider', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'responses-token',
        baseUrl: 'https://api.echoflowai.cc',
        modelId: 'responses-model',
        apiFormat: 'openai_responses',
        authStrategy: 'api_key',
      })
      const response = await handleEchoFlowApi(testProvider.req, testProvider.url, testProvider.segments)
      const body = await response.json() as { result: { connectivity: { success: boolean } } }

      expect(response.status).toBe(200)
      expect(body.result.connectivity.success).toBe(true)
      expect(requests.length).toBeGreaterThan(0)
      expect(requests.every(({ url, authorization }) => url === 'https://expapi.echoflowai.cc/v1/responses' && authorization === 'Bearer server-responses-key')).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('updates an EchoFlow provider to the selected endpoint without exposing its key', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({ success: true, data: { quota: 500_000, group: 'dedicated', username: 'dedicated-user' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ success: true, data: [{ id: 'dedicated-token', name: 'Dedicated key', key: 'dedicated-api-key' }] }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'dedicated', userId: 'dedicated-user', managementToken: 'dedicated-management-token' })
      await handleEchoFlowApi(bind.req, bind.url, bind.segments)
      const provider = await new ProviderService().addProvider({
        presetId: 'echoflowai',
        name: 'EchoFlow channel',
        apiKey: 'old-api-key',
        baseUrl: 'https://api.echoflowai.cc',
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
        models: { main: 'model-main', haiku: 'model-haiku', sonnet: 'model-sonnet', opus: 'model-opus' },
      })

      const selection = makeApiRequest('/api/echoflow/select-token', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'dedicated-token',
        providerId: provider.id,
      })
      const response = await handleEchoFlowApi(selection.req, selection.url, selection.segments)
      const body = await response.json() as { provider: Record<string, unknown> }

      expect(response.status).toBe(200)
      expect(body).toEqual({ provider: { id: provider.id } })
      await expect(new ProviderService().getProvider(provider.id)).resolves.toMatchObject({
        apiKey: 'dedicated-api-key',
        baseUrl: 'https://expapi.echoflowai.cc',
        presetId: 'echoflowai',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('tests a provider with the server-resolved endpoint token and base URL', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; headers: Headers }> = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      requests.push({ url, headers })
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({ success: true, data: { quota: 500_000, group: 'default', username: 'echo' } }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/token/?p=0&size=100')) {
        return new Response(JSON.stringify({ success: true, data: [{ id: 'test-token', name: 'Test key', key: 'server-test-key' }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ type: 'message', model: 'test-model', content: [] }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const bind = makeRequest({ endpoint: 'dedicated', userId: 'dedicated-user', managementToken: 'dedicated-management-token' })
      await handleEchoFlowApi(bind.req, bind.url, bind.segments)

      const testProvider = makeApiRequest('/api/echoflow/test-provider', 'POST', {
        endpoint: 'dedicated',
        tokenId: 'test-token',
        baseUrl: 'https://api.echoflowai.cc',
        modelId: 'test-model',
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
      })
      const response = await handleEchoFlowApi(testProvider.req, testProvider.url, testProvider.segments)
      const body = await response.json() as { result: { connectivity: { success: boolean } } }

      expect(response.status).toBe(200)
      expect(body.result.connectivity.success).toBe(true)
      expect(requests).toContainEqual(expect.objectContaining({
        url: 'https://expapi.echoflowai.cc/v1/messages',
      }))
      expect(requests.find((request) => request.url.endsWith('/v1/messages'))?.headers.get('authorization')).toBe('Bearer server-test-key')
      expect(requests.some((request) => request.url.startsWith('https://api.echoflowai.cc/'))).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
