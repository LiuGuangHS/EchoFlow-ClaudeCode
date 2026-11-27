import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot'
import { executeStorageMigration, recoverStorageMigration, completeStorageMigration, acquireStorageWriter, prepareStorageMigration, selectStartupStorage, storageLocationFile, type StorageMigrationHooks } from './storageMigration'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-transaction-'))
  directories.push(home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'current')] })
  async function owned(name: string, files: Record<string, string>) {
    const directory = path.join(home, name)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker(), null, 2) + '\n')
    for (const [relative, bytes] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true })
      await fs.writeFile(path.join(directory, relative), bytes)
    }
    return { directory, markerRoot: directory }
  }
  const hooks: StorageMigrationHooks = { assertQuiescent: async () => {}, platform: 'linux' }
  return { home, binding, owned, hooks }
}

test.each(['backup', 'publication'])('persists every new %s ancestor link before accepting source cleanup', async stage => {
  const f = await fixture()
  const source = await f.owned('old', { 'uploads/a/b/file.bin': 'original bytes' })
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
  const script = `
    import nativeFs from 'node:fs/promises'
    import path from 'node:path'
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    const created = new Map(), synced = new Map()
    const mkdir = nativeFs.mkdir, open = nativeFs.open
    let sequence = 0
    const patched = { ...nativeFs,
      mkdir: async (directory, ...args) => {
        const missing = []
        for (let current = String(directory);; current = path.dirname(current)) {
          try { await nativeFs.lstat(current); break } catch (error) { if (error.code !== 'ENOENT') throw error }
          missing.push(current)
        }
        const result = await mkdir(directory, ...args)
        for (const current of missing) created.set(current, ++sequence)
        return result
      },
      open: async (file, ...args) => {
        const handle = await open(file, ...args)
        return new Proxy(handle, { get(object, key) {
          if (key === 'sync') return async () => { await object.sync(); synced.set(String(file), ++sequence) }
          const value = Reflect.get(object, key)
          return typeof value === 'function' ? value.bind(object) : value
        } })
      }
    }
    mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
    const core = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))})
    const binding = ${JSON.stringify(f.binding)}
    const assertLinks = directory => {
      for (let current = directory; current !== binding.root; current = path.dirname(current)) {
        if (created.has(current)) assert.ok((synced.get(path.dirname(current)) ?? 0) > created.get(current), 'Unsynced ancestor link: ' + current)
      }
    }
    const hooks = { platform: 'linux', assertQuiescent: async () => {}, prepareResources: async transaction => {
      if (${JSON.stringify(stage)} === 'backup') assertLinks(path.join(transaction, 'sources/0/uploads/a/b'))
    } }
    const result = await core.executeStorageMigration({ binding, sources: [${JSON.stringify(source)}], hooks })
    assert.equal(result.state, 'validation-required', result.issues.join('; '))
    if (${JSON.stringify(stage)} === 'publication') assertLinks(path.join(binding.root, 'uploads/a/b'))
    assert.equal((await core.completeStorageMigration(binding, result.id, hooks)).state, 'ready')
  `
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe' })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
})

test.each(['lock-fields', 'writer-fields', 'writer-name', 'known-lock', 'known-writer'])('reaps only recognized stopped target coordination: %s', async kind => {
  const f = await fixture()
  const source = await f.owned('old', { original: 'retain until acceptance' })
  expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', 'console.log(process.pid)'], { stdout: 'pipe', stderr: 'pipe' })
  const pid = Number((await new Response(child.stdout).text()).trim())
  expect(await child.exited).toBe(0)
  const directory = path.join(f.binding.internalDir, 'migrations')
  await fs.mkdir(path.join(directory, 'writers'), { recursive: true })
  const name = ['lock-fields', 'known-lock'].includes(kind) ? 'lock.json' : path.join('writers', kind === 'writer-name' ? 'future.json' : `${pid}-12345678-1234-1234-1234-123456789abc.json`)
  const file = path.join(directory, name)
  const raw = JSON.stringify({ version: 1, host: os.hostname(), pid, token: 'fixture', ...(kind.endsWith('-fields') ? { future: 'must survive' } : {}) })
  await fs.writeFile(file, raw)
  const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
  if (kind.startsWith('known-')) {
    expect(result.state).toBe('validation-required')
    await expect(fs.lstat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  } else {
    expect(result.state).toBe('blocked')
    expect(await fs.readFile(file, 'utf8')).toBe(raw)
  }
  expect(await fs.readFile(path.join(source.directory, 'original'), 'utf8')).toBe('retain until acceptance')
})

test.each(['before', 'after'])('recovers after a process exits %s first journal publication', async point => {
  const f = await fixture()
  const binding = selectStartupStorage(f.binding, storageLocationFile(f.home))
  const source = await f.owned('old', { original: 'retain until acceptance' })
  const script = `
    import nativeFs from 'node:fs/promises'
    import path from 'node:path'
    import { mock } from 'bun:test'
    const { open, rename } = nativeFs
    const patched = {
      ...nativeFs,
      open: async (file, ...args) => {
        if (${JSON.stringify(point)} === 'before' && path.basename(String(file)).startsWith('journal.json.')) process.exit(73)
        return open(file, ...args)
      },
      rename: async (from, to) => {
        await rename(from, to)
        if (${JSON.stringify(point)} === 'after' && path.basename(String(from)).startsWith('.pending-')) process.exit(73)
      },
    }
    mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
    const { executeStorageMigration } = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))})
    const result = await executeStorageMigration({ binding: ${JSON.stringify(binding)}, sources: [${JSON.stringify(source)}], hooks: { assertQuiescent: async () => {} } })
    console.error(result.state, result.issues.join('; '))
  `
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], {
    env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'ignore', stderr: 'pipe',
  })
  expect(await child.exited, await new Response(child.stderr).text()).toBe(73)
  const original = path.join(source.directory, 'original')
  const target = path.join(binding.root, 'original')
  expect(await fs.readFile(original, 'utf8')).toBe('retain until acceptance')
  expect(await fs.exists(target)).toBe(false)
  const transactions = path.join(binding.internalDir, 'migrations')
  const [directory] = (await fs.readdir(transactions, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name)
  const recovered = await recoverStorageMigration(binding, f.hooks)
  let result = recovered
  if (point === 'before') {
    expect(directory).toMatch(/^\.pending-/)
    expect(recovered.state, recovered.issues.join('; ')).toBe('ready')
    result = await executeStorageMigration({ binding, sources: [source], hooks: f.hooks })
  } else {
    expect(directory).toMatch(/^[a-f0-9-]{36}$/)
    expect(recovered.id).toBe(directory)
  }
  expect(result.state, result.issues.join('; ')).toBe('validation-required')
  expect(await fs.readFile(original, 'utf8')).toBe('retain until acceptance')
  expect((await completeStorageMigration(binding, result.id!, f.hooks)).state).toBe('ready')
  expect(await fs.exists(original)).toBe(false)
  expect(await fs.readFile(target, 'utf8')).toBe('retain until acceptance')
  expect((await recoverStorageMigration(binding, f.hooks)).state).toBe('ready')
})

