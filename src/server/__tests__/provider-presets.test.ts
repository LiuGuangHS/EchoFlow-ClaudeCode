import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'

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
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('provider presets API', () => {
  test('GET /api/providers/presets returns the configured presets', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ presets: PROVIDER_PRESETS })
  })

  test('configured presets expose approved official, local, EchoFlow, and custom entry points', () => {
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
    for (const preset of PROVIDER_PRESETS) {
      expect([
        'official',
        'echoflowai',
        'deepseek',
        'zhipuglm',
        'kimi',
        'minimax',
        'lmstudio',
        'ollama',
        'custom',
      ]).toContain(preset.id)
    }
  })

  test('local Anthropic-compatible presets appear immediately before custom provider entry', () => {
    expect(PROVIDER_PRESETS.at(-3)?.id).toBe('lmstudio')
    expect(PROVIDER_PRESETS.at(-2)?.id).toBe('ollama')
    expect(PROVIDER_PRESETS.at(-1)?.id).toBe('custom')
  })

  test('configured presets keep current default model ids aligned with official provider docs', () => {
    const echoflow = PROVIDER_PRESETS.find((preset) => preset.id === 'echoflowai')
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const minimax = PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')

    expect(echoflow?.baseUrl).toBe('https://api.echoflow.cn')
    expect(echoflow?.apiFormat).toBe('anthropic')
    expect(echoflow?.authStrategy).toBe('auth_token')
    expect(echoflow?.defaultModels.main).toBe('claude-sonnet-4-6')
    expect(echoflow?.defaultModels.haiku).toBe('claude-haiku-4-5')
    expect(echoflow?.defaultModels.sonnet).toBe('claude-sonnet-4-6')
    expect(echoflow?.defaultModels.opus).toBe('claude-opus-4-7')
    expect(echoflow?.modelContextWindows?.['claude-sonnet-4-6']).toBe(1000000)
    expect(lmstudio?.baseUrl).toBe('http://localhost:1234')
    expect(lmstudio?.apiFormat).toBe('anthropic')
    expect(lmstudio?.authStrategy).toBe('auth_token_empty_api_key')
    expect(lmstudio?.defaultModels.main).toBe('qwen/qwen3.6-27b')
    expect(ollama?.baseUrl).toBe('http://localhost:11434')
    expect(ollama?.apiFormat).toBe('anthropic')
    expect(ollama?.authStrategy).toBe('auth_token_empty_api_key')
    expect(ollama?.defaultModels.main).toBe('qwen3.6:27b')
    expect(deepseek?.authStrategy).toBe('auth_token')
    expect(deepseek?.defaultModels.main).toBe('deepseek-v4-pro[1m]')
    expect(deepseek?.defaultEnv?.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,max_effort',
    )
    expect(zhipu?.authStrategy).toBe('auth_token')
    expect(zhipu?.defaultModels.main).toBe('glm-5.2[1m]')
    expect(zhipu?.defaultEnv?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('1000000')
    expect(kimi?.baseUrl).toBe('https://api.moonshot.cn/anthropic')
    expect(kimi?.authStrategy).toBe('auth_token')
    expect(kimi?.defaultModels.main).toBe('kimi-k2.7-code')
    expect(kimi?.defaultEnv?.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe('thinking')
    expect(minimax?.authStrategy).toBe('auth_token')
    expect(minimax?.defaultModels.main).toBe('MiniMax-M3[1m]')
    expect(minimax?.defaultEnv?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('1000000')
  })

  test('third-party official presets do not include referral URLs', () => {
    for (const preset of PROVIDER_PRESETS.filter((preset) => preset.id !== 'echoflowai')) {
      expect(`${preset.websiteUrl ?? ''} ${preset.apiKeyUrl ?? ''}`).not.toMatch(
        /\b(?:invite|referral)\b|[?&](?:code|source|ref)=/i,
      )
    }
  })

  test('configured presets expose EchoFlow API metadata while custom stays neutral', () => {
    const official = PROVIDER_PRESETS.find((preset) => preset.id === 'official')
    const echoflow = PROVIDER_PRESETS.find((preset) => preset.id === 'echoflowai')
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(official?.needsApiKey).toBe(false)
    expect(official?.websiteUrl).toBe('https://www.anthropic.com/claude-code')
    expect(echoflow?.needsApiKey).toBe(true)
    expect(echoflow?.websiteUrl).toBe('https://api.echoflow.cn/')
    expect(echoflow?.apiKeyUrl).toBe('https://api.echoflow.cn/register?channel=c_fe4eotyx')
    expect(echoflow?.promoText).toContain('500+ 模型')
    expect(echoflow?.featured).toBe(true)
    expect(custom?.promoText).toBeUndefined()
    expect(custom?.authStrategy).toBe('auth_token')
    expect(custom?.defaultEnv).toBeUndefined()
  })

  test('GET and PUT /api/providers/settings read and write cc-haha settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5.1',
      },
      model: 'glm-5.1',
    }
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'cc-haha', 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getReq = makeRequest('GET', '/api/providers/settings')
    const getRes = await handleProvidersApi(getReq.req, getReq.url, getReq.segments)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual(initial)

    const updateBody = {
      model: 'kimi-k2.6',
      env: {
        ANTHROPIC_MODEL: 'kimi-k2.6',
      },
    }
    const putReq = makeRequest('PUT', '/api/providers/settings', updateBody)
    const putRes = await handleProvidersApi(putReq.req, putReq.url, putReq.segments)
    expect(putRes.status).toBe(200)

    const updatedRaw = await fs.readFile(path.join(tmpDir, 'cc-haha', 'settings.json'), 'utf-8')
    expect(JSON.parse(updatedRaw)).toEqual(updateBody)
  })

  test('EchoFlow preset carries context windows for current coding models', () => {
    const echoflow = PROVIDER_PRESETS.find((preset) => preset.id === 'echoflowai')!

    expect(echoflow.modelContextWindows?.[echoflow.defaultModels.main]).toBeGreaterThan(0)
    expect(echoflow.modelContextWindows?.[echoflow.defaultModels.haiku]).toBeGreaterThan(0)
    expect(echoflow.modelContextWindows?.[echoflow.defaultModels.opus]).toBeGreaterThan(0)
  })
})
