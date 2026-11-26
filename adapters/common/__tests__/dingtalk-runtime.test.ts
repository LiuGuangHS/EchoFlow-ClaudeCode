import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DWClient, TOPIC_CARD, TOPIC_ROBOT } from 'dingtalk-stream'
import { AdapterMigrationLifecycle, adapterMigrationLifecycle } from '../migration-lifecycle.js'

const user = 'fixture-dt-user'
const chatId = `dingtalk:dm:${user}`
const webhook = 'http://webhook.fixture.test/send'
const mediaOrigin = 'http://media.fixture.test'
const signalNames = ['SIGINT', 'SIGTERM'] as const
const fixtureEnv = {
  ADAPTER_SERVER_URL: 'ws://127.0.0.1:1', CC_HAHA_LOCAL_ACCESS_TOKEN: '',
  DINGTALK_CLIENT_ID: 'fixture-client', DINGTALK_CLIENT_SECRET: 'fixture-secret',
  DINGTALK_PERMISSION_CARD_TEMPLATE_ID: 'tpl-fixture.schema', DINGTALK_STREAM_ENDPOINT: '',
}
type Call = { method: string; origin: string; path: string; token: string | null; body: any }
type Listener = (res: any) => Promise<void>

const spies: Array<{ mockRestore(): void }> = []
let root: string
let lifecycle: AdapterMigrationLifecycle
let savedEnv: Map<string, string | undefined>
let savedSignals: Map<(typeof signalNames)[number], Set<NodeJS.SignalsListener>>
let originalFetch: typeof fetch
let runtime: typeof import('../../dingtalk/runtime.js')
let calls: Call[]
// Per-test hook that can answer a request before the default fixture does.
let override: ((call: Call) => Response | undefined) | null
let warn: ReturnType<typeof spyOn>
let listeners: Record<string, Listener>
let connect: ReturnType<typeof spyOn>
let disconnect: ReturnType<typeof spyOn>
let ack: ReturnType<typeof spyOn>
let permissionResponse: ReturnType<typeof spyOn>

