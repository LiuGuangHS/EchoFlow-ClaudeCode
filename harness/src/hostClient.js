import { WebSocket } from 'ws'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyRegistry } from '@deepseek-ai/dsh-typert-registry/client'
import { apply as applyGateway } from '@deepseek-ai/dsh-api-gateway/client'
import sessionRemote from '@deepseek-ai/dsh-api-session-controller/remote'
import { Context } from '@deepseek-ai/cordis'
import { createHostSessions } from './hostSessions.js'

function cookieValue(setCookie) {
  return setCookie?.split(';', 1)[0] ?? ''
}

function connectionWebSocket(url, cookie) {
  const socket = new WebSocket(url, { headers: { cookie } })
  // The gateway reads browser-style events (`event.data` as a string); ws hands
  // `message` listeners a Buffer and an isBinary flag instead.
  const wrapped = new Map()
  return {
    get readyState() { return socket.readyState },
    send(data) { socket.send(data) },
    close(code, reason) { socket.close(code, reason) },
    addEventListener(type, listener, options) {
      const handler = type === 'message'
        ? (data, isBinary) => listener({ data: isBinary ? data : data.toString('utf8') })
        : listener
      wrapped.set(listener, handler)
      if (options?.once === true) socket.once(type, handler)
      else socket.on(type, handler)
    },
    removeEventListener(type, listener) {
      socket.off(type, wrapped.get(listener) ?? listener)
      wrapped.delete(listener)
    },
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
  const sessions = createHostSessions(context.remote)
  return {
    context,
    connection: context.connection,
    remote: context.remote,
    sessions,
    close: async () => {
      sessions.dispose()
      await context.fiber.dispose()
    },
  }
}
