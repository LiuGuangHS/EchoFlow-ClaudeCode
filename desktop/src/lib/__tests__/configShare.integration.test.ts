import { describe, expect, it } from 'bun:test'
import {
  decodeConfigPayload,
  generateDeepLinkUrl,
  generateProviderDeepLinkUrl,
  parseDeepLinkUrl,
  validateConfigPayload,
} from '../configShare'
import { handleDeepLinkUrl } from '../deepLink'
import type { ShareableConfig } from '../../types/configShare'

const config: ShareableConfig = {
  version: 1,
  source: 'admin@echoflow.cn',
  timestamp: Date.now(),
  config: {
    providers: [{
      presetId: 'deepseek',
      name: 'DeepSeek (Shared)',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      models: { main: 'deepseek-chat', haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
    }],
  },
}

describe('configShare integration', () => {
  it('generates a link that parses, validates, decodes, and reaches the import action', () => {
    const link = generateDeepLinkUrl(config)
    const parsed = parseDeepLinkUrl(link)
    expect(parsed?.action).toBe('config/import')
    expect(parsed?.params.get('v')).toBe('1')
    const decoded = decodeConfigPayload(parsed!.params.get('data')!)
    expect(validateConfigPayload(decoded).valid).toBe(true)
    expect(handleDeepLinkUrl(link)).toEqual({ type: 'config/import', payload: config })
  })

  it('accepts the provider-oriented compatibility link', () => {
    expect(handleDeepLinkUrl(generateProviderDeepLinkUrl(config))).toEqual({
      type: 'config/import',
      payload: config,
    })
  })

  it('accepts a NewAPI provider template with address and key placeholders', () => {
    const action = handleDeepLinkUrl('echoflowcode://provider/add?v=1&base_url=https%3A%2F%2Fapi.newapi.example%2Fv1&api_key=sk-test&model=deepseek-chat')
    expect(action?.type).toBe('config/import')
    if (action?.type !== 'config/import') return
    expect(action.apiKey).toBe('sk-test')
    expect(action.payload.config.providers[0]?.baseUrl).toBe('https://api.newapi.example/v1')
    expect(action.payload.config.providers[0]?.models.main).toBe('deepseek-chat')
  })

  it('rejects a link containing a nested API key', () => {
    const malicious = {
      ...config,
      config: { providers: [{ ...config.config.providers[0], imageGeneration: { model: 'image', apiKey: 'secret' } }] },
    }
    expect(validateConfigPayload(malicious).error).toBe('contains_secrets')
    expect(handleDeepLinkUrl(generateDeepLinkUrl(malicious as ShareableConfig))).toBeNull()
  })

  it('rejects expired templates and templates with no provider entries', () => {
    expect(validateConfigPayload({ ...config, timestamp: Date.now() - 31 * 86400 * 1000 }).error).toBe('expired')
    expect(validateConfigPayload({ ...config, config: { providers: [] } }).valid).toBe(false)
  })
})
