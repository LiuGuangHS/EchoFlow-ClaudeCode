import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'
import { SettingsService } from '../services/settingsService.js'
import { readActiveProviderManagedEnv } from '../services/providerRuntimeEnv.js'
import { getImageGenerationRuntimeConfig } from '../../services/imageGeneration/config.js'
import {
  CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  ensurePersistentStorageUpgraded,
  resetPersistentStorageMigrationsForTests,
} from '../services/persistentStorageMigrations.js'

let tempDir: string
let originalHome: string | undefined
let originalConfigDir: string | undefined
let fixtureHome: string

async function listFiles(dir: string) {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

describe('persistent storage upgrade migrations', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-persistence-'))
    originalHome = process.env.HOME
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    fixtureHome = path.join(tempDir, 'home')
    process.env.HOME = fixtureHome
    process.env.CLAUDE_CONFIG_DIR = tempDir
    resetPersistentStorageMigrationsForTests()
  })

  afterEach(async () => {
    resetPersistentStorageMigrationsForTests()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  async function upgradeInFixtureHome() {
    const proc = Bun.spawn(['bun', '--no-env-file', '-e', `
      const { ensurePersistentStorageUpgraded } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../services/persistentStorageMigrations.ts'))})
      console.log(JSON.stringify(await ensurePersistentStorageUpgraded()))
    `], {
      env: { ...process.env, HOME: fixtureHome, CLAUDE_CONFIG_DIR: tempDir },
      stdout: 'pipe', stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    expect(await proc.exited).toBe(0)
    return JSON.parse(output) as { failures: string[]; migratedEntries: string[] }
  }

  test('copies only supported EchoFlow legacy files, preserves source sentinels and is idempotent', async () => {
    const source = path.join(fixtureHome, '.claude', 'echoflow-code')
    await fs.mkdir(source, { recursive: true })
    const raw = JSON.stringify({ activeProviderId: 'old', futureRoot: 'keep', providers: [{
      id: 'old', presetId: 'custom', name: 'Old', apiKey: 'fake', baseUrl: 'http://127.0.0.1',
      models: { main: 'model', haiku: '', sonnet: '', opus: '' }, futureProvider: true,
    }] })
    await fs.writeFile(path.join(source, 'providers.json'), raw)
    await fs.writeFile(path.join(source, 'settings.json'), JSON.stringify({ future: true, env: { UNKNOWN_ENV: 'keep' } }))
    await fs.writeFile(path.join(source, 'sentinel'), 'untouched')
    const report = await upgradeInFixtureHome()
    expect(report.failures).toEqual([])
    const targetDir = path.join(tempDir, 'echoflow-code')
    const migrated = JSON.parse(await fs.readFile(path.join(targetDir, 'providers.json'), 'utf8'))
    expect(migrated.activeId).toBe('old')
    expect(migrated.futureRoot).toBe('keep')
    expect(migrated.providers[0].futureProvider).toBe(true)
    expect((await listFiles(targetDir)).some(name => name.startsWith('providers.json.bak-before-migration-'))).toBe(true)
    expect(await fs.readFile(path.join(source, 'providers.json'), 'utf8')).toBe(raw)
    expect(await fs.readFile(path.join(source, 'sentinel'), 'utf8')).toBe('untouched')
    expect((await upgradeInFixtureHome()).migratedEntries).toEqual([])
    expect(await fs.readFile(path.join(source, 'providers.json'), 'utf8')).toBe(raw)
  })

  test('backs up a malformed target before recovering from a valid EchoFlow source', async () => {
    const source = path.join(fixtureHome, '.claude', 'echoflow-code')
    const target = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(source, { recursive: true })
    await fs.mkdir(target, { recursive: true })
    const raw = JSON.stringify({ future: 'keep', env: { SENTINEL: 'source' } })
    await fs.writeFile(path.join(source, 'settings.json'), raw)
    await fs.writeFile(path.join(target, 'settings.json'), '{broken-target')
    expect((await upgradeInFixtureHome()).failures).toEqual([])
    expect(JSON.parse(await fs.readFile(path.join(target, 'settings.json'), 'utf8'))).toEqual(JSON.parse(raw))
    const backup = (await fs.readdir(target)).find(name => name.startsWith('settings.json.bak-before-migration-'))!
    expect(await fs.readFile(path.join(target, backup), 'utf8')).toBe('{broken-target')
    expect(await fs.readFile(path.join(source, 'settings.json'), 'utf8')).toBe(raw)
    expect((await upgradeInFixtureHome()).migratedEntries).toEqual([])
  })

  test('retains valid targets and reports legacy conflicts and malformed source JSON', async () => {
    const source = path.join(fixtureHome, '.claude', 'echoflow-code')
    const target = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(source, { recursive: true })
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(source, 'providers.json'), '{broken')
    await fs.writeFile(path.join(source, 'settings.json'), JSON.stringify({ env: { SENTINEL: 'legacy' } }))
    const raw = JSON.stringify({ env: { SENTINEL: 'target' }, future: 'keep' })
    await fs.writeFile(path.join(target, 'settings.json'), raw)
    const report = await upgradeInFixtureHome()
    expect(report.failures.some(value => value.includes('providers.json'))).toBe(true)
    expect(report.failures.some(value => value.includes('conflict'))).toBe(true)
    expect(await fs.readFile(path.join(target, 'settings.json'), 'utf8')).toBe(raw)
    expect(await fs.readFile(path.join(source, 'providers.json'), 'utf8')).toBe('{broken')
  })

  test('upgrades v6 image settings to an explicit protocol and preserves unknown fields on later edits', async () => {
    const dir = path.join(tempDir, 'echoflow-code')
    const file = path.join(dir, 'providers.json')
    await fs.mkdir(dir, { recursive: true })
    const fixture = {
      presetId: 'custom', name: 'Fixture', apiKey: 'fixture-key',
      baseUrl: 'https://images.example.test', apiFormat: 'anthropic',
      runtimeKind: 'anthropic_compatible', toolSearchEnabled: false,
      models: { main: 'chat-model', haiku: 'chat-model', sonnet: 'chat-model', opus: 'chat-model' },
    }
    const legacy = {
      schemaVersion: 6, activeId: 'legacy', futureRoot: { keep: true },
      officialProviderModels: {},
      providerOrder: ['legacy', 'native', 'future', 'claude-official', 'openai-official', 'grok-official'],
      providers: [
        { ...fixture, id: 'legacy', futureProvider: 'keep', imageGeneration: { model: 'image-model', futureImage: { keep: true } } },
        { ...fixture, id: 'native', imageGeneration: { model: 'gemini-image', protocol: 'gemini_native' } },
        { ...fixture, id: 'future', imageGeneration: { model: 'future-image', protocol: 'future_protocol' } },
      ],
    }
    await fs.writeFile(file, JSON.stringify(legacy))
    expect((await ensurePersistentStorageUpgraded()).failures).toEqual([])
    const migrated = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(migrated.schemaVersion).toBeGreaterThan(6)
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.providers[0].imageGeneration).toEqual({ ...legacy.providers[0]!.imageGeneration, protocol: 'openai_images' })
    expect(migrated.providers[1].imageGeneration.protocol).toBe('gemini_native')
    expect(migrated.providers[2].imageGeneration.protocol).toBe('future_protocol')
    const backups = (await listFiles(dir)).filter(name => name.startsWith('providers.json.bak-before-migration-'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(dir, backups[0]!), 'utf8'))).toEqual(legacy)
    resetPersistentStorageMigrationsForTests()
    expect((await ensurePersistentStorageUpgraded()).migratedEntries).toEqual([])
    const service = new ProviderService()
    await service.updateProvider('legacy', { name: 'Renamed' })
    const rewritten = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(rewritten.futureRoot).toEqual({ keep: true })
    expect(rewritten.providers[0].futureProvider).toBe('keep')
    expect(rewritten.providers[0].imageGeneration.futureImage).toEqual({ keep: true })
    await service.activateProvider('future')
    const env = readActiveProviderManagedEnv(tempDir)
    expect(env.CC_HAHA_IMAGE_PROTOCOL).toBe('future_protocol')
    expect(getImageGenerationRuntimeConfig(env)).toBeNull()
  })

  test.each([
    [undefined, 'Legacy token provider'],
    ['', 'Legacy token provider'],
    ['   ', 'Legacy token provider'],
    ['Saved token name', 'Saved token name'],
  ])('upgrades a legacy EchoFlow credential source with tokenName %p and keeps the provider readable', async (tokenName, expectedName) => {
    const dir = path.join(tempDir, 'echoflow-code')
    const file = path.join(dir, 'providers.json')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, JSON.stringify({
      schemaVersion: 9,
      activeId: 'legacy-token-provider',
      providers: [{
        id: 'legacy-token-provider', presetId: 'custom', name: 'Legacy token provider',
        apiKey: 'fixture-key', baseUrl: 'https://example.test',
        models: { main: 'model', haiku: 'model', sonnet: 'model', opus: 'model' },
        credentialSource: { kind: 'echoflow-token', endpoint: 'dedicated', tokenId: 'token-123', tokenName, futureSource: { keep: true } },
      }],
      providerOrder: ['legacy-token-provider'], officialProviderModels: {},
    }))

    expect((await ensurePersistentStorageUpgraded()).failures).toEqual([])
    const migrated = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.providers[0].credentialSource).toEqual({
      kind: 'echoflow-token', endpoint: 'dedicated', tokenId: 'token-123', tokenName: expectedName, futureSource: { keep: true },
    })
    const service = new ProviderService()
    const { providers } = await service.listProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.credentialSource?.tokenName).toBe(expectedName)
    await service.updateProvider('legacy-token-provider', { name: 'Renamed token provider' })
    const rewritten = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(rewritten.providers[0].credentialSource.tokenName).toBe(expectedName)
  })

  test('upgrades the provider index v9 fixture and preserves its existing provider data', async () => {
    const dir = path.join(tempDir, 'echoflow-code')
    const file = path.join(dir, 'providers.json')
    await fs.mkdir(dir, { recursive: true })
    const legacy = {
      schemaVersion: 9,
      activeId: null,
      providers: [{
        id: 'legacy', presetId: 'custom', name: 'Legacy', apiKey: 'fixture-key',
        baseUrl: 'https://example.test', apiFormat: 'anthropic',
        runtimeKind: 'anthropic_compatible', toolSearchEnabled: false,
        models: { main: 'model', haiku: 'model', sonnet: 'model', opus: 'model' },
      }],
      providerOrder: ['legacy', 'claude-official', 'openai-official', 'grok-official', 'deepseek-account'],
      officialProviderModels: {},
    }
    await fs.writeFile(file, JSON.stringify(legacy))

    expect((await ensurePersistentStorageUpgraded()).failures).toEqual([])
    const migrated = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.providers).toEqual(legacy.providers)
    expect(JSON.parse(await fs.readFile(path.join(dir, (await listFiles(dir)).find(name => name.startsWith('providers.json.bak-before-migration-'))!), 'utf8'))).toEqual(legacy)
  })

  test('upgrades legacy team preferences on read and preserves the original settings on save', async () => {
    const userPath = path.join(tempDir, 'settings.json')
    const managedDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(managedDir, { recursive: true })
    const legacy = {
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', LEGACY_OTHER_ENV: 'preserved' },
      unknownFuturePreference: { keep: true },
    }
    const original = JSON.stringify(legacy)
    await fs.writeFile(userPath, original)
    await fs.writeFile(path.join(managedDir, 'settings.json'), JSON.stringify({
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' },
    }))
    const service = new SettingsService()
    expect(await service.getAgentTeamsEnabled()).toBe(false)
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
    await service.updateUserSettings({ agentTeamsEnabled: true })
    expect(await new SettingsService().getAgentTeamsEnabled()).toBe(true)
    expect(JSON.parse(await fs.readFile(userPath, 'utf-8'))).toEqual({ ...legacy, agentTeamsEnabled: true })
    await service.updateUserSettings({ agentTeamsEnabled: false })
    expect(await new SettingsService().getAgentTeamsEnabled()).toBe(false)
  })

  test('upgrades the legacy lean mode preference on read without rewriting shared user settings', async () => {
    const userPath = path.join(tempDir, 'settings.json')
    const legacy = {
      env: { UNKNOWN_ENV: 'preserved' },
      updateProxy: { mode: 'manual', url: 'http://127.0.0.1:7890' },
      unknownFuturePreference: { keep: true },
    }
    const original = JSON.stringify(legacy)
    await fs.writeFile(userPath, original)
    const service = new SettingsService()

    expect(await service.getLeanModeEnabled()).toBe(false)
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
    await service.updateUserSettings({ leanModeEnabled: false })

    expect(await new SettingsService().getLeanModeEnabled()).toBe(false)
    expect(JSON.parse(await fs.readFile(userPath, 'utf-8'))).toEqual({ ...legacy, leanModeEnabled: false })
    await service.updateUserSettings({ leanModeEnabled: true })
    expect(await new SettingsService().getLeanModeEnabled()).toBe(true)
  })

  test('rejects a non-boolean lean mode choice without changing the settings file', async () => {
    const userPath = path.join(tempDir, 'settings.json')
    const original = JSON.stringify({ leanModeEnabled: false, unknownFuturePreference: 'keep' })
    await fs.writeFile(userPath, original)

    await expect(new SettingsService().updateUserSettings({ leanModeEnabled: 'false' })).rejects.toThrow('leanModeEnabled must be a boolean')
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
  })

  test('upgrades the legacy automatic update preference on read without rewriting shared user settings', async () => {
    const userPath = path.join(tempDir, 'settings.json')
    const legacy = {
      env: { UNKNOWN_ENV: 'preserved' },
      updateProxy: { mode: 'manual', url: 'http://127.0.0.1:7890' },
      unknownFuturePreference: { keep: true },
    }
    const original = JSON.stringify(legacy)
    await fs.writeFile(userPath, original)
    const service = new SettingsService()

    expect(await service.getAutoUpdateEnabled()).toBe(true)
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
    await service.updateUserSettings({ autoUpdateEnabled: false })

    expect(await new SettingsService().getAutoUpdateEnabled()).toBe(false)
    expect(JSON.parse(await fs.readFile(userPath, 'utf-8'))).toEqual({ ...legacy, autoUpdateEnabled: false })
    await service.updateUserSettings({ autoUpdateEnabled: true })
    expect(await new SettingsService().getAutoUpdateEnabled()).toBe(true)
  })

  test('rejects a non-boolean automatic update choice without changing the settings file', async () => {
    const userPath = path.join(tempDir, 'settings.json')
    const original = JSON.stringify({ autoUpdateEnabled: false, unknownFuturePreference: 'keep' })
    await fs.writeFile(userPath, original)

    await expect(new SettingsService().updateUserSettings({ autoUpdateEnabled: 'false' })).rejects.toThrow('autoUpdateEnabled must be a boolean')
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
  })

  test('旧配置读取为不限，保存并发上限再恢复不限时保留未知设置', async () => {
    const userPath = path.join(tempDir, 'settings.json')
    const legacy = {
      env: { UNKNOWN_ENV: 'preserved' },
      unknownFuturePreference: { keep: true },
    }
    const original = JSON.stringify(legacy)
    await fs.writeFile(userPath, original)
    const service = new SettingsService()

    expect(await service.getMaxConcurrentSubagents()).toBeNull()
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
    for (const limit of [3, 1, null]) {
      await service.updateUserSettings({ maxConcurrentSubagents: limit })
      expect(await new SettingsService().getMaxConcurrentSubagents()).toBe(limit)
      expect(JSON.parse(await fs.readFile(userPath, 'utf-8'))).toEqual({ ...legacy, maxConcurrentSubagents: limit })
    }
  })

  test.each([0, -1, 1.5, '3', false, Number.MAX_SAFE_INTEGER + 1])('拒绝非法并发上限 %j 且不改写旧设置', async value => {
    const userPath = path.join(tempDir, 'settings.json')
    const original = JSON.stringify({ maxConcurrentSubagents: 2, unknownFuturePreference: 'keep' })
    await fs.writeFile(userPath, original)

    await expect(new SettingsService().updateUserSettings({ maxConcurrentSubagents: value })).rejects.toThrow(
      'maxConcurrentSubagents must be null or a positive safe integer',
    )
    expect(await fs.readFile(userPath, 'utf-8')).toBe(original)
  })

  test('migrates legacy providers index and writes a backup before changing it', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
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
    expect(report.migratedEntries).toContain('echoflow-code/providers.json')

    const migrated = JSON.parse(await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8')) as {
      schemaVersion?: number
      activeId?: string | null
      activeProviderId?: string
      providerOrder?: string[]
      rootFutureField?: unknown
      providers?: Array<Record<string, unknown>>
    }
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.activeId).toBe('provider-1')
    expect(migrated.providerOrder).toEqual(['provider-1', 'claude-official', 'openai-official', 'grok-official', 'deepseek-account'])
    expect(migrated.activeProviderId).toBeUndefined()
    expect(migrated.rootFutureField).toEqual({ keep: true })
    expect(migrated.providers?.[0]?.extraFutureField).toBe('keep-me')

    const backups = (await listFiles(ccHahaDir)).filter((file) => file.startsWith('providers.json.bak-before-migration-'))
    expect(backups.length).toBe(1)

    const service = new ProviderService()
    const { providers, activeId } = await service.listProviders()
    expect(providers).toHaveLength(1)
    expect(activeId).toBe('provider-1')

    await service.updateProvider('provider-1', { name: 'Renamed Provider' })
    const rewritten = JSON.parse(await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8')) as {
      rootFutureField?: unknown
      providers?: Array<Record<string, unknown>>
    }
    expect(rewritten.rootFutureField).toEqual({ keep: true })
    expect(rewritten.providers?.[0]?.extraFutureField).toBe('keep-me')
  })

  test('keeps DeepSeek Account active and its model mapping across a provider index upgrade', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({
        schemaVersion: 4,
        activeId: 'deepseek-account',
        providers: [],
        providerOrder: ['claude-official', 'openai-official', 'grok-official', 'deepseek-account'],
        officialProviderModels: {
          'deepseek-account': {
            main: 'deepseek-v4-flash',
            haiku: 'deepseek-v4-flash',
            sonnet: 'deepseek-v4-flash',
            opus: 'deepseek-v4-flash',
          },
        },
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    const migrated = JSON.parse(
      await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8'),
    ) as {
      activeId: string | null
      officialProviderModels: Record<string, { main: string }>
    }
    // Falling back to null here silently switched the user to Claude Official
    // on the next start while the managed env still pointed at DeepSeek.
    expect(migrated.activeId).toBe('deepseek-account')
    expect(migrated.officialProviderModels['deepseek-account']?.main).toBe('deepseek-flash')
  })

  test('points a saved DeepSeek Account mapping at the flash model the account lists', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    const savedMapping = {
      main: 'deepseek-v4-pro[1m]',
      haiku: 'deepseek-v4-flash',
      sonnet: ' deepseek-v4-flash ',
      opus: 'deepseek-v4-pro[1m]',
      futureSlot: 'keep-me',
    }
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({
        schemaVersion: 7,
        activeId: 'deepseek-account',
        providers: [],
        officialProviderModels: {
          'deepseek-account': savedMapping,
          // Only the account mapping moves to the account's listed flash model.
          'openai-official': {
            main: 'deepseek-v4-flash',
            haiku: 'deepseek-v4-flash',
            sonnet: 'deepseek-v4-flash',
            opus: 'deepseek-v4-flash',
          },
        },
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow-code/providers.json')
    const migrated = JSON.parse(
      await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8'),
    ) as {
      schemaVersion: number
      officialProviderModels: Record<string, Record<string, string>>
    }
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.officialProviderModels['deepseek-account']).toEqual({
      main: 'deepseek-v4-pro[1m]',
      haiku: 'deepseek-flash',
      sonnet: 'deepseek-flash',
      opus: 'deepseek-v4-pro[1m]',
      futureSlot: 'keep-me',
    })
    expect(migrated.officialProviderModels['openai-official']?.haiku).toBe('deepseek-v4-flash')
    const backups = (await fs.readdir(ccHahaDir)).filter((name) =>
      name.startsWith('providers.json.bak-before-migration-'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(ccHahaDir, backups[0]!), 'utf-8'))
      .officialProviderModels['deepseek-account']).toEqual(savedMapping)
  })

  test('leaves a DeepSeek Account mapping saved under the current schema as the user chose it', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    const current = {
      schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
      activeId: 'deepseek-account',
      providers: [],
      providerOrder: ['claude-official', 'openai-official', 'grok-official', 'deepseek-account'],
      officialProviderModels: {
        'deepseek-account': {
          main: 'deepseek-v4-flash',
          haiku: 'deepseek-v4-flash',
          sonnet: 'deepseek-v4-flash',
          opus: 'deepseek-v4-flash',
        },
      },
    }
    await fs.writeFile(path.join(ccHahaDir, 'providers.json'), JSON.stringify(current, null, 2), 'utf-8')

    const report = await ensurePersistentStorageUpgraded()

    expect(report.migratedEntries).not.toContain('echoflow-code/providers.json')
    expect(JSON.parse(await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8'))).toEqual(current)
  })

  test('upgrades a version 2 provider fixture without inventing image credentials', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({
        schemaVersion: 2,
        activeId: 'provider-v2',
        providers: [{
          id: 'provider-v2',
          presetId: 'custom',
          name: 'Version 2 Provider',
          apiKey: 'chat-token',
          baseUrl: 'https://v2.example.test',
          apiFormat: 'anthropic',
          models: {
            main: 'chat-model',
            haiku: 'chat-model',
            sonnet: 'chat-model',
            opus: 'chat-model',
          },
          futureField: { preserved: true },
        }],
        providerOrder: ['provider-v2', 'claude-official', 'openai-official', 'grok-official'],
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    const migrated = JSON.parse(
      await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8'),
    ) as { schemaVersion: number; providers: Array<Record<string, unknown>> }
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.providers[0]?.imageGeneration).toBeUndefined()
    expect(migrated.providers[0]?.futureField).toEqual({ preserved: true })
  })

  test('turns legacy default Tool Search on into a safe opt-out during upgrade', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({
        schemaVersion: 3,
        activeId: 'provider-v3',
        providers: [{
          id: 'provider-v3',
          presetId: 'custom',
          name: 'Version 3 Provider',
          apiKey: 'chat-token',
          baseUrl: 'https://v3.example.test',
          apiFormat: 'anthropic',
          toolSearchEnabled: true,
          models: {
            main: 'chat-model',
            haiku: 'chat-model',
            sonnet: 'chat-model',
            opus: 'chat-model',
          },
          futureField: { preserved: true },
        }],
        providerOrder: ['provider-v3', 'claude-official', 'openai-official', 'grok-official'],
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow-code/providers.json')
    const migrated = JSON.parse(
      await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8'),
    ) as { schemaVersion: number; providers: Array<Record<string, unknown>> }
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.providers[0]?.toolSearchEnabled).toBe(false)
    expect(migrated.providers[0]?.futureField).toEqual({ preserved: true })
  })

  test('preserves Tool Search after explicit opt-in on the current provider schema', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({
        schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
        activeId: 'provider-current',
        providers: [{
          id: 'provider-current',
          presetId: 'custom',
          name: 'Current Provider',
          apiKey: 'chat-token',
          baseUrl: 'https://current.example.test',
          apiFormat: 'anthropic',
          toolSearchEnabled: true,
          models: {
            main: 'chat-model',
            haiku: 'chat-model',
            sonnet: 'chat-model',
            opus: 'chat-model',
          },
        }],
        providerOrder: ['provider-current', 'claude-official', 'openai-official', 'grok-official', 'deepseek-account'],
        officialProviderModels: {},
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).not.toContain('echoflow-code/providers.json')
    const current = JSON.parse(
      await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8'),
    ) as { providers: Array<Record<string, unknown>> }
    expect(current.providers[0]?.toolSearchEnabled).toBe(true)
  })

  test('does not import another product root provider configuration', async () => {
    const foreignDir = path.join(tempDir, 'cc-haha')
    await fs.mkdir(foreignDir, { recursive: true })
    const foreign = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'foreign-fake-token' }, sentinel: true })
    await fs.writeFile(path.join(foreignDir, 'settings.json'), foreign)
    await fs.writeFile(
      path.join(tempDir, 'providers.json'),
      JSON.stringify({
        version: 1,
        activeModel: 'legacy-sonnet',
        providers: [{
          id: 'legacy-provider',
          name: 'Legacy Root Provider',
          baseUrl: 'https://legacy.example.test',
          apiKey: 'legacy-token',
          models: [
            { id: 'legacy-haiku', name: 'Legacy Haiku' },
            { id: 'legacy-sonnet', name: 'Legacy Sonnet' },
          ],
          isActive: true,
          createdAt: 1,
          updatedAt: 2,
          notes: 'keep note',
        }],
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toEqual([])
    expect(await fs.exists(path.join(tempDir, 'echoflow-code', 'providers.json'))).toBe(false)
    expect(await fs.exists(path.join(tempDir, 'echoflow-code', 'settings.json'))).toBe(false)
    expect(await fs.readFile(path.join(foreignDir, 'settings.json'), 'utf8')).toBe(foreign)
    expect(JSON.parse(await fs.readFile(path.join(tempDir, 'providers.json'), 'utf-8'))).toMatchObject({
      version: 1,
      activeModel: 'legacy-sonnet',
    })

    const { providers, activeId } = await new ProviderService().listProviders()
    expect(activeId).toBeNull()
    expect(providers).toEqual([])
  })

  test('does not overwrite current cc-haha provider storage with a legacy root config', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(tempDir, 'providers.json'),
      JSON.stringify({
        version: 1,
        activeModel: 'legacy-model',
        providers: [{
          id: 'legacy-provider',
          name: 'Legacy Root Provider',
          baseUrl: 'https://legacy.example.test',
          apiKey: 'legacy-token',
          models: [{ id: 'legacy-model' }],
          isActive: true,
        }],
      }, null, 2),
      'utf-8',
    )
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({
        schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
        activeId: null,
        providers: [],
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).not.toContain('providers.json -> echoflow-code/providers.json')
    const current = JSON.parse(await fs.readFile(path.join(ccHahaDir, 'providers.json'), 'utf-8')) as {
      activeId?: string | null
      providerOrder?: string[]
      providers?: unknown[]
    }
    expect(current.activeId).toBeNull()
    expect(current.providerOrder).toEqual(['claude-official', 'openai-official', 'grok-official', 'deepseek-account'])
    expect(current.providers).toEqual([])
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
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(path.join(ccHahaDir, 'settings.json'), '{"env":', 'utf-8')

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow-code/settings.json')
    expect(JSON.parse(await fs.readFile(path.join(ccHahaDir, 'settings.json'), 'utf-8'))).toEqual({})
    const quarantined = (await listFiles(ccHahaDir)).filter((file) => file.startsWith('settings.json.invalid-'))
    expect(quarantined.length).toBe(1)
  })

  test('upgrades existing DeepSeek managed env to follow global thinking settings', async () => {
    const ccHahaDir = path.join(tempDir, 'echoflow-code')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'test-token',
          ANTHROPIC_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
          CC_HAHA_SEND_DISABLED_THINKING: '1',
          USER_CUSTOM_ENV: 'keep-me',
        },
      }, null, 2),
      'utf-8',
    )

    const report = await ensurePersistentStorageUpgraded()

    expect(report.failures).toEqual([])
    expect(report.migratedEntries).toContain('echoflow-code/settings.json')

    const migrated = JSON.parse(await fs.readFile(path.join(ccHahaDir, 'settings.json'), 'utf-8')) as {
      env?: Record<string, string>
    }
    expect(migrated.env?.CC_HAHA_SEND_DISABLED_THINKING).toBeUndefined()
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

    const backups = (await listFiles(ccHahaDir)).filter((file) => file.startsWith('settings.json.bak-before-migration-'))
    expect(backups.length).toBe(1)
  })
  test('upgrades v4 providers to automatic defaults with a backup and preserves unknown fields', async () => {
    const dir = path.join(tempDir, 'echoflow-code')
    const file = path.join(dir, 'providers.json')
    await fs.mkdir(dir, { recursive: true })
    const fixture = {
      presetId: 'custom', name: 'Fixture provider', apiKey: 'fake-test-token',
      baseUrl: 'https://provider.example.test/v1', apiFormat: 'openai_chat',
      models: { main: 'fixture-model', haiku: '', sonnet: '', opus: '' },
    }
    const compatibility = { maxOutputTokens: 96_000, outputTokenLimit: 128_000 }
    const legacy = {
      schemaVersion: 4,
      activeId: 'old',
      futureRoot: { keep: true },
      providers: [
        { ...fixture, id: 'old', toolSearchEnabled: true, futureProvider: 'keep' },
        { ...fixture, id: 'future', requestCompatibility: { ...compatibility, futureParameter: 'keep' } },
      ],
    }
    await fs.writeFile(file, JSON.stringify(legacy))
    const report = await ensurePersistentStorageUpgraded()
    expect(report.failures).toEqual([])
    const migrated = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(migrated.schemaVersion).toBeGreaterThan(4)
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.providers[0].requestCompatibility).toBeUndefined()
    expect(migrated.providers[0].toolSearchEnabled).toBe(true)
    expect(migrated.providers[0].futureProvider).toBe('keep')
    expect(migrated.futureRoot).toEqual({ keep: true })
    expect(migrated.providers[1].requestCompatibility.futureParameter).toBe('keep')
    expect(migrated.officialProviderModels).toEqual({})
    const backups = (await fs.readdir(dir)).filter(name => name.startsWith('providers.json.bak-before-migration-'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(dir, backups[0]!), 'utf8'))).toEqual(legacy)
    resetPersistentStorageMigrationsForTests()
    expect((await ensurePersistentStorageUpgraded()).migratedEntries).toEqual([])
    const service = new ProviderService()
    await service.updateProvider('old', { name: 'Renamed fixture' })
    const rewritten = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(rewritten.providers[1].requestCompatibility.futureParameter).toBe('keep')
    expect(rewritten.providers[0].futureProvider).toBe('keep')
  })

  test('preserves valid OAuth model mappings and unknown future entries while dropping malformed known entries', async () => {
    const dir = path.join(tempDir, 'echoflow-code')
    const file = path.join(dir, 'providers.json')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, JSON.stringify({
      schemaVersion: 5,
      activeId: 'openai-official',
      providers: [],
      providerOrder: ['openai-official'],
      officialProviderModels: {
        'openai-official': {
          main: 'gpt-6-astra',
          haiku: 'gpt-6-luna',
          sonnet: 'gpt-6-sol',
          opus: 'gpt-6-astra',
        },
        'grok-official': { main: 42 },
        'future-official': { main: 'future-model' },
      },
    }))

    const report = await ensurePersistentStorageUpgraded()
    expect(report.failures).toEqual([])
    const migrated = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(migrated.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(migrated.officialProviderModels).toEqual({
      'openai-official': {
        main: 'gpt-6-astra',
        haiku: 'gpt-6-luna',
        sonnet: 'gpt-6-sol',
        opus: 'gpt-6-astra',
      },
      'future-official': { main: 'future-model' },
    })
  })
})
