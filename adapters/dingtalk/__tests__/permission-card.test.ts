import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import {
  buildDingTalkPermissionCardParams,
  parseDingTalkPermissionCardAction,
} from '../permission-card.js'

describe('DingTalk pairing notices', () => {
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dingtalk-pairing-')))
  const sent: Array<{ url: string; body: Record<string, any> }> = []
  let restoreFetch: (() => void) | undefined
  let adapter: typeof import('../index.js') | undefined

  beforeAll(async () => {
    process.env.CLAUDE_CONFIG_DIR = directory
    writeFileSync(join(directory, 'adapters.json'), JSON.stringify({
      dingtalk: { clientId: 'fixture-id', clientSecret: ['fixture', 'client-secret'].join('-') },
    }))
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('example.test')) {
        sent.push({ url, body: JSON.parse(String(init?.body)) })
        return Response.json({})
      }
      return Response.json({ accessToken: ['fixture', 'access-token'].join('-'), expireIn: 7200 })
    })
    restoreFetch = () => fetchSpy.mockRestore()
    adapter = await import('../index.js')
  })

  afterAll(() => {
    restoreFetch?.()
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    rmSync(directory, { recursive: true, force: true })
  })

  it('uses EchoFlow branding for rejected and successful pairing attempts', async () => {
    const sendPairingMessage = async (chatId: string, userId: string, code: string) => {
      await adapter!.handleRobotMessage({
        conversationType: '1',
        senderStaffId: userId,
        text: { content: code },
        sessionWebhook: `https://example.test/${chatId}`,
      })
      return sent.at(-1)!.body.markdown
    }

    const denied = await sendPairingMessage('denied', 'user-denied', 'WRONG1')
    expect(denied.title).toBe('EchoFlow Code')
    expect(denied.text).toContain('EchoFlow Code 桌面端')
    expect(denied.text).not.toContain('Claude')

    writeFileSync(join(directory, 'adapters.json'), JSON.stringify({
      dingtalk: { clientId: 'fixture-id', clientSecret: ['fixture', 'client-secret'].join('-') },
      pairing: { code: 'ABC234', expiresAt: Date.now() + 60_000, createdAt: Date.now() },
    }))
    const paired = await sendPairingMessage('paired', 'user-paired', 'ABC234')
    expect(paired.text).toContain('发送消息即可与 EchoFlow 对话')
    expect(paired.text).not.toContain('Claude')
  })
})

describe('DingTalk permission card helpers', () => {
  it('builds template params with three permission actions', () => {
    const params = buildDingTalkPermissionCardParams('Bash', { command: 'npm test' }, 'req-1')

    expect(params.requestId).toBe('req-1')
    expect(params.toolName).toBe('Bash')
    expect(params.title).toBe('EchoFlow Code 需要权限确认')
    expect(String(params.inputPreview)).toContain('npm test')
    expect(JSON.parse(String(params.allowValue))).toEqual({ action: 'permit', requestId: 'req-1', allowed: true })
    expect(JSON.parse(String(params.alwaysValue))).toEqual({ action: 'permit', requestId: 'req-1', allowed: true, rule: 'always' })
    expect(JSON.parse(String(params.denyValue))).toEqual({ action: 'permit', requestId: 'req-1', allowed: false })
  })

  it('parses nested card private params', () => {
    const action = parseDingTalkPermissionCardAction({
      outTrackId: 'permission_req-1',
      content: JSON.stringify({
        cardPrivateData: {
          params: {
            action: 'permit',
            requestId: 'req-1',
            allowed: true,
            rule: 'always',
          },
        },
      }),
    })

    expect(action).toEqual({ requestId: 'req-1', allowed: true, rule: 'always' })
  })

  it('parses compact callback values', () => {
    expect(parseDingTalkPermissionCardAction({ actionValue: 'permit:req-2:no' })).toEqual({
      requestId: 'req-2',
      allowed: false,
    })
  })

  it('ignores callbacks without permission action data', () => {
    expect(parseDingTalkPermissionCardAction({ action: 'open_url', url: 'https://example.com' })).toBeNull()
  })
})
