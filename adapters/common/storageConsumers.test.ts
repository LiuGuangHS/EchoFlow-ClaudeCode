import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'
import { loadConfig, resolveWhatsAppAuthPath, validateStoredAdapterConfig } from './config.js'
import { SessionStore } from './session-store.js'
import { AttachmentStore } from './attachment/attachment-store.js'

const keys = ['HOME', 'CLAUDE_CONFIG_DIR', 'WHATSAPP_AUTH_DIR'] as const
let saved: Array<string | undefined>
let directory: string
let root: string

beforeEach(async () => {
  saved = keys.map(key => process.env[key])
  directory = await mkdtemp(join(tmpdir(), 'adapter-storage-'))
  root = join(directory, 'root')
  await mkdir(root)
  process.env.HOME = directory
  process.env.CLAUDE_CONFIG_DIR = root
  delete process.env.WHATSAPP_AUTH_DIR
})

afterEach(async () => {
  keys.forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]
    else process.env[key] = saved[i]
  })
  await rm(directory, { recursive: true, force: true })
})

test('standalone adapter config, sessions and attachments use the selected root', async () => {
  await writeFile(join(root, 'adapters.json'), JSON.stringify({ serverUrl: 'ws://127.0.0.1:12345', futureField: true }))
  const config = loadConfig()
  expect(config.serverUrl).toBe('ws://127.0.0.1:12345')
  expect(config.whatsapp.authDir).toBe(join(root, 'whatsapp-auth', 'default'))
  const sessions = new SessionStore()
  sessions.set('fixture-chat', 'fixture-session', directory)
  expect(new SessionStore().get('fixture-chat')?.sessionId).toBe('fixture-session')
  expect(await readFile(join(root, 'adapter-sessions.json'), 'utf8')).toContain('fixture-session')
  sessions.delete('fixture-chat')
  expect(new SessionStore().get('fixture-chat')).toBeNull()
  const store = new AttachmentStore()
  const file = store.resolvePath('telegram', 'fixture-session', 'fixture.txt')
  expect(dirname(file)).toBe(join(root, 'im-downloads', 'telegram', 'fixture-session'))
  await store.write(file, Buffer.from('fixture'))
  expect(await readFile(file, 'utf8')).toBe('fixture')
})

test('IM migration accepts the stored pairing and adapter fields read by the runtime', async () => {
  const stored = {
    pairing: { code: null, createdAt: null, expiresAt: null },
    telegram: { allowedUsers: [42], pairedUsers: [{ userId: 43, displayName: 'Fixture', pairedAt: 1 }] },
    whatsapp: { authDir: join(root, 'whatsapp-auth', 'fixture') },
    futureField: { keep: true },
  }
  await writeFile(join(root, 'adapters.json'), JSON.stringify(stored))
  const selection = validateStoredAdapterConfig(stored)
  expect(resolveWhatsAppAuthPath(selection.whatsappAuthDir!, root)).toBe(loadConfig().whatsapp.authDir)
  expect(loadConfig().telegram.pairedUsers).toEqual(stored.telegram.pairedUsers)
  expect(() => validateStoredAdapterConfig({ telegram: { pairedUsers: { privateFixture: true } } })).toThrow(/^Invalid IM adapter configuration$/)
})

test('root-external WhatsApp settings are blocked without touching source or configuration', async () => {
  const outside = join(directory, 'old-auth')
  await mkdir(outside)
  await writeFile(join(outside, 'fixture'), 'keep')
  const settings = JSON.stringify({ telegram: { botToken: 'fixture-token' }, whatsapp: { authDir: outside }, futureField: { keep: true } })
  await writeFile(join(root, 'adapters.json'), settings)
  const config = loadConfig()
  expect(config.telegram.botToken).toBe('fixture-token')
  expect(() => config.whatsapp.authDir).toThrow('outside the selected storage root')
  expect(await readFile(join(root, 'adapters.json'), 'utf8')).toBe(settings)
  expect(await readdir(outside)).toEqual(['fixture'])
  expect(await readFile(join(outside, 'fixture'), 'utf8')).toBe('keep')
})