async function writeAdapterConfig(extra: Record<string, unknown> = {}, pairing?: Record<string, unknown>) {
  await writeFile(join(root, 'adapters.json'), JSON.stringify({
    dingtalk: { defaultWorkDir: root, allowedUsers: [user], ...extra },
    ...(pairing ? { pairing } : {}),
  }))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dingtalk-runtime-'))
  const env = { ...fixtureEnv, HOME: root, CLAUDE_CONFIG_DIR: root, ADAPTER_ALLOWED_PROJECT_ROOTS: root }
  savedEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  await writeAdapterConfig()

  lifecycle = new AdapterMigrationLifecycle()
  warn = spyOn(console, 'warn').mockImplementation(() => {})
  spies.push(
    spyOn(adapterMigrationLifecycle, 'registerShutdown').mockImplementation(lifecycle.registerShutdown.bind(lifecycle)),
    spyOn(adapterMigrationLifecycle, 'track').mockImplementation(lifecycle.track.bind(lifecycle)),
    spyOn(console, 'log').mockImplementation(() => {}),
    spyOn(console, 'error').mockImplementation(() => {}),
    warn,
  )
  Object.defineProperty(adapterMigrationLifecycle, 'isQuiescing', { get: () => lifecycle.isQuiescing, configurable: true })
  savedSignals = new Map(signalNames.map(signal => [signal, new Set(process.listeners(signal))]))

  calls = []
  override = null
  listeners = {}
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const call: Call = {
      method: init?.method ?? 'GET', origin: url.origin, path: url.pathname,
      token: new Headers(init?.headers).get('x-acs-dingtalk-access-token'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const custom = override?.(call)
    if (custom) return custom
    if (url.origin === 'http://127.0.0.1:1' && url.pathname === '/api/sessions/power-activity-lease') return Response.json({ ok: true })
    if (url.href === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') return Response.json({ accessToken: 'fixture-access-token', expireIn: 7200 })
    if (url.origin === 'https://api.dingtalk.com' && url.pathname.startsWith('/v1.0/card/')) return Response.json({})
    if (url.origin === new URL(webhook).origin) return Response.json({ errcode: 0 })
    throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`)
  }) as typeof fetch

  // Each runtime captures its storage path, token cache, timers and session maps at import.
  runtime = await import(`../../dingtalk/runtime.ts?fixture=${encodeURIComponent(root)}`)
  permissionResponse = spyOn(runtime.bridge, 'sendPermissionResponse').mockReturnValue(true)
  spies.push(permissionResponse)
})

afterEach(async () => {
  try {
    await lifecycle.quiesce()
  } finally {
    runtime?.clearTransientChatState(chatId)
    runtime?.bridge.destroy()
    runtime?.dedup.destroy()
    for (const spy of spies.splice(0).reverse()) spy.mockRestore()
    delete (adapterMigrationLifecycle as { isQuiescing?: boolean }).isQuiescing
    for (const [signal, saved] of savedSignals) {
      for (const listener of process.listeners(signal)) {
        if (!saved.has(listener)) process.removeListener(signal, listener)
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

async function waitFor(ready: () => boolean, what: string) {
  const deadline = performance.now() + 2_000
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${what}`)
    await Bun.sleep(5)
  }
}

const dmMessage = (text: string, extra: Record<string, unknown> = {}) => ({
  conversationType: '1', senderStaffId: user, senderNick: 'Fixture Nick', sessionWebhook: webhook,
  text: { content: text }, ...extra,
})
const webhookTexts = () => calls
  .filter(call => call.origin === new URL(webhook).origin).map(call => call.body.markdown.text as string)
const cardCalls = () => calls.filter(call => call.path.startsWith('/v1.0/card'))
const cardRoutes = () => cardCalls().map(call => `${call.method} ${call.path}`)

/** Registers the chat's webhook and AI card target the way a real inbound DM does. */
async function openChat() {
  await runtime.handleRobotMessage(dmMessage('/help') as any)
  expect(webhookTexts()).toHaveLength(1)
  calls = []
}

async function requestPermission(requestId: string) {
  await runtime.handleServerMessage(chatId, { type: 'permission_request', requestId, toolName: 'Bash', input: { command: 'ls' } })
}

function failCardCreation() {
  override = call => call.method === 'POST' && call.path === '/v1.0/card/instances'
    ? new Response('boom', { status: 500 })
    : undefined
}

/** Replaces the Stream client transport so no socket is opened; returns the registered topic listeners. */
function startAdapter(failure?: Error) {
  connect = spyOn(DWClient.prototype, 'connect').mockResolvedValue(undefined)
  if (failure) connect.mockRejectedValueOnce(failure)
  disconnect = spyOn(DWClient.prototype, 'disconnect').mockImplementation(() => {})
  ack = spyOn(DWClient.prototype, 'socketCallBackResponse').mockImplementation(() => {})
  const register = spyOn(DWClient.prototype, 'registerCallbackListener').mockImplementation(function (this: DWClient, topic: string, cb: any) {
    listeners[topic] = cb
    return this
  })
  spies.push(connect, disconnect, ack, register)
  runtime.startDingTalkAdapter()
}


test('a streamed text reply is delivered as one AI card to the sender and finalized on completion', async () => {
  await openChat()
  await runtime.handleServerMessage(chatId, { type: 'content_start', blockType: 'text' })
  expect(runtime.getRuntimeState(chatId).state).toBe('streaming')
  await runtime.handleServerMessage(chatId, { type: 'content_delta', text: 'Hello ' })
  await runtime.handleServerMessage(chatId, { type: 'content_delta', text: 'world' })
  await runtime.handleServerMessage(chatId, { type: 'message_complete' })

  expect(cardRoutes()).toEqual([
    'POST /v1.0/card/instances', 'POST /v1.0/card/instances/deliver',
    'PUT /v1.0/card/instances', 'PUT /v1.0/card/streaming', 'PUT /v1.0/card/instances',
  ])
  const [create, deliver, , streaming, finished] = cardCalls()
  expect(create!.token).toBe('fixture-access-token')
  expect(deliver!.body.openSpaceId).toBe(`dtv1.card//IM_ROBOT.${user}`)
  expect(deliver!.body.imRobotOpenDeliverModel.robotCode).toBe('fixture-client')
  expect(deliver!.body.outTrackId).toBe(create!.body.outTrackId)
  expect(streaming!.body).toMatchObject({ outTrackId: create!.body.outTrackId, content: 'Hello world', isFinalize: true })
  expect(finished!.body.cardData.cardParamMap).toMatchObject({ flowStatus: '3', msgContent: 'Hello world' })
  expect(webhookTexts()).toEqual([])
  expect(runtime.getRuntimeState(chatId).state).toBe('idle')
})

test('a long reply streams a growing cursor frame, reuses the same card, then finalizes it with the full text', async () => {
  await openChat()
  const first = 'a'.repeat(250)
  await runtime.handleServerMessage(chatId, { type: 'content_delta', text: first })
  await waitFor(() => cardCalls().some(call => call.path === '/v1.0/card/streaming'), 'intermediate streaming frame')
  await runtime.handleServerMessage(chatId, { type: 'content_delta', text: 'tail' })
  await runtime.handleServerMessage(chatId, { type: 'message_complete' })

  const creates = cardCalls().filter(call => call.method === 'POST' && call.path === '/v1.0/card/instances')
  expect(creates).toHaveLength(1)
  const frames = cardCalls().filter(call => call.path === '/v1.0/card/streaming').map(call => call.body)
  expect(frames[0]).toMatchObject({ content: `${first} ▍`, isFinalize: false })
  expect(frames.at(-1)).toMatchObject({ content: `${first}tail`, isFinalize: true })
  expect(webhookTexts()).toEqual([])
})

test('a server error is reported to the user and discards the unsent partial reply', async () => {
  await openChat()
  await runtime.handleServerMessage(chatId, { type: 'content_start', blockType: 'text' })
  await runtime.handleServerMessage(chatId, { type: 'content_delta', text: 'half a sentence' })
  await runtime.handleServerMessage(chatId, { type: 'error', message: 'model overloaded', code: 'E' })
  await runtime.handleServerMessage(chatId, { type: 'message_complete' })

  expect(webhookTexts()).toEqual(['❌ model overloaded'])
  expect(cardCalls()).toEqual([])
  expect(runtime.getRuntimeState(chatId).state).toBe('idle')
})

test('status, tool and init notifications update the chat runtime state', async () => {
  await runtime.handleServerMessage(chatId, { type: 'connected' })
  await runtime.handleServerMessage(chatId, { type: 'status', state: 'thinking', verb: 'Pondering' })
  expect(runtime.getRuntimeState(chatId)).toMatchObject({ state: 'thinking', verb: 'Pondering' })
  await runtime.handleServerMessage(chatId, { type: 'content_start', blockType: 'tool_use' })
  expect(runtime.getRuntimeState(chatId).state).toBe('tool_executing')
  await runtime.handleServerMessage(chatId, { type: 'tool_use_complete' })
  expect(runtime.getRuntimeState(chatId).state).toBe('streaming')
  await runtime.handleServerMessage(chatId, { type: 'system_notification', subtype: 'init', data: { model: ' ' } })
  expect(runtime.getRuntimeState(chatId).model).toBeUndefined()
  await runtime.handleServerMessage(chatId, { type: 'system_notification', subtype: 'init', data: { model: 'claude-fixture' } })
  expect(runtime.getRuntimeState(chatId).model).toBe('claude-fixture')
  await runtime.handleServerMessage(chatId, { type: 'status', state: 'idle' })
  expect(runtime.getRuntimeState(chatId)).toMatchObject({ state: 'idle', verb: undefined })
})

test('a reply for a chat without a session webhook is logged instead of thrown', async () => {
  const lost = 'dingtalk:group:no-webhook'
  await runtime.handleServerMessage(lost, { type: 'error', message: 'nobody to tell', code: 'E' })

  expect(warn.mock.calls.some(call => String(call[0]).includes(`Missing sessionWebhook for ${lost}`))).toBe(true)
  expect(calls).toEqual([])
})


test('a permission request creates a callback card for the sender after finishing the streamed reply', async () => {
  await openChat()
  await runtime.handleServerMessage(chatId, { type: 'content_delta', text: 'Let me run ls' })
  await requestPermission('req-card')

  const creates = cardCalls().filter(call => call.method === 'POST' && call.path === '/v1.0/card/instances')
  expect(creates).toHaveLength(2)
  expect(creates[0]!.body.outTrackId).not.toBe('permission_req-card')
  expect(cardCalls().some(call => call.body?.isFinalize === true && call.body.content === 'Let me run ls')).toBe(true)
  expect(creates[1]!.body).toMatchObject({
    cardTemplateId: 'tpl-fixture.schema', outTrackId: 'permission_req-card', callbackRouteKey: 'permission', callbackType: 'STREAM',
  })
  expect(creates[1]!.body.cardData.cardParamMap).toMatchObject({ toolName: 'Bash', requestId: 'req-card' })
  const [text] = webhookTexts()
  expect(text).toContain('已发送钉钉权限卡片')
  expect(text).toContain('/allow req-card')
  expect(runtime.getRuntimeState(chatId)).toMatchObject({ state: 'permission_pending', pendingPermissionCount: 1 })
})

test('a permission request falls back to text instructions, answers by chat reply and is not re-sent when duplicated', async () => {
  await openChat()
  failCardCreation()
  await requestPermission('req-text')
  expect(webhookTexts()).toHaveLength(1)
  expect(webhookTexts()[0]).toContain('回复 1 允许一次')
  expect(webhookTexts()[0]).not.toContain('已发送钉钉权限卡片')

  const before = calls.length
  await requestPermission('req-text')
  expect(calls).toHaveLength(before)

  await runtime.handleRobotMessage(dmMessage('1') as any)
  expect(permissionResponse).toHaveBeenCalledWith(chatId, 'req-text', true, undefined)
  expect(webhookTexts().at(-1)).toContain('权限响应已发送')

  await runtime.handleServerMessage(chatId, { type: 'permission_resolved', requestId: 'req-text', permissionType: 'tool' })
  expect(runtime.getRuntimeState(chatId)).toMatchObject({ state: 'thinking', pendingPermissionCount: 0 })
  expect(webhookTexts().at(-1)).toContain('权限请求 req-text 已不再等待确认')
})

const cardEnvelope = (requestId: string, decision: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'actionCallback', userId: user, outTrackId: `permission_${requestId}`,
  content: JSON.stringify({ cardPrivateData: { params: { value: JSON.stringify({ action: 'permit', requestId, ...decision }) } } }),
  ...extra,
})

