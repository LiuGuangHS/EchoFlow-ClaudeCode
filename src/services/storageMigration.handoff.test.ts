import { afterEach, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../utils/echoFlowConfigRoot'
import { acquireStorageWriter, armStorageHandoff, cancelStorageHandoff, completeStorageMigration, executeStorageMigration, migrationDirectoryIdentity, prepareStorageHandoff, prepareStorageMigration, readStorageHandoff, recoverStorageMigration } from './storageMigration'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'storage-handoff-'))
  roots.push(root)
  const source = resolveStorageBinding({ env: {}, roots: [path.join(root, 'source')] })
  const target = resolveStorageBinding({ env: {}, roots: [path.join(root, 'target')] })
  await fs.mkdir(path.join(source.internalDir, 'migrations/writers'), { recursive: true })
  await fs.mkdir(target.root)
  await fs.writeFile(path.join(source.root, 'app.json'), JSON.stringify(buildEchoFlowOwnershipMarker()))
  await fs.writeFile(path.join(source.root, 'session.jsonl'), 'original')
  const id = randomUUID()
  const relative = path.join('echoflow-code/storage-handoffs', `${id}.json`)
  await fs.mkdir(path.dirname(path.join(source.root, relative)), { recursive: true })
  await fs.writeFile(path.join(source.root, relative), JSON.stringify({ version: 1, id, source: source.root, target: target.root,
    sourceIdentity: await migrationDirectoryIdentity(source.root), targetIdentity: await migrationDirectoryIdentity(target.root), state: 'pending', future: { keep: true } }))
  const lock = path.join(source.internalDir, 'migrations/lock.json')
  const child = Bun.spawn([process.execPath, '--eval', `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(lock)}, JSON.stringify({version:1, host:require('node:os').hostname(),pid:process.pid,token:require('node:crypto').randomUUID()}))`], { stdout: 'pipe', stderr: 'pipe' })
  expect(await child.exited).toBe(0)
  const hooks = { assertQuiescent: async () => {}, platform: 'linux' as const }
  return { root, source, target, relative, lock, hooks }
}

async function producerFixture() {
  const f = await fixture()
  await fs.unlink(path.join(f.source.root, f.relative))
  await fs.unlink(f.lock)
  const sources = [{ directory: f.source.root, markerRoot: f.source.root }]
  const plan = await prepareStorageMigration({ binding: f.target, sources })
  const preview = await prepareStorageHandoff(plan)
  return { ...f, sources, preview }
}

