import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot'
import { acquireStorageWriter, completeStorageMigration, executeStorageMigration, legacyStorageArchive, readConsumedStorageControls, recoverStorageMigration, type StorageMigrationHooks, type StorageMigrationSource } from './storageMigration'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }) })
async function fixture() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'storage-selective-')))
  homes.push(home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'selected')] })
  const shared = path.join(home, '.claude')
  const put = async (directory: string, name: string, value: string) => {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await fs.writeFile(path.join(directory, name), value)
  }
  const own = async (directory: string) => put(directory, 'app.json', JSON.stringify(buildEchoFlowOwnershipMarker()))
  const controls = async (directory: string): Promise<StorageMigrationSource['controls']> => {
    const file = path.join(directory, 'data-migration-v1.json')
    const stat = await fs.lstat(file, { bigint: true })
    return { 'data-migration-v1.json': { dev: String(stat.dev), ino: String(stat.ino), digest: createHash('sha256').update(await fs.readFile(file)).digest('hex') } }
  }
  const hooks: StorageMigrationHooks = { platform: 'linux', assertQuiescent: async () => {} }
  return { home, binding, shared, put, own, controls, hooks }
}

test('in-place v1 evidence is byte-preserved in backup/history, never an active control or whole-root relocation', async () => {
  const f = await fixture()
  await f.own(f.binding.root)
  const raw = '{ "version":1, "oldMode":"{ \\"future\\": 7 }", "unknown": [1,2] }\n'
  await f.put(f.binding.root, 'data-migration-v1.json', raw)
  await f.put(f.binding.root, 'projects/current.jsonl', 'current data')
  const source: StorageMigrationSource = { directory: f.binding.root, markerRoot: f.binding.root, layout: 'legacy-controls', controls: await f.controls(f.binding.root) }
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  expect(await fs.readFile(path.join(f.binding.internalDir, 'migrations', result.id!, 'sources/0/data-migration-v1.json'), 'utf8')).toBe(raw)
  expect(await fs.readFile(path.join(f.binding.root, legacyStorageArchive(f.binding.root), 'data-migration-v1.json'), 'utf8')).toBe(raw)
  expect(await fs.readFile(path.join(f.binding.root, 'data-migration-v1.json'), 'utf8')).toBe(raw)
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.exists(path.join(f.binding.root, 'data-migration-v1.json'))).toBe(false)
  expect(await fs.readFile(path.join(f.binding.root, 'projects/current.jsonl'), 'utf8')).toBe('current data')
  expect(JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'storage-relocations.json'), 'utf8')).mappings).toEqual([])
  expect(await readConsumedStorageControls(f.binding)).toMatchObject([{ directory: f.binding.root, name: 'data-migration-v1.json' }])
  const lease = await acquireStorageWriter(f.binding)
  await lease.release()
})

test('selective state validates every recognized file and preserves unrelated parent files', async () => {
  const f = await fixture()
  const bytes = '{"bash_path":null,"future":{"keep":true}}\n'
  await f.put(f.shared, 'terminal-config.json', bytes)
  await f.put(f.shared, 'appearance-state.json', '{"isDark":true,"followSystem":false,"background":"#201D17","lightBackground":"#FFFFFF","future":7}')
  await f.put(f.shared, 'settings.json', '{"foreign":true}')
  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: f.shared, markerRoot: f.shared, layout: 'desktop-state' }], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.readFile(path.join(f.binding.root, 'terminal-config.json'), 'utf8')).toBe(bytes)
  expect(await fs.readFile(path.join(f.shared, 'settings.json'), 'utf8')).toBe('{"foreign":true}')
  expect(await fs.readdir(f.shared)).toEqual(['settings.json'])
  await f.put(f.shared, 'terminal-config.json', bytes)
  expect((await recoverStorageMigration(f.binding, f.hooks)).issues.join()).toContain('Retired legacy file')
})

test.each(['{"foreign":true}', '{"x":0,"y":0,"width":"1280","height":820,"maximized":false}'])('malformed or unproven shared state blocks without deleting it: %s', async raw => {
  const f = await fixture()
  await f.put(f.shared, 'window-state.json', raw)
  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: f.shared, markerRoot: f.shared, layout: 'desktop-state' }], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join()).toContain('Unproven legacy desktop state')
  expect(await fs.readFile(path.join(f.shared, 'window-state.json'), 'utf8')).toBe(raw)
  expect(await fs.exists(path.join(f.binding.root, 'window-state.json'))).toBe(false)
})

test('same-byte receipt replacement after inspection fails its frozen file identity', async () => {
  const f = await fixture()
  await f.put(f.shared, 'data-migration-v1.json', '{"version":1,"future":7}')
  const source: StorageMigrationSource = { directory: f.shared, markerRoot: f.shared, layout: 'legacy-controls', controls: await f.controls(f.shared) }
  await fs.rename(path.join(f.shared, 'data-migration-v1.json'), path.join(f.shared, 'original'))
  await f.put(f.shared, 'data-migration-v1.json', '{"version":1,"future":7}')
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  expect(result.state).toBe('blocked')
  expect(result.issues.join()).toContain('changed after inspection')
  expect(await fs.readFile(path.join(f.shared, 'original'), 'utf8')).toBe('{"version":1,"future":7}')
})

test('late evidence writes leave cleanup pending and never remove the shared parent or changed receipt', async () => {
  const f = await fixture()
  const raw = '{"version":1,"future":7}'
  await f.put(f.shared, 'data-migration-v1.json', raw)
  await f.put(f.shared, 'sentinel', 'foreign')
  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: f.shared, markerRoot: f.shared, layout: 'legacy-controls', controls: await f.controls(f.shared) }], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  await f.put(f.shared, 'data-migration-v1.json', 'late writer')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('cleanup-pending')
  expect(await fs.readFile(path.join(f.shared, 'data-migration-v1.json'), 'utf8')).toBe('late writer')
  expect(await fs.readFile(path.join(f.shared, 'sentinel'), 'utf8')).toBe('foreign')
  expect(await fs.readFile(path.join(f.binding.internalDir, 'migrations', result.id!, 'sources/0/data-migration-v1.json'), 'utf8')).toBe(raw)
  await expect(acquireStorageWriter(f.binding)).rejects.toThrow('cleanup-pending')
})

test('obsolete dedicated v1 roots are opaque history, not transformed or merged with the selected root', async () => {
  const f = await fixture()
  const old = path.join(f.home, 'old-product')
  await f.own(old)
  await f.put(old, 'providers.json', '{"future":"not an active provider schema"}')
  await f.put(old, 'broken.sqlite', 'SQLite format 3\0not a database')
  await f.put(old, 'plugins/known_marketplaces.json', '{"absolute":"' + old + '"}')
  await f.own(f.binding.root)
  await f.put(f.binding.root, 'providers.json', '{"active":"newer"}')
  f.hooks.validateSQLite = async () => { throw new Error('archive is not a database owner') }
  f.hooks.upgradeJson = () => { throw new Error('archive is not a schema owner') }
  const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory: old, markerRoot: old, archive: true }], hooks: f.hooks })
  expect(result.state).toBe('validation-required')
  expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.readFile(path.join(f.binding.root, legacyStorageArchive(old), 'plugins/known_marketplaces.json'), 'utf8')).toBe('{"absolute":"' + old + '"}')
  expect(await fs.readFile(path.join(f.binding.root, 'providers.json'), 'utf8')).toBe('{"active":"newer"}')
  expect(await fs.exists(old)).toBe(false)
  expect(JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'storage-relocations.json'), 'utf8')).mappings).toEqual([])
})
