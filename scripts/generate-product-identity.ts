#!/usr/bin/env bun

/**
 * Generates the product identity modules from `product.json`.
 *
 * `product.json` owns the generated constants. `--check` also verifies the
 * desktop and mobile packaging fields that must match this identity.
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
  legacyDesktopPackageName: string
  mobileArtifactPrefix: string
  legacyMobileArtifactPrefix: string
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

export const NSIS_TARGET = 'desktop/build/product-identity.generated.nsh'

const HEADER = '// GENERATED FROM product.json — do not edit. Run `bun run product:identity`.\n'

export function renderNsis(identity: ProductIdentity): string {
  const values = {
    ECHOFLOW_PRODUCT_NAME: identity.name,
    ECHOFLOW_PRODUCT_SLUG: identity.slug,
    ECHOFLOW_LEGACY_DESKTOP_PACKAGE_NAME: identity.legacyDesktopPackageName,
  }
  return '; GENERATED FROM product.json — do not edit.\n' + Object.entries(values)
    .map(([key, value]) => `!define ${key} "${value}"\n`).join('')
}

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
    'configDir', 'adsPublisherId', 'legacyDesktopPackageName',
    'mobileArtifactPrefix', 'legacyMobileArtifactPrefix',
  ]
  const missing = required.filter(key => typeof raw[key] !== 'string' || raw[key].length === 0)
  if (missing.length > 0) {
    throw new Error(`product.json is missing required string fields: ${missing.join(', ')}`)
  }
  for (const key of ['name', 'slug', 'legacyDesktopPackageName'] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(raw[key])) {
      throw new Error(`product.json: ${key} is not a safe filesystem/installer name`)
    }
  }
  return raw
}

function generatedFiles(identity: ProductIdentity): Record<string, string> {
  return {
    ...Object.fromEntries(TARGETS.map(target => [target, render(identity)])),
    [NSIS_TARGET]: renderNsis(identity),
  }
}

export function generate(root: string, outDir = root): string[] {
  return Object.entries(generatedFiles(readIdentity(root))).map(([target, content]) => {
    const file = path.join(outDir, target)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf8')
    return file
  })
}

export function check(root: string, outDir = root): string[] {
  const identity = readIdentity(root)
  const errors: string[] = Object.entries(generatedFiles(identity)).filter(([target, expected]) => {
    try {
      return readFileSync(path.join(outDir, target), 'utf8') !== expected
    } catch {
      return true
    }
  }).map(([target]) => target)
  const packagingFields: Record<string, Record<string, string | string[]>> = {
    'desktop/package.json': {
      name: identity.slug,
      productName: identity.name,
      'build.artifactName': `${identity.name.replaceAll(' ', '-')}-\${version}-\${os}-\${arch}.\${ext}`,
      'build.productName': identity.name,
      'build.appId': identity.appId,
      'build.protocols.schemes': [identity.protocol],
    },
    'desktop/src-tauri/tauri.conf.json': {
      productName: identity.name,
      identifier: identity.appId,
      'app.windows.0.title': identity.name,
    },
    'mobile/app.json': {
      'expo.name': identity.name,
      'expo.slug': identity.slug,
      'expo.scheme': identity.scheme,
      'expo.ios.bundleIdentifier': identity.mobileBundleId,
      'expo.android.package': identity.mobilePackage,
    },
  }
  for (const [file, fields] of Object.entries(packagingFields)) {
    try {
      const config = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
      for (const [field, value] of Object.entries(fields)) {
        const actual = field.split('.').reduce((entry, key) => entry?.[key], config)
        if (JSON.stringify(actual) !== JSON.stringify(value)) {
          errors.push(`${file}: ${field} does not match product.json`)
        }
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    const cargo = Bun.TOML.parse(readFileSync(path.join(root, 'desktop/src-tauri/Cargo.toml'), 'utf8')) as { package: { name: string }, lib: { name: string } }
    if (cargo.package.name !== identity.slug) errors.push('desktop/src-tauri/Cargo.toml: package.name does not match product.json')
    if (cargo.lib.name !== `${identity.slug.replaceAll('-', '_')}_lib`) errors.push('desktop/src-tauri/Cargo.toml: lib.name does not match product.json')
  } catch (error) {
    errors.push(`desktop/src-tauri/Cargo.toml: ${error instanceof Error ? error.message : String(error)}`)
  }
  return errors
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const root = path.resolve(import.meta.dir, '..')
  if (args.includes('--check')) {
    const stale = check(root, args.find(arg => !arg.startsWith('--')))
    if (stale.length > 0) {
      console.error(`[product-identity] identity inconsistencies:\n${stale.map(file => `- ${file}`).join('\n')}`)
      process.exit(1)
    }
    console.log('[product-identity] generated files match product.json')
  } else {
    const outDir = args.find(arg => !arg.startsWith('--'))
    for (const file of generate(root, outDir)) console.log(`[product-identity] wrote ${file}`)
  }
}
