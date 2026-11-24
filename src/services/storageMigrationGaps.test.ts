import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'
import * as storageStartup from './storageStartup.js'
import { AdapterMigrationLifecycle, adapterMigrationLifecycle, quiesceAdapterProcess, registerAdapterShutdown } from '../../adapters/common/migration-lifecycle.js'
import { run } from '../localRecoveryCli.js'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations.js'
import { copyMigrationCredentials, createStorageMigrationCredentialHooks, verifyMigrationCredentials, type MigrationCredentialStore } from './storageMigrationCredentials.js'
import { createStorageMigrationHooks, validateStorageSQLite } from './storageMigrationValidation.js'
import { validateRestrictedHeadlessStorage } from './storageStartupValidation.js'

// Gap-closing regression tests for storage migration helpers. Everything runs
// against a temporary HOME/CLAUDE_CONFIG_DIR, fake credential stores and a
// mocked fetch. Windows ACL helpers and the real /usr/bin/security are not touched.
const spies: Array<{ mockRestore(): void }> = []
const directories: string[] = []
let sandbox: string
let savedEnv: NodeJS.ProcessEnv

async function tempDir(prefix: string): Promise<string> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `storage-gaps-${prefix}-`)))
  directories.push(directory)
  return directory
}

beforeEach(async () => {
  savedEnv = { ...process.env }
  sandbox = await tempDir('home')
  const env = createSandboxedTestEnvironment(sandbox, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' })
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, env)
})

