import { WebSocket } from 'ws'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyRegistry } from '@deepseek-ai/dsh-typert-registry/client'
import { apply as applyGateway } from '@deepseek-ai/dsh-api-gateway/client'
import sessionRemote from '@deepseek-ai/dsh-api-session-controller/remote'
import { Context } from '@deepseek-ai/cordis'

function cookieValue(setCookie) {
  return setCookie?.split(';', 1)[0] ?? ''
}

function connectionWebSocket(url, cookie) {
  const socket = new WebSocket(url, { headers: { cookie } })
  return {
    get readyState() { return socket.readyState },
    send(data) { socket.send(data) },
    close(code, reason) { socket.close(code, reason) },
    addEventListener(type, listener) { socket.on(type, listener) },
    removeEventListener(type, listener) { socket.off(type, listener) },
  }
}

export async function connectDshHost({ origin, token }) {
  const connectUrl = new URL('/connect', origin)
  connectUrl.searchParams.set('token', token)
  connectUrl.searchParams.set('interactions', 'answer')
  const response = await fetch(connectUrl, { redirect: 'manual' })
  if (response.status !== 302) throw new Error(`dsh Host connect failed with HTTP ${response.status}`)
  const cookie = cookieValue(response.headers.get('set-cookie'))
  const context = new Context()
  const transport = {
    streamBaseUrl: origin,
    // The browser client sends relative paths (`api/session/list`) and lets the
    // page resolve them; Node's fetch rejects them, so resolve against the Host.
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('cookie', cookie)
      const target = typeof input === 'string' ? new URL(input, `${origin}/`) : input
      return fetch(target, { ...init, headers })
    },
    createWebSocket: url => connectionWebSocket(url, cookie),
  }
  applyRegistry(context)
  installConnection(context, { transport })
  applyGateway(context)
  try {
    // The session namespace is not part of the gateway; mounting the generated
    // contribution is what installs `remote.session` on a Node client.
    await context.remote.$mount(sessionRemote)
  } catch (error) {
    await context.fiber.dispose()
    throw error
  }
  return {
    context,
    connection: context.connection,
    remote: context.remote,
    close: async () => context.fiber.dispose(),
  }
}
