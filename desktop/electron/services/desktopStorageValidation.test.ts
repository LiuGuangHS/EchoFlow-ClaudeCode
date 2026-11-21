// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { executeStorageMigration } from '../../../src/services/storageMigration'
import { CURRENT_PROVIDER_INDEX_SCHEMA_VERSION } from '../../../src/server/services/persistentStorageMigrations'
import { APP_ZOOM_STORAGE_KEY, LEGACY_UI_ZOOM_STORAGE_KEY } from '../../src/lib/appZoom'
import { CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION, DESKTOP_PERSISTENCE_VERSION_KEY, runDesktopPersistenceMigrations } from '../../src/lib/persistenceMigrations'
import { WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_VERSION } from '../../src/lib/workspace/storageKey'
import { assertDesktopStoragePreserved, createDesktopStorageHooks, runRestrictedStorageChild, validateDesktopSQLite, validateDesktopStorageSnapshot, validateRestrictedDesktopStorage, type NativeStorageSnapshot } from './desktopStorageValidation'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function fixture(): Promise<string> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-native-validation-')))
  directories.push(directory)
  return directory
}
function snapshot(localStorage: Record<string, string> = {}): NativeStorageSnapshot { return { localStorage, indexedDB: [] } }
async function digest(file: string) { return createHash('sha256').update(await fs.readFile(file)).digest('hex') }