afterEach(async () => {
  for (const spy of spies.splice(0).reverse()) spy.mockRestore()
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('adapter migration lifecycle quiesce ordering', () => {
  test('runs every cleanup (sync throw included), drains pending work, then rejects with the first failure', async () => {
    const lifecycle = new AdapterMigrationLifecycle()
    const ran: string[] = []
    let finishWork!: () => void
    lifecycle.track(new Promise<void>(resolve => { finishWork = resolve }).then(() => { ran.push('work') }))
    lifecycle.registerShutdown(() => { ran.push('sync'); throw new Error('sync cleanup failed') })
    lifecycle.registerShutdown(async () => { ran.push('async'); throw new Error('async cleanup failed') })
    lifecycle.registerShutdown(() => { ran.push('healthy') })

    let outcome: unknown = 'pending'
    const quiesced = lifecycle.quiesce().then(() => 'resolved', error => error)
    void quiesced.then(value => { outcome = value })
    await tick()
    expect(ran).toEqual(['sync', 'async', 'healthy'])
    expect(outcome).toBe('pending')

    finishWork()
    expect(await quiesced).toEqual(new Error('sync cleanup failed'))
    expect(ran).toEqual(['sync', 'async', 'healthy', 'work'])
  })

  test('reports tracked failures only once quiescing has begun', async () => {
    const before = new AdapterMigrationLifecycle()
    await expect(before.track(Promise.reject(new Error('ordinary failure')))).rejects.toThrow('ordinary failure')
    await before.quiesce()

    const during = new AdapterMigrationLifecycle()
    let failWork!: (error: Error) => void
    const work = during.track(new Promise<void>((_resolve, reject) => { failWork = reject }))
    const quiesced = during.quiesce()
    failWork(new Error('write failed during shutdown'))
    await expect(work).rejects.toThrow('write failed during shutdown')
    await expect(quiesced).rejects.toThrow('write failed during shutdown')
  })

  test('quiesceAdapterProcess drains the shared lifecycle before releasing process storage', async () => {
    const lifecycle = new AdapterMigrationLifecycle()
    const events: string[] = []
    lifecycle.registerShutdown(() => { events.push('cleanup') })
    spies.push(spyOn(adapterMigrationLifecycle, 'quiesce').mockImplementation(async () => {
      events.push('quiesce-start')
      await lifecycle.quiesce()
      events.push('quiesce-end')
    }))
    spies.push(spyOn(storageStartup, 'releaseProcessStorage').mockImplementation(async () => { events.push('release') }))
    await quiesceAdapterProcess()
    expect(events).toEqual(['quiesce-start', 'cleanup', 'quiesce-end', 'release'])
  })

  test('quiesceAdapterProcess surfaces a failed drain to the caller', async () => {
    spies.push(spyOn(adapterMigrationLifecycle, 'quiesce').mockRejectedValue(new Error('drain failed')))
    await expect(quiesceAdapterProcess()).rejects.toThrow('drain failed')
  })
})

describe('adapter shutdown signal wiring', () => {
  const signals = ['SIGINT', 'SIGTERM'] as const
  let signalBus: EventEmitter

  beforeEach(() => {
    signalBus = new EventEmitter()
    spies.push(spyOn(process, 'once').mockImplementation((signal, listener) => {
      signalBus.once(signal, listener)
      return process
    }))
    spies.push(spyOn(storageStartup, 'releaseProcessStorage').mockResolvedValue(undefined))
  })

  function stubProcess(lifecycle: AdapterMigrationLifecycle) {
    const exits: Array<number | undefined> = []
    const errors: unknown[][] = []
    let exited!: () => void
    const exitCalled = new Promise<void>(resolve => { exited = resolve })
    spies.push(
      spyOn(adapterMigrationLifecycle, 'registerShutdown').mockImplementation(lifecycle.registerShutdown.bind(lifecycle)),
      spyOn(adapterMigrationLifecycle, 'quiesce').mockImplementation(lifecycle.quiesce.bind(lifecycle)),
      spyOn(process, 'exit').mockImplementation(((code?: number) => { exits.push(code); exited() }) as never),
      spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) }),
    )
    return { exits, errors, exitCalled }
  }

  for (const signal of signals) {
    test(`${signal} runs registered cleanup, then exits 0`, async () => {
      const lifecycle = new AdapterMigrationLifecycle()
      const { exits, exitCalled } = stubProcess(lifecycle)
      const events: string[] = []
      registerAdapterShutdown(() => { events.push('cleanup') })
      signalBus.emit(signal, signal)
      await exitCalled
      expect(events).toEqual(['cleanup'])
      expect(exits).toEqual([0])
      expect(lifecycle.isQuiescing).toBe(true)
    })
  }

  test('a failing cleanup logs the shutdown failure and exits 1', async () => {
    const lifecycle = new AdapterMigrationLifecycle()
    const { exits, errors, exitCalled } = stubProcess(lifecycle)
    registerAdapterShutdown(() => { throw new Error('socket close failed') })
    signalBus.emit('SIGTERM', 'SIGTERM')
    await exitCalled
    expect(exits).toEqual([1])
    expect(errors).toHaveLength(1)
    expect(errors[0]![0]).toBe('[Adapter] Shutdown failed')
    expect(errors[0]![1]).toEqual(new Error('socket close failed'))
  })

  test('a signal handler fires once; a repeated signal does not start a second shutdown', async () => {
    const lifecycle = new AdapterMigrationLifecycle()
    const { exits, exitCalled } = stubProcess(lifecycle)
    let cleanups = 0
    registerAdapterShutdown(() => { cleanups++ })
    signalBus.emit('SIGINT', 'SIGINT')
    await exitCalled
    signalBus.emit('SIGINT', 'SIGINT')
    await tick()
    expect(cleanups).toBe(1)
    expect(exits).toEqual([0])
  })
})

