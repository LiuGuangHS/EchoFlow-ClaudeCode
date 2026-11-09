import { describe, expect, it } from 'vitest'

import { BUNDLED_PROVIDER_PRESETS, presetMatchesBaseUrl, selectableProviderPresets } from './providerPresets'
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
      'opencode-go',
      'lmstudio',
      'ollama',
      'custom',
    ])
    expect(selectableIds).toEqual(bundledIds)
  })

  it('excludes promotional gateway presets and referral metadata', () => {
    const forbiddenPresetIds = ['jiekouai', 'shengsuanyun', 'teamorouter', 'xuanshuapi']
    const bundledIds = BUNDLED_PROVIDER_PRESETS.map((preset) => preset.id)

    for (const presetId of forbiddenPresetIds) {
      expect(bundledIds).not.toContain(presetId)
    }
    for (const preset of BUNDLED_PROVIDER_PRESETS) {
      expect(preset.deprecated).not.toBe(true)
      expect(`${preset.websiteUrl} ${preset.apiKeyUrl ?? ''} ${preset.promoText ?? ''}`).not.toMatch(
        /teamorouter|jiekou|shengsuanyun|xuanshuapi|fennoai|qiniuai|atlas|aruhub|modelflare|apismart|openrouter|magpie|[?&](?:ref|referral|invite|code|aff|source|utm_[^=]+)=/i,
      )
    }
  })


  it('defaults MiniMax to the China endpoint while retaining the global endpoint', () => {
    const minimax = BUNDLED_PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')

    expect(minimax?.baseUrl).toBe('https://api.minimaxi.com/anthropic')
    expect(minimax?.regionalEndpoints).toEqual([
      { region: 'cn_zh', baseUrl: 'https://api.minimaxi.com/anthropic' },
      { region: 'global_en', baseUrl: 'https://api.minimax.io/anthropic' },
    ])
  })

  it('matches the MiniMax preset for either regional endpoint', () => {
    const minimax = BUNDLED_PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')

    expect(minimax && presetMatchesBaseUrl(minimax, 'https://api.minimax.io/anthropic')).toBe(true)
    expect(minimax && presetMatchesBaseUrl(minimax, 'https://api.minimaxi.com/anthropic')).toBe(true)
  })

  it('defaults Zhipu GLM to China while retaining its official global endpoint', () => {
    const zhipu = BUNDLED_PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')

    expect(zhipu?.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(zhipu?.regionalEndpoints).toEqual([
      { region: 'cn_zh', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
      { region: 'global_en', baseUrl: 'https://api.z.ai/api/anthropic' },
    ])
    expect(zhipu?.reasoningProviderKind).toBe('zhipu_standard_api')
    expect(zhipu?.defaultModels).toEqual({
      main: 'glm-5.3[1m]',
      haiku: 'glm-5.3-flash[1m]',
      sonnet: 'glm-5.3[1m]',
      opus: 'glm-5.3[1m]',
    })
    expect(zhipu?.modelContextWindows?.['glm-5.3']).toBe(1000000)
    expect(zhipu?.modelContextWindows?.['glm-5.3-flash']).toBe(1000000)
    expect(zhipu && presetMatchesBaseUrl(zhipu, ' HTTPS://API.Z.AI/api/anthropic/ ')).toBe(true)
  })

  it('keeps Kimi Code on its only official Anthropic-compatible endpoint', () => {
    const kimi = BUNDLED_PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')

    expect(kimi?.baseUrl).toBe('https://api.kimi.com/coding/')
    expect(kimi?.regionalEndpoints).toBeUndefined()
  })

  // The bundle ships the same JSON the server parses, so a field the desktop type
  // forgot to mirror would be invisible in the form while still steering requests.
  it('bundles the OpenCode Go rules the server resolves from', () => {
    const preset = BUNDLED_PROVIDER_PRESETS.find((candidate) => candidate.id === 'opencode-go')

    expect(preset?.baseUrl).toBe('https://opencode.ai/zen/go/v1')
    expect(preset?.apiFormat).toBe('openai_chat')
    expect(preset?.authStrategy).toBe('api_key')
    expect(preset?.modelApiFormats).toEqual([
      { prefixes: ['grok-', 'gpt-', 'muse-spark-'], apiFormat: 'openai_responses' },
      { prefixes: ['minimax-', 'qwen', 'union-alpha'], apiFormat: 'anthropic' },
      { prefixes: ['gemini-'], apiFormat: 'gemini', baseUrl: '/inference/go/google/v1beta' },
    ])
    expect(preset?.upstreamHeaders).toEqual({
      'User-Agent': 'echoflow-code/$VERSION',
      'x-opencode-session': '$SESSION_ID',
    })
    expect(selectableProviderPresets(BUNDLED_PROVIDER_PRESETS).map((candidate) => candidate.id))
      .toContain('opencode-go')
  })
})
