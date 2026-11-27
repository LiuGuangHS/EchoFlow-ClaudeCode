import { expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import type { WhatsAppSocket } from '../session.js'

test('WhatsApp accepts a retried approval once and reconciles it when the chat reconnects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whatsapp-approval-'))
  const chat = '101@s.whatsapp.net'
  const auth = join(root, 'whatsapp-auth', 'default')
  const env = createSandboxedTestEnvironment(root, {
    CLAUDE_CONFIG_DIR: root, WHATSAPP_AUTH_DIR: auth, CC_HAHA_LOCAL_ACCESS_TOKEN: '', ADAPTER_SERVER_URL: 'ws://127.0.0.1:1',
  })
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  let runtime: typeof import('../runtime.js') | undefined
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input) !== 'http://127.0.0.1:1/api/sessions/power-activity-lease') throw Error('Unexpected fixture request')
    return Response.json({ ok: true })
  })
  try {
    Object.assign(process.env, env)
    await mkdir(auth, { recursive: true })
    await writeFile(join(auth, 'creds.json'), JSON.stringify({ registered: true, me: { id: 'fixture' } }))
    await writeFile(join(root, 'adapters.json'), JSON.stringify({ whatsapp: { allowedUsers: [chat] } }))
    runtime = await import(`../runtime.ts?fixture=${encodeURIComponent(root)}`)
    const notices: string[] = []
    runtime!.useWhatsAppSocket({
      sendMessage: async (jid: string, message: { text: string }) => { expect(jid).toBe(chat); notices.push(message.text) },
      readMessages: async () => {}, sendPresenceUpdate: async () => {},
    } as unknown as WhatsAppSocket)
    const decision = spyOn(runtime!.bridge, 'sendPermissionResponse').mockReturnValueOnce(false).mockReturnValue(true)
    const prompt = { type: 'permission_request', requestId: 'fixture-request', toolName: 'Read', input: { file_path: 'fixture' } }
    await runtime!.handleServerMessage(chat, prompt)
    await runtime!.handleServerMessage(chat, prompt)
    expect(notices).toHaveLength(1)
    const reply = (id: string) => runtime!.handleIncomingMessage({ key: { id, remoteJid: chat }, message: { conversation: '/allow fixture-request' } })
    await reply('offline')
    await reply('reconnected')
    await reply('duplicate')
    expect(decision.mock.calls).toEqual(Array(2).fill([chat, 'fixture-request', true, undefined]))
    expect(notices.slice(1)).toEqual(['权限响应发送失败，请检查会话状态。', '权限响应已发送，等待服务端确认。', '权限响应正在等待服务端确认，请勿重复提交。'])
    await runtime!.handleServerMessage(chat, { type: 'permission_requests_snapshot', turnActive: false, toolRequestIds: [] })
    expect(notices.at(-1)).toContain('fixture-request 已不再等待确认')
    expect(runtime!.getRuntimeState(chat)).toMatchObject({ state: 'idle', pendingPermissionCount: 0 })
  } finally {
    runtime?.bridge.destroy()
    runtime?.dedup.destroy()
    fetch.mockRestore()
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(root, { recursive: true, force: true })
  }
})
