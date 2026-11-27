import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { buildEchoFlowOwnershipMarker } from '../utils/echoFlowConfigRoot'
import { openLocalIndexDatabase } from '../server/services/localIndex/database'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations'
import { discoverDesktopStorage, initializeDesktopStorage } from '../../desktop/electron/services/desktopStorageStartup'
import { acquireStorageWriter, completeStorageMigration, executeStorageMigration, recoverStorageMigration, type StorageMigrationHooks } from './storageMigration'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-in-place-'))
  directories.push(home)
  const root = path.join(home, 'selected')
  const internal = path.join(root, 'echoflow-code')
  await fs.mkdir(internal, { recursive: true })
  await fs.writeFile(path.join(root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  const env = { HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config'), CLAUDE_CONFIG_DIR: root }
  const app = {
    getPath: (name: 'home' | 'exe' | 'userData') => name === 'home' ? home : name === 'exe' ? path.join(home, 'install', 'echoflow') : root,
    commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
  }
  const putDatabase = (file: string, value: string) => {
    const database = openLocalIndexDatabase({ path: file })
    database.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'in-place-evidence', value))
    database.close()
  }
  const hooks: StorageMigrationHooks = {
    platform: 'linux', upgradeJson: upgradePersistentStorageValue,
    // Only the closed DB fixtures in this private directory can write these roots.
    assertQuiescent: async () => {},
    validateSQLite: async file => {
      const database = new Database(file, { readonly: true })
      try { expect(Object.values(database.query('PRAGMA quick_check').get()!)).toEqual(['ok']) }
      finally { database.close() }
    },
  }
  return { home, root, internal, env, app, putDatabase, hooks }
}

test('cold startup upgrades a flat database already inside the selected owned root to its active consumer path', async () => {
  const f = await fixture()
  const oldPath = path.join(f.internal, 'index-v1.sqlite')
  const activePath = path.join(f.internal, 'db', 'index-v1.sqlite')
  f.putDatabase(oldPath, 'preserved')
  await fs.writeFile(path.join(f.internal, 'opaque-extension.bin'), 'unchanged')
  const launch = discoverDesktopStorage(f.app, f.env, 'linux', f.home)
  const lease = await initializeDesktopStorage(launch, f.hooks, async () => {})
  try {
    const database = new Database(activePath, { readonly: true })
    try { expect(database.query('SELECT value FROM schema_meta WHERE key = ?').get('in-place-evidence')).toEqual({ value: 'preserved' }) }
    finally { database.close() }
    expect(await fs.exists(oldPath)).toBe(false)
    expect(await fs.readFile(path.join(f.internal, 'opaque-extension.bin'), 'utf8')).toBe('unchanged')
    const transactions = path.join(f.internal, 'migrations')
    const [id] = (await fs.readdir(transactions)).filter(name => /^[a-f0-9-]{36}$/.test(name))
    const journal = JSON.parse(await fs.readFile(path.join(transactions, id!, 'journal.json'), 'utf8'))
    expect(journal.sources).toHaveLength(1)
    expect(journal.sources[0].layout).toBe('flat-indexes')
    expect(journal.sources[0].directories).toEqual([])
    expect(journal.entries.map((entry: { relative: string }) => entry.relative)).toEqual(['index-v1.sqlite'])
    expect(await fs.readFile(path.join(transactions, id!, 'sources', '0', 'index-v1.sqlite'))).toEqual(await fs.readFile(activePath))
    const relocations = JSON.parse(await fs.readFile(path.join(f.internal, 'storage-relocations.json'), 'utf8'))
    expect(relocations.mappings).toEqual([])
    // Ready startup must keep the active I alive and share its writer leases.
    const second = await initializeDesktopStorage(discoverDesktopStorage(f.app, f.env, 'linux', f.home), f.hooks, async () => { throw new Error('already accepted') })
    await second.release()
  } finally { await lease.release() }
})

