import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot'
import { openLocalIndexDatabase } from '../server/services/localIndex/database'
import { getLocalIndexDatabasePath } from '../server/services/localIndex/config'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations'
import { readSessionArchiveRetentionIds, readSessionArchiveSnapshot, resolveSessionArchive } from '../utils/sessionArchiveStore'
import { completeStorageMigration, executeStorageMigration, prepareStorageMigration, recoverStorageMigration, type StorageMigrationHooks } from './storageMigration'

const directories: string[] = []
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-legacy-namespaces-'))
  directories.push(home)
  const shared = path.join(home, 'shared')
  const legacy = path.join(shared, 'cc-haha')
  const currentName = path.join(shared, 'echoflow-code')
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'canonical')] })
  await fs.mkdir(legacy, { recursive: true })
  await fs.mkdir(currentName, { recursive: true })
  const sharedSettings = '{"env":{"UNRELATED_FIXTURE":"preserve"},"extension":{"keep":true}}\n'
  await fs.writeFile(path.join(shared, 'settings.json'), sharedSettings)
  const sources = [legacy, currentName].map(directory => ({
    directory, markerRoot: shared, ownership: 'legacy-internal' as const, destination: 'echoflow-code',
  }))
  const hooks: StorageMigrationHooks = {
    platform: 'linux',
    upgradeJson: upgradePersistentStorageValue,
    assertQuiescent: async () => {},
    validateSQLite: async file => {
      const database = new Database(file, { readonly: true })
      try { expect(Object.values(database.query('PRAGMA quick_check').get()!)).toEqual(['ok']) }
      finally { database.close() }
    },
  }
  return { home, shared, legacy, currentName, binding, sources, hooks, sharedSettings }
}

