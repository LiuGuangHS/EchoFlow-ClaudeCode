import * as fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataMigration, MIGRATION_JOURNAL_FILE, type DataMigrationHooks } from './dataMigration'
import type { AppModeAppLike } from './appMode'
import { buildEchoFlowOwnershipMarker } from '../../../src/utils/echoFlowConfigRoot'
import { cleanupLegacyDataMigrationRecovery, inspectLegacyDataMigrationRecovery } from './dataMigrationLegacyRecovery'
import { assertMigrationManifest, migrationDirectoryIdentity, migrationManifest, validateMigrationManifest } from './dataMigrationFiles'

const roots: string[] = []
async function fixture() {
  // macOS hands out a temp directory behind the /var -> /private/var link, and
  // migration refuses linked paths. Start from the real path, as Linux CI does.
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'haha-migration-'))
  roots.push(root)
  const home = path.join(root, 'home')
  const source = path.join(home, '.claude')
  const target = path.join(root, '新数据 directory')
  const userData = path.join(root, 'profile')
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(path.join(root, 'install'), { recursive: true })
  const app: AppModeAppLike = { getPath(name) { return name === 'home' ? home : name === 'userData' ? userData : path.join(root, 'install', 'haha.exe') } }
  const hooks: DataMigrationHooks = { preview: vi.fn(async () => ({ activeTasks: 2, externalProcesses: 0 })), quiesce: vi.fn(async () => {}), resume: vi.fn(async () => {}), restart: vi.fn(), progress: vi.fn(), platform: 'win32', permissions: { restrictStaging: vi.fn(async () => {}), preflight: vi.fn(async () => {}), preserve: vi.fn(async () => {}) } }
  const put = async (relative: string, value: string) => {
    const file = path.join(source, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, value)
  }
  await put('settings.json', '{"unknown":{"preserve":true}}')
  await put('projects/fixture/session.jsonl', '{"type":"user","message":"hello"}\n')
  await put('uploads/session/file.txt', 'attachment bytes')
  await fs.writeFile(path.join(home, '.claude.json'), '{"trustedProjects":{"x":true},"unknown":7}')
  return { root, home, source, target, userData, app, hooks, put, migration: new DataMigration(app, hooks, {}) }
}

afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function restartingFixture() {
  const f = await fixture()
  await f.put('app.json', JSON.stringify(buildEchoFlowOwnershipMarker()))
  await fs.cp(f.source, f.target, { recursive: true })
  await fs.mkdir(f.userData)
  const id = 'released-restarting'
  const receipt = JSON.stringify({ version: 1, status: { id, sourceDir: f.source, targetDir: f.target, stage: 'restarting', cancellable: false }, stagingDir: path.join(f.target, `.cc-haha-migration-${id}`), oldMode: '{"mode":"default","unknown":42}', manifest: await migrationManifest(f.target), createdCredentials: [], credentials: [], unknown: { preserve: true } })
  const pointer = JSON.stringify({ mode: 'portable', portable_dir: f.target, unknown: 73 })
  await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), receipt)
  await fs.writeFile(path.join(f.userData, 'app-mode.json'), pointer)
  return { ...f, receipt, pointer }
}