describe('production desktop storage validators', () => {
  it('wires the production JSON schema owner and rejects a future provider schema', async () => {
    const binding = resolveStorageBinding({ env: {}, roots: [await fixture()] })
    const hooks = createDesktopStorageHooks(binding)
    const upgraded = hooks.upgradeJson!('echoflow-code/providers.json', { schemaVersion: 1, providers: [], activeId: null, unknown: { preserved: true } }) as Record<string, unknown>
    expect(upgraded.schemaVersion).toBe(CURRENT_PROVIDER_INDEX_SCHEMA_VERSION)
    expect(upgraded.unknown).toEqual({ preserved: true })
    expect(() => hooks.upgradeJson!('echoflow-code/providers.json', { schemaVersion: 999, providers: [] })).toThrow(/schema/)
    expect(hooks.permissions?.preflight).toBeTypeOf('function')
    if (process.platform !== 'darwin') expect(hooks.prepareResources).toBeUndefined()
  })

  it('validates real SQLite WAL records without changing any frozen bytes', async () => {
    const directory = await fixture()
    const database = path.join(directory, 'saved.sqlite')
    const writer = new DatabaseSync(database)
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE saved (value TEXT); INSERT INTO saved VALUES ('retained')")
    const frozen = path.join(directory, 'frozen')
    await fs.mkdir(frozen)
    for (const suffix of ['', '-wal', '-shm']) await fs.copyFile(database + suffix, path.join(frozen, 'saved.sqlite') + suffix)
    writer.close()
    const files = await fs.readdir(frozen)
    const before = await Promise.all(files.map(name => digest(path.join(frozen, name))))
    await validateDesktopSQLite(path.join(frozen, 'saved.sqlite'), copy => {
      expect(copy).not.toBe(path.join(frozen, 'saved.sqlite'))
      const consumer = new DatabaseSync(copy, { readOnly: true })
      try { expect(consumer.prepare('SELECT value FROM saved').get()).toEqual({ value: 'retained' }) } finally { consumer.close() }
    })
    await expect(validateDesktopSQLite(path.join(frozen, 'saved.sqlite'), () => { throw new Error('consumer rejected snapshot') })).rejects.toThrow('consumer rejected snapshot')
    expect(await fs.readdir(frozen)).toEqual(files)
    expect(await Promise.all(files.map(name => digest(path.join(frozen, name))))).toEqual(before)
    const reader = new DatabaseSync(path.join(frozen, 'saved.sqlite'), { readOnly: true })
    try { expect(reader.prepare('SELECT value FROM saved').get()).toEqual({ value: 'retained' }) } finally { reader.close() }
  })

  it('rejects corrupt SQLite and removes its disposable snapshot', async () => {
    const directory = await fixture()
    const file = path.join(directory, 'broken.sqlite')
    await fs.writeFile(file, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(1024, 0xff)]))
    await expect(validateDesktopSQLite(file)).rejects.toThrow()
    expect(await fs.readdir(directory)).toEqual(['broken.sqlite'])
  })

  it('rejects linked SQLite inputs without following them', async () => {
    const directory = await fixture()
    const original = path.join(directory, 'original')
    await fs.writeFile(original, 'not a database')
    const linked = path.join(directory, 'linked')
    await fs.symlink(original, linked)
    await expect(validateDesktopSQLite(linked)).rejects.toThrow(/independent/)
    expect(await fs.readFile(original, 'utf8')).toBe('not a database')
  })

  it('consumes saved current-schema values while retaining unknown fields and input bytes', () => {
    const stored = snapshot({ [DESKTOP_PERSISTENCE_VERSION_KEY]: String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION),
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({ version: WORKSPACE_STORAGE_VERSION, sessions: { saved: { tabs: [{ id: 'file', kind: 'file', path: '/fixture', unknown: true }] } }, unknown: { keep: [1, 2] } }),
      'cc-haha-open-target-preferences': '{"editor":"vscode","unknown":{"keep":true}}',
      'third-party-key': '{"unknown":true}', 'opaque-value': 'retained',
    })
    const before = JSON.stringify(stored)
    validateDesktopStorageSnapshot(stored)
    expect(JSON.stringify(stored)).toBe(before)
  })

  it('allows the workspace owner to advance v1 metadata while retaining saved tabs and unknown fields', () => {
    const workspace = { version: 1, unknown: { keep: true }, sessions: { saved: { unknown: 'kept', tabs: [
      { id: 'file', kind: 'file', path: '/fixture', unknown: { preserved: true } },
      { id: 'review', kind: 'review', unknown: [1, 2] },
    ] } } }
    const stored = snapshot({ [WORKSPACE_STORAGE_KEY]: JSON.stringify(workspace) })
    const before = JSON.stringify(stored)
    expect(() => validateDesktopStorageSnapshot(stored)).not.toThrow()
    expect(JSON.stringify(stored)).toBe(before)
    const stale = { ...workspace, sessions: { saved: { tabs: [...workspace.sessions.saved.tabs, { id: 'stale', kind: 'terminal', runtimeId: 'not-live', unknown: true }] } } }
    expect(() => validateDesktopStorageSnapshot(snapshot({ [WORKSPACE_STORAGE_KEY]: JSON.stringify(stale) }))).toThrow(/discard/)
  })

  it('allows legacy UI zoom retirement only when its value survives in canonical app zoom', () => {
    const stored = snapshot({ [LEGACY_UI_ZOOM_STORAGE_KEY]: '1.25' })
    expect(() => validateDesktopStorageSnapshot(stored)).not.toThrow()
    expect(stored.localStorage).toEqual({ [LEGACY_UI_ZOOM_STORAGE_KEY]: '1.25' })

    const values = new Map(Object.entries(stored.localStorage))
    const report = runDesktopPersistenceMigrations({
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: key => { values.delete(key) },
    })
    expect(report.status).toBe('completed')
    expect(values.get(APP_ZOOM_STORAGE_KEY)).toBe('1.25')
    expect(values.has(LEGACY_UI_ZOOM_STORAGE_KEY)).toBe(false)
    expect(() => validateDesktopStorageSnapshot(snapshot({ ...stored.localStorage, 'cc-haha-open-tabs': '{broken' }))).toThrow(/discard/)
    expect(() => validateDesktopStorageSnapshot(snapshot({ [LEGACY_UI_ZOOM_STORAGE_KEY]: '4' }))).toThrow(/discard/)
    expect(() => validateDesktopStorageSnapshot(snapshot({ [LEGACY_UI_ZOOM_STORAGE_KEY]: '1.25', [APP_ZOOM_STORAGE_KEY]: '1.5' }))).toThrow(/discard/)
    expect(() => validateDesktopStorageSnapshot(snapshot({ [LEGACY_UI_ZOOM_STORAGE_KEY]: '1.251', [APP_ZOOM_STORAGE_KEY]: '1.25' }))).not.toThrow()
  })

  it.each(['999', '-1', 'corrupt'])('blocks unsupported desktop schema %s rather than pretending the getter succeeded', version => {
    expect(() => validateDesktopStorageSnapshot(snapshot({ [DESKTOP_PERSISTENCE_VERSION_KEY]: version }))).toThrow(/schema/)
  })

  it('rejects a pending preference copy whose destination is missing without changing the snapshot', () => {
    const stored = snapshot({
      'echoflow-code-app-zoom': '1.25',
      [`cc-haha.persistence.legacyCopied.${APP_ZOOM_STORAGE_KEY}`]: 'pending',
    })
    const before = JSON.stringify(stored)
    expect(() => validateDesktopStorageSnapshot(stored)).toThrow(/persistence migration.*blocked/)
    expect(JSON.stringify(stored)).toBe(before)
  })

  it('blocks corrupt saved JSON, destructive normalization and future workspace versions', () => {
    expect(() => validateDesktopStorageSnapshot(snapshot({ 'cc-haha-open-tabs': '{broken' }))).toThrow(/discard/)
    expect(() => validateDesktopStorageSnapshot(snapshot({ 'cc-haha-session-runtime': '{"saved":{"modelId":"a","providerId":null,"unknown":true},"broken":{}}' }))).toThrow(/discard/)
    expect(() => validateDesktopStorageSnapshot(snapshot({ [WORKSPACE_STORAGE_KEY]: '{"version":999,"sessions":{}}' }))).toThrow(/schema/)
  })

  it('requires every original localStorage value and IDB schema, record and count', () => {
    const source: NativeStorageSnapshot = { localStorage: { saved: 'value' }, indexedDB: [{ name: 'saved', version: 2, stores: [{ name: 'records', keyPath: 'id', autoIncrement: false, indexes: [], records: [{ id: 1, unknown: 'kept' }] }] }] }
    const target = structuredClone(source)
    target.localStorage.extra = 'allowed'
    expect(() => assertDesktopStoragePreserved(source, target)).not.toThrow()
    target.indexedDB[0]!.stores[0]!.records = []
    expect(() => assertDesktopStoragePreserved(source, target)).toThrow(/IndexedDB/)
    expect(() => assertDesktopStoragePreserved(source, snapshot())).toThrow(/localStorage/)
  })

  it('never opens selective shared parents or archived roots as complete Chromium profiles', async () => {
    const home = await fixture()
    const root = path.join(home, 'selected')
    const shared = path.join(home, '.claude')
    const old = path.join(home, 'obsolete-root')
    const binding = resolveStorageBinding({ env: {}, roots: [root] })
    for (const directory of [shared, old]) {
      await fs.mkdir(path.join(directory, 'Partitions'), { recursive: true })
      await fs.writeFile(path.join(directory, 'Partitions/foreign'), 'foreign partition, never opened')
    }
    await fs.writeFile(path.join(old, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
    await fs.writeFile(path.join(shared, 'terminal-config.json'), '{"bash_path":null,"future":7}')
    const receiptFile = path.join(shared, 'data-migration-v1.json')
    await fs.writeFile(receiptFile, '{"version":1,"unknown":7}')
    const stat = await fs.lstat(receiptFile, { bigint: true })
    const result = await executeStorageMigration({ binding, sources: [
      { directory: shared, markerRoot: shared, layout: 'desktop-state' },
      { directory: shared, markerRoot: shared, layout: 'legacy-controls', controls: { 'data-migration-v1.json': { digest: await digest(receiptFile), dev: String(stat.dev), ino: String(stat.ino) } } },
      { directory: old, markerRoot: old, archive: true },
    ], hooks: { platform: 'linux', assertQuiescent: async () => {} } })
    expect(result.state).toBe('validation-required')
    const childEntry = path.join(home, 'app/electron/storage-validation.cjs')
    await fs.mkdir(path.dirname(childEntry), { recursive: true })
    // Offline protocol fixture only; this is not evidence of a native Chromium read.
    await fs.writeFile(childEntry, `const fs = require('node:fs'); const path = require('node:path');
      const request = JSON.parse(fs.readFileSync(process.argv.find(arg => arg.startsWith('--echoflow-storage-validation-request=')).split('=').slice(1).join('='), 'utf8'));
      fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify(request.profile) + '\\n');
      fs.writeFileSync(path.join(request.directory, 'result.json'), JSON.stringify({ localStorage: {}, indexedDB: [] }));`)
    await validateRestrictedDesktopStorage(binding, { executable: process.execPath, childEntry })
    const calls = (await fs.readFile(path.join(path.dirname(childEntry), 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(`${path.sep}published${path.sep}profile`)
    expect(await fs.readFile(path.join(shared, 'Partitions/foreign'), 'utf8')).toBe('foreign partition, never opened')
  })

  it.skipIf(process.platform !== 'linux').each([undefined, '', 'session/Xauthority', '/fixture/alias/../Xauthority'])('keeps Linux display access under the isolated home with XAUTHORITY=%s', async authority => {
    const parentHome = await fixture()
    const directory = await fixture()
    const profile = path.join(directory, 'profile')
    await fs.mkdir(profile)
    const entry = path.join(directory, 'reader.cjs')
    await fs.writeFile(entry, `const { env } = process;
      require('node:fs').writeFileSync('result.json', JSON.stringify({ localStorage: {
        home: env.HOME, authority: env.XAUTHORITY, display: env.DISPLAY, privateValue: env.ECHOFLOW_VALIDATION_TEST_SECRET,
      }, indexedDB: [] }));`)
    const env = { HOME: parentHome, DISPLAY: ':123', XAUTHORITY: authority, ECHOFLOW_VALIDATION_TEST_SECRET: 'fixture-only' }
    const original = Object.keys(env).map(key => [key, process.env[key]] as const)
    try {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      // Bun can cache the process home at startup, while Node uses the current HOME.
      const expected = authority === undefined ? path.join(os.homedir(), '.Xauthority') : authority === 'session/Xauthority' ? path.join(process.cwd(), authority) : authority
      await expect(runRestrictedStorageChild({ version: 1, directory, profile, url: 'file:///fixture.html' }, process.execPath, entry))
        .resolves.toEqual(snapshot({ home: path.join(directory, 'home'), authority: expected, display: ':123' }))
    } finally {
      for (const [key, value] of original) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('refuses to run a native reader outside an actual migration transaction', async () => {
    const root = await fixture()
    await expect(validateRestrictedDesktopStorage(resolveStorageBinding({ env: {}, roots: [root] }))).rejects.toThrow(/current published/)
    expect(await fs.readdir(root)).toEqual([])
  })
})