test('imports the provider-less product database sibling into the active DB layout without claiming shared settings', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.legacy, 'providers.json'), JSON.stringify({
    providers: [{ id: 'fixture', presetId: 'custom', apiKey: 'fake-key', models: { main: 'fixture', haiku: 'fixture', sonnet: 'fixture', opus: 'fixture' } }],
    activeId: 'fixture', extension: { keep: true },
  }))
  const database = openLocalIndexDatabase({ path: path.join(f.currentName, 'index-v1.sqlite') })
  database.write(sql => {
    sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'migration-evidence', 'preserved')
    sql.exec('CREATE TABLE unknown_product_extension (value TEXT); INSERT INTO unknown_product_extension VALUES (\'preserved\')')
  })
  database.close()
  await fs.writeFile(path.join(f.currentName, 'unknown-product-extension.bin'), 'owned opaque bytes')
  await fs.mkdir(f.binding.root, { recursive: true })
  await fs.writeFile(path.join(f.binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  await fs.writeFile(path.join(f.binding.root, 'history.jsonl'), 'existing target bytes\n')

  const sources = [...f.sources].reverse()
  const plan = await prepareStorageMigration({ binding: f.binding, sources })
  expect(plan.files).toBeGreaterThan(2)
  const result = await executeStorageMigration({ binding: f.binding, sources, hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')

  process.env.CLAUDE_CONFIG_DIR = f.binding.root
  const activeDatabase = getLocalIndexDatabasePath()
  expect(activeDatabase).toBe(path.join(f.binding.internalDir, 'db', 'index-v1.sqlite'))
  const migrated = new Database(activeDatabase, { readonly: true })
  try {
    expect(migrated.query('SELECT value FROM schema_meta WHERE key = ?').get('migration-evidence')).toEqual({ value: 'preserved' })
    expect(migrated.query('SELECT value FROM unknown_product_extension').get()).toEqual({ value: 'preserved' })
  } finally { migrated.close() }
  expect(await fs.readFile(path.join(f.binding.internalDir, 'unknown-product-extension.bin'), 'utf8')).toBe('owned opaque bytes')
  expect(await fs.readFile(path.join(f.binding.root, 'history.jsonl'), 'utf8')).toBe('existing target bytes\n')
  expect(await fs.readFile(path.join(f.shared, 'settings.json'), 'utf8')).toBe(f.sharedSettings)
  expect(await fs.readdir(f.shared)).toEqual(['settings.json'])
})

test('moves the legacy archive side table and marker together without reviving a restored session', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.shared, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  const state = JSON.stringify({ schemaVersion: 1, sessions: { restored: { archived: false, extension: 'keep' }, archived: { archived: true } } })
  const marker = JSON.stringify({ schemaVersion: 1, archiveStateRequired: true, extension: 'keep' })
  await fs.writeFile(path.join(f.legacy, 'session-archives.json'), state)
  await fs.writeFile(path.join(f.legacy, 'session-archives.legacy-jsonl-migration.json'), marker)

  const result = await executeStorageMigration({ binding: f.binding, sources: [f.sources[0]!], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  const snapshot = readSessionArchiveSnapshot(f.binding.root)
  expect(snapshot.migrationComplete).toBe(true)
  expect(resolveSessionArchive(snapshot, 'restored', true)).toBe(false)
  expect(resolveSessionArchive(snapshot, 'archived', false)).toBe(true)
  expect(await fs.readFile(path.join(f.binding.internalDir, 'session-archives.json'), 'utf8')).toBe(state)
  expect(await fs.readFile(path.join(f.binding.internalDir, 'session-archives.legacy-jsonl-migration.json'), 'utf8')).toBe(marker)
  expect(await fs.readFile(path.join(f.legacy, 'session-archives.json'), 'utf8')).toBe(state)
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.exists(f.legacy)).toBe(false)
  expect(readSessionArchiveSnapshot(f.binding.root).revision).toBe(snapshot.revision)
})

const archiveName = 'session-archives.json'
const markerName = 'session-archives.legacy-jsonl-migration.json'

async function archiveTarget(f: Awaited<ReturnType<typeof fixture>>) {
  await fs.mkdir(f.binding.internalDir, { recursive: true })
  const marker = JSON.stringify(buildEchoFlowOwnershipMarker())
  await fs.writeFile(path.join(f.binding.root, 'app.json'), marker)
  await fs.writeFile(path.join(f.shared, 'app.json'), marker)
}

async function legacyArchiveTranscript(root: string, id: string) {
  const directory = path.join(root, 'projects', 'fixture')
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, `${id}.jsonl`)
  await fs.writeFile(file, '{"type":"session-archive","archived":true}\n')
  return file
}

test('merges disjoint archive records and preserves both legacy completion receipts through recovery', async () => {
  const f = await fixture()
  await archiveTarget(f)
  const from = { schemaVersion: 0, sessions: { restored: { archived: false, extension: 'source' } }, sourceField: 1 }
  const into = { schemaVersion: 1, sessions: { archived: { archived: true, extension: 'target' } }, targetField: 2 }
  const marker = { schemaVersion: 1, archiveStateRequired: true }
  const sourceState = path.join(f.legacy, archiveName)
  const targetState = path.join(f.binding.internalDir, archiveName)
  await fs.writeFile(sourceState, JSON.stringify(from))
  await fs.writeFile(targetState, JSON.stringify(into))
  await fs.writeFile(path.join(f.legacy, markerName), JSON.stringify({ ...marker, sourceField: 1 }))
  const targetMarker = path.join(f.binding.internalDir, markerName)
  await fs.writeFile(targetMarker, JSON.stringify({ ...marker, targetField: 2 }))

  const sources = [f.sources[0]!]
  const stopped = await executeStorageMigration({ binding: f.binding, sources, hooks: {
    ...f.hooks, validateResources: async () => { throw new Error('fixture interrupted after publication') },
  } })
  expect(stopped.issues).toEqual(['fixture interrupted after publication'])
  expect(await fs.readFile(sourceState, 'utf8')).toBe(JSON.stringify(from))
  const result = await recoverStorageMigration(f.binding, f.hooks)
  expect(result.state).toBe('validation-required')
  const snapshot = readSessionArchiveSnapshot(f.binding.root)
  expect(snapshot.state).toEqual({ ...from, ...into, sessions: { ...from.sessions, ...into.sessions } })
  expect(resolveSessionArchive(snapshot, 'restored', true)).toBe(false)
  expect(await readSessionArchiveRetentionIds(f.binding.root)).toEqual(new Set(['archived']))
  expect(JSON.parse(await fs.readFile(targetMarker, 'utf8'))).toEqual({ ...marker, sourceField: 1, targetField: 2 })
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.exists(sourceState)).toBe(false)
  expect(await fs.readFile(path.join(f.binding.internalDir, 'migrations', result.id!, 'target-before', 'echoflow-code', archiveName), 'utf8')).toBe(JSON.stringify(into))
})

