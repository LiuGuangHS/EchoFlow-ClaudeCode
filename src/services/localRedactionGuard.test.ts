import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  assertDirectTransportAllowed,
  readLocalRedactionState,
  shouldForceProxyForRedaction,
} from './localRedactionGuard.js'
import { buildOpenAICodexFetch } from './openaiAuth/fetch.js'
import { buildGrokFetch } from './grokAuth/fetch.js'

let tmpDir: string
let originalConfigDir: string | undefined

function settingsPath(): string {
  return path.join(tmpDir, 'settings.json')
}

function writeSettings(value: unknown): void {
  fs.writeFileSync(settingsPath(), JSON.stringify(value), 'utf8')
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'local-redaction-guard-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  // Never let a test read the real user config directory.
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  else delete process.env.CLAUDE_CONFIG_DIR
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

describe('local redaction settings (single fail-closed reader)', () => {
  test('reports disabled when no settings file exists', () => {
    expect(shouldForceProxyForRedaction()).toBe(false)
    expect(readLocalRedactionState().enabled).toBe(false)
  })

  test('reports disabled when localRedaction.enabled is false', () => {
    writeSettings({ localRedaction: { enabled: false } })
    expect(shouldForceProxyForRedaction()).toBe(false)
  })

  test('reports enabled and exposes the settings for redaction', () => {
    writeSettings({ localRedaction: { enabled: true, personalInfo: true, customWords: ['fixture'] } })
    expect(shouldForceProxyForRedaction()).toBe(true)
    const state = readLocalRedactionState()
    expect(state.enabled).toBe(true)
    expect(state.settings.customWords).toEqual(['fixture'])
  })

  test('fails closed to the proxy on malformed settings', () => {
    fs.writeFileSync(settingsPath(), '{ broken', 'utf8')
    expect(() => readLocalRedactionState()).toThrow('Local redaction settings could not be loaded')
    expect(shouldForceProxyForRedaction()).toBe(true)
  })

  test('fails closed to the proxy on an invalid localRedaction shape', () => {
    writeSettings({ localRedaction: { enabled: 'yes' } })
    expect(shouldForceProxyForRedaction()).toBe(true)
  })
})

describe('local redaction guard', () => {
  test('allows direct transport when no settings file exists', async () => {
    await expect(assertDirectTransportAllowed()).resolves.toBeUndefined()
  })

  test('allows direct transport when local redaction is disabled', async () => {
    writeSettings({ localRedaction: { enabled: false } })
    await expect(assertDirectTransportAllowed()).resolves.toBeUndefined()
  })

  test('blocks direct transport when local redaction is enabled', async () => {
    writeSettings({ localRedaction: { enabled: true } })
    await expect(assertDirectTransportAllowed()).rejects.toThrow(/Local redaction is enabled/)
  })

  test('fails closed on malformed settings JSON', async () => {
    fs.writeFileSync(settingsPath(), '{ not json', 'utf8')
    await expect(assertDirectTransportAllowed()).rejects.toThrow(
      'Local redaction settings could not be loaded',
    )
  })

  test('fails closed on an invalid localRedaction shape', async () => {
    writeSettings({ localRedaction: { enabled: 'yes' } })
    await expect(assertDirectTransportAllowed()).rejects.toThrow(
      'Local redaction settings could not be loaded',
    )
  })
})

// The direct OAuth transports must check the guard BEFORE any passthrough to
// `inner`. v0.7.4 placed the check after the non-messages early return, which
// left a request to any other path able to reach `inner` unguarded. These two
// tests pin the stronger, defensive placement.
describe('direct OAuth fetch refuses transport before any passthrough', () => {
  test('openai codex fetch blocks a non-messages request when redaction is on', async () => {
    writeSettings({ localRedaction: { enabled: true } })
    let innerCalls = 0
    const inner = (async () => {
      innerCalls += 1
      return new Response('ok')
    }) as unknown as typeof fetch
    const codexFetch = buildOpenAICodexFetch(inner, undefined)
    await expect(codexFetch('https://example.test/other', {})).rejects.toThrow(/Local redaction/)
    expect(innerCalls).toBe(0)
  })

  test('grok fetch blocks a non-messages request when redaction is on', async () => {
    writeSettings({ localRedaction: { enabled: true } })
    let innerCalls = 0
    const inner = (async () => {
      innerCalls += 1
      return new Response('ok')
    }) as unknown as typeof fetch
    const grokFetch = buildGrokFetch(inner, undefined)
    await expect(grokFetch('https://example.test/other', {})).rejects.toThrow(/Local redaction/)
    expect(innerCalls).toBe(0)
  })

  test('openai codex fetch still passes through when redaction is off', async () => {
    writeSettings({ localRedaction: { enabled: false } })
    let innerCalls = 0
    const inner = (async () => {
      innerCalls += 1
      return new Response('ok')
    }) as unknown as typeof fetch
    const codexFetch = buildOpenAICodexFetch(inner, undefined)
    await expect(codexFetch('https://example.test/other', {})).resolves.toBeInstanceOf(Response)
    expect(innerCalls).toBe(1)
  })
})