function captureCli(reply = 'recovered') {
  const out = { stdout: '', stderr: '', requests: [] as Array<{ url: string; headers: Headers; body: any }> }
  spies.push(
    spyOn(process.stdout, 'write').mockImplementation(chunk => { out.stdout += String(chunk); return true }),
    spyOn(process.stderr, 'write').mockImplementation(chunk => { out.stderr += String(chunk); return true }),
    spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      out.requests.push({
        url: input instanceof Request ? input.url : String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json({
        id: 'msg-gaps', type: 'message', role: 'assistant', model: 'fixture-model',
        content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }) as typeof fetch),
  )
  return out
}

describe('local recovery CLI argument handling', () => {
  function failedCli(args: string[]) {
    const result = Bun.spawnSync([process.execPath, '--no-env-file', path.join(import.meta.dir, '../localRecoveryCli.ts'), ...args], {
      cwd: sandbox, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    })
    expect(result.exitCode).toBe(1)
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() }
  }

  test.each([['-h'], ['--help'], ['--print', 'hello', '--help']])('%s prints usage without any API call', async (...argv) => {
    const out = captureCli()
    await run(argv, Readable.from([]))
    expect(out.stdout).toContain('Usage: claude-haha')
    expect(out.requests).toEqual([])
    expect(process.exitCode).toBeUndefined()
  })

  test.each([['-v'], ['--version'], ['-V']])('%s prints the version and stops parsing', async flag => {
    const out = captureCli()
    await run([flag, '--print', 'ignored'], Readable.from([]))
    expect(out.stdout).toBe('999.0.0-local (Claude Code local recovery)\n')
    expect(out.requests).toEqual([])
  })

  test('print mode without a prompt or piped input exits with a usage error', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    expect(failedCli(['--print']).stderr).toBe('Error: prompt is required\n')
  })

  test.each([['print', ['--print', 'hi']], ['interactive', []]] as const)('%s mode without credentials reports the missing key', (_mode, argv) => {
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    expect(failedCli([...argv]).stderr).toBe('Error: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN\n')
  })

  test.each([['print', ['--print', 'hi']], ['interactive', []]] as const)('%s mode without a model reports it', (_mode, argv) => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    expect(failedCli([...argv]).stderr).toBe('Error: model is required\n')
  })

  test('--model beats ANTHROPIC_MODEL; DEFAULT_SONNET only fills in when ANTHROPIC_MODEL is unset', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'env-model'
    const out = captureCli()
    await run(['--print', '--model', 'flag-model', 'hi'], Readable.from([]))
    delete process.env.ANTHROPIC_MODEL
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'sonnet-default'
    await run(['--print', 'hi'], Readable.from([]))
    expect(out.requests.map(request => request.body.model)).toEqual(['flag-model', 'sonnet-default'])
  })

  test('joins positional words, skips ignored flags, and never treats a flag as the prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const out = captureCli()
    await run(['--bare', '--dangerously-skip-permissions', '--unknown-flag', '-p', 'say', 'hello'], Readable.from(['stdin ignored\n']))
    expect(out.requests[0]!.body.messages).toEqual([{ role: 'user', content: 'say hello' }])
    expect(out.stdout).toBe('recovered\n')
  })

  test('reads and trims the prompt from piped stdin when no positional prompt is given', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const out = captureCli()
    await run(['--print'], Readable.from(['  from ', 'stdin \n']))
    expect(out.requests[0]!.body.messages).toEqual([{ role: 'user', content: 'from stdin' }])
  })

  test('system prompt options: flag, file, append-only, and flag plus append', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const promptFile = path.join(sandbox, 'system.txt')
    await fs.writeFile(promptFile, 'from file')
    const out = captureCli()
    await run(['--print', 'q', '--system-prompt', 'base'], Readable.from([]))
    await run(['--print', 'q', '--system-prompt-file', promptFile], Readable.from([]))
    await run(['--print', 'q', '--append-system-prompt', 'extra'], Readable.from([]))
    await run(['--print', 'q', '--system-prompt', 'base', '--append-system-prompt', 'extra'], Readable.from([]))
    await run(['--print', 'q'], Readable.from([]))
    expect(out.requests.map(request => request.body.system)).toEqual(['base', 'from file', 'extra', 'base\n\nextra', undefined])
  })

  test('an unreadable --system-prompt-file rejects instead of silently running without it', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const out = captureCli()
    await expect(run(['--print', 'q', '--system-prompt-file', path.join(sandbox, 'missing.txt')], Readable.from([]))).rejects.toThrow('ENOENT')
    expect(out.requests).toEqual([])
  })

  test('--output-format json prints the raw response; unknown formats fall back to text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const out = captureCli('plain answer')
    await run(['--print', 'q', '--output-format', 'json'], Readable.from([]))
    expect(JSON.parse(out.stdout).content).toEqual([{ type: 'text', text: 'plain answer' }])
    out.stdout = ''
    await run(['--print', 'q', '--output-format', 'yaml'], Readable.from([]))
    expect(out.stdout).toBe('plain answer\n')
  })

  test('an auth token is sent as a bearer credential and an API key as x-api-key', async () => {
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-fixture'
    const out = captureCli()
    await run(['--print', 'q'], Readable.from([]))
    delete process.env.ANTHROPIC_AUTH_TOKEN
    process.env.ANTHROPIC_API_KEY = 'key-fixture'
    await run(['--print', 'q'], Readable.from([]))
    expect(out.requests[0]!.headers.get('authorization')).toBe('Bearer token-fixture')
    expect(out.requests[1]!.headers.get('x-api-key')).toBe('key-fixture')
  })

  test('interactive /clear drops history, blank lines are ignored, /quit stops reading', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const out = captureCli()
    await run([], Readable.from(['one\n\n/clear\ntwo\n/quit\nnever sent\n']))
    expect(out.requests.map(request => request.body.messages)).toEqual([
      [{ role: 'user', content: 'one' }],
      [{ role: 'user', content: 'two' }],
    ])
    expect(out.stdout).toContain('history cleared\n')
  })

  test('interactive turns accumulate history across assistant replies', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fixture'
    process.env.ANTHROPIC_MODEL = 'fixture-model'
    const out = captureCli('ack')
    await run([], Readable.from(['one\ntwo\n/exit\n']))
    expect(out.requests[1]!.body.messages).toEqual([
      { role: 'user', content: 'one' }, { role: 'assistant', content: 'ack' }, { role: 'user', content: 'two' },
    ])
  })

  test('storage adopt with bad arguments reports usage and exits 1', () => {
    expect(failedCli(['storage', 'adopt']).stdout).toContain('Usage: storage adopt openai-oauth --file')
  })
})

