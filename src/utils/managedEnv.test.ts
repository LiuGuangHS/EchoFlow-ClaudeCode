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
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_MODEL
    delete process.env.ECHOFLOW_ONLY
    delete process.env.ECHOFLOW_KEEP
    delete process.env.ROOT_ONLY
    setAllowedSettingSources(['userSettings'])
    resetSettingsCache()
  })

  afterEach(async () => {
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
})