test('a permission card button press from the requesting user submits the decision once, even if redelivered', async () => {
  startAdapter()
  await openChat()
  await requestPermission('req-cb')
  calls = []
  const envelope = JSON.stringify(cardEnvelope('req-cb', { allowed: true, rule: 'always' }))

  await listeners[TOPIC_CARD]!({ headers: { messageId: 'card-1' }, data: envelope })
  expect(ack).toHaveBeenCalledWith('card-1', { success: true })
  expect(permissionResponse).toHaveBeenCalledTimes(1)
  expect(permissionResponse).toHaveBeenCalledWith(chatId, 'req-cb', true, 'always')
  expect(webhookTexts()).toEqual(['权限响应已发送，等待服务端确认。'])

  await listeners[TOPIC_CARD]!({ headers: { messageId: 'card-1' }, data: envelope })
  expect(ack).toHaveBeenCalledTimes(2)
  expect(permissionResponse).toHaveBeenCalledTimes(1)
  expect(webhookTexts()).toHaveLength(1)
})

test('a denying card press is sent as a one-shot rejection and an envelope without headers is read directly', async () => {
  startAdapter()
  await openChat()
  await requestPermission('req-deny')

  await listeners[TOPIC_CARD]!(cardEnvelope('req-deny', { allowed: false }))
  expect(ack).not.toHaveBeenCalled()
  expect(permissionResponse).toHaveBeenCalledWith(chatId, 'req-deny', false, undefined)
})

