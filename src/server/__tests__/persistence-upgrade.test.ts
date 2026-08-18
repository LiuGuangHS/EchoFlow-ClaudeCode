import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'
import {
  CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  ensurePersistentStorageUpgraded,
  resetPersistentStorageMigrationsForTests,
} from '../services/persistentStorageMigrations.js'
import {
  ECHOFLOW_APP_ID,
  ECHOFLOW_APP_NAME,
  getEchoFlowInternalDir,
} from '../services/echoFlowConfigRoot.js'

let tempDir: string

async function listFiles(dir: string) {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

function echoFlowDir(): string {
  return getEchoFlowInternalDir(tempDir)
}

describe('persistent storage upgrade migrations', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-persistence-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    resetPersistentStorageMigrationsForTests()
  })

  afterEach(async () => {
    resetPersistentStorageMigrationsForTests()
    delete process.env.CLAUDE_CONFIG_DIR
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('creates an EchoFlow ownership marker in the configured root', async () => {
    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])

    const marker = JSON.parse(await fs.readFile(path.join(tempDir, 'app.json'), 'utf-8')) as {
      owner?: string
      appId?: string
      schemaVersion?: number
    }
    expect(marker).toEqual({
      owner: ECHOFLOW_APP_NAME,
      appId: ECHOFLOW_APP_ID,
      schemaVersion: 1,
    })
  })

  test('repairs a stale EchoFlow ownership marker while preserving unknown fields', async () => {
    await fs.writeFile(
      path.join(tempDir, 'app.json'),
      JSON.stringify({
        owner: ECHOFLOW_APP_NAME,
        appId: 'com.old.echo.desktop',
        schemaVersion: 1,
        userNote: 'keep-me',
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    const marker = JSON.parse(await fs.readFile(path.join(tempDir, 'app.json'), 'utf-8')) as {
      owner?: string
      appId?: string
      schemaVersion?: number
      userNote?: string
    }
    expect(marker).toEqual({
      owner: ECHOFLOW_APP_NAME,
      appId: ECHOFLOW_APP_ID,
      schemaVersion: 1,
      userNote: 'keep-me',
    })
  })

  test('rewrites a malformed EchoFlow ownership marker instead of blocking startup', async () => {
    await fs.writeFile(path.join(tempDir, 'app.json'), '{"owner":', 'utf-8')

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    const marker = JSON.parse(await fs.readFile(path.join(tempDir, 'app.json'), 'utf-8')) as {
      owner?: string
      appId?: string
      schemaVersion?: number
    }
    expect(marker).toEqual({
      owner: ECHOFLOW_APP_NAME,
      appId: ECHOFLOW_APP_ID,
      schemaVersion: 1,
    })
  })

  test('migrates current EchoFlow providers index and writes a backup before changing it', async () => {
    const currentDir = echoFlowDir()
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(
      path.join(currentDir, 'providers.json'),
      JSON.stringify({
        activeProviderId: 'provider-1',
        rootFutureField: { keep: true },
        providers: [{
          id: 'provider-1',
          presetId: 'custom',
          name: 'Legacy Provider',
          apiKey: 'token',
          baseUrl: 'https://example.test',
          models: { main: 'model-main', haiku: '', sonnet: '', opus: '' },
          extraFutureField: 'keep-me',
        }],
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow/providers.json')

    const migrated = JSON.parse(await fs.readFile(path.join(currentDir, 'providers.json'), 'utf-8')) as {
      schemaVersion?: number
      activeId?: string | null
      activeProviderId?: string
      providerOrder?: string[]
      rootFutureField?: unknown
      providers?: Array<Record<string, unknown>>
    }
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.activeId).toBe('provider-1')
    expect(migrated.providerOrder).toEqual(['provider-1', 'claude-official', 'openai-official', 'grok-official'])
    expect(migrated.activeProviderId).toBeUndefined()
    expect(migrated.rootFutureField).toEqual({ keep: true })
    expect(migrated.providers?.[0]?.extraFutureField).toBe('keep-me')

    const backups = (await listFiles(currentDir)).filter((file) => file.startsWith('providers.json.bak-before-migration-'))
    expect(backups.length).toBe(1)

    const service = new ProviderService()
    const { providers, activeId } = await service.listProviders()
    expect(providers).toHaveLength(1)
    expect(activeId).toBe('provider-1')

    await service.updateProvider('provider-1', { name: 'Renamed Provider' })
    const rewritten = JSON.parse(await fs.readFile(path.join(currentDir, 'providers.json'), 'utf-8')) as {
      rootFutureField?: unknown
      providers?: Array<Record<string, unknown>>
    }
    expect(rewritten.rootFutureField).toEqual({ keep: true })
    expect(rewritten.providers?.[0]?.extraFutureField).toBe('keep-me')
  })

  test('does not write repo-owned schema metadata into shared user settings', async () => {
    await fs.writeFile(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({
        defaultMode: 'acceptEdits',
        userOwnedFutureField: { nested: true },
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    const settings = JSON.parse(await fs.readFile(path.join(tempDir, 'settings.json'), 'utf-8')) as Record<string, unknown>
    expect(settings.schemaVersion).toBeUndefined()
    expect(settings.userOwnedFutureField).toEqual({ nested: true })
  })

  test('quarantines malformed managed settings instead of blocking startup', async () => {
    const currentDir = echoFlowDir()
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(path.join(currentDir, 'settings.json'), '{"env":', 'utf-8')

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow/settings.json')
    expect(JSON.parse(await fs.readFile(path.join(currentDir, 'settings.json'), 'utf-8'))).toEqual({})
    const quarantined = (await listFiles(currentDir)).filter((file) => file.startsWith('settings.json.invalid-'))
    expect(quarantined.length).toBe(1)
  })

  test('migrates legacy image env keys in current EchoFlow settings while preserving unknown fields and backing up the original', async () => {
    const currentDir = echoFlowDir()
    const legacySettings = {
      futureRootField: { retain: true },
      env: {
        USER_CUSTOM_ENV: 'keep-me',
        CC_HAHA_IMAGE_PROVIDER_KIND: 'openai_images',
        CC_HAHA_IMAGE_PROVIDER_ID: 'legacy-image-provider',
        CC_HAHA_IMAGE_BASE_URL: 'https://images.example.test/v1',
        CC_HAHA_IMAGE_API_KEY: 'test-image-key',
        CC_HAHA_IMAGE_MODEL: 'test-image-model',
      },
    }
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(
      path.join(currentDir, 'settings.json'),
      JSON.stringify(legacySettings, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow/settings.json')

    const migrated = JSON.parse(await fs.readFile(path.join(currentDir, 'settings.json'), 'utf-8')) as {
      futureRootField?: unknown
      env?: Record<string, string>
    }
    expect(migrated.futureRootField).toEqual({ retain: true })
    expect(migrated.env?.USER_CUSTOM_ENV).toBe('keep-me')
    expect(migrated.env?.ECHOFLOW_IMAGE_PROVIDER_KIND).toBe('openai_images')
    expect(migrated.env?.ECHOFLOW_IMAGE_PROVIDER_ID).toBe('legacy-image-provider')
    expect(migrated.env?.ECHOFLOW_IMAGE_BASE_URL).toBe('https://images.example.test/v1')
    expect(migrated.env?.ECHOFLOW_IMAGE_API_KEY).toBe('test-image-key')
    expect(migrated.env?.ECHOFLOW_IMAGE_MODEL).toBe('test-image-model')
    expect(migrated.env?.CC_HAHA_IMAGE_PROVIDER_KIND).toBeUndefined()
    expect(migrated.env?.CC_HAHA_IMAGE_PROVIDER_ID).toBeUndefined()
    expect(migrated.env?.CC_HAHA_IMAGE_BASE_URL).toBeUndefined()
    expect(migrated.env?.CC_HAHA_IMAGE_API_KEY).toBeUndefined()
    expect(migrated.env?.CC_HAHA_IMAGE_MODEL).toBeUndefined()

    const backups = (await listFiles(currentDir)).filter((file) => file.startsWith('settings.json.bak-before-migration-'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(currentDir, backups[0]), 'utf-8'))).toEqual(legacySettings)
  })

  test('does not automatically migrate or remove legacy management credentials', async () => {
    const currentDir = echoFlowDir()
    const providersPath = path.join(currentDir, 'providers.json')
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(
      providersPath,
      JSON.stringify({
        schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
        activeId: null,
        providers: [{
          id: 'echoflow-api',
          presetId: 'echoflow-api',
          name: 'EchoFlow API',
          apiKey: 'provider-key',
          baseUrl: 'https://api.echoflow.cn',
          models: { main: 'model', haiku: 'model', sonnet: 'model', opus: 'model' },
          echoflowManagement: { userId: '106452', managementToken: 'management-token' },
          echoflowToken: 'legacy-token',
        }],
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).not.toContain('providers.json -> echoflow/qingyun-account.json')
    await expect(fs.access(path.join(currentDir, 'qingyun-account.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const providers = await fs.readFile(providersPath, 'utf-8')
    expect(providers).toContain('management-token')
    expect(providers).toContain('legacy-token')
  })

  test('does not use legacy storage as a startup fallback or rewrite transcripts', async () => {
    const legacyDir = path.join(tempDir, 'cc-haha')
    const transcriptPath = path.join(tempDir, 'projects', 'legacy-project', 'session.jsonl')
    const transcript = '{"type":"user","message":{"content":"keep"}}\n'
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
    await fs.writeFile(path.join(legacyDir, 'providers.json'), '{"providers":[]}', 'utf-8')
    await fs.writeFile(transcriptPath, transcript, 'utf-8')

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    await expect(fs.access(path.join(echoFlowDir(), 'providers.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(transcriptPath, 'utf-8')).toBe(transcript)
  })

  test('quarantines malformed providers index after skipping account extraction', async () => {
    const currentDir = echoFlowDir()
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(path.join(currentDir, 'providers.json'), '{"providers":', 'utf-8')

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow/providers.json')
    expect(JSON.parse(await fs.readFile(path.join(currentDir, 'providers.json'), 'utf-8'))).toEqual({})
    const quarantined = (await listFiles(currentDir)).filter((file) => file.startsWith('providers.json.invalid-'))
    expect(quarantined).toHaveLength(1)
  })

  test('upgrades existing DeepSeek managed env to follow global thinking settings', async () => {
    const currentDir = echoFlowDir()
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(
      path.join(currentDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'test-token',
          ANTHROPIC_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
          ECHOFLOW_SEND_DISABLED_THINKING: '1',
          USER_CUSTOM_ENV: 'keep-me',
        },
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow/settings.json')

    const migrated = JSON.parse(await fs.readFile(path.join(currentDir, 'settings.json'), 'utf-8')) as {
      env?: Record<string, string>
    }
    expect(migrated.env?.ECHOFLOW_SEND_DISABLED_THINKING).toBeUndefined()
    expect(migrated.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
    )
    expect(migrated.env?.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
    )
    expect(migrated.env?.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
    )
    expect(migrated.env?.USER_CUSTOM_ENV).toBe('keep-me')

    const backups = (await listFiles(currentDir)).filter((file) => file.startsWith('settings.json.bak-before-migration-'))
    expect(backups.length).toBe(1)
  })
})
