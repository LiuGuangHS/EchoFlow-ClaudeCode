import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { EchoFlowApiService } from './echoflowApiService.js'

let temporaryConfigDir: string
let previousConfigDir: string | undefined
let originalFetch: typeof fetch

beforeEach(async () => {
  temporaryConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-api-service-test-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = temporaryConfigDir
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await fs.rm(temporaryConfigDir, { recursive: true, force: true })
})

function stubSite(quota = 1_000_000) {
  const calls: { url: string; headers: Headers }[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: new Headers(init?.headers) })
    if (url.endsWith('/api/user/self')) {
      return Response.json({
        success: true,
        data: { id: 851842, username: 'zhijun2003', quota, group: 'default' },
      })
    }
    return Response.json({ success: true, data: { items: [] } })
  }) as typeof fetch
  return calls
}

async function readAccountFile(): Promise<string> {
  return await fs.readFile(
    path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json'),
    'utf-8',
  )
}

describe('EchoFlowApiService credentials', () => {
  test('lists tokens with the session cookie and the New-Api-User header', async () => {
    const calls = stubSite()
    const service = new EchoFlowApiService()

    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
    await service.listTokensWithCredential('main')

    const tokenCall = calls.at(-1)
    expect(tokenCall?.url).toBe('https://api.echoflowai.cc/api/token/?p=0&size=100')
    expect(tokenCall?.headers.get('cookie')).toBe('session=live')
    expect(tokenCall?.headers.get('new-api-user')).toBe('851842')
  })

  test('persists only the session metadata, never the site cookie', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })

    const raw = await readAccountFile()
    expect(raw).toContain('"credential": "session"')
    expect(raw).not.toContain('session=live')
  })

  test('marks a session account live only while its credential is held in memory', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
    expect((await service.getAccount('main'))?.live).toBe(true)

    service.clearCredential('main')
    const account = await service.getAccount('main')
    expect(account?.live).toBe(false)
    expect(account?.userId).toBe('851842')
  })

  test('rejects a session credential for the dedicated gateway', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    await expect(
      service.setCredential('dedicated', { kind: 'session', userId: '851842', cookie: 'session=live' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })
})

function stubGateway() {
  const calls: { url: string; headers: Headers }[] = []
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: new Headers(init?.headers) })
    if (url.endsWith('/api/v1/auth/me')) {
      return Response.json({
        data: { id: 7, username: 'gateway-user', quota: 500_000, group: 'default' },
      })
    }
    return Response.json({ success: true, data: { items: [] } })
  }) as typeof fetch
  return calls
}

describe('EchoFlowApiService dedicated bearer accounts', () => {
  test('reads the dedicated account from the gateway with the bearer token', async () => {
    const calls = stubGateway()
    const service = new EchoFlowApiService()

    const account = await service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })

    expect(account).toMatchObject({ userId: '7', username: 'gateway-user', endpoint: 'dedicated', live: true })
    expect(calls.map(call => call.url)).toEqual(['https://expapi.echoflowai.cc/api/v1/auth/me'])
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer eyJhbGciOi.dedicated-token.sig')

    const raw = await readAccountFile()
    expect(raw).toContain('"credential": "bearer"')
    expect(raw).not.toContain('dedicated-token')
  })

  test('refreshes the dedicated account without asking the gateway for tokens', async () => {
    const calls = stubGateway()
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })
    calls.length = 0

    const account = await service.refreshAccount('dedicated')

    expect(account).toMatchObject({ userId: '7', endpoint: 'dedicated', live: true })
    expect(calls.map(call => call.url)).toEqual(['https://expapi.echoflowai.cc/api/v1/auth/me'])
  })

  test('rejects a bearer credential for the main site', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    await expect(
      service.setCredential('main', { kind: 'bearer', userId: '7', accessToken: 'gateway-token' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })
})