test('card callbacks from another user, for another card, for an unknown request or of another type are rejected', async () => {
  startAdapter()
  await openChat()
  await requestPermission('req-guard')
  const allow = { allowed: true }
  const rejected = () => warn.mock.calls.filter(call => String(call[0]).includes('permission callback rejected')).length

  await listeners[TOPIC_CARD]!({ headers: { messageId: 'g-1' }, data: JSON.stringify(cardEnvelope('req-guard', allow, { userId: 'intruder' })) })
  await listeners[TOPIC_CARD]!({ headers: { messageId: 'g-2' }, data: JSON.stringify(cardEnvelope('req-guard', allow, { outTrackId: 'permission_other' })) })
  await listeners[TOPIC_CARD]!({ headers: { messageId: 'g-3' }, data: JSON.stringify(cardEnvelope('req-unknown', allow)) })
  expect(rejected()).toBe(3)

  await listeners[TOPIC_CARD]!({ headers: { messageId: 'g-4' }, data: JSON.stringify(cardEnvelope('req-guard', allow, { type: 'other' })) })
  await listeners[TOPIC_CARD]!({ headers: { messageId: 'g-5' }, data: 'not json' })
  expect(rejected()).toBe(3)
  expect(permissionResponse).not.toHaveBeenCalled()
  expect(runtime.getRuntimeState(chatId).pendingPermissionCount).toBe(1)
})