const bindingFor = (root: string) => ({ root, internalDir: path.join(root, 'echoflow-code'), selection: 'explicit' as const })
const sha = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex')

describe('headless restricted storage validation', () => {
  test('accepts an empty root', async () => {
    await expect(validateRestrictedHeadlessStorage(bindingFor(await tempDir('headless')))).resolves.toBeUndefined()
  })

  test('rejects a root reached through a symlink', async () => {
    const real = await tempDir('real')
    const link = path.join(await tempDir('links'), 'root')
    await fs.symlink(real, link)
    await expect(validateRestrictedHeadlessStorage(bindingFor(link))).rejects.toThrow('contains a link')
  })

  test.each(['Local State', 'Cookies', 'IndexedDB'])('refuses headless startup when Chromium data %s is present', async name => {
    const root = await tempDir('chromium')
    await fs.writeFile(path.join(root, name), 'x')
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow('restricted native desktop validation')
  })

  test('accepts managed JSON that its schema owner has already upgraded', async () => {
    const root = await tempDir('json-ok')
    await fs.mkdir(path.join(root, 'echoflow-code'))
    const relative = path.join('echoflow-code', 'providers.json')
    await fs.writeFile(path.join(root, relative), JSON.stringify(upgradePersistentStorageValue(relative, {})))
    await fs.writeFile(path.join(root, 'echoflow-code', 'settings.json'), '{}')
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).resolves.toBeUndefined()
  })

  test('rejects managed JSON that still needs an upgrade', async () => {
    const root = await tempDir('json-stale')
    await fs.mkdir(path.join(root, 'echoflow-code'))
    await fs.writeFile(path.join(root, 'echoflow-code', 'providers.json'), '{}')
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow('not upgraded by its schema owner')
  })

  test('rejects managed JSON from a future schema instead of passing it through', async () => {
    const root = await tempDir('json-future')
    await fs.mkdir(path.join(root, 'echoflow-code'))
    await fs.writeFile(path.join(root, 'echoflow-code', 'settings.json'), JSON.stringify({ schemaVersion: 999 }))
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow('Unsupported persistent storage schema')
  })

  test('rejects a hard-linked managed JSON snapshot and malformed JSON', async () => {
    const root = await tempDir('json-linked')
    await fs.mkdir(path.join(root, 'echoflow-code'))
    const file = path.join(root, 'echoflow-code', 'settings.json')
    await fs.writeFile(file, '{}')
    await fs.link(file, path.join(root, 'alias.json'))
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow('Invalid managed JSON snapshot')
    await fs.rm(path.join(root, 'alias.json'))
    await fs.writeFile(file, '{ not json')
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow()
  })

  test('rejects managed JSON whose directory is a symlink', async () => {
    const root = await tempDir('json-dirlink')
    const elsewhere = await tempDir('elsewhere')
    await fs.writeFile(path.join(elsewhere, 'settings.json'), '{}')
    await fs.symlink(elsewhere, path.join(root, 'echoflow-code'))
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow('contains a link')
  })

  test('a corrupt index database blocks startup and the original bytes stay untouched', async () => {
    const root = await tempDir('index-corrupt')
    const db = path.join(root, 'echoflow-code', 'db')
    await fs.mkdir(db, { recursive: true })
    const file = path.join(db, 'trace-index-v1.sqlite')
    await fs.writeFile(file, 'definitely not sqlite '.repeat(200))
    const before = await sha(file)
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow()
    expect(await sha(file)).toBe(before)
    expect((await fs.readdir(db)).sort()).toEqual(['trace-index-v1.sqlite'])
  })

  test('absent index databases are skipped, but a db path that is not a directory is an error', async () => {
    const root = await tempDir('index-missing')
    await fs.mkdir(path.join(root, 'echoflow-code', 'db'), { recursive: true })
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).resolves.toBeUndefined()
    await fs.rm(path.join(root, 'echoflow-code', 'db'), { recursive: true })
    await fs.writeFile(path.join(root, 'echoflow-code', 'db'), 'file')
    await expect(validateRestrictedHeadlessStorage(bindingFor(root))).rejects.toThrow()
  })
})

