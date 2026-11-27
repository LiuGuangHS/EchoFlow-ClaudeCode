import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

test('WhatsApp answers a replayed help command once per direct chat', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whatsapp-runtime-'))
  try {
    const env = createSandboxedTestEnvironment(home, { ADAPTER_SERVER_URL: 'ws://127.0.0.1:1' })
    const auth = join(env.CLAUDE_CONFIG_DIR, 'whatsapp-auth', 'default')
    await mkdir(auth, { recursive: true })
    await writeFile(join(auth, 'creds.json'), JSON.stringify({ registered: true, me: { id: 'fixture' } }))
    const chats = ['101@s.whatsapp.net', '202@lid']
    await writeFile(join(env.CLAUDE_CONFIG_DIR, 'adapters.json'), JSON.stringify({ whatsapp: { allowedUsers: chats } }))
    const runtime = fileURLToPath(new URL('../../whatsapp/runtime.ts', import.meta.url))
    const script = `
      import assert from 'node:assert/strict'
      globalThis.fetch = async input => {
        assert.equal(String(input), 'http://127.0.0.1:1/api/sessions/power-activity-lease')
        return Response.json({ ok: true })
      }
      const { handleIncomingMessage, useWhatsAppSocket, bridge, dedup } = await import(${JSON.stringify(runtime)})
      const replies = []
      useWhatsAppSocket({
        sendMessage: async (jid, message) => { replies.push([jid, message.text]) },
        readMessages: async () => {}, sendPresenceUpdate: async () => {},
      })
      const [first, second] = ${JSON.stringify(chats)}
      try {
        for (const remoteJid of [first, first, second]) {
          await handleIncomingMessage({ key: { id: 'shared-id', remoteJid }, message: { conversation: '/help' } })
        }
        assert.deepEqual(replies.map(([jid]) => jid), [first, second])
        for (const [, text] of replies) assert.match(text, /\\/sessions/)
      } finally {
        bridge.destroy()
        dedup.destroy()
      }
    `
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { env, stdout: 'ignore', stderr: 'pipe' })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(exitCode, stderr).toBe(0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
