import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { ensureEchoFlowConfigRoot, getEchoFlowConfigDir, getEchoFlowInternalDir } from './echoFlowConfigRoot.js'
import { diagnosticsService } from './diagnosticsService.js'

type LegacyMigrationSource = 'current-cc-haha' | 'legacy-home-cc-haha' | 'current-root-providers' | 'legacy-home-root-providers'
type LegacyMigrationTarget = 'providers' | 'settings' | 'oauth' | 'openai-oauth' | 'desktop-ui'
type LegacyMigrationStatus = 'ready' | 'target-exists' | 'missing' | 'invalid' | 'failed' | 'migrated' | 'skipped'

export type LegacyMigrationItem = {
  id: string
  label: string
  source: LegacyMigrationSource
  target: LegacyMigrationTarget
  status: LegacyMigrationStatus
  message?: string
}

export type LegacyMigrationResult = {
  items: LegacyMigrationItem[]
  summary: Record<LegacyMigrationStatus, number>
}

type LegacyMigrationOptions = {
  configDir?: string
  legacyHomeConfigDir?: string
}

type JsonObject = Record<string, unknown>
type CcHahaSourceEntry = {
  source: Extract<LegacyMigrationSource, 'current-cc-haha' | 'legacy-home-cc-haha'>
  dir: string
}
type RootProviderSourceEntry = {
  source: Extract<LegacyMigrationSource, 'current-root-providers' | 'legacy-home-root-providers'>
  filePath: string
}

type LegacyProviderModel = {
  id: string
  name?: string
}

type LegacyRootProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: LegacyProviderModel[]
  isActive?: boolean
  notes?: string
}

type ProviderModels = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

type SavedProviderLike = {
  id: string
  presetId: string
  name: string
  apiKey: string
  baseUrl: string
  apiFormat?: string
  runtimeKind?: string
  models: ProviderModels
  [key: string]: unknown
}

const TARGET_FILES: Record<LegacyMigrationTarget, string> = {
  providers: 'providers.json',
  settings: 'settings.json',
  oauth: 'oauth.json',
  'openai-oauth': 'openai-oauth.json',
  'desktop-ui': 'desktop-ui.json',
}

const OPENAI_OFFICIAL_PROVIDER_ID = 'openai-official'

const ZERO_SUMMARY: Record<LegacyMigrationStatus, number> = {
  ready: 0,
  'target-exists': 0,
  missing: 0,
  invalid: 0,
  failed: 0,
  migrated: 0,
  skipped: 0,
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isLegacyProviderModel(value: unknown): value is LegacyProviderModel {
  return isRecord(value) && typeof value.id === 'string'
}

function isLegacyRootProvider(value: unknown): value is LegacyRootProvider {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.baseUrl === 'string' &&
    typeof value.apiKey === 'string' &&
    Array.isArray(value.models) &&
    value.models.every(isLegacyProviderModel)
  )
}

function isProviderModels(value: unknown): value is ProviderModels {
  return (
    isRecord(value) &&
    typeof value.main === 'string' &&
    typeof value.haiku === 'string' &&
    typeof value.sonnet === 'string' &&
    typeof value.opus === 'string'
  )
}

