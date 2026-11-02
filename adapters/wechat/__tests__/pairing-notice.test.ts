import { describe, expect, it } from 'bun:test'
import { buildWechatPairingNotice } from '../pairing-notice.js'

describe('WeChat pairing notice', () => {
  it('names our product in both the paired and the refused copy', () => {
    expect(buildWechatPairingNotice(true)).toContain('EchoFlow')
    expect(buildWechatPairingNotice(false)).toContain('EchoFlow Code')
    expect(buildWechatPairingNotice(true)).not.toContain('Claude')
    expect(buildWechatPairingNotice(false)).not.toContain('Claude')
  })
})
