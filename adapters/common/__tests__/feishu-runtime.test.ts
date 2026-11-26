import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as Lark from '@larksuiteoapi/node-sdk'
import { enqueue } from '../chat-queue.js'
import { formatImHelp, formatImStatus } from '../format.js'
import { AdapterMigrationLifecycle, adapterMigrationLifecycle } from '../migration-lifecycle.js'
import { FeishuMediaService } from '../../feishu/media.js'

type Feishu = typeof import('../../feishu/runtime.js')
type Sent = { msgType: string; content: string; reply?: string }

const user = 'ou_fixture_user'
const stranger = 'ou_stranger'
const signalNames = ['SIGINT', 'SIGTERM'] as const
const envKeys = [
  'HOME', 'CLAUDE_CONFIG_DIR', 'ADAPTER_SERVER_URL', 'ADAPTER_ALLOWED_PROJECT_ROOTS',
  'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_ENCRYPT_KEY', 'FEISHU_VERIFICATION_TOKEN',
  'FEISHU_DOMAIN', 'CC_HAHA_LOCAL_ACCESS_TOKEN',
]
const savedEnv = new Map(envKeys.map(key => [key, process.env[key]]))
const savedSignals = new Map(signalNames.map(signal => [signal, new Set(process.listeners(signal))]))
const originalFetch = globalThis.fetch
const spies: Array<{ mockRestore(): void }> = []

let feishu: Feishu
let root: string
let server: Bun.Server<{ sessionId: string }>
let sessionCount = 0
let sequence = 0
let chat = ''
let sent: Sent[] = []
let received: Array<{ sessionId: string; message: any }> = []
let sdkRequest: ReturnType<typeof spyOn>
// Lets a test make the card/text transport fail the way Feishu does without a real tenant.
let createBehavior: ((data: any) => any) | undefined

function writeAdapterConfig(feishuConfig: Record<string, unknown> = {}, pairing?: Record<string, unknown>) {
  fs.writeFileSync(path.join(root, '.claude', 'adapters.json'), JSON.stringify({
    serverUrl: process.env.ADAPTER_SERVER_URL,
    allowedProjectRoots: [root],
    ...(pairing ? { pairing } : {}),
    feishu: { defaultWorkDir: root, allowedProjectRoots: [root], allowedUsers: [user], ...feishuConfig },
  }))
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-runtime-')))
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true })
  server = Bun.serve<{ sessionId: string }>({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request, current) {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/ws/')) {
        if (current.upgrade(request, { data: { sessionId: url.pathname.slice(4) } })) return
        return new Response('upgrade required', { status: 400 })
      }
      if (url.pathname === '/api/sessions/power-activity-lease') return Response.json({ ok: true })
      if (url.pathname === '/api/sessions/recent-projects') {
        return Response.json({ projects: [{
          projectName: 'Fixture', realPath: root, projectPath: 'fixture', isGit: false,
          repoName: null, branch: null, modifiedAt: '2026-09-08', sessionCount: 1,
        }] })
      }
      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        return Response.json({ sessionId: `new-${++sessionCount}` })
      }
      if (url.pathname.endsWith('/git-info')) return Response.json({ repoName: 'Fixture', workDir: root, branch: 'main' })
      if (url.pathname.startsWith('/api/tasks/lists/')) {
        return Response.json({ tasks: [{ id: 't1', subject: 'a', status: 'pending' }, { id: 't2', subject: 'b', status: 'completed' }] })
      }
      if (url.pathname.startsWith('/api/sessions/')) return Response.json({ workDir: root, permissionMode: 'default' })
      return new Response(`Unexpected fixture request ${url.pathname}`, { status: 500 })
    },
    websocket: {
      open(socket) {
        socket.send(JSON.stringify({ type: 'connected' }))
      },
      message(socket, raw) {
        received.push({ sessionId: socket.data.sessionId, message: JSON.parse(String(raw)) })
      },
    },
  })
  Object.assign(process.env, {
    HOME: root,
    CLAUDE_CONFIG_DIR: path.join(root, '.claude'),
    ADAPTER_SERVER_URL: `ws://127.0.0.1:${server.port}`,
    ADAPTER_ALLOWED_PROJECT_ROOTS: root,
    FEISHU_APP_ID: 'fixture-app',
    FEISHU_APP_SECRET: 'fixture-secret',
    FEISHU_ENCRYPT_KEY: '',
    FEISHU_VERIFICATION_TOKEN: '',
    FEISHU_DOMAIN: '',
    CC_HAHA_LOCAL_ACCESS_TOKEN: '',
  })
  writeAdapterConfig()
  // Only the loopback fixture may be reached; anything else is a test bug.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin === server.url.origin) return originalFetch(input, { ...init, redirect: 'error' })
    throw new Error(`External network is forbidden in this fixture: ${url.origin}${url.pathname}`)
  }) as typeof fetch
  sdkRequest = spyOn(Lark.defaultHttpInstance, 'request').mockRejectedValue(new Error('Unexpected Lark SDK request'))
  // Keep the runtime's captured config and SDK instances local to this fixture.
  feishu = await import(`../../feishu/runtime.ts?fixture=${encodeURIComponent(root)}`)
})

