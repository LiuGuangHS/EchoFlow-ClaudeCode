import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  TARGETS,
  check,
  generate,
  readIdentity,
} from './generate-product-identity'
import { readProductEnv, writeProductEnvName } from '../src/utils/productEnv'

const ROOT = path.resolve(import.meta.dir, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'generate-product-identity.ts')
const identity = readIdentity(ROOT)

let outDir: string | undefined

function makeOutDir(): string {
  outDir = mkdtempSync(path.join(tmpdir(), 'product-identity-'))
  return outDir
}

afterEach(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
  outDir = undefined
})

describe('product identity generator', () => {
  test('reads the real identity from product.json', () => {
    expect(identity.name).toBe('EchoFlow Code')
    expect(identity.slug).toBe('echoflow-code')
    expect(identity.appId).toBe('com.echoflow.code.desktop')
    expect(identity.mobilePackage).toBe('com.echoflow.code.mobile')
    expect(identity.mobileBundleId).toBe('com.echoflow.code.mobile')
    expect(identity.scheme).toBe('codemobile')
    expect(identity.protocol).toBe('echoflowcode')
    expect(identity.envPrefix).toBe('ECHOFLOW_')
    expect(identity.legacyEnvPrefix).toBe('CC_HAHA_')
    expect(identity.configDir).toBe('echoflow-code')
    expect(identity.adsPublisherId).toBe('pub-1962125033823297')
  })

  test('writes the same generated module to all three targets', () => {
    const dir = makeOutDir()
    const files = generate(ROOT, dir)

    expect(files).toEqual(TARGETS.map(target => path.join(dir, target)))

    const contents = TARGETS.map(target =>
      readFileSync(path.join(dir, target), 'utf8'),
    )
    expect(new Set(contents).size).toBe(1)

    const content = contents[0]
    expect(content.startsWith('// GENERATED FROM product.json')).toBe(true)
    expect(content).toContain('as const')
    expect(content).toContain('export type ProductIdentity')
    for (const value of Object.values(identity)) {
      expect(content).toContain(JSON.stringify(value))
    }
  })

  test('check passes on fresh output and fails when a file is tampered with', () => {
    const dir = makeOutDir()
    generate(ROOT, dir)
    expect(check(ROOT, dir)).toEqual([])

    const target = path.join(dir, TARGETS[0])
    writeFileSync(target, readFileSync(target, 'utf8').replace('EchoFlow Code', 'Tampered'))

    expect(check(ROOT, dir)).toEqual([TARGETS[0]])
  })

  test('check exits 0 for fresh output and 1 for stale output', () => {
    const dir = makeOutDir()
    generate(ROOT, dir)

    const fresh = spawnSync(process.execPath, [SCRIPT, '--check', dir], { encoding: 'utf8' })
    expect(fresh.status).toBe(0)

    const stale = path.join(dir, TARGETS[1])
    writeFileSync(stale, '// stale\n')

    const tampered = spawnSync(process.execPath, [SCRIPT, '--check', dir], { encoding: 'utf8' })
    expect(tampered.status).toBe(1)
    expect(tampered.stderr).toContain(TARGETS[1])
  })
})

describe('readProductEnv', () => {
  test('prefers the current prefix', () => {
    const env = { ECHOFLOW_FOO: 'current', CC_HAHA_FOO: 'legacy' }
    expect(readProductEnv('FOO', env)).toBe('current')
  })

  test('falls back to the legacy prefix', () => {
    expect(readProductEnv('FOO', { CC_HAHA_FOO: 'legacy' })).toBe('legacy')
  })

  test('returns undefined when neither prefix is set', () => {
    expect(readProductEnv('FOO', {})).toBeUndefined()
  })

  test('only writes the current prefix', () => {
    expect(writeProductEnvName('FOO')).toBe('ECHOFLOW_FOO')
  })
})
