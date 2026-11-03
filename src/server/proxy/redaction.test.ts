import { describe, expect, test } from 'bun:test'
import { redactJson, redactText, restoreText } from './redaction.js'

describe('local request redaction', () => {
  test('replaces secrets, emails, and custom words with restorable placeholders', () => {
    const result = redactText('Deploy Nightjar with sk-test-secretvalue and mail a@b.co', {
      enabled: true,
      personalInfo: true,
      customWords: ['Nightjar'],
    }, 'test-key')

    expect(result.text).not.toContain('sk-test-secretvalue')
    expect(result.text).not.toContain('a@b.co')
    expect(result.text).not.toContain('Nightjar')
    expect(restoreText(result.text, result.values)).toBe('Deploy Nightjar with sk-test-secretvalue and mail a@b.co')
  })

  test('uses stable placeholders without redacting structural model fields', () => {
    const settings = { enabled: true, personalInfo: true, customWords: [] }
    const input = { model: 'sk-test-secretvalue', messages: [{ role: 'user', content: 'a@b.co' }] }
    const first = redactJson(input, settings, 'test-key')
    const second = redactJson(input, settings, 'test-key')
    expect(JSON.parse(first.text).model).toBe(input.model)
    expect(first.text).toBe(second.text)
    expect(restoreText(first.text, first.values)).toContain('a@b.co')
  })

  test('redacts sensitive values in generic name and id fields while preserving protocol identifiers', () => {
    const settings = { enabled: true, personalInfo: false, customWords: ['Nightjar'] }
    const result = redactJson({
      metadata: { name: 'Nightjar sk-test-secretvalue', id: 'Nightjar' },
      tools: [{ name: 'Nightjar', input_schema: {} }],
      content: [{ type: 'tool_use', id: 'Nightjar', name: 'Nightjar', input: {} }],
    }, settings, 'test-key')
    const redacted = JSON.parse(result.text) as {
      metadata: { name: string; id: string }
      tools: Array<{ name: string }>
      content: Array<{ id: string; name: string }>
    }
    expect(redacted.metadata.name).toMatch(/^\{\{TERM_/)
    expect(redacted.metadata.name).not.toContain('sk-test-secretvalue')
    expect(redacted.metadata.id).toMatch(/^\{\{TERM_/)
    expect(redacted.tools[0]?.name).toBe('Nightjar')
    expect(redacted.content[0]?.id).toBe('Nightjar')
    expect(redacted.content[0]?.name).toBe('Nightjar')
    expect(restoreText(result.text, result.values)).toContain('"name":"Nightjar"')
  })

  test('redacts checksum-valid personal identifiers but keeps invalid numbers', () => {
    const result = redactText('phone 13800138000, id 11010519491231002X, card 4111111111111111, fake 4111111111111112', {
      enabled: true, personalInfo: true, customWords: [],
    }, 'test-key')
    expect(result.text).not.toContain('13800138000')
    expect(result.text).not.toContain('11010519491231002X')
    expect(result.text).not.toContain('4111111111111111')
    expect(result.text).toContain('4111111111111112')
  })

  test('uses request-scoped placeholder keys across independent payloads', () => {
    const settings = { enabled: true, personalInfo: true, customWords: [] }
    const first = redactJson({ messages: [{ content: 'sk-test-secretvalue' }] }, settings)
    const second = redactJson({ messages: [{ content: 'sk-test-secretvalue' }] }, settings)
    expect(first.text).not.toBe(second.text)
    expect(restoreText(first.text, first.values)).toContain('sk-test-secretvalue')
    expect(restoreText(second.text, second.values)).toContain('sk-test-secretvalue')
  })

  test('keeps custom words from rewriting a placeholder another rule inserted', () => {
    const result = redactText('contact alice@example.com today', { enabled: true, personalInfo: true, customWords: ['email'] }, 'test-key')
    expect(result.text).not.toContain('alice@example.com')
    expect(result.text).toContain('{{EMAIL_')
    expect(restoreText(result.text, result.values)).toBe('contact alice@example.com today')
  })

  test('does not let the PASSWORD rule consume an API key placeholder', () => {
    const secret = 'sk-test-0123456789abcdef'
    const result = redactText(`token=${secret}`, { enabled: true, personalInfo: false, customWords: [] }, 'test-key')
    expect(result.text).not.toContain(secret)
    expect(restoreText(result.text, result.values)).toBe(`token=${secret}`)
  })

  test('redacts quoted secrets containing spaces as one value', () => {
    const result = redactText('token="pass phrase with spaces"', { enabled: true, personalInfo: false, customWords: [] }, 'test-key')
    expect(result.text).not.toContain('pass phrase with spaces')
    expect(restoreText(result.text, result.values)).toBe('token="pass phrase with spaces"')
  })

  test('escapes a restored value when the target is JSON text', () => {
    const original = 'line1\nline2 "q" \\'
    const result = redactJson({ content: original }, { enabled: true, personalInfo: false, customWords: [original] }, 'test-key')
    const escaped = restoreText(JSON.stringify({ content: [...result.values.keys()][0] }), result.values, value => JSON.stringify(value).slice(1, -1))
    expect(JSON.parse(escaped).content).toBe(original)
  })

  test('preserves short signed URLs in media attachment fields', () => {
    const url = 'https://cdn.example/image.png?token=short-secret'
    const result = redactJson({ content: [{ type: 'image_url', image_url: { url } }] }, {
      enabled: true,
      personalInfo: false,
      customWords: [],
    }, 'test-key')

    expect(JSON.parse(result.text).content[0].image_url.url).toBe(url)
    expect(result.values.size).toBe(0)
  })

  test('does not redact when disabled', () => {
    const result = redactText('sk-test-secretvalue', { enabled: false, personalInfo: true, customWords: [] }, 'test-key')
    expect(result.text).toBe('sk-test-secretvalue')
    expect(result.values.size).toBe(0)
  })
})
