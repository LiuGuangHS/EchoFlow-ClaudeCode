import { describe, expect, it } from 'vitest'

import { BUNDLED_PROVIDER_PRESETS, selectableProviderPresets } from './providerPresets'
import type { ProviderPreset } from '../types/providerPreset'

function makePreset(overrides: Partial<ProviderPreset> & { id: string }): ProviderPreset {
  return {
    name: overrides.id,
    baseUrl: `https://example.test/${overrides.id}`,
    apiFormat: 'anthropic',
    defaultModels: { main: 'm', haiku: 'm', sonnet: 'm', opus: 'm' },
    needsApiKey: true,
    websiteUrl: '',
    ...overrides,
  }
}

describe('selectableProviderPresets', () => {
  it('drops retired presets and keeps the rest in order', () => {
    const presets = [
      makePreset({ id: 'keep-a' }),
      makePreset({ id: 'retired', deprecated: true }),
      makePreset({ id: 'keep-b' }),
    ]

    expect(selectableProviderPresets(presets).map((preset) => preset.id)).toEqual([
      'keep-a',
      'keep-b',
    ])
  })

  it('keeps presets that explicitly opt out of retirement', () => {
    const presets = [makePreset({ id: 'live', deprecated: false })]

    expect(selectableProviderPresets(presets)).toHaveLength(1)
  })
})

describe('bundled provider presets', () => {
  it('contains only approved official, local, EchoFlow, and custom entries', () => {
    const bundledIds = BUNDLED_PROVIDER_PRESETS.map((preset) => preset.id)
    const selectableIds = selectableProviderPresets(BUNDLED_PROVIDER_PRESETS)
      .map((preset) => preset.id)

    expect(bundledIds).toEqual([
      'official',
      'echoflowai',
      'deepseek',
      'zhipuglm',
      'kimi',
      'minimax',
      'lmstudio',
      'ollama',
      'custom',
    ])
    expect(selectableIds).toEqual(bundledIds)
  })

  it('excludes promotional gateway presets and referral metadata', () => {
    const forbiddenPresetIds = ['jiekouai', 'shengsuanyun', 'teamorouter']
    const bundledIds = BUNDLED_PROVIDER_PRESETS.map((preset) => preset.id)

    for (const presetId of forbiddenPresetIds) {
      expect(bundledIds).not.toContain(presetId)
    }
    for (const preset of BUNDLED_PROVIDER_PRESETS) {
      expect(`${preset.websiteUrl} ${preset.apiKeyUrl ?? ''}`).not.toMatch(
        /teamorouter|jiekou|shengsuanyun|[?&](?:ref|referral|invite|source|utm_[^=]+)=/i,
      )
    }
  })
})
