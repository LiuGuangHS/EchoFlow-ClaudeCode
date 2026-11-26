import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { EchoFlowApiService } from './echoflowApiService.js'
import { diagnosticsService } from './diagnosticsService.js'

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
  test.each([
    new Response('<html>Access denied</html>', { status: 403 }),
    Response.json({ success: false, message: 'token service temporarily unavailable' }),
  ])('preserves a live session on an ambiguous gateway refusal %#', async response => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    globalThis.fetch = mock(async () => response) as typeof fetch
    await expect(service.refreshAccount()).rejects.toMatchObject({ code: 'service_unavailable' })
    expect((await service.getAccount())?.live).toBe(true)
  })

  test('retains the live credential during throttling', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    globalThis.fetch = mock(async () => new Response('', { status: 429 })) as typeof fetch
    await expect(service.refreshAccount()).rejects.toMatchObject({ code: 'service_unavailable', status: 429 })
    expect((await service.getAccount())?.live).toBe(true)
  })

  test.each([
    { schemaVersion: 4, userId: 'legacy-looking', managementToken: 'fixture' },
    { schemaVersion: 3, accounts: { main: { userId: '7', credential: 'future', managementToken: 'fixture' }, dedicated: null } },
    { schemaVersion: 3, accounts: { main: { userId: '7', credential: 'session', tokens: {} }, dedicated: null } },
    { accounts: { future: {} } },
  ])('refuses to overwrite unrecognized account data %#', async (fixture) => {
    const accountPath = path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json')
    await fs.mkdir(path.dirname(accountPath))
    const original = JSON.stringify(fixture)
    await fs.writeFile(accountPath, original)
    await expect(new EchoFlowApiService().disconnectAccount()).rejects.toThrow()
    expect(await readAccountFile()).toBe(original)
  })

  test('preserves a corrupt account file when disconnecting', async () => {
    const accountPath = path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json')
    await fs.mkdir(path.dirname(accountPath))
    await fs.writeFile(accountPath, '{')
    await expect(new EchoFlowApiService().disconnectAccount()).rejects.toThrow()
    expect(await readAccountFile()).toBe('{')
  })

  test('retains version two extension fields during migration and rebinding', async () => {
    const accountPath = path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json')
    await fs.mkdir(path.dirname(accountPath))
    const main = { userId: '851842', managementToken: 'old', extra: 1, tokens: [{ id: '9', name: 'test', note: 2 }] }
    const old = { schemaVersion: 2, extra: 3, accounts: { main, dedicated: null, extra: 4 } }
    await fs.writeFile(accountPath, JSON.stringify(old))
    globalThis.fetch = mock(async (input) => Response.json({ success: true, data: String(input).endsWith('/self') ? {} : [{ id: 9, name: 'test' }] })) as typeof fetch
    const service = new EchoFlowApiService()
    await service.bindAccount('851842', 'new')
    expect(JSON.parse(await readAccountFile())).toMatchObject({ schemaVersion: 3, extra: 3, accounts: { extra: 4, main: { extra: 1, tokens: [{ note: 2 }] } } })
    const backup = (await fs.readdir(path.dirname(accountPath))).find(file => file.includes('.bak-before-migration-'))!
    expect(await fs.readFile(path.join(path.dirname(accountPath), backup), 'utf8')).toBe(JSON.stringify(old))
  })

  test('retains a created key across an account lookup outage without replaying create', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    let posts = 0
    globalThis.fetch = mock(async (_url, init) => {
      if (init?.method !== 'POST') return new Response('', { status: 503 })
      posts++
      return Response.json({ success: true, data: { id: 9, key: 'sk-once' } })
    }) as typeof fetch
    const account = await service.createAccountToken()
    expect(account.refreshedAt).toBeUndefined()
    expect(posts).toBe(1)
    await expect(new EchoFlowApiService().selectAccountToken('main', '9')).resolves.toMatchObject({ key: 'sk-once' })
  })

  test('requires sign-in after a structured 403 even if the reason must be redacted', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    globalThis.fetch = mock(async () => Response.json({ message: 'invalid session: fixture' }, { status: 403 })) as typeof fetch
    await expect(service.refreshAccount()).rejects.toMatchObject({ code: 'token_invalid', detail: undefined })
    expect((await service.getAccount())?.live).toBe(false)
  })

  test('a failed group lookup reports its reason before any create is sent', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', { kind: 'bearer', userId: '7', accessToken: 'fixture' })
    const methods: string[] = []
    globalThis.fetch = mock(async (_url, init) => {
      methods.push(init?.method ?? 'GET')
      return Response.json({ message: 'groups temporarily unavailable' }, { status: 503 })
    }) as typeof fetch
    await expect(service.createAccountToken('dedicated')).rejects.toMatchObject({ code: 'service_unavailable', detail: 'groups temporarily unavailable' })
    expect(methods).toEqual(['GET'])
  })

  test('reports an uncertain create when its successful HTTP reply cannot be read', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    const requests = mock(async () => new Response('{', { status: 200 }))
    globalThis.fetch = requests as typeof fetch
    await expect(service.createAccountToken()).rejects.toMatchObject({ detail: expect.stringContaining('check the gateway token list') })
    expect(requests).toHaveBeenCalledTimes(1)
  })

  test('reports an uncertain create when the gateway loses its reply', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    const lostReply = mock(async () => { throw new Error('connection closed') })
    globalThis.fetch = lostReply as unknown as typeof fetch
    await expect(service.createAccountToken()).rejects.toMatchObject({
      code: 'service_unavailable', detail: expect.stringContaining('check the gateway token list'),
    })
    expect(lostReply).toHaveBeenCalledTimes(1)
    expect((await service.getAccount())?.live).toBe(true)
  })

  test('never writes a create response across an account change by another service', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    const started = Promise.withResolvers<void>()
    const creation = Promise.withResolvers<Response>()
    globalThis.fetch = mock(async (input, init) => {
      if (init?.method === 'POST') { started.resolve(); return creation.promise }
      return Response.json({ success: true, data: String(input).endsWith('/self')
        ? { id: new Headers(init?.headers).get('new-api-user') } : [] })
    }) as typeof fetch
    const result = service.createAccountToken()
    await started.promise
    await new EchoFlowApiService().setCredential('main', { kind: 'session', userId: '8', cookie: 'session=new' })
    creation.resolve(Response.json({ success: true, data: 'sk-old-key' }))
    await expect(result).rejects.toThrow()
    expect((await service.getAccount())?.userId).toBe('8')
    expect(await readAccountFile()).not.toContain('sk-old-key')
  })
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

  test('does not restore a credential whose verification finishes after sign-out', async () => {
    const verification = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async () => {
      started.resolve()
      return verification.promise
    }) as typeof fetch
    const service = new EchoFlowApiService()
    const restoring = service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    await started.promise
    await service.disconnectAccount('main')
    verification.resolve(Response.json({ success: true, data: { id: 851842, username: 'fixture' } }))

    await expect(restoring).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toBeNull()
    await expect(new EchoFlowApiService().getAccount('main')).resolves.toBeNull()
  })

  test('does not restore account metadata from a refresh finishing after sign-out', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    const verification = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/user/self')) {
        started.resolve()
        return verification.promise
      }
      return Response.json({ success: true, data: { items: [] } })
    }) as typeof fetch
    const refreshing = service.refreshAccount('main')
    await started.promise
    await service.disconnectAccount('main')
    verification.resolve(Response.json({ success: true, data: { id: 851842, username: 'fixture' } }))

    await expect(refreshing).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toBeNull()
    await expect(new EchoFlowApiService().getAccount('main')).resolves.toBeNull()
  })

  test('does not replace a newer login with a late restored user', async () => {
    const verification = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).get('cookie') === 'session=old-fixture') {
        started.resolve()
        return verification.promise
      }
      return Response.json({ success: true, data: { id: 8, username: 'new-fixture' } })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    const restoring = service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=old-fixture' })
    await started.promise
    await service.setCredential('main', { kind: 'session', userId: '8', cookie: 'session=new-fixture' })
    verification.resolve(Response.json({ success: true, data: { id: 851842, username: 'old-fixture' } }))

    await expect(restoring).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toMatchObject({ userId: '8', live: true })
    expect(await readAccountFile()).not.toContain('old-fixture')
  })

  test.each(['refreshAccount', 'createAccountToken'] as const)('does not let %s reuse an old credential during a new login', async (operation) => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=old-fixture' })
    const verification = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    const requests = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).get('cookie') === 'session=new-fixture') {
        started.resolve()
        return verification.promise
      }
      return Response.json({ success: false, message: 'invalid session' }, { status: 401 })
    })
    globalThis.fetch = requests as typeof fetch
    const signingIn = service.setCredential('main', { kind: 'session', userId: '8', cookie: 'session=new-fixture' })
    try {
      await started.promise
      await expect(service[operation]('main')).rejects.toMatchObject({ code: 'token_invalid' })
      expect(requests).toHaveBeenCalledTimes(1)
    } finally {
      verification.resolve(Response.json({ success: true, data: { id: 8 } }))
      await signingIn.catch(() => {})
    }
    await expect(signingIn).resolves.toMatchObject({ userId: '8', live: true })
    await expect(service.getAccount('main')).resolves.toMatchObject({ userId: '8', live: true })
  })

  test('keeps a newer login live when an old refresh is rejected', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=old-fixture' })
    const verification = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).get('cookie') === 'session=old-fixture') {
        started.resolve()
        return verification.promise
      }
      return Response.json({ success: true, data: { id: 8, username: 'new-fixture' } })
    }) as typeof fetch
    const refreshing = service.refreshAccount('main')
    await started.promise
    await service.setCredential('main', { kind: 'session', userId: '8', cookie: 'session=new-fixture' })
    verification.resolve(Response.json({ success: false, message: 'invalid session' }, { status: 401 }))

    await expect(refreshing).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toMatchObject({ userId: '8', live: true })
    await expect(new EchoFlowApiService().getAccount('main')).resolves.toMatchObject({ userId: '8', live: false })
  })

  test('does not commit an old refresh whose token list finishes after a newer login', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=old-fixture' })
    const listing = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/api/token/')) {
        expect(new Headers(init?.headers).get('cookie')).toBe('session=old-fixture')
        started.resolve()
        return listing.promise
      }
      const id = new Headers(init?.headers).get('cookie') === 'session=old-fixture' ? 851842 : 8
      return Response.json({ success: true, data: { id } })
    }) as typeof fetch
    const refreshing = service.refreshAccount('main')
    await started.promise
    await service.setCredential('main', { kind: 'session', userId: '8', cookie: 'session=new-fixture' })
    listing.resolve(Response.json({ success: true, data: { items: [{ id: 11, name: 'old-token', key: 'sk-old-fixture' }] } }))

    await expect(refreshing).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toMatchObject({ userId: '8', live: true })
    expect(await readAccountFile()).not.toContain('sk-old-fixture')
  })

  test.each(['clear', 'disconnect'] as const)('invalidates a pending disk commit on %s before renaming it', async (action) => {
    stubSite()
    const service = new EchoFlowApiService()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const accountPath = path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json')
    const writeFile = fs.writeFile
    let gated = false
    const write = spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      await writeFile(...args)
      if (!gated && String(args[0]).startsWith(`${accountPath}.tmp.`)) {
        gated = true
        started.resolve()
        await release.promise
      }
    })
    const rename = spyOn(fs, 'rename')
    const restoring = service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    let disconnecting: Promise<void> | undefined
    try {
      await started.promise
      if (action === 'clear') service.clearCredential('main')
      else disconnecting = service.disconnectAccount('main')
      release.resolve()

      await expect(restoring).rejects.toMatchObject({ code: 'token_invalid' })
      await disconnecting
      // A stale identity must never be renamed into the account file, even
      // temporarily; disconnect may only commit its own null account.
      expect(rename.mock.calls.filter(([, target]) => target === accountPath)).toHaveLength(action === 'clear' ? 0 : 1)
      await expect(service.getAccount('main')).resolves.toBeNull()
      expect((await fs.readdir(path.join(temporaryConfigDir, 'echoflow-code'))).some(name => name.includes('.tmp.'))).toBe(false)
    } finally {
      release.resolve()
      await Promise.allSettled([restoring, disconnecting])
      write.mockRestore()
      rename.mockRestore()
    }
  })

  test('does not publish a credential on disk failure and allows the next commit', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    const accountPath = path.join(temporaryConfigDir, 'echoflow-code', 'echoflow-account.json')
    const renameFile = fs.rename
    let failed = false
    const rename = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!failed && to === accountPath) {
        failed = true
        throw new Error('fixture disk failure')
      }
      await renameFile(from, to)
    })
    try {
      await expect(service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' }))
        .rejects.toThrow('fixture disk failure')
      await expect(service.listTokensWithCredential('main')).rejects.toMatchObject({ code: 'token_invalid' })
      await expect(service.getAccount('main')).resolves.toBeNull()

      await expect(service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=retry-fixture' }))
        .resolves.toMatchObject({ userId: '851842', live: true })
    } finally {
      rename.mockRestore()
    }
  })

  test('retains both endpoints when their account writes overlap', async () => {
    const mainVerification = Promise.withResolvers<Response>()
    const dedicatedVerification = Promise.withResolvers<Response>()
    globalThis.fetch = mock(async (input: string | URL | Request) => String(input).includes('expapi.')
      ? dedicatedVerification.promise
      : mainVerification.promise) as typeof fetch
    const service = new EchoFlowApiService()
    const main = service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    const dedicated = service.setCredential('dedicated', { kind: 'bearer', userId: '7', accessToken: 'bearer-fixture' })
    mainVerification.resolve(Response.json({ success: true, data: { id: 851842 } }))
    dedicatedVerification.resolve(Response.json({ data: { id: 7 } }))
    await Promise.all([main, dedicated])

    await expect(service.getAccounts()).resolves.toMatchObject({
      main: { userId: '851842', live: true },
      dedicated: { userId: '7', live: true },
    })
    await expect(new EchoFlowApiService().getAccounts()).resolves.toMatchObject({
      main: { userId: '851842', live: false },
      dedicated: { userId: '7', live: false },
    })
    const raw = await readAccountFile()
    expect(raw).not.toContain('session=fixture')
    expect(raw).not.toContain('bearer-fixture')
  })

  test('does not bind a management-token account whose list finishes after sign-out', async () => {
    const listing = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/user/self')) return Response.json({ success: true, data: { id: 7 } })
      started.resolve()
      return listing.promise
    }) as typeof fetch
    const service = new EchoFlowApiService()
    const binding = service.bindAccount('7', 'management-fixture')
    await started.promise
    await service.disconnectAccount('main')
    listing.resolve(Response.json({ success: true, data: { items: [] } }))

    await expect(binding).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(new EchoFlowApiService().getAccount('main')).resolves.toBeNull()
    expect(await readAccountFile()).not.toContain('management-fixture')
  })

  test('uses the bound management token instead of the previous live session', async () => {
    const calls = stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=fixture' })
    await service.bindAccount(' 8 ', ' management-fixture ')
    await service.refreshAccount('main')

    expect(calls.at(-1)?.headers.get('authorization')).toBe('management-fixture')
    expect(calls.at(-1)?.headers.get('cookie')).toBeNull()
    await expect(new EchoFlowApiService().getAccount('main')).resolves.toMatchObject({ userId: '8', live: true })
  })

  test('does not attach a late created key to a newer login', async () => {
    stubSite()
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=old-fixture' })
    const creation = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        started.resolve()
        return creation.promise
      }
      return Response.json({ success: true, data: { id: 8 } })
    }) as typeof fetch
    const creating = service.createAccountToken('main')
    await started.promise
    await service.setCredential('main', { kind: 'session', userId: '8', cookie: 'session=new-fixture' })
    creation.resolve(Response.json({ success: true, data: 'sk-old-created-fixture' }))

    await expect(creating).rejects.toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toMatchObject({ userId: '8', live: true })
    expect(await readAccountFile()).not.toContain('sk-old-created-fixture')
  })

  test('rejects a restored session whose cookie belongs to another user', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    const error = await service
      .setCredential('main', { kind: 'session', userId: '999', cookie: 'session=other-user' })
      .catch((thrown: unknown) => thrown)

    expect(error).toMatchObject({ code: 'token_invalid' })
    await expect(service.getAccount('main')).resolves.toBeNull()
  })

  test('keeps the last known balance when the same site session is restored', async () => {
    stubSite(1_000_000)
    const first = new EchoFlowApiService()
    await first.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
    await first.refreshAccount('main')

    // A restart holds no credential until the restore replays it; the record
    // it walks past still owns the balance the UI showed before the restart.
    await new EchoFlowApiService()
      .setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })

    await expect(new EchoFlowApiService().getAccount('main')).resolves.toMatchObject({ balance: 2 })
  })

  test('drops the saved balance when a different site user is restored', async () => {
    stubSite(1_000_000)
    const first = new EchoFlowApiService()
    await first.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
    await first.refreshAccount('main')

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { id: 8, username: 'other', quota: 500_000, group: 'default' } })
      }
      return Response.json({ success: true, data: { items: [] } })
    }) as typeof fetch
    await new EchoFlowApiService()
      .setCredential('main', { kind: 'session', userId: '8', cookie: 'session=other-user' })

    const account = await new EchoFlowApiService().getAccount('main')
    expect(account?.balance).toBeUndefined()
  })

  test('rejects a session the gateway cannot attribute to an account', async () => {
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { quota: 500_000, group: 'default', username: 'no-id' } })
      }
      return Response.json({ success: true, data: { items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()

    const error = await service
      .setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })
      .catch((thrown: unknown) => thrown)

    expect(error).toMatchObject({ code: 'token_invalid' })
  })

  test('accepts the site user id under either field name', async () => {
    globalThis.fetch = mock(async () => Response.json({
      success: true,
      data: { user_id: 851842, quota: 500_000, group: 'default', username: 'echo' },
    })) as typeof fetch
    const service = new EchoFlowApiService()

    await expect(service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' }))
      .resolves.toMatchObject({ userId: '851842' })
  })

  test('sends the tenant headers the site console sends with a session credential', async () => {
    const calls = stubSite()
    const service = new EchoFlowApiService()

    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })

    const self = calls.find((call) => call.url.endsWith('/api/user/self'))
    expect(self?.headers.get('x-forwarded-host')).toBe('api.echoflowai.cc')
    expect(self?.headers.get('cache-control')).toBe('no-store')
  })

  test('replays the sign-in window fingerprint so the gateway recognises the session', async () => {
    const calls = stubSite()
    const service = new EchoFlowApiService()
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/134.0.0.0 Safari/537.36 EchoFlow Code/0.7.2'

    await service.setCredential('main', {
      kind: 'session',
      userId: '851842',
      cookie: 'session=live',
      browser: { userAgent, acceptLanguage: 'zh-CN' },
    })

    const self = calls.find((call) => call.url.endsWith('/api/user/self'))
    // Without these the gateway answers "Session network fingerprint changed".
    expect(self?.headers.get('user-agent')).toBe(userAgent)
    expect(self?.headers.get('accept-language')).toBe('zh-CN')
    expect(self?.headers.get('origin')).toBe('https://api.echoflowai.cc')
    expect(self?.headers.get('sec-fetch-site')).toBe('same-origin')
    // The cookie is still the credential; the browser identity rides along.
    expect(self?.headers.get('cookie')).toBe('session=live')
  })

  test('keeps the upstream rejection message instead of throwing it away', async () => {
    globalThis.fetch = mock(async () => Response.json(
      { success: false, message: '无权进行此操作，未登录且未提供 access token' },
      { status: 401 },
    )) as typeof fetch
    const service = new EchoFlowApiService()

    await expect(
      service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' }),
    ).rejects.toMatchObject({
      code: 'token_invalid',
      status: 401,
      detail: '无权进行此操作，未登录且未提供 access token',
    })
  })

  test('records typed gateway failure metadata without response content', async () => {
    const record = spyOn(diagnosticsService, 'recordEvent').mockResolvedValue({ ok: true })
    let selfCalls = 0
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/user/self') && selfCalls++ === 0) {
        return Response.json({ success: true, data: { id: '851842', quota: 1_000_000 } })
      }
      return new Response('<html>PRIVATE_GATEWAY_BODY</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch
    const service = new EchoFlowApiService()

    try {
      await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=private' })
      await expect(service.refreshAccount('main')).rejects.toMatchObject({
        code: 'service_unavailable',
        status: 502,
      })
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        type: 'echoflow_gateway_request_failed',
        severity: 'warn',
        details: expect.objectContaining({
          endpoint: 'main',
          credentialKind: 'session',
          method: 'GET',
          transport: 'direct',
          errorCode: 'service_unavailable',
          status: 502,
        }),
      }))
      expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE_GATEWAY_BODY')
    } finally {
      record.mockRestore()
    }
  })

  test('creates a call token with the site defaults and lists it afterwards', async () => {
    const calls: { url: string; body: string | undefined }[] = []
    let created = false
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
      if (url.endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { id: 851842, username: 'zhijun2003', quota: 1_000_000 } })
      }
      if (url.endsWith('/api/token/') && init?.method === 'POST') {
        created = true
        return Response.json({ success: true, message: '', data: 'sk-created' })
      }
      return Response.json({
        success: true,
        data: { items: created ? [{ id: 9, name: 'echoflow-code', key: 'sk-created', status: 'enabled' }] : [] },
      })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })

    const account = await service.createAccountToken('main', 'echoflow-code')

    const post = calls.find((call) => call.url.endsWith('/api/token/') && call.body)
    expect(post && JSON.parse(post.body!)).toEqual({
      name: 'echoflow-code',
      expired_time: -1,
      remain_quota: 0,
      unlimited_quota: true,
      model_limits_enabled: false,
      model_limits: '',
      // The gateway rejects a create with "At least one group must be
      // selected when smart routing is disabled"; the site console's own
      // default form answers with smart routing on.
      routing_priority: 'auto',
    })
    expect(account.tokens?.map((token) => token.name)).toEqual(['echoflow-code'])
  })

  test('surfaces the gateway refusal message instead of a bare invalid_response', async () => {
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { id: 851842, username: 'zhijun2003', quota: 1_000_000 } })
      }
      if (url.endsWith('/api/token/') && init?.method === 'POST') {
        return Response.json({
          success: false,
          message: 'At least one group must be selected when smart routing is disabled',
        })
      }
      return Response.json({ success: true, data: { items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })

    await expect(service.createAccountToken('main', 'echoflow-code')).rejects.toMatchObject({
      code: 'invalid_response',
      detail: 'At least one group must be selected when smart routing is disabled',
    })
  })

  test('rejects a session credential for the dedicated gateway', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    await expect(
      service.setCredential('dedicated', { kind: 'session', userId: '851842', cookie: 'session=live' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })
})

