import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { getEchoFlowInternalDir } from '../services/echoFlowConfigRoot.js'

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
  // ApiSmart /v1/models and live calls verified these exact IDs on 2026-09-09.
  // The unsuffixed names in its docs return 503 provider_not_available.
  test('exposes ApiSmart with its live-verified Chat Completions defaults and sponsor link', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)
    const { presets } = await response.json()
    expect(presets.find((preset: { id: string }) => preset.id === 'apismart')).toMatchObject({
      name: 'ApiSmart',
      defaultImageGeneration: { model: 'doubao-seedream-5-0' },
      baseUrl: 'https://gw.apismart.ai/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      defaultModels: {
        main: 'deepseek-v4-pro-0813',
        haiku: 'deepseek-v4-flash-0731-tem',
        sonnet: 'deepseek-v4-pro-0813',
        opus: 'deepseek-v4-pro-0813',
      },
      apiKeyUrl: 'https://www.apismart.ai',
      websiteUrl: 'https://www.apismart.ai',
      featured: true,
    })
  })

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
      baseUrl: 'https://api.echoflow.cn',
      authStrategy: 'auth_token',
      defaultModels: {
        main: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })
    expect(deepseek).toMatchObject({
      baseUrl: 'https://api.deepseek.com/anthropic',
      authStrategy: 'auth_token',
      defaultModels: {
        main: 'deepseek-v4-pro[1m]',
        haiku: 'deepseek-v4-flash',
        sonnet: 'deepseek-v4-pro[1m]',
        opus: 'deepseek-v4-pro[1m]',
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

    expect(deepseek?.defaultEnv).toMatchObject({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,effort,adaptive_thinking,max_effort',
    })
    expect(zhipu?.defaultEnv).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' })
    expect(kimi?.defaultEnv).toMatchObject({
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,required_thinking,effort,max_effort',
    })
    expect(minimax?.defaultEnv).toMatchObject({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
        'thinking,adaptive_thinking',
    })
    for (const id of ['echoflowai', 'deepseek', 'zhipuglm', 'kimi', 'minimax']) {
      const preset = byId.get(id)!
      expect(preset.modelContextWindows?.[preset.defaultModels.main]).toBeGreaterThan(0)
    }
  })

  test('does not expose sponsor, relay, or referral metadata', () => {
    const serialized = JSON.stringify(PROVIDER_PRESETS)
    expect(serialized).not.toMatch(
      /teamorouter|jiekouai|shengsuanyun|xuanshuapi|fennoai|qiniuai|atlascloud|[?&](?:ref|referral|invite|source|utm_[^=]+)=/i,
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
})
