import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleEchoFlowApi } from '../api/echoflow.js'
import { LegacyMigrationService } from '../services/legacyMigrationService.js'
import { getEchoFlowInternalDir } from '../services/echoFlowConfigRoot.js'

let tempDir: string
let legacyHomeDir: string
let apiHomeDir: string
let originalConfigDir: string | undefined
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalLocalAccessToken: string | undefined

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>
}

function service() {
  return new LegacyMigrationService({
    configDir: tempDir,
    legacyHomeConfigDir: legacyHomeDir,
  })
}

function request(method: string, pathname: string, body?: unknown, localAccessToken = 'desktop-local-token') {
  const url = new URL(pathname, 'http://127.0.0.1:3456')
  return handleEchoFlowApi(
    new Request(url.toString(), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(localAccessToken ? { Authorization: `Bearer ${localAccessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url,
    pathname.split('/').filter(Boolean),
  )
}

describe('legacy migration service', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-current-'))
    legacyHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-home-'))
    apiHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-api-home-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalLocalAccessToken = process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN
    process.env.CLAUDE_CONFIG_DIR = tempDir
    process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN = 'desktop-local-token'
    process.env.HOME = apiHomeDir
    process.env.USERPROFILE = apiHomeDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalUserProfile
    if (originalLocalAccessToken === undefined) delete process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN
    else process.env.ECHOFLOW_LOCAL_ACCESS_TOKEN = originalLocalAccessToken
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.rm(legacyHomeDir, { recursive: true, force: true })
    await fs.rm(apiHomeDir, { recursive: true, force: true })
  })

  test('status discovers legacy home echoflow-code provider settings and OAuth files', async () => {
    await writeJson(path.join(legacyHomeDir, 'cc-haha', 'providers.json'), {
      activeId: 'provider-1',
      providers: [],
    })
    await writeJson(path.join(legacyHomeDir, 'cc-haha', 'settings.json'), { env: { USER_ONLY: '1' } })
    await writeJson(path.join(legacyHomeDir, 'cc-haha', 'oauth.json'), { accessToken: 'secret' })

    const result = await service().getStatus()

    expect(result.summary.ready).toBeGreaterThanOrEqual(3)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'legacy-home-cc-haha', target: 'providers', status: 'ready' }),
      expect.objectContaining({ source: 'legacy-home-cc-haha', target: 'settings', status: 'ready' }),
      expect.objectContaining({ source: 'legacy-home-cc-haha', target: 'oauth', status: 'ready' }),
    ]))
  })

  test('run copies legacy echoflow-code files into echoflow storage without deleting sources', async () => {
    const sourceProviders = path.join(tempDir, 'cc-haha', 'providers.json')
    const sourceSettings = path.join(tempDir, 'cc-haha', 'settings.json')
    await writeJson(sourceProviders, {
      activeProviderId: 'provider-1',
      providers: [{
        id: 'provider-1',
        presetId: 'custom',
        name: 'Legacy Provider',
        apiKey: 'token',
        baseUrl: 'https://legacy.example.test',
        models: { main: 'legacy-main', haiku: 'legacy-main', sonnet: 'legacy-main', opus: 'legacy-main' },
      }],
    })
    await writeJson(sourceSettings, {
      env: {
        ANTHROPIC_AUTH_TOKEN: 'legacy-token',
        CC_HAHA_IMAGE_PROVIDER_KIND: 'openai_images',
        CC_HAHA_IMAGE_PROVIDER_ID: 'legacy-image-provider',
        CC_HAHA_IMAGE_BASE_URL: 'https://images.example.test',
        CC_HAHA_IMAGE_API_KEY: 'legacy-image-token',
        CC_HAHA_IMAGE_MODEL: 'legacy-image-model',
      },
    })

    const result = await service().run()

    expect(result.summary.migrated).toBeGreaterThanOrEqual(2)
    expect(await readJson(sourceProviders)).toMatchObject({ activeProviderId: 'provider-1' })
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'))).toMatchObject({
      schemaVersion: 1,
      activeId: 'provider-1',
    })
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'))).toMatchObject({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'legacy-token',
        ECHOFLOW_IMAGE_PROVIDER_KIND: 'openai_images',
        ECHOFLOW_IMAGE_PROVIDER_ID: 'legacy-image-provider',
        ECHOFLOW_IMAGE_BASE_URL: 'https://images.example.test',
        ECHOFLOW_IMAGE_API_KEY: 'legacy-image-token',
        ECHOFLOW_IMAGE_MODEL: 'legacy-image-model',
      },
    })
    expect((await readJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json')) as { env: Record<string, string> }).env.CC_HAHA_IMAGE_MODEL).toBeUndefined()
  })

  test('run preserves the built-in OpenAI provider active id when copying legacy provider index', async () => {
    await writeJson(path.join(tempDir, 'cc-haha', 'providers.json'), {
      activeId: 'openai-official',
      providers: [],
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-cc-haha', target: 'providers', status: 'migrated' }),
    ]))
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'))).toMatchObject({
      schemaVersion: 1,
      activeId: 'openai-official',
      providers: [],
    })
  })

  test('invalid echoflow-code provider index does not block root provider fallback', async () => {
    await writeJson(path.join(tempDir, 'cc-haha', 'providers.json'), {
      notProviders: true,
    })
    await writeJson(path.join(tempDir, 'providers.json'), {
      activeModel: 'legacy-sonnet',
      providers: [{
        id: 'legacy-provider',
        name: 'Legacy Root Provider',
        baseUrl: 'https://legacy.example.test',
        apiKey: 'legacy-token',
        models: [{ id: 'legacy-sonnet' }],
        isActive: true,
      }],
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-cc-haha', target: 'providers', status: 'invalid' }),
      expect.objectContaining({ source: 'current-root-providers', target: 'providers', status: 'migrated' }),
    ]))
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'))).toMatchObject({
      activeId: 'legacy-provider',
    })
  })

  test('current root providers take priority over legacy home echoflow-code providers', async () => {
    await writeJson(path.join(legacyHomeDir, 'cc-haha', 'providers.json'), {
      activeId: 'home-provider',
      providers: [{
        id: 'home-provider',
        presetId: 'custom',
        name: 'Home Provider',
        apiKey: 'home-token',
        baseUrl: 'https://home.example.test',
        models: { main: 'home-main', haiku: 'home-main', sonnet: 'home-main', opus: 'home-main' },
      }],
    })
    await writeJson(path.join(tempDir, 'providers.json'), {
      activeModel: 'current-sonnet',
      providers: [{
        id: 'current-provider',
        name: 'Current Root Provider',
        baseUrl: 'https://current.example.test',
        apiKey: 'current-token',
        models: [{ id: 'current-sonnet' }],
        isActive: true,
      }],
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-root-providers', target: 'providers', status: 'migrated' }),
    ]))
    expect(result.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'legacy-home-cc-haha', target: 'providers', status: 'migrated' }),
    ]))
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'))).toMatchObject({
      activeId: 'current-provider',
    })
  })

  test('does not mix legacy home files into a current config-dir migration', async () => {
    await writeJson(path.join(tempDir, 'cc-haha', 'settings.json'), {
      env: { ANTHROPIC_AUTH_TOKEN: 'current-settings-token' },
    })
    await writeJson(path.join(legacyHomeDir, 'cc-haha', 'providers.json'), {
      activeId: 'home-provider',
      providers: [{
        id: 'home-provider',
        presetId: 'custom',
        name: 'Home Provider',
        apiKey: 'home-token',
        baseUrl: 'https://home.example.test',
        models: { main: 'home-main', haiku: 'home-main', sonnet: 'home-main', opus: 'home-main' },
      }],
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-cc-haha', target: 'settings', status: 'migrated' }),
    ]))
    expect(result.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'legacy-home-cc-haha', target: 'providers', status: 'migrated' }),
    ]))
    await expect(fs.readFile(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'), 'utf-8')).rejects.toThrow()
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'))).toMatchObject({
      env: { ANTHROPIC_AUTH_TOKEN: 'current-settings-token' },
    })
  })

  test('root provider conversion does not overwrite settings claimed by current echoflow-code settings', async () => {
    await writeJson(path.join(tempDir, 'cc-haha', 'settings.json'), {
      env: { ANTHROPIC_AUTH_TOKEN: 'echoflow-code-token' },
    })
    await writeJson(path.join(tempDir, 'providers.json'), {
      activeModel: 'legacy-sonnet',
      providers: [{
        id: 'legacy-provider',
        name: 'Legacy Root Provider',
        baseUrl: 'https://legacy.example.test',
        apiKey: 'legacy-token',
        models: [{ id: 'legacy-sonnet' }],
        isActive: true,
      }],
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-cc-haha', target: 'settings', status: 'migrated' }),
      expect.objectContaining({ source: 'current-root-providers', target: 'providers', status: 'migrated' }),
    ]))
    expect(result.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-root-providers', target: 'settings', status: 'migrated' }),
    ]))
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'))).toMatchObject({
      env: { ANTHROPIC_AUTH_TOKEN: 'echoflow-code-token' },
    })
  })

  test('run converts legacy root providers and writes active provider settings', async () => {
    await writeJson(path.join(tempDir, 'providers.json'), {
      activeModel: 'legacy-sonnet',
      providers: [{
        id: 'legacy-provider',
        name: 'Legacy Root Provider',
        baseUrl: 'https://legacy.example.test',
        apiKey: 'legacy-token',
        models: [
          { id: 'legacy-haiku', name: 'Legacy Haiku' },
          { id: 'legacy-sonnet', name: 'Legacy Sonnet' },
        ],
        isActive: true,
        notes: 'keep note',
      }],
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-root-providers', target: 'providers', status: 'migrated' }),
      expect.objectContaining({ source: 'current-root-providers', target: 'settings', status: 'migrated' }),
    ]))
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'))).toMatchObject({
      activeId: 'legacy-provider',
      providers: [expect.objectContaining({
        id: 'legacy-provider',
        presetId: 'custom',
        notes: 'keep note',
        models: {
          main: 'legacy-sonnet',
          haiku: 'legacy-sonnet',
          sonnet: 'legacy-sonnet',
          opus: 'legacy-sonnet',
        },
      })],
    })
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'))).toMatchObject({
      env: {
        ANTHROPIC_BASE_URL: 'https://legacy.example.test',
        ANTHROPIC_AUTH_TOKEN: 'legacy-token',
        ANTHROPIC_MODEL: 'legacy-sonnet',
      },
    })
  })

  test('run skips existing targets without overwriting current data', async () => {
    await writeJson(path.join(tempDir, 'cc-haha', 'settings.json'), {
      env: { ANTHROPIC_AUTH_TOKEN: 'legacy-token' },
    })
    await writeJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'), {
      env: { ANTHROPIC_AUTH_TOKEN: 'current-token' },
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'settings', status: 'target-exists' }),
    ]))
    expect(await readJson(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'))).toMatchObject({
      env: { ANTHROPIC_AUTH_TOKEN: 'current-token' },
    })
  })

  test('malformed legacy root providers are reported without blocking other ready items', async () => {
    await fs.writeFile(path.join(tempDir, 'providers.json'), '{"providers":', 'utf-8')
    await writeJson(path.join(tempDir, 'cc-haha', 'settings.json'), {
      env: { USER_ONLY: '1' },
    })

    const result = await service().run()

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'current-root-providers', target: 'providers', status: 'invalid' }),
      expect.objectContaining({ source: 'current-cc-haha', target: 'settings', status: 'migrated' }),
    ]))
  })

  test('run rejects a symbolic-link legacy source without reading its target', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-source-link-'))
    try {
      await writeJson(path.join(outsideDir, 'settings.json'), {
        env: { ANTHROPIC_AUTH_TOKEN: 'outside-token' },
      })
      await fs.mkdir(path.join(tempDir, 'cc-haha'), { recursive: true })
      await fs.symlink(path.join(outsideDir, 'settings.json'), path.join(tempDir, 'cc-haha', 'settings.json'))

      const result = await service().run()

      expect(result.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ target: 'settings', status: 'invalid', message: 'unsafe_source_path' }),
      ]))
      await expect(fs.access(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  test('run rejects a symbolic-link migration target without writing its target', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-target-link-'))
    try {
      await writeJson(path.join(tempDir, 'cc-haha', 'settings.json'), {
        env: { ANTHROPIC_AUTH_TOKEN: 'legacy-token' },
      })
      await fs.symlink(outsideDir, getEchoFlowInternalDir(tempDir), 'dir')

      await expect(service().run()).rejects.toThrow('unsafe_migration_target_path')
      await expect(fs.access(path.join(outsideDir, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  test('API requires desktop local access authorization', async () => {
    const res = await request('GET', '/api/echoflow/migration', undefined, '')

    expect(res.status).toBe(403)
  })

  test('API requires explicit migration confirmation', async () => {
    const res = await request('POST', '/api/echoflow/migration', {})

    expect(res.status).toBe(400)
    await expect(fs.access(path.join(getEchoFlowInternalDir(tempDir), 'providers.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('API ignores caller-supplied paths', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-migration-outside-'))
    try {
      await writeJson(path.join(outsideDir, 'cc-haha', 'settings.json'), {
        env: { ANTHROPIC_AUTH_TOKEN: 'outside-token' },
      })

      const res = await request('POST', '/api/echoflow/migration', {
        confirmed: true,
        legacyHomeConfigDir: outsideDir,
        sourcePath: path.join(outsideDir, 'cc-haha', 'settings.json'),
      })
      const body = await res.json() as { items: Array<Record<string, unknown>> }

      expect(res.status).toBe(200)
      expect(body.items.some((item) => item.status === 'migrated')).toBe(false)
      await expect(fs.readFile(path.join(getEchoFlowInternalDir(tempDir), 'settings.json'), 'utf-8')).rejects.toThrow()
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})