describe('SQLite snapshot validation', () => {
  async function database(directory: string, name = 'state.sqlite') {
    const file = path.join(directory, name)
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items VALUES (1, \'a\')')
    db.close()
    return file
  }
  const leftovers = async (directory: string) => (await fs.readdir(directory)).filter(name => name.startsWith('.sqlite-validation-'))

  test('the snapshot includes sidecar files next to the input, and the input directory gains no SHM', async () => {
    const directory = await tempDir('sqlite-sidecar-copy')
    const file = await database(directory)
    await fs.writeFile(`${file}-journal`, '')
    let names: string[] = []
    await validateStorageSQLite(file, candidate => { names = readdirSync(path.dirname(candidate)).sort() })
    expect(names).toEqual(['state.sqlite', 'state.sqlite-journal'])
    expect((await fs.readdir(directory)).sort()).toEqual(['state.sqlite', 'state.sqlite-journal'])
  })

  test('removes the private copy and surfaces the error when the consumer throws', async () => {
    const directory = await tempDir('sqlite-consumer')
    const file = await database(directory)
    await expect(validateStorageSQLite(file, () => { throw new Error('consumer rejected snapshot') })).rejects.toThrow('consumer rejected snapshot')
    expect(await leftovers(directory)).toEqual([])
  })

  test('rejects a missing database and cleans up its scratch directory', async () => {
    const directory = await tempDir('sqlite-missing')
    await expect(validateStorageSQLite(path.join(directory, 'absent.sqlite'))).rejects.toThrow('ENOENT')
    expect(await leftovers(directory)).toEqual([])
  })

  test('rejects a hard-linked or symlinked database because it is not an independent regular file', async () => {
    const directory = await tempDir('sqlite-links')
    const file = await database(directory)
    await fs.link(file, path.join(directory, 'alias.sqlite'))
    await expect(validateStorageSQLite(file)).rejects.toThrow('independent regular files')
    await fs.rm(path.join(directory, 'alias.sqlite'))
    await fs.symlink(file, path.join(directory, 'link.sqlite'))
    await expect(validateStorageSQLite(path.join(directory, 'link.sqlite'))).rejects.toThrow('independent regular files')
    expect(await leftovers(directory)).toEqual([])
  })

  test('rejects a hard-linked sidecar', async () => {
    const directory = await tempDir('sqlite-sidecar-link')
    const file = await database(directory)
    await fs.writeFile(`${file}-wal`, '')
    await fs.link(`${file}-wal`, path.join(directory, 'wal-alias'))
    await expect(validateStorageSQLite(file)).rejects.toThrow('independent regular files')
  })

  test('rejects a database in a symlinked directory', async () => {
    const real = await tempDir('sqlite-real')
    await database(real)
    const link = path.join(await tempDir('sqlite-linkdir'), 'dir')
    await fs.symlink(real, link)
    await expect(validateStorageSQLite(path.join(link, 'state.sqlite'))).rejects.toThrow('contains a link')
  })

  test('a corrupted page fails validation before the consumer runs', async () => {
    const directory = await tempDir('sqlite-corrupt')
    const file = path.join(directory, 'big.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE INDEX t_v ON t(v)')
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)')
    db.exec('BEGIN')
    for (let i = 0; i < 3000; i++) insert.run(`value-${i}-${'x'.repeat(40)}`)
    db.exec('COMMIT')
    db.close()
    const handle = await fs.open(file, 'r+')
    try { await handle.write(Buffer.alloc(8192, 0xff), 0, 8192, 4096 * 3) } finally { await handle.close() }
    let consumed = false
    await expect(validateStorageSQLite(file, () => { consumed = true })).rejects.toThrow()
    expect(consumed).toBe(false)
    expect(await leftovers(directory)).toEqual([])
  })
})

