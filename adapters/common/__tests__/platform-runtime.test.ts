import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QQBot, type QQBotEventMap } from '@tencent-connect/qqbot-nodejs'
import { WSClient } from '@wecom/aibot-node-sdk'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import { WsBridge, type ServerMessage } from '../ws-bridge.js'
import { AdapterHttpClient } from '../http-client.js'
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
  const env = createSandboxedTestEnvironment(root, { ...fixtureEnv, CLAUDE_CONFIG_DIR: root })
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

function captureChatTransport() {
  let handler!: (message: ServerMessage) => void
  const forwarded = spyOn(WsBridge.prototype, 'sendUserMessage').mockReturnValue(true)
  spies.push(forwarded,
    spyOn(AdapterHttpClient.prototype, 'createSession').mockResolvedValue('fixture-session'),
    spyOn(WsBridge.prototype, 'connectSession').mockReturnValue(true),
    spyOn(WsBridge.prototype, 'waitForOpen').mockResolvedValue(true),
    spyOn(WsBridge.prototype, 'isSessionOpen').mockReturnValue(true),
    spyOn(WsBridge.prototype, 'onServerMessage').mockImplementation((_chatId, callback) => { handler = callback }),
  )
  return { forwarded, serverMessage: (message: ServerMessage) => handler(message) }
}

test('QQ answers commands and rejected prompts using their message targets and stops the bot', async () => {
  const { forwarded, serverMessage } = captureChatTransport()
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

  const messages = ['queued-1', 'queued-2'].map(msgId => ({ ...target, msgId }))
  await Promise.all(messages.map(replyTarget => handler!({} as Parameters<QQBotEventMap['message']>[0], {
    kind: 'c2c', senderId: user, content: '/help', messageId: replyTarget.msgId, replyTarget,
  } as Parameters<QQBotEventMap['message']>[1])))
  expect(send.mock.calls.slice(1).map(([replyTarget]) => replyTarget)).toEqual(messages)

  spies.push(spyOn(QQBot.prototype, 'sendTyping').mockResolvedValue({}))
  for (const msgId of ['first', 'second']) {
    await handler!({} as Parameters<QQBotEventMap['message']>[0], {
      kind: 'c2c', senderId: user, content: 'same question', messageId: msgId,
    } as Parameters<QQBotEventMap['message']>[1])
  }
  expect(forwarded.mock.calls.map(call => call[4])).toEqual(['first', 'second'])
  await serverMessage({ type: 'error', code: 'CLI_START_FAILED', message: 'startup failed', replyAnchor: 'second' })
  expect(send).toHaveBeenLastCalledWith({ ...target, msgId: 'second' }, expect.stringContaining('startup failed'))
  await serverMessage({ type: 'status', state: 'idle' })
  await serverMessage({ type: 'content_delta', text: 'background answer' })
  await serverMessage({ type: 'message_complete' })
  expect(send).toHaveBeenLastCalledWith({ scope: 'c2c', targetId: user, msgId: undefined }, 'background answer')

  // The CLI may start B before the adapter saw completion for A. A's short
  // final chunk still needs its original QQ target when streaming is unavailable.
  const openStream = spyOn(QQBot.prototype, 'openStream').mockImplementation(() => { throw new Error('fixture stream unavailable') })
  spies.push(openStream)
  for (const msgId of ['A', 'B']) {
    await handler!({} as Parameters<QQBotEventMap['message']>[0], {
      kind: 'c2c', senderId: user, content: 'same question', messageId: msgId,
    } as Parameters<QQBotEventMap['message']>[1])
    await serverMessage({ type: 'input_committed', messageUuid: `${msgId}-uuid`, replyAnchor: forwarded.mock.calls.at(-1)?.[4] })
    await serverMessage({ type: 'input_turn_start', messageUuids: [`${msgId}-uuid`] })
    await serverMessage({ type: 'content_delta', text: `tail ${msgId}` })
  }
  await serverMessage({ type: 'message_complete' })
  expect(send.mock.calls.slice(-2)).toEqual([
    [{ ...target, msgId: 'A' }, 'tail A'],
    [{ ...target, msgId: 'B' }, 'tail B'],
  ])

  // Exercise the SDK throttle, including its deferred second update.
  openStream.mockRestore()
  const prefix = 'a'.repeat(200)
  let confirmed = ''
  const createStream = QQBot.prototype.openStream
  spies.push(spyOn(QQBot.prototype, 'openStream').mockImplementation(function (this: QQBot, options) {
    spies.push(spyOn(this.messageApi, 'sendC2CStreamMessage').mockImplementation(async (_creds, _user, frame) => {
      if (confirmed) throw new Error('fixture transport rejected the remaining frames')
      confirmed = frame.content_raw
      return { id: 'fixture-stream' }
    }))
    return createStream.call(this, options)
  }))
  await serverMessage({ type: 'input_committed', messageUuid: 'stream-a', replyAnchor: 'A' })
  await serverMessage({ type: 'input_turn_start', messageUuids: ['stream-a'] })
  await serverMessage({ type: 'content_delta', text: prefix })
  await waitForSocketEvent(() => confirmed === prefix, 'first QQ frame accepted')
  await serverMessage({ type: 'content_delta', text: 'remaining text' })
  await serverMessage({ type: 'input_committed', messageUuid: 'stream-b', replyAnchor: 'B' })
  await serverMessage({ type: 'input_turn_start', messageUuids: ['stream-b'] })
  expect(send).toHaveBeenLastCalledWith({ ...target, msgId: 'A' }, 'remaining text')

  await lifecycle.quiesce()
  expect(stop).toHaveBeenCalledTimes(1)
})

