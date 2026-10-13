import type { MarketplaceSource } from './schemas.js'
import { MarketplaceSourceSchema } from './schemas.js'

/** A named marketplace source that has been verified by the caller. */
export type MarketplacePresetDescriptor = {
  id: string
  label: string
  source: MarketplaceSource
  description?: string
}

export type MarketplacePresetVerifier = (
  source: MarketplaceSource,
) => boolean

export type MarketplacePresetRegistry = ReadonlyMap<
  string,
  MarketplacePresetDescriptor
>

export type MarketplacePresetRegistryOptions = {
  verifySource?: MarketplacePresetVerifier
}

/** No vendor URLs are bundled until their source can be independently verified. */
export const DEFAULT_MARKETPLACE_PRESETS: readonly MarketplacePresetDescriptor[] =
  []

function validateDescriptor(
  descriptor: MarketplacePresetDescriptor,
  verifySource: MarketplacePresetVerifier | undefined,
): MarketplacePresetDescriptor {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(descriptor.id)) {
    throw new Error(`Invalid marketplace preset id: ${descriptor.id}`)
  }
  if (!descriptor.label.trim()) {
    throw new Error(`Marketplace preset ${descriptor.id} must have a label`)
  }

  const source = MarketplaceSourceSchema().parse(descriptor.source)
  if (!verifySource?.(source)) {
    throw new Error(
      `Marketplace preset ${descriptor.id} requires verified source data`,
    )
  }

  return { ...descriptor, source }
}

/** Build a registry, rejecting every source that the caller has not verified. */
export function createMarketplacePresetRegistry(
  presets: readonly MarketplacePresetDescriptor[] = DEFAULT_MARKETPLACE_PRESETS,
  options: MarketplacePresetRegistryOptions = {},
): MarketplacePresetRegistry {
  const registry = new Map<string, MarketplacePresetDescriptor>()
  for (const preset of presets) {
    if (registry.has(preset.id)) {
      throw new Error(`Duplicate marketplace preset id: ${preset.id}`)
    }
    registry.set(preset.id, validateDescriptor(preset, options.verifySource))
  }
  return registry
}

/** Extend a registry without allowing unverified entries or replacing an id. */
export function extendMarketplacePresetRegistry(
  registry: MarketplacePresetRegistry,
  presets: readonly MarketplacePresetDescriptor[],
  options: MarketplacePresetRegistryOptions = {},
): MarketplacePresetRegistry {
  const merged = new Map(registry)
  for (const preset of presets) {
    if (merged.has(preset.id)) {
      throw new Error(`Duplicate marketplace preset id: ${preset.id}`)
    }
    merged.set(preset.id, validateDescriptor(preset, options.verifySource))
  }
  return merged
}

function sourcesMatch(a: MarketplaceSource, b: MarketplaceSource): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function findMarketplacePreset(
  registry: MarketplacePresetRegistry,
  source: MarketplaceSource,
): MarketplacePresetDescriptor | undefined {
  return [...registry.values()].find(preset => sourcesMatch(preset.source, source))
}

/** A source is trusted only when it exactly matches a verified registry entry. */
export function isTrustedMarketplaceSource(
  registry: MarketplacePresetRegistry,
  source: MarketplaceSource,
): boolean {
  return findMarketplacePreset(registry, source) !== undefined
}
