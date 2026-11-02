import { describe, expect, it, vi } from 'vitest'
import { encodeConfigPayload } from '../../src/lib/configShare'
import type { ShareableConfig } from '../../src/types/configShare'
import { DeepLinkHandler, extractDeepLinkFromArgs } from './deepLinkHandler'

const config: ShareableConfig = {
  version: 1,
  source: 'test',
  timestamp: Date.now(),
  config: { providers: [{
    presetId: 'anthropic',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com',
    apiFormat: 'anthropic',
    models: { main: 'opus', haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  }] },
}

describe('deep link handler', () => {
  it('keeps an import received before the window is ready until the renderer acknowledges it', () => {
    const notify = vi.fn()
    const handler = new DeepLinkHandler(notify)
    const url = `echoflowcode://config/import?v=1&data=${encodeConfigPayload(config)}`

    handler.handle(url)
    expect(notify).toHaveBeenCalledOnce()
    expect(handler.take()).toEqual({ config })
    expect(handler.take()).toEqual({ config })

    handler.ack()
    expect(handler.take()).toBeNull()
  })

  it('replaces malformed links with a safe invalid-link result', () => {
    const handler = new DeepLinkHandler(vi.fn())
    handler.handle('echoflowcode://config/import?v=1&data=broken')
    expect(handler.take()).toEqual({ invalid: true })
  })

  it('extracts protocol links from launch arguments', () => {
    expect(extractDeepLinkFromArgs(['/app', 'echoflowcode://config/import?v=1'])).toBe('echoflowcode://config/import?v=1')
    expect(extractDeepLinkFromArgs(['/app'])).toBeNull()
  })
})