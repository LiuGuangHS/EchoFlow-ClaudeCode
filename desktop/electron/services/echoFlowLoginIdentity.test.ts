import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createEchoFlowLoginIdentityReader } from './echoFlowLoginIdentity'

class FakeDebugger extends EventEmitter {
  attached = false
  commands: Array<{ method: string; params?: Record<string, unknown> }> = []
  response = { body: JSON.stringify({ success: true, data: { id: 106452, username: 'site-user' } }), base64Encoded: false }

  attach() { this.attached = true }
  isAttached() { return this.attached }
  detach() { this.attached = false }
  async sendCommand(method: string, params?: Record<string, unknown>) {
    this.commands.push({ method, params })
    return method === 'Network.getResponseBody' ? this.response : undefined
  }

  requestWillBeSent(requestId: string, url: string, method = 'POST') {
    this.emit('message', {}, 'Network.requestWillBeSent', { requestId, request: { url, method } })
  }
  responseReceived(requestId: string, url: string, status = 200, type = 'XHR') {
    this.emit('message', {}, 'Network.responseReceived', { requestId, type, response: { url, status } })
  }
  loadingFinished(requestId: string) {
    this.emit('message', {}, 'Network.loadingFinished', { requestId })
  }
}

describe('EchoFlow login identity reader', () => {
  it('extracts only user id and username from the main-site login response', async () => {
    const debuggerApi = new FakeDebugger()
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 100)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-1', 'https://api.echoflowai.cc/api/user/login')
    debuggerApi.responseReceived('request-1', 'https://api.echoflowai.cc/api/user/login')
    debuggerApi.loadingFinished('request-1')

    await expect(result).resolves.toEqual({ userId: '106452', username: 'site-user' })
    expect(debuggerApi.commands.map(command => command.method)).toContain('Network.getResponseBody')
    reader.dispose()
  })

  it('ignores non-login endpoints and malformed login responses', async () => {
    const debuggerApi = new FakeDebugger()
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 10)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-2', 'https://api.echoflowai.cc/api/user/self')
    debuggerApi.responseReceived('request-2', 'https://api.echoflowai.cc/api/user/self')
    debuggerApi.loadingFinished('request-2')
    await expect(result).rejects.toThrow('EchoFlow login identity unavailable')
    reader.dispose()
  })

  it('ignores login response bodies without a successful stable account id', async () => {
    const debuggerApi = new FakeDebugger()
    debuggerApi.response = { body: JSON.stringify({ success: false, data: { id: 0, username: 'bad' } }), base64Encoded: false }
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 10)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-3', 'https://api.echoflowai.cc/api/user/login')
    debuggerApi.responseReceived('request-3', 'https://api.echoflowai.cc/api/user/login')
    debuggerApi.loadingFinished('request-3')
    await expect(result).rejects.toThrow('EchoFlow login identity unavailable')
    reader.dispose()
  })

  // The live site appends the Cloudflare Turnstile token as a query parameter
  // (turnstile_check is on in /api/status, and the server rejects a login POST
  // without it), so matching the URL by exact string never fires.
  it('matches the login request when the site appends a turnstile query parameter', async () => {
    const debuggerApi = new FakeDebugger()
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 100)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-4', 'https://api.echoflowai.cc/api/user/login?turnstile=0x4AAAA')
    debuggerApi.responseReceived('request-4', 'https://api.echoflowai.cc/api/user/login?turnstile=0x4AAAA')
    debuggerApi.loadingFinished('request-4')

    await expect(result).resolves.toEqual({ userId: '106452', username: 'site-user' })
    reader.dispose()
  })

  it('still ignores a same-origin path that only looks like login', async () => {
    const debuggerApi = new FakeDebugger()
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 10)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-5', 'https://api.echoflowai.cc/api/user/login-evil')
    debuggerApi.responseReceived('request-5', 'https://api.echoflowai.cc/api/user/login-evil')
    debuggerApi.loadingFinished('request-5')
    await expect(result).rejects.toThrow('EchoFlow login identity unavailable')
    reader.dispose()
  })

  // Path must match exactly — a prefix or startsWith check would let these
  // same-origin endpoints through and read their bodies as the login response.
  it('ignores a longer path that has the login path as its prefix', async () => {
    const debuggerApi = new FakeDebugger()
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 10)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-6', 'https://api.echoflowai.cc/api/user/login-history')
    debuggerApi.responseReceived('request-6', 'https://api.echoflowai.cc/api/user/login-history')
    debuggerApi.loadingFinished('request-6')
    await expect(result).rejects.toThrow('EchoFlow login identity unavailable')
    reader.dispose()
  })

  it('ignores the same path on a different origin', async () => {
    const debuggerApi = new FakeDebugger()
    const reader = createEchoFlowLoginIdentityReader(debuggerApi, 10)
    const result = reader.read()
    debuggerApi.requestWillBeSent('request-7', 'https://api.echoflowai.cc.evil.test/api/user/login')
    debuggerApi.responseReceived('request-7', 'https://api.echoflowai.cc.evil.test/api/user/login')
    debuggerApi.loadingFinished('request-7')
    await expect(result).rejects.toThrow('EchoFlow login identity unavailable')
    reader.dispose()
  })
})
