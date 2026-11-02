import { describe, expect, it } from 'vitest'
import { encodeConfigPayload, validateConfigPayload } from '../configShare'
import { handleDeepLinkUrl } from '../deepLink'
import type { ShareableConfig } from '../../types/configShare'

const config: ShareableConfig = {
  version: 1,
  source: 'team-admin',
  timestamp: Date.now(),
  config: {
    providers: [{
      presetId: 'deepseek',
      name: 'DeepSeek (Team)',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      models: { main: 'deepseek-chat', haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
    }],
  },
}

function configLink(payload: unknown = config): string {
  return `echoflowcode://config/import?v=1&data=${encodeConfigPayload(payload as ShareableConfig)}`
}

describe('configShare integration', () => {
  it('validates and routes an encoded config link to the import action', () => {
    const link = configLink()
    const action = handleDeepLinkUrl(link)
    expect(action).toEqual({ type: 'config/import', payload: config })
    if (action?.type !== 'config/import') return
    expect(validateConfigPayload(action.payload).valid).toBe(true)
  })

  it('accepts the provider-oriented compatibility link', () => {
    const link = configLink().replace('config/import', 'provider/add')
    expect(handleDeepLinkUrl(link)).toEqual({ type: 'config/import', payload: config })
  })

  it('accepts a NewAPI provider link with its supplied API key', () => {
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
    expect(handleDeepLinkUrl(configLink(malicious))).toBeNull()
  })

  it('rejects expired templates and templates with no provider entries', () => {
    expect(validateConfigPayload({ ...config, timestamp: Date.now() - 31 * 86400 * 1000 }).error).toBe('expired')
    expect(validateConfigPayload({ ...config, config: { providers: [] } }).valid).toBe(false)
  })
})
