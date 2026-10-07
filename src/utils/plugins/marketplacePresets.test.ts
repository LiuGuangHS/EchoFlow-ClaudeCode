import { describe, expect, test } from 'bun:test'
import {
  createMarketplacePresetRegistry,
  DEFAULT_MARKETPLACE_PRESETS,
  extendMarketplacePresetRegistry,
  findMarketplacePreset,
  isTrustedMarketplaceSource,
} from './marketplacePresets.js'

const fixtureSource = {
  source: 'file' as const,
  path: './fixtures/marketplace.json',
}

const fixturePreset = {
  id: 'local-fixture',
  label: 'Local fixture',
  source: fixtureSource,
}

describe('marketplace preset registry', () => {
  test('has no unverified vendor defaults', () => {
    expect(DEFAULT_MARKETPLACE_PRESETS).toEqual([])
    expect(createMarketplacePresetRegistry()).toEqual(new Map())
  })

  test('requires callers to verify fixture sources', () => {
    expect(() => createMarketplacePresetRegistry([fixturePreset])).toThrow(
      'requires verified source data',
    )

    const registry = createMarketplacePresetRegistry([fixturePreset], {
      verifySource: source => source.source === 'file' && source.path.startsWith('./fixtures/'),
    })
    expect(findMarketplacePreset(registry, fixtureSource)).toEqual(fixturePreset)
    expect(isTrustedMarketplaceSource(registry, fixtureSource)).toBe(true)
    expect(
      isTrustedMarketplaceSource(registry, {
        source: 'file',
        path: './fixtures/other.json',
      }),
    ).toBe(false)
  })

  test('extends without replacing existing ids', () => {
    const registry = createMarketplacePresetRegistry([fixturePreset], {
      verifySource: () => true,
    })
    const extended = extendMarketplacePresetRegistry(
      registry,
      [{ ...fixturePreset, id: 'another-fixture' }],
      { verifySource: () => true },
    )
    expect([...extended.keys()]).toEqual(['local-fixture', 'another-fixture'])
    expect(() =>
      extendMarketplacePresetRegistry(registry, [fixturePreset], {
        verifySource: () => true,
      }),
    ).toThrow('Duplicate marketplace preset id')
  })
})
