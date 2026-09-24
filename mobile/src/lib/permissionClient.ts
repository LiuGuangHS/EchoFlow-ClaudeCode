/**
 * PermissionClient — connects to the EchoFlow server WebSocket and forwards
 * tool permission requests to the React Native layer for native modal display.
 *
 * It connects in parallel with the H5 WebView's own WebSocket. Only listens for
 * control_request / control_cancel_request messages; does not interfere with chat.
 */

export type PermissionRequest = {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  description?: string
  permissionSuggestions?: Array<{
    type: string
    permission: Record<string, unknown>
  }>
}

export type PermissionClientCallbacks = {
  onPermissionRequest: (request: PermissionRequest) => void
  onPermissionCancelled: (requestId: string) => void
  onDisconnect: () => void
}

export class PermissionClient {
  private ws: WebSocket | null = null
  private serverUrl: string
  private h5Token: string
  private sessionId: string
  private callbacks: PermissionClientCallbacks

  constructor(
    serverUrl: string,
    h5Token: string,
    sessionId: string,
    callbacks: PermissionClientCallbacks,
  ) {
    this.serverUrl = serverUrl
    this.h5Token = h5Token
    this.sessionId = sessionId
    this.callbacks = callbacks
  }

  connect(): void {
    if (this.ws) return

    const base = this.serverUrl.replace(/^http/, 'ws')
    const url = `${base}/ws/${encodeURIComponent(this.sessionId)}?token=${encodeURIComponent(this.h5Token)}`

    try {
      this.ws = new WebSocket(url)
    } catch {
      return
    }

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '')
        this.handleMessage(msg)
      } catch {
        // Ignore non-JSON messages
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      this.callbacks.onDisconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire next, which handles cleanup
    }
  }

  disconnect(): void {
    if (!this.ws) return
    try {
      this.ws.close()
    } catch {
      // Ignore close errors
    }
    this.ws = null
  }

  respond(requestId: string, allowed: boolean): void {
    if (!this.ws) return

    this.ws.send(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: allowed
          ? { behavior: 'allow', updatedInput: {} }
          : { behavior: 'deny', message: 'Denied by user' },
      },
    }))
  }

  get isConnected(): boolean {
    return this.ws !== null
  }

  private handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const m = msg as Record<string, unknown>

    if (m.type === 'control_request' && isControlRequest(m)) {
      this.callbacks.onPermissionRequest({
        requestId: m.request_id as string,
        toolName: (m.request as Record<string, unknown>).tool_name as string,
        toolUseId: (m.request as Record<string, unknown>).tool_use_id as string | undefined,
        input: ((m.request as Record<string, unknown>).input as Record<string, unknown>) ?? {},
        description: (m.request as Record<string, unknown>).description as string | undefined,
        permissionSuggestions: (m.request as Record<string, unknown>).permission_suggestions as PermissionRequest['permissionSuggestions'],
      })
      return
    }

    if (
      (m.type === 'control_cancel_request' || m.type === 'control_response') &&
      typeof m.request_id === 'string'
    ) {
      this.callbacks.onPermissionCancelled(m.request_id)
    }
  }
}

function isControlRequest(m: Record<string, unknown>): boolean {
  if (m.type !== 'control_request') return false
  const req = m.request
  if (!req || typeof req !== 'object') return false
  return (req as Record<string, unknown>).subtype === 'can_use_tool' &&
    typeof m.request_id === 'string'
}
