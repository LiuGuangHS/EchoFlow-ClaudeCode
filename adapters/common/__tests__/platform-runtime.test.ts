import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QQBot, type QQBotEventMap } from '@tencent-connect/qqbot-nodejs'
import { WSClient } from '@wecom/aibot-node-sdk'
import { enqueue } from '../chat-queue.js'
import { AdapterMigrationLifecycle, adapterMigrationLifecycle } from '../migration-lifecycle.js'
import { SlackApiClient } from '../../slack/api.js'

const user = 'fixture-user'
const signalNames = ['SIGINT', 'SIGTERM'] as const
const fixtureEnv = {
  ADAPTER_SERVER_URL: 'ws://127.0.0.1:1', CC_HAHA_LOCAL_ACCESS_TOKEN: '',
  QQ_APP_ID: 'fixture-qq', QQ_APP_SECRET: 'fixture-secret',
  WECOM_BOT_ID: 'fixture-wecom', WECOM_BOT_SECRET: 'fixture-secret',
  SLACK_BOT_TOKEN: 'xoxb-fixture', SLACK_APP_TOKEN: 'xapp-fixture',
}
const spies: Array<{ mockRestore(): void }> = []
let root: string
let lifecycle: AdapterMigrationLifecycle
let savedEnv: Map<string, string | undefined>
let savedSignals: Map<(typeof signalNames)[number], Set<NodeJS.SignalsListener>>
let originalFetch: typeof fetch
let slackSocket: Bun.Server<undefined> | undefined
let slackRequests: string[]
let slackReplies: unknown[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'im-runtime-'))
  const env = { ...fixtureEnv, HOME: root, CLAUDE_CONFIG_DIR: root }
  savedEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const config = { allowedUsers: [user], defaultWorkDir: root }
  await writeFile(join(root, 'adapters.json'), JSON.stringify({ qq: config, wecom: config, slack: config }))

  lifecycle = new AdapterMigrationLifecycle()
  // Use the real shutdown callbacks without stopping Bun's shared test process.
  spies.push(
    spyOn(adapterMigrationLifecycle, 'registerShutdown').mockImplementation(lifecycle.registerShutdown.bind(lifecycle)),
    spyOn(adapterMigrationLifecycle, 'track').mockImplementation(lifecycle.track.bind(lifecycle)),
  )
  savedSignals = new Map(signalNames.map(signal => [signal, new Set(process.listeners(signal))]))
  slackRequests = []
  slackReplies = []
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.href === 'http://127.0.0.1:1/api/sessions/power-activity-lease') {
      return Response.json({ ok: true })
    }
    if (slackSocket && url.origin === 'https://slack.com') {
      slackRequests.push(url.pathname)
      if (url.pathname === '/api/auth.test') return Response.json({ ok: true, user_id: 'fixture-bot' })
      if (url.pathname === '/api/users.info') return Response.json({ ok: true, user: { real_name: 'Fixture User' } })
      if (url.pathname === '/api/chat.postMessage') {
        slackReplies.push(JSON.parse(String(init?.body)))
        return Response.json({ ok: true, ts: '3.0' })
      }
    }
    throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`)
  }) as typeof fetch
})

afterEach(async () => {
  try {
    await lifecycle.quiesce()
  } finally {
    slackSocket?.stop(true)
    slackSocket = undefined
    for (const spy of spies.splice(0).reverse()) spy.mockRestore()
    for (const [signal, listeners] of savedSignals) {
      for (const listener of process.listeners(signal)) {
        if (!listeners.has(listener)) process.removeListener(signal, listener)
      }
    }
    globalThis.fetch = originalFetch
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})

async function waitForSocketEvent(ready: () => boolean, event: string) {
  const deadline = performance.now() + 2_000
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${event}`)
    await Bun.sleep(5)
  }
}