test('in-place flat and active databases with different contents block before admitting a writer', async () => {
  const f = await fixture()
  const oldPath = path.join(f.internal, 'index-v1.sqlite')
  const activePath = path.join(f.internal, 'db', 'index-v1.sqlite')
  f.putDatabase(oldPath, 'source')
  f.putDatabase(activePath, 'target')
  const oldBytes = await fs.readFile(oldPath)
  const activeBytes = await fs.readFile(activePath)
  const launch = discoverDesktopStorage(f.app, f.env, 'linux', f.home)
  let caught: unknown
  let lease: { release(): Promise<void> } | undefined
  try { lease = await initializeDesktopStorage(launch, f.hooks, async () => {}) }
  catch (error) { caught = error }
  finally { await lease?.release() }
  expect(caught).toBeInstanceOf(Error)
  expect(String(caught)).toMatch(/conflict/i)
  expect(await fs.readFile(oldPath)).toEqual(oldBytes)
  expect(await fs.readFile(activePath)).toEqual(activeBytes)
})

test('identical flat and active databases retain the active file identity and only retire the flat file', async () => {
  const f = await fixture()
  const oldPath = path.join(f.internal, 'index-v1.sqlite')
  const activePath = path.join(f.internal, 'db', 'index-v1.sqlite')
  f.putDatabase(oldPath, 'identical')
  await fs.mkdir(path.dirname(activePath))
  await fs.copyFile(oldPath, activePath)
  const before = await fs.stat(activePath, { bigint: true })
  const lease = await initializeDesktopStorage(discoverDesktopStorage(f.app, f.env, 'linux', f.home), f.hooks, async () => {})
  await lease.release()
  const after = await fs.stat(activePath, { bigint: true })
  expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino })
  expect(await fs.exists(oldPath)).toBe(false)
  expect((await recoverStorageMigration(discoverDesktopStorage(f.app, f.env, 'linux', f.home).binding, f.hooks)).state).toBe('ready')
})

test('in-place WAL snapshots, all fixed index names and unrelated active directories survive the transaction', async () => {
  const f = await fixture()
  const snapshotPath = path.join(f.home, 'snapshot', 'index-v1.sqlite')
  const snapshot = openLocalIndexDatabase({ path: snapshotPath })
  snapshot.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'wal-evidence', 'committed'))
  try {
    for (const suffix of ['', '-wal', '-shm']) await fs.copyFile(snapshotPath + suffix, path.join(f.internal, 'index-v1.sqlite' + suffix))
  } finally { snapshot.close() }
  for (const name of ['trace-index-v1.sqlite', 'search-index-v1.sqlite', 'scheduled-runs-v1.sqlite']) f.putDatabase(path.join(f.internal, name), name)
  await fs.mkdir(path.join(f.internal, 'extensions', 'opaque'), { recursive: true })
  await fs.writeFile(path.join(f.internal, 'extensions', 'opaque', 'index-v1.sqlite'), 'not a flat index')
  await fs.mkdir(path.join(f.internal, 'migration-history', 'opaque'), { recursive: true })
  await fs.writeFile(path.join(f.internal, 'migration-history', 'opaque', 'journal.json'), '{"version":999}')
  const launch = discoverDesktopStorage(f.app, f.env, 'linux', f.home)
  const lease = await initializeDesktopStorage(launch, f.hooks, async () => {
    const database = new Database(path.join(f.internal, 'db', 'index-v1.sqlite'), { readonly: true })
    try { expect(database.query('SELECT value FROM schema_meta WHERE key = ?').get('wal-evidence')).toEqual({ value: 'committed' }) }
    finally { database.close() }
  })
  await lease.release()
  for (const name of ['index-v1.sqlite', 'trace-index-v1.sqlite', 'search-index-v1.sqlite', 'scheduled-runs-v1.sqlite']) {
    expect(await fs.exists(path.join(f.internal, name))).toBe(false)
    expect(await fs.exists(path.join(f.internal, 'db', name))).toBe(true)
  }
  expect(await fs.readFile(path.join(f.internal, 'extensions', 'opaque', 'index-v1.sqlite'), 'utf8')).toBe('not a flat index')
  expect(await fs.readFile(path.join(f.internal, 'migration-history', 'opaque', 'journal.json'), 'utf8')).toBe('{"version":999}')
  const status = await recoverStorageMigration(launch.binding, f.hooks)
  expect(status.state, status.issues.join('; ')).toBe('ready')
})

