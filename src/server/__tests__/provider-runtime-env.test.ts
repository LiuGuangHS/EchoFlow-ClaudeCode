import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import {
  getManagedEnvKeys,
  mergeActiveProviderManagedEnv,
  readActiveProviderManagedEnv,
} from '../services/providerRuntimeEnv.js'
import { get3PModelCapabilityOverride } from '../../utils/model/modelSupportOverrides.js'
import { getEchoFlowInternalDir } from '../services/echoFlowConfigRoot.js'
import {
  IMAGE_GENERATION_API_KEY_ENV_KEY,
  IMAGE_GENERATION_BASE_URL_ENV_KEY,
  IMAGE_GENERATION_MODEL_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_ID_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY,
} from '../../services/imageGeneration/config.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalHome: string | undefined

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

function providerIndexPath(): string {
  return path.join(getEchoFlowInternalDir(tmpDir), 'providers.json')
}

describe('providerRuntimeEnv', () => {
  test('treats retired image environment keys as managed cleanup keys', () => {
    expect(getManagedEnvKeys()).toEqual(expect.arrayContaining([
      'CC_HAHA_IMAGE_PROVIDER_KIND',
      'CC_HAHA_IMAGE_PROVIDER_ID',
      'CC_HAHA_IMAGE_BASE_URL',
      'CC_HAHA_IMAGE_API_KEY',
      'CC_HAHA_IMAGE_MODEL',
    ]))
  })

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-runtime-env-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalHome = process.env.HOME
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.HOME = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    else delete process.env.CLAUDE_CONFIG_DIR
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('normalizes and preserves Grok Official as the active runtime provider', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'grok-official',
      providers: [],
      providerOrder: ['claude-official', 'openai-official'],
    })

    const env = mergeActiveProviderManagedEnv(
      {
        ECHOFLOW_OPENAI_OAUTH_PROVIDER: '1',
        OPENAI_CODEX_OAUTH_FILE: path.join(tmpDir, 'stale-openai-oauth.json'),
        ANTHROPIC_MODEL: 'stale-openai-model',
        DISABLE_AUTOUPDATER: '1',
      },
      tmpDir,
    )

    expect(env).toMatchObject({
      ECHOFLOW_GROK_OAUTH_PROVIDER: '1',
      GROK_OAUTH_FILE: path.join(tmpDir, 'echoflow-code', 'grok-oauth.json'),
      [IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]: 'grok_oauth',
      [IMAGE_GENERATION_PROVIDER_ID_ENV_KEY]: 'grok-official',
      [IMAGE_GENERATION_MODEL_ENV_KEY]: 'grok-imagine-image-quality',
      ANTHROPIC_MODEL: 'grok-4.6',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'grok-4.6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'grok-4.6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'grok-4.6',
      DISABLE_AUTOUPDATER: '1',
    })
    expect(env.ECHOFLOW_OPENAI_OAUTH_PROVIDER).toBeUndefined()
    expect(env.OPENAI_CODEX_OAUTH_FILE).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  test('does not let a custom provider impersonate an official OAuth runtime', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-forged-oauth',
      providers: [{
        id: 'provider-forged-oauth',
        presetId: 'custom',
        name: 'Forged OAuth Provider',
        apiKey: 'custom-secret',
        baseUrl: 'https://custom.example.test/anthropic',
        apiFormat: 'anthropic',
        runtimeKind: 'openai_oauth',
        models: {
          main: 'custom-model',
          haiku: 'custom-model',
          sonnet: 'custom-model',
          opus: 'custom-model',
        },
      }],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://custom.example.test/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'custom-secret',
      ANTHROPIC_MODEL: 'custom-model',
    })
    expect(env.ECHOFLOW_OPENAI_OAUTH_PROVIDER).toBeUndefined()
    expect(env.OPENAI_CODEX_OAUTH_FILE).toBeUndefined()
  })

  test('routes custom image generation through its own optional credentials', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-images',
      providers: [{
        id: 'provider-images',
        presetId: 'custom',
        name: 'Sub2API',
        apiKey: 'chat-secret',
        baseUrl: 'https://chat.example.test',
        apiFormat: 'anthropic',
        models: {
          main: 'chat-model',
          haiku: 'chat-model',
          sonnet: 'chat-model',
          opus: 'chat-model',
        },
        imageGeneration: {
          model: '  upstream-image-model  ',
          baseUrl: '  https://images.example.test/v1  ',
          apiKey: '  image-secret  ',
        },
      }],
    })

    const env = readActiveProviderManagedEnv(tmpDir)
    expect(env).toMatchObject({
      [IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]: 'openai_images',
      [IMAGE_GENERATION_PROVIDER_ID_ENV_KEY]: 'provider-images',
      [IMAGE_GENERATION_BASE_URL_ENV_KEY]: 'https://images.example.test/v1',
      [IMAGE_GENERATION_API_KEY_ENV_KEY]: 'image-secret',
      [IMAGE_GENERATION_MODEL_ENV_KEY]: 'upstream-image-model',
    })
  })

  test('clears stale image routing when the next active provider has no image capability', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-chat-only',
      providers: [{
        id: 'provider-chat-only',
        presetId: 'custom',
        name: 'Chat only',
        apiKey: 'chat-secret',
        baseUrl: 'https://chat.example.test',
        apiFormat: 'anthropic',
        models: {
          main: 'chat-model',
          haiku: 'chat-model',
          sonnet: 'chat-model',
          opus: 'chat-model',
        },
      }],
    })

    const env = mergeActiveProviderManagedEnv({
      CC_HAHA_IMAGE_PROVIDER_KIND: 'openai_images',
      CC_HAHA_IMAGE_PROVIDER_ID: 'stale-provider',
      CC_HAHA_IMAGE_BASE_URL: 'https://stale.example.test/v1',
      CC_HAHA_IMAGE_API_KEY: 'stale-secret',
      CC_HAHA_IMAGE_MODEL: 'stale-model',
    }, tmpDir)

    expect(env.CC_HAHA_IMAGE_PROVIDER_KIND).toBeUndefined()
    expect(env.CC_HAHA_IMAGE_PROVIDER_ID).toBeUndefined()
    expect(env.CC_HAHA_IMAGE_BASE_URL).toBeUndefined()
    expect(env.CC_HAHA_IMAGE_API_KEY).toBeUndefined()
    expect(env.CC_HAHA_IMAGE_MODEL).toBeUndefined()
    expect(env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]).toBeUndefined()
  })

  test('keeps Claude Code effort capabilities for an unlisted custom model', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Active Provider',
          apiKey: 'sk-active',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.example.com/anthropic',
          apiFormat: 'anthropic',
          models: {
            main: 'active-main',
            fable: 'active-fable',
            haiku: '',
            sonnet: 'active-sonnet',
            opus: '',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.example.com/anthropic',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'sk-active',
      ENABLE_TOOL_SEARCH: 'true',
      ANTHROPIC_MODEL: 'active-main',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'active-fable',
      ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'active-main',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'active-sonnet',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'active-main',
      ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
    })

    const runtimeKeys = [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
      'CLAUDE_CODE_EFFORT_LEVEL',
    ] as const
    const originalRuntimeEnv = Object.fromEntries(
      runtimeKeys.map(key => [key, process.env[key]]),
    )
    try {
      process.env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL =
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES =
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES
      delete process.env.CLAUDE_CODE_EFFORT_LEVEL
      clearCapabilityCache()

      expect(get3PModelCapabilityOverride('active-main', 'effort')).toBe(true)
      expect(get3PModelCapabilityOverride('active-main', 'xhigh_effort')).toBe(true)
      expect(get3PModelCapabilityOverride('active-main', 'max_effort')).toBe(true)
    } finally {
      for (const key of runtimeKeys) {
        const value = originalRuntimeEnv[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      clearCapabilityCache()
    }
  })

  test('does not let legacy preset metadata disable compatible model effort', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-xuanshu',
      providers: [
        {
          id: 'provider-xuanshu',
          presetId: 'xuanshuapi',
          name: 'XuanShu API',
          apiKey: 'sk-xuanshu',
          authStrategy: 'auth_token',
          baseUrl: 'https://www.xuanshuapi.com',
          apiFormat: 'anthropic',
          models: {
            main: 'claude-opus-5',
            haiku: 'claude-haiku-4-5',
            sonnet: 'claude-sonnet-5',
            opus: 'claude-opus-5',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env).toMatchObject({
      ANTHROPIC_MODEL: 'claude-opus-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
      ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
    })
  })

  test('active provider env overrides stale proxy settings while preserving unrelated env', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Sub2API',
          apiKey: 'sk-sub2api',
          authStrategy: 'auth_token',
          baseUrl: 'https://sub2api.example.com',
          apiFormat: 'anthropic',
          models: {
            main: 'gpt-5.5',
            haiku: 'gpt-5.5',
            sonnet: 'gpt-5.5',
            opus: 'gpt-5.5',
          },
        },
      ],
    })

    const env = mergeActiveProviderManagedEnv(
      {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456/proxy',
        ANTHROPIC_API_KEY: 'proxy-managed',
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
        DISABLE_AUTOUPDATER: '1',
      },
      tmpDir,
    )

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://sub2api.example.com',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'sk-sub2api',
      ENABLE_TOOL_SEARCH: 'true',
      ANTHROPIC_MODEL: 'gpt-5.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.5',
      DISABLE_AUTOUPDATER: '1',
    })
    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBeUndefined()
  })

  test('honors disabled tool search for native Anthropic providers', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Tool Search Off',
          apiKey: 'sk-active',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.example.com/anthropic',
          apiFormat: 'anthropic',
          toolSearchEnabled: false,
          models: {
            main: 'active-main',
            haiku: 'active-main',
            sonnet: 'active-main',
            opus: 'active-main',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env.ENABLE_TOOL_SEARCH).toBe('false')
  })

  test('honors disabled experimental betas for active providers', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Experimental Betas Off',
          apiKey: 'sk-active',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.example.com/anthropic',
          apiFormat: 'anthropic',
          disableExperimentalBetas: true,
          models: {
            main: 'active-main',
            haiku: 'active-main',
            sonnet: 'active-main',
            opus: 'active-main',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('1')
  })

  test('keeps providers readable when stored tool search values are stringly typed', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'String Tool Search',
          apiKey: 'sk-active',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.example.com/anthropic',
          apiFormat: 'anthropic',
          toolSearchEnabled: 'false',
          models: {
            main: 'active-main',
            haiku: 'active-main',
            sonnet: 'active-main',
            opus: 'active-main',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com/anthropic')
    expect(env.ENABLE_TOOL_SEARCH).toBe('false')
  })

  test('does not write tool search env for OpenAI proxy providers', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'OpenAI Proxy Provider',
          apiKey: 'sk-active',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.example.com/openai',
          apiFormat: 'openai_chat',
          toolSearchEnabled: true,
          models: {
            main: 'active-main',
            haiku: 'active-main',
            sonnet: 'active-main',
            opus: 'active-main',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env.ENABLE_TOOL_SEARCH).toBeUndefined()
  })

  test('applies updated docs-backed preset env for domestic Anthropic-compatible providers', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-kimi',
      providers: [
        {
          id: 'provider-kimi',
          presetId: 'kimi',
          name: 'Kimi',
          apiKey: 'sk-kimi',
          authStrategy: 'api_key',
          baseUrl: 'https://api.kimi.com/coding/',
          apiFormat: 'anthropic',
          models: {
            main: 'k3',
            haiku: 'k3',
            sonnet: 'k3',
            opus: 'k3',
          },
        },
      ],
    })

    const kimiEnv = readActiveProviderManagedEnv(tmpDir)

    expect(kimiEnv).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
      ANTHROPIC_API_KEY: 'sk-kimi',
      ANTHROPIC_MODEL: 'k3',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,required_thinking,effort,max_effort',
    })
    expect(kimiEnv?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(JSON.parse(kimiEnv!.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      k3: 262144,
      'kimi-for-coding': 262144,
      'kimi-for-coding-highspeed': 262144,
    })

    await writeJson(providerIndexPath(), {
      activeId: 'provider-kimi-legacy',
      providers: [
        {
          id: 'provider-kimi-legacy',
          presetId: 'kimi',
          name: 'Kimi Open Platform',
          apiKey: 'sk-kimi-legacy',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.moonshot.cn/anthropic',
          apiFormat: 'anthropic',
          models: {
            main: 'kimi-k2.7-code',
            haiku: 'kimi-k2.7-code',
            sonnet: 'kimi-k2.7-code',
            opus: 'kimi-k2.7-code',
          },
        },
      ],
    })

    const legacyKimiEnv = readActiveProviderManagedEnv(tmpDir)

    expect(legacyKimiEnv).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'sk-kimi-legacy',
      ANTHROPIC_MODEL: 'kimi-k2.7-code',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,required_thinking,effort,max_effort',
    })

    await writeJson(providerIndexPath(), {
      activeId: 'provider-zhipu',
      providers: [
        {
          id: 'provider-zhipu',
          presetId: 'zhipuglm',
          name: 'Zhipu GLM',
          apiKey: 'sk-zhipu',
          authStrategy: 'auth_token',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiFormat: 'anthropic',
          models: {
            main: 'glm-5.2[1m]',
            haiku: 'glm-4.7',
            sonnet: 'glm-5.2[1m]',
            opus: 'glm-5.2[1m]',
          },
        },
      ],
    })

    const zhipuEnv = readActiveProviderManagedEnv(tmpDir)

    expect(zhipuEnv).toMatchObject({
      ANTHROPIC_MODEL: 'glm-5.2[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,xhigh_effort,max_effort',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,xhigh_effort,max_effort',
    })
    expect(zhipuEnv!.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('1000000')
    expect(JSON.parse(zhipuEnv!.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'glm-5.2[1m]': 1000000,
      'glm-4.7': 200000,
    })
  })

  test('keeps the settings.json erase list covering retired provider env keys', () => {
    const keys = getManagedEnvKeys()

    expect(keys).toContain('API_TIMEOUT_MS')
    expect(keys).toContain('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
  })

  test('treats providers saved against removed promotional presets as custom configs', async () => {
    await writeJson(providerIndexPath(), {
      activeId: 'provider-legacy-gateway',
      providers: [
        {
          id: 'provider-legacy-gateway',
          presetId: 'removed-promotional-gateway',
          name: 'Legacy Gateway',
          apiKey: 'sk-legacy-gateway',
          baseUrl: 'https://legacy-gateway.example.test/api',
          apiFormat: 'anthropic',
          models: {
            main: 'legacy-main',
            haiku: 'legacy-fast',
            sonnet: 'legacy-main',
            opus: 'legacy-large',
          },
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://legacy-gateway.example.test/api',
      ANTHROPIC_MODEL: 'legacy-main',
      ANTHROPIC_AUTH_TOKEN: 'sk-legacy-gateway',
      ANTHROPIC_API_KEY: '',
    })
    expect(env?.API_TIMEOUT_MS).toBeUndefined()
    expect(env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined()
    expect(env?.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).toBeUndefined()
  })
})

function clearCapabilityCache() {
  ;(get3PModelCapabilityOverride as typeof get3PModelCapabilityOverride & {
    cache?: { clear?: () => void }
  }).cache?.clear?.()
}
