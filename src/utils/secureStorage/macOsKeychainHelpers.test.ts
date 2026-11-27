import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { CREDENTIALS_SERVICE_SUFFIX, getMacOsKeychainStorageServiceName } from './macOsKeychainHelpers.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
})

test('uses the historical Keychain namespace for a decomposed config path', () => {
  const root = resolve('fixture', 'café')
  const suffix = createHash('sha256').update(root).digest('hex').slice(0, 8)
  process.env.CLAUDE_CONFIG_DIR = root.normalize('NFD')
  expect(getMacOsKeychainStorageServiceName()).toBe(`Claude Code-${suffix}`)
  expect(getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX)).toBe(`Claude Code-credentials-${suffix}`)
})

test('keeps the unsuffixed default Keychain namespace', () => {
  delete process.env.CLAUDE_CONFIG_DIR
  expect(getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX)).toBe('Claude Code-credentials')
})
