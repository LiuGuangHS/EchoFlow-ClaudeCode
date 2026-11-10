#!/usr/bin/env bun

/**
 * Generates the product identity modules from `product.json`.
 *
 * `product.json` is the single source of truth. Nothing else should spell the
 * product name, app id, package id, scheme, repository URL or env prefix by
 * hand: an upstream sync can overwrite any individual file, but it cannot
 * overwrite the generator output without `--check` failing in CI.
 *
 *   bun run scripts/generate-product-identity.ts            # write
 *   bun run scripts/generate-product-identity.ts --check    # verify only
 *   bun run scripts/generate-product-identity.ts <outDir>   # test fixture
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type ProductIdentity = {
  name: string
  slug: string
  appId: string
  mobilePackage: string
  mobileBundleId: string
  scheme: string
  protocol: string
  repoUrl: string
  docsUrl: string
  envPrefix: string
  legacyEnvPrefix: string
  configDir: string
  adsPublisherId: string
}

export const TARGETS = [
  'src/utils/productIdentity.generated.ts',
  'desktop/src/lib/productIdentity.generated.ts',
  'mobile/src/config/productIdentity.generated.ts',
] as const

const HEADER = '// GENERATED FROM product.json — do not edit. Run `bun run product:identity`.\n'

export function render(identity: ProductIdentity): string {
  const entries = Object.entries(identity)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
    .join('\n')
  return [
    HEADER,
    'export const PRODUCT_IDENTITY = {',
    entries,
    '} as const',
    '',
    'export type ProductIdentity = typeof PRODUCT_IDENTITY',
    '',
    'export const PRODUCT_NAME = PRODUCT_IDENTITY.name',
    'export const PRODUCT_SLUG = PRODUCT_IDENTITY.slug',
    'export const PRODUCT_APP_ID = PRODUCT_IDENTITY.appId',
    'export const PRODUCT_REPO_URL = PRODUCT_IDENTITY.repoUrl',
    'export const PRODUCT_ENV_PREFIX = PRODUCT_IDENTITY.envPrefix',
    'export const PRODUCT_LEGACY_ENV_PREFIX = PRODUCT_IDENTITY.legacyEnvPrefix',
    'export const PRODUCT_CONFIG_DIR = PRODUCT_IDENTITY.configDir',
    '',
  ].join('\n')
}

export function readIdentity(root: string): ProductIdentity {
  const raw = JSON.parse(readFileSync(path.join(root, 'product.json'), 'utf8')) as ProductIdentity
  const required: Array<keyof ProductIdentity> = [
    'name', 'slug', 'appId', 'mobilePackage', 'mobileBundleId', 'scheme',
    'protocol', 'repoUrl', 'docsUrl', 'envPrefix', 'legacyEnvPrefix',
    'configDir', 'adsPublisherId',
  ]
  const missing = required.filter(key => typeof raw[key] !== 'string' || raw[key].length === 0)
  if (missing.length > 0) {
    throw new Error(`product.json is missing required string fields: ${missing.join(', ')}`)
  }
  return raw
}

export function generate(root: string, outDir = root): string[] {
  const content = render(readIdentity(root))
  return TARGETS.map(target => {
    const file = path.join(outDir, target)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf8')
    return file
  })
}

export function check(root: string, outDir = root): string[] {
  const expected = render(readIdentity(root))
  return TARGETS.filter(target => {
    try {
      return readFileSync(path.join(outDir, target), 'utf8') !== expected
    } catch {
      return true
    }
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const root = path.resolve(import.meta.dir, '..')
  if (args.includes('--check')) {
    const stale = check(root, args.find(arg => !arg.startsWith('--')))
    if (stale.length > 0) {
      console.error(`[product-identity] stale generated files:\n${stale.map(file => `- ${file}`).join('\n')}`)
      process.exit(1)
    }
    console.log('[product-identity] generated files match product.json')
  } else {
    const outDir = args.find(arg => !arg.startsWith('--'))
    for (const file of generate(root, outDir)) console.log(`[product-identity] wrote ${file}`)
  }
}