for (const outcome of ['stop', 'stalled body', 'reject'] as const) {
  test(`QQ token prefetch handles ${outcome} before gateway startup`, async () => {
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', `
      const outcome = ${JSON.stringify(outcome)}
      const token = Promise.withResolvers()
      const bodyRead = Promise.withResolvers()
      globalThis.fetch = url => {
        if (String(url) !== 'https://bots.qq.com/app/getAppAccessToken') throw Error('unexpected request')
        return token.promise
      }
      const { adapterMigrationLifecycle } = await import(${JSON.stringify(import.meta.resolve('../migration-lifecycle.js'))})
      await import(${JSON.stringify(import.meta.resolve('../../qq/runtime.js'))})
      if (outcome === 'reject') {
        token.reject(Error('fixture token failure'))
      } else {
        if (outcome === 'stalled body') {
          token.resolve(new Response(new ReadableStream({ pull() { bodyRead.resolve() } }), { status: 200 }))
          await bodyRead.promise
        }
        const stopped = adapterMigrationLifecycle.quiesce()
        await Promise.resolve()
        if (outcome === 'stop') token.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }))
        await Promise.race([stopped, Bun.sleep(500).then(() => { throw Error('QQ did not quiesce') })])
      }
    `], { env: createSandboxedTestEnvironment(root, fixtureEnv), stdout: 'pipe', stderr: 'pipe', timeout: 3_000 })
    const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (outcome !== 'reject') {
      expect(errors).not.toContain('Failed to start')
      expect(code).toBe(0)
    } else {
      expect(errors).toContain('fixture token failure')
      expect(code).toBe(1)
    }
  })
}

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
  let acknowledge: { envelope_id: string } | undefined
  let closeCode: number | undefined
  const firstLookup = Promise.withResolvers<void>()
  const fixtureFetch = globalThis.fetch
  let lookups = 0
  globalThis.fetch = (async (input, init) => {
    if (new URL(String(input)).pathname === '/api/users.info' && ++lookups === 1) await firstLookup.promise
    return fixtureFetch(input, init)
  }) as typeof fetch
  let sendEvent!: (ts: string, thread: string | undefined, text: string) => void
  const { forwarded, serverMessage } = captureChatTransport()
  slackSocket = Bun.serve<undefined>({
    hostname: '127.0.0.1', port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: undefined })) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(socket) {
        sendEvent = (ts, thread_ts, text) => socket.send(JSON.stringify({
          type: 'events_api', envelope_id: ts, payload: { event: {
            type: 'message', channel_type: 'im', channel: 'fixture-dm', user, text, ts, thread_ts,
          } },
        }))
        sendEvent('1.1', 'first-thread', '/help')
        sendEvent('2.0', '1.0', '/help')
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
  try {
    await waitForSocketEvent(() => acknowledge?.envelope_id === '2.0', 'both Slack acknowledgments')
  } finally { firstLookup.resolve() }
  await waitForSocketEvent(() => slackReplies.length === 2, 'queued command replies')
  expect(slackReplies.shift()).toEqual({ channel: 'fixture-dm', thread_ts: 'first-thread', text: expect.stringContaining('/sessions') })
  expect(slackRequests).toEqual(['/api/auth.test', 'openSocketConnection', '/api/users.info', '/api/chat.postMessage', '/api/chat.postMessage'])
  expect(open.mock.calls).toEqual([[fixtureEnv.SLACK_APP_TOKEN]])
  expect(acknowledge).toEqual({ envelope_id: '2.0' })
  expect(slackReplies).toEqual([{ channel: 'fixture-dm', thread_ts: '1.0', text: expect.stringContaining('/sessions') }])

  sendEvent('4.0', '3.0', 'question')
  await waitForSocketEvent(() => forwarded.mock.calls.length === 1, 'question forwarded')
  await serverMessage({ type: 'input_committed', messageUuid: 'first-uuid', replyAnchor: forwarded.mock.calls[0]?.[4] })
  await serverMessage({ type: 'input_turn_start', messageUuids: ['first-uuid'] })
  await serverMessage({ type: 'content_start', blockType: 'text' })
  sendEvent('6.0', '5.0', '/help')
  await waitForSocketEvent(() => slackReplies.length === 2, 'command reply')
  expect(slackReplies[1]).toEqual({ channel: 'fixture-dm', thread_ts: '5.0', text: expect.stringContaining('/sessions') })
  sendEvent('8.0', '7.0', 'next question')
  await waitForSocketEvent(() => forwarded.mock.calls.length === 2, 'next question forwarded')
  await serverMessage({ type: 'content_delta', text: 'a'.repeat(240) })
  await waitForSocketEvent(() => slackReplies.length === 3, 'stream flush')
  expect(slackReplies[2]).toEqual({ channel: 'fixture-dm', thread_ts: '3.0', text: 'a'.repeat(240) })
  await serverMessage({ type: 'error', code: 'CLI_ERROR', message: 'fixture error' })
  await serverMessage({ type: 'message_complete' })
  expect(slackReplies[3]).toEqual({ channel: 'fixture-dm', thread_ts: '3.0', text: expect.stringContaining('fixture error') })
  await serverMessage({ type: 'input_committed', messageUuid: 'next-uuid', replyAnchor: forwarded.mock.calls[1]?.[4] })
  await serverMessage({ type: 'input_turn_start', messageUuids: ['next-uuid'] })
  await serverMessage({ type: 'content_delta', text: 'second answer' })
  await serverMessage({ type: 'message_complete' })
  expect(slackReplies[4]).toEqual({ channel: 'fixture-dm', thread_ts: '7.0', text: 'second answer' })

  // A newer prompt can supersede one still in server startup, without a completion for the older input.
  sendEvent('10.0', '9.0', 'same question')
  await waitForSocketEvent(() => forwarded.mock.calls.length === 3, 'older prompt forwarded')
  sendEvent('12.0', '11.0', 'same question')
  await waitForSocketEvent(() => forwarded.mock.calls.length === 4, 'replacement forwarded')
  await serverMessage({ type: 'input_committed', messageUuid: 'replacement-uuid', replyAnchor: forwarded.mock.calls[3]?.[4] })
  await serverMessage({ type: 'input_turn_start', messageUuids: ['replacement-uuid'] })
  await serverMessage({ type: 'user_message_replay', messageUuid: 'replacement-uuid', content: 'same question' })
  await serverMessage({ type: 'content_delta', text: 'replacement ' })
  sendEvent('13.0', undefined, 'same question')
  await waitForSocketEvent(() => forwarded.mock.calls.length === 5, 'main conversation forwarded')
  const mainAnchor = forwarded.mock.calls[4]?.[4]
  expect(mainAnchor).toBeNull()
  await serverMessage({ type: 'error', code: 'CLI_START_FAILED', message: 'startup failed', replyAnchor: mainAnchor })
  await serverMessage({ type: 'status', state: 'idle' })
  expect(slackReplies[5]).toEqual({ channel: 'fixture-dm', text: expect.stringContaining('startup failed') })
  await serverMessage({ type: 'content_delta', text: 'answer' })
  await serverMessage({ type: 'message_complete' })
  expect(slackReplies[6]).toEqual({ channel: 'fixture-dm', thread_ts: '11.0', text: 'replacement answer' })

  await lifecycle.quiesce()
  await waitForSocketEvent(() => closeCode !== undefined, 'Slack socket close')
  expect(closeCode).toBe(1000)
})
