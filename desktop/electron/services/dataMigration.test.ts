import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import nativeFs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest'
import { DataMigration, type DataMigrationHooks } from './dataMigration'
import type { AppModeAppLike } from './appMode'
import { buildEchoFlowOwnershipMarker, getDefaultEchoFlowConfigDir, resolveStorageBinding, type StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { acquireStorageWriter, readStorageMigrationStatus, storageLocationFile, type StorageMigrationHooks } from '../../../src/services/storageMigration'
import { resolveRelocatedAttachmentPath } from '../../../src/utils/storageRelocations'
import { recordDesktopStorageLaunch } from './desktopStorageProvenance'
import { discoverDesktopStorage, initializeDesktopStorage } from './desktopStorageStartup'
import { createStorageMigrationCredentialHooks } from './migrationCredentials'
import type { DesktopMoveLaunch } from './desktopStorageMove'
import { desktopOpenAiOauthRelaunchArgs } from './desktopStorageAdoption'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function fixture(useDefault = false) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'product-migration-'))
  roots.push(root)
  const home = path.join(root, 'home')
  // The subprocess uses the host platform, while desktop discovery here uses Linux.
  const source = useDefault ? getDefaultEchoFlowConfigDir({ env: {}, platform: 'linux', homeDir: home }) : path.join(root, 'current')
  const target = path.join(root, '新数据 directory')
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(home, { recursive: true })
  await fs.mkdir(path.join(root, 'install'))
  const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: source }
  const app: AppModeAppLike = { getPath(name) { return name === 'home' ? home : name === 'userData' ? source : path.join(root, 'install', 'product.exe') } }
  const hooks: DataMigrationHooks = {
    preview: vi.fn(async () => ({ activeTasks: 2, externalProcesses: 0 })),
    quiesce: vi.fn(async () => {}), assertQuiescent: vi.fn(async () => {}),
    resume: vi.fn(async () => {}), restart: vi.fn(), progress: vi.fn(), platform: 'linux',
  }
  recordDesktopStorageLaunch(resolveStorageBinding({ env: {}, roots: [source] }), { roots: [] }, env)
  const put = async (relative: string, value: string) => {
    const file = path.join(source, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, value)
  }
  await put('app.json', JSON.stringify(buildEchoFlowOwnershipMarker(), null, 2) + '\n')
  await put('echoflow-code/settings.json', '{"unknown":{"preserve":true}}')
  await put('projects/fixture/session.jsonl', '{"type":"user","message":"hello"}\n')
  await put('uploads/session/file.txt', 'attachment bytes')
  const migration = new DataMigration(app, hooks, env)
  const binding = resolveStorageBinding({ env: {}, roots: [target] })
  let request: DesktopMoveLaunch | undefined
  const start = async () => {
    const preview = await migration.prepare(target)
    await migration.start(preview.id)
    await migration.wait()
    request = (hooks.restart as MockedFunction<typeof hooks.restart>).mock.calls.at(-1)?.[1]
    return preview
  }
  const discover = (overrides: NodeJS.ProcessEnv = {}, switches: Record<string, string> = {}) => {
    if (!request) request = (hooks.restart as MockedFunction<typeof hooks.restart>).mock.calls.at(-1)?.[1]
    if (!request) throw new Error('No scheduled request')
    const controls: Record<string, string> = { 'user-data-dir': target, 'echoflow-move-source': request.source, 'echoflow-move-request': request.id, 'echoflow-move-proof': request.proof, ...switches }
    return discoverDesktopStorage({ ...app, commandLine: { hasSwitch: name => name in controls, getSwitchValue: name => controls[name] ?? '' } }, overrides, 'linux', home)
  }
  const cold = async (validate: (binding: StorageBinding) => Promise<void> = async () => {}) => {
    const admitted = await initializeDesktopStorage(discover(), selected => ({
      platform: hooks.platform,
      assertQuiescent: async roots => { if (!hooks.assertQuiescent) throw new Error('Cold host quiescence required'); await hooks.assertQuiescent(roots) },
      validateSQLite: hooks.validateSQLite, upgradeJson: hooks.upgradeJson, permissions: hooks.permissions,
      ...(hooks.platform === 'darwin' ? createStorageMigrationCredentialHooks(selected.root, hooks.credentialStore!) : {}),
    }), validate)
    await admitted.release()
    return admitted.binding
  }
  const publish = async () => { await expect(cold(async () => { throw new Error('interrupted cold validator') })).rejects.toThrow('interrupted cold validator') }
  return { root, home, source, target, env, app, hooks, put, migration, binding, start, discover, cold, publish,
    requestFile: () => path.join(source, 'echoflow-code', 'storage-handoffs', `${(hooks.restart as MockedFunction<typeof hooks.restart>).mock.calls.at(-1)![1]!.id}.json`) }
}

