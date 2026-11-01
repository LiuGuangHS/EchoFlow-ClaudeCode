import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSiteNetworkBridge, type SiteNetworkBridge, type SiteNetworkFetch } from './siteNetworkBridge'

const TOKEN = 'bridge-token'
const ORIGIN = 'https://api.echoflowai.cc'

let bridge: SiteNetworkBridge | null = null

afterEach(() => {
  bridge?.close()
  bridge = null
})

async function start(forward: SiteNetworkFetch) {
  bridge = await startSiteNetworkBridge({ token: TOKEN, allowedOrigins: [ORIGIN], forward })
  return bridge
}

function post(url: string, body: unknown, token: string | null = TOKEN) {
  return fetch(`${url}/fetch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { 'x-echoflow-site-bridge': token }),
    },
    body: JSON.stringify(body),
  })
}

describe('site network bridge', () => {
  it('forwards a gateway call and hands back the upstream status and body', async () => {
    const forward = vi.fn<SiteNetworkFetch>(async () => new Response('{"success":true}', { status: 200 }))
    const started = await start(forward)

    const response = await post(started.url, {
      url: `${ORIGIN}/api/user/self`,
      method: 'GET',
      headers: { 'New-Api-User': '851842' },
    })

    expect(await response.json()).toEqual({ status: 200, body: '{"success":true}' })
    const [target, init] = forward.mock.calls[0]!
    expect(target).toBe(`${ORIGIN}/api/user/self`)
    expect(init.method).toBe('GET')
    // The sign-in window's own network identity is the point of the bridge.
    expect(init.credentials).toBe('include')
  })

  it('refuses a call without the shared token and never reaches the gateway', async () => {
    const forward = vi.fn<SiteNetworkFetch>(async () => new Response('{}'))
    const started = await start(forward)

    const response = await post(started.url, { url: `${ORIGIN}/api/user/self` }, null)

    expect(response.status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
  })

  it('refuses a host outside the EchoFlow gateways', async () => {
    const forward = vi.fn<SiteNetworkFetch>(async () => new Response('{}'))
    const started = await start(forward)

    const response = await post(started.url, { url: 'https://example.com/steal' })

    expect(response.status).toBe(403)
    expect(forward).not.toHaveBeenCalled()
  })

  it('drops a forwarded Cookie header so the session jar stays the credential', async () => {
    const forward = vi.fn<SiteNetworkFetch>(async () => new Response('{}'))
    const started = await start(forward)

    await post(started.url, {
      url: `${ORIGIN}/api/user/self`,
      headers: { Cookie: 'session=stale', 'New-Api-User': '851842' },
    })

    const headers = forward.mock.calls[0]![1].headers as Headers
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('new-api-user')).toBe('851842')
  })
})