test('robot stream callbacks are acknowledged, parsed from JSON and replays or non-DM chats are ignored', async () => {
  startAdapter()
  const payload = JSON.stringify(dmMessage('/help', { msgId: 'body-1' }))

  await listeners[TOPIC_ROBOT]!({ headers: { messageId: 'robot-1' }, data: payload })
  expect(ack).toHaveBeenCalledWith('robot-1', { success: true })
  expect(webhookTexts()).toHaveLength(1)
  expect(webhookTexts()[0]).toContain('/sessions')

  await listeners[TOPIC_ROBOT]!({ headers: { messageId: 'robot-1' }, data: payload })
  await listeners[TOPIC_ROBOT]!({ headers: { messageId: 'robot-2' }, data: payload })
  await listeners[TOPIC_ROBOT]!({ headers: { messageId: 'robot-3' }, data: '{broken' })
  await listeners[TOPIC_ROBOT]!({ headers: { messageId: 'robot-4' }, data: JSON.stringify(dmMessage('/help', { conversationType: '2', msgId: 'body-2' })) })
  await listeners[TOPIC_ROBOT]!({ headers: { messageId: 'robot-5' }, data: JSON.stringify(dmMessage('', { msgId: 'body-3' })) })
  expect(ack).toHaveBeenCalledTimes(6)
  expect(webhookTexts()).toHaveLength(1)
})

test('an unpaired sender with the valid pairing code is paired and persisted, and a wrong code is refused', async () => {
  await writeAdapterConfig({}, { code: 'ABC234', expiresAt: Date.now() + 60_000, createdAt: Date.now() })
  await runtime.handleRobotMessage(dmMessage('WRONG1', { senderStaffId: 'dt-stranger' }) as any)
  expect(webhookTexts().at(-1)).toContain('未授权')
  expect((await Bun.file(join(root, 'adapters.json')).json()).dingtalk.pairedUsers).toBeUndefined()

  await runtime.handleRobotMessage(dmMessage(' abc234 ', { senderStaffId: 'dt-newcomer' }) as any)
  expect(webhookTexts().at(-1)).toContain('配对成功')
  const saved = await Bun.file(join(root, 'adapters.json')).json()
  expect(saved.dingtalk.pairedUsers).toEqual([expect.objectContaining({ userId: 'dt-newcomer', displayName: 'Fixture Nick' })])
  expect(saved.pairing.code).toBeNull()
})

test('shutdown disconnects the stream client, the bridge and the dedup store exactly once', async () => {
  const destroyBridge = spyOn(runtime.bridge, 'destroy').mockImplementation(() => {})
  const destroyDedup = spyOn(runtime.dedup, 'destroy').mockImplementation(() => {})
  spies.push(destroyBridge, destroyDedup)
  startAdapter()
  expect(connect).toHaveBeenCalledTimes(1)
  expect(Object.keys(listeners).sort()).toEqual([TOPIC_CARD, TOPIC_ROBOT].sort())
  expect(disconnect).not.toHaveBeenCalled()

  await lifecycle.quiesce()
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(destroyBridge).toHaveBeenCalledTimes(1)
  expect(destroyDedup).toHaveBeenCalledTimes(1)
})

test('starting while the process is quiescing registers listeners but never connects', async () => {
  await lifecycle.quiesce()
  startAdapter()

  expect(connect).not.toHaveBeenCalled()
  expect(Object.keys(listeners)).toHaveLength(2)
})

test('a failed stream connection is logged as fatal and exits the process with status 1', async () => {
  const exit = spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  const error = spyOn(console, 'error').mockImplementation(() => {})
  spies.push(exit, error)
  startAdapter(new Error('stream refused'))
  await waitFor(() => exit.mock.calls.length > 0, 'process exit')

  expect(exit).toHaveBeenCalledWith(1)
  expect(error.mock.calls.some(call => String(call[0]).includes('Fatal') && String(call[1]).includes('stream refused'))).toBe(true)
})


function bindOpenSession() {
  runtime.sessionStore.set(chatId, 'sess-1', root)
  spies.push(spyOn(runtime.bridge, 'isSessionOpen').mockReturnValue(true))
}