describe('EchoFlowApiService site network bridge', () => {
  const previousUrl = process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_URL
  const previousToken = process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN

  beforeEach(() => {
    process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_URL = 'http://127.0.0.1:4567'
    process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN = 'bridge-token'
  })

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_URL
    else process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_URL = previousUrl
    if (previousToken === undefined) delete process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN
    else process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN = previousToken
  })

  function stubBridge(relay: { status: number; body: string }) {
    const calls: { url: string; authorization: string | null; payload: Record<string, unknown> }[] = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('x-echoflow-site-bridge'),
        payload: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {},
      })
      return Response.json(relay)
    }) as typeof fetch
    return calls
  }

  test('relays a session call through Chromium instead of calling the gateway from Bun', async () => {
    const calls = stubBridge({ status: 200, body: '{"success":true,"data":{"id":851842,"username":"zhijun2003"}}' })
    const service = new EchoFlowApiService()

    await service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://127.0.0.1:4567/fetch')
    expect(calls[0]?.authorization).toBe('bridge-token')
    expect(calls[0]?.payload).toEqual({
      url: 'https://api.echoflowai.cc/api/user/self',
      method: 'GET',
      headers: { 'New-Api-User': '851842', 'X-Forwarded-Host': 'api.echoflowai.cc', 'Cache-Control': 'no-store' },
    })
    // The partition's cookie jar is the credential; sending it here would
    // override the browser's own cookies.
    expect(JSON.stringify(calls[0]?.payload)).not.toContain('session=live')
  })

  test.each([408, 429, 0])('retains the session when the relay reports status %i', async (status) => {
    stubBridge({ status: 200, body: '{"success":true,"data":{"id":7}}' })
    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'session', userId: '7', cookie: 'session=fixture' })
    stubBridge({ status, body: '' })
    await expect(service.refreshAccount()).rejects.toMatchObject({ code: 'service_unavailable' })
    expect((await service.getAccount())?.live).toBe(true)
  })

  test('keeps the gateway reason when the relayed call is refused', async () => {
    stubBridge({ status: 401, body: '{"error":{"message":"Session network fingerprint changed, please login again"}}' })
    const service = new EchoFlowApiService()

    await expect(
      service.setCredential('main', { kind: 'session', userId: '851842', cookie: 'session=live' }),
    ).rejects.toMatchObject({
      code: 'token_invalid',
      status: 401,
      detail: 'Session network fingerprint changed, please login again',
    })
  })

  test('relays the dedicated bearer through Chromium just like the sign-in page', async () => {
    const calls = stubBridge({ status: 200, body: '{"data":{"id":7,"username":"gateway-user","quota":500000}}' })
    const service = new EchoFlowApiService()

    await service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://127.0.0.1:4567/fetch')
    expect(calls[0]?.payload).toMatchObject({
      url: 'https://expapi.echoflowai.cc/api/v1/auth/me',
      method: 'GET',
    })
  })

  test('leaves management-token credentials on the direct path', async () => {
    const calls = stubBridge({ status: 200, body: '{"success":true,"data":{"id":1}}' })
    const service = new EchoFlowApiService()

    await service.listTokens('851842', 'management-token')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.echoflowai.cc/api/token/?p=0&size=100')
    expect(calls[0]?.authorization).toBeNull()
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

  test('lists call tokens from the dedicated keys endpoint on refresh', async () => {
    // The dedicated gateway does have a call-token list — under /api/v1/keys,
    // not the main site's /api/token/. This test replaces the old one that
    // asserted "no token list", which is what made create look successful
    // while the UI showed an empty token list.
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
    expect(calls.map(call => call.url)).toEqual([
      'https://expapi.echoflowai.cc/api/v1/auth/me',
      'https://expapi.echoflowai.cc/api/v1/keys?page=1&page_size=100',
    ])
  })

  test('keeps the dedicated create key when the list omits it', async () => {
    let created = false
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/v1/auth/me')) return Response.json({ data: { id: 7, username: 'gateway-user', quota: 500_000 } })
      if (url.endsWith('/api/v1/groups/available')) return Response.json({ data: [{ id: 3, name: 'default' }] })
      if (url.endsWith('/api/v1/keys') && method === 'POST') {
        created = true
        return Response.json({ data: { id: 11, name: 'echoflow-code', key: 'sk-dedicated-created' } })
      }
      if (url.includes('/api/v1/keys?')) return Response.json({ data: { items: created ? [{ id: 11, name: 'echoflow-code' }] : [] } })
      return Response.json({ data: {} })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', { kind: 'bearer', userId: '7', accessToken: 'dedicated-token' })

    await service.createAccountToken('dedicated')

    await expect(service.selectAccountToken('dedicated', '11')).resolves.toMatchObject({
      key: 'sk-dedicated-created',
    })
  })

  test('creates a dedicated call token at the keys endpoint with a group', async () => {
    // sub2api's key resource lives at /api/v1/keys and rejects a create
    // without a group_id; /api/token/ is a 404 there.
    const calls: { url: string; method: string; body: unknown }[] = []
    let created = false
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({ data: { id: 7, username: 'gateway-user', quota: 500_000 } })
      }
      if (url.endsWith('/api/v1/groups/available')) {
        return Response.json({ data: [{ id: 3, name: 'default' }] })
      }
      if (url.endsWith('/api/v1/keys') && method === 'POST') {
        created = true
        return Response.json({ data: { id: 11, name: 'echoflow-code', key: 'sk-dedicated' } })
      }
      if (url.includes('/api/v1/keys?')) {
        return Response.json({
          data: {
            items: created ? [{ id: 11, name: 'echoflow-code', key: 'sk-dedicated', status: 'active' }] : [],
            total: created ? 1 : 0,
            pages: 1,
          },
        })
      }
      return Response.json({ data: {} })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })

    const account = await service.createAccountToken('dedicated', 'echoflow-code')

    const post = calls.find((call) => call.url.endsWith('/api/v1/keys') && call.method === 'POST')
    expect(post && post.body).toEqual({ name: 'echoflow-code', group_id: 3 })
    expect(account.tokens?.map((token) => token.name)).toEqual(['echoflow-code'])
  })

  test('rejects a bearer credential for the main site', async () => {
    stubSite()
    const service = new EchoFlowApiService()

    await expect(
      service.setCredential('main', { kind: 'bearer', userId: '7', accessToken: 'gateway-token' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })

  test('rejects a dedicated 200 refusal envelope instead of creating a live account', async () => {
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/auth/me')) {
        return Response.json({ success: false, message: 'sign-in required' })
      }
      return Response.json({ data: { items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()

    await expect(service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })).rejects.toMatchObject({
      code: 'service_unavailable',
      detail: 'sign-in required',
    })
  })
})

describe('EchoFlowApiService route selection', () => {
  // A route belongs to the gateway, not to the credential. Keying the paths on
  // `credential.kind` sent a management token bound to the dedicated gateway to
  // `/api/user/self` and `/api/token/`, which 404 there.
  test('sends a dedicated management token down the dedicated account routes', async () => {
    // Accepts either gateway's envelope so this test asserts routing only.
    const calls: string[] = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      return Response.json({ success: true, data: { id: 7, username: 'gateway-user', quota: 500_000, items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()

    await service.setCredential('dedicated', {
      kind: 'token',
      userId: '7',
      managementToken: 'eyJhbGciOi.dedicated-token.sig',
    })

    expect(calls).toEqual([
      'GET https://expapi.echoflowai.cc/api/v1/auth/me',
      'GET https://expapi.echoflowai.cc/api/v1/keys?page=1&page_size=100',
    ])
  })

  test('creates a dedicated call token for a management-token credential too', async () => {
    const calls: string[] = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${String(input)}`)
      if (String(input).endsWith('/api/v1/auth/me')) {
        return Response.json({ data: { id: 7, username: 'gateway-user', quota: 500_000 } })
      }
      if (String(input).endsWith('/api/v1/groups/available')) {
        return Response.json({ data: [{ id: 3, name: 'default' }] })
      }
      return Response.json({ data: { items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', {
      kind: 'token',
      userId: '7',
      managementToken: 'eyJhbGciOi.dedicated-token.sig',
    })
    calls.length = 0

    await service.createAccountToken('dedicated').catch(() => {})

    expect(calls.some((call) => call.includes('/api/token/'))).toBe(false)
    expect(calls).toContain('POST https://expapi.echoflowai.cc/api/v1/keys')
  })

  test('keeps the gateway reason when the group list is refused', async () => {
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({ data: { id: 7, username: 'gateway-user', quota: 500_000 } })
      }
      if (url.endsWith('/api/v1/groups/available')) {
        return Response.json({ success: false, message: 'sign-in required' })
      }
      return Response.json({ data: { items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })

    await expect(service.createAccountToken('dedicated')).rejects.toMatchObject({
      code: 'invalid_response',
      detail: 'sign-in required',
    })
  })

  test('says the created token never showed up in the gateway list', async () => {
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({ data: { id: 7, username: 'gateway-user', quota: 500_000 } })
      }
      if (url.endsWith('/api/v1/groups/available')) {
        return Response.json({ data: [{ id: 3, name: 'default' }] })
      }
      if (url.endsWith('/api/v1/keys') && method === 'POST') {
        return Response.json({ data: { id: 11, name: 'echoflow-code' } })
      }
      return Response.json({ data: { items: [] } })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', {
      kind: 'bearer',
      userId: '7',
      accessToken: 'eyJhbGciOi.dedicated-token.sig',
    })

    const error = await service.createAccountToken('dedicated').catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ code: 'invalid_response' })
    expect(String((error as { detail?: string }).detail)).toContain('not present')
  })

  test('surfaces the gateway refusal when the token list is refused', async () => {
    globalThis.fetch = mock(async () => Response.json({ success: false, message: 'sign-in required' })) as typeof fetch
    const service = new EchoFlowApiService()

    await expect(service.listTokens('7', 'eyJhbGciOi.dedicated-token.sig')).rejects.toMatchObject({
      code: 'invalid_response',
      detail: 'sign-in required',
    })
  })
})

describe('EchoFlowApiService list pagination', () => {
  // Each gateway numbers its own list pages. The main console's own first call
  // is `/api/token/?p=0`; the dedicated one starts at `page=1`.
  test('reads the main call-token list starting at page zero', async () => {
    const urls: string[] = []
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      urls.push(String(input))
      return Response.json({ success: true, data: { items: [] } })
    }) as typeof fetch

    await new EchoFlowApiService().listTokens('7', 'eyJhbGciOi.dedicated-token.sig')

    expect(urls[0]).toBe('https://api.echoflowai.cc/api/token/?p=0&size=100')
  })

  test('reads the dedicated call-token list starting at page one', async () => {
    const urls: string[] = []
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      urls.push(String(input))
      return Response.json({ success: true, data: { items: [] } })
    }) as typeof fetch

    await new EchoFlowApiService().listTokens('7', 'eyJhbGciOi.dedicated-token.sig', 'dedicated')

    expect(urls[0]).toBe('https://expapi.echoflowai.cc/api/v1/keys?page=1&page_size=100')
  })

  // A refused page with no reason is still a refusal, not an empty list.
  test('throws when a list page is refused without a reason', async () => {
    globalThis.fetch = mock(async () => Response.json({ success: false })) as typeof fetch

    await expect(new EchoFlowApiService().listTokens('7', 'eyJhbGciOi.dedicated-token.sig')).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
})

describe('EchoFlowApiService call token visibility', () => {
  // The gateway hands the key out once, at create time. Its token list carries
  // the name and id but no key, so a list entry has to survive without one —
  // dropping it made every list look empty and the account read "no tokens".
  test('keeps a listed call token that carries no key', async () => {
    globalThis.fetch = mock(async () => Response.json({
      success: true,
      data: { items: [{ id: 11, name: 'echoflow-code' }] },
    })) as typeof fetch

    const tokens = await new EchoFlowApiService().listTokens('7', 'eyJhbGciOi.dedicated-token.sig')

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ id: '11', name: 'echoflow-code' })
    expect(tokens[0]?.key).toBeUndefined()
  })

  test('does not expose a fake preview for a keyless listed token', async () => {
    globalThis.fetch = mock(async () => Response.json({
      success: true,
      data: { items: [{ id: 11, name: 'echoflow-code' }] },
    })) as typeof fetch

    const service = new EchoFlowApiService()
    await service.setCredential('dedicated', {
      kind: 'token', userId: '7', managementToken: 'dedicated-token',
    })
    const account = await service.refreshAccount('dedicated')

    expect(account.tokens?.[0]?.keyPreview).toBe('')
  })

  test('keeps the key the gateway hands out at create time', async () => {
    const created = 'sk-live-key'
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { quota: 500_000, group: 'default', username: 'echo' } })
      }
      if (url.endsWith('/api/token/') && method === 'POST') {
        return Response.json({ success: true, data: created })
      }
      return Response.json({ success: true, data: { items: [{ id: 11, name: 'echoflow-code' }] } })
    }) as typeof fetch

    const service = new EchoFlowApiService()
    await service.setCredential('main', { kind: 'token', userId: '7', managementToken: 'eyJhbGciOi.dedicated-token.sig' })

    const account = await service.createAccountToken('main')

    // The key never leaves the server (the public account only carries a
    // preview), but it has to be stored so a provider can use the token.
    expect(account.tokens).toEqual([expect.objectContaining({ name: 'echoflow-code' })])
    expect(account.tokens?.[0]).not.toHaveProperty('key')
    await expect(service.selectAccountToken('main', '11')).resolves.toMatchObject({ name: 'echoflow-code', key: created })
  })
})

describe('EchoFlowApiService token key lifecycle', () => {
  const credential = { kind: 'token' as const, userId: '7', managementToken: 'eyJhbGciOi.dedicated-token.sig' }

  function tokenGateway(listed: () => unknown[], created: () => string) {
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/user/self')) {
        const userId = new Headers(init?.headers).get('new-api-user')
        return Response.json({
          success: true,
          data: { ...(userId ? { id: userId } : {}), quota: 500_000, group: 'default', username: 'echo' },
        })
      }
      if (url.endsWith('/api/token/') && method === 'POST') {
        return Response.json({ success: true, data: created() })
      }
      return Response.json({ success: true, data: { items: listed() } })
    }) as typeof fetch
  }

  test('refuses a listed token the gateway never keyed instead of sending sk-', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-unused')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)

    const error = await service.selectAccountToken('main', '11').catch((thrown: unknown) => thrown)

    expect(error).toMatchObject({ code: 'token_invalid' })
    expect(String((error as { detail?: string }).detail)).toContain('create a new token')
  })

  test('keeps a stored key when re-signing in refreshes the keyless gateway list', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-live-key')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    await service.setCredential('main', credential)

    await expect(service.selectAccountToken('main', '11')).resolves.toMatchObject({ key: 'sk-live-key' })
  })

  test('keeps a stored key when a management token is bound again', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-live-key')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    await service.bindAccount('7', 'eyJhbGciOi.dedicated-token.sig', 'main')

    await expect(service.selectAccountToken('main', '11')).resolves.toMatchObject({ key: 'sk-live-key' })
  })

  test('does not carry one account user’s token key into another user’s list', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-user-a')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    await service.setCredential('main', { ...credential, userId: '8' })

    await expect(service.selectAccountToken('main', '11')).rejects.toMatchObject({ code: 'token_invalid' })
  })

  test('keeps a stored key when the same site session is restored', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-live-key')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    await service.setCredential('main', { kind: 'session', userId: '7', cookie: 'session=live' })

    await expect(service.selectAccountToken('main', '11')).resolves.toMatchObject({ key: 'sk-live-key' })
  })

  test('drops the saved key when a different site user is restored', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-user-a')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    await service.setCredential('main', { kind: 'session', userId: '8', cookie: 'session=other' })

    await expect(service.selectAccountToken('main', '11')).rejects.toMatchObject({ code: 'token_invalid' })
  })

  test('creates a token from the stored management token after a restart', async () => {
    tokenGateway(() => [{ id: 11, name: 'echoflow-code' }], () => 'sk-after-restart')
    const before = new EchoFlowApiService()
    await before.setCredential('main', credential)

    const after = new EchoFlowApiService()

    const account = await after.createAccountToken('main')

    expect(account.tokens?.some((token) => token.name === 'echoflow-code')).toBe(true)
    await expect(after.selectAccountToken('main', '11')).resolves.toMatchObject({ key: 'sk-after-restart' })
  })

  test('keeps the created key when the token list fails right after create', async () => {
    let lists = 0
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return Response.json({ success: true, data: { quota: 500_000, group: 'default', username: 'echo' } })
      }
      if (url.includes('/api/token/') && (init?.method ?? 'GET') === 'POST') {
        return Response.json({ success: true, data: 'sk-one-shot' })
      }
      lists += 1
      if (lists === 1) return Response.json({ success: true, data: { items: [] } })
      return Response.json({ success: false, message: 'list unavailable' }, { status: 503 })
    }) as typeof fetch
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)

    const account = await service.createAccountToken('main')

    expect(account.tokens?.some((token) => token.name === 'echoflow-code')).toBe(true)
    await expect(service.selectAccountToken('main', 'created:echoflow-code')).resolves.toMatchObject({ key: 'sk-one-shot' })
  })

  test('reattaches a synthetic created token when its real id appears later', async () => {
    let listed: unknown[] = []
    tokenGateway(() => listed, () => 'sk-late-listed')
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    listed = [{ id: 12, name: 'echoflow-code' }]
    await service.refreshAccount('main')

    await expect(service.selectAccountToken('main', '12')).resolves.toMatchObject({ key: 'sk-late-listed' })
  })

  test('does not move a newly created key onto an older same-named token', async () => {
    const listed = [{ id: 11, name: 'echoflow-code' }]
    let created = 'sk-first'
    tokenGateway(() => listed, () => created)
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    // The gateway now has a second token, but its list still shows only the
    // older one — the new key must not overwrite the older token's key.
    created = 'sk-second'
    const account = await service.createAccountToken('main')

    await expect(service.selectAccountToken('main', '11')).resolves.toMatchObject({ key: 'sk-first' })
    expect(account.tokens?.some((token) => token.id === 'created:echoflow-code')).toBe(true)
    await expect(service.selectAccountToken('main', 'created:echoflow-code')).resolves.toMatchObject({ key: 'sk-second' })
  })

  test('does not overwrite an existing same-named token with a newly created key', async () => {
    let listed = [{ id: 11, name: 'echoflow-code' }]
    let created = 'sk-first'
    tokenGateway(() => listed, () => created)
    const service = new EchoFlowApiService()
    await service.setCredential('main', credential)
    await service.createAccountToken('main')

    listed = [{ id: 11, name: 'echoflow-code' }, { id: 12, name: 'echoflow-code' }]
    created = 'sk-second'
    await service.createAccountToken('main')

    await expect(service.selectAccountToken('main', '11')).resolves.toMatchObject({ key: 'sk-first' })
    await expect(service.selectAccountToken('main', '12')).rejects.toMatchObject({ code: 'token_invalid' })
  })
})
