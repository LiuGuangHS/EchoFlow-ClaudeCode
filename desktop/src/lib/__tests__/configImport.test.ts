import { describe, expect, it } from 'bun:test'
import { importConfig } from '../configImport'
import type { ShareableConfig } from '../../types/configShare'
import type { SavedProvider } from '../../types/provider'

const shared = (name: string, baseUrl: string) => ({
  presetId: 'custom',
  name,
  baseUrl,
  apiFormat: 'openai_chat' as const,
  authStrategy: 'api_key' as const,
  models: { main: 'model', haiku: 'model', sonnet: 'model', opus: 'model' },
})

const config: ShareableConfig = {
  version: 1,
  source: 'test',
  timestamp: Date.now(),
  config: { providers: [shared('Already There', 'https://api.example.com/'), shared('New', 'https://new.example.com')] },
}

const existing: SavedProvider = {
  id: 'local', presetId: 'custom', name: 'already there', baseUrl: 'https://api.example.com',
  apiFormat: 'openai_chat', apiKey: 'keep-this-local',
  models: { main: 'old', haiku: 'old', sonnet: 'old', opus: 'old' },
}

describe('importConfig', () => {
  it('skips matching providers without overwriting credentials and creates new providers without keys', async () => {
    const created: unknown[] = []
    const result = await importConfig(config, {
      providers: [existing],
      createProvider: async input => { created.push(input) },
    })

    expect(result).toEqual({ imported: 1, skipped: 1, skippedNames: ['Already There'] })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ name: 'New', apiKey: '' })
  })

  it('does not create duplicate entries from the same shared payload', async () => {
    const created: unknown[] = []
    const duplicateConfig = { ...config, config: { providers: [shared('Same', 'https://api.example.com'), shared('Same', 'https://api.example.com/')] } }
    const result = await importConfig(duplicateConfig, { providers: [], createProvider: async input => { created.push(input) } })

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(created).toHaveLength(1)
  })
})
