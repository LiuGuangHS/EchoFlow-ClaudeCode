import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS, ProviderPresetSchema } from '../config/providerPresets.js'
import { getEchoFlowInternalDir } from '../services/echoFlowConfigRoot.js'
import { buildProviderManagedEnv, providerNeedsProxy } from '../services/providerRuntimeEnv.js'
import { resolveModelApiFormat } from '../../shared/modelApiFormats.js'
import { resolveUpstreamHeaders } from '../proxy/upstreamHeaders.js'
import { IMAGE_GENERATION_PROTOCOL_ENV_KEY } from '../../services/imageGeneration/config.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-presets-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

describe('provider presets API', () => {
  test('GET /api/providers/presets returns the configured presets', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ presets: PROVIDER_PRESETS })
  })

  test('exposes only approved official, local, EchoFlow, and custom presets', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
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
    expect(PROVIDER_PRESETS.at(-3)?.id).toBe('lmstudio')
    expect(PROVIDER_PRESETS.at(-2)?.id).toBe('ollama')
    expect(PROVIDER_PRESETS.at(-1)?.id).toBe('custom')
  })

  test('uses documented current provider models and regional endpoints', () => {
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))
    const echoflow = byId.get('echoflowai')
    const deepseek = byId.get('deepseek')
    const zhipu = byId.get('zhipuglm')
    const kimi = byId.get('kimi')
    const minimax = byId.get('minimax')

    expect(echoflow).toMatchObject({
      baseUrl: 'https://api.echoflowai.cc',
      authStrategy: 'auth_token',
      defaultModels: {
        main: 'claude-sonnet-5-5',
        fable: 'claude-fable-5-1',
        haiku: 'claude-haiku-5-5',
        sonnet: 'claude-sonnet-5-5',
        opus: 'claude-opus-5-5',
      },
      modelContextWindows: {
        'claude-sonnet-4-6': 1_000_000,
        'claude-opus-4-7': 1_000_000,
        'claude-haiku-4-5': 200_000,
      },
    })
    expect(deepseek).toMatchObject({
      baseUrl: 'https://api.deepseek.com/anthropic',
      authStrategy: 'auth_token',
      defaultModels: {
        main: 'deepseek-flash[1m]',
        haiku: 'deepseek-flash[1m]',
        sonnet: 'deepseek-flash[1m]',
        opus: 'deepseek-flash[1m]',
      },
    })
    expect(zhipu?.regionalEndpoints).toEqual([
      { region: 'cn_zh', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
      { region: 'global_en', baseUrl: 'https://api.z.ai/api/anthropic' },
    ])
    expect(kimi).toMatchObject({
      baseUrl: 'https://api.kimi.com/coding/',
      authStrategy: 'api_key',
      defaultModels: { main: 'k3' },
    })
    expect(kimi?.regionalEndpoints).toBeUndefined()
    expect(minimax?.regionalEndpoints).toEqual([
      { region: 'cn_zh', baseUrl: 'https://api.minimaxi.com/anthropic' },
      { region: 'global_en', baseUrl: 'https://api.minimax.io/anthropic' },
    ])
  })

  test('preserves provider capability defaults and model context windows', () => {
    const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]))
    const deepseek = byId.get('deepseek')
    const zhipu = byId.get('zhipuglm')
    const kimi = byId.get('kimi')
    const minimax = byId.get('minimax')

    // After upstream merge, defaultEnv has been cleared for all providers
    expect(deepseek?.defaultEnv).toEqual({})
    expect(zhipu?.defaultEnv).toEqual({})
    expect(kimi?.defaultEnv).toEqual({})
    expect(minimax?.defaultEnv).toEqual({})

    for (const id of ['echoflowai', 'deepseek', 'zhipuglm', 'kimi', 'minimax']) {
      const preset = byId.get(id)!
      expect(preset.modelContextWindows?.[preset.defaultModels.main]).toBeGreaterThan(0)
    }
  })

  test('does not expose sponsor, relay, or referral metadata', () => {
    const serialized = JSON.stringify(PROVIDER_PRESETS)
    expect(serialized).not.toMatch(
      /teamorouter|jiekouai|shengsuanyun|xuanshuapi|fennoai|qiniuai|atlascloud|aruhub|modelflare|apismart|openrouter|magpie|[?&](?:ref|referral|invite|code|aff|source|utm_[^=]+)=/i,
    )
  })

  test('preserves EchoFlow settings isolation', async () => {
    const initial = {
      env: { ANTHROPIC_MODEL: 'glm-5.1' },
      model: 'glm-5.1',
    }
    await fs.mkdir(getEchoFlowInternalDir(tmpDir), { recursive: true })
    await fs.writeFile(
      path.join(getEchoFlowInternalDir(tmpDir), 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getRequest = makeRequest('GET', '/api/providers/settings')
    const getResponse = await handleProvidersApi(
      getRequest.req,
      getRequest.url,
      getRequest.segments,
    )
    expect(await getResponse.json()).toEqual(initial)

    const update = {
      model: 'kimi-k2.6',
      env: { ANTHROPIC_MODEL: 'kimi-k2.6' },
    }
    const putRequest = makeRequest('PUT', '/api/providers/settings', update)
    const putResponse = await handleProvidersApi(
      putRequest.req,
      putRequest.url,
      putRequest.segments,
    )
    expect(putResponse.status).toBe(200)
    expect(JSON.parse(await fs.readFile(
      path.join(getEchoFlowInternalDir(tmpDir), 'settings.json'),
      'utf-8',
    ))).toEqual(update)
  })
  test('exposes Flash with 1M in every DeepSeek slot and carries it into the runtime', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)
    const { presets } = await response.json()
    const preset = presets.find((entry: { id: string }) => entry.id === 'deepseek')
    expect(preset.defaultModels).toEqual({
      main: 'deepseek-flash[1m]',
      fable: 'deepseek-flash[1m]',
      haiku: 'deepseek-flash[1m]',
      sonnet: 'deepseek-flash[1m]',
      opus: 'deepseek-flash[1m]',
    })
    const env = buildProviderManagedEnv({
      id: 'deepseek-test', presetId: preset.id, name: preset.name,
      baseUrl: preset.baseUrl, apiFormat: preset.apiFormat,
      authStrategy: preset.authStrategy, apiKey: 'fake-deepseek-key',
      models: preset.defaultModels,
    })
    for (const key of [
      'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
    ]) {
      expect(env[key]).toBe('deepseek-flash[1m]')
    }
    expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)['deepseek-flash']).toBe(1_000_000)
  })

  describe('OpenCode Go preset', () => {
    const opencodeGo = PROVIDER_PRESETS.find((preset) => preset.id === 'opencode-go')!

    test('links to official signup without referral metadata', () => {
      expect(opencodeGo.apiKeyUrl).toBe('https://opencode.ai/go')
      expect(opencodeGo.promoText).toBeUndefined()
    })

    test('is selectable and declares an OpenAI format so requests reach the proxy', () => {
      expect(opencodeGo).toBeDefined()
      expect(opencodeGo.deprecated).toBeUndefined()
      expect(opencodeGo.needsApiKey).toBe(true)
      expect(opencodeGo.baseUrl).toBe('https://opencode.ai/zen/go/v1')
      expect(providerNeedsProxy(opencodeGo.apiFormat, undefined)).toBe(true)
      // Every model on this gateway that is not reached through the paths below
      // arrives over Bearer, and the Messages path alone reads x-api-key.
      expect(opencodeGo.authStrategy).toBe('api_key')
    })

    test('routes only the families that need a non-chat endpoint', () => {
      expect(opencodeGo.modelApiFormats).toEqual([
        { prefixes: ['grok-', 'gpt-', 'muse-spark-'], apiFormat: 'openai_responses' },
        { prefixes: ['minimax-', 'qwen', 'union-alpha'], apiFormat: 'anthropic' },
        // OpenCode Go serves Gemini only over Google generateContent, outside /zen/go/v1.
        { prefixes: ['gemini-'], apiFormat: 'gemini', baseUrl: '/inference/go/google/v1beta' },
      ])
      // Everything else must fall through to the provider format rather than being
      // pinned by a rule, so the default only advertises what was verified.
      for (const model of ['glm-5.3', 'kimi-k3', 'deepseek-v4-pro', 'longcat-2.0']) {
        expect(resolveModelApiFormat(opencodeGo.modelApiFormats, model), model).toBeUndefined()
      }
    })

    test('sends the session id the gateway requires plus a client-identifying user agent', () => {
      expect(opencodeGo.upstreamHeaders).toEqual({
        'User-Agent': 'echoflow-code/$VERSION',
        'x-opencode-session': '$SESSION_ID',
      })
      const resolved = resolveUpstreamHeaders(opencodeGo.upstreamHeaders, { sessionId: 's-1' })
      expect(resolved['x-opencode-session']).toBe('s-1')
      expect(resolved['User-Agent']).toMatch(/^echoflow-code\//)
    })

    test('publishes a context window for every model it offers as a default', () => {
      for (const model of Object.values(opencodeGo.defaultModels)) {
        expect(opencodeGo.modelContextWindows?.[model], model).toBeGreaterThan(0)
      }
    })

    test('stays ordered before the local endpoints so the catalog layout is stable', () => {
      const ids = PROVIDER_PRESETS.map((preset) => preset.id)
      expect(ids.indexOf('opencode-go')).toBeGreaterThan(-1)
      expect(ids.indexOf('opencode-go')).toBeLessThan(ids.indexOf('lmstudio'))
    })
  })

  test('rejects an upstream header name that would break the upstream request', () => {
    const base = {
      id: 'probe', name: 'Probe', baseUrl: 'https://probe.test', apiFormat: 'anthropic',
      defaultModels: { main: 'm', haiku: 'm', sonnet: 'm', opus: 'm' },
      needsApiKey: true, websiteUrl: '',
    }
    expect(ProviderPresetSchema.safeParse({ ...base, upstreamHeaders: { 'x-ok': 'v' } }).success).toBe(true)
    // A malformed name only surfaces as a fetch TypeError on every request at
    // runtime, so the bundle must refuse to load it instead.
    for (const name of ['x-bad\nx-leak: 1', 'has space', 'colon:yes', '']) {
      expect(
        ProviderPresetSchema.safeParse({ ...base, upstreamHeaders: { [name]: 'v' } }).success,
        JSON.stringify(name),
      ).toBe(false)
    }
  })
})

test.each(['openai_images', 'gemini_native', 'xai_images'] as const)('keeps a preset image protocol %s through runtime configuration', protocol => {
  const preset = ProviderPresetSchema.parse({
    name: 'Image fixture', baseUrl: 'https://images.example.test/v1', apiFormat: 'openai_chat',
    defaultModels: { main: 'm', haiku: 'm', sonnet: 'm', opus: 'm' }, needsApiKey: true, websiteUrl: '',
    id: 'native-image-fixture', defaultImageGeneration: { model: 'fixture-image-alias', protocol },
  })
  const env = buildProviderManagedEnv({
    id: 'fixture', name: 'Fixture', presetId: preset.id, apiKey: 'fake-key',
    baseUrl: preset.baseUrl, apiFormat: preset.apiFormat, models: preset.defaultModels,
    imageGeneration: preset.defaultImageGeneration,
  })
  expect(env[IMAGE_GENERATION_PROTOCOL_ENV_KEY]).toBe(protocol)
})
