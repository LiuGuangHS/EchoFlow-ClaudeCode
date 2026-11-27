import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('only a private Telegram message can redeem a pairing code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'telegram-pair-'))
  const env = {
    HOME: root, CLAUDE_CONFIG_DIR: root, TELEGRAM_BOT_TOKEN: '12345:fixture-token',
    ADAPTER_SERVER_URL: 'ws://127.0.0.1:1', CC_HAHA_LOCAL_ACCESS_TOKEN: 'fixture-local-token',
  }
  const previousEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  let runtime: typeof import('../../telegram/runtime.js') | undefined
  try {
    Object.assign(process.env, env)
    const configPath = join(root, 'adapters.json')
    const code = 'ABC234'
    await writeFile(configPath, JSON.stringify({
      pairing: { code, expiresAt: Date.now() + 60_000 },
      whatsapp: { authDir: join(root, '..', 'unowned-whatsapp-auth') },
    }))
    runtime = await import(`../../telegram/runtime.ts?fixture=${encodeURIComponent(root)}`)
    const { bot } = runtime
    const replies: unknown[] = []
    bot.api.config.use(async (_previous, method, payload): Promise<{ ok: true; result: any }> => {
      if (method === 'getMe') return { ok: true, result: { id: 12345, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' } }
      if (method === 'sendMessage' && 'chat_id' in payload) {
        replies.push(payload.chat_id)
        return { ok: true, result: { message_id: 10 } }
      }
      throw new Error(`Unexpected Telegram method: ${method}`)
    })
    await bot.init()
    const from = { id: 7, is_bot: false, first_name: 'Fixture', last_name: 'User' }
    const message = { message_id: 1, date: 1, from, text: code }
    await bot.handleUpdate({ update_id: 1, message: { ...message, chat: { type: 'group', id: -100, title: 'Fixture group' } } })
    expect(replies).toEqual([])
    expect(JSON.parse(await readFile(configPath, 'utf8')).pairing.code).toBe(code)

    await bot.handleUpdate({ update_id: 2, message: { ...message, chat: { type: 'private', id: from.id, first_name: from.first_name } } })
    const saved = JSON.parse(await readFile(configPath, 'utf8'))
    expect(saved.telegram.pairedUsers).toEqual([{ userId: from.id, displayName: 'Fixture User', pairedAt: expect.any(Number) }])
    expect(saved.pairing.code).toBeNull()
    expect(replies).toEqual([from.id])
  } finally {
    runtime?.stopTelegramAdapter()
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