describe('desktop OpenAI sign-in migration', () => {
  async function oauthFixture() {
    const f = await fixture(true)
    const file = path.join(f.root, 'external', 'openai-oauth.json')
    const tokens = { accessToken: 'fixture-only', refreshToken: 'fixture-refresh', expiresAt: 1, email: null, accountId: null }
    const bytes = JSON.stringify(tokens) + '\n'
    await fs.mkdir(path.dirname(file))
    await fs.writeFile(file, bytes)
    await fs.writeFile(path.join(path.dirname(file), 'unrelated.json'), 'keep')
    const target = path.join(f.source, 'echoflow-code', 'openai-oauth.json')
    const restart = vi.fn<NonNullable<DataMigrationHooks['restartForOpenAiOauth']>>()
    f.hooks.restartForOpenAiOauth = restart
    return { ...f, file, bytes, tokens, target, restart, choose: async () => file }
  }

  it.each(['default', 'relocated'])('moves only the confirmed file into the %s directory in cold startup', async location => {
    const f = await oauthFixture()
    const root = location === 'relocated' ? f.binding.root : f.source
    if (location === 'relocated') {
      await f.start()
      await f.cold()
    }
    const env = { CLAUDE_CONFIG_DIR: root }
    const binding = resolveStorageBinding({ env })
    const appPaths = { getPath: (name: Parameters<AppModeAppLike['getPath']>[0]) => name === 'userData' ? root : f.app.getPath(name) }
    recordDesktopStorageLaunch(binding, { roots: [] }, env)
    const migration = new DataMigration(appPaths, f.hooks, env)
    const target = path.join(binding.internalDir, 'openai-oauth.json')
    const confirm = vi.fn(async () => true)
    const lease = await acquireStorageWriter(binding)
    try {
      await migration.prepareOpenAiOauth(f.choose, confirm)
      await migration.wait()
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ sourceDir: f.file, targetDir: target, files: 1, bytes: f.bytes.length }))
      expect(migration.status?.stage).toBe('restarting')
      await expect(fs.readFile(f.file, 'utf8')).resolves.toBe(f.bytes)
      await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await lease.release() }

    const [relaunchRoot, request] = f.restart.mock.calls[0]!
    expect(relaunchRoot).toBe(root)
    const args = desktopOpenAiOauthRelaunchArgs(['main.cjs', '--', 'positional'], request)
    expect(args.slice(-2)).toEqual(['--', 'positional'])
    const switches = new Map(args.slice(1, -2).map(arg => [arg.slice(2, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]))
    const app = { ...appPaths, commandLine: { hasSwitch: (name: string) => switches.has(name), getSwitchValue: (name: string) => switches.get(name) ?? '' } }
    const launch = discoverDesktopStorage(app, {}, 'linux', f.home)
    const validate = vi.fn(async () => {
      await expect(fs.readFile(target, 'utf8')).resolves.toBe(f.bytes)
      await expect(fs.readFile(f.file, 'utf8')).resolves.toBe(f.bytes)
    })
    const admitted = await initializeDesktopStorage(launch, { platform: 'linux', assertQuiescent: f.hooks.assertQuiescent! }, validate)
    await admitted.release()
    expect(admitted.binding.root).toBe(root)
    expect(validate).toHaveBeenCalledOnce()
    await promisify(execFile)('bun', ['--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import { EchoFlowOpenAIOAuthService } from './src/server/services/echoFlowOpenAIOAuthService.ts'
      import { buildOpenAIOfficialRuntimeEnv } from './src/server/services/openaiOfficialProvider.ts'
      import { getOpenAIOAuthTokens } from './src/services/openaiAuth/storage.ts'
      import { shouldUseOpenAICodexAuth } from './src/services/openaiAuth/fetch.ts'
      const expected = ${JSON.stringify(f.tokens)}
      assert.deepEqual(await new EchoFlowOpenAIOAuthService().loadTokens(), expected)
      Object.assign(process.env, buildOpenAIOfficialRuntimeEnv())
      assert.equal(process.env.OPENAI_CODEX_OAUTH_FILE, ${JSON.stringify(target)})
      assert.deepEqual(getOpenAIOAuthTokens(), {
        accessToken: expected.accessToken,
        refreshToken: expected.refreshToken,
        expiresAt: expected.expiresAt,
      })
      assert.equal(shouldUseOpenAICodexAuth(), true)
    `], {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      env: { ...createSandboxedTestEnvironment(f.home), CLAUDE_CONFIG_DIR: root },
      timeout: 10_000,
    })
    await expect(fs.lstat(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(path.dirname(f.file), 'unrelated.json'), 'utf8')).resolves.toBe('keep')
  })

  it.each(['refreshToken', 'expiresAt'] as const)('retains the original when %s is null', async field => {
    const f = await oauthFixture()
    const bytes = JSON.stringify({ ...f.tokens, [field]: null }) + '\n'
    await fs.writeFile(f.file, bytes)
    const confirm = vi.fn(async () => true)

    await expect(f.migration.prepareOpenAiOauth(f.choose, confirm)).rejects.toThrow('Invalid OpenAI sign-in file')

    expect(confirm).not.toHaveBeenCalled()
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
    expect(f.restart).not.toHaveBeenCalled()
    await expect(fs.lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.lstat(path.join(f.source, 'echoflow-code', 'storage-approvals'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(f.file, 'utf8')).resolves.toBe(bytes)
  })

  it('does not stop the desktop or arm a request if file selection or confirmation is cancelled', async () => {
    const f = await oauthFixture()
    const confirm = vi.fn(async () => false)
    await f.migration.prepareOpenAiOauth(async () => null, confirm)
    expect(confirm).not.toHaveBeenCalled()
    await f.migration.prepareOpenAiOauth(f.choose, confirm)
    expect(confirm).toHaveBeenCalledOnce()
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
    expect(f.restart).not.toHaveBeenCalled()
    await expect(fs.lstat(path.join(f.source, 'echoflow-code', 'storage-approvals'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(f.file, 'utf8')).resolves.toBe(f.bytes)
  })

  it('rejects a file replaced while confirmation is open', async () => {
    const f = await oauthFixture()
    const replacement = path.join(path.dirname(f.file), 'replacement')
    await fs.writeFile(replacement, f.bytes)
    await f.migration.prepareOpenAiOauth(f.choose, async () => {
      await fs.rename(replacement, f.file)
      return true
    })
    await f.migration.wait()
    expect(f.migration.status).toMatchObject({ stage: 'failed', error: expect.stringMatching(/changed/) })
    expect(f.hooks.resume).toHaveBeenCalledOnce()
    expect(f.restart).not.toHaveBeenCalled()
    await expect(fs.readFile(f.file, 'utf8')).resolves.toBe(f.bytes)
  })

  it('cancels the approval when restart fails while the desktop still holds its writer lease', async () => {
    const f = await oauthFixture()
    f.restart.mockRejectedValue(new Error('relaunch failed'))
    const lease = await acquireStorageWriter(resolveStorageBinding({ env: f.env }))
    try {
      await f.migration.prepareOpenAiOauth(f.choose, async () => true)
      await f.migration.wait()
      const request = f.restart.mock.calls[0]![1]
      const file = path.join(f.source, 'echoflow-code', 'storage-approvals', `${request.id}.json`)
      expect(JSON.parse(await fs.readFile(file, 'utf8')).state).toBe('cancelled')
      expect(f.migration.status).toMatchObject({ stage: 'failed', error: 'relaunch failed' })
      expect(f.hooks.resume).toHaveBeenCalledOnce()
      await expect(fs.readFile(f.file, 'utf8')).resolves.toBe(f.bytes)
    } finally { await lease.release() }
  })
})

describe('desktop durable cold handoff', () => {
  it.each(['armed', 'validating'])('recovers an interrupted %s move in a fresh process without migration arguments', async phase => {
    const f = await fixture(true)
    await f.start()
    const run = (switches: Record<string, string>, validation: string) => promisify(execFile)('bun', ['--no-env-file', '--eval', `
      import { readFile } from 'node:fs/promises'
      import { join } from 'node:path'
      import { discoverDesktopStorage, initializeDesktopStorage } from './desktop/electron/services/desktopStorageStartup.ts'
      const switches = ${JSON.stringify(switches)}
      const paths = ${JSON.stringify({ home: f.home, userData: f.source, exe: f.app.getPath('exe') })}
      const app = { getPath: name => paths[name], commandLine: { hasSwitch: name => name in switches, getSwitchValue: name => switches[name] ?? '' } }
      const launch = discoverDesktopStorage(app, {}, 'linux', paths.home)
      const hooks = { platform: 'linux', assertQuiescent: async () => {} }
      const admitted = await initializeDesktopStorage(launch, hooks, async binding => {
        if (await readFile(join(paths.userData, 'uploads/session/file.txt'), 'utf8') !== 'attachment bytes') throw new Error('Original missing before acceptance')
        ${validation}
      })
      console.log(admitted.binding.root)
      await admitted.release()
    `], { cwd: path.resolve(import.meta.dirname, '../../..'), env: createSandboxedTestEnvironment(f.home), timeout: 10_000 })
    if (phase === 'validating') {
      const request = f.discover().move!
      await expect(run({ 'user-data-dir': f.target, 'echoflow-move-source': request.source, 'echoflow-move-request': request.id, 'echoflow-move-proof': request.proof }, 'process.exit(73)')).rejects.toMatchObject({ code: 73 })
      expect((await readStorageMigrationStatus(f.binding))?.state).toBe('validation-required')
    }
    const source = { ...resolveStorageBinding({ env: {}, roots: [f.source] }), location: { file: storageLocationFile(f.home) } }
    await expect(acquireStorageWriter(source)).rejects.toThrow('handoff')
    await expect(run({}, '')).resolves.toMatchObject({ stdout: `${f.target}\n` })
    expect(await fs.readFile(path.join(f.target, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
    await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(run({}, 'throw new Error("Accepted validation replayed")')).resolves.toMatchObject({ stdout: `${f.target}\n` })
  })

  it('finds the moved profile from a later launch without migration arguments', async () => {
    const f = await fixture(true)
    const app = { ...f.app, commandLine: { hasSwitch: () => false, getSwitchValue: () => '' } }
    const stale = discoverDesktopStorage(app, {}, 'linux', f.home)
    await f.start()
    await f.cold()
    const launch = discoverDesktopStorage(app, {}, 'linux', f.home)
    const hooks = { platform: 'linux' as const, assertQuiescent: async () => {} }
    await expect(initializeDesktopStorage(stale, hooks, async () => {})).rejects.toThrow('storage directory conflicts')
    await expect(acquireStorageWriter({ ...stale.binding, location: { file: storageLocationFile(f.home) } })).rejects.toThrow('storage directory changed')
    expect(() => discoverDesktopStorage(app, { CLAUDE_CONFIG_DIR: f.source }, 'linux', f.home)).toThrow('Explicit storage root conflicts')
    const env = createSandboxedTestEnvironment(f.home)
    delete env.CLAUDE_CONFIG_DIR
    const { stdout } = await promisify(execFile)('bun', ['--no-env-file', '--eval', `
      import { initializeProcessStorage, releaseProcessStorage } from './src/services/storageStartup.ts'
      import { getEchoFlowConfigDir } from './src/utils/echoFlowConfigRoot.ts'
      await initializeProcessStorage()
      console.log(getEchoFlowConfigDir())
      await releaseProcessStorage()
    `], { cwd: path.resolve(import.meta.dirname, '../../..'), env, timeout: 10_000 })
    expect(stdout.trim()).toBe(f.target)
    expect(launch.binding.root).toBe(f.target)
    const { binding, release } = await initializeDesktopStorage(launch, {
      platform: 'linux', assertQuiescent: async () => {},
    }, async () => { throw new Error('ordinary launch must not validate again') })
    try {
      expect(await fs.readFile(path.join(binding.root, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
      await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await release() }
  })

  it.each(['new directory', 'previous directory'] as const)('recovers a second move to a %s and refuses fallback if the profile goes offline', async destination => {
    const f = await fixture(true)
    await f.start()
    await f.cold()
    const app = { getPath: (name: 'exe' | 'home' | 'userData') => name === 'userData' ? f.target : f.app.getPath(name) }
    const env = { CLAUDE_CONFIG_DIR: f.target }
    const next = destination === 'previous directory' ? f.source : path.join(f.root, 'next profile')
    recordDesktopStorageLaunch(f.binding, { roots: [] }, env)
    const migration = new DataMigration(app, f.hooks, env)
    await migration.start((await migration.prepare(next)).id)
    await migration.wait()
    const request = (f.hooks.restart as MockedFunction<typeof f.hooks.restart>).mock.calls.at(-1)?.[1]!
    const switches: Record<string, string> = { 'user-data-dir': next, 'echoflow-move-source': request.source, 'echoflow-move-request': request.id, 'echoflow-move-proof': request.proof }
    const cold = discoverDesktopStorage({ ...app, commandLine: { hasSwitch: name => name in switches, getSwitchValue: name => switches[name]! } }, {}, 'linux', f.home)
    const hooks = { platform: 'linux' as const, assertQuiescent: async () => {} }
    await expect(initializeDesktopStorage(cold, {
      ...hooks, cleanupResources: async () => { throw new Error('interrupted cleanup') },
    }, async () => {})).rejects.toThrow('interrupted cleanup')
    const ordinary = { ...app, commandLine: { hasSwitch: () => false, getSwitchValue: () => '' } }
    const launch = discoverDesktopStorage(ordinary, {}, 'linux', f.home)
    expect(launch.binding.root).toBe(next)
    const admitted = await initializeDesktopStorage(launch, hooks, async () => { throw new Error('accepted validation must not replay') })
    await admitted.release()
    expect(await fs.readFile(path.join(next, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
    for (const root of [f.source, f.target].filter(root => root !== next)) await expect(fs.lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.rename(next, `${next}-offline`)
    expect(() => discoverDesktopStorage(ordinary, {}, 'linux', f.home)).toThrow('unavailable or was replaced')
    await fs.mkdir(next)
    expect(() => discoverDesktopStorage(ordinary, {}, 'linux', f.home)).toThrow('unavailable or was replaced')
  })

  it('keeps the source protected when publishing the active location fails', async () => {
    const f = await fixture()
    await f.start()
    const file = storageLocationFile(f.home)
    const rename = nativeFs.rename
    let interrupted = false
    vi.spyOn(nativeFs, 'rename').mockImplementation(async (source, target) => {
      await rename(source, target)
      if (interrupted || path.basename(String(target)) !== 'journal.json') return
      const journal = JSON.parse(await fs.readFile(target, 'utf8'))
      if (journal.phase !== 'accepted') return
      interrupted = true
      const database = new DatabaseSync(file)
      try {
        database.exec("UPDATE active_root SET receipt = 'invalid receipt' WHERE id = 1")
      } finally { database.close() }
    })
    syncBuiltinESMExports()
    await expect(f.cold()).rejects.toThrow('JSON')
    expect((await readStorageMigrationStatus(f.binding))?.state).toBe('cleanup-pending')
    expect(await fs.readFile(path.join(f.source, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
    await expect(fs.lstat(f.requestFile())).resolves.toBeDefined()
    const repaired = new DatabaseSync(file)
    try { repaired.exec('UPDATE active_root SET receipt = NULL WHERE id = 1') } finally { repaired.close() }
    await f.cold(async () => { throw new Error('accepted validation must not replay') })
    await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses captured provenance and schedules a durable request without copying live Chromium', async () => {
    const f = await fixture()
    const preview = await f.start()
    expect(f.migration.status?.stage).toBe('restarting')
    expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
    expect(f.hooks.restart).toHaveBeenCalledWith(f.target, expect.objectContaining({ source: f.source, id: preview.id, proof: expect.any(String) }))
    expect(JSON.parse(await fs.readFile(f.requestFile(), 'utf8'))).toMatchObject({ version: 1, source: f.source, target: f.target, state: 'pending' })
    await expect(fs.lstat(path.join(f.target, 'projects/fixture/session.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  })

  it('keeps drained services stopped when arming committed but failed before returning its proof', async () => {
    const f = await fixture()
    const rename = nativeFs.rename
    vi.spyOn(nativeFs, 'rename').mockImplementation(async (source, target) => {
      await rename(source, target)
      if (String(target).includes(`${path.sep}storage-handoffs${path.sep}`) && String(target).endsWith('.json')) throw new Error('post-commit durability failure')
    })
    syncBuiltinESMExports()
    await f.start()
    expect(f.migration.status).toMatchObject({ stage: 'failed', error: expect.stringContaining('keep services stopped') })
    expect(f.hooks.resume).not.toHaveBeenCalled()
    expect(f.hooks.restart).not.toHaveBeenCalled()
    const requests = await fs.readdir(path.join(f.source, 'echoflow-code/storage-handoffs'))
    expect(requests.filter(name => name.endsWith('.json'))).toHaveLength(1)
    await expect(acquireStorageWriter(resolveStorageBinding({ env: {}, roots: [f.source] }))).rejects.toThrow('handoff')
  })

  it('retains originals until cold validation and acceptance, including data the old copier skipped', async () => {
    const f = await fixture()
    await f.put('cc-haha/db/scheduled-runs-v1.sqlite', 'opaque receipt fixture')
    await f.put('.runtime/requirements.sha256', 'dependency stamp')
    await fs.writeFile(path.join(f.home, '.claude.json'), 'shared user sentinel')
    const preview = await f.migration.prepare(f.target)
    expect(preview).toMatchObject({ sourceDir: f.source, targetDir: f.target, activeTasks: 2 })
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
    await expect(fs.lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.migration.start(preview.id)
    await f.migration.wait()
    await f.publish()
    expect(await fs.readFile(path.join(f.source, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
    expect(await fs.readFile(path.join(f.target, 'echoflow-code/db/scheduled-runs-v1.sqlite'), 'utf8')).toBe('opaque receipt fixture')
    expect(await fs.readFile(path.join(f.target, '.runtime/requirements.sha256'), 'utf8')).toBe('dependency stamp')
    expect((await readStorageMigrationStatus(f.binding))?.state).toBe('validation-required')
    await expect(acquireStorageWriter(f.binding)).rejects.toThrow('validation-required')
    await f.cold(async selected => {
      expect(selected.root).toBe(f.target)
      expect(await fs.readFile(path.join(f.source, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
    })
    await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await f.cold(async () => { throw new Error('must not replay accepted validation') })).toMatchObject({ root: f.target })
    expect(await fs.readFile(path.join(f.home, '.claude.json'), 'utf8')).toBe('shared user sentinel')
    expect(await fs.readFile(resolveRelocatedAttachmentPath(path.join(f.source, 'uploads/session/file.txt'), f.target), 'utf8')).toBe('attachment bytes')
    expect(f.hooks.resume).not.toHaveBeenCalled()
  })

  it('recovers accepted teardown after source coordination directories were already removed without recreating them', async () => {
    const f = await fixture()
    await f.start()
    const directory = path.join(f.source, 'echoflow-code/migrations')
    const rmdir = nativeFs.rmdir
    let interrupted = false
    vi.spyOn(nativeFs, 'rmdir').mockImplementation(async selected => {
      await rmdir(selected)
      if (!interrupted && String(selected) === directory) {
        interrupted = true
        throw new Error('crash after removing source coordination directory')
      }
    })
    syncBuiltinESMExports()
    await expect(f.cold()).rejects.toThrow('crash after removing source coordination directory')
    expect((await readStorageMigrationStatus(f.binding))?.state).toBe('cleanup-pending')
    await expect(fs.lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.cold(async () => { throw new Error('accepted validation must not replay') })
    await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(f.target, 'uploads/session/file.txt'), 'utf8')).toBe('attachment bytes')
  })

  it('admits completed handoff reentry alongside a normal target writer without maintenance quiescence', async () => {
    const f = await fixture()
    await f.start()
    await f.cold()
    const lease = await acquireStorageWriter(f.binding)
    try {
      (f.hooks.assertQuiescent as MockedFunction<NonNullable<DataMigrationHooks['assertQuiescent']>>).mockClear().mockRejectedValue(new Error('normal target writer is live'))
      await f.cold(async () => { throw new Error('completed validation must not replay') })
      expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
      expect(await fs.readdir(path.join(f.binding.internalDir, 'migrations/writers'))).toHaveLength(1)
    } finally { await lease.release() }
  })

  it('allows an owned nonempty destination without overwriting existing entities', async () => {
    const f = await fixture()
    await fs.mkdir(path.join(f.target, 'projects'), { recursive: true })
    await fs.writeFile(path.join(f.target, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
    await fs.writeFile(path.join(f.target, 'projects/other.jsonl'), 'independent transcript')
    await f.start()
    await f.cold()
    expect(await fs.readFile(path.join(f.target, 'projects/other.jsonl'), 'utf8')).toBe('independent transcript')
  })

  it('rejects unproven, overlapping, install-contained and genuinely launch-controlled selections', async () => {
    const f = await fixture()
    await fs.mkdir(f.target)
    await fs.writeFile(path.join(f.target, 'keep'), 'foreign data')
    await expect(f.migration.prepare(f.target)).rejects.toThrow()
    for (const target of [f.source, path.join(f.source, 'nested')]) await expect(f.migration.prepare(target)).rejects.toThrow('overlaps')
    for (const target of [path.dirname(f.source), path.join(f.home, '.claude'), path.join(f.home, '.claude', 'nested')]) await expect(f.migration.prepare(target)).rejects.toThrow('Protected shared storage')
    await expect(f.migration.prepare(path.join(f.root, 'install/data'))).rejects.toThrow('install')
    for (const flag of ['CC_HAHA_APP_PORTABLE_DIR', 'ECHOFLOW_APP_PORTABLE_DIR']) {
      await expect(new DataMigration(f.app, f.hooks, { CLAUDE_CONFIG_DIR: f.source, [flag]: '1' }).prepare(f.target)).rejects.toThrow('launch environment')
    }
    recordDesktopStorageLaunch(resolveStorageBinding({ env: {}, roots: [f.source] }), { roots: [f.source] }, f.env)
    await expect(f.migration.prepare(f.target)).rejects.toThrow('launch environment')
    expect(await fs.readFile(path.join(f.target, 'keep'), 'utf8')).toBe('foreign data')
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
  })

  it('does not replace stopped source coordination carrying unknown material', async () => {
    const f = await fixture()
    await f.start()
    const lock = path.join(f.source, 'echoflow-code/migrations/lock.json')
    await fs.mkdir(path.dirname(lock), { recursive: true })
    const raw = JSON.stringify({ version: 1, host: os.hostname(), pid: 1234, token: 'legacy', future: 'must survive' })
    await fs.writeFile(lock, raw)
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('stopped fixture'), { code: 'ESRCH' }) })
    await expect(f.cold()).rejects.toThrow('Unknown storage process receipt')
    expect(await fs.readFile(lock, 'utf8')).toBe(raw)
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  })

  it('retains the live host lease and blocks cold copying until every source writer exits', async () => {
    const f = await fixture()
    const lease = await acquireStorageWriter(resolveStorageBinding({ env: {}, roots: [f.source] }))
    try {
      await f.start()
      const writers = path.join(f.source, 'echoflow-code/migrations/writers')
      const before = await fs.readdir(writers)
      await expect(f.cold()).rejects.toThrow('Active storage writer')
      expect(await fs.readdir(writers)).toEqual(before)
      expect(await readStorageMigrationStatus(f.binding)).toBeNull()
    } finally { await lease.release() }
    await f.cold()
  })

  it('waits for an actual old-host process exit without deleting its live writer receipt', async () => {
    const f = await fixture()
    const writers = path.join(f.source, 'echoflow-code/migrations/writers')
    const child = spawn(process.execPath, ['-e', `
      const fs = require('node:fs')
      const { randomUUID } = require('node:crypto')
      const writers = process.argv[1]
      const name = process.pid + '-' + randomUUID() + '.json'
      fs.mkdirSync(writers, { recursive: true })
      fs.writeFileSync(require('node:path').join(writers, name), JSON.stringify({
        version: 1, host: require('node:os').hostname(), pid: process.pid, token: randomUUID(),
      }))
      process.send(name)
      process.on('message', () => process.exit(0))
    `, writers], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    try {
      const [name] = await once(child, 'message')
      const file = path.join(writers, name)
      await f.start()
      const before = await fs.readFile(file, 'utf8')
      await expect(f.cold()).rejects.toThrow('Active storage writer')
      expect(await fs.readFile(file, 'utf8')).toBe(before)
      const exited = once(child, 'exit')
      child.send('exit')
      await exited
      await f.cold()
      expect(await fs.readFile(path.join(f.target, 'projects/fixture/session.jsonl'), 'utf8')).toContain('hello')
    } finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } }
  })

  it('requires genuine cold quiescence in addition to zero tasks and writer receipts', async () => {
    const f = await fixture()
    await f.start()
    delete f.hooks.assertQuiescent
    await expect(f.cold()).rejects.toThrow('quiescence')
    expect(await fs.readFile(path.join(f.source, 'echoflow-code/settings.json'), 'utf8')).toContain('preserve')
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  })

  it('blocks external writers and insufficient space before stopping work', async () => {
    const f = await fixture()
    f.hooks.preview = async () => ({ activeTasks: 0, externalProcesses: 1 })
    await expect(f.migration.prepare(f.target)).rejects.toThrow('Another process')
    f.hooks.preview = async () => ({ activeTasks: 0, externalProcesses: 0 })
    vi.spyOn(nativeFs, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as never)
    syncBuiltinESMExports()
    await expect(f.migration.prepare(f.target)).rejects.toThrow('Not enough free space')
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
    await expect(fs.lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['source', 'target'] as const)('rejects a replaced %s after preview without touching replacement data', async selected => {
    const f = await fixture()
    await fs.mkdir(f.target)
    const preview = await f.migration.prepare(f.target)
    await fs.rename(f[selected], `${f[selected]}-original`)
    await fs.mkdir(f[selected])
    await fs.writeFile(path.join(f[selected], 'keep'), 'replacement must survive')
    await f.migration.start(preview.id)
    await f.migration.wait()
    expect(f.migration.status).toMatchObject({ stage: 'failed', error: expect.stringContaining('replaced') })
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(f[selected], 'keep'), 'utf8')).toBe('replacement must survive')
  })

  it.each(['source', 'target', 'new-target'] as const)('rechecks %s identity after draining the host', async selected => {
    const f = await fixture()
    if (selected === 'target') await fs.mkdir(f.target)
    const preview = await f.migration.prepare(f.target)
    f.hooks.quiesce = async () => {
      const directory = selected === 'source' ? f.source : f.target
      if (selected !== 'new-target') await fs.rename(directory, `${directory}-original`)
      await fs.mkdir(directory)
      await fs.writeFile(path.join(directory, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
      await fs.writeFile(path.join(directory, 'keep'), 'replacement must survive')
    }
    await f.migration.start(preview.id)
    await f.migration.wait()
    expect(f.migration.status).toMatchObject({ stage: 'failed', error: expect.stringMatching(/replaced|appeared/) })
    expect(f.hooks.restart).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(selected === 'source' ? f.source : f.target, 'keep'), 'utf8')).toBe('replacement must survive')
  })

  it('cancels before quiescing and resumes safely when draining itself fails', async () => {
    const f = await fixture()
    const preview = await f.migration.prepare(f.target)
    await f.migration.start(preview.id)
    f.migration.cancelActive()
    await f.migration.wait()
    expect(f.migration.status?.stage).toBe('cancelled')
    expect(f.hooks.quiesce).not.toHaveBeenCalled()
    f.hooks.quiesce = async () => { throw new Error('process did not exit') }
    await f.start()
    expect(f.migration.status).toMatchObject({ stage: 'failed', error: 'process did not exit' })
    expect(f.hooks.resume).toHaveBeenCalledOnce()
    await expect(fs.lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('durably cancels a failed relaunch before resuming the original services', async () => {
    const f = await fixture()
    let file = ''
    f.hooks.restart = vi.fn((_root, request) => { file = path.join(f.source, 'echoflow-code/storage-handoffs', `${request!.id}.json`); throw new Error('relaunch failed') })
    f.hooks.resume = vi.fn(async () => { expect(JSON.parse(await fs.readFile(file, 'utf8')).state).toBe('cancelled') })
    await f.start()
    expect(f.migration.status).toMatchObject({ stage: 'failed', error: 'relaunch failed' })
    expect(f.hooks.resume).toHaveBeenCalledOnce()
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
    await expect(f.migration.prepare(f.target)).resolves.toMatchObject({ targetDir: f.target })
  })

  it.each(['ENOSPC', 'EACCES', 'EBUSY'])('keeps sources and a blocked cold receipt on %s, then rolls forward without replaying the UI handoff', async code => {
    const f = await fixture()
    await f.start()
    const link = fs.link
    const spy = vi.spyOn(nativeFs, 'link').mockImplementation(async (source, target) => {
      if (String(target) === path.join(f.target, 'projects/fixture/session.jsonl')) throw Object.assign(new Error(`Publication ${code}`), { code })
      return link(source, target)
    })
    syncBuiltinESMExports()
    await expect(f.cold()).rejects.toThrow(code)
    expect((await readStorageMigrationStatus(f.binding))?.state).toBe('blocked')
    expect(f.hooks.resume).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(f.source, 'projects/fixture/session.jsonl'), 'utf8')).toContain('hello')
    spy.mockRestore()
    syncBuiltinESMExports()
    await f.cold()
    expect(f.hooks.restart).toHaveBeenCalledOnce()
  })

  it('fails closed on corrupt published data and never returns to the source writer', async () => {
    const f = await fixture()
    await f.start()
    await f.publish()
    await fs.writeFile(path.join(f.target, 'echoflow-code/settings.json'), '{"tampered":true}')
    await expect(f.cold()).rejects.toThrow('changed')
    expect(f.hooks.resume).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(f.source, 'echoflow-code/settings.json'), 'utf8')).toContain('preserve')
  })

  it('recovers fake keychain interruption and retires only verified root-hashed credentials after acceptance', async () => {
    const f = await fixture()
    f.hooks.platform = 'darwin'
    const suffix = (root: string) => '-' + createHash('sha256').update(root.normalize('NFC')).digest('hex').slice(0, 8)
    const oldService = 'Claude Code-credentials' + suffix(f.source)
    const newService = 'Claude Code-credentials' + suffix(f.target)
    const values = new Map([[oldService, 'fake-owned-token'], ['Claude Code-credentials', 'shared-sentinel']])
    let interrupted = false
    f.hooks.credentialStore = {
      async read(key) { return values.get(key) ?? null },
      async write(key, value) { values.set(key, value); if (!interrupted) { interrupted = true; throw new Error('interrupted keychain write') } },
      async remove(key) { values.delete(key) },
    }
    await f.start()
    expect(values.has(newService)).toBe(false)
    await expect(f.cold()).rejects.toThrow('interrupted keychain write')
    expect(values.get(oldService)).toBe('fake-owned-token')
    await f.cold()
    expect(values.has(oldService)).toBe(false)
    expect(values.get(newService)).toBe('fake-owned-token')
    expect(values.get('Claude Code-credentials')).toBe('shared-sentinel')
  })

  it.each(['source', 'target', 'request'] as const)('rejects replaced %s evidence between the live request and cold admission', async selected => {
    const f = await fixture()
    await f.start()
    const original = selected === 'request' ? f.requestFile() : f[selected]
    await fs.rename(original, `${original}-original`)
    if (selected === 'request') await fs.copyFile(`${original}-original`, original)
    else {
      await fs.mkdir(original)
      if (selected === 'source') await fs.cp(path.join(`${original}-original`, 'echoflow-code/storage-handoffs'), path.join(original, 'echoflow-code/storage-handoffs'), { recursive: true })
    }
    await expect(f.cold()).rejects.toThrow(/replaced|changed/)
    expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  })

  it('blocks an ordinary source launch while a durable request is pending', async () => {
    const f = await fixture()
    await f.start()
    const launch = { binding: resolveStorageBinding({ env: {}, roots: [f.source] }), sources: [], issues: [] }
    await expect(initializeDesktopStorage(launch, { assertQuiescent: async () => {} }, async () => {})).rejects.toThrow('Pending desktop move')
    await expect(f.migration.prepare(f.target)).rejects.toThrow('Pending desktop move')
    expect(await fs.readFile(path.join(f.source, 'echoflow-code/settings.json'), 'utf8')).toContain('preserve')
  })

  it.each(['CLAUDE_CONFIG_DIR', 'ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG', 'WEBVIEW2_USER_DATA_FOLDER', 'disk-cache-dir', 'media-cache-dir'])('rejects genuine %s conflicts before cold side effects', async control => {
    const f = await fixture()
    await f.start()
    const launch = control.includes('-') ? f.discover({}, { [control]: path.join(f.source, 'outside') }) : (() => {
      if (control === 'CLAUDE_CONFIG_DIR') {
        expect(() => f.discover({ [control]: f.source })).toThrow('Conflicting')
        return null
      }
      return f.discover({ [control]: path.join(f.source, 'outside') })
    })()
    if (launch) await expect(initializeDesktopStorage(launch, { assertQuiescent: f.hooks.assertQuiescent! }, async () => {})).rejects.toThrow('conflicts')
    expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  })

  it('keeps unknown request fields and re-enters accepted target evidence without touching newer data', async () => {
    const f = await fixture()
    await f.start()
    const launch = f.discover()
    const file = f.requestFile()
    const bytes = JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf8')), future: { preserved: [1, 2] } }) + '\n'
    await fs.writeFile(file, bytes)
    const stat = await fs.lstat(file, { bigint: true })
    launch.move!.proof = `${createHash('sha256').update(bytes).digest('hex')}:${stat.dev}:${stat.ino}`
    const hooks: StorageMigrationHooks = { assertQuiescent: async () => {}, platform: 'linux' }
    const admitted = await initializeDesktopStorage(launch, hooks, async () => {})
    await admitted.release()
    const history = path.join(f.binding.internalDir, 'migration-history')
    const archived = (await fs.readdir(history, { recursive: true })).filter(name => path.basename(name) === path.basename(file))
    expect(archived).toHaveLength(1)
    expect(await fs.readFile(path.join(history, archived[0]!), 'utf8')).toBe(bytes)
    await expect(fs.lstat(path.join(f.target, path.relative(f.source, file)))).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.writeFile(path.join(f.target, 'projects/fixture/session.jsonl'), 'newer accepted data')
    const again = await initializeDesktopStorage(launch, hooks, async () => { throw new Error('accepted validation replayed') })
    await again.release()
    expect(again.binding.root).toBe(f.target)
    expect(await fs.readFile(path.join(f.target, 'projects/fixture/session.jsonl'), 'utf8')).toBe('newer accepted data')
    await expect(fs.lstat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never hides a retired-root fork when accepted request parameters re-enter', async () => {
    const f = await fixture()
    await f.start()
    await f.cold()
    await fs.mkdir(f.source)
    await fs.writeFile(path.join(f.source, 'settings.json'), 'late writer')
    await expect(f.cold()).rejects.toThrow('old writer')
    expect(await fs.readFile(path.join(f.source, 'settings.json'), 'utf8')).toBe('late writer')
    expect(f.hooks.resume).not.toHaveBeenCalled()
  })
})
