import { parseDeepLinkUrl, decodeConfigPayload, validateConfigPayload, type ShareableConfig } from './configShare'

export type DeepLinkAction =
  | { type: 'config/import'; payload: ShareableConfig }
  | { type: 'unknown'; url: string }

/**
 * Handle deep link URL and return action
 */
export function handleDeepLinkUrl(url: string): DeepLinkAction | null {
  const parsed = parseDeepLinkUrl(url)
  if (!parsed) return null

  const { action, params } = parsed

  // Handle config import: echoflowcode://config/import?v=1&data=...
  if (action === 'config/import') {
    const version = params.get('v')
    const data = params.get('data')

    if (!data || version !== '1') {
      return { type: 'unknown', url }
    }

    try {
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