describe('released v1 migration recovery fixtures', () => {
  it('cold-relaunches a verified restarting target without switching the live root or restoring its old pointer', async () => {
    const f = await restartingFixture()
    expect(await f.migration.recover()).toBe('restart')
    expect(f.hooks.restart).toHaveBeenCalledTimes(1)
    expect(f.hooks.restart).toHaveBeenCalledWith(f.target)
    expect(f.migration.status?.stage).toBe('restarting')
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(f.receipt)
    expect(await fs.readFile(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(f.pointer)
    expect(await fs.readFile(path.join(f.source, 'settings.json'), 'utf8')).toContain('preserve')
    expect(f.hooks.resume).not.toHaveBeenCalled()
  })

  it('provides read-only cold discovery with the original receipt and a protected shared source', async () => {
    const f = await restartingFixture()
    const plan = await inspectLegacyDataMigrationRecovery(f.userData, { homeDir: f.home, platform: 'win32' })
    expect(plan).toMatchObject({ requiredRoot: f.target, selectedDirectory: f.target, protectedSources: [f.source], rawJournal: f.receipt })
    expect(await fs.readFile(plan!.journalPath, 'utf8')).toBe(f.receipt)
    expect(f.hooks.restart).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(f.home, '.claude.json'), 'utf8')).toContain('trustedProjects')
  })

  it('validates only after a cold launch selected the complete target for both host and runtime', async () => {
    const f = await restartingFixture()
    await expect(f.migration.completeValidation()).rejects.toThrow('cold root')
    await fs.copyFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), path.join(f.target, MIGRATION_JOURNAL_FILE))
    const app: AppModeAppLike = { getPath: name => name === 'userData' ? f.target : f.app.getPath(name) }
    const env = { CLAUDE_CONFIG_DIR: f.target }
    const launched = new DataMigration(app, f.hooks, env)
    expect(await launched.recover()).toBe('validate')
    expect(f.hooks.restart).not.toHaveBeenCalled()
    await launched.completeValidation()
    expect(launched.status?.stage).toBe('completed')
    expect(JSON.parse(await fs.readFile(path.join(f.target, MIGRATION_JOURNAL_FILE), 'utf8'))).toMatchObject({ unknown: { preserve: true }, status: { stage: 'completed' } })
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(f.receipt)
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: f.target })
  })

  it.each(['changed-data', 'failed-relaunch', 'failed-validation'] as const)('blocks %s without restoring the old pointer or erasing a restarting receipt', async failure => {
    const f = await restartingFixture()
    if (failure === 'changed-data') await fs.writeFile(path.join(f.target, 'settings.json'), 'changed')
    if (failure === 'failed-relaunch') f.hooks.restart = vi.fn(() => { throw new Error('relaunch unavailable') })
    if (failure === 'failed-validation') {
      await f.migration.recover()
      await expect(f.migration.failValidation(new Error('startup failed'))).rejects.toThrow('startup failed')
    } else await expect(f.migration.recover()).rejects.toThrow(failure === 'changed-data' ? 'changed' : 'relaunch unavailable')
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(f.receipt)
    expect(await fs.readFile(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(f.pointer)
    expect(f.hooks.resume).not.toHaveBeenCalled()
  })

  it('blocks a replaced restarting target even if all copied bytes still match', async () => {
    const f = await restartingFixture()
    const journal = JSON.parse(f.receipt)
    journal.directories = { source: await migrationDirectoryIdentity(f.source), target: await migrationDirectoryIdentity(f.target) }
    const raw = JSON.stringify(journal)
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), raw)
    await fs.rename(f.target, `${f.target}-original`)
    await fs.cp(`${f.target}-original`, f.target, { recursive: true })
    await expect(f.migration.recover()).rejects.toThrow('replaced')
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(raw)
    expect(f.hooks.restart).not.toHaveBeenCalled()
  })

  it('verifies restarting credentials through the injected store without deleting any shared service', async () => {
    const f = await restartingFixture()
    const service = 'Claude Code-credentials-' + createHash('sha256').update(f.target.normalize('NFC')).digest('hex').slice(0, 8)
    const value = 'fake-fixture-credential'
    const journal = JSON.parse(f.receipt)
    journal.credentials = [{ service, digest: createHash('sha256').update(value).digest('hex') }]
    const raw = JSON.stringify(journal)
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), raw)
    const read = vi.fn(async () => value)
    const remove = vi.fn(async () => {})
    f.hooks.platform = 'darwin'
    f.hooks.credentialStore = { read, write: vi.fn(), remove }
    expect(await f.migration.recover()).toBe('restart')
    expect(read).toHaveBeenCalledWith(service)
    read.mockResolvedValue('changed-fixture-credential')
    await expect(f.migration.recover()).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(raw)
    expect(await fs.readFile(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(f.pointer)
  })

  it.skipIf(process.platform === 'darwin').each(['restarting', 'copying'] as const)('blocks %s credential access when distinct v1 roots share a namespace', async stage => {
    const f = await restartingFixture()
    const sourceDir = path.join(f.root, 'café')
    const targetDir = path.join(f.root, 'café')
    await fs.rename(f.source, sourceDir)
    await fs.rename(f.target, targetDir)
    const journal = JSON.parse(f.receipt)
    Object.assign(journal.status, { sourceDir, targetDir, stage })
    journal.stagingDir = path.join(targetDir, path.basename(journal.stagingDir))
    const service = 'Claude Code-credentials-' + createHash('sha256').update(targetDir.normalize('NFC')).digest('hex').slice(0, 8)
    const value = 'fake-fixture-credential'
    journal.credentials = journal.createdCredentials = [{ service, digest: createHash('sha256').update(value).digest('hex') }]
    const raw = JSON.stringify(journal, null, 2) + '\n'
    const file = path.join(f.userData, MIGRATION_JOURNAL_FILE)
    await fs.writeFile(file, raw)
    const credentialStore = { read: vi.fn(async () => value), write: vi.fn(), remove: vi.fn() }
    const options = { homeDir: f.home, platform: 'darwin' as const, credentialStore }
    await expect(inspectLegacyDataMigrationRecovery(f.userData, options)).rejects.toThrow('same macOS Keychain namespace')
    if (stage === 'copying') {
      // Cleanup can receive a plan inspected before the platform store is selected.
      const plan = await inspectLegacyDataMigrationRecovery(f.userData, { ...options, platform: 'linux' })
      await expect(cleanupLegacyDataMigrationRecovery(plan!, async () => {}, options)).rejects.toThrow('same macOS Keychain namespace')
    }
    expect(credentialStore.read).not.toHaveBeenCalled()
    expect(credentialStore.write).not.toHaveBeenCalled()
    expect(credentialStore.remove).not.toHaveBeenCalled()
    expect(await fs.readFile(file, 'utf8')).toBe(raw)
    expect(await fs.readFile(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(f.pointer)
  })

  it('rolls back a v1 credential receipt with absent staging and retains the original bytes', async () => {
    const f = await restartingFixture()
    const journal = JSON.parse(f.receipt)
    journal.status.stage = 'copying'
    const service = 'Claude Code-credentials-' + createHash('sha256').update(f.target.normalize('NFC')).digest('hex').slice(0, 8)
    const value = 'fake-fixture-credential'
    journal.createdCredentials = [{ service, digest: createHash('sha256').update(value).digest('hex') }]
    const raw = JSON.stringify(journal, null, 2) + '\n'
    const file = path.join(f.userData, MIGRATION_JOURNAL_FILE)
    await fs.writeFile(file, raw)
    const values = new Map([[service, value], ['Claude Code-credentials', 'shared-sentinel']])
    const credentialStore = {
      read: vi.fn(async (name: string) => values.get(name) ?? null), write: vi.fn(),
      remove: vi.fn(async (name: string) => { values.delete(name) }),
    }
    const options = { homeDir: f.home, platform: 'darwin' as const, credentialStore }
    const plan = await inspectLegacyDataMigrationRecovery(f.userData, options)
    expect(plan?.rawJournal).toBe(raw)
    await cleanupLegacyDataMigrationRecovery(plan!, async () => {}, options)
    expect(credentialStore.remove).toHaveBeenCalledTimes(1)
    expect(credentialStore.remove).toHaveBeenCalledWith(service)
    expect(values).toEqual(new Map([['Claude Code-credentials', 'shared-sentinel']]))
    expect(await fs.readFile(file, 'utf8')).toBe(raw)
  })

  it('describes an unmarked v1 target as protected instead of claiming an arbitrary directory', async () => {
    const f = await restartingFixture()
    await fs.rm(path.join(f.target, 'app.json'))
    const journal = JSON.parse(f.receipt)
    journal.manifest = await migrationManifest(f.target)
    const raw = JSON.stringify(journal)
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), raw)
    const plan = await inspectLegacyDataMigrationRecovery(f.userData, { homeDir: f.home, platform: 'win32' })
    expect(plan).toMatchObject({ requiredRoot: null, selectedDirectory: f.target, protectedSources: [f.source, f.target], rawJournal: raw })
    await expect(f.migration.recover()).rejects.toThrow('ownership-scoped cold import')
    expect(f.hooks.restart).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(raw)
  })

  it('never promotes the shared Claude root even when it contains a valid product marker', async () => {
    const f = await restartingFixture()
    const source = path.join(f.root, 'previous-private-root')
    await fs.cp(f.source, source, { recursive: true })
    const journal = JSON.parse(f.receipt)
    journal.status.sourceDir = source
    journal.status.targetDir = f.source
    journal.stagingDir = path.join(f.source, `.cc-haha-migration-${journal.status.id}`)
    journal.manifest = await migrationManifest(f.source)
    const raw = JSON.stringify(journal)
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), raw)
    const plan = await inspectLegacyDataMigrationRecovery(f.userData, { homeDir: f.home })
    expect(plan).toMatchObject({ requiredRoot: null, selectedDirectory: f.source, protectedSources: [f.source] })
    await expect(f.migration.recover()).rejects.toThrow('ownership-scoped cold import')
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(raw)
    expect(f.hooks.restart).not.toHaveBeenCalled()
  })

  it('blocks future receipts and future ownership markers without mutating user state', async () => {
    const f = await restartingFixture()
    const raw = JSON.stringify({ ...JSON.parse(f.receipt), version: 2 })
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), raw)
    await expect(inspectLegacyDataMigrationRecovery(f.userData, { homeDir: f.home })).rejects.toThrow('Unsupported')
    expect(await fs.readFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), 'utf8')).toBe(raw)
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), f.receipt)
    await fs.writeFile(path.join(f.source, 'app.json'), JSON.stringify({ ...buildEchoFlowOwnershipMarker(), schemaVersion: 2 }))
    await expect(f.migration.recover()).rejects.toThrow('future')
    expect(await fs.readFile(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(f.pointer)
  })

  it('upgrades a v1 interrupted journal and removes only its private staging directory', async () => {
    const f = await fixture()
    await fs.mkdir(f.target)
    const id = 'fixture-id'
    const stagingDir = path.join(f.target, `.cc-haha-migration-${id}`)
    await fs.mkdir(stagingDir)
    await fs.writeFile(path.join(stagingDir, 'partial'), 'partial')
    await fs.writeFile(path.join(f.target, 'unrelated'), 'must survive')
    await fs.mkdir(f.userData)
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), JSON.stringify({ version: 1, status: { id, sourceDir: f.source, targetDir: f.target, stage: 'copying', cancellable: true }, stagingDir, oldMode: '{"mode":"default","unknown":42}', manifest: [], createdCredentials: [], credentials: [] }))
    await expect(f.migration.recover()).rejects.toThrow('cold host quiescence')
    expect(await fs.readFile(path.join(stagingDir, 'partial'), 'utf8')).toBe('partial')
    await expect(fs.lstat(path.join(f.userData, 'app-mode.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    f.hooks.assertQuiescent = vi.fn(async () => {})
    expect(await f.migration.recover()).toBe('normal')
    expect(f.hooks.assertQuiescent).toHaveBeenCalledWith([f.userData, f.source, f.target])
    expect(f.migration.status?.stage).toBe('failed')
    expect(await fs.readFile(path.join(f.target, 'unrelated'), 'utf8')).toBe('must survive')
    expect(await fs.readFile(path.join(f.userData, 'app-mode.json'), 'utf8')).toContain('"unknown":42')
    await expect(fs.stat(stagingDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects hostile recovery records before restoring settings or deleting any directory', async () => {
    const f = await fixture()
    await fs.mkdir(f.target)
    await fs.mkdir(f.userData)
    const id = 'safe-id'
    const stagingDir = path.join(f.target, `.cc-haha-migration-${id}`)
    await fs.mkdir(stagingDir)
    await fs.writeFile(path.join(stagingDir, 'keep'), 'protected transaction')
    const journal = { version: 1, status: { id, sourceDir: f.source, targetDir: f.target, stage: 'copying', cancellable: true }, stagingDir, oldMode: '{"mode":"default"}', manifest: [], createdCredentials: [], credentials: [] }
    const digest = 'a'.repeat(64)
    const hostile = [
      { ...journal, stagingDir: f.target },
      { ...journal, stagingDir: f.source },
      { ...journal, status: { ...journal.status, id: '../escape' } },
      { ...journal, status: { ...journal.status, stage: 'unknown' } },
      { ...journal, status: { ...journal.status, sourceDir: path.dirname(f.target) } },
      { ...journal, manifest: [{ relative: '../settings.json', kind: 'file', digest }] },
      { ...journal, manifest: [{ relative: '..\\settings.json', kind: 'file', digest }] },
      { ...journal, manifest: [{ relative: f.source, kind: 'directory' }] },
      { ...journal, manifest: [{ relative: 'settings.json', kind: 'unexpected' }] },
      { ...journal, createdCredentials: [{ service: 'Claude Code', digest }] },
      { ...journal, oldMode: '[]' },
    ]
    for (const entry of hostile) {
      await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), JSON.stringify(entry))
      const recovery = new DataMigration(f.app, f.hooks, {})
      await expect(recovery.recover()).rejects.toThrow()
      expect(await fs.readFile(path.join(stagingDir, 'keep'), 'utf8')).toBe('protected transaction')
      await expect(fs.stat(path.join(f.userData, 'app-mode.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(await fs.readFile(path.join(f.source, 'settings.json'), 'utf8')).toContain('preserve')
  })

  it('rejects a legacy recovery target whose canonical path overlaps the source', async () => {
    const f = await fixture()
    await fs.symlink(f.source, f.target, 'junction')
    await fs.mkdir(f.userData)
    const id = 'safe-id'
    await fs.writeFile(path.join(f.source, 'keep'), 'source must survive')
    await fs.writeFile(path.join(f.userData, MIGRATION_JOURNAL_FILE), JSON.stringify({ version: 1, status: { id, sourceDir: f.source, targetDir: f.target, stage: 'copying' }, stagingDir: path.join(f.target, `.cc-haha-migration-${id}`), oldMode: null, manifest: [], credentials: [], createdCredentials: [] }))
    await expect(f.migration.recover()).rejects.toThrow('overlap')
    expect(await fs.readFile(path.join(f.source, 'keep'), 'utf8')).toBe('source must survive')
  })

  it('rejects a parent junction replacement even when manifest file bytes match', async () => {
    const f = await fixture()
    const manifest = await migrationManifest(f.source)
    const original = path.join(f.source, 'uploads')
    const outside = path.join(f.root, 'same-bytes')
    await fs.rename(original, outside)
    await fs.symlink(outside, original, 'junction')
    await expect(validateMigrationManifest(f.source, manifest)).rejects.toThrow()
    await expect(validateMigrationManifest(f.source, [{ relative: 'uploads/session/file.txt', kind: 'file', digest: manifest.find(file => file.relative === path.join('uploads', 'session', 'file.txt'))!.digest }])).rejects.toThrow('parent')
    expect(await fs.readFile(path.join(outside, 'session/file.txt'), 'utf8')).toBe('attachment bytes')
    expect(() => assertMigrationManifest([{ relative: 'a', kind: 'file' }])).toThrow()
  })
})
