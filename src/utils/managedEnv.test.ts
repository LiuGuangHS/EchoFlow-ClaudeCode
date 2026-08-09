import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
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
    delete process.env.CC_HAHA_IMAGE_PROVIDER_KIND
    delete process.env.CC_HAHA_IMAGE_PROVIDER_ID
    delete process.env.CC_HAHA_IMAGE_MODEL
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

  it('does not read legacy cc-haha managed settings implicitly', async () => {
    await writeJson(join(tempDir, 'cc-haha', 'settings.json'), {
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
      },
    })
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN = 'desktop-local-secret'
    process.env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY] = 'grok_oauth'
    process.env[IMAGE_GENERATION_PROVIDER_ID_ENV_KEY] = 'grok-official'
    process.env[IMAGE_GENERATION_MODEL_ENV_KEY] = 'grok-imagine-image-quality'

    applySafeConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN).toBe('desktop-local-secret')
    expect(process.env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY]).toBe('grok_oauth')
    expect(process.env[IMAGE_GENERATION_PROVIDER_ID_ENV_KEY]).toBe('grok-official')
    expect(process.env[IMAGE_GENERATION_MODEL_ENV_KEY]).toBe('grok-imagine-image-quality')
  })
})
