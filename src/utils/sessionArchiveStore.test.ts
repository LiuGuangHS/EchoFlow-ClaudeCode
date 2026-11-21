import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'
import { classifySessionArchives, ensureSessionArchivesMigrated, readSessionArchives, readSessionArchiveSnapshot, resolveSessionArchive, withSessionArchiveLock, writeSessionArchive } from './sessionArchiveStore.js'

let root: string
let archivePath: string
let markerPath: string
const sessionId = '00000000-aaaa-bbbb-cccc-dddddddddddd'
const migrationModule = new URL('./sessionArchiveStore.ts', import.meta.url).href

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'archive-migration-'))
  archivePath = join(join(root, 'cc-haha'), 'session-archives.json')
  markerPath = join(join(root, 'cc-haha'), 'session-archives.legacy-jsonl-migration.json')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function transcript(archived: boolean, project = 'project'): Promise<string> {
  const file = join(root, 'projects', project, `${sessionId}.jsonl`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ type: 'session-archive', archived }) + '\n')
  return file
}

async function migrateInNewProcess(): Promise<void> {
  const child = Bun.spawn([process.execPath, '--no-env-file', '-e', `
    import { ensureSessionArchivesMigrated } from ${JSON.stringify(migrationModule)}
    await ensureSessionArchivesMigrated(process.argv[1])
  `, root], {
    env: createSandboxedTestEnvironment(join(root, 'child-home')),
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(exitCode, stderr).toBe(0)
}

describe('classified archive browsing snapshots', () => {
  test('reads without importing, preserves unknown copies, and lets explicit true and false win', async () => {
    const file = await transcript(true)
    await writeFile(file, '{ malformed unrelated history\n')
    const bytes = JSON.stringify({ sessions: { restored: { archived: false }, archived: { archived: true } }, extension: 'keep' })
    await mkdir(dirname(archivePath), { recursive: true })
    await writeFile(archivePath, bytes)

    const snapshot = readSessionArchiveSnapshot(root)
    expect(snapshot.migrationComplete).toBe(false)
    expect(resolveSessionArchive(snapshot, 'unknown')).toBeNull()
    expect(resolveSessionArchive(snapshot, 'ordinary', false)).toBe(false)
    expect(resolveSessionArchive(snapshot, 'legacy', true)).toBe(true)
    expect(classifySessionArchives(snapshot, [
      { id: 'conflict', legacyArchived: true }, { id: 'conflict', legacyArchived: false },
      { id: 'conflict', legacyArchived: true },
      { id: 'incomplete', legacyArchived: null }, { id: 'incomplete', legacyArchived: false },
      { id: 'restored', legacyArchived: true }, { id: 'restored', legacyArchived: null },
      { id: 'archived', legacyArchived: false }, { id: 'archived', legacyArchived: null },
    ])).toEqual(new Map([
      ['conflict', null], ['incomplete', null], ['restored', false], ['archived', true],
    ]))
    expect(await readFile(archivePath, 'utf8')).toBe(bytes)
    await expect(readFile(markerPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('completion changes the read revision and only validated completion resolves absent evidence', async () => {
    const initial = readSessionArchiveSnapshot(root)
    await mkdir(dirname(markerPath), { recursive: true })
    const validMarker = JSON.stringify({ schemaVersion: 1, archiveStateRequired: false })
    await writeFile(markerPath, validMarker)
    const complete = readSessionArchiveSnapshot(root)
    expect(complete.revision).not.toBe(initial.revision)
    expect(resolveSessionArchive(complete, 'unknown')).toBe(false)
    expect(resolveSessionArchive(complete, 'old-archive', true)).toBe(false)
    expect(await readFile(markerPath, 'utf8')).toBe(validMarker)
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })

    for (const marker of ['{ broken', JSON.stringify({ schemaVersion: 2, archiveStateRequired: false }), JSON.stringify({ schemaVersion: 1, archiveStateRequired: true })]) {
      await writeFile(markerPath, marker)
      expect(() => readSessionArchiveSnapshot(root)).toThrow()
      expect(await readFile(markerPath, 'utf8')).toBe(marker)
    }
    await rm(markerPath)
    await writeFile(archivePath, JSON.stringify({ schemaVersion: 2, sessions: {} }))
    expect(() => readSessionArchiveSnapshot(root)).toThrow()
  })
})

describe('legacy archive migration publication and recovery', () => {
  test('marks an empty import without creating archive state or rescanning after restart', async () => {
    await ensureSessionArchivesMigrated(root)
    expect(JSON.parse(await readFile(markerPath, 'utf8'))).toEqual({ schemaVersion: 1, archiveStateRequired: false })
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
    const file = await transcript(true)
    await writeFile(file, '{ an active later transcript is not part of the completed import')
    await migrateInNewProcess()
    expect(readSessionArchives(root).ids.size).toBe(0)
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('publishes state before the marker and retries without overriding an intervening explicit choice', async () => {
    const file = await transcript(true)
    const bytes = await readFile(file, 'utf8')
    const rename = fs.renameSync
    const publication = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === markerPath) throw new Error('fixture marker publication failed')
      rename(source, destination)
    })
    try {
      await expect(ensureSessionArchivesMigrated(root)).rejects.toThrow('fixture marker publication failed')
    } finally {
      publication.mockRestore()
    }
    expect(readSessionArchives(root).ids.has(sessionId)).toBe(true)
    await expect(readFile(markerPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await withSessionArchiveLock(root, async () => writeSessionArchive(root, sessionId, false))

    await migrateInNewProcess()

    expect(readSessionArchives(root).state.sessions[sessionId]).toEqual({ archived: false })
    expect(JSON.parse(await readFile(markerPath, 'utf8'))).toEqual({ schemaVersion: 1, archiveStateRequired: true })
    expect(await readFile(file, 'utf8')).toBe(bytes)
  })

  test.each([false, true])('flushes archive state before publishing a durable completion marker (existing state: %s)', async existing => {
    await transcript(true)
    if (existing) {
      await mkdir(dirname(archivePath), { recursive: true })
      await writeFile(archivePath, JSON.stringify({ sessions: { [sessionId]: { archived: false, future: 7 } }, future: { keep: true } }))
    }
    const events: string[] = []
    const identities = new Map<fs.PathLike, string>()
    const identity = (stat: fs.Stats) => `${stat.dev}:${stat.ino}`
    const fsync = fs.fsyncSync
    const rename = fs.renameSync
    const flush = spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      const stat = fs.fstatSync(fd)
      fsync(fd)
      events.push(`${stat.isDirectory() ? 'directory' : 'file'}:${identity(stat)}`)
    })
    const publication = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      const stat = fs.statSync(source)
      rename(source, destination)
      identities.set(destination, identity(stat))
      events.push(`rename:${destination}`)
    })
    try {
      await ensureSessionArchivesMigrated(root)
    } finally {
      publication.mockRestore()
      flush.mockRestore()
    }

    const directoryFlush = `directory:${identity(fs.statSync(dirname(archivePath)))}`
    const required = [
      `file:${identities.get(archivePath)}`,
      `rename:${archivePath}`,
      ...(process.platform === 'win32' ? [] : [directoryFlush]),
      `file:${identities.get(markerPath)}`,
      `rename:${markerPath}`,
      ...(process.platform === 'win32' ? [] : [directoryFlush]),
    ]
    let previous = -1
    for (const event of required) {
      const index = events.indexOf(event, previous + 1)
      expect(index, event).toBeGreaterThan(previous)
      previous = index
    }
    if (existing) {
      expect(readSessionArchives(root).state).toEqual({ schemaVersion: 1, sessions: { [sessionId]: { archived: false, future: 7 } }, future: { keep: true } })
    }
  })

  test.each(process.platform === 'win32' ? ['file'] : ['file', 'directory'])(
    'rejects the first %s flush failure without publishing the marker and preserves explicit choices on retry',
    async kind => {
      const file = await transcript(true)
      const bytes = await readFile(file)
      const fsync = fs.fsyncSync
      let injected = false
      const flush = spyOn(fs, 'fsyncSync').mockImplementation(fd => {
        const stat = fs.fstatSync(fd)
        if (!injected && (kind === 'file' ? stat.isFile() : stat.isDirectory())) {
          injected = true
          throw new Error(`fixture ${kind} flush failed`)
        }
        fsync(fd)
      })
      try {
        await expect(ensureSessionArchivesMigrated(root)).rejects.toThrow(`fixture ${kind} flush failed`)
        expect(injected).toBe(true)
      } finally {
        flush.mockRestore()
      }
      await expect(readFile(markerPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(file)).toEqual(bytes)
      await withSessionArchiveLock(root, async () => writeSessionArchive(root, sessionId, false))

      await ensureSessionArchivesMigrated(root)

      expect(readSessionArchives(root).state.sessions[sessionId]).toEqual({ archived: false })
      expect(JSON.parse(await readFile(markerPath, 'utf8'))).toEqual({ schemaVersion: 1, archiveStateRequired: true })
      expect(await readFile(file)).toEqual(bytes)
    },
  )

  test('refuses a completed import whose required state was lost', async () => {
    await transcript(true)
    await ensureSessionArchivesMigrated(root)
    await rm(archivePath)
    const marker = await readFile(markerPath, 'utf8')

    await expect(ensureSessionArchivesMigrated(root)).rejects.toThrow('archive state is missing')

    expect(await readFile(markerPath, 'utf8')).toBe(marker)
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test.each([
    '{ broken',
    JSON.stringify({ schemaVersion: 2, archiveStateRequired: false, future: true }),
    JSON.stringify({ schemaVersion: 1, archiveStateRequired: 'false' }),
  ])('preserves and rejects an untrusted completion marker: %s', async marker => {
    const file = await transcript(true)
    const bytes = await readFile(file, 'utf8')
    await mkdir(dirname(markerPath), { recursive: true })
    await writeFile(markerPath, marker)

    await expect(ensureSessionArchivesMigrated(root)).rejects.toThrow()

    expect(await readFile(markerPath, 'utf8')).toBe(marker)
    expect(await readFile(file, 'utf8')).toBe(bytes)
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('does not publish partial state when duplicate legacy identities disagree', async () => {
    await transcript(true, 'first-project')
    await transcript(false, 'second-project')

    await expect(ensureSessionArchivesMigrated(root)).rejects.toThrow('Conflicting legacy')

    await expect(readFile(markerPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('serializes simultaneous first imports from separate processes', async () => {
    const file = await transcript(true)
    const bytes = await readFile(file, 'utf8')

    await Promise.all([migrateInNewProcess(), migrateInNewProcess()])

    expect([...readSessionArchives(root).ids]).toEqual([sessionId])
    expect(JSON.parse(await readFile(markerPath, 'utf8')).archiveStateRequired).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(bytes)
  })
})
