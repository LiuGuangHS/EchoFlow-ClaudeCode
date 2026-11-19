// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const desktop = fileURLToPath(new URL('../../', import.meta.url))
const repository = new URL('../../../', import.meta.url)

// Real handler -> service -> native fetch -> loopback host bridge; only its
// upstream forward is fake. This does not exercise main IPC, Chromium or UI.
// A fresh process keeps storage bindings, credentials and diagnostics isolated.
const contract = `
  const { default: assert } = await import('node:assert/strict')
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { startSiteNetworkBridge } = await import(${JSON.stringify(new URL('desktop/electron/services/siteNetworkBridge.ts', repository).href)})
  const { ECHOFLOW_LOGIN_PROFILES } = await import(${JSON.stringify(new URL('desktop/electron/services/echoFlowLogin.ts', repository).href)})
  const { getEchoFlowInternalDir } = await import(${JSON.stringify(new URL('src/utils/echoFlowConfigRoot.ts', repository).href)})

  const endpoint = process.env.ECHOFLOW_TEST_ENDPOINT
  assert.ok(endpoint === 'main' || endpoint === 'dedicated')
  const profile = ECHOFLOW_LOGIN_PROFILES[endpoint]
  const userId = endpoint === 'main' ? '4101' : '4202'
  const username = 'loopback-' + endpoint
  const secret = 'offline-' + endpoint + '-credential-not-real'
  const credential = endpoint === 'main'
    ? { endpoint, kind: 'session', userId, cookie: 'session=' + secret }
    : { endpoint, kind: 'bearer', userId, accessToken: secret }
  const selfPath = endpoint === 'main' ? '/api/user/self' : '/api/v1/auth/me'
  const listPath = endpoint === 'main' ? '/api/token/?p=0&size=100' : '/api/v1/keys?page=1&page_size=100'
  const calls = []
  let upstreamStatus = 200
  const nativeFetch = globalThis.fetch
  const bridge = await startSiteNetworkBridge({
    token: process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN,
    allowedOrigins: Object.values(ECHOFLOW_LOGIN_PROFILES).map(profile => profile.origin),
    async forward(target, init) {
      calls.push(target)
      assert.equal(init.method, 'GET')
      assert.equal(init.credentials, 'include')
      const headers = new Headers(init.headers)
      assert.equal(headers.get('cookie'), null)
      if (endpoint === 'main') {
        assert.equal(headers.get('new-api-user'), userId)
        assert.equal(headers.get('x-forwarded-host'), new URL(profile.origin).host)
        assert.equal(headers.get('cache-control'), 'no-store')
        assert.equal(headers.get('authorization'), null)
      } else {
        assert.equal(headers.get('authorization'), 'Bearer ' + secret)
      }
      if (target === profile.origin + selfPath) {
        if (upstreamStatus !== 200) {
          return Response.json({ success: false, message: 'fixture gateway status ' + upstreamStatus }, { status: upstreamStatus })
        }
        return Response.json({ success: true, data: { id: Number(userId), username, quota: 1000000, group: 'fixture' } })
      }
      assert.equal(target, profile.origin + listPath)
      return Response.json({ success: true, data: { items: [] } })
    },
  })
  process.env.ECHOFLOW_SITE_NETWORK_BRIDGE_URL = bridge.url

  let route
  let diagnosticsService
  try {
    const { handleEchoFlowApi } = await import(${JSON.stringify(new URL('src/server/api/echoflow.ts', repository).href)})
    ;({ diagnosticsService } = await import(${JSON.stringify(new URL('src/server/services/diagnosticsService.ts', repository).href)}))
    route = async (pathname, method = 'GET', body, token) => {
      const url = new URL(pathname, 'http://127.0.0.1')
      const response = await handleEchoFlowApi(new Request(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-echoflow-site-session-bridge': token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), url, url.pathname.split('/').filter(Boolean))
      const data = await response.json()
      assert.ok(!JSON.stringify(data).includes(secret), 'public response leaked credential')
      return { status: response.status, data }
    }
    const signIn = (token = process.env.ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN) =>
      route('/api/echoflow/account/credential', 'POST', credential, token)
    const refresh = () => route('/api/echoflow/account', 'PUT', { endpoint })
    const account = async () => (await route('/api/echoflow')).data.accounts[endpoint]

    assert.deepEqual(await signIn('wrong-fixture-token'), {
      status: 403, data: { error: 'desktop_bridge_required' },
    })
    assert.deepEqual(calls, [])
    assert.equal(await account(), null)

    const signedIn = await signIn()
    assert.equal(signedIn.status, 200)
    assert.equal(signedIn.data.account.userId, userId)
    assert.equal(signedIn.data.account.username, username)
    assert.equal(signedIn.data.account.endpoint, endpoint)
    assert.equal(signedIn.data.account.live, true)

    // The renderer refreshes again after host authentication; login alone is
    // not evidence that this second account/token-list round trip works.
    const refreshed = await refresh()
    assert.equal(refreshed.status, 200)
    assert.equal(refreshed.data.account.balance, 2)
    assert.equal(refreshed.data.account.userGroup, 'fixture')
    assert.deepEqual(refreshed.data.account.tokens, [])
    assert.deepEqual(await account(), refreshed.data.account)
    assert.deepEqual(calls, [selfPath, selfPath, listPath].map(path => profile.origin + path))

    const accountPath = join(getEchoFlowInternalDir(), 'echoflow-account.json')
    const persisted = await readFile(accountPath, 'utf8')
    assert.ok(!persisted.includes(secret), 'account file leaked credential')
    const stored = JSON.parse(persisted)
    assert.equal(stored.accounts[endpoint].credential, credential.kind)
    assert.equal(stored.accounts[endpoint].userId, userId)
    assert.equal(stored.accounts[endpoint === 'main' ? 'dedicated' : 'main'], null)

    upstreamStatus = 401
    assert.deepEqual(await refresh(), {
      status: 400, data: { error: 'token_invalid', detail: 'fixture gateway status 401' },
    })
    assert.equal((await account()).live, false)
    const callsAfterRejection = calls.length
    assert.deepEqual(await refresh(), { status: 400, data: { error: 'token_invalid' } })
    assert.equal(calls.length, callsAfterRejection, 'rejected credential was reused')

    upstreamStatus = 503
    assert.deepEqual(await signIn(), {
      status: 502, data: { error: 'service_unavailable', detail: 'fixture gateway status 503' },
    })
    assert.equal((await account()).live, false)
    assert.equal(await readFile(accountPath, 'utf8'), persisted, 'failed verification changed stored account')

    upstreamStatus = 200
    assert.equal((await signIn()).status, 200)
    assert.equal((await refresh()).status, 200)
    assert.equal((await account()).live, true)
    assert.deepEqual(calls.slice(3), [selfPath, selfPath, selfPath, selfPath, listPath].map(path => profile.origin + path))
    assert.equal(globalThis.fetch, nativeFetch, 'loopback transport must not be mocked')
  } finally {
    try {
      if (route) {
        const disconnected = await route('/api/echoflow/account', 'DELETE', { endpoint })
        assert.equal(disconnected.status, 200)
      }
    } finally {
      await diagnosticsService?.drainForMigration()
      bridge.close()
    }
  }
`

