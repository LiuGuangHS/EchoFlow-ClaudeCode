import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { plainTextStorage } from './plainTextStorage'

let configDir: string
let previousConfigDir: string | undefined

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'secure-storage-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  rmSync(configDir, { recursive: true, force: true })
})

// Pins the end state only. update() also passes mode: 0o600 at creation so
// the file is never briefly world-readable before the chmod, but that transient
// window isn't observable here — the chmod would produce this same result.
describe('plainTextStorage.update', () => {
  test('creates the credentials file readable only by its owner', () => {
    const result = plainTextStorage.update({ claudeAiOauth: { accessToken: 'fixture' } })
    expect(result.success).toBe(true)

    const mode = statSync(join(configDir, '.credentials.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test('reports that credentials are stored in plaintext', () => {
    expect(plainTextStorage.update({}).warning).toContain('plaintext')
  })
})

describe('plainTextStorage.read', () => {
  test('round-trips what update wrote', () => {
    const data = {
      claudeAiOauth: { accessToken: 'fixture-token', refreshToken: 'fixture-refresh' },
    }
    plainTextStorage.update(data)
    expect(plainTextStorage.read()).toEqual(data)
  })

  test('returns null when nothing has been written', () => {
    expect(plainTextStorage.read()).toBeNull()
  })

  test('returns null rather than throwing on a corrupt file', async () => {
    await Bun.write(join(configDir, '.credentials.json'), '{ not json')
    expect(plainTextStorage.read()).toBeNull()
    expect(await plainTextStorage.readAsync()).toBeNull()
  })
})

describe('plainTextStorage.delete', () => {
  test('removes the file and treats a missing file as success', () => {
    plainTextStorage.update({})
    expect(plainTextStorage.delete()).toBe(true)
    expect(plainTextStorage.delete()).toBe(true)
  })
})