for (const name of ['index-v1.sqlite', 'trace-index-v1.sqlite-wal', 'search-index-v1.sqlite-shm', 'scheduled-runs-v1.sqlite-journal']) {
  test(`an old writer recreating ${name} blocks both recovery and writer admission without reimporting`, async () => {
    const f = await fixture()
    f.putDatabase(path.join(f.internal, 'index-v1.sqlite'), 'import once')
    const launch = discoverDesktopStorage(f.app, f.env, 'linux', f.home)
    const lease = await initializeDesktopStorage(launch, f.hooks, async () => {})
    await lease.release()
    const activePath = path.join(f.internal, 'db', 'index-v1.sqlite')
    await fs.unlink(activePath)
    await fs.writeFile(path.join(f.internal, name), 'old writer recreated bytes')
    const recovered = await recoverStorageMigration(launch.binding, f.hooks)
    expect(recovered.state).toBe('blocked')
    expect(recovered.issues.join('; ')).toMatch(/Retired flat index/)
    await expect(acquireStorageWriter(launch.binding)).rejects.toThrow('Retired flat index')
    await expect(initializeDesktopStorage(discoverDesktopStorage(f.app, f.env, 'linux', f.home), f.hooks, async () => {})).rejects.toThrow('Retired flat index')
    expect(await fs.exists(activePath)).toBe(false)
    expect(await fs.readFile(path.join(f.internal, name), 'utf8')).toBe('old writer recreated bytes')
  })
}

test('future, damaged and widened in-place source receipts fail closed', async () => {
  const f = await fixture()
  f.putDatabase(path.join(f.internal, 'index-v1.sqlite'), 'preserved')
  const launch = discoverDesktopStorage(f.app, f.env, 'linux', f.home)
  const lease = await initializeDesktopStorage(launch, f.hooks, async () => {})
  await lease.release()
  const transactions = path.join(f.internal, 'migrations')
  const [id] = (await fs.readdir(transactions)).filter(name => /^[a-f0-9-]{36}$/.test(name))
  const file = path.join(transactions, id!, 'journal.json')
  const original = await fs.readFile(file, 'utf8')
  const journal = JSON.parse(original)
  const cases = [
    '{',
    JSON.stringify({ ...journal, version: 999 }),
    JSON.stringify({ ...journal, sources: [{ ...journal.sources[0], layout: 'future-layout' }] }),
    JSON.stringify({ ...journal, sources: [{ ...journal.sources[0], directory: f.home }] }),
    JSON.stringify({ ...journal, sources: [{ ...journal.sources[0], markerRoot: f.home }] }),
    JSON.stringify({ ...journal, sources: [{ ...journal.sources[0], destination: 'elsewhere' }] }),
    JSON.stringify({ ...journal, sources: [{ ...journal.sources[0], directories: [{ relative: 'extensions', identity: journal.rootIdentity, mode: 0o700 }] }] }),
    JSON.stringify({ ...journal, entries: [{ ...journal.entries[0], relative: 'settings.json' }] }),
    JSON.stringify({ ...journal, entries: [{ ...journal.entries[0], destination: 'echoflow-code/settings.json' }] }),
    JSON.stringify({ ...journal, entries: [] }),
    JSON.stringify({ ...journal, entries: [{ ...journal.entries[0], relative: 'index-v1.sqlite-wal', destination: path.join('echoflow-code', 'db', 'index-v1.sqlite-wal') }] }),
  ]
  for (const bytes of cases) {
    await fs.writeFile(file, bytes)
    expect((await recoverStorageMigration(launch.binding, f.hooks)).state).toBe('blocked')
    await expect(acquireStorageWriter(launch.binding)).rejects.toThrow()
  }
  await fs.writeFile(file, original)
  const restarted = await acquireStorageWriter(launch.binding)
  await restarted.release()
})

