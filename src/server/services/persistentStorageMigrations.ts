import * as fs from 'fs/promises'
import { migrateScheduledTasks } from './scheduledTaskMigrations.js'
import * as os from 'os'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import { getEchoFlowConfigDir, getEchoFlowInternalDir, ensureEchoFlowConfigRoot } from './echoFlowConfigRoot.js'
import { normalizeLegacyDeepSeekManagedEnv } from '../../utils/providerManagedEnvCompat.js'
import { isOpenAIOfficialProviderId } from './openaiOfficialProvider.js'
import { isGrokOfficialProviderId } from './grokOfficialProvider.js'
import {
  isDeepSeekAccountProviderId,
  migrateLegacyDeepSeekAccountModels,
} from './deepseekAccountProvider.js'
import {
  BUILT_IN_PROVIDER_IDS,
  DEEPSEEK_ACCOUNT_PROVIDER_ID,
  PROVIDER_DEEPSEEK_ACCOUNT_MODEL_IDS_SCHEMA_VERSION,
  PROVIDER_ECHOFLOW_CREDENTIAL_SOURCE_SCHEMA_VERSION,
  PROVIDER_IMAGE_PROTOCOL_SCHEMA_VERSION,
  PROVIDER_TOOL_SEARCH_OPT_IN_SCHEMA_VERSION,
} from '../types/provider.js'

export const CURRENT_PROVIDER_INDEX_SCHEMA_VERSION = PROVIDER_ECHOFLOW_CREDENTIAL_SOURCE_SCHEMA_VERSION

type MigrationReport = {
  migratedEntries: string[]
  failures: string[]
}

type JsonObject = Record<string, unknown>

let migrationPromise: Promise<MigrationReport> | null = null
let migrationConfigDir: string | null = null

function getConfigDir(): string {
  return getEchoFlowConfigDir()
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProviderModels(value: unknown): value is JsonObject {
  return (
    isRecord(value) &&
    typeof value.main === 'string' &&
    (value.fable === undefined || typeof value.fable === 'string') &&
    typeof value.haiku === 'string' &&
    typeof value.sonnet === 'string' &&
    typeof value.opus === 'string'
  )
}

function isSavedProvider(value: unknown): value is JsonObject {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.presetId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.baseUrl === 'string' &&
    isProviderModels(value.models)
  )
}

function normalizeOfficialProviderModels(value: unknown, sourceSchemaVersion: number): JsonObject {
  if (!isRecord(value)) return {}
  const normalized: JsonObject = { ...value }
  for (const id of BUILT_IN_PROVIDER_IDS) {
    if (!isProviderModels(value[id])) {
      delete normalized[id]
    }
  }
  const deepSeekAccountModels = normalized[DEEPSEEK_ACCOUNT_PROVIDER_ID]
  if (
    sourceSchemaVersion < PROVIDER_DEEPSEEK_ACCOUNT_MODEL_IDS_SCHEMA_VERSION &&
    isRecord(deepSeekAccountModels)
  ) {
    normalized[DEEPSEEK_ACCOUNT_PROVIDER_ID] = migrateLegacyDeepSeekAccountModels(deepSeekAccountModels)
  }
  return normalized
}

function defaultProviderOrder(providers: JsonObject[]): string[] {
  return [
    ...providers
      .map((provider) => provider.id)
      .filter((id): id is string => typeof id === 'string'),
    ...BUILT_IN_PROVIDER_IDS,
  ]
}

function normalizeProviderOrder(value: unknown, providers: JsonObject[]): string[] {
  const knownIds = new Set<string>(defaultProviderOrder(providers))
  const source = Array.isArray(value) ? value : defaultProviderOrder(providers)
  const seen = new Set<string>()
  const order: string[] = []

  for (const id of source) {
    if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }

  for (const id of defaultProviderOrder(providers)) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }

  return order
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

async function readJsonFile(filePath: string): Promise<{ missing: boolean; value: unknown; raw: string }> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return { missing: false, value: JSON.parse(raw), raw }
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return { missing: true, value: undefined, raw: '' }
    }
    throw error
  }
}