test('merges both archive namespaces inside a single owned profile', async () => {
  const f = await fixture()
  await archiveTarget(f)
  for (const [directory, id] of [[f.legacy, 'old'], [f.currentName, 'current']] as const) {
    await fs.writeFile(path.join(directory, archiveName), JSON.stringify({ schemaVersion: 1, sessions: { [id]: { archived: true } } }))
  }
  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: f.shared, markerRoot: f.shared }], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  expect(readSessionArchiveSnapshot(f.binding.root).ids).toEqual(new Set(['old', 'current']))
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
})

test('retains originals if a target archive companion disappears before acceptance', async () => {
  const f = await fixture()
  await archiveTarget(f)
  const source = path.join(f.legacy, markerName)
  const target = path.join(f.binding.internalDir, archiveName)
  const marker = JSON.stringify({ schemaVersion: 1, archiveStateRequired: false })
  await fs.writeFile(source, marker)
  await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, sessions: { existing: { archived: true } } }))
  const result = await executeStorageMigration({ binding: f.binding, sources: [f.sources[0]!], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  await fs.unlink(target)
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('blocked')
  expect(await fs.readFile(source, 'utf8')).toBe(marker)
})

test('keeps both originals when the archive choices for one session disagree', async () => {
  const f = await fixture()
  await archiveTarget(f)
  const source = path.join(f.legacy, archiveName)
  const target = path.join(f.binding.internalDir, archiveName)
  const state = (archived: boolean) => JSON.stringify({ schemaVersion: 1, sessions: { shared: { archived } } })
  await fs.writeFile(source, state(true))
  await fs.writeFile(target, state(false))
  const result = await executeStorageMigration({ binding: f.binding, sources: [f.sources[0]!], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join('; ')).toMatch(/session-archives\.json\.sessions\.shared\.archived/)
  expect(await fs.readFile(source, 'utf8')).toBe(state(true))
  expect(await fs.readFile(target, 'utf8')).toBe(state(false))
})

test('keeps both transcripts when unmarked roots disagree on the same session archive state', async () => {
  const f = await fixture()
  await archiveTarget(f)
  const source = path.join(f.home, 'owned-profile')
  const original = await legacyArchiveTranscript(source, 'duplicate')
  await fs.copyFile(path.join(f.binding.root, 'app.json'), path.join(source, 'app.json'))
  const restored = '{"type":"session-archive","archived":false}\n'
  const targetProject = path.join(f.binding.root, 'projects', 'another-project')
  await fs.mkdir(targetProject, { recursive: true })
  const target = path.join(targetProject, 'duplicate.jsonl')
  await fs.writeFile(target, restored)

  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: source, markerRoot: source }], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues).toContain('Conflicting legacy session archive states; originals retained')
  expect(await fs.readFile(original, 'utf8')).toBe('{"type":"session-archive","archived":true}\n')
  expect(await fs.readFile(target, 'utf8')).toBe(restored)
  expect(await fs.exists(path.join(f.binding.root, path.relative(source, original)))).toBe(false)
})

