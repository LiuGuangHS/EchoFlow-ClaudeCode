import { describe, expect, it, mock } from 'bun:test'
import { EchoFlowSiteSession, EchoFlowSiteSessionError } from './echoFlowSiteSession.js'

function response(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('EchoFlowSiteSession', () => {
  it('validates a site cookie against the main-site self endpoint and normalizes the account', async () => {
    const fetcher = mock(async () => response({
      success: true,
      data: { id: 106452, username: 'site-user', quota: 1_000_000 },
    })) as unknown as typeof fetch
    const session = new EchoFlowSiteSession({ fetch: fetcher, now: () => 1234 })

    const account = await session.setSession({ cookie: 'session=opaque-cookie', userId: '106452' })

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.echoflowai.cc/api/user/self')
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('cookie')).toBe('session=opaque-cookie')
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('new-api-user')).toBe('106452')
    expect(account).toEqual({ userId: '106452', username: 'site-user', balance: 2, refreshedAt: 1234 })
    expect(session.getStatus()).toEqual(account)
  })

  it('rejects blank or header-injected cookies before making a request', async () => {
    const fetcher = mock(async () => response({ success: true, data: {} })) as unknown as typeof fetch
    const session = new EchoFlowSiteSession({ fetch: fetcher })

    await expect(session.setSession({ cookie: ' ', userId: '106452' })).rejects.toBeInstanceOf(EchoFlowSiteSessionError)
    await expect(session.setSession({ cookie: 'session=x\r\nAuthorization: Bearer secret', userId: '106452' })).rejects.toBeInstanceOf(EchoFlowSiteSessionError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not establish a session when the site rejects the cookie', async () => {
    const session = new EchoFlowSiteSession({ fetch: mock(async () => response({ success: false, message: '未提供令牌' }, 401)) as unknown as typeof fetch })

    await expect(session.setSession({ cookie: 'session=expired', userId: '106452' })).rejects.toMatchObject({ code: 'session_invalid' })
    expect(session.getStatus()).toBeNull()
  })

  it('rejects malformed or partial user responses instead of inventing identity or balance', async () => {
    const session = new EchoFlowSiteSession({ fetch: mock(async () => response({ success: true, data: { username: 'missing-id' } })) as unknown as typeof fetch })

    await expect(session.setSession({ cookie: 'session=x', userId: '106452' })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(session.getStatus()).toBeNull()
  })

  it('does not establish a session when the account request cannot reach the site', async () => {
    const session = new EchoFlowSiteSession({ fetch: mock(async () => { throw new Error('offline') }) as unknown as typeof fetch })

    await expect(session.setSession({ cookie: 'session=x', userId: '106452' })).rejects.toMatchObject({ code: 'service_unavailable' })
    expect(session.getStatus()).toBeNull()
  })

  it('rejects oversized self responses', async () => {
    const fetcher = mock(async () => new Response(' '.repeat(64 * 1024 + 1))) as unknown as typeof fetch
    const session = new EchoFlowSiteSession({ fetch: fetcher })

    await expect(session.setSession({ cookie: 'session=x', userId: '106452' })).rejects.toMatchObject({ code: 'invalid_response' })
    expect(session.getStatus()).toBeNull()
  })

  it('refreshes with the retained cookie and clears its secret on sign-out', async () => {
    let calls = 0
    const fetcher = mock(async () => {
      calls += 1
      return response({ success: true, data: { id: 106452, username: 'site-user', quota: calls * 500_000 } })
    }) as unknown as typeof fetch
    const session = new EchoFlowSiteSession({ fetch: fetcher, now: () => calls })
    await session.setSession({ cookie: 'session=opaque-cookie', userId: '106452' })
    expect(await session.refresh()).toEqual({ userId: '106452', username: 'site-user', balance: 2, refreshedAt: 2 })

    session.clear()
    expect(session.getStatus()).toBeNull()
    await expect(session.refresh()).rejects.toMatchObject({ code: 'session_invalid' })
  })
})