afterAll(() => {
  feishu?.bridge.destroy()
  feishu?.dedup.destroy()
  server?.stop(true)
  globalThis.fetch = originalFetch
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const [signal, saved] of savedSignals) {
    for (const listener of process.listeners(signal)) {
      if (!saved.has(listener)) process.removeListener(signal, listener)
    }
  }
  fs.rmSync(root, { recursive: true, force: true })
  if (sdkRequest) {
    try { expect(sdkRequest).not.toHaveBeenCalled() } finally { sdkRequest.mockRestore() }
  }
})

function stubLark() {
  const lark = feishu.larkClient as any
  const record = (reply?: string) => async (request: any) => {
    const entry = { msgType: request.data.msg_type, content: String(request.data.content), reply }
    if (createBehavior) {
      const override = createBehavior(entry)
      if (override !== undefined) return override
    }
    sent.push(entry)
    return { code: 0, data: { message_id: `om_${++sequence}` } }
  }
  spies.push(
    spyOn(lark.im.message, 'create').mockImplementation(record()),
    spyOn(lark.im.message, 'reply').mockImplementation(async (request: any) => record(request.path.message_id)(request)),
    spyOn(lark.im.message, 'patch').mockResolvedValue({ code: 0 }),
    spyOn(lark.cardkit.v1.card, 'create').mockResolvedValue({ code: 0, data: { card_id: 'ck_fixture' } }),
    spyOn(lark.cardkit.v1.card, 'settings').mockResolvedValue({ code: 0 }),
    spyOn(lark.cardkit.v1.card, 'update').mockResolvedValue({ code: 0 }),
    spyOn(lark.cardkit.v1.cardElement, 'content').mockResolvedValue({ code: 0 }),
  )
}

beforeEach(() => {
  chat = `chat-${++sequence}`
  sent = []
  received = []
  createBehavior = undefined
  writeAdapterConfig()
  stubLark()
})

afterEach(async () => {
  // Finish the active card before restoring the SDK transport spies.
  await feishu.handleServerMessage(chat, { type: 'message_complete' })
  feishu.prepareNewSession(chat)
  for (const spy of spies.splice(0).reverse()) spy.mockRestore()
})

/** Plain-text notices the bot posted (post format), in order. */
function notices(): string[] {
  return sent.filter(item => item.msgType === 'post').map(item => JSON.parse(item.content).zh_cn.content[0][0].text)
}

function permissionCards() {
  return sent.filter(item => item.msgType === 'interactive' && item.content.includes('需要权限确认')).map(item => JSON.parse(item.content))
}

async function say(text: string, options: { sender?: string; type?: string; chatType?: string; id?: string; content?: unknown } = {}) {
  await feishu.handleMessage({
    sender: { sender_id: { open_id: options.sender ?? user } },
    message: {
      message_id: options.id ?? `om_in_${++sequence}`,
      chat_id: chat,
      chat_type: options.chatType ?? 'p2p',
      message_type: options.type ?? 'text',
      content: JSON.stringify(options.content ?? { text }),
    },
  })
  await enqueue(chat, async () => {})
}

