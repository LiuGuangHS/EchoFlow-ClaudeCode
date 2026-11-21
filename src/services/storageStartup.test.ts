import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../..')
const sandboxes: string[] = []

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'echoflow-startup-'))
  sandboxes.push(home)
  const root = join(home, 'storage')
  const env = createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: root })
  return { home, root, env }
}

async function child(args: string[], env: Record<string, string>) {
  const process = Bun.spawn([Bun.which('bun') ?? globalThis.process.execPath, '--no-env-file', ...args], {
    cwd: repository, env, stdout: 'pipe', stderr: 'pipe',
    timeout: 10_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ])
  return { stdout, stderr, code }
}

const prelude = `
  globalThis.fetch = async () => { throw new Error('Unexpected network request') }
  const { readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { initializeProcessStorage, releaseProcessStorage } = await import('./src/services/storageStartup.ts')
  const { getEchoFlowConfigDir, getEchoFlowInternalDir } = await import('./src/utils/echoFlowConfigRoot.ts')
`

afterEach(() => {
  for (const home of sandboxes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('headless storage startup', () => {
  test('binds once before writers, permits ready co-writers, and releases only once', async () => {
    const { root, env } = fixture()
    const result = await child(['--eval', prelude + `
      await Promise.all([initializeProcessStorage(), initializeProcessStorage()])
      const root = getEchoFlowConfigDir()
      const internalDir = getEchoFlowInternalDir()
      const writers = join(internalDir, 'migrations', 'writers')
      if ((await readdir(writers)).length !== 1) throw new Error('Expected one process lease')
      const { acquireStorageWriter } = await import('./src/services/storageMigration.ts')
      const { resolveStorageBinding } = await import('./src/utils/echoFlowConfigRoot.ts')
      const second = await acquireStorageWriter(resolveStorageBinding())
      if ((await readdir(writers)).length !== 2) throw new Error('Ready writers cannot coexist')
      await second.release()
      process.env.CLAUDE_CONFIG_DIR = join(root, 'other')
      let rejected = false
      try { getEchoFlowConfigDir() } catch { rejected = true }
      if (!rejected) throw new Error('Root switch was accepted')
      process.env.CLAUDE_CONFIG_DIR = root
      await Promise.all([releaseProcessStorage(), releaseProcessStorage()])
      if ((await readdir(writers)).length) throw new Error('Lease leaked')
      console.log(JSON.stringify({ root, internalDir }))
    `], env)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({ root, internalDir: join(root, 'echoflow-code') })
    expect(readdirSync(join(root, 'echoflow-code', 'migrations', 'writers'))).toEqual([])
  })

  test('natural process exit releases the lifetime receipt', async () => {
    const { root, env } = fixture()
    const result = await child(['--eval', prelude + 'await initializeProcessStorage()'], env)
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(readdirSync(join(root, 'echoflow-code', 'migrations', 'writers'))).toEqual([])
  })

  test('refuses to create a root when the location file has been truncated', async () => {
    const { home, root, env } = fixture()
    const location = join(home, '.echoflow-storage')
    mkdirSync(location)
    writeFileSync(join(location, 'active-root.sqlite'), '')
    const result = await child(['--eval', prelude + 'await initializeProcessStorage()'], env)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Invalid active EchoFlow storage location')
    expect(existsSync(root)).toBe(false)
  })

  test('does not adopt a nonempty unowned root', async () => {
    const { root, env } = fixture()
    mkdirSync(root)
    writeFileSync(join(root, 'unrelated.json'), '{"owner":"someone else"}')
    const result = await child(['--eval', prelude + 'await initializeProcessStorage()'], env)
    expect(result.code).not.toBe(0)
    expect(existsSync(join(root, 'app.json'))).toBe(false)
    expect(readFileSync(join(root, 'unrelated.json'), 'utf8')).toBe('{"owner":"someone else"}')
  })

  test('adapter drain keeps the receipt until pending writes complete', async () => {
    const { root, env } = fixture()
    const result = await child(['--eval', prelude + `
      await initializeProcessStorage()
      const { adapterMigrationLifecycle, quiesceAdapterProcess } = await import('./adapters/common/migration-lifecycle.ts')
      let finish
      adapterMigrationLifecycle.track(new Promise(resolve => { finish = resolve }))
      let entered
      const closing = new Promise(resolve => { entered = resolve })
      adapterMigrationLifecycle.registerShutdown(() => { entered() })
      const drain = quiesceAdapterProcess()
      await closing
      const writers = join(getEchoFlowInternalDir(), 'migrations', 'writers')
      if ((await readdir(writers)).length !== 1) throw new Error('Released before write drain')
      finish()
      await drain
      if ((await readdir(writers)).length) throw new Error('Lease not released after drain')
    `], env)
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(readdirSync(join(root, 'echoflow-code', 'migrations', 'writers'))).toEqual([])
  })

  const entrypoints = [
    ['src/entrypoints/cli.tsx'],
    ['src/localRecoveryCli.ts', 'run'],
    ['src/server/index.ts'],
    ...['telegram', 'feishu', 'wechat', 'dingtalk', 'whatsapp', 'qq', 'wecom', 'slack'].map(platform => [`adapters/${platform}/index.ts`]),
  ]
  for (const args of entrypoints) {
    test(`${args[0]} blocks migration before loading business writers`, async () => {
      const { root, env } = fixture()
      const legacy = join(root, 'cc-haha')
      mkdirSync(legacy, { recursive: true })
      writeFileSync(join(legacy, 'settings.json'), '{"fixture":true}')
      const result = await child(args, env)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Unproven or future storage ownership')
      expect(readdirSync(root)).toEqual(['cc-haha'])
      expect(readFileSync(join(legacy, 'settings.json'), 'utf8')).toBe('{"fixture":true}')
    })
  }
})
