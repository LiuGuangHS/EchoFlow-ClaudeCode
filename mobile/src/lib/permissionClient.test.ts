import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { PermissionClient } from './permissionClient'
import type { PermissionClientCallbacks, PermissionRequest } from './permissionClient'

const originalWebSocket = globalThis.WebSocket

type MockWs = {
  onmessage: ((event: WebSocketMessageEvent) => void) | null
  onclose: ((event: WebSocketCloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send: (data: string) => void
  close: () => void
}

function createMockWs(): MockWs {
  const ws: MockWs = {
    onmessage: null,
    onclose: null,
    onerror: null,
    send: () => {},
    close: () => {
      if (ws.onclose) {
        ws.onclose({ code: 1000, reason: '', wasClean: true } as unknown as WebSocketCloseEvent)
      }
    },
  }
  return ws
}

globalThis.WebSocket = function MockWsCtor(_url: string) {
  return createMockWs() as unknown as WebSocket
} as unknown as typeof WebSocket

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
})

function makeCallbacks(): PermissionClientCallbacks & {
  requests: PermissionRequest[]
  cancelled: string[]
  disconnects: number
} {
  const state = { requests: [] as PermissionRequest[], cancelled: [] as string[], disconnects: 0 }
  return {
    requests: state.requests,
    cancelled: state.cancelled,
    disconnects: state.disconnects,
    onPermissionRequest: (req) => { state.requests.push(req) },
    onPermissionCancelled: (id) => { state.cancelled.push(id) },
    onDisconnect: () => { state.disconnects++ },
  }
}

function sendMessage(client: InstanceType<typeof PermissionClient>, msg: unknown): void {
  const ws = (client as unknown as { ws: MockWs }).ws
  if (ws && ws.onmessage) {
    ws.onmessage({ data: JSON.stringify(msg) } as WebSocketMessageEvent)
  }
}

describe('PermissionClient', () => {
  test('connects without throwing', () => {
    const cbs = makeCallbacks()
    const client = new PermissionClient('http://192.168.1.10:3456', 'h5_abc', 'session-1', cbs)
    client.connect()
    expect(client).toBeDefined()
  })

  test('emits onPermissionRequest for control_request messages', () => {
    const cbs = makeCallbacks()
    const client = new PermissionClient('http://10.0.0.1:3456', 'h5_x', 's1', cbs)
    client.connect()

    sendMessage(client, {
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'toolu_01',
        input: { command: 'ls' },
        description: 'List files',
      },
    })

    expect(cbs.requests).toHaveLength(1)
    expect(cbs.requests[0]).toMatchObject({
      requestId: 'req-1',
      toolName: 'Bash',
      toolUseId: 'toolu_01',
      input: { command: 'ls' },
      description: 'List files',
    })
  })

  test('emits onPermissionCancelled for control_cancel_request', () => {
    const cbs = makeCallbacks()
    const client = new PermissionClient('http://10.0.0.1:3456', 'h5_x', 's1', cbs)
    client.connect()

    sendMessage(client, {
      type: 'control_cancel_request',
      request_id: 'req-2',
    })

    expect(cbs.cancelled).toEqual(['req-2'])
    expect(cbs.requests).toHaveLength(0)
  })

  test('ignores non-JSON and unrecognized messages', () => {
    const cbs = makeCallbacks()
    const client = new PermissionClient('http://10.0.0.1:3456', 'h5_x', 's1', cbs)
    client.connect()

    sendMessage(client, { type: 'assistant', content: 'hello' })
    sendMessage(client, { type: 'system_notification', subtype: 'init' })

    expect(cbs.requests).toHaveLength(0)
    expect(cbs.cancelled).toHaveLength(0)
  })

  test('ignores control_request without correct subtype', () => {
    const cbs = makeCallbacks()
    const client = new PermissionClient('http://10.0.0.1:3456', 'h5_x', 's1', cbs)
    client.connect()

    sendMessage(client, {
      type: 'control_request',
      request_id: 'req-3',
      request: { subtype: 'other', tool_name: 'X' },
    })

    expect(cbs.requests).toHaveLength(0)
  })

  test('respond sends control_response', () => {
    const cbs = makeCallbacks()
    const client = new PermissionClient('http://10.0.0.1:3456', 'h5_x', 's1', cbs)
    client.connect()
    const ws = (client as unknown as { ws: MockWs }).ws
    const sent: string[] = []
    ws.send = (data: string) => { sent.push(data) }

    client.respond('req-1', true)

    expect(sent).toHaveLength(1)
    const payload = JSON.parse(sent[0])
    expect(payload.type).toBe('control_response')
    expect(payload.response.request_id).toBe('req-1')
    expect(payload.response.response.behavior).toBe('allow')

    client.respond('req-2', false)
    const denyPayload = JSON.parse(sent[1])
    expect(denyPayload.response.response.behavior).toBe('deny')
  })
})