async function waitFor(ready: () => boolean, what: string) {
  const deadline = performance.now() + 2_000
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${what}`)
    await Bun.sleep(5)
  }
}

/** Opens a real session for `chat` against the fixture server and returns its id. */
async function openSession(): Promise<string> {
  expect(await feishu.createSessionForChat(chat, root)).toBe(true)
  return feishu.sessionStore.get(chat)!.sessionId
}

const clientMessages = (type: string) => received.filter(item => item.message.type === type).map(item => item.message)

describe('inbound admission', () => {
  test('ignores group chats, incomplete events and replays of a message id', async () => {
    await say('/help', { chatType: 'group' })
    await feishu.handleMessage({ sender: { sender_id: { open_id: user } }, message: { chat_id: chat, chat_type: 'p2p', message_type: 'text', content: '{"text":"/help"}' } })
    await feishu.handleMessage({ message: { message_id: 'om_no_sender', chat_id: chat, chat_type: 'p2p', message_type: 'text', content: '{"text":"/help"}' } })
    expect(sent).toEqual([])

    await say('/help', { id: 'om_replayed' })
    await say('/help', { id: 'om_replayed' })
    expect(notices()).toEqual([formatImHelp()])
  })

  test('rejects an unpaired sender until the stored pairing code is sent, then admits them', async () => {
    writeAdapterConfig({ allowedUsers: [] }, { code: 'PAIR42', expiresAt: Date.now() + 60_000, createdAt: Date.now() })
    await say('/help', { sender: stranger })
    await say('', { sender: stranger, type: 'image', content: { image_key: 'img_x' } })
    await say('WRONG1', { sender: stranger })
    expect(notices()).toEqual(['🔒 未授权。请在 Claude Code 桌面端生成配对码后发送给我。', '🔒 未授权。请在 Claude Code 桌面端生成配对码后发送给我。'])

    sent = []
    await say('PAIR42', { sender: stranger })
    expect(notices()).toEqual(['✅ 配对成功！现在可以开始聊天了。\n\n发送消息即可与 Claude 对话。'])

    sent = []
    await say('/help', { sender: stranger })
    expect(notices()).toEqual([formatImHelp()])
    expect(received).toEqual([])
  })
})

describe('commands', () => {
  test('/status reports no session first, then project, branch, tasks and runtime state', async () => {
    await say('/status')
    expect(notices()).toEqual([formatImStatus(null)])

    const sessionId = await openSession()
    sent = []
    await feishu.handleServerMessage(chat, { type: 'system_notification', subtype: 'init', data: { model: 'fixture-model' } } as any)
    await feishu.handleServerMessage(chat, { type: 'status', state: 'thinking', verb: 'Pondering' } as any)
    await say('状态')
    const [status] = notices()
    expect(status).toContain('项目: Fixture (main)')
    expect(status).toContain(`会话: ${sessionId}`)
    expect(status).toContain('模型: fixture-model')
    expect(status).toContain('状态: 思考中 (Pondering)')
    expect(status).toContain('任务: 总计 2 · 待处理 1 · 已完成 1')
  })

  test('/stop and /clear reach the bound session only when one exists', async () => {
    await say('/stop')
    await say('清空')
    expect(notices()).toEqual([formatImStatus(null), formatImStatus(null)])
    expect(received).toEqual([])

    const sessionId = await openSession()
    sent = []
    await feishu.handleServerMessage(chat, { type: 'status', state: 'streaming' } as any)
    await feishu.handleServerMessage(chat, { type: 'permission_request', requestId: 'req-old', toolName: 'Bash', input: { command: 'ls' } } as any)
    await say('/stop')
    await waitFor(() => clientMessages('stop_generation').length === 1, 'stop_generation')
    expect(notices().at(-1)).toBe('⏹ 已发送停止信号。')

    sent = []
    await say('/clear')
    await waitFor(() => received.some(item => item.message.content === '/clear'), '/clear user_message')
    expect(received.find(item => item.message.content === '/clear')?.sessionId).toBe(sessionId)
    expect(notices()).toEqual(['🧹 已清空当前会话上下文。'])
    // Clearing must drop the pending approval so a stale "1" cannot allow it later.
    expect(feishu.getRuntimeState(chat)).toMatchObject({ state: 'thinking', pendingPermissionCount: 0 })
    sent = []
    await say('1')
    expect(clientMessages('permission_response')).toEqual([])
  })

  test('/projects sends a picker card whose buttons carry the project path, and falls back to text without a card id', async () => {
    await say('/projects')
    const card = JSON.parse(sent.find(item => item.msgType === 'interactive')!.content)
    expect(card.header.title.content).toBe('📁 选择项目')
    const button = card.body.elements[0].columns[1].elements[0]
    expect(button.value).toEqual({ action: 'pick_project', realPath: root, projectName: 'Fixture' })

    sent = []
    createBehavior = entry => entry.msgType === 'interactive' ? { code: 0, data: {} } : undefined
    await say('项目列表')
    expect(notices()[0]).toContain(`1. **Fixture**\n   ${root}`)
  })
})

describe('normal message flow', () => {
  test('a first message creates a session in the default work dir, forwards the text and streams the reply into a card', async () => {
    await say('hello')
    await waitFor(() => clientMessages('user_message').length === 1, 'user_message')
    const [prompt] = received
    expect(prompt!.message.content).toBe('hello')
    expect(feishu.sessionStore.get(chat)).toEqual(expect.objectContaining({ sessionId: prompt!.sessionId, workDir: root }))
    expect(feishu.getRuntimeState(chat).state).toBe('thinking')
    expect(sent.filter(item => item.msgType === 'interactive')).toHaveLength(1)

    await feishu.handleServerMessage(chat, { type: 'content_start', blockType: 'text' } as any)
    await feishu.handleServerMessage(chat, { type: 'content_delta', text: 'Hello from Claude' } as any)
    await feishu.handleServerMessage(chat, { type: 'message_complete' } as any)
    const lark = feishu.larkClient as any
    const written = JSON.stringify([...lark.cardkit.v1.card.update.mock.calls, ...lark.cardkit.v1.cardElement.content.mock.calls])
    expect(written).toContain('Hello from Claude')
    expect(lark.cardkit.v1.card.settings.mock.calls.length).toBeGreaterThan(0)
    expect(feishu.getRuntimeState(chat).state).toBe('idle')
  })

  test('tells the user when the socket refuses the message', async () => {
    const send = spyOn(feishu.bridge, 'sendUserMessage').mockReturnValue(false)
    spies.push(send)
    await say('lost')
    expect(notices()).toEqual(['⚠️ 消息发送失败，连接可能已断开。请发送 /new 重新开始。'])
    expect(feishu.getRuntimeState(chat).state).toBe('idle')

    expect(clientMessages('user_message')).toEqual([])
  })
})

describe('permission approvals', () => {
  const request = (requestId: string, toolName = 'Bash', input: unknown = { command: 'ls' }) =>
    ({ type: 'permission_request', requestId, toolName, input }) as any
  // null means "field absent"; undefined would silently pick the default.
  const press = (value: Record<string, unknown>, operator: string | null = user, chatId: string | null = chat) =>
    feishu.handleCardAction({ operator: { open_id: operator ?? undefined }, action: { value }, context: { open_chat_id: chatId ?? undefined } })

  test('renders one card per request with allow, always and deny buttons, and flags paths outside the work dir', async () => {
    await openSession()
    await feishu.handleServerMessage(chat, request('req-1'))
    await feishu.handleServerMessage(chat, request('req-1'))
    await feishu.handleServerMessage(chat, request('req-2', 'Write', { file_path: '/etc/passwd' }))
    await feishu.handleServerMessage(chat, request('req-3', 'Write', { file_path: path.join(root, 'a.ts') }))
    const [plain, outside, inside] = permissionCards()
    expect(permissionCards()).toHaveLength(3)
    const buttons = plain.body.elements.at(-1).columns.map((column: any) => column.elements[0].value)
    expect(buttons).toEqual([
      { action: 'permit', requestId: 'req-1', allowed: true },
      { action: 'permit', requestId: 'req-1', allowed: true, rule: 'always' },
      { action: 'permit', requestId: 'req-1', allowed: false },
    ])
    expect(plain.header.template).toBe('orange')
    expect(outside.header).toMatchObject({ template: 'red', subtitle: { content: '⚠️ 跨目录操作' } })
    expect(inside.header.template).toBe('orange')
    expect(feishu.getRuntimeState(chat)).toMatchObject({ state: 'permission_pending', pendingPermissionCount: 3 })
  })

  test('falls back to text instructions when the card cannot be delivered', async () => {
    createBehavior = entry => entry.msgType === 'interactive' ? { code: 0, data: {} } : undefined
    await feishu.handleServerMessage(chat, request('req-text'))
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toContain('[req-text]')
    expect(notices()[0]).toContain('/allow req-text')
  })

  test('card buttons forward the decision once, keep the always rule, and refuse repeats and unknown ids', async () => {
    const sessionId = await openSession()
    await feishu.handleServerMessage(chat, request('req-a'))
    await feishu.handleServerMessage(chat, request('req-b'))
    await feishu.handleServerMessage(chat, request('req-c'))

    expect(await press({ action: 'permit', requestId: 'req-a', allowed: true })).toEqual({ toast: { type: 'info', content: '权限响应已发送，等待服务端确认。' } })
    expect(await press({ action: 'permit', requestId: 'req-a', allowed: true })).toEqual({ toast: { type: 'info', content: '权限响应正在等待服务端确认，请勿重复提交。' } })
    expect((await press({ action: 'permit', requestId: 'req-b', allowed: true, rule: 'always' })).toast.type).toBe('info')
    expect((await press({ action: 'permit', requestId: 'req-c', rule: 'forever' })).toast.type).toBe('info')
    expect(await press({ action: 'permit', requestId: 'req-zzz', allowed: true })).toEqual({ toast: { type: 'warning', content: '未找到待确认的权限请求：req-zzz' } })

    await waitFor(() => clientMessages('permission_response').length === 3, 'permission responses')
    expect(clientMessages('permission_response')).toEqual([
      { type: 'permission_response', requestId: 'req-a', allowed: true },
      { type: 'permission_response', requestId: 'req-b', allowed: true, rule: 'always' },
      // A missing `allowed` and an unknown rule must never become an approval.
      { type: 'permission_response', requestId: 'req-c', allowed: false },
    ])
    expect(received.every(item => item.sessionId === sessionId)).toBe(true)
  })

  test('card buttons warn when the session socket is gone and ignore unauthorized or malformed callbacks', async () => {
    await openSession()
    await feishu.handleServerMessage(chat, request('req-d'))
    spies.push(spyOn(feishu.bridge, 'sendPermissionResponse').mockReturnValue(false))
    expect(await press({ action: 'permit', requestId: 'req-d', allowed: true })).toEqual({ toast: { type: 'warning', content: '权限响应发送失败，请检查会话状态。' } })

    expect(await press({ action: 'permit', requestId: 'req-d', allowed: true }, stranger)).toEqual({ toast: { type: 'warning', content: '未授权' } })
    expect(await press({ action: 'permit', requestId: 'req-d', allowed: true }, null)).toEqual({ toast: { type: 'warning', content: '未授权' } })
    expect(await press({ action: 'permit', allowed: true })).toBeUndefined()
    expect(await press({ action: 'permit', requestId: 'req-d' }, user, null)).toBeUndefined()
    expect(await press({ action: 'pick_project' })).toBeUndefined()
    expect(await press({ action: 'unknown' })).toBeUndefined()
  })
})

describe('server errors', () => {
  test('posts the error when no card is open and aborts the card instead when one is', async () => {
    await feishu.handleServerMessage(chat, { type: 'error', message: 'boom' } as any)
    expect(notices()).toEqual(['❌ boom'])

    sent = []
    await say('hi')
    await feishu.handleServerMessage(chat, { type: 'error', message: 'kaput' } as any)
    expect(notices()).toEqual([])
    expect(feishu.getRuntimeState(chat).state).toBe('idle')
  })

  test('rebuilds the session after a stale thinking signature, or reports that the rebuild failed', async () => {
    const stale = { type: 'error', message: 'Invalid signature in thinking block' } as any
    const first = await openSession()
    sent = []
    await feishu.handleServerMessage(chat, stale)
    expect(notices()).toEqual(['⚠️ 会话上下文已失效，正在自动重建...', '✅ 已重建会话，请重新发送消息。'])
    expect(feishu.sessionStore.get(chat)).toEqual(expect.objectContaining({ workDir: root }))
    expect(feishu.sessionStore.get(chat)!.sessionId).not.toBe(first)

    sent = []
    spies.push(spyOn(feishu.bridge, 'waitForOpen').mockResolvedValue(false))
    await feishu.handleServerMessage(chat, stale)
    expect(notices().at(-1)).toBe('❌ 重建会话失败，请发送 /new 手动新建。')
  })
})

describe('attachments', () => {
  const image = (size = 3, mimeType = 'image/png') => ({ kind: 'image', name: 'a.png', buffer: Buffer.from('png'), size, mimeType, path: '/tmp/a.png' })
  const post = (...nodes: unknown[]) => ({ zh_cn: { content: [nodes] } })

  test('forwards a downloaded image as base64 with a placeholder prompt and a file by path', async () => {
    const download = spyOn(FeishuMediaService.prototype, 'downloadResource')
      .mockResolvedValueOnce(image() as any)
      .mockResolvedValueOnce({ kind: 'file', name: 'r.pdf', buffer: Buffer.from('x'), size: 1, mimeType: 'application/pdf', path: '/tmp/r.pdf' } as any)
    spies.push(download)
    await say('', { type: 'post', content: post({ tag: 'img', image_key: 'img_1' }, { tag: 'file', file_key: 'f_1', file_name: 'r.pdf' }), id: 'om_media' })
    await waitFor(() => clientMessages('user_message').length === 1, 'attachment prompt')
    expect(clientMessages('user_message')[0]).toEqual({
      type: 'user_message',
      content: '(用户发送了附件)',
      powerActivityLeaseId: expect.any(String),
      attachments: [
        { type: 'image', name: 'a.png', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' },
        { type: 'file', name: 'r.pdf', path: '/tmp/r.pdf', mimeType: 'application/pdf' },
      ],
    })
    expect(download.mock.calls.map(([request]) => [request.messageId, request.fileKey, request.kind, request.fileName])).toEqual([
      ['om_media', 'img_1', 'image', undefined], ['om_media', 'f_1', 'file', 'r.pdf'],
    ])
  })

  test('skips oversized and failed downloads with a notice and does not invoke the agent for them', async () => {
    spies.push(spyOn(FeishuMediaService.prototype, 'downloadResource').mockResolvedValue(image(11 * 1024 * 1024) as any))
    await say('', { type: 'image', content: { image_key: 'img_big' } })
    expect(notices()).toEqual(['📎 图片过大(11.0 MB),请控制在 10 MB 以内'])
    expect(clientMessages('user_message')).toEqual([])

    sent = []
    spies.push(spyOn(FeishuMediaService.prototype, 'downloadResource').mockRejectedValue(new Error('403')))
    await say('', { type: 'image', content: { image_key: 'img_gone' } })
    expect(notices()).toEqual(['📎 附件下载失败,请稍后重试'])
    expect(clientMessages('user_message')).toEqual([])
  })

  test('a partial failure keeps the text and the surviving attachment, and attachments suppress command parsing', async () => {
    spies.push(spyOn(FeishuMediaService.prototype, 'downloadResource')
      .mockResolvedValueOnce(image() as any)
      .mockRejectedValueOnce(new Error('timeout')))
    await say('', { type: 'post', content: post({ tag: 'text', text: '/help' }, { tag: 'img', image_key: 'i1' }, { tag: 'img', image_key: 'i2' }) })
    await waitFor(() => clientMessages('user_message').length === 1, 'partial attachment prompt')
    expect(notices()).toEqual(['📎 1 个附件下载失败,已跳过'])
    expect(clientMessages('user_message')[0]).toMatchObject({ content: '/help', attachments: [{ type: 'image', name: 'a.png' }] })
  })
})

describe('project picker callback', () => {
  test('picking a project starts a session there and confirms in chat', async () => {
    const toast = await feishu.handleCardAction({
      operator: { open_id: user }, context: { open_chat_id: chat },
      action: { value: { action: 'pick_project', realPath: root, projectName: 'Fixture' } },
    })
    expect(toast).toEqual({ toast: { type: 'info', content: '📁 Fixture' } })
    expect(feishu.sessionStore.get(chat)).toEqual(expect.objectContaining({ workDir: root }))
    expect(notices()).toEqual(['✅ 已新建会话：**Fixture**'])
  })
})

describe('adapter lifecycle', () => {
  test('registers event handlers that survive malformed payloads, and shutdown releases bridge, dedup and socket', async () => {
    const lifecycle = new AdapterMigrationLifecycle()
    let handlers: Record<string, (data: unknown) => Promise<unknown>> | undefined
    let startOptions: { eventDispatcher: unknown } | undefined
    const destroyBridge = spyOn(feishu.bridge, 'destroy').mockImplementation(() => {})
    const destroyDedup = spyOn(feishu.dedup, 'destroy').mockImplementation(() => {})
    const close = spyOn(Lark.WSClient.prototype, 'close').mockImplementation(() => {})
    spies.push(
      spyOn(adapterMigrationLifecycle, 'registerShutdown').mockImplementation(lifecycle.registerShutdown.bind(lifecycle)),
      spyOn(adapterMigrationLifecycle, 'track').mockImplementation(lifecycle.track.bind(lifecycle)),
      spyOn(feishu.larkClient, 'request').mockResolvedValue({ code: 0, bot: { open_id: 'ou_bot' } }),
      spyOn(Lark.EventDispatcher.prototype, 'register').mockImplementation(function (this: Lark.EventDispatcher, table: any) {
        handlers = table
        return this
      }),
      spyOn(Lark.WSClient.prototype, 'start').mockImplementation(async (options: any) => { startOptions = options }),
      destroyBridge, destroyDedup, close,
    )

    feishu.startFeishuAdapter()
    await waitFor(() => startOptions !== undefined, 'WSClient.start')
    expect(startOptions!.eventDispatcher).toBeInstanceOf(Lark.EventDispatcher)
    expect(Object.keys(handlers!).sort()).toEqual(['card.action.trigger', 'im.message.receive_v1'])

    await handlers!['im.message.receive_v1']!({
      sender: { sender_id: { open_id: user } },
      message: { message_id: 'om_dispatch', chat_id: chat, chat_type: 'p2p', message_type: 'text', content: '{"text":"/help"}' },
    })
    await enqueue(chat, async () => {})
    expect(notices()).toEqual([formatImHelp()])
    expect(await handlers!['card.action.trigger']!({
      operator: { open_id: stranger }, context: { open_chat_id: chat }, action: { value: { action: 'permit', requestId: 'r' } },
    })).toEqual({ toast: { type: 'warning', content: '未授权' } })
    // A malformed callback must be logged, not rejected into the SDK's event loop.
    await expect(handlers!['im.message.receive_v1']!(null)).resolves.toBeUndefined()
    await expect(handlers!['card.action.trigger']!(null)).resolves.toBeUndefined()

    expect(destroyBridge).not.toHaveBeenCalled()
    await lifecycle.quiesce()
    expect(destroyBridge).toHaveBeenCalledTimes(1)
    expect(destroyDedup).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith({ force: true })
  })
})
