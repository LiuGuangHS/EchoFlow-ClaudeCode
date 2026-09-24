import { describe, expect, it } from 'bun:test'
import {
  encodeConfigPayload,
  decodeConfigPayload,
  validateConfigPayload,
  sanitizeProviderForSharing,
  generateDeepLinkUrl,
  parseDeepLinkUrl,
} from '../configShare'
import type { ShareableConfig } from '../../types/configShare'
import type { SavedProvider } from '../../types/provider'

const provider: SavedProvider = {
  id: 'local-id',
  presetId: 'anthropic',
  name: 'Test Provider',
  baseUrl: 'https://api.test.com',
  apiFormat: 'anthropic',
  apiKey: 'secret-key-123',
  keyPreview: '••••123',
  models: { main: 'opus', haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  authStrategy: 'api_key',
  imageGeneration: { model: 'image-model', apiKey: 'image-secret' },
  credentialSource: { kind: 'echoflow-token', endpoint: 'main', tokenId: 'private-id' },
  requestCompatibility: { maxOutputTokens: 1000, privateExtension: 'must-not-share' },
}

const config: ShareableConfig = {
  version: 1,
  source: 'admin',
  timestamp: Date.now(),
  config: { providers: [sanitizeProviderForSharing(provider)] },
}

describe('configShare', () => {
  it('encodes a compact URL-safe payload and round-trips the provider template', () => {
    const encoded = encodeConfigPayload(config)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeConfigPayload(encoded)).toEqual(config)
  })

  it('generates the registered EchoFlow config import deep link', () => {
    const link = generateDeepLinkUrl(config)
    expect(link).toMatch(/^echoflowcode:\/\/config\/import\?v=1&data=/)
    const parsed = parseDeepLinkUrl(link)
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
    const payload = {
      ...config,
      config: { providers: [{ ...config.config.providers[0], imageGeneration: { model: 'image', apiKey: 'secret' } }] },
    }
    expect(validateConfigPayload(payload).error).toBe('contains_secrets')
  })

  it('serializes only portable provider settings and strips credentials and local metadata', () => {
    const sanitized = sanitizeProviderForSharing(provider)
    expect(sanitized).not.toHaveProperty('apiKey')
    expect(sanitized).not.toHaveProperty('id')
    expect(sanitized).not.toHaveProperty('keyPreview')
    expect(sanitized).not.toHaveProperty('credentialSource')
    expect(sanitized.imageGeneration).toEqual({ model: 'image-model' })
    expect(sanitized.requestCompatibility).toEqual({ maxOutputTokens: 1000 })
  })
})