test('migrates unmarked roots without parsing unrelated destination transcripts', async () => {
  const f = await fixture()
  await archiveTarget(f)
  const source = path.join(f.home, 'owned-profile')
  const original = await legacyArchiveTranscript(source, 'duplicate')
  await fs.copyFile(path.join(f.binding.root, 'app.json'), path.join(source, 'app.json'))
  const targetProject = path.join(f.binding.root, 'projects', 'another-project')
  await fs.mkdir(targetProject, { recursive: true })
  await fs.copyFile(original, path.join(targetProject, 'duplicate.jsonl'))
  const target = path.join(f.binding.root, path.relative(source, original))
  const unrelated = path.join(targetProject, 'unrelated.jsonl')
  const truncated = '{"type":"assistant"'
  await fs.writeFile(unrelated, truncated)

  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: source, markerRoot: source }], hooks: f.hooks })
  expect(result.issues).toEqual([])
  expect(result.state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.readFile(target, 'utf8')).toBe('{"type":"session-archive","archived":true}\n')
  expect(await fs.readFile(unrelated, 'utf8')).toBe(truncated)
  expect(await fs.exists(original)).toBe(false)
  expect(await fs.exists(path.join(f.binding.internalDir, markerName))).toBe(false)
})

for (const [scan, nonFileId, blocked] of [
  ['markerless scan with a unique incoming session', 'unrelated', false],
  ['markerless scan with a matching destination session', 'incoming', true],
  ['marker-required full scan', 'unrelated', true],
] as const) {
  for (const kind of ['directory', 'symlink'] as const) {
    test.skipIf(kind === 'symlink' && process.platform === 'win32')(`${scan} handles a destination .jsonl ${kind}`, async () => {
      const f = await fixture()
      await archiveTarget(f)
      const source = path.join(f.home, 'owned-profile')
      const original = await legacyArchiveTranscript(source, 'incoming')
      await fs.copyFile(path.join(f.binding.root, 'app.json'), path.join(source, 'app.json'))
      if (scan === 'marker-required full scan') {
        const internal = path.join(source, 'cc-haha')
        await fs.mkdir(internal)
        await fs.writeFile(path.join(internal, archiveName), JSON.stringify({ schemaVersion: 1, sessions: {} }))
        await fs.writeFile(path.join(internal, markerName), JSON.stringify({ schemaVersion: 1, archiveStateRequired: true }))
      }
      const targetProject = path.join(f.binding.root, 'projects', 'another-project')
      await fs.mkdir(targetProject, { recursive: true })
      const nonFile = path.join(targetProject, `${nonFileId}.jsonl`)
      if (kind === 'directory') await fs.mkdir(nonFile)
      else await fs.symlink(path.join(f.shared, 'settings.json'), nonFile, 'file')

      const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: source, markerRoot: source }], hooks: f.hooks })
      const incoming = path.join(f.binding.root, path.relative(source, original))
      const transcript = '{"type":"session-archive","archived":true}\n'
      if (blocked) {
        expect(result.state).toBe('blocked')
        expect(result.issues).toContain('Cannot migrate archives from a non-file transcript')
        expect(await fs.readFile(original, 'utf8')).toBe(transcript)
        expect(await fs.exists(incoming)).toBe(false)
      } else {
        expect(result.issues).toEqual([])
        expect(result.state).toBe('validation-required')
        expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
        expect(await fs.readFile(incoming, 'utf8')).toBe(transcript)
        expect(await fs.exists(original)).toBe(false)
      }
      const entry = await fs.lstat(nonFile)
      expect(kind === 'directory' ? entry.isDirectory() : entry.isSymbolicLink()).toBe(true)
      expect(await fs.exists(path.join(f.binding.internalDir, archiveName))).toBe(false)
      expect(await fs.exists(path.join(f.binding.internalDir, markerName))).toBe(false)
    })
  }
}

