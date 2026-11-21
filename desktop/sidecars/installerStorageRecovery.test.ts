import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../src/utils/echoFlowConfigRoot'
import { acquireStorageWriter, armStorageHandoff, legacyStorageArchive, prepareStorageHandoff, prepareStorageMigration, readStorageHandoff, readStorageMigrationStatus, type StorageMigrationHooks } from '../../src/services/storageMigration'
import { recoverInstallerStorage, parseInstallerRecoveryArgs } from './installerStorageRecovery'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-storage-recovery-'))
  directories.push(home)
  const install = path.join(home, 'old install')
  const source = path.join(install, 'CLAUDE_CONFIG_DIR')
  const profile = path.join(home, 'legacy profile')
  const env = { HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), LOCALAPPDATA: path.join(home, 'Local'), APPDATA: path.join(home, 'Roaming') }
  const binding = resolveStorageBinding({ env, homeDir: home })
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(profile)
  await fs.writeFile(path.join(source, 'app.json'), JSON.stringify({ ...buildEchoFlowOwnershipMarker(), unknownOwner: 42 }))
  await fs.writeFile(path.join(source, 'settings.json'), '{"unknown":{"future":42}}')
  await fs.writeFile(path.join(source, 'opaque.bin'), Buffer.from([0, 255, 1, 128]))
  const mode = JSON.stringify({ mode: 'portable', portable_dir: source, unknown: { future: 42 } })
  await fs.writeFile(path.join(profile, 'app-mode.json'), mode)
  const hooks: StorageMigrationHooks = {
    // Private fixtures have no external writers; this is not Windows inventory qualification.
    platform: 'linux', assertQuiescent: async () => {},
  }
  const request = { source, profile, installDirs: [install], env }
  return { home, source, profile, binding, mode, hooks, request }
}

test('installer bridge uses R and shared receipts, preserving unknown bytes without a recovered pointer', async () => {
  const f = await fixture()
  const result = await recoverInstallerStorage(f.request, { hooks: f.hooks })
  expect(result.root).toBe(f.binding.root)
  expect(result.state).toBe('ready')
  expect(await fs.readFile(path.join(f.binding.root, 'settings.json'), 'utf8')).toBe('{"unknown":{"future":42}}')
  expect(await fs.readFile(path.join(f.binding.root, 'opaque.bin'))).toEqual(Buffer.from([0, 255, 1, 128]))
  expect(JSON.parse(await fs.readFile(path.join(f.binding.root, 'app.json'), 'utf8')).unknownOwner).toBe(42)
  expect(await fs.exists(path.join(f.binding.root, 'app-mode.json'))).toBe(false)
  expect(await fs.readFile(path.join(f.binding.root, legacyStorageArchive(f.profile), 'app-mode.json'), 'utf8')).toBe(f.mode)
  expect(await fs.exists(path.join(f.profile, 'app-mode.json'))).toBe(false)
  expect(await fs.exists(f.source)).toBe(false)
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('ready')
  expect((await fs.readdir(f.home)).some(name => name.startsWith('Recovered-'))).toBe(false)
})

test('native Chromium validation failure retains the entire source and raw selection and never accepts', async () => {
  const f = await fixture()
  await fs.mkdir(path.join(f.source, 'Local Storage'))
  await fs.writeFile(path.join(f.source, 'Local Storage', 'unknown.log'), 'native fixture')
  await expect(recoverInstallerStorage(f.request, { hooks: f.hooks })).rejects.toThrow('restricted native desktop validation')
  expect(await fs.readFile(path.join(f.source, 'settings.json'), 'utf8')).toBe('{"unknown":{"future":42}}')
  expect(await fs.readFile(path.join(f.source, 'Local Storage', 'unknown.log'), 'utf8')).toBe('native fixture')
  expect(await fs.readFile(path.join(f.profile, 'app-mode.json'), 'utf8')).toBe(f.mode)
  expect(await readStorageMigrationStatus(f.binding)).toBeNull()
  expect(await readStorageHandoff(f.source, f.binding.root)).toBeUndefined()
  await expect(recoverInstallerStorage(f.request, { hooks: f.hooks })).rejects.toThrow('restricted native desktop validation')
  expect(await fs.exists(f.source)).toBe(true)
})

test('restricted failure can roll forward through the same transaction without replaying accepted data', async () => {
  const f = await fixture()
  await expect(recoverInstallerStorage(f.request, {
    hooks: f.hooks, validateRestrictedStartup: async () => { throw new Error('interrupted validation') },
  })).rejects.toThrow('interrupted validation')
  const pending = await readStorageMigrationStatus(f.binding)
  expect(pending?.state).toBe('validation-required')
  const handoff = await readStorageHandoff(f.source, f.binding.root)
  expect(handoff).toBeDefined()
  await expect(acquireStorageWriter({ root: f.source, internalDir: path.join(f.source, 'echoflow-code'), selection: 'explicit' })).rejects.toThrow('pending cold handoff')
  expect(await fs.readFile(path.join(f.profile, 'app-mode.json'), 'utf8')).toBe(f.mode)
  await recoverInstallerStorage(f.request, { hooks: f.hooks })
  expect((await readStorageMigrationStatus(f.binding))?.id).toBe(pending?.id)
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('ready')
})

