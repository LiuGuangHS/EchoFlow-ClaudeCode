import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'
import { completeStorageMigration, executeStorageMigration, prepareStorageMigration, recoverStorageMigration, type StorageMigrationHooks, type StorageMigrationSource } from './storageMigration'
import { validateStorageSQLite } from './storageMigrationValidation'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})
type Snapshot = Record<string, Buffer>
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-sqlite-cohorts-'))
  directories.push(home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'current')] })
  const live = path.join(home, 'fixture.sqlite')
  const db = new Database(live)
  let snapshot: Snapshot
  let otherSnapshot: Snapshot
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE evidence(value TEXT); PRAGMA wal_checkpoint(TRUNCATE)')
    const base = await fs.readFile(live)
    db.exec("INSERT INTO evidence VALUES ('committed-in-wal')")
    snapshot = Object.fromEntries(await Promise.all(['', '-wal', '-shm'].map(async suffix => [suffix, await fs.readFile(live + suffix)])))
    expect(snapshot['']).toEqual(base)
    expect(snapshot['-wal']!.length).toBeGreaterThan(32)
    db.exec("UPDATE evidence SET value = 'different-wal-snapshot'")
    otherSnapshot = Object.fromEntries(await Promise.all(['', '-wal', '-shm'].map(async suffix => [suffix, await fs.readFile(live + suffix)])))
    expect(otherSnapshot['']).toEqual(base)
    expect(otherSnapshot['-wal']).not.toEqual(snapshot['-wal'])
  } finally { db.close() }
  async function put(file: string, files: Snapshot) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    for (const [suffix, bytes] of Object.entries(files)) await fs.writeFile(file + suffix, bytes)
  }
  async function owned(name: string) {
    const directory = path.join(home, name)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
    return { directory, markerRoot: directory }
  }
  async function source(kind: 'root' | 'legacy-internal', name = 'old') {
    if (kind === 'root') {
      const source = await owned(name)
      return { source, database: path.join(source.directory, 'cc-haha', 'index-v1.sqlite') }
    }
    const markerRoot = path.join(home, name)
    const directory = path.join(markerRoot, 'cc-haha')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'providers.json'), '{"providers":[],"activeId":null,"unknown":"preserve"}')
    return { source: { directory, markerRoot, ownership: 'legacy-internal', destination: 'echoflow-code' } satisfies StorageMigrationSource, database: path.join(directory, 'index-v1.sqlite') }
  }
  const hooks: StorageMigrationHooks = {
    platform: 'linux', assertQuiescent: async () => {},
    upgradeJson: upgradePersistentStorageValue, validateSQLite: validateStorageSQLite,
  }
  const target = path.join(binding.internalDir, 'db', 'index-v1.sqlite')
  return { home, binding, snapshot: snapshot!, otherSnapshot: otherSnapshot!, put, owned, source, hooks, target }
}
async function expectBytes(file: string, snapshot: Snapshot) {
  for (const [suffix, bytes] of Object.entries(snapshot)) expect(await fs.readFile(file + suffix)).toEqual(bytes)
}