test('generic imports refuse a live source writer and keep the source fenced across a validator exit', async () => {
  const f = await producerFixture()
  const location = path.join(f.root, 'location', 'active-root.sqlite')
  const source = { ...f.source, location: { file: location } }
  const target = { ...f.target, location: { file: location } }
  const migration = JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))
  const childEnv = { ...process.env, HOME: f.root, CLAUDE_CONFIG_DIR: source.root }
  const writer = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
    import { acquireStorageWriter } from ${migration}
    const lease = await acquireStorageWriter(${JSON.stringify(source)})
    console.log('admitted')
    await Bun.stdin.text()
    await lease.release()
  `], { env: childEnv, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  try {
    const output = writer.stdout.getReader()
    expect(new TextDecoder().decode((await output.read()).value).trim()).toBe('admitted')
    output.releaseLock()
    const blocked = await executeStorageMigration({ binding: target, sources: f.sources, hooks: f.hooks })
    expect(blocked.state).toBe('blocked')
    expect(blocked.issues.join('; ')).toContain('Active storage writer')
    expect(await fs.readFile(path.join(source.root, 'session.jsonl'), 'utf8')).toBe('original')
    await expect(fs.lstat(path.join(target.root, 'session.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    writer.stdin.end()
    expect(await writer.exited).toBe(0)
  }

  const move = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
    import { executeStorageMigration } from ${migration}
    const result = await executeStorageMigration({binding:${JSON.stringify(target)}, sources:${JSON.stringify(f.sources)}, hooks:{assertQuiescent:async()=>{},platform:'linux'}})
    console.log(JSON.stringify(result))
    process.exit(result.state === 'validation-required' ? 73 : 1)
  `], { env: childEnv, stdout: 'pipe', stderr: 'pipe' })
  const moved = JSON.parse(await new Response(move.stdout).text())
  expect(await move.exited, moved.issues.join('; ')).toBe(73)
  await expect(acquireStorageWriter(source)).rejects.toThrow('handoff')
  expect(await fs.readFile(path.join(source.root, 'session.jsonl'), 'utf8')).toBe('original')
  expect((await recoverStorageMigration(target, f.hooks)).state).toBe('validation-required')
  expect((await completeStorageMigration(target, moved.id, f.hooks)).state).toBe('ready')
  expect(await fs.readFile(path.join(target.root, 'session.jsonl'), 'utf8')).toBe('original')
  await expect(fs.lstat(source.root)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(acquireStorageWriter(source)).rejects.toThrow('Retired storage root')
  await expect(fs.lstat(source.root)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('the shared producer arms a durable identity-bound request without copying and cancellation preserves unknown fields', async () => {
  const f = await producerFixture()
  const launch = await armStorageHandoff(f.preview, randomUUID())
  expect(await readStorageHandoff(f.source.root, f.target.root)).toEqual(launch)
  expect(await fs.readdir(f.target.root)).toEqual([])
  await expect(acquireStorageWriter(f.source)).rejects.toThrow('handoff')
  await expect(armStorageHandoff(f.preview, randomUUID())).rejects.toThrow('handoff')
  const file = path.join(f.source.internalDir, 'storage-handoffs', `${launch.id}.json`)
  const request = JSON.parse(await fs.readFile(file, 'utf8'))
  await fs.writeFile(file, JSON.stringify({ ...request, future: { keep: true } }))
  await expect(cancelStorageHandoff(launch)).rejects.toThrow('changed')
  const current = (await readStorageHandoff(f.source.root, f.target.root))!
  expect(current.proof).not.toBe(launch.proof)
  await cancelStorageHandoff(current)
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({ state: 'cancelled', future: { keep: true } })
  expect(await readStorageHandoff(f.source.root, f.target.root)).toBeUndefined()
  const lease = await acquireStorageWriter(f.source)
  await lease.release()
})

test('arming refuses a linked source coordination parent before creating a request outside the source', async () => {
  const f = await producerFixture()
  const outside = path.join(f.root, 'outside')
  await fs.mkdir(outside)
  await fs.rename(f.source.internalDir, `${f.source.internalDir}-original`)
  await fs.symlink(outside, f.source.internalDir, 'dir')
  await expect(armStorageHandoff(f.preview, randomUUID())).rejects.toThrow('link')
  expect(await fs.readdir(outside)).toEqual([])
})

test('a transaction-owned shared request cannot be cancelled and accepted recovery never rearms it', async () => {
  const f = await producerFixture()
  const launch = await armStorageHandoff(f.preview, randomUUID())
  const moved = await executeStorageMigration({ binding: f.target, sources: f.sources, hooks: f.hooks })
  expect(moved.state).toBe('validation-required')
  await expect(cancelStorageHandoff(launch)).rejects.toThrow('Transaction-owned')
  expect((await completeStorageMigration(f.target, moved.id!, f.hooks)).state).toBe('ready')
  await fs.writeFile(path.join(f.target.root, 'session.jsonl'), 'new accepted data')
  expect((await recoverStorageMigration(f.target, f.hooks)).state).toBe('ready')
  expect(await readStorageHandoff(f.source.root, f.target.root)).toBeUndefined()
  expect(await fs.readFile(path.join(f.target.root, 'session.jsonl'), 'utf8')).toBe('new accepted data')
})

test('a projection-first shared plan freezes all source identities and consumes only its selected controls', async () => {
  const f = await producerFixture()
  const profile = path.join(f.root, 'profile')
  await fs.mkdir(profile)
  const file = path.join(profile, 'data-migration-v1.json')
  const raw = '{"version":1,"future":true}'
  await fs.writeFile(file, raw)
  await fs.writeFile(path.join(profile, 'keep'), 'unrelated')
  const stat = await fs.lstat(file, { bigint: true })
  const sources = [{ directory: profile, markerRoot: profile, layout: 'legacy-controls' as const,
    controls: { 'data-migration-v1.json': { dev: String(stat.dev), ino: String(stat.ino), digest: createHash('sha256').update(raw).digest('hex') } } }, ...f.sources]
  const preview = await prepareStorageHandoff(await prepareStorageMigration({ binding: f.target, sources }))
  expect(preview.sourceIndex).toBe(1)
  await fs.rename(profile, `${profile}-original`)
  await fs.mkdir(profile)
  await expect(armStorageHandoff(preview, randomUUID())).rejects.toThrow()
  await fs.rmdir(profile)
  await fs.rename(`${profile}-original`, profile)
  const launch = await armStorageHandoff(preview, randomUUID())
  expect(launch.source).toBe(f.source.root)
  const moved = await executeStorageMigration({ binding: f.target, sources, hooks: f.hooks })
  expect(moved.state).toBe('validation-required')
  expect((await completeStorageMigration(f.target, moved.id!, f.hooks)).state).toBe('ready')
  expect(await fs.readFile(path.join(profile, 'keep'), 'utf8')).toBe('unrelated')
  await expect(fs.lstat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('a crashed handoff keeps headless recovery and writer admission out of the source without replacing its stale lock', async () => {
  const f = await fixture()
  const before = await fs.readFile(f.lock, 'utf8')
  expect((await recoverStorageMigration(f.source, f.hooks)).state).toBe('blocked')
  await expect(acquireStorageWriter(f.source)).rejects.toThrow('handoff')
  expect(await fs.readFile(f.lock, 'utf8')).toBe(before)
  expect(await fs.readdir(path.join(f.source.internalDir, 'migrations/writers'))).toEqual([])
})

test('cold recovery tolerates replacement of a known source coordination lock without losing opaque migration history', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.source.internalDir, 'migrations/opaque-material'), 'unknown history must survive')
  const child = Bun.spawn([process.execPath, '--eval', `
    import fs from 'node:fs/promises'
    import { executeStorageMigration } from ${JSON.stringify(path.join(import.meta.dir, 'storageMigration.ts'))}
    await fs.writeFile(${JSON.stringify(f.lock)}, JSON.stringify({version:1,host:require('node:os').hostname(),pid:process.pid,token:require('node:crypto').randomUUID()}))
    const result = await executeStorageMigration({binding:${JSON.stringify(f.target)}, sources:[{directory:${JSON.stringify(f.source.root)},markerRoot:${JSON.stringify(f.source.root)}}],hooks:{assertQuiescent:async()=>{},platform:'linux'}})
    console.log(JSON.stringify(result))
  `], { stdout: 'pipe', stderr: 'pipe' })
  const moved = JSON.parse(await new Response(child.stdout).text())
  expect(await child.exited).toBe(0)
  expect(moved.state).toBe('validation-required')
  expect((await recoverStorageMigration(f.source, f.hooks)).state).toBe('blocked')
  await fs.unlink(f.lock)
  await fs.writeFile(f.lock, JSON.stringify({ version: 1, host: os.hostname(), pid: process.pid, token: randomUUID() }))
  expect((await recoverStorageMigration(f.target, f.hooks)).state).toBe('validation-required')
  expect((await completeStorageMigration(f.target, moved.id!, f.hooks)).state).toBe('ready')
  const journal = JSON.parse(await fs.readFile(path.join(f.target.internalDir, 'migrations', moved.id!, 'journal.json'), 'utf8'))
  expect(journal.entries.some((entry: { relative: string }) => entry.relative.endsWith('migrations/lock.json'))).toBe(false)
  const opaque = journal.entries.find((entry: { relative: string }) => entry.relative.endsWith('migrations/opaque-material'))
  expect(await fs.readFile(path.join(f.target.root, opaque.destination), 'utf8')).toBe('unknown history must survive')
  await expect(fs.lstat(f.source.root)).rejects.toMatchObject({ code: 'ENOENT' })
})

test.each(['source', 'target'] as const)('rejects a replaced %s root across cold recovery without touching replacement data', async selected => {
  const f = await fixture()
  const moved = await executeStorageMigration({ binding: f.target, sources: [{ directory: f.source.root, markerRoot: f.source.root }], hooks: f.hooks })
  expect(moved.state).toBe('validation-required')
  await fs.rename(f[selected].root, `${f[selected].root}-original`)
  await fs.mkdir(f[selected].root)
  await fs.writeFile(path.join(f[selected].root, 'keep'), 'replacement')
  expect((await completeStorageMigration(f.target, moved.id!, f.hooks)).state).toBe('blocked')
  expect(await fs.readFile(path.join(f[selected].root, 'keep'), 'utf8')).toBe('replacement')
})

test('unrecognized coordination material is never skipped or deleted', async () => {
  const f = await fixture()
  const file = path.join(f.source.internalDir, 'migrations/writers/future.json')
  const bytes = JSON.stringify({ version: 1, host: os.hostname(), pid: process.pid, token: randomUUID(), future: 'not owned by this version' })
  await fs.writeFile(file, bytes)
  expect((await executeStorageMigration({ binding: f.target, sources: [{ directory: f.source.root, markerRoot: f.source.root }], hooks: f.hooks })).state).toBe('blocked')
  expect(await fs.readFile(file, 'utf8')).toBe(bytes)
  expect(await fs.readFile(path.join(f.source.root, 'session.jsonl'), 'utf8')).toBe('original')
})

test('retirement preserves a stopped writer receipt with a mismatched filename PID', async () => {
  const f = await fixture()
  const moved = await executeStorageMigration({ binding: f.target, sources: [{ directory: f.source.root, markerRoot: f.source.root }], hooks: f.hooks })
  expect(moved.state).toBe('validation-required')
  const bytes = await fs.readFile(f.lock, 'utf8')
  const { pid } = JSON.parse(bytes)
  const file = path.join(f.source.internalDir, 'migrations/writers', `${pid + 1}-${randomUUID()}.json`)
  await fs.writeFile(file, bytes)
  const result = await completeStorageMigration(f.target, moved.id!, f.hooks)
  expect(result.state).toBe('cleanup-pending')
  expect(result.issues.join('; ')).toContain('Unknown storage process receipt')
  expect(await fs.readFile(file, 'utf8')).toBe(bytes)
  await expect(acquireStorageWriter(f.source)).rejects.toThrow('handoff')
})

test('accepted cleanup failures retain the durable source barrier and never replay resource preparation', async () => {
  const f = await fixture()
  let preparations = 0
  let interrupted = true
  const hooks = { ...f.hooks, prepareResources: async () => { preparations++ }, cleanupResources: async () => { if (interrupted) throw new Error('cleanup interrupted') } }
  const moved = await executeStorageMigration({ binding: f.target, sources: [{ directory: f.source.root, markerRoot: f.source.root }], hooks })
  expect(moved.state).toBe('validation-required')
  expect((await completeStorageMigration(f.target, moved.id!, hooks)).state).toBe('cleanup-pending')
  await expect(acquireStorageWriter(f.source)).rejects.toThrow('handoff')
  expect((await recoverStorageMigration(f.source, f.hooks)).state).toBe('blocked')
  expect(JSON.parse(await fs.readFile(path.join(f.source.root, f.relative), 'utf8'))).toMatchObject({ state: 'pending', future: { keep: true } })
  interrupted = false
  expect((await recoverStorageMigration(f.target, hooks)).state).toBe('ready')
  expect(preparations).toBe(1)
  expect((await recoverStorageMigration(f.target, hooks)).state).toBe('ready')
  expect(preparations).toBe(1)
})

test('a late source fork keeps its data and the handoff barrier rather than allowing old-root admission', async () => {
  const f = await fixture()
  const moved = await executeStorageMigration({ binding: f.target, sources: [{ directory: f.source.root, markerRoot: f.source.root }], hooks: f.hooks })
  await fs.writeFile(path.join(f.source.root, 'late-writer'), 'must survive')
  expect((await completeStorageMigration(f.target, moved.id!, f.hooks)).state).toBe('cleanup-pending')
  expect(await fs.readFile(path.join(f.source.root, 'late-writer'), 'utf8')).toBe('must survive')
  await expect(acquireStorageWriter(f.source)).rejects.toThrow('handoff')
})
