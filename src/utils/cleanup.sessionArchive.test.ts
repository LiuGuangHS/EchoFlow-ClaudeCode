import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { cleanupOldFileHistoryBackups, cleanupOldSessionEnvDirs, cleanupOldSessionFiles } from './cleanup.js'
import { readSessionArchives, withSessionArchiveLock, writeSessionArchive } from './sessionArchiveStore.js'
import { getFsImplementation } from './fsOperations.js'
import { getEchoFlowInternalDir } from './echoFlowConfigRoot.js'

let configDir: string
let previousConfigDir: string | undefined
const archivedId = '00000000-aaaa-bbbb-cccc-dddddddddddd'
const ordinaryId = '00000001-aaaa-bbbb-cccc-dddddddddddd'
const oldDate = new Date('2000-01-01T00:00:00.000Z')
const fixtureBytes = JSON.stringify({ type: 'user', uuid: 'fixture-user', timestamp: oldDate.toISOString(), message: { role: 'user', content: 'Old preserved fixture' } }) + '\n'
const cutoff = new Date('2026-01-01T00:00:00.000Z')

beforeEach(async () => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = await mkdtemp(join(tmpdir(), 'archive-cleanup-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})
afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await rm(configDir, { recursive: true, force: true })
})

async function fixture(id: string) {
  const paths = [
    join(configDir, 'projects', 'old-project', `${id}.jsonl`),
    join(configDir, 'projects', 'old-project', `${id}.cast`),
    join(configDir, 'projects', 'old-project', id, 'subagents', 'agent.jsonl'),
    join(configDir, 'projects', 'old-project', id, 'tool-results', 'read.txt'),
    join(configDir, 'file-history', id, 'original.txt'),
    join(configDir, 'session-env', id, 'snapshot'),
  ]
  for (const file of paths) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, fixtureBytes)
    await utimes(file, oldDate, oldDate)
    await utimes(dirname(file), oldDate, oldDate)
  }
  return paths
}

async function legacyFixture(id: string, records: Record<string, unknown>[]) {
  const files = await fixture(id)
  const transcript = [
    JSON.stringify({ type: 'session-meta', workDir: join(configDir, 'old-project'), future: { keep: true } }),
    fixtureBytes.trimEnd(),
    ...records.map(record => JSON.stringify(record)),
  ].join('\n') + '\n'
  await writeFile(files[0]!, transcript)
  await utimes(files[0]!, oldDate, oldDate)
  return { files, transcript }
}