for (const marked of ['source', 'target'] as const) {
  test(`applies the ${marked} archive marker only to transcripts from its own root`, async () => {
    const f = await fixture()
    await archiveTarget(f)
    const source = path.join(f.home, 'owned-profile')
    const sourceInternal = path.join(source, 'cc-haha')
    await fs.mkdir(sourceInternal, { recursive: true })
    await fs.copyFile(path.join(f.binding.root, 'app.json'), path.join(source, 'app.json'))
    const sourceFile = await legacyArchiveTranscript(source, 'source')
    const targetFile = await legacyArchiveTranscript(f.binding.root, 'target')
    const marker = { schemaVersion: 1, archiveStateRequired: false, futureField: true }
    await fs.writeFile(path.join(marked === 'source' ? sourceInternal : f.binding.internalDir, markerName), JSON.stringify(marker))
    const archiveState = path.join(f.binding.internalDir, archiveName)
    const markerPath = path.join(f.binding.internalDir, markerName)
    const interrupted = await executeStorageMigration({ binding: f.binding, sources: [{ directory: source, markerRoot: source }], hooks: {
      ...f.hooks,
      assertQuiescent: async () => {
        if (await fs.exists(archiveState)) throw new Error('fixture stopped before marker publication')
      },
    } })
    expect(interrupted.issues).toEqual(['fixture stopped before marker publication'])
    expect(await fs.exists(sourceFile)).toBe(true)
    if (marked === 'source') expect(await fs.exists(markerPath)).toBe(false)
    else expect(JSON.parse(await fs.readFile(markerPath, 'utf8'))).toEqual(marker)
    const result = await recoverStorageMigration(f.binding, f.hooks)
    expect(result).toMatchObject({ id: interrupted.id, state: 'validation-required' })
    const unmarked = marked === 'source' ? 'target' : 'source'
    const snapshot = readSessionArchiveSnapshot(f.binding.root)
    expect(resolveSessionArchive(snapshot, marked, true)).toBe(false)
    expect(resolveSessionArchive(snapshot, unmarked, true)).toBe(true)
    expect(await readSessionArchiveRetentionIds(f.binding.root)).toEqual(new Set([unmarked]))
    expect(JSON.parse(await fs.readFile(path.join(f.binding.internalDir, markerName), 'utf8'))).toEqual({ ...marker, archiveStateRequired: true })
    expect(await fs.readFile(path.join(f.binding.root, path.relative(source, sourceFile)), 'utf8')).toBe(await fs.readFile(sourceFile, 'utf8'))
    expect(await fs.readFile(targetFile, 'utf8')).toBe('{"type":"session-archive","archived":true}\n')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    expect(await fs.exists(sourceFile)).toBe(false)
  })
}

test('a different database at the active path blocks rather than leaving a second unread database layout', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.legacy, 'providers.json'), JSON.stringify({
    providers: [{ id: 'fixture', presetId: 'custom', apiKey: 'fake-key', models: { main: 'fixture', haiku: 'fixture', sonnet: 'fixture', opus: 'fixture' } }],
    activeId: 'fixture',
  }))
  await fs.mkdir(path.join(f.binding.internalDir, 'db'), { recursive: true })
  await fs.writeFile(path.join(f.binding.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  const sourcePath = path.join(f.currentName, 'index-v1.sqlite')
  const targetPath = path.join(f.binding.internalDir, 'db', 'index-v1.sqlite')
  for (const [file, value] of [[sourcePath, 'source'], [targetPath, 'target']] as const) {
    const database = openLocalIndexDatabase({ path: file })
    database.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'migration-evidence', value))
    database.close()
  }
  const sourceBefore = await fs.readFile(sourcePath)
  const targetBefore = await fs.readFile(targetPath)
  const result = await executeStorageMigration({ binding: f.binding, sources: f.sources, hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join('; ')).toMatch(/conflict/i)
  expect(await fs.readFile(sourcePath)).toEqual(sourceBefore)
  expect(await fs.readFile(targetPath)).toEqual(targetBefore)
  expect(await fs.exists(path.join(f.binding.internalDir, 'index-v1.sqlite'))).toBe(false)
})

