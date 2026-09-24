import type { ShareableConfig, ShareableProvider } from '../types/configShare'
import type { CreateProviderInput, SavedProvider } from '../types/provider'

export type ConfigImportResult = { imported: number; skipped: number; skippedNames: string[] }

export function providerToCreateInput(provider: ShareableProvider): CreateProviderInput {
  return {
    presetId: provider.presetId,
    name: provider.name,
    apiKey: '',
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    authStrategy: provider.authStrategy,
    runtimeKind: provider.runtimeKind,
    models: provider.models,
    model1mSupport: provider.model1mSupport,
    autoCompactWindow: provider.autoCompactWindow,
    modelContextWindows: provider.modelContextWindows,
    toolSearchEnabled: provider.toolSearchEnabled,
    disableExperimentalBetas: provider.disableExperimentalBetas,
    supportsNestedToolResultMedia: provider.supportsNestedToolResultMedia,
    requestCompatibility: provider.requestCompatibility,
    imageGeneration: provider.imageGeneration,
    notes: provider.notes,
  }
}

export async function importConfig(
  config: ShareableConfig,
  stores: {
    providers: SavedProvider[]
    createProvider: (input: CreateProviderInput) => Promise<unknown>
  },
): Promise<ConfigImportResult> {
  const existing = new Set(stores.providers.map(providerIdentity))
  const result: ConfigImportResult = { imported: 0, skipped: 0, skippedNames: [] }

  for (const provider of config.config.providers) {
    if (existing.has(providerIdentity(provider))) {
      result.skipped += 1
      result.skippedNames.push(provider.name)
      continue
    }
    await stores.createProvider(providerToCreateInput(provider))
    existing.add(providerIdentity(provider))
    result.imported += 1
  }
  return result
}

function providerIdentity(provider: Pick<SavedProvider, 'name' | 'baseUrl'> | ShareableProvider): string {
  return `${provider.name.trim().toLocaleLowerCase()}\n${normalizeBaseUrl(provider.baseUrl)}`
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLocaleLowerCase()
}