for (const suffix of ['-wal', '-shm', '-journal']) {
  test(`orphan flat ${suffix} is preserved and cannot be attached to the active database`, async () => {
    const f = await fixture()
    const activePath = path.join(f.internal, 'db', 'index-v1.sqlite')
    f.putDatabase(activePath, 'active')
    const original = await fs.readFile(activePath)
    const orphan = path.join(f.internal, 'index-v1.sqlite' + suffix)
    await fs.writeFile(orphan, 'orphan snapshot bytes')
    await expect(initializeDesktopStorage(discoverDesktopStorage(f.app, f.env, 'linux', f.home), f.hooks, async () => {})).rejects.toThrow('Incomplete flat index snapshot')
    expect(await fs.readFile(activePath)).toEqual(original)
    expect(await fs.readFile(orphan, 'utf8')).toBe('orphan snapshot bytes')
    expect(await fs.exists(activePath + suffix)).toBe(false)
  })
}

test('an active-only WAL blocks rather than mixing it with an identical flat database', async () => {
  const f = await fixture()
  const oldPath = path.join(f.internal, 'index-v1.sqlite')
  const activePath = path.join(f.internal, 'db', 'index-v1.sqlite')
  f.putDatabase(oldPath, 'same base bytes')
  await fs.mkdir(path.dirname(activePath))
  await fs.copyFile(oldPath, activePath)
  await fs.writeFile(activePath + '-wal', 'independent active snapshot WAL')
  const original = await fs.readFile(oldPath)
  await expect(initializeDesktopStorage(discoverDesktopStorage(f.app, f.env, 'linux', f.home), f.hooks, async () => {})).rejects.toThrow('Conflicting storage database snapshot')
  expect(await fs.readFile(oldPath)).toEqual(original)
  expect(await fs.readFile(activePath)).toEqual(original)
  expect(await fs.readFile(activePath + '-wal', 'utf8')).toBe('independent active snapshot WAL')
})

test('in-place cleanup keeps unrelated files and recovers after a changed original is restored', async () => {
  const f = await fixture()
  const oldPath = path.join(f.internal, 'index-v1.sqlite')
  f.putDatabase(oldPath, 'accepted')
  const bytes = await fs.readFile(oldPath)
  const launch = discoverDesktopStorage(f.app, f.env, 'linux', f.home)
  const pending = await executeStorageMigration({ binding: launch.binding, sources: launch.sources, hooks: f.hooks })
  expect(pending.state).toBe('validation-required')
  await fs.writeFile(oldPath, 'late old writer')
  await fs.writeFile(path.join(f.internal, 'settings.json'), '{"preserve":true}')
  expect((await completeStorageMigration(launch.binding, pending.id!, f.hooks)).state).toBe('cleanup-pending')
  expect(await fs.readFile(oldPath, 'utf8')).toBe('late old writer')
  await fs.writeFile(oldPath, bytes)
  expect((await recoverStorageMigration(launch.binding, f.hooks)).state).toBe('ready')
  expect(await fs.exists(oldPath)).toBe(false)
  expect(await fs.readFile(path.join(f.internal, 'settings.json'), 'utf8')).toBe('{"preserve":true}')
})

test('desktop treats an empty complete-root override as the platform default just like CLI and server', async () => {
  const f = await fixture()
  const launch = discoverDesktopStorage(f.app, { ...f.env, CLAUDE_CONFIG_DIR: '' }, 'linux', f.home)
  expect(launch.binding.root).toBe(path.join(f.env.XDG_DATA_HOME, 'echoflow-code'))
  expect(launch.binding.selection).toBe('default')
})