test('ownership preview reads a private committed WAL snapshot without changing source DB, WAL or SHM', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.legacy, 'providers.json'), JSON.stringify({ providers: [], activeId: null }))
  const database = openLocalIndexDatabase({ path: path.join(f.currentName, 'index-v1.sqlite') })
  database.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'wal-only', 'preserve'))
  try {
    const files = (await fs.readdir(f.currentName)).sort()
    expect(files).toContain('index-v1.sqlite-wal')
    expect(files).toContain('index-v1.sqlite-shm')
    const snapshots = await Promise.all(files.map(async name => {
      const file = path.join(f.currentName, name)
      const stat = await fs.stat(file, { bigint: true })
      return { file, bytes: await fs.readFile(file), mode: stat.mode, mtime: stat.mtimeNs, ctime: stat.ctimeNs }
    }))
    expect((await prepareStorageMigration({ binding: f.binding, sources: f.sources })).files).toBeGreaterThan(2)
    expect((await fs.readdir(f.currentName)).sort()).toEqual(files)
    for (const snapshot of snapshots) {
      expect(await fs.readFile(snapshot.file)).toEqual(snapshot.bytes)
      const stat = await fs.stat(snapshot.file, { bigint: true })
      expect({ mode: stat.mode, mtime: stat.mtimeNs, ctime: stat.ctimeNs }).toEqual({ mode: snapshot.mode, mtime: snapshot.mtime, ctime: snapshot.ctime })
    }
    expect(await fs.exists(f.binding.root)).toBe(false)
    expect(await fs.exists(path.join(f.shared, 'app.json'))).toBe(false)
  } finally { database.close() }
})

for (const evidence of ['no-provider-sibling', 'foreign-database', 'table-names-only', 'partial-product-schema', 'future-database'] as const) {
  test(`rejects provider-less ownership with ${evidence} and preserves all originals`, async () => {
    const f = await fixture()
    await fs.writeFile(path.join(f.legacy, 'providers.json'), JSON.stringify({ providers: [], activeId: null }))
    const file = path.join(f.currentName, 'index-v1.sqlite')
    if (evidence === 'foreign-database' || evidence === 'table-names-only') {
      const database = new Database(file)
      try {
        database.exec('PRAGMA user_version = 8; CREATE TABLE unrelated_fixture (value TEXT)')
        if (evidence === 'table-names-only') database.exec('CREATE TABLE schema_meta (value TEXT); CREATE TABLE source_files (value TEXT); CREATE TABLE backfill_state (value TEXT)')
      } finally { database.close() }
    } else {
      openLocalIndexDatabase({ path: file }).close()
      if (evidence === 'future-database' || evidence === 'partial-product-schema') {
        const database = new Database(file)
        try { database.exec(evidence === 'future-database' ? 'PRAGMA user_version = 999' : 'DROP TABLE sessions') } finally { database.close() }
      }
    }
    const original = await fs.readFile(file)
    const sources = evidence === 'no-provider-sibling' ? [f.sources[1]!] : f.sources
    await expect(prepareStorageMigration({ binding: f.binding, sources })).rejects.toThrow(/Unproven legacy product/)
    const result = await executeStorageMigration({ binding: f.binding, sources, hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(await fs.readFile(file)).toEqual(original)
    expect(await fs.readFile(path.join(f.shared, 'settings.json'), 'utf8')).toBe(f.sharedSettings)
    expect(await fs.exists(path.join(f.shared, 'app.json'))).toBe(false)
    expect(await fs.exists(path.join(f.binding.internalDir, 'db', 'index-v1.sqlite'))).toBe(false)
  })
}

test('a namespace name and arbitrary SQLite database alone never prove product ownership', async () => {
  const f = await fixture()
  const database = new Database(path.join(f.currentName, 'index-v1.sqlite'))
  database.exec('CREATE TABLE unrelated_fixture (value TEXT)')
  database.close()
  await expect(prepareStorageMigration({ binding: f.binding, sources: [f.sources[1]!] })).rejects.toThrow()
  expect(await fs.readFile(path.join(f.shared, 'settings.json'), 'utf8')).toBe(f.sharedSettings)
  expect(await fs.exists(path.join(f.currentName, 'index-v1.sqlite'))).toBe(true)
  expect(await fs.exists(path.join(f.shared, 'app.json'))).toBe(false)
})
