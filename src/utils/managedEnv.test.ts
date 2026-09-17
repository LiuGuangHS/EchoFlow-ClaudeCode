import { afterEach, beforeEach, describe, expect, it, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { getAllowedSettingSources, setAllowedSettingSources } from '../bootstrap/state.js'
import { getEchoFlowInternalDir } from './echoFlowConfigRoot.js'
import {
  applyConfigEnvironmentVariables,
  applySafeConfigEnvironmentVariables,
} from './managedEnv.js'
import { resetSettingsCache } from './settings/settingsCache.js'
import {
  IMAGE_GENERATION_MODEL_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_ID_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY,
} from '../services/imageGeneration/config.js'

let tempDir = ''
let originalEnv: NodeJS.ProcessEnv
let originalSettingSources: ReturnType<typeof getAllowedSettingSources>

async function writeJson(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
}

describe('managed environment', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'managed-env-test-'))
    originalEnv = { ...process.env }
    originalSettingSources = [...getAllowedSettingSources()]
    process.env.NODE_ENV = 'test'
    process.env.CLAUDE_CONFIG_DIR = tempDir
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    delete process.env.CC_HAHA_AGENT_TEAMS_ENABLED
    delete process.env.CC_HAHA_AGENT_TEAMS_DEFAULT
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli'
    delete process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_MODEL
    delete process.env.ECHOFLOW_ONLY
    delete process.env.ECHOFLOW_KEEP
    delete process.env.ROOT_ONLY
    delete process.env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]
    delete process.env[IMAGE_GENERATION_PROVIDER_ID_ENV_KEY]
    delete process.env[IMAGE_GENERATION_MODEL_ENV_KEY]
    delete process.env.ECHOFLOW_IMAGE_PROVIDER_KIND
    delete process.env.ECHOFLOW_IMAGE_PROVIDER_ID
    delete process.env.ECHOFLOW_IMAGE_MODEL
    delete process.env.CLAUDE_CODE_PROVIDER_MAX_OUTPUT_TOKENS
    setAllowedSettingSources(['userSettings'])
    resetSettingsCache()
  })

  afterEach(async () => {
    await import('../server/proxy/standaloneProviderProxy.js')
      .then((mod) => mod.stopStandaloneProviderProxyForTests?.())
      .catch(() => {})
    resetSettingsCache()
    setAllowedSettingSources(originalSettingSources)
    restoreEnv()
    await rm(tempDir, { recursive: true, force: true })
  })

  test.each(['0', '1', undefined])('protects the General team preference %j through settings application', async (enabled) => {
    await writeJson(join(getEchoFlowInternalDir(tempDir), 'settings.json'), {
      env: {
        CC_HAHA_AGENT_TEAMS_ENABLED: enabled === '1' ? '0' : '1',
        CC_HAHA_AGENT_TEAMS_DEFAULT: '0',
      },
    })
    if (enabled !== undefined) process.env.CC_HAHA_AGENT_TEAMS_ENABLED = enabled
    process.env.CC_HAHA_AGENT_TEAMS_DEFAULT = '1'

    // OAuth and cron sessions can use sdk-cli without host-owned provider routing.
    // Both the pre-trust and post-trust settings paths must preserve the choice.
    applySafeConfigEnvironmentVariables()
    expect(process.env.CC_HAHA_AGENT_TEAMS_ENABLED).toBe(enabled)
    expect(process.env.CC_HAHA_AGENT_TEAMS_DEFAULT).toBe('1')
    applyConfigEnvironmentVariables()
    expect(process.env.CC_HAHA_AGENT_TEAMS_ENABLED).toBe(enabled)
    expect(process.env.CC_HAHA_AGENT_TEAMS_DEFAULT).toBe('1')
  })

  it('starts a standalone provider proxy for CLI-only OpenAI-compatible providers', async () => {
    await writeJson(join(getEchoFlowInternalDir(tempDir), 'providers.json'), {
      activeId: 'agnes-provider',
      providers: [
        {
          id: 'agnes-provider',
          presetId: 'custom',
          name: 'Agnes',
          apiKey: 'sk-agnes',
          authStrategy: 'api_key',
          baseUrl: 'https://apihub.agnes-ai.com',
          apiFormat: 'openai_chat',
          models: {
            main: 'agnes-2.0-flash',
            haiku: 'agnes-2.0-flash',
            sonnet: 'agnes-2.0-flash',
            opus: 'agnes-2.0-flash',
          },
        },
      ],
    })

    applySafeConfigEnvironmentVariables()

    const baseUrl = new URL(process.env.ANTHROPIC_BASE_URL!)
    expect(baseUrl.hostname).toBe('127.0.0.1')
    expect(baseUrl.port).not.toBe('3456')
    expect(baseUrl.pathname).toBe('/proxy')

    const health = await fetch(new URL('/health', baseUrl.origin))
    expect(health.status).toBe(200)
  })

  it('applies EchoFlow internal provider env after root user settings', async () => {
    await writeJson(join(tempDir, 'settings.json'), {
      env: {
        ANTHROPIC_BASE_URL: 'https://root.example.invalid',
        ANTHROPIC_AUTH_TOKEN: 'root-token',
        ROOT_ONLY: '1',
      },
    })
    await writeJson(join(getEchoFlowInternalDir(tempDir), 'settings.json'), {
      env: {
        ANTHROPIC_BASE_URL: 'https://echoflow.example.invalid',
        ANTHROPIC_AUTH_TOKEN: 'echoflow-token',
        ECHOFLOW_ONLY: '1',
      },
    })
    resetSettingsCache()

    applySafeConfigEnvironmentVariables()

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://echoflow.example.invalid')
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('echoflow-token')
    expect(process.env.ROOT_ONLY).toBe('1')
    expect(process.env.ECHOFLOW_ONLY).toBe('1')
  })

  it('does not read legacy echoflow-code managed settings implicitly', async () => {
    await writeJson(join(tempDir, 'legacy-echoflow-code', 'settings.json'), {
      env: {
        ANTHROPIC_BASE_URL: 'https://legacy.example.invalid',
        ANTHROPIC_AUTH_TOKEN: 'legacy-token',
      },
    })
    resetSettingsCache()

    applyConfigEnvironmentVariables()

    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  it('filters provider routing env when the host manages the provider', async () => {
    await writeJson(join(getEchoFlowInternalDir(tempDir), 'settings.json'), {
      env: {
        ANTHROPIC_BASE_URL: 'https://echoflow.example.invalid',
        ANTHROPIC_MODEL: 'echoflow-model',
        ECHOFLOW_KEEP: '1',
      },
    })
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    resetSettingsCache()

    applyConfigEnvironmentVariables()

    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(process.env.ANTHROPIC_MODEL).toBeUndefined()
    expect(process.env.ECHOFLOW_KEEP).toBe('1')
  })

  it('does not let settings replace host-owned provider routing credentials', async () => {
    await writeJson(join(getEchoFlowInternalDir(tempDir), 'settings.json'), {
      env: {
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '0',
        ECHOFLOW_LOCAL_ACCESS_TOKEN: 'stale-settings-token',
        [IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]: 'openai_oauth',
        [IMAGE_GENERATION_PROVIDER_ID_ENV_KEY]: 'openai-official',
        [IMAGE_GENERATION_MODEL_ENV_KEY]: 'gpt-image-2',
        CLAUDE_CODE_PROVIDER_MAX_OUTPUT_TOKENS: '32000',
      },
    })
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN = 'desktop-local-secret'
    process.env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY] = 'grok_oauth'
    process.env[IMAGE_GENERATION_PROVIDER_ID_ENV_KEY] = 'grok-official'
    process.env[IMAGE_GENERATION_MODEL_ENV_KEY] = 'grok-imagine-image-quality'
    process.env.CLAUDE_CODE_PROVIDER_MAX_OUTPUT_TOKENS = '96000'

    applySafeConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN).toBe('desktop-local-secret')
    expect(process.env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]).toBe('grok_oauth')
    expect(process.env[IMAGE_GENERATION_PROVIDER_ID_ENV_KEY]).toBe('grok-official')
    expect(process.env[IMAGE_GENERATION_MODEL_ENV_KEY]).toBe('grok-imagine-image-quality')
    expect(process.env.CLAUDE_CODE_PROVIDER_MAX_OUTPUT_TOKENS).toBe('96000')
  })
})
