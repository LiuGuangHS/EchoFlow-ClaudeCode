import { WebSocket } from 'ws'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyGateway } from '@deepseek-ai/dsh-api-gateway/client'
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
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: { ...(init?.headers ?? {}), cookie },
    }),
    createWebSocket: url => connectionWebSocket(url, cookie),
  }
  installConnection(context, { transport })
  applyGateway(context)
  return {
    context,
    connection: context.connection,
    remote: context.remote,
    close: async () => context.fiber.dispose(),
  }
}
