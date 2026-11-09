import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ProviderService } from './providerService.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalHome: string | undefined

function settingsPath(): string {
  return path.join(tmpDir, 'settings.json')
}

function writeSettings(value: unknown): void {
  fs.writeFileSync(settingsPath(), JSON.stringify(value), 'utf8')
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'provider-redaction-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalHome = process.env.HOME
  // Keep all config reads inside a disposable directory.
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  process.env.HOME = tmpDir
  resetSettingsCache()
})

afterEach(async () => {
  if (originalConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  else delete process.env.CLAUDE_CONFIG_DIR
  if (originalHome !== undefined) process.env.HOME = originalHome
  else delete process.env.HOME
  resetSettingsCache()
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

async function addDirectAnthropicProvider(): Promise<string> {
  const provider = await new ProviderService().addProvider({
    presetId: 'custom',
    name: 'Direct Anthropic',
    baseUrl: 'https://upstream.example.test',
    apiKey: 'fixture-upstream-key',
    apiFormat: 'anthropic',
    authStrategy: 'api_key',
    supportsNestedToolResultMedia: true,
    models: { main: 'fixture-model', haiku: '', sonnet: '', opus: '' },
  })
  return provider.id
}

describe('providerService forces the proxy for local redaction', () => {
  test('keeps a direct anthropic provider on its upstream base URL when redaction is off', async () => {
    const id = await addDirectAnthropicProvider()
    writeSettings({ localRedaction: { enabled: false } })
    const env = await new ProviderService().getProviderRuntimeEnv(id)
    expect(env.ANTHROPIC_BASE_URL).toBe('https://upstream.example.test')
  })

  test('forces a direct anthropic provider through the proxy when redaction is on', async () => {
    const id = await addDirectAnthropicProvider()
    writeSettings({ localRedaction: { enabled: true } })
    const env = await new ProviderService().getProviderRuntimeEnv(id)
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/proxy\/providers\//)
    expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
  })

  test('fails closed to the proxy when the settings file is malformed', async () => {
    const id = await addDirectAnthropicProvider()
    fs.writeFileSync(settingsPath(), '{ broken', 'utf8')
    const env = await new ProviderService().getProviderRuntimeEnv(id)
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/proxy\/providers\//)
    expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
  })

  test('does not emit direct OAuth transport flags when redaction is on', async () => {
    await fsp.mkdir(path.join(tmpDir, 'echoflow-code'), { recursive: true })
    await fsp.writeFile(
      path.join(tmpDir, 'echoflow-code', 'providers.json'),
      JSON.stringify({
        activeId: 'oauth-fixture',
        providers: [{
          id: 'oauth-fixture',
          presetId: 'custom',
          name: 'OAuth Fixture',
          baseUrl: 'https://upstream.example.test',
          apiKey: '',
          apiFormat: 'openai_responses',
          authStrategy: 'api_key',
          runtimeKind: 'openai_oauth',
          models: { main: 'fixture-model', haiku: '', sonnet: '', opus: '' },
        }],
      }),
      'utf8',
    )
    writeSettings({ localRedaction: { enabled: true } })
    const env = await new ProviderService().getProviderRuntimeEnv('oauth-fixture')
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/proxy\/providers\//)
    expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
    // The OAuth-only env flags select the direct fetch; they must be absent.
    for (const key of Object.keys(env)) {
      expect(key).not.toMatch(/OAUTH|CODEX|GROK/i)
    }
  })
})
