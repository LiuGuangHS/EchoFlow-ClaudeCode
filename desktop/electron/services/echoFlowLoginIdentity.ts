export type EchoFlowLoginIdentity = {
  userId: string
  username: string
}

type DebuggerMessageListener = (_event: unknown, method: string, params: unknown) => void
type PendingIdentity = {
  promise: Promise<EchoFlowLoginIdentity>
  resolve: (identity: EchoFlowLoginIdentity) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface EchoFlowLoginDebugger {
  isAttached(): boolean
  attach(version?: string): void
  detach(): void
  on(event: 'message', listener: DebuggerMessageListener): void
  removeListener(event: 'message', listener: DebuggerMessageListener): void
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
}

const LOGIN_URL = 'https://api.echoflowai.cc/api/user/login'
const MAX_LOGIN_RESPONSE_BYTES = 64 * 1024

/** The site appends the Turnstile token as a query parameter, so compare the parsed path. */
function isLoginUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.origin === new URL(LOGIN_URL).origin && url.pathname === new URL(LOGIN_URL).pathname
  } catch {
    return false
  }
}

/** Reads only the identity fields from the site's login response using Electron's host-side CDP. */
export function createEchoFlowLoginIdentityReader(
  debuggerApi: EchoFlowLoginDebugger,
  timeoutMs = 20_000,
) {
  const requests = new Set<string>()
  const successfulResponses = new Set<string>()
  let identity: EchoFlowLoginIdentity | null = null
  let pending: PendingIdentity | null = null
  let disposed = false

  const listener: DebuggerMessageListener = (_event, method, rawParams) => {
    if (disposed || rawParams === null || typeof rawParams !== 'object') return
    const params = rawParams as Record<string, unknown>
    if (method === 'Network.requestWillBeSent') {
      const request = params.request as Record<string, unknown> | undefined
      if (typeof params.requestId === 'string' && request?.method === 'POST' && isLoginUrl(request.url)) {
        requests.add(params.requestId)
      }
      return
    }
    if (method === 'Network.responseReceived') {
      const response = params.response as Record<string, unknown> | undefined
      if (typeof params.requestId === 'string'
        && requests.has(params.requestId)
        && (params.type === 'XHR' || params.type === 'Fetch')
        && response !== undefined
        && isLoginUrl(response.url)
        && typeof response.status === 'number'
        && response.status >= 200 && response.status < 300) {
        successfulResponses.add(params.requestId)
      }
      return
    }
    if (method !== 'Network.loadingFinished' || typeof params.requestId !== 'string') return
    const requestId = params.requestId
    if (!successfulResponses.has(requestId)) return
    requests.delete(requestId)
    successfulResponses.delete(requestId)
    void debuggerApi.sendCommand('Network.getResponseBody', { requestId })
      .then(body => {
        const parsed = loginIdentityFromBody(body)
        if (!parsed || disposed) return
        identity = parsed
        if (pending) {
          clearTimeout(pending.timer)
          pending.resolve(parsed)
          pending = null
        }
      })
      .catch(() => {})
  }

  if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
  debuggerApi.on('message', listener)
  void debuggerApi.sendCommand('Network.enable').catch(() => {})

  return {
    read(): Promise<EchoFlowLoginIdentity> {
      if (identity) return Promise.resolve(identity)
      if (disposed) return Promise.reject(new Error('EchoFlow login identity unavailable'))
      if (pending) return pending.promise
      let resolve!: (identity: EchoFlowLoginIdentity) => void
      let reject!: (error: Error) => void
      const promise = new Promise<EchoFlowLoginIdentity>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      let entry!: PendingIdentity
      const timer = setTimeout(() => {
        if (pending !== entry) return
        pending = null
        reject(new Error('EchoFlow login identity unavailable'))
      }, timeoutMs)
      entry = { promise, resolve, reject, timer }
      pending = entry
      return promise
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      debuggerApi.removeListener('message', listener)
      if (debuggerApi.isAttached()) debuggerApi.detach()
      if (pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('EchoFlow login identity unavailable'))
      }
      pending = null
      requests.clear()
      successfulResponses.clear()
      identity = null
    },
  }
}

function loginIdentityFromBody(raw: unknown): EchoFlowLoginIdentity | null {
  if (raw === null || typeof raw !== 'object') return null
  const response = raw as { body?: unknown; base64Encoded?: unknown }
  if (typeof response.body !== 'string') return null
  let body: string
  try {
    body = response.base64Encoded === true
      ? Buffer.from(response.body, 'base64').toString('utf8')
      : response.body
  } catch {
    return null
  }
  if (Buffer.byteLength(body) > MAX_LOGIN_RESPONSE_BYTES) return null
  try {
    const envelope = JSON.parse(body) as { success?: unknown; data?: { id?: unknown; username?: unknown } }
    const id = envelope.data?.id
    const username = envelope.data?.username
    if (envelope.success !== true
      || !(typeof id === 'number' && Number.isSafeInteger(id) && id > 0 || typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id))
      || typeof username !== 'string' || username.trim() === '' || username.length > 256) return null
    return { userId: String(id), username: username.trim() }
  } catch {
    return null
  }
}