async function backupFile(filePath: string, suffix: string): Promise<void> {
  const backupPath = `${filePath}.${suffix}-${Date.now()}-${randomBytes(3).toString('hex')}`
  await fs.copyFile(filePath, backupPath)
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}-${randomBytes(3).toString('hex')}`
  try {
    await fs.writeFile(tmpPath, stableStringify(value), 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {})
    throw error
  }
}

async function quarantineMalformedFile(filePath: string): Promise<void> {
  const invalidPath = `${filePath}.invalid-${Date.now()}-${randomBytes(3).toString('hex')}`
  await fs.rename(filePath, invalidPath)
}

function migrateProvidersIndex(value: unknown): JsonObject {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return {
      schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
      activeId: null,
      providers: [],
      providerOrder: [...BUILT_IN_PROVIDER_IDS],
      officialProviderModels: {},
    }
  }

  const {
    activeProviderId: _legacyActiveProviderId,
    providerOrder: rawProviderOrder,
    officialProviderModels: rawOfficialProviderModels,
    ...rest
  } = value
  const sourceSchemaVersion = typeof value.schemaVersion === 'number' ? value.schemaVersion : 1
  // v5 introduces optional requestCompatibility. An absent object is the
  // automatic policy, so upgrading v4 must not materialize a numeric budget
  // from old Claude defaults. Spreading providers also preserves future fields.
  const providers = value.providers
    .filter(isSavedProvider)
    .map((provider) => sourceSchemaVersion < PROVIDER_TOOL_SEARCH_OPT_IN_SCHEMA_VERSION
      ? { ...provider, toolSearchEnabled: false }
      : provider)
    .map((provider) => {
      const credentialSource = provider.credentialSource
      if (
        !isRecord(credentialSource) ||
        credentialSource.kind !== 'echoflow-token' ||
        typeof credentialSource.tokenId !== 'string' ||
        !credentialSource.tokenId.trim() ||
        (typeof credentialSource.tokenName === 'string' && credentialSource.tokenName.trim().length > 0)
      ) {
        return provider
      }
      return {
        ...provider,
        credentialSource: { ...credentialSource, tokenName: provider.name },
      }
    })
    .map((provider) => {
      const imageGeneration = provider.imageGeneration
      if (sourceSchemaVersion >= PROVIDER_IMAGE_PROTOCOL_SCHEMA_VERSION ||
        !isRecord(imageGeneration) || typeof imageGeneration.model !== 'string' ||
        !imageGeneration.model.trim() || imageGeneration.protocol !== undefined) {
        return provider
      }
      return {
        ...provider,
        imageGeneration: { ...imageGeneration, protocol: 'openai_images' },
      }
    })
  const rawActiveId =
    typeof value.activeId === 'string'
      ? value.activeId
      : typeof _legacyActiveProviderId === 'string'
        ? _legacyActiveProviderId
        : null
  const activeId = rawActiveId && (
    providers.some((provider) => provider.id === rawActiveId) ||
    isOpenAIOfficialProviderId(rawActiveId) ||
    isGrokOfficialProviderId(rawActiveId) ||
    isDeepSeekAccountProviderId(rawActiveId)
  )
    ? rawActiveId
    : null

  return {
    ...rest,
    schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
    activeId,
    providers,
    providerOrder: normalizeProviderOrder(rawProviderOrder, providers),
    officialProviderModels: normalizeOfficialProviderModels(rawOfficialProviderModels, sourceSchemaVersion),
  }
}

function migrateManagedSettings(value: unknown): JsonObject {
  if (!isRecord(value)) return {}
  if (value.env !== undefined && !isRecord(value.env)) {
    return { ...value, env: {} }
  }
  if (isRecord(value.env)) {
    const { env, changed } = normalizeLegacyDeepSeekManagedEnv(value.env as Record<string, string>)
    if (changed) return { ...value, env }
  }
  return value
}

async function migrateJsonEntry(
  filePath: string,
  entryName: string,
  report: MigrationReport,
  migrate: (value: unknown) => JsonObject,
): Promise<void> {
  try {
    const current = await readJsonFile(filePath)
    if (current.missing) return

    const migrated = migrate(current.value)
    if (stableStringify(migrated) === stableStringify(current.value)) return

    await backupFile(filePath, 'bak-before-migration')
    await writeJsonFile(filePath, migrated)
    report.migratedEntries.push(entryName)
  } catch (error) {
    if (error instanceof SyntaxError) {
      try {
        await quarantineMalformedFile(filePath)
        await writeJsonFile(filePath, {})
        report.migratedEntries.push(entryName)
        return
      } catch (recoveryError) {
        report.failures.push(`${entryName}: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
        return
      }
    }

    report.failures.push(`${entryName}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function copyLegacyEchoFlowEntries(configDir: string, report: MigrationReport): Promise<void> {
  const sourceDir = getEchoFlowInternalDir(path.join(os.homedir(), '.claude'))
  const targetDir = getEchoFlowInternalDir(configDir)
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return

  for (const name of ['providers.json', 'settings.json']) {
    const sourcePath = path.join(sourceDir, name)
    const targetPath = path.join(targetDir, name)
    try {
      const source = await readJsonFile(sourcePath)
      if (source.missing) continue
      if (!isRecord(source.value) || (name === 'providers.json' && !Array.isArray(source.value.providers))) {
        report.failures.push(`legacy echoflow-code/${name}: invalid object`)
        continue
      }
      let target
      try {
        target = await readJsonFile(targetPath)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        await backupFile(targetPath, 'bak-before-migration')
        await writeJsonFile(targetPath, source.value)
        report.migratedEntries.push(`legacy echoflow-code/${name}`)
        continue
      }
      if (!target.missing && (!isRecord(target.value) || (name === 'providers.json' && !Array.isArray(target.value.providers)))) {
        await backupFile(targetPath, 'bak-before-migration')
        await writeJsonFile(targetPath, source.value)
        report.migratedEntries.push(`legacy echoflow-code/${name}`)
        continue
      }
      if (!target.missing) {
        const normalize = name === 'providers.json' ? migrateProvidersIndex : migrateManagedSettings
        if (stableStringify(normalize(target.value)) !== stableStringify(normalize(source.value))) {
          report.failures.push(`legacy echoflow-code/${name}: conflict; existing target retained`)
        }
        continue
      }
      await fs.mkdir(targetDir, { recursive: true })
      // Exclusive copy keeps a concurrently created target authoritative and the source untouched.
      await fs.copyFile(sourcePath, targetPath, (await import('node:fs')).constants.COPYFILE_EXCL)
      report.migratedEntries.push(`legacy echoflow-code/${name}`)
    } catch (error) {
      report.failures.push(`legacy echoflow-code/${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function runPersistentStorageMigrations(configDir: string): Promise<MigrationReport> {
  const report: MigrationReport = { migratedEntries: [], failures: [] }
  const ccHahaDir = getEchoFlowInternalDir(configDir)
  await ensureEchoFlowConfigRoot(configDir)
  await copyLegacyEchoFlowEntries(configDir, report)

  // Task definitions are user-authored data: never quarantine/reset malformed JSON.
  const tasksPath = path.join(configDir, 'scheduled_tasks.json')
  try {
    const current = await readJsonFile(tasksPath)
    if (!current.missing) {
      const migrated = migrateScheduledTasks(current.value)
      if (stableStringify(migrated) !== stableStringify(current.value)) {
        await backupFile(tasksPath, 'bak-before-migration')
        await writeJsonFile(tasksPath, migrated)
        report.migratedEntries.push('scheduled_tasks.json')
      }
    }
  } catch (error) {
    report.failures.push(`scheduled_tasks.json: ${error instanceof Error ? error.message : String(error)}`)
  }

  await migrateJsonEntry(
    path.join(ccHahaDir, 'providers.json'),
    'echoflow-code/providers.json',
    report,
    migrateProvidersIndex,
  )
  await migrateJsonEntry(
    path.join(ccHahaDir, 'settings.json'),
    'echoflow-code/settings.json',
    report,
    migrateManagedSettings,
  )

  return report
}

export function ensurePersistentStorageUpgraded(): Promise<MigrationReport> {
  const configDir = getConfigDir()
  if (!migrationPromise || migrationConfigDir !== configDir) {
    migrationConfigDir = configDir
    migrationPromise = runPersistentStorageMigrations(configDir)
  }
  return migrationPromise
}

export function resetPersistentStorageMigrationsForTests(): void {
  migrationPromise = null
  migrationConfigDir = null
}
