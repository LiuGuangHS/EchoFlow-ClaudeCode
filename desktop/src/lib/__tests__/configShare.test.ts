import { describe, expect, it } from 'vitest'
import { encodeConfigPayload, decodeConfigPayload, validateConfigPayload, parseDeepLinkUrl } from '../configShare'
import type { ShareableConfig } from '../../types/configShare'

const config: ShareableConfig = {
  version: 1,
  source: 'admin',
  timestamp: Date.now(),
  config: { providers: [{
    presetId: 'anthropic',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com',
    apiFormat: 'anthropic',
    models: { main: 'opus', haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  }] },
}

describe('configShare', () => {
  it('encodes and decodes URL-safe payloads', () => {
    const encoded = encodeConfigPayload(config)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeConfigPayload(encoded)).toEqual(config)
  })

  it('parses config import links', () => {
    const parsed = parseDeepLinkUrl(`echoflowcode://config/import?v=1&data=${encodeConfigPayload(config)}`)
    expect(parsed?.action).toBe('config/import')
    expect(parsed?.params.get('v')).toBe('1')
    expect(decodeConfigPayload(parsed!.params.get('data')!)).toEqual(config)
  })

  it('rejects unsupported versions, malformed providers, and future timestamps', () => {
    expect(validateConfigPayload({ ...config, version: 9 }).valid).toBe(false)
    expect(validateConfigPayload({ ...config, timestamp: Date.now() + 6 * 60_000 }).valid).toBe(false)
    expect(validateConfigPayload({ ...config, config: { providers: [{ ...config.config.providers[0], baseUrl: 'javascript:alert(1)' }] } }).valid).toBe(false)
  })

  it('rejects credentials even when nested in provider configuration', () => {
    const payload = { ...config, config: { providers: [{ ...config.config.providers[0], imageGeneration: { model: 'image', apiKey: 'secret' } }] } }
    expect(validateConfigPayload(payload).error).toBe('contains_secrets')
  })
})