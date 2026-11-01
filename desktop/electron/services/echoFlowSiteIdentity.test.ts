import { describe, expect, it, vi } from 'vitest'
import { parseSiteIdentity, resolveSiteIdentity } from './echoFlowSiteIdentity'

describe('parseSiteIdentity', () => {
  it('normalizes numeric and string ids from the site user record', () => {
    expect(parseSiteIdentity({ id: 106452, username: ' site-user ' }))
      .toEqual({ userId: '106452', username: 'site-user' })
    expect(parseSiteIdentity(JSON.stringify({ id: '106452', username: 'site-user' })))
      .toEqual({ userId: '106452', username: 'site-user' })
    expect(parseSiteIdentity({ user_id: 7, username: 'other-user' }))
      .toEqual({ userId: '7', username: 'other-user' })
  })

  it('rejects records without a positive id or a usable username', () => {
    expect(parseSiteIdentity(null)).toBeNull()
    expect(parseSiteIdentity('not-json')).toBeNull()
    expect(parseSiteIdentity({ id: 0, username: 'site-user' })).toBeNull()
    expect(parseSiteIdentity({ id: -1, username: 'site-user' })).toBeNull()
    expect(parseSiteIdentity({ id: 1, username: '' })).toBeNull()
    expect(parseSiteIdentity({ id: 1, username: 'x'.repeat(129) })).toBeNull()
  })
})

describe('resolveSiteIdentity', () => {
  it('reads the account identity from the site with the session cookie', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { id: 7, username: 'site-user' },
    }), { status: 200 }))

    await expect(resolveSiteIdentity('session=abc', fetchImpl as unknown as typeof fetch))
      .resolves.toEqual({ userId: '7', username: 'site-user' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.echoflowai.cc/api/user/self',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Cookie: 'session=abc' }),
      }),
    )
  })

  it('sends the sign-in console\'s own client headers so the gateway recognises the session', async () => {
    // The gateway picks the tenant from X-Forwarded-Host and binds the session
    // to the client that signed in; a bare cookie comes back as "not signed in".
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { id: 7, username: 'site-user' },
    }), { status: 200 }))

    await resolveSiteIdentity(
      'session=abc',
      fetchImpl as unknown as typeof fetch,
      { userAgent: 'EchoFlowTest/1.0', acceptLanguage: 'zh-CN' },
    )

    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }
    expect(init.headers).toMatchObject({
      Cookie: 'session=abc',
      'X-Forwarded-Host': 'api.echoflowai.cc',
      'Cache-Control': 'no-store',
      'User-Agent': 'EchoFlowTest/1.0',
      'Accept-Language': 'zh-CN',
      Origin: 'https://api.echoflowai.cc',
      Referer: 'https://api.echoflowai.cc/console',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    })
  })

  it('returns null for unauthenticated, failed, or malformed responses', async () => {
    const unauthorized = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      message: 'not signed in',
    }), { status: 401 }))
    await expect(resolveSiteIdentity('session=abc', unauthorized as unknown as typeof fetch)).resolves.toBeNull()

    const failed = vi.fn(async () => new Response('', { status: 500 }))
    await expect(resolveSiteIdentity('session=abc', failed as unknown as typeof fetch)).resolves.toBeNull()

    const malformed = vi.fn(async () => new Response('not-json', { status: 200 }))
    await expect(resolveSiteIdentity('session=abc', malformed as unknown as typeof fetch)).resolves.toBeNull()

    const refused = vi.fn(async () => { throw new Error('offline') })
    await expect(resolveSiteIdentity('session=abc', refused as unknown as typeof fetch)).resolves.toBeNull()
  })

  it('returns null without a cookie instead of asking the site', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'))
    await expect(resolveSiteIdentity('', fetchImpl as unknown as typeof fetch)).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
