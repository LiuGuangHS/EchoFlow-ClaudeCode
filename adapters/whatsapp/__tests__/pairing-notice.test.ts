import { describe, expect, it } from 'bun:test'
import { buildWhatsAppPairingNotice } from '../pairing-notice.js'

describe('WhatsApp pairing notice', () => {
  it('names our product in both the paired and the refused copy', () => {
    expect(buildWhatsAppPairingNotice(true)).toContain('EchoFlow')
    expect(buildWhatsAppPairingNotice(false)).toContain('EchoFlow Code')
    expect(buildWhatsAppPairingNotice(true)).not.toContain('Claude')
    expect(buildWhatsAppPairingNotice(false)).not.toContain('Claude')
  })
})
