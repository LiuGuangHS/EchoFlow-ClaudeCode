// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const run = promisify(execFile)
const repository = path.resolve(import.meta.dirname, '../..')
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function launch(mode: 'server' | 'adapters' | 'cli' | 'installed', options: {
  inactive?: boolean
  unowned?: boolean
  args?: string[]
} = {}) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'echoflow-sidecar-storage-')))
  homes.push(home)
  const root = path.join(home, 'storage')
  const sentinel = path.join(root, 'unrelated.json')
  if (options.unowned) {
    await mkdir(root)
    await writeFile(sentinel, '{"owner":"someone else"}')
  }
  const driver = path.join(home, 'driver.ts')
  const entry = path.join(repository, 'desktop/sidecars/claude-sidecar.ts')
  const installed = path.join(home, process.platform === 'win32' ? 'claude-haha.exe' : 'claude-haha')
  const args = mode === 'installed'
    ? options.args ?? []
    : [mode, '--app-root', repository, ...(mode === 'adapters' ? ['--feishu'] : []), ...(options.args ?? [])]
  await writeFile(driver, `
    import { mock } from 'bun:test'
    import fs from 'node:fs'
    import path from 'node:path'
    const root = process.env.CLAUDE_CONFIG_DIR
    globalThis.MACRO = { VERSION: '0.0.0-sidecar-fixture' }
    globalThis.fetch = async () => { throw new Error('Unexpected network request') }
    const assertLease = () => {
      const file = path.join(root, 'app.json')
      if (!fs.existsSync(file)) throw new Error('Business mode started before root binding')
      const writers = path.join(root, 'echoflow-code/migrations/writers')
      if (fs.readdirSync(writers).length !== 1) throw new Error('Sidecar needs its own writer lease')
      fs.writeFileSync(path.join(root, 'observed-mode'), ${JSON.stringify(mode)})
    }
    if (${mode === 'server'}) {
      // Observe the real preload assignment, not Bun's eager mock factory.
      let preloaded = false
      Object.defineProperty(globalThis, 'MACRO', {
        get: () => ({ VERSION: '0.0.0-sidecar-fixture' }),
        set() { assertLease(); preloaded = true },
      })
      mock.module(${JSON.stringify(path.join(repository, 'src/server/index.ts'))}, () => ({
        startServer() {
          if (!preloaded) throw new Error('Server started before preload')
          assertLease()
        },
      }))
    } else {
      mock.module(${JSON.stringify(path.join(repository, 'preload.ts'))}, () => ({}))
    }
    const configModule = ${JSON.stringify(path.join(repository, 'adapters/common/config.ts'))}
    const realConfig = await import(configModule)
    mock.module(configModule, () => ({
      ...realConfig,
      loadConfig() { assertLease(); return { feishu: {} } },
    }))
    if (${mode === 'installed'}) Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(installed)} })
    process.argv = [process.execPath, ${JSON.stringify(entry)}, ...${JSON.stringify(args)}]
    await import(${JSON.stringify(entry)})
  `)
  const env = createSandboxedTestEnvironment(home, {
    CLAUDE_CONFIG_DIR: root,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
    ...(options.inactive ? { CC_HAHA_MIGRATION_CONTROL: '1' } : {}),
  })
  const before = (await readdir(home, { recursive: true })).sort()
  // Let the sidecar own preload timing instead of the root Bun config.
  const result = await run('bun', ['--no-env-file', driver], { cwd: home, env, timeout: 15_000 }).then(
    output => ({ ...output, code: 0 }),
    error => {
      if (typeof error.code !== 'number') throw error
      return { code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string }
    },
  )
  const after = (await readdir(home, { recursive: true })).sort()
  if (options.unowned) expect(await readFile(sentinel, 'utf8')).toBe('{"owner":"someone else"}')
  return { root, before, after, ...result }
}

describe('real merged sidecar storage startup', () => {
  it('leases server mode before preload and the exported server entry', async () => {
    const { root, code, stderr } = await launch('server')
    expect(code, stderr).toBe(0)
    expect(stderr).toBe('')
    expect(await readFile(path.join(root, 'observed-mode'), 'utf8')).toBe('server')
    expect(await readdir(path.join(root, 'echoflow-code/migrations/writers'))).toEqual([])
  })

  it('leases adapters before reading configuration, then releases the inactive receipt before exit', async () => {
    const { root, code, stdout, stderr } = await launch('adapters', { inactive: true })
    expect(code, stderr).toBe(0)
    expect(stderr).toContain('--feishu requested but')
    expect(stdout).toContain('"type":"migration_adapter_inactive"')
    expect(await readFile(path.join(root, 'observed-mode'), 'utf8')).toBe('adapters')
    expect(await readdir(path.join(root, 'echoflow-code/migrations/writers'))).toEqual([])
  })

  for (const mode of ['cli', 'installed'] as const) {
    it.each(['--version', '-v', '-V'])(`${mode} %s leaves absent and unowned storage untouched`, async flag => {
      for (const unowned of [false, true]) {
        const { code, stdout, stderr, before, after } = await launch(mode, { unowned, args: [flag] })
        expect.soft(after).toEqual(before)
        expect.soft(code, stderr).toBe(0)
        expect.soft(stdout.trim()).toBe('0.0.0-sidecar-fixture (Claude Code)')
        expect.soft(stderr).toBe('')
      }
    }, 35_000)
  }

  it.each(['server', 'adapters', 'cli'] as const)('%s does not bypass unowned storage admission for non-version invocations', async mode => {
    const { code, stdout, stderr, before, after } = await launch(mode, {
      unowned: true, args: mode === 'cli' ? ['--version', '--help'] : [],
    })
    expect(code).not.toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toContain('Unproven or future storage ownership')
    expect(after).toEqual(before)
  }, 20_000)

  it.each([false, true])('starts configured WeCom with a bad WhatsApp override (WhatsApp requested: %s)', async (requested) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'echoflow-sidecar-whatsapp-'))
    homes.push(home)
    const root = path.join(home, 'storage')
    const entry = path.join(repository, 'desktop/sidecars/claude-sidecar.ts')
    const script = `
      import { mock } from 'bun:test'
      globalThis.fetch = async () => { throw new Error('Unexpected network request') }
      mock.module(${JSON.stringify(path.join(repository, 'preload.ts'))}, () => ({}))
      mock.module(${JSON.stringify(path.join(repository, 'adapters/wecom/index.ts'))}, () => {
        console.log('WECOM_STARTED')
        return {}
      })
      mock.module(${JSON.stringify(path.join(repository, 'adapters/whatsapp/session.ts'))}, () => ({
        hasWhatsAppAuth() { console.log('WHATSAPP_CREDENTIALS_PROBED'); return false },
      }))
      process.argv = [process.execPath, ${JSON.stringify(entry)}, 'adapters', '--wecom', ...${JSON.stringify(requested ? ['--whatsapp'] : [])}]
      await import(${JSON.stringify(entry)})
    `
    const env = createSandboxedTestEnvironment(home, {
      CLAUDE_CONFIG_DIR: root,
      WHATSAPP_AUTH_DIR: path.join(home, 'external-auth'),
      WECOM_BOT_ID: 'fixture-id',
      WECOM_BOT_SECRET: 'fixture-secret',
    })
    const { stdout, stderr } = await run('bun', ['--no-env-file', '--eval', script], { cwd: repository, env, timeout: 15_000 })
    expect(stdout).toContain('WECOM_STARTED')
    expect(stdout).not.toContain('WHATSAPP_CREDENTIALS_PROBED')
    expect(stderr.includes('outside the selected storage root')).toBe(requested)
  })
})