function isSavedProviderLike(value: unknown): value is SavedProviderLike {
  if (!isRecord(value)) return false
  const runtimeKind = value.runtimeKind
  return (
    typeof value.id === 'string' &&
    typeof value.presetId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.baseUrl === 'string' &&
    (
      runtimeKind === undefined ||
      runtimeKind === 'anthropic_compatible' ||
      runtimeKind === 'openai_oauth'
    ) &&
    isProviderModels(value.models)
  )
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function safeErrorType(error: unknown): string {
  if (error instanceof SyntaxError) return 'syntax_error'
  return errnoCode(error) ?? (error instanceof Error ? error.name : typeof error)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false
    throw error
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'))
}

async function writeJsonFileIfMissing(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp.${Date.now()}-${randomBytes(3).toString('hex')}`,
  )
  try {
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
    await fs.copyFile(tmpPath, filePath, fsConstants.COPYFILE_EXCL)
  } catch (error) {
    throw error
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined)
  }
}

async function copyFileIfMissing(sourcePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL)
}

function legacyProviderModelId(provider: LegacyRootProvider, preferredModelId: unknown): string {
  if (
    typeof preferredModelId === 'string' &&
    provider.models.some((model) => model.id === preferredModelId)
  ) {
    return preferredModelId
  }
  return provider.models[0]?.id ?? ''
}

function migrateLegacyRootProvidersConfig(value: unknown): JsonObject | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return null
  }

  const providers = value.providers
    .filter(isLegacyRootProvider)
    .map((provider) => {
      const main = legacyProviderModelId(provider, value.activeModel)
      return {
        id: provider.id,
        presetId: 'custom',
        name: provider.name,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        apiFormat: 'anthropic',
        models: {
          main,
          haiku: main,
          sonnet: main,
          opus: main,
        },
        ...(provider.notes !== undefined && { notes: provider.notes }),
      }
    })

  if (providers.length === 0) return null

  const activeLegacyProvider = value.providers
    .filter(isLegacyRootProvider)
    .find((provider) =>
      provider.isActive === true ||
      (
        typeof value.activeModel === 'string' &&
        provider.models.some((model) => model.id === value.activeModel)
      ),
    )
  const activeId =
    activeLegacyProvider && providers.some((provider) => provider.id === activeLegacyProvider.id)
      ? activeLegacyProvider.id
      : null

  return {
    schemaVersion: 1,
    activeId,
    providers,
  }
}

function buildManagedSettingsForMigratedProvider(provider: JsonObject | undefined): JsonObject | null {
  if (!provider || !isRecord(provider.models)) return null
  const models = provider.models
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : ''
  const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl : ''
  if (!apiKey || !baseUrl) return null
  if (
    typeof models.main !== 'string' ||
    typeof models.haiku !== 'string' ||
    typeof models.sonnet !== 'string' ||
    typeof models.opus !== 'string'
  ) {
    return null
  }

  return {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: models.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
    },
  }
}

function normalizeProviderModels(models: ProviderModels): ProviderModels {
  const main = models.main.trim()
  return {
    main,
    haiku: models.haiku.trim() || main,
    sonnet: models.sonnet.trim() || main,
    opus: models.opus.trim() || main,
  }
}

function normalizeSavedProviderLike(provider: SavedProviderLike): SavedProviderLike {
  return {
    ...provider,
    apiFormat: provider.apiFormat ?? 'anthropic',
    runtimeKind: provider.runtimeKind ?? 'anthropic_compatible',
    models: normalizeProviderModels(provider.models),
  }
}

function normalizeCopiedProviders(value: unknown): JsonObject | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return null
  }

  const { activeProviderId: legacyActiveProviderId, ...rest } = value
  const providers = value.providers
    .filter(isSavedProviderLike)
    .map((provider) => normalizeSavedProviderLike(provider))
  const rawActiveId =
    typeof value.activeId === 'string'
      ? value.activeId
      : typeof legacyActiveProviderId === 'string'
        ? legacyActiveProviderId
        : null
  const activeId = rawActiveId && (
    providers.some((provider) => provider.id === rawActiveId) ||
    rawActiveId === OPENAI_OFFICIAL_PROVIDER_ID
  )
    ? rawActiveId
    : null

  return {
    ...rest,
    schemaVersion: 1,
    activeId,
    providers,
  }
}

function summarize(items: LegacyMigrationItem[]): Record<LegacyMigrationStatus, number> {
  const summary = { ...ZERO_SUMMARY }
  for (const item of items) {
    summary[item.status] += 1
  }
  return summary
}

function claimsTarget(status: LegacyMigrationStatus): boolean {
  return status === 'ready' || status === 'migrated' || status === 'target-exists'
}

function foundUsableLegacyData(status: LegacyMigrationStatus): boolean {
  return status === 'ready' || status === 'migrated'
}

export class LegacyMigrationService {
  private readonly configDir: string
  private readonly legacyHomeConfigDir: string

  constructor(options: LegacyMigrationOptions = {}) {
    this.configDir = options.configDir ?? getEchoFlowConfigDir()
    this.legacyHomeConfigDir = options.legacyHomeConfigDir ?? path.join(os.homedir(), '.claude')
  }

  async getStatus(): Promise<LegacyMigrationResult> {
    const items = await this.buildItems(false)
    return { items, summary: summarize(items) }
  }

  async run(): Promise<LegacyMigrationResult> {
    await ensureEchoFlowConfigRoot(this.configDir)
    const items = await this.buildItems(true)
    void diagnosticsService.recordEvent({
      type: 'legacy_migration_run',
      severity: items.some((item) => item.status === 'failed') ? 'warn' : 'info',
      summary: 'Legacy migration completed',
      details: {
        summary: summarize(items),
        items: items.map(({ id, source, target, status, message }) => ({
          id,
          source,
          target,
          status,
          ...(message ? { message } : {}),
        })),
      },
    })
    return { items, summary: summarize(items) }
  }

  private targetPath(target: LegacyMigrationTarget): string {
    return path.join(getEchoFlowInternalDir(this.configDir), TARGET_FILES[target])
  }

  private sourceDirs(): CcHahaSourceEntry[] {
    const entries: CcHahaSourceEntry[] = [
      { source: 'current-cc-haha', dir: path.join(this.configDir, 'cc-haha') },
    ]
    const legacyCcHaha = path.join(this.legacyHomeConfigDir, 'cc-haha')
    if (path.resolve(legacyCcHaha) !== path.resolve(entries[0]!.dir)) {
      entries.push({ source: 'legacy-home-cc-haha', dir: legacyCcHaha })
    }
    return entries
  }

  private rootProviderSources(): RootProviderSourceEntry[] {
    const entries: RootProviderSourceEntry[] = [
      { source: 'current-root-providers', filePath: path.join(this.configDir, 'providers.json') },
    ]
    const legacyRoot = path.join(this.legacyHomeConfigDir, 'providers.json')
    if (path.resolve(legacyRoot) !== path.resolve(entries[0]!.filePath)) {
      entries.push({ source: 'legacy-home-root-providers', filePath: legacyRoot })
    }
    return entries
  }

  private async buildItems(run: boolean): Promise<LegacyMigrationItem[]> {
    const items: LegacyMigrationItem[] = []
    const consumedTargets = new Set<LegacyMigrationTarget>()
    const ccHahaSources = this.sourceDirs()
    const rootSources = this.rootProviderSources()

    const currentHadUsableData = await this.buildSourceGroupItems(
      {
        ccHahaSource: ccHahaSources[0],
        rootSource: rootSources[0],
      },
      consumedTargets,
      items,
      run,
    )

    if (!currentHadUsableData) {
      await this.buildSourceGroupItems(
        {
          ccHahaSource: ccHahaSources[1],
          rootSource: rootSources[1],
        },
        consumedTargets,
        items,
        run,
      )
    }

    return items
  }

  private async buildSourceGroupItems(
    sources: {
      ccHahaSource?: CcHahaSourceEntry
      rootSource?: RootProviderSourceEntry
    },
    consumedTargets: Set<LegacyMigrationTarget>,
    items: LegacyMigrationItem[],
    run: boolean,
  ): Promise<boolean> {
    let hasUsableData = false
    const { ccHahaSource, rootSource } = sources

    if (ccHahaSource) {
      for (const target of ['providers', 'settings', 'oauth', 'openai-oauth', 'desktop-ui'] as const) {
        if (consumedTargets.has(target)) continue
        const item = await this.handleCcHahaFile(ccHahaSource.source, ccHahaSource.dir, target, run)
        items.push(item)
        if (foundUsableLegacyData(item.status)) {
          hasUsableData = true
        }
        if (claimsTarget(item.status)) {
          consumedTargets.add(target)
        }
      }
    }

    if (rootSource && !consumedTargets.has('providers')) {
      const rootItems = await this.handleRootProviders(
        rootSource.source,
        rootSource.filePath,
        run,
        consumedTargets.has('settings'),
      )
      items.push(...rootItems)
      if (rootItems.some((item) => foundUsableLegacyData(item.status))) {
        hasUsableData = true
      }
      if (rootItems.some((item) => claimsTarget(item.status))) {
        consumedTargets.add('providers')
        if (rootItems.some((item) => item.target === 'settings' && claimsTarget(item.status))) {
          consumedTargets.add('settings')
        }
      }
    }

    return hasUsableData
  }

  private async handleCcHahaFile(
    source: Extract<LegacyMigrationSource, 'current-cc-haha' | 'legacy-home-cc-haha'>,
    sourceDir: string,
    target: LegacyMigrationTarget,
    run: boolean,
  ): Promise<LegacyMigrationItem> {
    const sourcePath = path.join(sourceDir, TARGET_FILES[target])
    const targetPath = this.targetPath(target)
    const id = `${source}:${target}`
    const label = `${source} ${target}`

    try {
      if (await pathExists(targetPath)) {
        return { id, label, source, target, status: 'target-exists' }
      }
      if (!(await pathExists(sourcePath))) {
        return { id, label, source, target, status: 'missing' }
      }

      if (target === 'providers') {
        const normalized = normalizeCopiedProviders(await readJsonFile(sourcePath))
        if (!normalized) {
          return { id, label, source, target, status: 'invalid', message: 'invalid_provider_index' }
        }
        if (!run) return { id, label, source, target, status: 'ready' }
        await writeJsonFileIfMissing(targetPath, normalized)
      } else {
        if (!run) return { id, label, source, target, status: 'ready' }
        await copyFileIfMissing(sourcePath, targetPath)
      }
      return { id, label, source, target, status: 'migrated' }
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') {
        return { id, label, source, target, status: 'target-exists' }
      }
      const status = error instanceof SyntaxError ? 'invalid' : 'failed'
      return {
        id,
        label,
        source,
        target,
        status,
        message: safeErrorType(error),
      }
    }
  }

  private async handleRootProviders(
    source: Extract<LegacyMigrationSource, 'current-root-providers' | 'legacy-home-root-providers'>,
    sourcePath: string,
    run: boolean,
    settingsClaimed: boolean,
  ): Promise<LegacyMigrationItem[]> {
    const providerTargetPath = this.targetPath('providers')
    const settingsTargetPath = this.targetPath('settings')
    const providerItem: LegacyMigrationItem = {
      id: `${source}:providers`,
      label: `${source} providers`,
      source,
      target: 'providers',
      status: 'missing',
    }
    const settingsItem: LegacyMigrationItem = {
      id: `${source}:settings`,
      label: `${source} settings`,
      source,
      target: 'settings',
      status: 'missing',
    }

    try {
      const providerTargetExists = await pathExists(providerTargetPath)
      const settingsTargetExists = await pathExists(settingsTargetPath)
      if (!(await pathExists(sourcePath))) {
        return [{ ...providerItem, status: providerTargetExists ? 'target-exists' : 'missing' }]
      }
      if (providerTargetExists) {
        return [{ ...providerItem, status: 'target-exists' }]
      }

      const migrated = migrateLegacyRootProvidersConfig(await readJsonFile(sourcePath))
      if (!migrated) {
        return [{ ...providerItem, status: 'invalid', message: 'No valid legacy providers found' }]
      }

      const activeId = typeof migrated.activeId === 'string' ? migrated.activeId : null
      const activeProvider = Array.isArray(migrated.providers)
        ? migrated.providers.find((provider) => isRecord(provider) && provider.id === activeId)
        : undefined
      const managedSettings = buildManagedSettingsForMigratedProvider(
        isRecord(activeProvider) ? activeProvider : undefined,
      )

      if (!run) {
        return [
          { ...providerItem, status: 'ready' },
          ...(settingsClaimed ? [] : [
            { ...settingsItem, status: settingsTargetExists || !managedSettings ? (settingsTargetExists ? 'target-exists' : 'skipped') : 'ready' },
          ]),
        ]
      }

      try {
        await writeJsonFileIfMissing(providerTargetPath, migrated)
      } catch (error) {
        if (errnoCode(error) === 'EEXIST') {
          return [{ ...providerItem, status: 'target-exists' }]
        }
        throw error
      }

      let settingsStatus: LegacyMigrationStatus
      if (!settingsClaimed && !settingsTargetExists && managedSettings) {
        try {
          await writeJsonFileIfMissing(settingsTargetPath, managedSettings)
          settingsStatus = 'migrated'
        } catch (error) {
          if (errnoCode(error) === 'EEXIST') {
            settingsStatus = 'target-exists'
          } else {
            return [
              { ...providerItem, status: 'migrated' },
              { ...settingsItem, status: 'failed', message: safeErrorType(error) },
            ]
          }
        }
      } else {
        settingsStatus = settingsTargetExists ? 'target-exists' : 'skipped'
      }
      return [
        { ...providerItem, status: 'migrated' },
        ...(settingsClaimed ? [] : [
          { ...settingsItem, status: settingsStatus },
        ]),
      ]
    } catch (error) {
      const status = error instanceof SyntaxError ? 'invalid' : 'failed'
      return [{
        ...providerItem,
        status,
        message: safeErrorType(error),
      }]
    }
  }
}