test('status reports project, branch, model, runtime state and task counts of the restored session', async () => {
  await openChat()
  bindOpenSession()
  await runtime.handleServerMessage(chatId, { type: 'system_notification', subtype: 'init', data: { model: 'claude-fixture' } })
  override = call => {
    if (call.path === '/api/sessions/sess-1/git-info') return Response.json({ branch: 'main', repoName: 'demo', workDir: root, changedFiles: 0 })
    if (call.path === '/api/tasks/lists/sess-1') {
      return Response.json({ tasks: [
        { id: '1', subject: 'a', status: 'pending' }, { id: '2', subject: 'b', status: 'in_progress' }, { id: '3', subject: 'c', status: 'completed' },
      ] })
    }
    return undefined
  }
  await runtime.handleRobotMessage(dmMessage('/status') as any)

  const text = webhookTexts().at(-1)!
  expect(text).toContain('项目: demo (main)')
  expect(text).toContain('模型: claude-fixture')
  expect(text).toContain('任务: 总计 3 · 进行中 1 · 待处理 1 · 已完成 1')
})

test('status still answers with the directory name when git and task lookups fail', async () => {
  await openChat()
  bindOpenSession()
  override = call => call.path.startsWith('/api/') && call.path !== '/api/sessions/power-activity-lease'
    ? new Response('{}', { status: 500 })
    : undefined
  await runtime.handleRobotMessage(dmMessage('状态') as any)

  const text = webhookTexts().at(-1)!
  expect(text).toContain(`项目: ${basename(root)}`)
  expect(text).not.toContain('任务:')
})

test('stop, clear and status without a bound session say there is no active session and send nothing to the bridge', async () => {
  await openChat()
  const stop = spyOn(runtime.bridge, 'sendStopGeneration').mockReturnValue(true)
  const send = spyOn(runtime.bridge, 'sendUserMessage').mockReturnValue(true)
  spies.push(stop, send)
  for (const command of ['/stop', '/clear', '/status']) {
    await runtime.handleRobotMessage(dmMessage(command) as any)
    expect(webhookTexts().at(-1)).toContain('当前没有活动会话')
  }

  expect(stop).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})

test('clear drops pending approvals and sends /clear, or reports when the connection is gone', async () => {
  await openChat()
  bindOpenSession()
  await requestPermission('req-clear')
  const send = spyOn(runtime.bridge, 'sendUserMessage').mockReturnValue(true)
  spies.push(send)
  await runtime.handleRobotMessage(dmMessage('/clear') as any)

  expect(send).toHaveBeenCalledWith(chatId, '/clear')
  expect(runtime.getRuntimeState(chatId)).toMatchObject({ state: 'thinking', pendingPermissionCount: 0 })
  expect(webhookTexts().at(-1)).toContain('已清空')

  send.mockReturnValue(false)
  await runtime.handleRobotMessage(dmMessage('清空') as any)
  expect(webhookTexts().at(-1)).toContain('无法发送 /clear')
})

const pictureMessage = () => dmMessage('', { msgtype: 'picture', text: undefined, content: { downloadCode: 'dl-1' } })

test('a picture message is downloaded through the download code and forwarded as a base64 image attachment', async () => {
  await openChat()
  bindOpenSession()
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  override = call => {
    if (call.path === '/v1.0/robot/messageFiles/download') return Response.json({ downloadUrl: `${mediaOrigin}/pic.png` })
    if (call.origin === mediaOrigin) return new Response(bytes, { headers: { 'content-type': 'image/png' } })
    return undefined
  }
  const send = spyOn(runtime.bridge, 'sendUserMessage').mockReturnValue(true)
  spies.push(send)
  await runtime.handleRobotMessage(pictureMessage() as any)

  const download = calls.find(call => call.path === '/v1.0/robot/messageFiles/download')!
  expect(download.token).toBe('fixture-access-token')
  expect(download.body).toEqual({ downloadCode: 'dl-1', robotCode: 'fixture-client' })
  expect(send).toHaveBeenCalledWith(chatId, '(用户发送了附件)', [
    { type: 'image', name: expect.stringMatching(/\.png$/), data: bytes.toString('base64'), mimeType: 'image/png' },
  ])
})

test('a picture that cannot be downloaded is reported and nothing is sent to the session', async () => {
  await openChat()
  bindOpenSession()
  override = call => call.path === '/v1.0/robot/messageFiles/download' ? new Response('{}', { status: 500 }) : undefined
  const send = spyOn(runtime.bridge, 'sendUserMessage').mockReturnValue(true)
  spies.push(send)
  await runtime.handleRobotMessage(pictureMessage() as any)

  expect(webhookTexts().at(-1)).toContain('附件下载失败')
  expect(send).not.toHaveBeenCalled()
})
