import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  EchoFlowGrokOAuthService,
  getEchoFlowGrokOAuthFilePath,
} from '../services/echoFlowGrokOAuthService.js'
import { SYSTEM_PROXY_URL_ENV } from '../services/networkSettings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let tempDir: string
let previousConfigDir: string | undefined
let previousFetch: typeof globalThis.fetch
let service: EchoFlowGrokOAuthService
const originalSystemProxyUrl = process.env[SYSTEM_PROXY_URL_ENV]
const originalHttpProxy = process.env.HTTP_PROXY
const originalHttpsProxy = process.env.HTTPS_PROXY
const originalLowerHttpProxy = process.env.http_proxy
const originalLowerHttpsProxy = process.env.https_proxy

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-grok-oauth-test-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tempDir
  resetSettingsCache()
  previousFetch = globalThis.fetch
  service = new EchoFlowGrokOAuthService()
})

afterEach(async () => {
  service.dispose()
  globalThis.fetch = previousFetch
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  restoreEnv(SYSTEM_PROXY_URL_ENV, originalSystemProxyUrl)
  restoreEnv('HTTP_PROXY', originalHttpProxy)
  restoreEnv('HTTPS_PROXY', originalHttpsProxy)
  restoreEnv('http_proxy', originalLowerHttpProxy)
  restoreEnv('https_proxy', originalLowerHttpsProxy)
  resetSettingsCache()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('EchoFlowGrokOAuthService', () => {
  test('starts a random 127.0.0.1 PKCE callback and persists exchanged tokens', async () => {
    globalThis.fetch = (async (_input, init) => {
      expect(init?.method).toBe('POST')
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('client_secret')).toBeNull()
      return Response.json({
        access_token: 'grok-access',
        refresh_token: 'grok-refresh',
        expires_in: 3600,
      })
    }) as typeof fetch

    const session = await service.startSession()
    const authorizeUrl = new URL(session.authorizeUrl)
    const redirectUri = new URL(authorizeUrl.searchParams.get('redirect_uri')!)
    expect(redirectUri.hostname).toBe('127.0.0.1')
    expect(Number(redirectUri.port)).toBeGreaterThan(0)
    expect(authorizeUrl.searchParams.get('state')).toBe(session.state)
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')

    const callback = new URL(session.redirectUri)
    callback.searchParams.set('code', 'code')
    callback.searchParams.set('state', session.state)
    const callbackResponse = await previousFetch(callback)
    expect(callbackResponse.status).toBe(200)
    expect(await service.loadTokens()).toMatchObject({
      accessToken: 'grok-access',
      refreshToken: 'grok-refresh',
    })
    if (process.platform !== 'win32') {
      expect((await fs.stat(getEchoFlowGrokOAuthFilePath())).mode & 0o777).toBe(0o600)
    }
  })

  test.each(['sign-out', 'new login'])('discards an exchange superseded by %s', async action => {
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<Response>()
    globalThis.fetch = (async () => {
      started.resolve()
      return finish.promise
    }) as typeof fetch
    const session = await service.startSession()
    const exchange = service.completeSession('fixture-code', session.state)
    await started.promise
    try {
      if (action === 'sign-out') await service.deleteTokens()
      else await service.startSession()
    } finally {
      finish.resolve(Response.json({ access_token: 'discard', refresh_token: 'fixture-refresh', expires_in: 3600 }))
    }
    await expect(exchange).rejects.toThrow('cancelled')
    expect(await service.loadTokens()).toBeNull()
  })

  test('superseding a login during its temporary write keeps the previously committed grant', async () => {
    await service.saveTokens({ accessToken: 'previous', refreshToken: 'refresh', expiresAt: null, email: null })
    globalThis.fetch = (async () => Response.json({ access_token: 'superseded', refresh_token: 'refresh', expires_in: 3600 })) as typeof fetch
    const session = await service.startSession()
    const staged = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const writeFile = fs.writeFile
    const write = spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      await writeFile(...args)
      staged.resolve()
      await release.promise
    })
    const exchange = service.completeSession('fixture-code', session.state)
    try {
      await staged.promise
      await service.startSession()
    } finally {
      write.mockRestore()
      release.resolve()
    }
    await expect(exchange).rejects.toThrow('cancelled')
    expect((await service.loadTokens())?.accessToken).toBe('previous')
  })

  test('refreshes an expiring token and preserves an unrotated refresh token', async () => {
    await service.saveTokens({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1,
      email: 'user@example.com',
    })
    service.setRefreshFn(async () => ({
      access_token: 'new-access',
      expires_in: 3600,
    }))

    await expect(service.ensureFreshTokens()).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'old-refresh',
      email: 'user@example.com',
    })
    await expect(service.loadTokens()).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'old-refresh',
    })
  })

  test('parallel callers rotate the refresh token only once', async () => {
    await service.saveTokens({ accessToken: 'old', refreshToken: 'once', expiresAt: 1, email: null })
    let calls = 0
    service.setRefreshFn(async () => ({ access_token: `rotated-${++calls}`, expires_in: 3600 }))
    const results = await Promise.all([service.ensureFreshTokens(), service.ensureFreshTokens()])
    expect(results.map(tokens => tokens?.accessToken)).toEqual(['rotated-1', 'rotated-1'])
    expect(calls).toBe(1)
  })

  test('a replaced grant survives a late refresh', async () => {
    const grant = { accessToken: 'old', refreshToken: 'once', expiresAt: 1, email: null }
    await service.saveTokens(grant)
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    service.setRefreshFn(async () => {
      started.resolve()
      await finish.promise
      return { access_token: 'discard', expires_in: 3600 }
    })
    const refresh = service.ensureFreshTokens()
    await started.promise
    await service.saveTokens({ ...grant, accessToken: 'replacement' })
    finish.resolve()
    expect(await refresh).toBeNull()
    expect((await service.loadTokens())?.accessToken).toBe('replacement')
  })

  test('does not restore tokens from a refresh that finishes after sign-out', async () => {
    await service.saveTokens({
      accessToken: 'expired',
      refreshToken: 'fixture-refresh',
      expiresAt: Date.now() - 1_000,
      email: null,
    })
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<{ access_token: string; expires_in: number }>()
    service.setRefreshFn(() => {
      started.resolve()
      return finish.promise
    })

    const refresh = service.ensureFreshTokens()
    try {
      await started.promise
      await service.deleteTokens()
    } finally {
      finish.resolve({ access_token: 'discarded', expires_in: 3600 })
    }
    expect(await refresh).toBeNull()
    expect(await service.loadTokens()).toBeNull()
  })

  test('uses direct, system, and manual network settings for token refresh', async () => {
    process.env[SYSTEM_PROXY_URL_ENV] = 'http://127.0.0.1:7897'
    process.env.HTTP_PROXY = 'http://stale-parent.example:8080'
    process.env.HTTPS_PROXY = 'http://stale-parent.example:8080'
    process.env.http_proxy = 'http://stale-parent.example:8080'
    process.env.https_proxy = 'http://stale-parent.example:8080'

    const cases = [
      { mode: 'direct', url: '', expectedProxyUrl: null },
      { mode: 'system', url: '', expectedProxyUrl: 'http://127.0.0.1:7897' },
      { mode: 'manual', url: ' http://127.0.0.1:7890 ', expectedProxyUrl: 'http://127.0.0.1:7890' },
    ] as const

    for (const testCase of cases) {
      await fs.writeFile(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({
          network: {
            aiRequestTimeoutMs: 45_000,
            proxy: { mode: testCase.mode, url: testCase.url },
          },
        }),
        'utf-8',
      )
      resetSettingsCache()
      await service.saveTokens({
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: Date.now() - 1,
        email: 'user@example.com',
      })

      service.setRefreshFn(async (_refreshToken, options) => {
        expect(options?.proxyUrl).toBe(testCase.expectedProxyUrl)
        expect(options?.timeoutMs).toBe(45_000)
        return {
          access_token: 'new-access',
          expires_in: 3600,
        }
      })

      await expect(service.ensureFreshTokens()).resolves.toMatchObject({
        accessToken: 'new-access',
      })
    }
  })
})
