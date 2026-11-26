import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WSClient } from '@wecom/aibot-node-sdk'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import * as lifecycle from '../../common/migration-lifecycle.js'

test('WeCom restores the bound session and delivers its final reply when the inbound stream has expired', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-stream-'))
  const user = 'fixture-user'
  const question = 'Resume the saved session'
  const text = 'A complete reply from the saved session'
  const forwarded: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request, server) {
      const { pathname } = new URL(request.url)
      if (pathname === '/ws/saved' && server.upgrade(request)) return
      if (pathname === '/api/sessions/saved') return Response.json({ workDir: root, permissionMode: 'default' })
      if (pathname === '/api/sessions/power-activity-lease') return Response.json({ ok: true })
      return new Response(null, { status: 404 })
    },
    websocket: { message(socket, raw) {
      const message = JSON.parse(String(raw))
      if (message.type !== 'user_message') return
      forwarded.push(message.content)
      socket.send(JSON.stringify({ type: 'content_delta', text }))
      socket.send(JSON.stringify({ type: 'message_complete' }))
    } },
  })
  const env = createSandboxedTestEnvironment(root, {
    CLAUDE_CONFIG_DIR: root, ADAPTER_SERVER_URL: `ws://127.0.0.1:${server.port}`, CC_HAHA_LOCAL_ACCESS_TOKEN: '',
    WECOM_BOT_ID: 'fixture-bot', WECOM_BOT_SECRET: 'fixture-secret', ADAPTER_ALLOWED_PROJECT_ROOTS: root,
  })
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  let cleanup: (() => void | Promise<void>) | undefined
  let client!: WSClient
  const delivered = Promise.withResolvers<void>()
  const hooks = [
    spyOn(lifecycle, 'registerAdapterShutdown').mockImplementation(callback => { cleanup = callback }),
    spyOn(WSClient.prototype, 'connect').mockImplementation(function (this: WSClient) { client = this; return this }),
    spyOn(WSClient.prototype, 'disconnect').mockImplementation(() => {}),
    spyOn(WSClient.prototype, 'hasPendingReplyAck').mockReturnValue(false),
  ]
  const stream = spyOn(WSClient.prototype, 'replyStream').mockRejectedValue(new Error('fixture: inbound stream expired'))
  const send = spyOn(WSClient.prototype, 'sendMessage').mockImplementation(async () => {
    delivered.resolve()
    return { headers: { req_id: 'fallback' } }
  })
  const timer = setTimeout(() => delivered.reject(new Error('Missing WeCom fallback delivery')), 2500)
  try {
    Object.assign(process.env, env)
    await writeFile(join(root, 'adapters.json'), JSON.stringify({ wecom: { allowedUsers: [user] } }))
    await writeFile(join(root, 'adapter-sessions.json'), JSON.stringify({ [user]: { sessionId: 'saved', workDir: root, updatedAt: 1 } }))
    await import(`../runtime.ts?fixture=${encodeURIComponent(root)}`)
    client.emit('message', {
      headers: { req_id: 'inbound' },
      body: { aibotid: 'fixture-bot', chattype: 'single', from: { userid: user }, msgid: 'question', msgtype: 'text', create_time: 1, text: { content: question } },
    })
    await delivered.promise
    expect(send.mock.calls).toEqual([[user, { msgtype: 'markdown', markdown: { content: text } }]])
    expect(forwarded).toEqual([question])
    expect(stream.mock.calls.at(-1)).toEqual([expect.objectContaining({ headers: { req_id: 'inbound' } }), expect.any(String), text, true])
  } finally {
    clearTimeout(timer)
    await cleanup?.()
    server.stop(true)
    for (const spy of [...hooks, stream, send]) spy.mockRestore()
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(root, { recursive: true, force: true })
  }
})