describe('storage migration hooks wiring', () => {
  test('upgradeJson is the schema owner: it passes unknown files through and rejects future schemas', () => {
    const hooks = createStorageMigrationHooks(bindingFor(sandbox))
    expect(hooks.upgradeJson!('other.json', { keep: 1 })).toEqual({ keep: 1 })
    expect(() => hooks.upgradeJson!(path.join('echoflow-code', 'settings.json'), { schemaVersion: 999 })).toThrow('Unsupported persistent storage schema')
  })

  test('assertQuiescent refuses relative roots instead of treating them as proof of quiescence', async () => {
    await expect(createStorageMigrationHooks(bindingFor(sandbox)).assertQuiescent(['relative/root'])).rejects.toThrow()
  })
})

const keychainSuffix = (directory: string) => `-${createHash('sha256').update(directory.normalize('NFC')).digest('hex').slice(0, 8)}`
const digestOf = (value: string) => createHash('sha256').update(value).digest('hex')
const wholeRoot = (directory: string) => ({ directory, markerRoot: directory })

async function credentialFixture() {
  const root = await tempDir('credentials')
  const make = async (name: string) => { const dir = path.join(root, name); await fs.mkdir(dir); return dir }
  const target = await make('target')
  const transaction = await make('transaction')
  const values = new Map<string, string>([['Claude Code-credentials', 'shared-sentinel']])
  const log: string[] = []
  const store: MigrationCredentialStore = {
    async read(service) { log.push(`read ${service}`); return values.get(service) ?? null },
    async write(service, value) { log.push(`write ${service}`); values.set(service, value) },
    async remove(service) { log.push(`remove ${service}`); values.delete(service) },
  }
  return { make, target, transaction, values, log, store, receipt: path.join(transaction, 'credentials.json') }
}

