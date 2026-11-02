import { describe, expect, it } from 'bun:test'
import { buildFeishuPairingNotice } from '../pairing-notice.js'

describe('Feishu pairing notice', () => {
  it('names our product in both the paired and the refused copy', () => {
    expect(buildFeishuPairingNotice(true)).toContain('EchoFlow')
    expect(buildFeishuPairingNotice(false)).toContain('EchoFlow Code')
    expect(buildFeishuPairingNotice(true)).not.toContain('Claude')
    expect(buildFeishuPairingNotice(false)).not.toContain('Claude')
  })
})
