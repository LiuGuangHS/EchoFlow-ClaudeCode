import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ProviderService } from '../services/providerService.js'

const MODEL_MAPPING = {
  main: 'MiniMax-M3',
  haiku: 'MiniMax-M3',
  sonnet: 'MiniMax-M3',
  opus: 'MiniMax-M3',
}

describe('provider settings isolation', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let service: ProviderService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-settings-isolation-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new ProviderService()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function readEchoFlowSettings(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(tmpDir, 'echoflow-code', 'settings.json'), 'utf-8')
    return JSON.parse(raw)
  }

  async function originalSettingsExists(): Promise<boolean> {
    try {
      await fs.access(path.join(tmpDir, 'settings.json'))
      return true
    } catch {
      return false
    }
  }

  test('public cron history and task definitions use the default EchoFlow root without touching legacy sources', async () => {
    const child = Bun.spawn(['bun', '--no-env-file', '-e', `
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const { getEchoFlowConfigDir } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/echoFlowConfigRoot.ts'))})
      const { CronService } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../services/cronService.ts'))})
      const { CronScheduler } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../services/cronScheduler.ts'))})
      const modern = getEchoFlowConfigDir()
      const legacy = path.join(process.env.HOME, '.claude')
      for (const [root, prefix] of [[modern, 'modern'], [legacy, 'legacy']]) {
        await fs.mkdir(root, { recursive: true })
        await fs.writeFile(path.join(root, 'scheduled_tasks_log.json'), JSON.stringify({ runs: [{ id: prefix + '-run', taskId: 'task', startedAt: '2026-01-01T00:00:00Z', status: 'success' }] }))
        await fs.writeFile(path.join(root, 'scheduled_tasks.json'), JSON.stringify({ tasks: [{ id: prefix + '-task', cron: '* * * * *', prompt: prefix, createdAt: 1 }] }))
      }
      const legacyTasks = await fs.readFile(path.join(legacy, 'scheduled_tasks.json'), 'utf8')
      const legacyRuns = await fs.readFile(path.join(legacy, 'scheduled_tasks_log.json'), 'utf8')
      const scheduler = new CronScheduler()
      const service = new CronService()
      const runs = await scheduler.getTaskRuns('task')
      const tasks = await service.listTasks()
      await service.createTask({ cron: '* * * * *', prompt: 'new-task' })
      console.log(JSON.stringify({ runs: runs.map(run => run.id), tasks: tasks.map(task => task.id), modernCount: JSON.parse(await fs.readFile(path.join(modern, 'scheduled_tasks.json'), 'utf8')).tasks.length, sourcesPreserved: legacyTasks === await fs.readFile(path.join(legacy, 'scheduled_tasks.json'), 'utf8') && legacyRuns === await fs.readFile(path.join(legacy, 'scheduled_tasks_log.json'), 'utf8') }))
    `], {
      env: { HOME: tmpDir, PATH: process.env.PATH, XDG_DATA_HOME: path.join(tmpDir, 'data') },
      stdout: 'pipe', stderr: 'pipe',
    })
    const output = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr).toBe(0)
    expect(JSON.parse(output)).toEqual({ runs: ['modern-run'], tasks: ['modern-task'], modernCount: 2, sourcesPreserved: true })
  })

  test('startup lock recovery deletes only the default EchoFlow lock and retains the legacy sentinel', async () => {
    const child = Bun.spawn(['bun', '--no-env-file', '-e', `
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const { getEchoFlowConfigDir } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/echoFlowConfigRoot.ts'))})
      const { ConversationService } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../services/conversationService.ts'))})
      const modern = path.join(getEchoFlowConfigDir(), '.lock', 'session-fixture')
      const legacy = path.join(process.env.HOME, '.claude', '.lock', 'session-fixture')
      for (const file of [modern, legacy]) {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, file === modern ? 'modern-lock' : 'legacy-lock')
      }
      const service = new ConversationService()
      const clear = service.clearStaleLock.bind(service)
      const attempts = []
      service.clearStaleLock = id => { const cleared = clear(id); attempts.push(cleared); return cleared }
      let code
      try {
        await service.startSession('session-fixture', process.env.HOME, 'ws://127.0.0.1:1/sdk/fixture?token=fake-token')
      } catch (error) { code = error.code }
      await service.stopAllSessionsAndWait(1000)
      const { diagnosticsService } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../services/diagnosticsService.ts'))})
      await diagnosticsService.drainForMigration()
      console.log(JSON.stringify({ attempts, code, modernExists: await fs.exists(modern), legacy: await fs.readFile(legacy, 'utf8').catch(() => null) }))
    `], {
      env: {
        HOME: tmpDir, PATH: process.env.PATH, XDG_DATA_HOME: path.join(tmpDir, 'data'),
        CC_HAHA_DISABLE_TERMINAL_SHELL_ENV: '1',
        CLAUDE_CLI_PATH: path.resolve(import.meta.dir, 'fixtures/mock-startup-exit-cli.ts'),
      },
      stdout: 'pipe', stderr: 'pipe',
    })
    const output = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr).toBe(0)
    const result = JSON.parse(output.trim().split('\n').at(-1)!)
    expect(result).toEqual({ attempts: [true, false], code: 'CLI_START_FAILED', modernExists: false, legacy: 'legacy-lock' })
  })

  test('provider and CLI agree on the platform default root without CLAUDE_CONFIG_DIR', async () => {
    const child = Bun.spawn(['bun', '--no-env-file', '-e', `
      const { ProviderService } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../services/providerService.ts'))})
      const { getEchoFlowConfigDir, getEchoFlowInternalDir } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/echoFlowConfigRoot.ts'))})
      const { applySafeConfigEnvironmentVariables } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/managedEnv.ts'))})
      const { enableConfigs } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/config.ts'))})
      enableConfigs()
      const service = new ProviderService()
      const provider = await service.addProvider({ presetId: 'custom', name: 'Default root', apiKey: 'fake-default-token', baseUrl: 'http://127.0.0.1:9', models: ${JSON.stringify(MODEL_MAPPING)} })
      await service.activateProvider(provider.id)
      applySafeConfigEnvironmentVariables()
      console.log(JSON.stringify({ root: getEchoFlowConfigDir(), internal: getEchoFlowInternalDir(), token: process.env.ANTHROPIC_AUTH_TOKEN, activeId: (await service.listProviders()).activeId, id: provider.id }))
    `], {
      env: { HOME: tmpDir, PATH: process.env.PATH, XDG_DATA_HOME: path.join(tmpDir, 'data') },
      stdout: 'pipe', stderr: 'pipe',
    })
    const output = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr).toBe(0)
    const result = JSON.parse(output)
    expect(result.root).toBe(path.join(tmpDir, 'data', 'echoflow-code'))
    expect(result.internal).toBe(path.join(result.root, 'echoflow-code'))
    expect(result.token).toBe('fake-default-token')
    expect(result.activeId).toBe(result.id)
  })

  test('activation reaches the CLI environment and loopback request through the EchoFlow index', async () => {
    const { mergeActiveProviderManagedEnv } = await import('../services/providerRuntimeEnv.js')
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch(request) {
        return Response.json({ authorization: request.headers.get('authorization') })
      },
    })
    try {
      const provider = await service.addProvider({
        presetId: 'custom', name: 'Loopback', apiKey: 'fake-loopback-token',
        baseUrl: server.url.origin, models: MODEL_MAPPING,
      })
      await service.activateProvider(provider.id)
      const index = JSON.parse(await fs.readFile(path.join(tmpDir, 'echoflow-code', 'providers.json'), 'utf8'))
      expect(index.activeId).toBe(provider.id)
      const settings = JSON.parse(await fs.readFile(path.join(tmpDir, 'echoflow-code', 'settings.json'), 'utf8'))
      const env = mergeActiveProviderManagedEnv(settings.env, tmpDir)
      expect(env.ANTHROPIC_MODEL).toBe(MODEL_MAPPING.main)
      const cli = Bun.spawn(['bun', '--no-env-file', '-e', `
        const { applySafeConfigEnvironmentVariables, applyConfigEnvironmentVariables } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/managedEnv.ts'))})
        const { enableConfigs } = await import(${JSON.stringify(path.resolve(import.meta.dir, '../../utils/config.ts'))})
        enableConfigs()
        applySafeConfigEnvironmentVariables()
        applyConfigEnvironmentVariables()
        const response = await fetch(process.env.ANTHROPIC_BASE_URL, {
          headers: { authorization: 'Bearer ' + process.env.ANTHROPIC_AUTH_TOKEN },
        })
        console.log(JSON.stringify({ model: process.env.ANTHROPIC_MODEL, response: await response.json() }))
      `], {
        env: { HOME: tmpDir, PATH: process.env.PATH, CLAUDE_CONFIG_DIR: tmpDir },
        stdout: 'pipe', stderr: 'pipe',
      })
      const output = await new Response(cli.stdout).text()
      const stderr = await new Response(cli.stderr).text()
      expect(await cli.exited, stderr).toBe(0)
      expect(JSON.parse(output)).toEqual({ model: MODEL_MAPPING.main, response: { authorization: 'Bearer fake-loopback-token' } })
      const { CronScheduler } = await import('../services/cronScheduler.js')
      const { ConversationService } = await import('../services/conversationService.js')
      for (const prototype of [CronScheduler.prototype, ConversationService.prototype]) {
        const reader = prototype as unknown as {
          shouldStripInheritedProviderEnv(): boolean
          shouldMarkManagedOAuth(): boolean
          getConfigDir(): string
        }
        expect(reader.shouldStripInheritedProviderEnv()).toBe(true)
        expect(reader.shouldMarkManagedOAuth()).toBe(false)
      }
      expect(await originalSettingsExists()).toBe(false)
      await service.activateOfficial()
      const cleared = JSON.parse(await fs.readFile(path.join(tmpDir, 'echoflow-code', 'settings.json'), 'utf8'))
      expect(mergeActiveProviderManagedEnv(cleared.env ?? {}, tmpDir).ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      for (const prototype of [CronScheduler.prototype, ConversationService.prototype]) {
        const reader = prototype as unknown as { shouldMarkManagedOAuth(): boolean }
        expect(reader.shouldMarkManagedOAuth()).toBe(true)
      }
      expect(await fs.exists(path.join(tmpDir, 'cc-haha'))).toBe(false)
    } finally {
      server.stop(true)
    }
  })

  test('activating a provider writes only echoflow-code/settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      models: MODEL_MAPPING,
      notes: 'MiniMax official Anthropic-compatible endpoint',
    })

    await service.activateProvider(minimax.id)

    const settings = await readEchoFlowSettings()
    const env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_MODEL).toBe('MiniMax-M3')
    expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'MiniMax-M3': 1000000,
      'MiniMax-M2.7': 204800,
      'MiniMax-M2.7-highspeed': 204800,
    })
    expect(await originalSettingsExists()).toBe(false)
  })

  test('switching providers replaces managed env without creating settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-api-test-minimax',
      models: MODEL_MAPPING,
    })
    const relay = await service.addProvider({
      presetId: 'custom',
      name: 'Relay',
      baseUrl: 'https://api.jiekou.ai/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      models: {
        main: 'claude-opus-4-7',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })

    await service.activateProvider(minimax.id)
    let settings = await readEchoFlowSettings()
    let env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'MiniMax-M3': 1000000,
      'MiniMax-M2.7': 204800,
      'MiniMax-M2.7-highspeed': 204800,
    })

    await service.activateProvider(relay.id)
    settings = await readEchoFlowSettings()
    env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.jiekou.ai/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-7')
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()

    const list = await service.listProviders()
    expect(list.activeId).toBe(relay.id)
    expect(await originalSettingsExists()).toBe(false)
  })

  test('activation preserves unrelated EchoFlow settings and env', async () => {
    await fs.mkdir(path.join(tmpDir, 'echoflow-code'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'echoflow-code', 'settings.json'),
      JSON.stringify({
        customField: 'should_be_preserved',
        env: {
          EXISTING_VAR: 'should_be_preserved',
        },
      }, null, 2),
    )

    const provider = await service.addProvider({
      presetId: 'custom',
      name: 'Relay',
      baseUrl: 'https://api.jiekou.ai/anthropic',
      apiKey: 'sk_test',
      models: {
        main: 'claude-opus-4-7',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })
    await service.activateProvider(provider.id)

    const settings = await readEchoFlowSettings()
    const env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.jiekou.ai/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk_test')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(settings.customField).toBe('should_be_preserved')
    expect(env.EXISTING_VAR).toBe('should_be_preserved')
  })

  test('activateOfficial removes only provider-managed env', async () => {
    await fs.mkdir(path.join(tmpDir, 'echoflow-code'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'echoflow-code', 'settings.json'),
      JSON.stringify({ env: { EXISTING_VAR: 'keep-me' } }, null, 2),
    )
    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-test',
      models: MODEL_MAPPING,
    })

    await service.activateProvider(provider.id)
    await service.activateOfficial()

    const settings = await readEchoFlowSettings()
    const env = settings.env as Record<string, string> | undefined
    expect(env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env?.ANTHROPIC_MODEL).toBeUndefined()
    expect(env?.EXISTING_VAR).toBe('keep-me')
  })

  test('providers.json and echoflow-code/settings.json stay isolated from Claude settings.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        effortLevel: 'high',
        env: {
          ANTHROPIC_BASE_URL: 'https://original-claude-code.api.com',
          ANTHROPIC_API_KEY: 'original-key',
        },
      }, null, 2),
    )

    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-haha-key',
      models: MODEL_MAPPING,
    })
    await service.activateProvider(provider.id)

    const original = JSON.parse(await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8'))
    expect(original.env.ANTHROPIC_BASE_URL).toBe('https://original-claude-code.api.com')
    expect(original.env.ANTHROPIC_API_KEY).toBe('original-key')
    expect(original.effortLevel).toBe('high')

    const haha = await readEchoFlowSettings()
    const env = haha.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-haha-key')
    expect(env.ANTHROPIC_API_KEY).toBe('')
  })
})