test('ready recovery can reap a stopped barrier while ordinary writer admission leaves it intact', async () => {
  const f = await fixture()
  const binding = selectStartupStorage(f.binding, storageLocationFile(f.home))
  const source = await f.owned('old', { original: 'keep the migrated data' })
  const imported = await executeStorageMigration({ binding, sources: [source], hooks: f.hooks })
  expect(imported.state, imported.issues.join('; ')).toBe('validation-required')
  const completed = await completeStorageMigration(binding, imported.id!, f.hooks)
  expect(completed.state, completed.issues.join('; ')).toBe('ready')
  const writer = await acquireStorageWriter(binding)
  try {
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', 'console.log(process.pid)'], {
      env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe',
    })
    const pid = Number((await new Response(child.stdout).text()).trim())
    expect(await child.exited).toBe(0)
    const barrier = path.join(binding.internalDir, 'migrations', 'lock.json')
    const receipt = (owner: number) => JSON.stringify({ version: 1, host: os.hostname(), pid: owner, token: 'fixture' })
    await fs.writeFile(barrier, receipt(process.pid))
    expect((await recoverStorageMigration(binding, f.hooks)).state).toBe('blocked')
    await expect(acquireStorageWriter(binding)).rejects.toThrow('maintenance barrier')
    expect(await fs.readFile(barrier, 'utf8')).toBe(receipt(process.pid))
    await fs.writeFile(barrier, receipt(pid))
    const recovery = await recoverStorageMigration(binding, f.hooks)
    expect(recovery.state, recovery.issues.join('; ')).toBe('ready')
    expect(await fs.exists(barrier)).toBe(false)
    await fs.writeFile(barrier, receipt(pid))
    const admitted = await Promise.allSettled([acquireStorageWriter(binding), acquireStorageWriter(binding)])
    for (const lease of admitted) if (lease.status === 'fulfilled') await lease.value.release()
    expect(admitted.map(lease => lease.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await fs.readFile(barrier, 'utf8')).toBe(receipt(pid))
    expect(await fs.readdir(path.join(binding.internalDir, 'migrations', 'writers'))).toHaveLength(1)
  } finally { await writer.release() }
})