describe('migration credential transactions', () => {
  test('a target credential that differs from the source blocks the copy and nothing is created or removed', async () => {
    const f = await credentialFixture()
    const source = await f.make('source')
    const oldService = `Claude Code-credentials${keychainSuffix(source)}`
    const newService = `Claude Code-credentials${keychainSuffix(f.target)}`
    f.values.set(oldService, 'source-secret')
    f.values.set(newService, 'someone-elses-secret')
    const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
    await expect(hooks.prepareResources!(f.transaction, [wholeRoot(source)])).rejects.toThrow('Target directory has different macOS credentials')
    expect(f.log.some(line => line.startsWith('write') || line.startsWith('remove'))).toBe(false)
    expect(f.values.get(newService)).toBe('someone-elses-secret')
    expect(f.values.get(oldService)).toBe('source-secret')
    expect(JSON.parse(await fs.readFile(f.receipt, 'utf8')).created).toEqual([])
  })

  test('the created-credential receipt is durable before the keychain write happens', async () => {
    const f = await credentialFixture()
    const source = await f.make('source')
    const oldService = `Claude Code-credentials${keychainSuffix(source)}`
    const newService = `Claude Code-credentials${keychainSuffix(f.target)}`
    f.values.set(oldService, 'source-secret')
    let journalAtWrite: any
    const write = f.store.write
    f.store.write = async (service, value, signal) => { journalAtWrite = JSON.parse(await fs.readFile(f.receipt, 'utf8')); await write(service, value, signal) }
    await createStorageMigrationCredentialHooks(f.target, f.store).prepareResources!(f.transaction, [wholeRoot(source)])
    expect(journalAtWrite.created).toEqual([{ service: newService, digest: digestOf('source-secret') }])
    const final = JSON.parse(await fs.readFile(f.receipt, 'utf8'))
    expect(final.copies).toEqual([{ source: oldService, target: { service: newService, digest: digestOf('source-secret') } }])
    expect((await fs.stat(f.receipt)).mode & 0o777).toBe(0o600)
    expect((await fs.readdir(f.transaction)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  test('sources that are not whole dedicated roots are never read', async () => {
    const f = await credentialFixture()
    const dirs = await Promise.all(['layout', 'archive', 'internal', 'dest', 'nested'].map(f.make))
    const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
    await hooks.prepareResources!(f.transaction, [
      { directory: dirs[0]!, markerRoot: dirs[0]!, layout: 'root-config' },
      { directory: dirs[1]!, markerRoot: dirs[1]!, archive: true },
      { directory: dirs[2]!, markerRoot: dirs[2]!, ownership: 'legacy-internal' },
      { directory: dirs[3]!, markerRoot: dirs[3]!, destination: 'echoflow-code' },
      { directory: dirs[4]!, markerRoot: f.target },
    ])
    expect(f.log).toEqual([])
    expect(f.values).toEqual(new Map([['Claude Code-credentials', 'shared-sentinel']]))
  })

  test('a failed read-back after the write aborts with a verification error', async () => {
    const f = await credentialFixture()
    const source = await f.make('source')
    f.values.set(`Claude Code-credentials${keychainSuffix(source)}`, 'source-secret')
    f.store.write = async (service) => { f.values.set(service, 'corrupted') }
    await expect(createStorageMigrationCredentialHooks(f.target, f.store).prepareResources!(f.transaction, [wholeRoot(source)])).rejects.toThrow('macOS credential verification failed')
  })

  test('rerunning prepare is idempotent and detects a source that changed after it was copied', async () => {
    const f = await credentialFixture()
    const source = await f.make('source')
    const oldService = `Claude Code-credentials${keychainSuffix(source)}`
    const newService = `Claude Code-credentials${keychainSuffix(f.target)}`
    f.values.set(oldService, 'v1')
    const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
    await hooks.prepareResources!(f.transaction, [wholeRoot(source)])
    await hooks.prepareResources!(f.transaction, [wholeRoot(source)])
    expect(f.log.filter(line => line.startsWith('write'))).toEqual([`write ${newService}`])
    expect(JSON.parse(await fs.readFile(f.receipt, 'utf8')).copies).toHaveLength(1)
    f.values.set(oldService, 'v2')
    f.values.set(newService, 'v2')
    await expect(hooks.prepareResources!(f.transaction, [wholeRoot(source)])).rejects.toThrow('Source migration credential changed')
  })

  test('copying from the default root reads the unhashed names for every oauth variant, and an aborted signal reads nothing', async () => {
    const f = await credentialFixture()
    const names = ['', '-custom-oauth', '-staging-oauth', '-local-oauth'].flatMap(oauth => ['', '-credentials'].map(kind => `Claude Code${oauth}${kind}`))
    for (const name of names) f.values.set(name, `secret:${name}`)
    const receipts = await copyMigrationCredentials(f.transaction, true, f.target, f.store, async () => {})
    expect(receipts.map(receipt => receipt.service)).toEqual(names.map(name => `${name}${keychainSuffix(f.target)}`))
    f.log.length = 0
    const controller = new AbortController()
    controller.abort()
    await expect(copyMigrationCredentials(f.transaction, true, f.target, f.store, async () => {}, controller.signal)).rejects.toThrow()
    expect(f.log).toEqual([])
  })

  test('verifyMigrationCredentials rejects a credential that is missing or whose digest changed', async () => {
    const f = await credentialFixture()
    const receipt = { service: 'Claude Code-credentials-aaaaaaaa', digest: digestOf('expected') }
    await expect(verifyMigrationCredentials([receipt], f.store)).rejects.toThrow('Migrated macOS credentials are unavailable')
    f.values.set(receipt.service, 'tampered')
    await expect(verifyMigrationCredentials([receipt], f.store)).rejects.toThrow('Migrated macOS credentials are unavailable')
    f.values.set(receipt.service, 'expected')
    await expect(verifyMigrationCredentials([receipt], f.store)).resolves.toBeUndefined()
  })

  async function copied() {
    const f = await credentialFixture()
    const source = await f.make('source')
    const oldService = `Claude Code-credentials${keychainSuffix(source)}`
    const newService = `Claude Code-credentials${keychainSuffix(f.target)}`
    f.values.set(oldService, 'source-secret')
    const hooks = createStorageMigrationCredentialHooks(f.target, f.store)
    await hooks.prepareResources!(f.transaction, [wholeRoot(source)])
    f.log.length = 0
    return { ...f, hooks, oldService, newService }
  }

  test('cleanup verifies the copied credential before it touches the source', async () => {
    const f = await copied()
    await f.hooks.cleanupResources!(f.transaction)
    expect(f.log).toEqual([`read ${f.newService}`, `read ${f.oldService}`, `remove ${f.oldService}`])
    expect(f.values.has(f.oldService)).toBe(false)
    expect(f.values.get(f.newService)).toBe('source-secret')
  })

  test('cleanup removes nothing when the copied credential has disappeared', async () => {
    const f = await copied()
    f.values.delete(f.newService)
    await expect(f.hooks.cleanupResources!(f.transaction)).rejects.toThrow('Migrated macOS credentials are unavailable')
    expect(f.log.some(line => line.startsWith('remove'))).toBe(false)
    expect(f.values.get(f.oldService)).toBe('source-secret')
  })

  test('cleanup is blocked, and the source kept, when the retired source changed after the copy', async () => {
    const f = await copied()
    f.values.set(f.oldService, 'edited-after-copy')
    await expect(f.hooks.cleanupResources!(f.transaction)).rejects.toThrow('cleanup is blocked')
    expect(f.log.some(line => line.startsWith('remove'))).toBe(false)
    expect(f.values.get(f.oldService)).toBe('edited-after-copy')
  })

  test('cleanup tolerates a source that is already gone, so a resumed cleanup finishes', async () => {
    const f = await copied()
    f.values.delete(f.oldService)
    await f.hooks.cleanupResources!(f.transaction)
    expect(f.log.some(line => line.startsWith('remove'))).toBe(false)
  })

  test('validateResources fails when the copied credential no longer matches the receipt', async () => {
    const f = await copied()
    await f.hooks.validateResources!(f.transaction)
    f.values.set(f.newService, 'other')
    await expect(f.hooks.validateResources!(f.transaction)).rejects.toThrow('Migrated macOS credentials are unavailable')
  })

  describe('receipt validation', () => {
    const digest = 'a'.repeat(64)
    async function receiptFor(f: Awaited<ReturnType<typeof credentialFixture>>, patch: (journal: any) => unknown) {
      const service = `Claude Code-credentials${keychainSuffix(f.target)}`
      const journal = { version: 1, target: f.target, created: [], copies: [{ source: 'Claude Code-credentials-bbbbbbbb', target: { service, digest } }] }
      const patched = patch(journal)
      await fs.writeFile(f.receipt, JSON.stringify(patched === undefined ? journal : patched))
      return createStorageMigrationCredentialHooks(f.target, f.store)
    }

    test.each([
      ['unknown version', (j: any) => { j.version = 2 }],
      ['another target directory', (j: any) => { j.target = '/elsewhere' }],
      ['created is not an array', (j: any) => { j.created = {} }],
      ['target service from another keychain namespace', (j: any) => { j.copies[0].target.service = 'Claude Code-credentials-cccccccc' }],
      ['digest is not sha-256 hex', (j: any) => { j.copies[0].target.digest = 'xyz' }],
      ['copy source outside the hashed namespace', (j: any) => { j.copies[0].source = 'Claude Code-credentials' }],
      ['copy source equals its target', (j: any) => { j.copies[0].source = j.copies[0].target.service }],
      ['null journal', () => null],
    ])('rejects a receipt with %s and never touches the keychain', async (_name, patch) => {
      const f = await credentialFixture()
      const hooks = await receiptFor(f, patch as (journal: any) => unknown)
      await expect(hooks.cleanupResources!(f.transaction)).rejects.toThrow('Invalid credential transaction receipt')
      await expect(hooks.validateResources!(f.transaction)).rejects.toThrow('Invalid credential transaction receipt')
      expect(f.log).toEqual([])
    })

    test('rejects a hard-linked receipt file and a receipt directory reached through a link', async () => {
      const f = await credentialFixture()
      const hooks = await receiptFor(f, journal => journal)
      await fs.link(f.receipt, path.join(f.target, 'alias'))
      await expect(hooks.validateResources!(f.transaction)).rejects.toThrow('Invalid credential transaction receipt')
      const link = path.join(path.dirname(f.transaction), 'transaction-link')
      await fs.symlink(f.transaction, link)
      await expect(hooks.validateResources!(link)).rejects.toThrow('contains a link')
      expect(f.log).toEqual([])
    })

    test('a corrupt receipt stops prepare instead of being overwritten with an empty journal', async () => {
      const f = await credentialFixture()
      await fs.writeFile(f.receipt, '{ truncated')
      await expect(createStorageMigrationCredentialHooks(f.target, f.store).prepareResources!(f.transaction, [])).rejects.toThrow()
      expect(await fs.readFile(f.receipt, 'utf8')).toBe('{ truncated')
    })
  })
})
