import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleEchoFlowGrokOAuthApi } from '../api/echoflow-grok-oauth.js'
import { handleApiRequest } from '../router.js'
import { echoFlowGrokOAuthService } from '../services/echoFlowGrokOAuthService.js'

let tempDir: string
let previousConfigDir: string | undefined

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-grok-oauth-api-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tempDir
})

afterEach(async () => {
  echoFlowGrokOAuthService.dispose()
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('EchoFlow Grok OAuth API', () => {
  test('rejects the retired resource route', async () => {
    const legacyUrl = new URL('http://localhost:3456/api/haha-grok-oauth/success')

    const legacy = await handleApiRequest(new Request(legacyUrl), legacyUrl)

    expect(legacy.status).toBe(404)
  })

  test('serves a clear local success page after browser authorization', async () => {
    const response = await handleEchoFlowGrokOAuthApi(
      new Request('http://localhost/api/echoflow-grok-oauth/success'),
      new URL('http://localhost/api/echoflow-grok-oauth/success'),
      ['api', 'echoflow-grok-oauth', 'success'],
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('Grok Login Successful')
    expect(html).toContain('return to EchoFlow Code')
  })

  test('returns status without exposing token material and logs out', async () => {
    await echoFlowGrokOAuthService.saveTokens({
      accessToken: 'secret-access',
      refreshToken: 'secret-refresh',
      expiresAt: Date.now() + 3600_000,
      email: 'user@example.com',
    })
    const statusResponse = await handleEchoFlowGrokOAuthApi(
      new Request('http://localhost/api/echoflow-grok-oauth'),
      new URL('http://localhost/api/echoflow-grok-oauth'),
      ['api', 'echoflow-grok-oauth'],
    )
    const statusText = await statusResponse.text()
    expect(statusText).toContain('user@example.com')
    expect(statusText).not.toContain('secret-access')
    expect(statusText).not.toContain('secret-refresh')

    const logoutResponse = await handleEchoFlowGrokOAuthApi(
      new Request('http://localhost/api/echoflow-grok-oauth', { method: 'DELETE' }),
      new URL('http://localhost/api/echoflow-grok-oauth'),
      ['api', 'echoflow-grok-oauth'],
    )
    expect(logoutResponse.status).toBe(200)
    await expect(echoFlowGrokOAuthService.loadTokens()).resolves.toBeNull()
  })
})