describe('single-root storage transaction', () => {
  test('unions two proven sources with an existing target, retains backups inside root and deletes verified originals only after validation', async () => {
    const f = await fixture()
    await f.owned('current', { 'projects/current.jsonl': 'current' })
    const a = await f.owned('old-a', { 'cc-haha/unknown.bin': 'opaque', 'projects/a.jsonl': 'a' })
    const b = await f.owned('old-b', { 'projects/b.jsonl': 'b' })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a, b], hooks: f.hooks })
    expect(result.state).toBe('validation-required')
    expect(await fs.readFile(path.join(a.directory, 'projects/a.jsonl'), 'utf8')).toBe('a')
    expect(await fs.readFile(path.join(f.binding.internalDir, 'unknown.bin'), 'utf8')).toBe('opaque')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    expect(await fs.readdir(f.home)).toEqual(['current'])
    expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
    expect(await fs.readFile(path.join(f.binding.root, 'projects/current.jsonl'), 'utf8')).toBe('current')
  })

  test('same-ID conflicts never overwrite, and shared unmarked directories are not claimed', async () => {
    const f = await fixture()
    await f.owned('current', { 'projects/same.jsonl': 'target' })
    const a = await f.owned('old', { 'projects/same.jsonl': 'source' })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(await fs.readFile(path.join(f.binding.root, 'projects/same.jsonl'), 'utf8')).toBe('target')
    expect(await fs.readFile(path.join(a.directory, 'projects/same.jsonl'), 'utf8')).toBe('source')
    const shared = path.join(f.home, '.claude')
    await fs.mkdir(shared)
    await fs.writeFile(path.join(shared, 'sentinel'), 'foreign')
    const unowned = await executeStorageMigration({ binding: f.binding, sources: [{ directory: shared, markerRoot: shared }], hooks: f.hooks })
    expect(unowned.state).toBe('blocked')
    expect(await fs.readFile(path.join(shared, 'sentinel'), 'utf8')).toBe('foreign')
    expect(await fs.readdir(shared)).toEqual(['sentinel'])
  })

  test('cleanup detects changed source files, preserves them and resumes without rolling back accepted target', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'cc-haha/settings.json': '{"setting":true}' })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state).toBe('validation-required')
    await fs.writeFile(path.join(a.directory, 'cc-haha/settings.json'), 'late writer')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('cleanup-pending')
    expect(await fs.readFile(path.join(a.directory, 'cc-haha/settings.json'), 'utf8')).toBe('late writer')
    expect(await fs.readFile(path.join(f.binding.internalDir, 'settings.json'), 'utf8')).toBe('{"setting":true}')
  })

  test('old writer recreation after completion blocks instead of importing deleted preferences', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'cc-haha/settings.json': '{}' })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    await completeStorageMigration(f.binding, result.id!, f.hooks)
    await fs.unlink(path.join(f.binding.internalDir, 'settings.json'))
    await f.owned('old', { 'cc-haha/settings.json': '{"old":true}' })
    expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('blocked')
    expect(await fs.exists(path.join(f.binding.internalDir, 'settings.json'))).toBe(false)
  })

  test('ready startup still blocks damaged, future, unknown or forked journals while another writer lives', async () => {
    const f = await fixture()
    const source = await f.owned('retired', { 'original': 'imported once' })
    const imported = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
    expect((await completeStorageMigration(f.binding, imported.id!, f.hooks)).state).toBe('ready')
    const journalPath = path.join(f.binding.internalDir, 'migrations', imported.id!, 'journal.json')
    const original = await fs.readFile(journalPath, 'utf8')
    const lease = await acquireStorageWriter(f.binding)
    try {
      expect((await recoverStorageMigration(f.binding, { assertQuiescent: async () => { throw new Error('ready must be read-only') } })).state).toBe('ready')
      for (const bytes of ['{', JSON.stringify({ ...JSON.parse(original), version: 999 }), JSON.stringify({ ...JSON.parse(original), phase: 'copying', state: 'blocked' })]) {
        await fs.writeFile(journalPath, bytes)
        expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('blocked')
        await expect(acquireStorageWriter(f.binding)).rejects.toThrow()
      }
      await fs.writeFile(journalPath, original)
      const unknown = path.join(f.binding.internalDir, 'migrations', 'unknown-entry')
      await fs.mkdir(unknown)
      expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('blocked')
      await fs.rmdir(unknown)
      await f.owned('retired', { 'original': 'old writer recreated source' })
      expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('blocked')
      await expect(acquireStorageWriter(f.binding)).rejects.toThrow('Retired storage root')
      expect(await fs.readFile(path.join(f.binding.root, 'original'), 'utf8')).toBe('imported once')
    } finally { await lease.release() }
  })

  test('a maintenance barrier appearing after ready still refuses the eventual writer lease', async () => {
    const f = await fixture()
    expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
    const script = `
      import nativeFs from 'node:fs/promises'
      import { mock } from 'bun:test'
      const original = nativeFs.open
      const lock = ${JSON.stringify(path.join(f.binding.internalDir, 'migrations', 'lock.json'))}
      const patched = { ...nativeFs, open: async (file, ...args) => {
        const result = await original(file, ...args)
        if (String(file).includes(${JSON.stringify(path.sep + 'writers' + path.sep)})) await nativeFs.writeFile(lock, 'fixture maintenance barrier', { flag: 'wx' })
        return result
      } }
      mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
      const { acquireStorageWriter } = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))})
      try { await acquireStorageWriter(${JSON.stringify(f.binding)}); process.exit(1) }
      catch (error) { if (!error.message.includes('maintenance barrier')) throw error }
    `
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe' })
    const errors = await new Response(child.stderr).text()
    expect(await child.exited, errors).toBe(0)
    expect(await fs.readdir(path.join(f.binding.internalDir, 'migrations', 'writers'))).toEqual([])
  })

  test('a transaction completing between the readiness read and writer registration still blocks business writes', async () => {
    const f = await fixture()
    const source = await f.owned('old', { 'receipt': 'accepted once' })
    expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
    const script = `
      import nativeFs from 'node:fs/promises'
      import { mock } from 'bun:test'
      const original = nativeFs.open
      let core
      let triggered = false
      const patched = { ...nativeFs, open: async (file, ...args) => {
        if (!triggered && String(file).includes(${JSON.stringify(path.sep + 'writers' + path.sep)})) {
          triggered = true
          const result = await core.executeStorageMigration({ binding: ${JSON.stringify(f.binding)}, sources: [${JSON.stringify(source)}], hooks: { assertQuiescent: async () => {}, platform: 'linux' } })
          if (result.state !== 'validation-required') throw new Error(result.issues.join('; '))
        }
        return await original(file, ...args)
      } }
      mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
      core = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))})
      try { const lease = await core.acquireStorageWriter(${JSON.stringify(f.binding)}); await lease.release(); process.exit(1) }
      catch (error) { if (!error.message.includes('validation-required')) throw error }
    `
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe' })
    const errors = await new Response(child.stderr).text()
    expect(await child.exited, errors).toBe(0)
    expect(await fs.readdir(path.join(f.binding.internalDir, 'migrations', 'writers'))).toEqual([])
    expect(await fs.readFile(path.join(source.directory, 'receipt'), 'utf8')).toBe('accepted once')
  })

  test('handles an owned legacy subtree already inside the selected root', async () => {
    const f = await fixture()
    await f.owned('current', { 'cc-haha/generated-images/a.png': 'image' })
    const source = { directory: path.join(f.binding.root, 'cc-haha'), markerRoot: f.binding.root, destination: 'echoflow-code' }
    const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
    expect(result.state).toBe('validation-required')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    expect(await fs.exists(source.directory)).toBe(false)
    expect(await fs.readFile(path.join(f.binding.internalDir, 'generated-images/a.png'), 'utf8')).toBe('image')
  })

  test('requires quiescence and excludes registered writers', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'file': 'data' })
    const lease = await acquireStorageWriter(f.binding)
    try {
      expect((await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })).state).toBe('blocked')
    } finally { await lease.release() }
    const refused = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: { assertQuiescent: async () => { throw new Error('external writer') } } })
    expect(refused.state).toBe('blocked')
    expect(await fs.readFile(path.join(a.directory, 'file'), 'utf8')).toBe('data')
  })

  for (const owner of ['writer', 'completed-writer', 'migration'] as const) {
    test(`a separate ${owner} process excludes a competing migration until it releases its lease`, async () => {
      const f = await fixture()
      if (owner === 'completed-writer') {
        const retired = await f.owned('retired', { 'completed': 'already imported' })
        const imported = await executeStorageMigration({ binding: f.binding, sources: [retired], hooks: f.hooks })
        expect((await completeStorageMigration(f.binding, imported.id!, f.hooks)).state).toBe('ready')
      }
      const a = await f.owned('old', { 'file': 'original' })
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import { acquireStorageWriter, executeStorageMigration } from ${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))}
        const binding = ${JSON.stringify(f.binding)}
        const held = async () => {
          console.log('held')
          await new Promise(resolve => process.stdin.once('data', resolve))
        }
        if (${JSON.stringify(owner)} !== 'migration') {
          const lease = await acquireStorageWriter(binding)
          await held()
          await lease.release()
        } else {
          const result = await executeStorageMigration({ binding, sources: [], hooks: { assertQuiescent: held, platform: 'linux' } })
          if (result.state !== 'ready') throw new Error(result.issues.join('; '))
        }
      `], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
      try {
        const reader = child.stdout.getReader()
        const announcement = await reader.read()
        expect(new TextDecoder().decode(announcement.value)).toContain('held')
        const startup = await recoverStorageMigration(f.binding, f.hooks)
        expect(startup.state, startup.issues.join('; ')).toBe(owner !== 'migration' ? 'ready' : 'blocked')
        if (owner !== 'migration') {
          const secondWriter = await acquireStorageWriter(f.binding)
          await secondWriter.release()
        }
        const blocked = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
        expect(blocked.state).toBe('blocked')
        expect(blocked.issues.join('; ')).toMatch(/running|writer/)
        expect(await fs.readFile(path.join(a.directory, 'file'), 'utf8')).toBe('original')
      } finally {
        child.stdin.write('release')
        child.stdin.end()
        const errors = await new Response(child.stderr).text()
        expect(await child.exited, errors).toBe(0)
      }
      const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
      expect(result.state, result.issues.join('\n')).toBe('validation-required')
    })
  }

  test('retains empty directories and validates a real committed WAL snapshot before source cleanup', async () => {
    const { Database } = await import('bun:sqlite')
    const f = await fixture()
    const a = await f.owned('old', {})
    await fs.mkdir(path.join(a.directory, 'cc-haha/empty'), { recursive: true })
    const dbPath = path.join(a.directory, 'cc-haha/receipts.sqlite')
    const db = new Database(dbPath)
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE receipts(id TEXT); INSERT INTO receipts VALUES (\'accepted-once\')')
    // Keep the connection open: close() would checkpoint away the WAL fixture.
    try {
      f.hooks.validateSQLite = async file => {
        const snapshot = new Database(file, { readonly: true })
        try {
          expect(snapshot.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
          expect(snapshot.query('SELECT id FROM receipts').all()).toEqual([{ id: 'accepted-once' }])
        } finally { snapshot.close() }
      }
      const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
      expect(result.state, result.issues.join('\n')).toBe('validation-required')
      expect((await fs.stat(path.join(f.binding.internalDir, 'empty'))).isDirectory()).toBe(true)
      expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    } finally { db.close() }
  })

  test('Windows permission probes are empty and copied permissions are actually preserved', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'cc-haha/settings.json': '{}' })
    const preserved: string[] = []
    f.hooks.platform = 'win32'
    f.hooks.permissions = {
      restrictStaging: async () => {},
      preflight: async (_files, directory) => { expect(await fs.readdir(directory)).toEqual([]) },
      preserve: async entries => { preserved.push(...entries.map(entry => entry.target)) },
    }
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state, result.issues.join('\n')).toBe('validation-required')
    expect(preserved.length).toBeGreaterThan(0)
  })

  test('never unions independently populated LevelDB stores', async () => {
    const f = await fixture()
    await f.owned('current', { 'Local Storage/leveldb/000001.ldb': 'target-store' })
    const a = await f.owned('old', { 'Local Storage/leveldb/000002.ldb': 'source-store' })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(await fs.exists(path.join(f.binding.root, 'Local Storage/leveldb/000002.ldb'))).toBe(false)
  })

  test('merges nonconflicting structured settings and preserves unknown fields in target preimages', async () => {
    const f = await fixture()
    await f.owned('current', { 'echoflow-code/settings.json': JSON.stringify({ env: { TARGET: 'yes' }, futureTarget: true }) })
    const a = await f.owned('old', { 'cc-haha/settings.json': JSON.stringify({ env: { SOURCE: 'yes' }, futureSource: true }) })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state, result.issues.join('\n')).toBe('validation-required')
    expect(JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'settings.json'), 'utf8'))).toEqual({ env: { TARGET: 'yes', SOURCE: 'yes' }, futureTarget: true, futureSource: true })
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
  })

  test('imports only a schema-proven legacy product subtree, leaving shared and global user state alone', async () => {
    const f = await fixture()
    const shared = path.join(f.home, '.claude')
    const directory = path.join(shared, 'echoflow-code')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(shared, 'settings.json'), '{"foreign":true}')
    await fs.writeFile(path.join(f.home, '.claude.json'), 'shared global data')
    await fs.writeFile(path.join(directory, 'providers.json'), JSON.stringify({ activeId: null, providers: [], unknown: true }))
    await fs.writeFile(path.join(directory, 'unknown.bin'), 'owned unknown bytes')
    f.hooks.upgradeJson = upgradePersistentStorageValue
    const result = await executeStorageMigration({ binding: f.binding, sources: [{ directory, markerRoot: shared, destination: 'echoflow-code', ownership: 'legacy-internal' }], hooks: f.hooks })
    expect(result.state, result.issues.join('\n')).toBe('validation-required')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    expect(await fs.readFile(path.join(f.binding.internalDir, 'unknown.bin'), 'utf8')).toBe('owned unknown bytes')
    expect(await fs.readFile(path.join(shared, 'settings.json'), 'utf8')).toBe('{"foreign":true}')
    expect(await fs.readFile(path.join(f.home, '.claude.json'), 'utf8')).toBe('shared global data')
    expect(await fs.exists(path.join(shared, 'app.json'))).toBe(false)
    expect(await fs.exists(directory)).toBe(false)
  })

  for (const boundary of ['partial-copy', 'database-copy', 'wal-copy'] as const) {
    test(`ownership preview recovers an in-root private snapshot after process exit at ${boundary} without claiming R`, async () => {
      const { openLocalIndexDatabase } = await import('../server/services/localIndex/database')
      const f = await fixture()
      const shared = path.join(f.home, 'shared')
      const providerDirectory = path.join(shared, 'cc-haha')
      const indexDirectory = path.join(shared, 'echoflow-code')
      await fs.mkdir(providerDirectory, { recursive: true })
      await fs.writeFile(path.join(providerDirectory, 'providers.json'), '{"providers":[],"activeId":null}')
      const databasePath = path.join(indexDirectory, 'index-v1.sqlite')
      const database = openLocalIndexDatabase({ path: databasePath })
      database.write(sql => sql.run('INSERT INTO schema_meta (key, value) VALUES (?, ?)', 'private-wal-preview', 'preserve'))
      const sources = [providerDirectory, indexDirectory].map(directory => ({ directory, markerRoot: shared, destination: 'echoflow-code', ownership: 'legacy-internal' as const }))
      const snapshots = await Promise.all(['', '-wal', '-shm'].map(async suffix => {
        const file = databasePath + suffix
        const stat = await fs.stat(file, { bigint: true })
        return { file, bytes: await fs.readFile(file), mode: stat.mode, mtime: stat.mtimeNs, ctime: stat.ctimeNs }
      }))
      const workspace = path.join(f.binding.root, '.echoflow-index-inspection')
      try {
        const script = `
          import nativeFs from 'node:fs/promises'
          import path from 'node:path'
          import { mock } from 'bun:test'
          const original = nativeFs.copyFile
          const patched = { ...nativeFs, copyFile: async (source, target, ...args) => {
            if (path.dirname(target) !== ${JSON.stringify(workspace)}) throw new Error('Preview copied outside R')
            if (${JSON.stringify(boundary)} === 'partial-copy') {
              await nativeFs.writeFile(target, 'interrupted private bytes')
              process.exit(42)
            }
            const result = await original(source, target, ...args)
            if (target.endsWith(${JSON.stringify(boundary === 'wal-copy' ? '-wal' : '.sqlite')})) process.exit(42)
            return result
          } }
          mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
          const { prepareStorageMigration } = await import(${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))})
          await prepareStorageMigration({ binding: ${JSON.stringify(f.binding)}, sources: ${JSON.stringify(sources)} })
          process.exit(1)
        `
        const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe' })
        const errors = await new Response(child.stderr).text()
        expect(await child.exited, errors).toBe(42)
        const receipt = JSON.parse(await fs.readFile(path.join(workspace, 'owner.json'), 'utf8'))
        expect(receipt.pid).toBe(child.pid)
        expect(await fs.exists(path.join(workspace, 'index-v1.sqlite'))).toBe(true)
        expect(await fs.exists(path.join(f.binding.root, 'app.json'))).toBe(false)
        if (boundary === 'wal-copy') expect(await fs.exists(path.join(workspace, 'index-v1.sqlite-wal'))).toBe(true)
        expect((await prepareStorageMigration({ binding: f.binding, sources })).files).toBeGreaterThan(2)
        expect(await fs.readdir(f.binding.root)).toEqual([])
        expect(await fs.exists(path.join(shared, 'app.json'))).toBe(false)
        for (const snapshot of snapshots) {
          expect(await fs.readFile(snapshot.file)).toEqual(snapshot.bytes)
          const stat = await fs.stat(snapshot.file, { bigint: true })
          expect({ mode: stat.mode, mtime: stat.mtimeNs, ctime: stat.ctimeNs }).toEqual({ mode: snapshot.mode, mtime: snapshot.mtime, ctime: snapshot.ctime })
        }
      } finally { database.close() }
    })
  }

  test('ownership inspection fails closed on unknown, future, malformed or still-live receipts', async () => {
    const f = await fixture()
    const workspace = path.join(f.binding.root, '.echoflow-index-inspection')
    await fs.mkdir(workspace, { recursive: true })
    const file = path.join(workspace, 'index-v1.sqlite')
    await fs.writeFile(file, 'private original bytes')
    const receipt = path.join(workspace, 'owner.json')
    const owner = { version: 1, host: os.hostname(), pid: process.pid, token: 'fixture-owner' }
    for (const bytes of ['{', JSON.stringify({ ...owner, version: 999 }), JSON.stringify(owner)]) {
      await fs.writeFile(receipt, bytes)
      await expect(prepareStorageMigration({ binding: f.binding, sources: [] })).rejects.toThrow()
      expect(await fs.readFile(file, 'utf8')).toBe('private original bytes')
      expect(await fs.readFile(receipt, 'utf8')).toBe(bytes)
      expect(await fs.exists(path.join(f.binding.root, 'app.json'))).toBe(false)
    }
    await fs.unlink(receipt)
    await expect(prepareStorageMigration({ binding: f.binding, sources: [] })).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('private original bytes')
  })

  test('does not downgrade a future product schema or overwrite its unknown fields', async () => {
    const f = await fixture()
    const raw = JSON.stringify({ schemaVersion: 999, providers: [], future: true })
    const a = await f.owned('old', { 'cc-haha/providers.json': raw })
    f.hooks.upgradeJson = upgradePersistentStorageValue
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(await fs.readFile(path.join(a.directory, 'cc-haha/providers.json'), 'utf8')).toBe(raw)
    expect(await fs.exists(path.join(f.binding.internalDir, 'providers.json'))).toBe(false)
  })

  test('archives historical migration trees as opaque bytes outside the active journal namespace and recovers verified cleanup', async () => {
    const f = await fixture()
    const history = {
      'cc-haha/migrations/same-id/journal.json': '{"version":999,"state":"accepted","unknown":"retain"}\n',
      'echoflow-code/migrations/same-id/journal.json': 'unknown historical format\n',
      'echoflow-code/migrations/same-id/settings.json': '{"schemaVersion":999,"unknown":true}',
      'echoflow-code/migrations/same-id/broken.sqlite': 'SQLite format 3\0opaque historical bytes',
      'echoflow-code/migrations/same-id/Local Storage/leveldb/000001.ldb': 'unknown database bytes',
    }
    const a = await f.owned('old', history)
    await fs.mkdir(path.join(a.directory, 'echoflow-code/migrations/empty'), { recursive: true })
    let interrupted = false
    f.hooks.prepareResources = async () => {
      if (!interrupted) { interrupted = true; throw new Error('interrupt archival copy') }
    }
    // No SQLite/schema hooks: archived snapshots must not be opened or upgraded.
    const blocked = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(blocked.state).toBe('blocked')
    expect(await fs.exists(path.join(f.binding.internalDir, 'migration-history'))).toBe(false)
    const result = await recoverStorageMigration(f.binding, f.hooks)
    expect(result.state, result.issues.join('\n')).toBe('validation-required')
    const journalPath = path.join(f.binding.internalDir, 'migrations', result.id!, 'journal.json')
    const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
    for (const [relative, bytes] of Object.entries(history)) {
      const receipt = journal.entries.find((entry: { relative: string }) => entry.relative === relative)
      expect(receipt.destination).toStartWith(path.join('echoflow-code', 'migration-history') + path.sep)
      expect(await fs.readFile(path.join(f.binding.root, receipt.destination), 'utf8')).toBe(bytes)
      expect(await fs.readFile(path.join(a.directory, relative), 'utf8')).toBe(bytes)
    }
    const archives = await fs.readdir(path.join(f.binding.internalDir, 'migration-history'))
    expect(archives).toHaveLength(2)
    expect((await fs.readdir(path.join(f.binding.internalDir, 'migrations'))).sort()).toEqual([result.id!])
    const changed = path.join(a.directory, 'echoflow-code/migrations/same-id/settings.json')
    const original = history['echoflow-code/migrations/same-id/settings.json']
    await fs.writeFile(changed, 'late historical writer')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('cleanup-pending')
    expect(await fs.readFile(changed, 'utf8')).toBe('late historical writer')
    await fs.writeFile(changed, original)
    expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
    expect(await fs.exists(a.directory)).toBe(false)
    for (const [relative, bytes] of Object.entries(history)) {
      const receipt = journal.entries.find((entry: { relative: string }) => entry.relative === relative)
      expect(await fs.readFile(path.join(f.binding.root, receipt.destination), 'utf8')).toBe(bytes)
    }
    const lease = await acquireStorageWriter(f.binding)
    await lease.release()
    const empty = journal.directories.find((entry: { source: string }) => entry.source === path.join(a.directory, 'echoflow-code/migrations/empty'))
    expect((await fs.stat(path.join(f.binding.root, empty.relative))).isDirectory()).toBe(true)
    // Only historical journals are opaque; current future transaction versions remain blocked.
    await fs.writeFile(journalPath, JSON.stringify({ ...JSON.parse(await fs.readFile(journalPath, 'utf8')), version: 999 }))
    const future = await recoverStorageMigration(f.binding, f.hooks)
    expect(future.state).toBe('blocked')
    expect(future.issues.join('; ')).toMatch(/Unsupported storage transaction journal/)
  })

  test('historical archive collisions retain both originals and existing target bytes', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'echoflow-code/migrations/old/journal.json': 'source history' })
    const archive = createHash('sha256').update(a.directory).update('\0').update('echoflow-code').digest('hex')
    const destination = path.join('echoflow-code', 'migration-history', archive, 'migrations/old/journal.json')
    await f.owned('current', { [destination]: 'existing archive history' })
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(result.issues.join('; ')).toMatch(/Conflicting storage entity/)
    expect(await fs.readFile(path.join(f.binding.root, destination), 'utf8')).toBe('existing archive history')
    expect(await fs.readFile(path.join(a.directory, 'echoflow-code/migrations/old/journal.json'), 'utf8')).toBe('source history')
    expect((await fs.readdir(path.join(f.binding.internalDir, 'migrations'))).sort()).toEqual([result.id!])
  })

  test('private copy names never collide with ordinary source filenames on recovery', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'file': 'original', 'file.copying': 'independent user bytes' })
    let interrupted = false
    f.hooks.prepareResources = async () => {
      if (!interrupted) { interrupted = true; throw new Error('interrupt after all backups') }
    }
    expect((await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })).state).toBe('blocked')
    const result = await recoverStorageMigration(f.binding, f.hooks)
    expect(result.state, result.issues.join('\n')).toBe('validation-required')
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    expect(await fs.readFile(path.join(f.binding.root, 'file.copying'), 'utf8')).toBe('independent user bytes')
  })

  test.skipIf(process.platform === 'win32')('copies a POSIX read-only file while preserving backup and target modes', async () => {
    const f = await fixture()
    const source = await f.owned('old', { original: 'read-only bytes' })
    const original = path.join(source.directory, 'original')
    await fs.chmod(original, 0o444)
    const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
    expect(result.state, result.issues.join('; ')).toBe('validation-required')
    const backup = path.join(f.binding.internalDir, 'migrations', result.id!, 'sources/0/original')
    const target = path.join(f.binding.root, 'original')
    for (const file of [original, backup, target]) {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o444)
      expect(await fs.readFile(file, 'utf8')).toBe('read-only bytes')
    }
    expect((await completeStorageMigration(f.binding, result.id!, f.hooks)).state).toBe('ready')
    expect(await fs.exists(original)).toBe(false)
  })

  for (const boundary of ['source-copy', 'partial-copy', 'source-backup', 'backup-unlink', 'target-before', 'link', 'publication-unlink', 'replace', 'relocations', 'cleanup'] as const) {
    test(`cold restart after a process exits at ${boundary} rolls forward without losing or replaying data`, async () => {
      const f = await fixture()
      const withSettings = boundary !== 'relocations'
      const withHistory = withSettings && boundary !== 'replace'
      await f.owned('current', withSettings ? { 'echoflow-code/settings.json': '{"target":true}' } : {})
      const historical = '{"version":999,"unknownHistoricalField":"retained"}\n'
      const a = await f.owned('old', {
        'projects/a.jsonl': 'one transcript',
        ...(withSettings ? { 'cc-haha/settings.json': '{"source":true}' } : {}),
        ...(withHistory ? { 'echoflow-code/migrations/old/journal.json': historical } : {}),
      })
      const modulePath = path.join(import.meta.dir, 'storageMigration.ts')
      const script = `
        import nativeFs from 'node:fs/promises'
        import path from 'node:path'
        import { mock } from 'bun:test'
        const patched = { ...nativeFs }
        const root = ${JSON.stringify(f.binding.root)}
        const projectFile = path.join('projects', 'a.jsonl')
        const boundary = ${JSON.stringify(boundary)}
        let backupScratch
        for (const method of ['copyFile', 'link', 'rename', 'unlink', 'rm']) {
          const original = nativeFs[method]
          patched[method] = async (...args) => {
            if (method === 'link' && String(args[1]).endsWith(path.join('sources', '0', projectFile))) backupScratch = args[0]
            if (boundary === 'partial-copy' && method === 'copyFile') {
              await nativeFs.writeFile(args[1], 'partial bytes')
              process.exit(42)
            }
            const result = await original(...args)
            const output = String(args[1])
            if ((boundary === 'source-copy' && method === 'copyFile') ||
                (boundary === 'source-backup' && method === 'link' && output.endsWith('/sources/0/projects/a.jsonl')) ||
                (boundary === 'backup-unlink' && (method === 'rm' || method === 'unlink') && args[0] === backupScratch) ||
                (boundary === 'target-before' && method === 'link' && output.endsWith('/target-before/echoflow-code/settings.json')) ||
                (boundary === 'link' && method === 'link' && output === path.join(root, projectFile)) ||
                (boundary === 'publication-unlink' && method === 'unlink' && String(args[0]).endsWith(path.sep + projectFile) && String(args[0]).split(path.sep).includes('staged')) ||
                (boundary === 'replace' && method === 'rename' && output === root + '/echoflow-code/settings.json') ||
                (boundary === 'relocations' && method === 'rename' && output === root + '/echoflow-code/storage-relocations.json') ||
                (boundary === 'cleanup' && method === 'unlink' && String(args[0]) === ${JSON.stringify(path.join(a.directory, 'projects/a.jsonl'))})) process.exit(42)
            return result
          }
        }
        mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
        const { executeStorageMigration, completeStorageMigration } = await import(${JSON.stringify(modulePath)})
        const binding = ${JSON.stringify(f.binding)}
        const hooks = { assertQuiescent: async () => {}, platform: 'linux' }
        const result = await executeStorageMigration({ binding, sources: [${JSON.stringify(a)}], hooks })
        if (boundary === 'cleanup') console.error(await completeStorageMigration(binding, result.id, hooks))
        console.error(result)
        process.exit(1)
      `
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { env: createSandboxedTestEnvironment(path.join(f.home, 'child')), stdout: 'pipe', stderr: 'pipe' })
      const stderr = await new Response(child.stderr).text()
      expect(await child.exited, stderr).toBe(42)
      if (process.platform !== 'win32' && ['backup-unlink', 'link', 'publication-unlink', 'replace', 'relocations'].includes(boundary)) {
        const recovery = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
          import nativeFs from 'node:fs/promises'
          import path from 'node:path'
          import assert from 'node:assert/strict'
          import { mock } from 'bun:test'
          const binding = ${JSON.stringify(f.binding)}
          const boundary = ${JSON.stringify(boundary)}
          const relocation = boundary === 'relocations'
          const destination = boundary === 'replace' ? 'echoflow-code/settings.json' : 'projects/a.jsonl'
          const targetParent = path.dirname(path.join(binding.root, relocation ? 'echoflow-code/storage-relocations.json' : destination))
          const synced = new Set()
          let checked = false
          const { open, rename } = nativeFs
          const patched = { ...nativeFs,
            open: async (file, ...args) => {
              const handle = await open(file, ...args)
              return new Proxy(handle, { get(object, key) {
                if (key === 'sync') return async () => { await object.sync(); synced.add(String(file)) }
                const value = Reflect.get(object, key)
                return typeof value === 'function' ? value.bind(object) : value
              } })
            },
            rename: async (from, to) => {
              if (!checked && boundary !== 'backup-unlink' && path.basename(String(to)) === 'journal.json') {
                const journal = JSON.parse(await nativeFs.readFile(from, 'utf8'))
                const published = relocation ? journal.relocation?.published : journal.entries.find(entry => entry.destination === destination)?.published
                if (published) {
                  assert.ok(synced.has(targetParent), 'Missing directory sync before recording publication: ' + targetParent)
                  if (!relocation) {
                    const stagedParent = path.dirname(path.join(path.dirname(to), 'staged', journal.attempt, '0', destination))
                    assert.ok(synced.has(stagedParent), 'Missing directory sync after removing staged file: ' + stagedParent)
                  }
                  checked = true
                }
              }
              await rename(from, to)
            },
          }
          mock.module('node:fs/promises', () => ({ ...patched, default: patched }))
          const { recoverStorageMigration } = await import(${JSON.stringify(modulePath)})
          const result = await recoverStorageMigration(binding, { platform: 'linux', assertQuiescent: async () => {}, prepareResources: async transaction => {
            if (boundary === 'backup-unlink') {
              assert.ok(synced.has(path.join(transaction, 'sources/0/projects')), 'Missing directory sync before reusing backup')
              assert.ok(synced.has(path.join(transaction, 'copying')), 'Missing directory sync after removing backup scratch')
              checked = true
            }
          } })
          assert.equal(result.state, 'validation-required', result.issues.join('; '))
          assert.ok(checked, 'Recovery did not reach the publication under test')
        `], { env: createSandboxedTestEnvironment(path.join(f.home, 'recovery')), stdout: 'ignore', stderr: 'pipe' })
        expect(await recovery.exited, await new Response(recovery.stderr).text()).toBe(0)
      }
      const recovered = await recoverStorageMigration(f.binding, f.hooks)
      expect(recovered.state, recovered.issues.join('\n')).toBe(boundary === 'cleanup' ? 'ready' : 'validation-required')
      if (recovered.state === 'validation-required') expect((await completeStorageMigration(f.binding, recovered.id!, f.hooks)).state).toBe('ready')
      expect(await fs.readFile(path.join(f.binding.root, 'projects/a.jsonl'), 'utf8')).toBe('one transcript')
      if (withSettings) expect(JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'settings.json'), 'utf8'))).toEqual({ target: true, source: true })
      if (withHistory) {
        const [archive] = await fs.readdir(path.join(f.binding.internalDir, 'migration-history'))
        expect(await fs.readFile(path.join(f.binding.internalDir, 'migration-history', archive!, 'migrations/old/journal.json'), 'utf8')).toBe(historical)
      }
      expect(await fs.exists(a.directory)).toBe(false)
      expect((await recoverStorageMigration(f.binding, f.hooks)).state).toBe('ready')
    })
  }

  test('same-ID provider merge retains unknown fields from both sources', async () => {
    const f = await fixture()
    const provider = { id: 'saved', presetId: 'custom', name: 'Saved', apiKey: 'fake', baseUrl: 'http://127.0.0.1', models: { main: 'model', haiku: '', sonnet: '', opus: '' } }
    await f.owned('current', { 'echoflow-code/providers.json': JSON.stringify({ activeId: null, providers: [{ ...provider, targetField: true }] }) })
    const a = await f.owned('old', { 'cc-haha/providers.json': JSON.stringify({ activeId: null, providers: [{ ...provider, sourceField: true }] }) })
    f.hooks.upgradeJson = upgradePersistentStorageValue
    const result = await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })
    expect(result.state, result.issues.join('\n')).toBe('validation-required')
    const saved = JSON.parse(await fs.readFile(path.join(f.binding.internalDir, 'providers.json'), 'utf8'))
    expect(saved.providers[0]).toMatchObject({ targetField: true, sourceField: true })
  })

  test('refuses an internal source that maps onto itself without deleting data', async () => {
    const f = await fixture()
    await f.owned('current', { 'cc-haha/settings.json': '{}' })
    const source = { directory: path.join(f.binding.root, 'cc-haha'), markerRoot: f.binding.root, destination: 'cc-haha' }
    const result = await executeStorageMigration({ binding: f.binding, sources: [source], hooks: f.hooks })
    expect(result.state).toBe('blocked')
    expect(await fs.readFile(path.join(source.directory, 'settings.json'), 'utf8')).toBe('{}')
  })

  test('future ownership schema and linked sources are preserved and blocked', async () => {
    const f = await fixture()
    const a = await f.owned('old', { 'file': 'data' })
    await fs.writeFile(path.join(a.directory, 'app.json'), JSON.stringify({ ...buildEchoFlowOwnershipMarker(), schemaVersion: 999 }))
    expect((await executeStorageMigration({ binding: f.binding, sources: [a], hooks: f.hooks })).state).toBe('blocked')
    expect(await fs.exists(path.join(a.directory, 'file'))).toBe(true)
  })
})
