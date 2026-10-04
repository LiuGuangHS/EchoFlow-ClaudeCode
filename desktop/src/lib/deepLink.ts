import { parseDeepLinkUrl, decodeConfigPayload, validateConfigPayload, type ShareableConfig } from './configShare'

export type DeepLinkAction =
  | { type: 'config/import'; payload: ShareableConfig; apiKey?: string }
  | { type: 'unknown'; url: string }

/**
 * Handle deep link URL and return action
 */
export function handleDeepLinkUrl(url: string): DeepLinkAction | null {
  const parsed = parseDeepLinkUrl(url)
  if (!parsed) return null

  const { action, params } = parsed

  // Handle config import and the provider-oriented compatibility alias.
  if (action === 'config/import' || action === 'provider/add') {
    const version = params.get('v')
    const data = params.get('data')

    if (version !== '1') return { type: 'unknown', url }

    try {
      if (!data && action === 'provider/add') {
        const baseUrl = params.get('base_url') || params.get('address')
        const apiKey = params.get('api_key') || params.get('key') || ''
        if (!baseUrl) return { type: 'unknown', url }
        const payload: ShareableConfig = {
          version: 1,
          source: 'NewAPI',
          timestamp: Date.now(),
          config: { providers: [{
            presetId: 'custom',
            name: params.get('name') || 'NewAPI Provider',
            baseUrl,
            apiFormat: 'openai_chat',
            models: { main: params.get('model') || 'default', haiku: params.get('model') || 'default', sonnet: params.get('model') || 'default', opus: params.get('model') || 'default' },
          }] },
        }
        const validation = validateConfigPayload(payload)
        return validation.valid ? { type: 'config/import', payload, apiKey } : null
      }
      if (!data) return { type: 'unknown', url }
      const payload = decodeConfigPayload(data)
      const validation = validateConfigPayload(payload)

      if (!validation.valid) {
        console.error('Config validation failed:', validation.message)
        return null
      }

      return { type: 'config/import', payload }
    } catch (err) {
      console.error('Failed to decode config payload:', err)
      return null
    }
  }

  return { type: 'unknown', url }
}