test('settings and a portable pointer alone do not prove ownership', async () => {
  const f = await fixture()
  await fs.unlink(path.join(f.source, 'app.json'))
  await expect(recoverInstallerStorage(f.request, { hooks: f.hooks })).rejects.toThrow(/ownership/)
  expect(await fs.readFile(path.join(f.profile, 'app-mode.json'), 'utf8')).toBe(f.mode)
  expect(await fs.exists(path.join(f.source, 'opaque.bin'))).toBe(true)
})

test('installer cannot select a target, runtime or metadata below an install root', async () => {
  const f = await fixture()
  await expect(recoverInstallerStorage({ ...f.request, env: { ...f.request.env, CLAUDE_CONFIG_DIR: f.source } }, { hooks: f.hooks })).rejects.toThrow(/managed/)
  await expect(recoverInstallerStorage({ ...f.request, installDirs: [f.home] }, { hooks: f.hooks })).rejects.toThrow(/install directory/)
  expect(await fs.readFile(path.join(f.profile, 'app-mode.json'), 'utf8')).toBe(f.mode)
})

test('a quiescence failure never cleans source or original mode', async () => {
  const f = await fixture()
  await expect(recoverInstallerStorage(f.request, {
    hooks: { ...f.hooks, assertQuiescent: async () => { throw new Error('offline inventory refuses') } },
  })).rejects.toThrow('offline inventory refuses')
  expect(await fs.readFile(path.join(f.source, 'opaque.bin'))).toEqual(Buffer.from([0, 255, 1, 128]))
  expect(await fs.readFile(path.join(f.profile, 'app-mode.json'), 'utf8')).toBe(f.mode)
  expect(await readStorageHandoff(f.source, f.binding.root)).toBeUndefined()
  expect(await readStorageMigrationStatus(f.binding)).toBeNull()
})

test('unqualified native owners cannot arm a handoff, even with a permissive fixture validator', async () => {
  for (const name of ['IndexedDB', 'Service Worker', 'EBWebView']) {
    const f = await fixture()
    await fs.mkdir(path.join(f.source, name))
    await expect(recoverInstallerStorage(f.request, {
      hooks: f.hooks, validateRestrictedStartup: async () => {},
    })).rejects.toThrow('restricted native desktop validation')
    expect(await readStorageHandoff(f.source, f.binding.root)).toBeUndefined()
    expect(await readStorageMigrationStatus(f.binding)).toBeNull()
    expect(await fs.exists(path.join(f.source, 'app.json'))).toBe(true)
  }
})

test('in-place profile controls are archived without leaving a live selection', async () => {
  const f = await fixture()
  await fs.mkdir(f.binding.root, { recursive: true })
  await fs.copyFile(path.join(f.source, 'app.json'), path.join(f.binding.root, 'app.json'))
  await fs.rename(path.join(f.profile, 'app-mode.json'), path.join(f.binding.root, 'app-mode.json'))
  await recoverInstallerStorage({ ...f.request, profile: f.binding.root }, { hooks: f.hooks })
  expect(await fs.exists(path.join(f.binding.root, 'app-mode.json'))).toBe(false)
  expect(await fs.readFile(path.join(f.binding.root, legacyStorageArchive(f.binding.root), 'app-mode.json'), 'utf8')).toBe(f.mode)
})

test('terminal receipts retain their raw history without revalidating historical directories', async () => {
  for (const stage of ['completed', 'failed', 'cancelled']) {
    const f = await fixture()
    const oldSource = path.join(f.home, 'removed historical source')
    const oldTarget = path.join(f.home, 'removed historical target')
    const raw = JSON.stringify({ version: 1, status: { id: 'legacy', stage, sourceDir: oldSource, targetDir: oldTarget }, oldMode: null, stagingDir: path.join(oldTarget, '.cc-haha-migration-legacy'), manifest: [], createdCredentials: [], credentials: [], unknown: { future: 42 } }, null, 2)
    await fs.writeFile(path.join(f.profile, 'data-migration-v1.json'), raw)
    await recoverInstallerStorage(f.request, { hooks: f.hooks })
    expect(await fs.readFile(path.join(f.binding.root, legacyStorageArchive(f.profile), 'data-migration-v1.json'), 'utf8')).toBe(raw)
    expect(await fs.exists(path.join(f.profile, 'data-migration-v1.json'))).toBe(false)
  }
})