describe('site login server/host bridge loopback contract (not Electron E2E)', () => {
  it.each(['main', 'dedicated'])('%s credential survives refresh, fails closed and can recover', endpoint => {
    const home = mkdtempSync(join(tmpdir(), 'echoflow-login-loopback-'))
    try {
      execFileSync(process.versions.bun ? process.execPath : 'bun', [
        '--no-env-file',
        '--preload', fileURLToPath(new URL('preload.ts', repository)),
        '--eval', contract,
      ], {
        cwd: desktop,
        env: createSandboxedTestEnvironment(home, {
          ECHOFLOW_TEST_ENDPOINT: endpoint,
          ECHOFLOW_SITE_SESSION_BRIDGE_TOKEN: 'fixture-session-bridge-token',
          ECHOFLOW_SITE_NETWORK_BRIDGE_TOKEN: 'fixture-network-bridge-token',
          // Direct gateway traffic must fail locally, not reach the public site.
          HTTP_PROXY: 'http://127.0.0.1:1',
          HTTPS_PROXY: 'http://127.0.0.1:1',
          ALL_PROXY: 'http://127.0.0.1:1',
          NO_PROXY: '127.0.0.1,localhost',
        }),
        encoding: 'utf8',
        timeout: 15_000,
        stdio: 'pipe',
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 20_000)
})
