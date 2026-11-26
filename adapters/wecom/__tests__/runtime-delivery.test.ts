import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WSClient } from '@wecom/aibot-node-sdk'
import { enqueue } from '../../common/chat-queue.js'
import * as migration from '../../common/migration-lifecycle.js'
import type { AttachmentRef } from '../../common/ws-bridge.js'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

const user = 'delivery-user'
const session = 'wecom-session'
const ack = { headers: { req_id: 'sdk-ack' } }
const lifecycle = new migration.AdapterMigrationLifecycle()
const spies: Array<{ mockRestore(): void }> = []
const received: Array<{ content: string; attachments?: AttachmentRef[] }> = []
let root: string
let savedEnv: Map<string, string | undefined>
let server: Bun.Server<undefined>
let socket: Bun.ServerWebSocket<undefined>
let client: WSClient
let sequence = 0

function stubSdk() {
  const markdown = spyOn(client, 'sendMessage').mockResolvedValue(ack)
  const stream = spyOn(client, 'replyStream').mockResolvedValue(ack)
  const pending = spyOn(client, 'hasPendingReplyAck').mockReturnValue(false)
  const download = spyOn(client, 'downloadFile').mockRejectedValue(new Error('fixture download failed'))
  const upload = spyOn(client, 'uploadMedia').mockResolvedValue({ type: 'image', media_id: 'uploaded-image', created_at: '1' })
  const sendImage = spyOn(client, 'sendMediaMessage').mockResolvedValue(ack)
  spies.push(markdown, stream, pending, download, upload, sendImage)
  return { markdown, stream, pending, download, upload, sendImage }
}
let sdk: ReturnType<typeof stubSdk>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wecom-delivery-'))
  server = Bun.serve<undefined>({
    hostname: '127.0.0.1', port: 0,
    fetch(request, server) {
      const path = new URL(request.url).pathname
      if (path === `/ws/${session}` && server.upgrade(request)) return
      if (path === '/api/sessions' && request.method === 'POST') return Response.json({ sessionId: session })
      if (path === '/api/sessions/power-activity-lease') return Response.json({ ok: true })
      return new Response('Unexpected fixture request', { status: 404 })
    },
    websocket: {
      open(ws) { socket = ws },
      message(_ws, raw) {
        const message = JSON.parse(String(raw))
        if (message.type === 'user_message') received.push(message)
      },
    },
  })
  const env = createSandboxedTestEnvironment(root, {
    CLAUDE_CONFIG_DIR: root, ADAPTER_SERVER_URL: `ws://127.0.0.1:${server.port}`,
    ADAPTER_ALLOWED_PROJECT_ROOTS: root, CC_HAHA_LOCAL_ACCESS_TOKEN: 'fixture-token',
    WECOM_BOT_ID: 'fixture-bot', WECOM_BOT_SECRET: 'fixture-secret',
  })
  savedEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  await writeFile(join(root, 'adapters.json'), JSON.stringify({ wecom: { allowedUsers: [user], defaultWorkDir: root } }))
  spies.push(
    spyOn(migration, 'registerAdapterShutdown').mockImplementation(lifecycle.registerShutdown.bind(lifecycle)),
    spyOn(migration.adapterMigrationLifecycle, 'track').mockImplementation(lifecycle.track.bind(lifecycle)),
    spyOn(WSClient.prototype, 'connect').mockImplementation(function (this: WSClient) { client = this; return this }),
    spyOn(WSClient.prototype, 'disconnect').mockImplementation(() => {}),
  )
  // The common platform smoke imports the same startup module in Bun's shared process.
  await import(`../runtime.ts?fixture=${encodeURIComponent(root)}`)
  sdk = stubSdk()
})