for (const kind of ['root', 'legacy-internal'] as const) {
  test(`${kind}: orphan WAL/SHM cannot attach to an existing target database`, async () => {
    const f = await fixture()
    const { source, database } = await f.source(kind)
    await f.owned('current')
    await f.put(f.target, { '': f.snapshot['']! })
    const sidecars = { '-wal': f.snapshot['-wal']!, '-shm': f.snapshot['-shm']! }
    await f.put(database, sidecars)
    await expect(prepareStorageMigration({ binding: f.binding, sources: [source] })).rejects.toThrow(/Incomplete.*SQLite/i)
    const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
    expect(result.state, result.issues.join('; ')).toBe('blocked')
    await expectBytes(database, sidecars)
    await expectBytes(f.target, { '': f.snapshot['']! })
    expect(await fs.exists(f.target + '-wal')).toBe(false)
  })

  for (const targetState of ['base-only', 'wal-snapshot', 'orphan-wal'] as const) {
    test(`${kind}: rejects a ${targetState} target with a different cohort before publication`, async () => {
      const f = await fixture()
      const { source, database } = await f.source(kind)
      await f.owned('current')
      const sourceBytes = targetState === 'base-only' ? f.snapshot : { '': f.snapshot['']! }
      const targetBytes = targetState === 'base-only' ? { '': f.snapshot['']! }
        : targetState === 'wal-snapshot' ? f.snapshot : { '-wal': f.snapshot['-wal']! }
      await f.put(database, sourceBytes)
      await f.put(f.target, targetBytes)
      const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
      expect(result.state, result.issues.join('; ')).toBe('blocked')
      expect(result.issues.join('; ')).toMatch(/Conflicting storage database snapshot/)
      await expectBytes(database, sourceBytes)
      await expectBytes(f.target, targetBytes)
      for (const suffix of ['', '-wal', '-shm']) expect(await fs.exists(f.target + suffix)).toBe(suffix in targetBytes)
    })
  }
}

for (const reverse of [false, true]) {
  test(`different source cohorts with equal base bytes are never unioned (reverse=${reverse})`, async () => {
    const f = await fixture()
    const a = await f.source('root', 'a')
    const b = await f.source('legacy-internal', 'b')
    await f.put(a.database, { '': f.snapshot['']! })
    await f.put(b.database, f.snapshot)
    const sources = [a.source, b.source]
    const result = await executeStorageMigration({ binding: f.binding, sources: reverse ? sources.reverse() : sources, hooks: f.hooks })
    expect(result.state, result.issues.join('; ')).toBe('blocked')
    expect(await fs.exists(f.target)).toBe(false)
    await expectBytes(a.database, { '': f.snapshot['']! })
    await expectBytes(b.database, f.snapshot)
  })
}

for (const existing of ['target', 'source'] as const) {
  test(`equal SQLite bases with different committed WALs conflict against another ${existing}`, async () => {
    const f = await fixture()
    const a = await f.source('root')
    await f.put(a.database, f.snapshot)
    const b = existing === 'source' ? await f.source('legacy-internal', 'other') : undefined
    if (!b) await f.owned('current')
    const other = b?.database ?? f.target
    await f.put(other, f.otherSnapshot)
    const result = await executeStorageMigration({ binding: f.binding, sources: [a.source, ...(b ? [b.source] : [])], hooks: f.hooks })
    expect(result.state, result.issues.join('; ')).toBe('blocked')
    await expectBytes(a.database, f.snapshot)
    await expectBytes(other, f.otherSnapshot)
    if (b) expect(await fs.exists(f.target)).toBe(false)
  })
}

test('two namespaces inside one source cannot contribute different halves of a snapshot', async () => {
  const f = await fixture()
  const { source, database } = await f.source('root')
  await f.put(database, { '': f.snapshot['']! })
  await f.put(path.join(source.directory, 'echoflow-code', 'db', 'index-v1.sqlite'), f.snapshot)
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('blocked')
  expect(await fs.exists(f.target)).toBe(false)
})

test('SQLite headers, not just index filenames, bind extensionless databases to their sidecars', async () => {
  const f = await fixture()
  const source = await f.owned('old')
  const database = path.join(source.directory, 'extensions', 'opaque-store')
  const target = path.join(f.binding.root, 'extensions', 'opaque-store')
  await f.owned('current')
  await f.put(database, f.snapshot)
  await f.put(target, { '': f.snapshot['']! })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('blocked')
  await expectBytes(database, f.snapshot)
  expect(await fs.exists(target + '-wal')).toBe(false)
})

