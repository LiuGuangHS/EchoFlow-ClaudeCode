import { describe, expect, it } from 'bun:test'
import {
  buildDingTalkPermissionCardParams,
  parseDingTalkPermissionCardAction,
  parseDingTalkPermissionCardCallback,
} from '../permission-card.js'

describe('DingTalk permission card helpers', () => {
  it('builds template params with three permission actions', () => {
    const params = buildDingTalkPermissionCardParams('Bash', { command: 'npm test' }, 'req-1')

    expect(params.requestId).toBe('req-1')
    expect(params.toolName).toBe('Bash')
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

  it('reads callback identity only from the platform envelope', () => {
    const envelope = {
      type: 'actionCallback', userId: 'recipient', outTrackId: 'permission_req-1',
      content: JSON.stringify({ cardPrivateData: { params: { requestId: 'req-1', allowed: true, userId: 'forged', outTrackId: 'forged' } } }),
    }
    expect(parseDingTalkPermissionCardCallback(JSON.stringify(envelope))).toEqual({
      userId: 'recipient', outTrackId: 'permission_req-1',
      action: { requestId: 'req-1', allowed: true, rule: undefined, outTrackId: 'forged', chatId: undefined },
    })
    for (const userId of [undefined, '', 123]) {
      expect(parseDingTalkPermissionCardCallback({ ...envelope, userId })).toBeNull()
    }
    expect(parseDingTalkPermissionCardCallback({ ...envelope, outTrackId: undefined })).toBeNull()
    expect(parseDingTalkPermissionCardCallback({ ...envelope, type: undefined })).toBeNull()
    expect(parseDingTalkPermissionCardCallback({ ...envelope, content: '{invalid' })).toBeNull()
    expect(parseDingTalkPermissionCardCallback({ ...envelope, content: undefined, requestId: 'req-1', allowed: true })).toBeNull()
    expect(parseDingTalkPermissionCardCallback('{invalid')).toBeNull()
  })

  it('ignores callbacks without permission action data', () => {
    expect(parseDingTalkPermissionCardAction({ action: 'open_url', url: 'https://example.com' })).toBeNull()
  })
})
