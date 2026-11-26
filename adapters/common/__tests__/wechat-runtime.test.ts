import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enqueue } from '../chat-queue.js'

test('WeChat retries a voice command reply without its expired context and ignores redelivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wechat-reply-'))
  const user = 'fixture-voice-user'
  const base = 'https://wechat.fixture.invalid'
  const env = {
    HOME: root, CLAUDE_CONFIG_DIR: root,
    WECHAT_BASE_URL: base, WECHAT_BOT_TOKEN: 'fixture-token', WECHAT_ACCOUNT_ID: 'fixture-account',
    ADAPTER_SERVER_URL: 'ws://127.0.0.1:1', CC_HAHA_LOCAL_ACCESS_TOKEN: '',
  }
  const savedEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  const attempts: Array<{ to_user_id: string; context_token?: string; item_list: Array<{ text_item: { text: string } }> }> = []
  let runtime: typeof import('../../wechat/runtime.js') | undefined
  try {
    Object.assign(process.env, env)
    await writeFile(join(root, 'adapters.json'), JSON.stringify({ wechat: { allowedUsers: [user], defaultWorkDir: root } }))
    globalThis.fetch = (async (input, init) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:1/api/sessions/power-activity-lease') return Response.json({ ok: true })
      if (url !== `${base}/ilink/bot/sendmessage`) throw new Error(`Unexpected fixture request: ${url}`)
      attempts.push(JSON.parse(String(init?.body)).msg)
      return Response.json({ ret: attempts.length === 1 ? -14 : 0 })
    }) as typeof fetch

    runtime = await import(`../../wechat/runtime.ts?fixture=${encodeURIComponent(root)}`)
    const message = {
      message_id: 907, from_user_id: user, context_token: 'expired',
      item_list: [{ type: 3, voice_item: { text: '/help' } }],
    }
    await runtime.routeUserMessage(message)
    await runtime.routeUserMessage(message)
    await enqueue(user, async () => {})

    expect(attempts.map(msg => msg.to_user_id)).toEqual([user, user])
    expect(attempts.map(msg => msg.context_token)).toEqual(['expired', undefined])
    expect(attempts[0]!.item_list[0]!.text_item.text).toContain('/sessions')
    expect(attempts[1]!.item_list).toEqual(attempts[0]!.item_list)
  } finally {
    runtime?.typingController.destroy()
    runtime?.bridge.destroy()
    runtime?.dedup.destroy()
    globalThis.fetch = originalFetch
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