test('identical multi-source/target cohorts keep identities, unknown bytes and WAL-only data through acceptance and cleanup recovery', async () => {
  const f = await fixture()
  const a = await f.source('root', 'a')
  const b = await f.source('legacy-internal', 'b')
  await f.owned('current')
  for (const file of [a.database, b.database, f.target]) await f.put(file, f.snapshot)
  const identities = await Promise.all(Object.keys(f.snapshot).map(async suffix => fs.stat(f.target + suffix, { bigint: true })))
  await f.put(path.join(a.source.directory, 'unknown.bin'), { '': Buffer.from([0, 255, 42]) })
  const result = await executeStorageMigration({ binding: f.binding, sources: [a.source, b.source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('validation-required')
  await validateStorageSQLite(f.target, copy => {
    const db = new Database(copy, { readonly: true })
    try { expect(db.query('SELECT value FROM evidence').all()).toEqual([{ value: 'committed-in-wal' }]) }
    finally { db.close() }
  })
  await expectBytes(a.database, f.snapshot)
  await expectBytes(b.database, f.snapshot)
  const interrupted = await completeStorageMigration(f.binding, result.id!, { ...f.hooks, cleanupResources: async () => { throw new Error('fixture cleanup interruption') } })
  expect(interrupted.state).toBe('cleanup-pending')
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
  expect(await fs.exists(a.source.directory)).toBe(false)
  expect(await fs.exists(b.source.directory)).toBe(false)
  await expectBytes(f.target, f.snapshot)
  for (const [index, suffix] of Object.keys(f.snapshot).entries()) {
    const actual = await fs.stat(f.target + suffix, { bigint: true })
    expect([actual.dev, actual.ino]).toEqual([identities[index]!.dev, identities[index]!.ino])
    await expectBytes(path.join(f.binding.internalDir, 'migrations', result.id!, 'sources', '0', 'cc-haha', 'index-v1.sqlite'), { [suffix]: f.snapshot[suffix]! })
  }
  expect(await fs.readFile(path.join(f.binding.root, 'unknown.bin'))).toEqual(Buffer.from([0, 255, 42]))
})

test('process exit between base and WAL publication rolls forward the same frozen cohort', async () => {
  const f = await fixture()
  const { source, database } = await f.source('root')
  await f.put(database, f.snapshot)
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
    import nativeFs from 'node:fs/promises'
    import { mock } from 'bun:test'
    const original = nativeFs.link
    const patched = { ...nativeFs, link: async (source, target) => {
      await original(source, target)
      if (target === ${JSON.stringify(f.target)}) process.exit(42)
    } }
    mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
    const { executeStorageMigration } = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))})
    const { validateStorageSQLite } = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigrationValidation.ts'))})
    const result = await executeStorageMigration({ binding: ${JSON.stringify(f.binding)}, sources: [${JSON.stringify(source)}], hooks: {
      platform: 'linux', assertQuiescent: async () => {}, validateSQLite: validateStorageSQLite,
    } })
    throw new Error(JSON.stringify(result))
  `], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe' })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(42)
  expect(await fs.exists(f.target)).toBe(true)
  expect(await fs.exists(f.target + '-wal')).toBe(false)
  const result = await recoverStorageMigration(f.binding, f.hooks)
  expect(result.state, result.issues.join('; ')).toBe('validation-required')
  await expectBytes(f.target, f.snapshot)
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  await expectBytes(f.target, f.snapshot)
})

test('incomplete ordinary-source receipts cannot resume publication or accept an orphan sidecar', async () => {
  const f = await fixture()
  const { source, database } = await f.source('root')
  await f.put(database, f.snapshot)
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('validation-required')
  const file = path.join(f.binding.internalDir, 'migrations', result.id!, 'journal.json')
  const journal = JSON.parse(await fs.readFile(file, 'utf8'))
  journal.entries = journal.entries.filter((entry: { relative: string }) => entry.relative !== path.join('cc-haha', 'index-v1.sqlite'))
  await fs.writeFile(file, JSON.stringify(journal))
  const recovered = await recoverStorageMigration(f.binding, f.hooks)
  expect(recovered.state).toBe('blocked')
  expect(recovered.issues.join('; ')).toContain('Incomplete SQLite operation receipt')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('blocked')
  await expectBytes(database, f.snapshot)
  await expectBytes(f.target, f.snapshot)
})

test('a source-only SHM is a cohort conflict even without a WAL', async () => {
  const f = await fixture()
  const { source, database } = await f.source('root')
  await f.owned('current')
  await f.put(database, { '': f.snapshot['']!, '-shm': f.snapshot['-shm']! })
  await f.put(f.target, { '': f.snapshot['']! })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('blocked')
  expect(await fs.exists(f.target + '-shm')).toBe(false)
})

test('an orphan rollback journal from a real SQLite transaction is retained', async () => {
  const f = await fixture()
  const { source, database } = await f.source('legacy-internal')
  const live = path.join(f.home, 'rollback.sqlite')
  const db = new Database(live)
  let bytes: Buffer
  try {
    db.exec("CREATE TABLE evidence(value TEXT); BEGIN IMMEDIATE; INSERT INTO evidence VALUES ('uncommitted')")
    bytes = await fs.readFile(live + '-journal')
    expect(bytes.length).toBeGreaterThan(0)
  } finally { db.close() }
  await f.put(database, { '-journal': bytes! })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('blocked')
  expect(result.issues.join('; ')).toContain('Incomplete SQLite snapshot')
  await expectBytes(database, { '-journal': bytes! })
  expect(await fs.exists(f.target + '-journal')).toBe(false)
})

test('opaque paired suffixes and historical orphan sidecars retain their original bytes', async () => {
  const f = await fixture()
  const source = await f.owned('old')
  await f.put(path.join(source.directory, 'opaque'), { '': Buffer.from('not SQLite'), '-wal': Buffer.from('opaque paired bytes') })
  const archive = path.join(source.directory, 'cc-haha', 'migrations', 'old', 'index.sqlite-wal')
  await f.put(archive, { '': f.snapshot['-wal']! })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('validation-required')
  const journal = JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'migrations', result.id!, 'journal.json'), 'utf8'))
  const archived = journal.entries.find((entry: { relative: string }) => entry.relative === path.relative(source.directory, archive))
  expect(archived.destination).toContain('migration-history')
  expect(await fs.readFile(path.join(f.binding.root, archived.destination))).toEqual(f.snapshot['-wal']!)
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  await expectBytes(path.join(f.binding.root, 'opaque'), { '': Buffer.from('not SQLite'), '-wal': Buffer.from('opaque paired bytes') })
})

test('a source sidecar appearing after staging blocks before publication', async () => {
  const f = await fixture()
  const { source, database } = await f.source('root')
  await f.put(database, { '': f.snapshot['']! })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: {
    ...f.hooks, prepareResources: async () => { await f.put(database, { '-wal': f.snapshot['-wal']! }) },
  } })
  expect(result.state, result.issues.join('; ')).toBe('blocked')
  expect(result.issues.join('; ')).toContain('Source SQLite snapshot changed')
  expect(await fs.exists(f.target)).toBe(false)
  await expectBytes(database, { '': f.snapshot['']!, '-wal': f.snapshot['-wal']! })
})

test('a sidecar appearing after publication blocks acceptance without cleaning originals', async () => {
  const f = await fixture()
  const { source, database } = await f.source('root')
  await f.put(database, { '': f.snapshot['']! })
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state, result.issues.join('; ')).toBe('validation-required')
  await f.put(f.target, { '-wal': f.snapshot['-wal']! })
  const accepted = await completeStorageMigration(f.binding, result.id!, f.hooks)
  expect(accepted.state).toBe('blocked')
  await expectBytes(database, { '': f.snapshot['']! })
  await expectBytes(f.target, { '': f.snapshot['']!, '-wal': f.snapshot['-wal']! })
})
