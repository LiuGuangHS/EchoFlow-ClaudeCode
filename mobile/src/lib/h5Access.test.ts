import { afterEach, describe, expect, test } from 'bun:test'
import {
  H5VerificationError,
  isPlainHttp,
  isPrivateLanHttp,
  normalizeServerUrl,
  verifyH5Connection,
} from './h5Access'

const originalFetch = globalThis.fetch

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return Promise.resolve(handler(url, init))
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('normalizeServerUrl', () => {
  test('trims and removes path query hash and trailing slash', () => {
    expect(normalizeServerUrl('  http://192.168.1.10:3456/chat?x=1#top  ')).toBe('http://192.168.1.10:3456')
  })

  test('rejects empty and non-http urls with typed errors', () => {
    expect(() => normalizeServerUrl('')).toThrow(H5VerificationError)
    expect(() => normalizeServerUrl('ftp://example.com')).toThrow('Server URL must start with http:// or https://.')
  })
})

describe('LAN HTTP helpers', () => {
  test('classifies plain HTTP and private LAN hosts', () => {
    expect(isPlainHttp('http://192.168.1.10:3456')).toBe(true)
    expect(isPlainHttp('https://192.168.1.10:3456')).toBe(false)
    expect(isPrivateLanHttp('http://10.0.0.4')).toBe(true)
    expect(isPrivateLanHttp('http://172.16.0.4')).toBe(true)
    expect(isPrivateLanHttp('http://172.31.0.4')).toBe(true)
    expect(isPrivateLanHttp('http://172.32.0.4')).toBe(false)
    expect(isPrivateLanHttp('http://203.0.113.10')).toBe(false)
  })
})

describe('verifyH5Connection', () => {
  test('rejects a missing H5 token before network requests', async () => {
    let calls = 0
    mockFetch(() => {
      calls += 1
      return Response.json({ status: 'ok' })
    })

    await expect(verifyH5Connection('http://192.168.1.10:3456', '   ')).rejects.toMatchObject({
      code: 'missing-token',
    })
    expect(calls).toBe(0)
  })

  test('reports an unreachable health endpoint', async () => {
    mockFetch(() => {
      throw new Error('network down')
    })

    await expect(verifyH5Connection('http://192.168.1.10:3456', 'h5_test')).rejects.toMatchObject({
      code: 'unreachable',
    })
  })

  test('reports invalid tokens from verify endpoint', async () => {
    mockFetch((url) => {
      if (url.endsWith('/health')) return Response.json({ status: 'ok' })
      return new Response('nope', { status: 401 })
    })

    await expect(verifyH5Connection('http://192.168.1.10:3456', 'h5_bad')).rejects.toMatchObject({
      code: 'invalid-token',
    })
  })

  test('verifies health and bearer token and returns normalized URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    mockFetch((url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/health')) return Response.json({ status: 'ok' })
      return Response.json({ ok: true })
    })

    await expect(verifyH5Connection('http://192.168.1.10:3456/path', ' h5_good ')).resolves.toBe(
      'http://192.168.1.10:3456',
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      url: 'http://192.168.1.10:3456/api/h5-access/verify',
      init: {
        method: 'POST',
        headers: {
          Authorization: 'Bearer h5_good',
          'Content-Type': 'application/json',
        },
      },
    })
  })
})