test('QQ answers a private help command using its message target and stops the bot', async () => {
  const start = spyOn(QQBot.prototype, 'start').mockResolvedValue(undefined)
  const stop = spyOn(QQBot.prototype, 'stop').mockImplementation(() => {})
  const on = spyOn(QQBot.prototype, 'on')
  const send = spyOn(QQBot.prototype, 'sendText').mockResolvedValue({ id: 'reply', timestamp: 0 })
  spies.push(start, stop, on, send)

  await import('../../qq/runtime.js')
  expect(start).toHaveBeenCalledTimes(1)
  const handler = on.mock.calls.find(([event]) => event === 'message')?.[1] as QQBotEventMap['message'] | undefined
  expect(handler).toBeDefined()
  const target = { scope: 'c2c', targetId: user, msgId: 'inbound' } as const
  await handler!({} as Parameters<QQBotEventMap['message']>[0], {
    kind: 'c2c', senderId: user, content: '/help', messageId: target.msgId, replyTarget: target,
  } as Parameters<QQBotEventMap['message']>[1])
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(target, expect.stringContaining('/sessions'))

  await lifecycle.quiesce()
  expect(stop).toHaveBeenCalledTimes(1)
})

test('WeCom answers a private help command and disconnects its client', async () => {
  let client: WSClient | undefined
  const connect = spyOn(WSClient.prototype, 'connect').mockImplementation(function (this: WSClient) {
    client = this
    return this
  })
  const disconnect = spyOn(WSClient.prototype, 'disconnect').mockImplementation(() => {})
  const send = spyOn(WSClient.prototype, 'sendMessage').mockResolvedValue({ headers: { req_id: 'reply' } })
  spies.push(connect, disconnect, send)

  await import('../../wecom/runtime.js')
  expect(connect).toHaveBeenCalledTimes(1)
  client!.emit('message', {
    headers: { req_id: 'inbound' },
    body: { aibotid: 'fixture-wecom', chattype: 'single', from: { userid: user }, msgid: 'inbound', msgtype: 'text', create_time: 1 },
  })
  await enqueue(user, async () => {})
  expect(send).toHaveBeenCalledTimes(0)
  client!.emit('message', {
    headers: { req_id: 'help' },
    body: { aibotid: 'fixture-wecom', chattype: 'single', from: { userid: user }, msgid: 'help', msgtype: 'text', create_time: 2, text: { content: '/help' } },
  })
  await enqueue(user, async () => {})
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(user, {
    msgtype: 'markdown', markdown: { content: expect.stringContaining('/sessions') },
  })

  await lifecycle.quiesce()
  expect(disconnect).toHaveBeenCalledTimes(1)
})

test('Slack authenticates before Socket Mode, answers in the incoming thread and closes the socket', async () => {
  let acknowledge: unknown
  let closeCode: number | undefined
  slackSocket = Bun.serve<undefined>({
    hostname: '127.0.0.1', port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: undefined })) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(socket) {
        socket.send(JSON.stringify({
          type: 'events_api', envelope_id: 'envelope', payload: { event: {
            type: 'message', channel_type: 'im', channel: 'fixture-dm', user, text: '/help', ts: '2.0', thread_ts: '1.0',
          } },
        }))
      },
      message(_socket, raw) { acknowledge = JSON.parse(String(raw)) },
      close(_socket, code) { closeCode = code },
    },
  })
  const open = spyOn(SlackApiClient.prototype, 'openSocketConnection').mockImplementation(async () => {
    slackRequests.push('openSocketConnection')
    return `ws://127.0.0.1:${slackSocket!.port}`
  })
  spies.push(open)

  await import('../../slack/runtime.js')
  await waitForSocketEvent(() => acknowledge !== undefined && slackReplies.length > 0, 'Slack acknowledgment and reply')
  expect(slackRequests).toEqual(['/api/auth.test', 'openSocketConnection', '/api/users.info', '/api/chat.postMessage'])
  expect(acknowledge).toEqual({ envelope_id: 'envelope' })
  expect(slackReplies).toEqual([{ channel: 'fixture-dm', thread_ts: '1.0', text: expect.stringContaining('/sessions') }])

  await lifecycle.quiesce()
  await waitForSocketEvent(() => closeCode !== undefined, 'Slack socket close')
  expect(closeCode).toBe(1000)
})