test('a pre-transaction launcher crash reuses the shared pending request', async () => {
  const f = await fixture()
  const plan = await prepareStorageMigration({ binding: f.binding, sources: [{ directory: f.source, markerRoot: f.source }] })
  const launch = await armStorageHandoff(await prepareStorageHandoff(plan), crypto.randomUUID())
  await expect(recoverInstallerStorage(f.request, {
    hooks: f.hooks, validateRestrictedStartup: async () => { throw new Error('pause') },
  })).rejects.toThrow('pause')
  expect(await readStorageHandoff(f.source, f.binding.root)).toEqual(launch)
  await recoverInstallerStorage(f.request, { hooks: f.hooks })
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('ready')
})

test('an absent old metadata profile is not created as a second storage root', async () => {
  const f = await fixture()
  await fs.rm(f.profile, { recursive: true })
  await recoverInstallerStorage(f.request, { hooks: f.hooks })
  expect(await fs.exists(f.profile)).toBe(false)
  expect(await fs.exists(path.join(f.binding.root, 'settings.json'))).toBe(true)
})

test('a source alias is rejected rather than erasing its link identity', async () => {
  const f = await fixture()
  const alias = path.join(f.request.installDirs[0]!, 'source alias')
  await fs.symlink(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(recoverInstallerStorage({ ...f.request, source: alias }, { hooks: f.hooks })).rejects.toThrow('path contains a link')
  expect(await readStorageHandoff(f.source, f.binding.root)).toBeUndefined()
  expect(await fs.exists(path.join(f.source, 'opaque.bin'))).toBe(true)
})

test('a completed transaction is recovered without requiring its retired source', async () => {
  const f = await fixture()
  await recoverInstallerStorage(f.request, { hooks: f.hooks })
  const completed = await readStorageMigrationStatus(f.binding)
  expect(await fs.exists(f.source)).toBe(false)
  await recoverInstallerStorage(f.request, { hooks: f.hooks })
  expect((await readStorageMigrationStatus(f.binding))?.id).toBe(completed?.id)
})

test('a request cannot resume a transaction belonging to a different source', async () => {
  const f = await fixture()
  await expect(recoverInstallerStorage(f.request, {
    hooks: f.hooks, validateRestrictedStartup: async () => { throw new Error('pause') },
  })).rejects.toThrow('pause')
  const other = path.join(f.request.installDirs[0]!, 'different source')
  await fs.mkdir(other)
  await fs.copyFile(path.join(f.source, 'app.json'), path.join(other, 'app.json'))
  await expect(recoverInstallerStorage({ ...f.request, source: other }, { hooks: f.hooks })).rejects.toThrow('conflicts with the existing storage transaction')
  expect((await readStorageMigrationStatus(f.binding))?.state).toBe('validation-required')
  expect(await fs.exists(path.join(f.source, 'opaque.bin'))).toBe(true)
})

test('source replacement after preview is rejected before arming', async () => {
  const f = await fixture()
  let calls = 0
  await expect(recoverInstallerStorage(f.request, {
    hooks: { ...f.hooks, assertQuiescent: async () => {
      if (++calls !== 2) return
      await fs.rename(f.source, `${f.source}-original`)
      await fs.mkdir(f.source)
      await fs.copyFile(path.join(`${f.source}-original`, 'app.json'), path.join(f.source, 'app.json'))
    } },
  })).rejects.toThrow('Migration directory was replaced')
  expect(await readStorageHandoff(f.source, f.binding.root)).toBeUndefined()
  expect(await fs.readFile(path.join(`${f.source}-original`, 'opaque.bin'))).toEqual(Buffer.from([0, 255, 1, 128]))
  expect(await readStorageMigrationStatus(f.binding)).toBeNull()
})

test('an interrupted legacy receipt is never archived as terminal history', async () => {
  const f = await fixture()
  const target = path.join(f.home, 'old target')
  const raw = JSON.stringify({ version: 1, status: { id: 'legacy', stage: 'copying', sourceDir: f.source, targetDir: target }, oldMode: null, stagingDir: path.join(target, '.cc-haha-migration-legacy'), manifest: [], createdCredentials: [], credentials: [] })
  await fs.writeFile(path.join(f.profile, 'data-migration-v1.json'), raw)
  await expect(recoverInstallerStorage(f.request, { hooks: f.hooks })).rejects.toThrow('Finish legacy receipt recovery')
  expect(await fs.readFile(path.join(f.profile, 'data-migration-v1.json'), 'utf8')).toBe(raw)
  expect(await readStorageHandoff(f.source, f.binding.root)).toBeUndefined()
})

test('recovery arguments reject ambiguity and nonabsolute paths', () => {
  const root = path.resolve(os.tmpdir())
  expect(parseInstallerRecoveryArgs(['--source', root, '--profile', root, '--install-dir', root])).toEqual({ source: root, profile: root, installDirs: [root] })
  for (const args of [[], ['--source', 'relative'], ['--unknown', root], ['--source', root, '--source', root], ['--profile'], ['--install-dir', `${root}\0bad`]]) {
    expect(() => parseInstallerRecoveryArgs(args)).toThrow()
  }
})