test('environment overrides cannot silently continue an external auth writer', () => {
  process.env.WHATSAPP_AUTH_DIR = join(directory, 'outside')
  const config = loadConfig()
  expect(() => config.whatsapp.authDir).toThrow('outside the selected storage root')
  process.env.WHATSAPP_AUTH_DIR = join(root, 'whatsapp-auth', 'fixture')
  expect(loadConfig().whatsapp.authDir).toBe(process.env.WHATSAPP_AUTH_DIR)
})

test('explicit WhatsApp startup rejects an external auth directory before probing credentials', async () => {
  const entry = fileURLToPath(new URL('../whatsapp/index.ts', import.meta.url))
  const session = fileURLToPath(new URL('../whatsapp/session.ts', import.meta.url))
  const script = `
    import { mock } from 'bun:test'
    globalThis.fetch = async () => { throw new Error('Unexpected network request') }
    const session = await import(${JSON.stringify(session)})
    mock.module(${JSON.stringify(session)}, () => ({ ...session,
      hasWhatsAppAuth() { throw new Error('UNEXPECTED_CREDENTIAL_PROBE') },
    }))
    process.argv.push('--whatsapp')
    await import(${JSON.stringify(entry)})
  `
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], {
    env: createSandboxedTestEnvironment(directory, { CLAUDE_CONFIG_DIR: root, WHATSAPP_AUTH_DIR: join(directory, 'external-auth') }),
    stderr: 'pipe',
  })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  expect(exitCode).toBe(1)
  expect(stderr).toContain('outside the selected storage root')
  expect(stderr).not.toContain('UNEXPECTED_CREDENTIAL_PROBE')
})

for (const platform of ['telegram', 'feishu', 'dingtalk', 'wechat', 'whatsapp', 'qq', 'wecom', 'slack']) {
  test.each(['ready', 'unproven'])(`${platform} entrypoint admits its runtime only after storage validation (%s)`, async state => {
    if (state === 'unproven') await writeFile(join(root, 'fixture.txt'), 'keep')
    const entrypoint = fileURLToPath(new URL(`../${platform}/index.ts`, import.meta.url))
    const runtime = fileURLToPath(new URL(`../${platform}/runtime.ts`, import.meta.url))
    const storage = fileURLToPath(new URL('../../src/utils/echoFlowConfigRoot.ts', import.meta.url))
    const startup = fileURLToPath(new URL('../../src/services/storageStartup.ts', import.meta.url))
    // Mock only the business runtime: the actual launcher must admit and bind
    // storage before importing it, without leaking a binding into this process.
    const script = `
      import assert from 'node:assert/strict'
      import { readdirSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'
      const { getEchoFlowConfigDir, getEchoFlowInternalDir } = await import(${JSON.stringify(storage)})
      const root = process.env.CLAUDE_CONFIG_DIR
      let admitted = false
      mock.module(${JSON.stringify(runtime)}, () => {
        assert.equal(getEchoFlowConfigDir(), root)
        const writers = join(getEchoFlowInternalDir(), 'migrations', 'writers')
        assert.equal(readdirSync(writers).length, 1)
        process.env.CLAUDE_CONFIG_DIR = join(root, 'changed')
        assert.throws(() => getEchoFlowConfigDir(), /Storage root changed after binding/)
        process.env.CLAUDE_CONFIG_DIR = root
        admitted = true
        console.log('RUNTIME_ADMITTED')
        return {
          startTelegramAdapter() {}, startFeishuAdapter() {}, startDingTalkAdapter() {},
          startWeChatAdapter() {}, startWhatsAppAdapter() {},
        }
      })
      process.argv.push('--${platform}')
      await import(${JSON.stringify(entrypoint)})
      assert.equal(admitted, true)
      const { releaseProcessStorage } = await import(${JSON.stringify(startup)})
      await releaseProcessStorage()
      assert.deepEqual(readdirSync(join(getEchoFlowInternalDir(), 'migrations', 'writers')), [])
    `
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], {
      env: createSandboxedTestEnvironment(directory, { CLAUDE_CONFIG_DIR: root }),
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    if (state === 'ready') {
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
      expect(stdout).toContain('RUNTIME_ADMITTED')
    } else {
      expect(exitCode).toBe(1)
      expect(stderr).toContain('Unproven or future storage ownership')
      expect(stdout).not.toContain('RUNTIME_ADMITTED')
      expect(await readdir(root)).toEqual(['fixture.txt'])
      expect(await readFile(join(root, 'fixture.txt'), 'utf8')).toBe('keep')
    }
  })
}