describe('archived session retention', () => {
  it('previews legacy archives before the first cleanup without creating archive storage', async () => {
    const archived = await legacyFixture(archivedId, [{ type: 'session-archive', archived: true }])
    const ordinary = await fixture(ordinaryId)
    const internalDir = getEchoFlowInternalDir(configDir)

    expect(await cleanupOldSessionFiles(cutoff, { dryRun: true })).toEqual({ messages: 4, errors: 0 })
    for (const file of [...archived.files, ...ordinary]) expect(await readFile(file, 'utf8')).toBe(file === archived.files[0] ? archived.transcript : fixtureBytes)
    await expect(access(internalDir)).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 4, errors: 0 })
    for (const file of archived.files) expect(await readFile(file, 'utf8')).toBe(file === archived.files[0] ? archived.transcript : fixtureBytes)
    for (const file of ordinary.slice(0, 4)) await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readSessionArchives(configDir).ids.has(archivedId)).toBe(true)
  })

  it.each(['transcript', 'file-history', 'session-env'] as const)('migrates both v0.7.4 JSONL archive formats before the first %s cleanup and remains idempotent', async first => {
    // v0.7.4 setSessionArchived appended session-archive; metadata snapshots
    // could carry session-meta.archived. Neither required a side table.
    const archived = await legacyFixture(archivedId, [{ type: 'session-archive', archived: true, timestamp: oldDate.toISOString() }])
    const metadataId = '00000002-aaaa-bbbb-cccc-dddddddddddd'
    const metadata = await legacyFixture(metadataId, [{ type: 'session-meta', archived: true }])
    const ordinary = await fixture(ordinaryId)
    const archivePath = join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await expect(access(archivePath)).rejects.toThrow()

    const result = first === 'file-history' ? await cleanupOldFileHistoryBackups()
      : first === 'session-env' ? await cleanupOldSessionEnvDirs()
        : await cleanupOldSessionFiles(cutoff)
    expect(result).toEqual({ messages: first === 'transcript' ? 4 : 1, errors: 0 })
    const remainingTranscripts = first === 'transcript' ? 0 : 4
    expect(await cleanupOldSessionFiles(cutoff, { dryRun: true })).toEqual({ messages: remainingTranscripts, errors: 0 })
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: remainingTranscripts, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: first === 'file-history' ? 0 : 1, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: first === 'session-env' ? 0 : 1, errors: 0 })
    for (const legacy of [archived, metadata]) {
      for (const file of legacy.files) expect(await readFile(file, 'utf8')).toBe(file === legacy.files[0] ? legacy.transcript : fixtureBytes)
    }
    for (const file of ordinary) await expect(access(file)).rejects.toThrow()
    expect([...readSessionArchives(configDir).ids].sort()).toEqual([archivedId, metadataId])
    const persisted = await readFile(archivePath, 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({ schemaVersion: 1, sessions: { [archivedId]: { archived: true }, [metadataId]: { archived: true } } })
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 0, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: 0, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: 0, errors: 0 })
    expect(await readFile(archivePath, 'utf8')).toBe(persisted)
  })

  it.each([
    ['session-meta', 'session-archive', false],
    ['session-archive', 'session-meta', false],
    ['session-meta', 'session-archive', true],
    ['session-archive', 'session-meta', true],
  ] as const)('uses file order for %s followed by %s with final archived=%s', async (firstType, lastType, archived) => {
    const legacy = await legacyFixture(archivedId, [
      { type: firstType, archived: !archived, timestamp: '2021-01-01T00:00:00.000Z' },
      { type: lastType, archived, timestamp: oldDate.toISOString() },
      { type: 'session-meta', workDir: join(configDir, 'old-project') },
    ])
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: archived ? 0 : 4, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: archived ? 0 : 1, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: archived ? 0 : 1, errors: 0 })
    expect(readSessionArchives(configDir).state.sessions[archivedId]).toMatchObject({ archived })
    for (const file of legacy.files) {
      if (archived) expect(await readFile(file, 'utf8')).toBe(file === legacy.files[0] ? legacy.transcript : fixtureBytes)
      else await expect(access(file)).rejects.toThrow()
    }
  })

  it.each([false, true])('preserves explicit side-table archived=%s and extensions while recovering missing records', async archived => {
    const legacy = await legacyFixture(archivedId, [{ type: 'session-archive', archived: !archived }])
    const missing = await legacyFixture(ordinaryId, [{ type: 'session-meta', archived: true }])
    const archivePath = join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await mkdir(dirname(archivePath))
    const explicit = { archived, futureRecord: { keep: true } }
    const bytes = JSON.stringify({ schemaVersion: 1, futureRoot: ['keep'], sessions: { [archivedId]: explicit } })
    await writeFile(archivePath, bytes)
    expect(await cleanupOldSessionFiles(cutoff, { dryRun: true })).toEqual({ messages: archived ? 0 : 4, errors: 0 })
    expect(await readFile(archivePath, 'utf8')).toBe(bytes)
    await expect(access(join(dirname(archivePath), 'session-archives.legacy-jsonl-migration.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: archived ? 0 : 4, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: archived ? 0 : 1, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: archived ? 0 : 1, errors: 0 })
    expect(readSessionArchives(configDir).state).toMatchObject({ futureRoot: ['keep'], sessions: { [archivedId]: explicit, [ordinaryId]: { archived: true } } })
    for (const file of missing.files) expect(await readFile(file, 'utf8')).toBe(file === missing.files[0] ? missing.transcript : fixtureBytes)
    for (const file of legacy.files) {
      if (archived) expect(await readFile(file, 'utf8')).toBe(file === legacy.files[0] ? legacy.transcript : fixtureBytes)
      else await expect(access(file)).rejects.toThrow()
    }
    const persisted = await readFile(archivePath, 'utf8')
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 0, errors: 0 })
    expect(await readFile(archivePath, 'utf8')).toBe(persisted)
  })

  it.each([
    '{"type":"session-archive","archived":true\n',
    '{"type":"session-archive","archived":"true"}\n',
    '{"type":"session-archive","archived":tru',
  ])('fails closed on unknown legacy archive state and retries after fixture repair: %s', async tail => {
    const legacy = await legacyFixture(archivedId, [{ type: 'session-meta', archived: false }])
    const ordinary = await fixture(ordinaryId)
    const damaged = legacy.transcript + tail
    await writeFile(legacy.files[0]!, damaged)
    await utimes(legacy.files[0]!, oldDate, oldDate)
    await expect(cleanupOldSessionFiles(cutoff, { dryRun: true })).rejects.toThrow()
    await expect(access(getEchoFlowInternalDir(configDir))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(cleanupOldSessionFiles(cutoff)).rejects.toThrow()
    await expect(cleanupOldFileHistoryBackups()).rejects.toThrow()
    await expect(cleanupOldSessionEnvDirs()).rejects.toThrow()
    for (const file of [...legacy.files, ...ordinary]) expect(await readFile(file, 'utf8')).toBe(file === legacy.files[0] ? damaged : fixtureBytes)
    const repaired = legacy.transcript + JSON.stringify({ type: 'session-archive', archived: true }) + '\n'
    await writeFile(legacy.files[0]!, repaired)
    await utimes(legacy.files[0]!, oldDate, oldDate)
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 4, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: 1, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: 1, errors: 0 })
    expect(readSessionArchives(configDir).ids.has(archivedId)).toBe(true)
    for (const file of legacy.files) expect(await readFile(file, 'utf8')).toBe(file === legacy.files[0] ? repaired : fixtureBytes)
    for (const file of ordinary) await expect(access(file)).rejects.toThrow()
  })

  it.each(['transcript', 'subagent', 'tool-result', 'file-history', 'session-env'] as const)('rechecks archive state after scanning a %s deletion candidate', async kind => {
    const files = await fixture(archivedId)
    for (const file of files) await utimes(file, new Date(), new Date())
    const candidate = kind === 'transcript' ? files[0]!
      : kind === 'subagent' ? files[2]!
        : kind === 'tool-result' ? files[3]!
          : dirname(files[kind === 'file-history' ? 4 : 5]!)
    await utimes(candidate, oldDate, oldDate)
    const fsImpl = getFsImplementation()
    const stat = fsImpl.stat.bind(fsImpl)
    let archivedDuringScan = false
    const probe = spyOn(fsImpl, 'stat').mockImplementation(async file => {
      const result = await stat(file)
      if (file === candidate && !archivedDuringScan) {
        archivedDuringScan = true
        await withSessionArchiveLock(configDir, async () => writeSessionArchive(configDir, archivedId, true))
      }
      return result
    })
    try {
      const result = kind === 'file-history' ? await cleanupOldFileHistoryBackups()
        : kind === 'session-env' ? await cleanupOldSessionEnvDirs()
          : await cleanupOldSessionFiles(new Date('2026-01-01T00:00:00.000Z'))
      expect(archivedDuringScan).toBe(true)
      expect(result).toEqual({ messages: 0, errors: 0 })
      for (const file of files) expect(await readFile(file, 'utf8')).toBe(fixtureBytes)
    } finally { probe.mockRestore() }
  })

  it('keeps a transcript refreshed under the archive lock after the retention scan', async () => {
    const [transcript] = await fixture(ordinaryId)
    const refreshed = JSON.stringify({ type: 'session-meta', workDir: configDir }) + '\n'
    const fsImpl = getFsImplementation()
    const stat = fsImpl.stat.bind(fsImpl)
    let refreshedDuringScan = false
    const probe = spyOn(fsImpl, 'stat').mockImplementation(async file => {
      const result = await stat(file)
      if (file === transcript && !refreshedDuringScan) {
        refreshedDuringScan = true
        await withSessionArchiveLock(configDir, () => writeFile(transcript!, refreshed))
      }
      return result
    })
    try {
      expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 3, errors: 0 })
      expect(refreshedDuringScan).toBe(true)
      expect(await readFile(transcript!, 'utf8')).toBe(refreshed)
    } finally { probe.mockRestore() }
  })

  it('excludes old archived transcripts and backing files from preview and actual cleanup, then resumes cleanup after restore', async () => {
    const archived = await fixture(archivedId)
    const ordinary = await fixture(ordinaryId)
    const archivePath = join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await mkdir(dirname(archivePath))
    // Old unversioned metadata is also a retention promise.
    await writeFile(archivePath, JSON.stringify({ sessions: { [archivedId]: { archived: true, extension: 'keep' } }, rootExtension: true }))
    const cutoff = new Date('2026-01-01T00:00:00.000Z')
    expect(await cleanupOldSessionFiles(cutoff, { dryRun: true })).toEqual({ messages: 4, errors: 0 })
    for (const file of [...archived, ...ordinary]) expect(await readFile(file, 'utf8')).toBe(fixtureBytes)
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 4, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: 1, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: 1, errors: 0 })
    for (const file of archived) expect(await readFile(file, 'utf8')).toBe(fixtureBytes)
    for (const file of ordinary) await expect(access(file)).rejects.toThrow()
    writeSessionArchive(configDir, archivedId, false)
    expect(readSessionArchives(configDir).state).toMatchObject({ schemaVersion: 1, rootExtension: true, sessions: { [archivedId]: { archived: false, extension: 'keep' } } })
    expect(await cleanupOldSessionFiles(cutoff)).toEqual({ messages: 4, errors: 0 })
    expect(await cleanupOldFileHistoryBackups()).toEqual({ messages: 1, errors: 0 })
    expect(await cleanupOldSessionEnvDirs()).toEqual({ messages: 1, errors: 0 })
    for (const file of archived) await expect(access(file)).rejects.toThrow()
  })

  it('stops destructive cleanup when archive metadata is unreadable', async () => {
    const archived = await fixture(archivedId)
    const archivePath = join(getEchoFlowInternalDir(configDir), 'session-archives.json')
    await mkdir(dirname(archivePath))
    await writeFile(archivePath, '{broken')
    await expect(cleanupOldSessionFiles(new Date())).rejects.toThrow()
    await expect(cleanupOldFileHistoryBackups()).rejects.toThrow()
    await expect(cleanupOldSessionEnvDirs()).rejects.toThrow()
    for (const file of archived) expect(await readFile(file, 'utf8')).toBe(fixtureBytes)
    expect(await readFile(archivePath, 'utf8')).toBe('{broken')
  })
})
