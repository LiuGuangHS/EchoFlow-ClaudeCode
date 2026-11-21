import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as fsSync from 'node:fs'
import * as fs from 'node:fs/promises'
import { access, appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEchoFlowInternalDir } from '../../utils/echoFlowConfigRoot.js'
import { ensureSessionArchivesMigrated } from '../../utils/sessionArchiveStore.js'
import * as archiveStore from '../../utils/sessionArchiveStore.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { SessionService } from './sessionService.js'
import { openLocalIndexDatabase, type LocalIndexDatabase } from './localIndex/database.js'
import { createSessionIndex, type LocalIndexGateway } from './localIndex/sessionIndex.js'
import { createSessionProjector, type SessionSourceCandidate } from './localIndex/sessionProjector.js'
import { verifySourceFingerprint } from './localIndex/sourceFingerprint.js'

let root: string
let previousHome: string | undefined
let previousConfigDir: string | undefined
let database: LocalIndexDatabase | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'service-archive-page-'))
  previousHome = process.env.HOME
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.HOME = root
  process.env.CLAUDE_CONFIG_DIR = root
})
afterEach(async () => {
  database?.close()
  database = undefined
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await rm(root, { recursive: true, force: true })
})

test.each([false, true])('reads one bounded index page and hydrates only the requested rows with archived=%s', async archived => {
  const workDir = join(root, 'workspace')
  const project = sanitizePath(workDir)
  const projectDir = join(root, 'projects', project)
  await mkdir(workDir)
  await mkdir(projectDir, { recursive: true })
  await ensureSessionArchivesMigrated(root)
  const rows = Array.from({ length: 1205 }, (_, n) => ({
    id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`,
    modified: n,
    archived: n % 3 === 0,
  }))
  database = openLocalIndexDatabase({ scope: root, path: join(getEchoFlowInternalDir(root), 'db', 'index-v1.sqlite') })
  database.transaction(operation => {
    for (const row of rows) {
      const file = join(projectDir, `${row.id}.jsonl`)
      operation.run("INSERT INTO source_files(path,kind,size_bytes,mtime_ms,prefix_hash,parser_version,state,updated_at_ms) VALUES (?,'transcript',0,0,'fixture',1,'ready',0)", file)
      operation.run(`INSERT INTO sessions(transcript_path,session_id,project_path,title,created_at,modified_at,modified_at_ms,message_count,work_dir)
        VALUES (?,?,?,?,?,?,?,?,?)`, file, row.id, project, row.id, '2026-01-01', new Date(row.modified).toISOString(), row.modified, 1, workDir)
    }
  })
  await writeFile(join(getEchoFlowInternalDir(root), 'session-archives.json'), JSON.stringify({
    schemaVersion: 1,
    sessions: Object.fromEntries(rows.filter(row => row.archived).map(row => [row.id, { archived: true }])),
  }))
  const expected = rows.filter(row => row.archived === archived).reverse()
  // Only the requested rows need source files. A ready index must not scan or
  // validate the other historical transcripts to produce this page.
  for (const row of expected.slice(200, 203)) {
    await writeFile(join(projectDir, `${row.id}.jsonl`), JSON.stringify({ type: 'session-meta', workDir }) + '\n')
  }
  const index = createSessionIndex(database)
  const status = {
    mode: 'on' as const, state: 'ready' as const, discovered: rows.length, indexed: rows.length,
    degradedSources: 0, databaseBytes: 0, walBytes: 0, lastUpdatedAt: '2026-01-01T00:00:00.000Z', lastErrorCode: null,
  }
  const gateway: LocalIndexGateway = {
    ...index, getMode: () => 'on', getPublicStatus: () => status, isSessionScopeReady: () => true,
    start: async () => {}, stop: async () => {}, rebuild: async () => status,
  }
  const list = spyOn(gateway, 'listSessions')
  const service = new SessionService(gateway)
  const internals = service as unknown as {
    hydrateIndexedSession: (...args: unknown[]) => Promise<unknown>
    discoverSessionFiles: (...args: unknown[]) => Promise<unknown>
  }
  const hydrate = spyOn(internals, 'hydrateIndexedSession')
  const discover = spyOn(internals, 'discoverSessionFiles')
  try {
    const result = await service.listSessions({ project: workDir, archived, offset: 200, limit: 3 })
    expect(result.total).toBe(expected.length)
    expect(result.sessions.map(row => row.id)).toEqual(expected.slice(200, 203).map(row => row.id))
    expect(hydrate).toHaveBeenCalledTimes(3)
    expect(discover).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[0]?.[0]).toMatchObject({ project, offset: 200, limit: 3 })
  } finally {
    list.mockRestore()
    hydrate.mockRestore()
    discover.mockRestore()
  }
})

const firstUseId = (n: number) => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`
const jsonl = (entry: Record<string, unknown>) => JSON.stringify(entry) + '\n'

async function firstUseIndex(rows: Array<{ n: number; tail?: string }>, mode: 'on' | 'off' | 'shadow' = 'on') {
  const workDir = join(root, 'workspace')
  const project = sanitizePath(workDir)
  const projectDir = join(root, 'projects', project)
  await mkdir(workDir)
  await mkdir(projectDir, { recursive: true })
  database = openLocalIndexDatabase({ scope: root, path: join(getEchoFlowInternalDir(root), 'db', 'index-v1.sqlite') })
  const index = createSessionIndex(database)
  const projector = createSessionProjector({ database, index, scope: root })
  const candidates = new Map<number, SessionSourceCandidate>()
  for (const row of rows) {
    const file = join(projectDir, `${firstUseId(row.n)}.jsonl`)
    await writeFile(file, jsonl({ type: 'session-meta', workDir, cliRuntimeId: 'installed' })
      + jsonl({ type: 'user', uuid: `user-${row.n}`, timestamp: new Date(Date.UTC(2026, 0, 1, 0, row.n)).toISOString(), message: { role: 'user', content: `Fixture ${row.n}` } })
      + (row.tail ?? ''))
    const snapshot = await stat(file)
    const candidate: SessionSourceCandidate = {
      path: file, sessionId: firstUseId(row.n), projectPath: project, fallbackWorkDir: workDir,
      fallbackCreatedAt: snapshot.birthtime.toISOString(), fallbackModifiedAt: snapshot.mtime.toISOString(), modifiedAtMs: snapshot.mtimeMs,
    }
    candidates.set(row.n, candidate)
    expect(await projector.projectSource(candidate)).toMatchObject({ kind: 'indexed' })
  }
  const status = {
    mode, state: 'ready' as const, discovered: rows.length, indexed: rows.length,
    degradedSources: 0, databaseBytes: 0, walBytes: 0, lastUpdatedAt: '2026-01-01T00:00:00.000Z', lastErrorCode: null,
  }
  const gateway: LocalIndexGateway = {
    ...index, getMode: () => mode, getPublicStatus: () => status, isSessionScopeReady: () => true,
    start: async () => {}, stop: async () => {}, rebuild: async () => status,
  }
  return { service: new SessionService(gateway), gateway, index, candidates, workDir }
}

test.each(['ordinary', 'archived', 'previews', 'history', 'archived-history', 'summary', 'detail'] as const)(
  'first %s browse uses classified rows without opening malformed unrelated history or importing it', async view => {
    const { service, candidates, workDir } = await firstUseIndex([
      { n: 0 },
      { n: 1, tail: jsonl({ type: 'session-archive', archived: true }) },
      { n: 2, tail: jsonl({ type: 'session-meta', archived: false }) },
      { n: 3, tail: '{malformed unrelated record}\n' },
      { n: 4, tail: jsonl({ type: 'session-archive', archived: 'false' }) },
      { n: 5, tail: '{"type":"assistant"' },
      { n: 6, tail: jsonl({ type: 'session-meta', archived: false }) },
      { n: 7, tail: jsonl({ type: 'session-archive', archived: true }) },
    ])
    const archivePath = join(getEchoFlowInternalDir(root), 'session-archives.json')
    const marker = join(getEchoFlowInternalDir(root), 'session-archives.legacy-jsonl-migration.json')
    const explicit = JSON.stringify({ schemaVersion: 1, futureRoot: ['keep'], sessions: {
      [firstUseId(6)]: { archived: true, futureRecord: 'keep' },
      [firstUseId(7)]: { archived: false, futureRecord: 'keep' },
    } })
    await writeFile(archivePath, explicit)
    await expect(access(marker)).rejects.toThrow()
    const open = spyOn(fs, 'open')
    const stream = spyOn(fsSync, 'createReadStream')
    const migrate = spyOn(archiveStore, 'ensureSessionArchivesMigrated')
    const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id)
    try {
      if (view === 'ordinary' || view === 'archived') {
        const archived = view === 'archived'
        const page = await service.listSessions({ archived, limit: 20 })
        expect(page.total).toBe(archived ? 2 : 3)
        expect(ids(page.sessions)).toEqual((archived ? [6, 1] : [7, 2, 0]).map(firstUseId))
      } else if (view === 'previews') {
        const page = await service.listProjectPreviews(20)
        expect(page.total).toBe(3)
        expect(ids(page.sessions)).toEqual([7, 2, 0].map(firstUseId))
        expect(page.projects).toEqual([{ projectRoot: workDir, total: 3, archivedTotal: 2 }])
        expect(service.listArchivedSessionIds().sort()).toEqual([1, 6].map(firstUseId))
      } else if (view === 'history' || view === 'archived-history') {
        const page = await service.listProjectHistory({ projectRoot: workDir, archived: view === 'archived-history', limit: 20 })
        expect(ids(page.sessions)).toEqual((view === 'archived-history' ? [6, 1] : [7, 2, 0]).map(firstUseId))
        expect(page.nextCursor).toBeNull()
      } else {
        const session = view === 'summary' ? await service.getSessionSummary(firstUseId(1))
          : await service.getSession(firstUseId(1), { includeSubagents: false })
        expect(session).toMatchObject({ id: firstUseId(1), archived: true, messageCount: 1 })
        expect(session).not.toHaveProperty('cliRuntimeId')
      }
      expect(migrate).not.toHaveBeenCalled()
      for (const n of [3, 4, 5]) {
        const unresolved = candidates.get(n)!.path
        expect(open.mock.calls.some(call => String(call[0]) === unresolved)).toBe(false)
        expect(stream.mock.calls.some(call => String(call[0]) === unresolved)).toBe(false)
      }
      expect(await readFile(archivePath, 'utf8')).toBe(explicit)
      await expect(access(marker)).rejects.toThrow()
    } finally { open.mockRestore(); stream.mockRestore(); migrate.mockRestore() }
  },
)

test.each(['off', 'shadow'] as const)('file-backed %s browsing excludes unresolved inputs instead of defaulting them to ordinary', async mode => {
  const { service } = await firstUseIndex([
    { n: 0 },
    { n: 1, tail: jsonl({ type: 'session-meta', archived: true }) },
    { n: 2, tail: '{malformed unrelated record}\n' },
    { n: 3, tail: '{"type":"assistant"' },
  ], mode)
  expect(await service.listSessions()).toMatchObject({ total: 1, sessions: [{ id: firstUseId(0) }] })
  expect(await service.listSessions({ archived: true })).toMatchObject({ total: 1, sessions: [{ id: firstUseId(1), archived: true }] })
  await expect(access(join(getEchoFlowInternalDir(root), 'session-archives.legacy-jsonl-migration.json'))).rejects.toThrow()
})

test('ready first page never enters the exhaustive importer when its completion marker is absent', async () => {
  const { service, gateway } = await firstUseIndex([{ n: 0 }, { n: 1 }])
  const migrate = spyOn(archiveStore, 'ensureSessionArchivesMigrated').mockImplementation(async () => {
    throw new Error('A ready page must not wait for the exhaustive importer')
  })
  const list = spyOn(gateway, 'listSessions')
  const internals = service as unknown as {
    hydrateIndexedSession: (...args: unknown[]) => Promise<unknown>
    discoverSessionFiles: (...args: unknown[]) => Promise<unknown>
  }
  const hydrate = spyOn(internals, 'hydrateIndexedSession')
  const discover = spyOn(internals, 'discoverSessionFiles')
  try {
    expect(await service.listSessions({ offset: 1, limit: 1 })).toMatchObject({ total: 2, sessions: [{ id: firstUseId(0) }] })
    expect(list).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[0]?.[0]).toMatchObject({ offset: 1, limit: 1 })
    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(discover).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
  } finally { migrate.mockRestore(); list.mockRestore(); hydrate.mockRestore(); discover.mockRestore() }
})

test.each(['on', 'off', 'shadow'] as const)('conflicting copies stay unclassified across project filters and history in %s mode', async mode => {
  const { service, index, workDir } = await firstUseIndex([
    { n: 0 }, { n: 1, tail: jsonl({ type: 'session-archive', archived: true }) },
  ], mode)
  const otherWorkDir = join(root, 'other-workspace')
  const project = sanitizePath(otherWorkDir)
  const file = join(root, 'projects', project, `${firstUseId(1)}.jsonl`)
  await mkdir(otherWorkDir)
  await mkdir(join(root, 'projects', project), { recursive: true })
  await writeFile(file, jsonl({ type: 'session-meta', workDir: otherWorkDir, archived: false }))
  const snapshot = await stat(file)
  const projector = createSessionProjector({ database: database!, index, scope: root })
  expect(await projector.projectSource({
    path: file, sessionId: firstUseId(1), projectPath: project, fallbackWorkDir: otherWorkDir,
    fallbackCreatedAt: snapshot.birthtime.toISOString(), fallbackModifiedAt: snapshot.mtime.toISOString(), modifiedAtMs: snapshot.mtimeMs,
  })).toMatchObject({ kind: 'indexed' })

  expect(await service.listSessions({ project: workDir })).toMatchObject({ total: 1, sessions: [{ id: firstUseId(0) }] })
  expect(await service.listSessions({ project: otherWorkDir })).toEqual({ total: 0, sessions: [] })
  expect(await service.listSessions({ archived: true })).toEqual({ total: 0, sessions: [] })
  expect(await service.listProjectPreviews()).toMatchObject({ total: 1, sessions: [{ id: firstUseId(0) }] })
  expect(await service.listProjectHistory({ projectRoot: workDir, archived: true })).toEqual({ sessions: [], nextCursor: null })
  await expect(service.getSessionSummary(firstUseId(1))).rejects.toThrow('not yet classified')
  await expect(service.getSession(firstUseId(1), { includeSubagents: false })).rejects.toThrow('not yet classified')

  await service.setSessionArchived(firstUseId(1), true)
  expect((await service.listSessions({ archived: true })).total).toBe(2)
  await service.setSessionArchived(firstUseId(1), false)
  expect((await service.listSessions()).total).toBe(3)
  expect(await service.getSessionSummary(firstUseId(1))).not.toHaveProperty('archived')
  await expect(access(join(getEchoFlowInternalDir(root), 'session-archives.legacy-jsonl-migration.json'))).rejects.toThrow()
})

test('file-backed project pagination does not touch unrelated history after archive migration', async () => {
  const { service, workDir } = await firstUseIndex([
    { n: 0 }, { n: 1 }, { n: 2, tail: jsonl({ type: 'session-archive', archived: true }) },
  ], 'off')
  const otherWorkDir = join(root, 'other-workspace')
  const otherProject = join(root, 'projects', sanitizePath(otherWorkDir))
  const otherFile = join(otherProject, `${firstUseId(3)}.jsonl`)
  await mkdir(otherWorkDir)
  await mkdir(otherProject)
  await writeFile(otherFile, jsonl({ type: 'session-meta', workDir: otherWorkDir }))
  await ensureSessionArchivesMigrated(root)

  const readDir = spyOn(fs, 'readdir')
  const fileStat = spyOn(fs, 'stat')
  const open = spyOn(fs, 'open')
  try {
    const page = await service.listSessions({ project: workDir, offset: 1, limit: 1 })
    expect(page.total).toBe(2)
    expect(page.sessions.map(row => row.id)).toEqual([firstUseId(0)])
    expect(readDir.mock.calls.map(([path]) => String(path))).not.toContain(otherProject)
    expect(fileStat.mock.calls.map(([path]) => String(path))).not.toContain(otherFile)
    expect(open.mock.calls.map(([path]) => String(path))).not.toContain(otherFile)
  } finally { readDir.mockRestore(); fileStat.mockRestore(); open.mockRestore() }
})

test('completion publication invalidates file-list and project catalogs without an archive-state write', async () => {
  const { service, workDir } = await firstUseIndex([
    { n: 0 }, { n: 1, tail: jsonl({ type: 'session-archive', archived: true }) },
    { n: 2, tail: jsonl({ type: 'session-archive', archived: 'invalid' }) },
  ], 'off')
  expect((await service.listSessions()).total).toBe(1)
  expect((await service.listSessions({ archived: true })).total).toBe(1)
  expect((await service.listProjectPreviews()).projects).toEqual([{ projectRoot: workDir, total: 1, archivedTotal: 1 }])
  expect(service.listArchivedSessionIds()).toEqual([firstUseId(1)])
  const internal = getEchoFlowInternalDir(root)
  await writeFile(join(internal, 'session-archives.legacy-jsonl-migration.json'), JSON.stringify({ schemaVersion: 1, archiveStateRequired: false }))

  expect((await service.listSessions()).total).toBe(3)
  expect(await service.listSessions({ archived: true })).toEqual({ total: 0, sessions: [] })
  expect((await service.listProjectPreviews()).projects).toEqual([{ projectRoot: workDir, total: 3 }])
  expect((await service.listProjectHistory({ projectRoot: workDir })).sessions.map(row => row.id)).toEqual([2, 1, 0].map(firstUseId))
  expect(service.listArchivedSessionIds()).toEqual([])
  await expect(readFile(join(internal, 'session-archives.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('a degraded overlay reclassifies a repaired source without scanning unrelated transcripts', async () => {
  const { gateway, index, candidates, workDir } = await firstUseIndex([
    { n: 0 }, { n: 1, tail: '{malformed record}\n' },
  ])
  const failed = candidates.get(1)!
  const status = gateway.getPublicStatus()
  gateway.getPublicStatus = () => ({ ...status, state: 'degraded', degradedSources: 1 })
  gateway.getSourceScopedFailurePaths = () => [failed.path]
  let now = 0
  const service = new SessionService(gateway, { now: () => now })
  const internals = service as unknown as { discoverSessionFiles: (...args: unknown[]) => Promise<unknown> }
  const discover = spyOn(internals, 'discoverSessionFiles')
  try {
    expect(await service.listSessions()).toMatchObject({ total: 1, sessions: [{ id: firstUseId(0) }] })
    expect(await service.listSessions({ archived: true })).toEqual({ total: 0, sessions: [] })
    expect((await service.listProjectPreviews()).projects).toEqual([{ projectRoot: workDir, total: 1 }])
    const original = await readFile(failed.path, 'utf8')
    await writeFile(failed.path, original.replace('{malformed record}\n', jsonl({ type: 'session-archive', archived: true })))
    now = 6000
    expect(await service.listSessions({ archived: true })).toMatchObject({ total: 1, sessions: [{ id: firstUseId(1), archived: true }] })
    expect((await service.listProjectPreviews()).projects).toEqual([{ projectRoot: workDir, total: 1, archivedTotal: 1 }])
    expect(service.listArchivedSessionIds()).toEqual([firstUseId(1)])
    expect(index.getSession(firstUseId(1))?.legacyArchived).toBeNull()
    expect(discover).not.toHaveBeenCalled()
    await expect(access(join(getEchoFlowInternalDir(root), 'session-archives.legacy-jsonl-migration.json'))).rejects.toThrow()
  } finally { discover.mockRestore() }
})

test.each([false, true])('history cursors recheck classification before and during hydration with archived=%s', async archived => {
  const { service, workDir } = await firstUseIndex([0, 1, 2, 3].map(n => ({
    n, tail: jsonl({ type: 'session-archive', archived }),
  })))
  const first = await service.listProjectHistory({ projectRoot: workDir, archived, limit: 1 })
  expect(first.sessions.map(row => row.id)).toEqual([firstUseId(3)])
  expect(first.nextCursor).not.toBeNull()
  await service.setSessionArchived(firstUseId(2), !archived)
  const internals = service as unknown as { hydrateIndexedSession: (...args: unknown[]) => Promise<unknown> }
  const originalHydrate = internals.hydrateIndexedSession.bind(internals)
  let changed = false
  const hydrate = spyOn(internals, 'hydrateIndexedSession').mockImplementation(async (...args) => {
    if (!changed) {
      changed = true
      await service.setSessionArchived(firstUseId(0), !archived)
    }
    return originalHydrate(...args)
  })
  try {
    const second = await service.listProjectHistory({ projectRoot: workDir, archived, cursor: first.nextCursor!, limit: 2 })
    expect(changed).toBe(true)
    expect(second.sessions.map(row => row.id)).toEqual([firstUseId(1)])
    expect(second.nextCursor).toBeNull()
    await expect(access(join(getEchoFlowInternalDir(root), 'session-archives.legacy-jsonl-migration.json'))).rejects.toThrow()
  } finally { hydrate.mockRestore() }
})

test.each(['history', 'previews'])('%s rechecks legacy classification committed before the watcher batch completes', async view => {
  const { service, index, candidates, workDir } = await firstUseIndex([0, 1, 2].map(n => ({
    n, tail: jsonl({ type: 'session-archive', archived: false }),
  })))
  const first = await service.listProjectHistory({ projectRoot: workDir, limit: 1 })
  expect(first.sessions.map(row => row.id)).toEqual([firstUseId(2)])
  expect(first.nextCursor).not.toBeNull()
  const projector = createSessionProjector({ database: database!, index, scope: root })
  const changed = candidates.get(1)!
  const internals = service as unknown as { hydrateIndexedSession: (...args: unknown[]) => Promise<unknown> }
  const originalHydrate = internals.hydrateIndexedSession.bind(internals)
  let updated = false
  const hydrate = spyOn(internals, 'hydrateIndexedSession').mockImplementation(async (...args) => {
    if (!updated) {
      updated = true
      await appendFile(changed.path, jsonl({ type: 'session-archive', archived: true }))
      expect(await projector.projectSource(changed)).toMatchObject({ kind: 'indexed', projection: { summary: { legacyArchived: true } } })
    }
    return originalHydrate(...args)
  })
  try {
    if (view === 'history') {
      const next = await service.listProjectHistory({ projectRoot: workDir, cursor: first.nextCursor!, limit: 1 })
      expect(next.sessions.map(row => row.id)).toEqual([firstUseId(0)])
      expect(next.nextCursor).toBeNull()
    } else {
      const previews = await service.listProjectPreviews()
      expect(previews.sessions.map(row => row.id)).toEqual([2, 0].map(firstUseId))
      expect(previews.projects).toEqual([{ projectRoot: workDir, total: 2, archivedTotal: 1 }])
    }
    expect(updated).toBe(true)
  } finally { hydrate.mockRestore() }
})

test('a normal concurrent append retries only its source while known sessions remain browsable', async () => {
  const { service, gateway, index, candidates } = await firstUseIndex([{ n: 0 }, { n: 1, tail: '{"type":"assistant"' }])
  const changing = candidates.get(1)!
  await appendFile(changing.path, ',"message":{"role":"assistant","content":"completed append"}}\n')
  let appended = false
  const projector = createSessionProjector({
    database: database!, index, scope: root,
    verifyFingerprint: async options => {
      if (!appended) {
        appended = true
        await appendFile(changing.path, '{"type":"assistant"')
      }
      return verifySourceFingerprint(options)
    },
  })
  expect(await projector.projectSource(changing)).toEqual({ kind: 'retry', reason: 'changed-during-read' })
  expect(appended).toBe(true)
  expect(await service.listSessions()).toMatchObject({ total: 1, sessions: [{ id: firstUseId(0) }] })
  expect(await service.listSessions({ archived: true })).toEqual({ total: 0, sessions: [] })
  await appendFile(changing.path, ',"message":{"role":"assistant","content":"finished"}}\n')
  expect(await projector.projectSource(changing)).toMatchObject({ kind: 'indexed', projection: { summary: { legacyArchived: false } } })
  expect((await new SessionService(gateway).listSessions()).total).toBe(2)
  await expect(access(join(getEchoFlowInternalDir(root), 'session-archives.legacy-jsonl-migration.json'))).rejects.toThrow()
})