afterAll(async () => {
  try {
    await lifecycle.quiesce()
  } finally {
    server?.stop(true)
    for (const spy of spies.reverse()) spy.mockRestore()
    for (const [key, value] of savedEnv ?? []) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})

async function inbound(msgtype: string, fields: Record<string, unknown>) {
  const id = `message-${++sequence}`
  const frame = { headers: { req_id: id }, body: { msgid: id, aibotid: 'fixture-bot', chattype: 'single' as const, from: { userid: user }, msgtype, ...fields } }
  client.emit('message', frame)
  await enqueue(user, async () => {})
  return frame
}

function delta(text: string) { socket.send(JSON.stringify({ type: 'content_delta', text })) }
function finish() { socket.send(JSON.stringify({ type: 'message_complete' })) }

async function until(ready: () => boolean, label: string) {
  const deadline = performance.now() + 2000
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

beforeEach(async () => {
  await inbound('text', { text: { content: '/new' } })
  expect(sdk.markdown).toHaveBeenLastCalledWith(user, { msgtype: 'markdown', markdown: { content: expect.stringContaining('已新建会话') } })
  for (const spy of Object.values(sdk)) spy.mockClear()
  received.length = 0
})

test('forwards only downloaded attachments, stages files under the session and reports skipped media', async () => {
  const image = Buffer.from('image bytes')
  sdk.download.mockResolvedValueOnce({ buffer: image, filename: 'photo.jpg' })
  await inbound('mixed', { mixed: { msg_item: [
    { msgtype: 'text', text: { content: 'inspect these' } },
    { msgtype: 'image', image: { url: 'fixture:photo', aeskey: 'photo-key' } },
    { msgtype: 'image', image: { url: 'fixture:missing', aeskey: 'missing-key' } },
  ] } })
  await until(() => received.length === 1, 'mixed prompt')
  expect(sdk.download.mock.calls).toEqual([['fixture:photo', 'photo-key'], ['fixture:missing', 'missing-key']])
  expect(received[0]).toMatchObject({ content: 'inspect these', attachments: [
    { type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: image.toString('base64') },
  ] })
  expect(sdk.markdown).toHaveBeenCalledWith(user, { msgtype: 'markdown', markdown: { content: '1 个附件下载失败，已跳过。' } })

  await inbound('file', { file: { url: 'fixture:missing' } })
  expect(sdk.markdown).toHaveBeenLastCalledWith(user, { msgtype: 'markdown', markdown: { content: '附件下载失败，请稍后重试。' } })
  sdk.download.mockResolvedValueOnce({ buffer: Buffer.from('<svg/>'), filename: 'drawing.svg' })
  await inbound('file', { file: { url: 'fixture:drawing' } })
  expect(sdk.markdown).toHaveBeenLastCalledWith(user, { msgtype: 'markdown', markdown: { content: expect.stringContaining('image/svg+xml') } })

  sdk.download.mockResolvedValueOnce({ buffer: Buffer.from('file bytes'), filename: 'notes.txt' })
  await inbound('file', { file: { url: 'fixture:notes' } })
  await until(() => received.length >= 2, 'file prompt')
  const path = join(root, 'im-downloads', 'wecom', session, 'notes.txt')
  expect(received.slice(1)).toEqual([expect.objectContaining({ content: '(用户发送了附件)', attachments: [
    { type: 'file', name: 'notes.txt', mimeType: 'text/plain', path },
  ] })])
  expect(await readFile(path, 'utf8')).toBe('file bytes')
})

test('closes the original stream once and delivers overflow in byte-limited markdown chunks', async () => {
  const frame = await inbound('text', { text: { content: 'long answer please' } })
  const prefix = '界'.repeat(6000)
  const buffered = 'b'.repeat(160)
  const overflow = '续'.repeat(1500)
  delta(prefix)
  await until(() => sdk.stream.mock.calls.length === 1, 'initial stream frame')
  sdk.pending.mockReturnValueOnce(true)
  delta(buffered)
  delta(overflow)
  await until(() => sdk.stream.mock.calls.length === 2, 'stream closure at byte cap')
  delta('tail')
  finish()
  await until(() => sdk.markdown.mock.calls.length >= 2, 'proactive overflow')
  const streamId = sdk.stream.mock.calls[0]![1]
  expect(streamId).toBeTruthy()
  expect(sdk.stream.mock.calls).toEqual([[frame, streamId, prefix, false], [frame, streamId, prefix + buffered, true]])
  const chunks = sdk.markdown.mock.calls.map(([target, body]) => {
    expect(target).toBe(user)
    if (body.msgtype !== 'markdown') throw new Error(`Unexpected message type ${body.msgtype}`)
    expect(Buffer.byteLength(body.markdown.content)).toBeLessThanOrEqual(4000)
    return body.markdown.content
  })
  expect(chunks.join('')).toBe(overflow + 'tail')
})

test('falls back to markdown on a rejected final stream and delivers the uploaded image', async () => {
  const frame = await inbound('text', { text: { content: 'show image' } })
  const text = '![preview](data:image/png;base64,aW1hZ2U=)'
  sdk.pending.mockReturnValueOnce(true)
  sdk.stream.mockRejectedValueOnce(new Error('fixture reply rejected'))
  delta(text)
  finish()
  await until(() => sdk.markdown.mock.calls.length > 0 && sdk.sendImage.mock.calls.length > 0, 'markdown fallback and image')
  expect(sdk.stream.mock.calls).toEqual([[frame, expect.any(String), text, true]])
  expect(sdk.markdown.mock.calls).toEqual([[user, { msgtype: 'markdown', markdown: { content: text } }]])
  expect(sdk.upload).toHaveBeenCalledWith(Buffer.from('image'), { type: 'image', filename: expect.stringMatching(/\.png$/) })
  expect(sdk.sendImage.mock.calls).toEqual([[user, 'image', 'uploaded-image']])
})

test('an empty upload receipt preserves text delivery without sending an invalid media id', async () => {
  // /new clears the previous reply frame. Output on that socket needs proactive delivery.
  sdk.upload.mockResolvedValueOnce({ type: 'image', media_id: '', created_at: '1' })
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const text = '![preview](data:image/png;base64,aW1hZ2U=)'
    delta(text)
    finish()
    await until(() => errors.mock.calls.length > 0 && sdk.markdown.mock.calls.length > 0, 'upload failure and text delivery')
    expect(errors).toHaveBeenCalledWith('[WeCom] dispatchOutboundImage failed:', expect.stringContaining('no media_id'))
    expect(sdk.sendImage).not.toHaveBeenCalled()
    expect(sdk.stream).not.toHaveBeenCalled()
    expect(sdk.markdown.mock.calls).toEqual([[user, { msgtype: 'markdown', markdown: { content: text } }]])
  } finally {
    errors.mockRestore()
  }
})
