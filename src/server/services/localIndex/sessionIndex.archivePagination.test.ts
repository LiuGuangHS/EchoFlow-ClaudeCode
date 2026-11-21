import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalIndexDatabase, type LocalIndexBinding, type LocalIndexDatabase } from './database.js'
import { createSessionIndex, type SessionIndex } from './sessionIndex.js'

let directory: string
let database: LocalIndexDatabase
let index: SessionIndex
let queries: string[]
let materialized: number

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'archive-index-page-'))
  database = openLocalIndexDatabase({ scope: directory, path: join(join(directory, 'cc-haha'), 'db', 'index-v1.sqlite') })
  queries = []
  materialized = 0
  index = createSessionIndex({
    ...database,
    read: callback => database.read(operation => callback({
      get: <T>(sql: string, ...bindings: LocalIndexBinding[]) => {
        queries.push(sql)
        return operation.get<T>(sql, ...bindings)
      },
      all: <T>(sql: string, ...bindings: LocalIndexBinding[]) => {
        queries.push(sql)
        const rows = operation.all<T>(sql, ...bindings)
        materialized += rows.length
        return rows
      },
    })),
  })
})

afterEach(async () => {
  database?.close()
  await rm(directory, { recursive: true, force: true })
})

function seed(rows: Array<{ id: string; project?: string; modified?: number; worker?: boolean }>) {
  database.transaction(operation => {
    rows.forEach((row, n) => {
      const path = `/fixture/${String(n).padStart(5, '0')}.jsonl`
      operation.run("INSERT INTO source_files(path,kind,size_bytes,mtime_ms,prefix_hash,parser_version,state,updated_at_ms) VALUES (?,'transcript',0,0,'fixture',1,'ready',0)", path)
      operation.run(`INSERT INTO sessions(transcript_path,session_id,project_path,title,created_at,modified_at,modified_at_ms,message_count,is_team_worker)
        VALUES (?,?,?,?,?,?,?,?,?)`, path, row.id, row.project ?? 'project', row.id,
      '2026-01-01', new Date(row.modified ?? n).toISOString(), row.modified ?? n, 1, row.worker ? 1 : 0)
    })
  })
}

test.each([false, true])('filters before a deep small page with archived=%s without materializing history', archived => {
  const rows = Array.from({ length: 1505 }, (_, n) => ({ id: `session-${String(n).padStart(5, '0')}` }))
  seed(rows)
  const ids = rows.filter((_, n) => n % 3 === 0).map(row => row.id)
  const archive = { ids, archived }
  const expected = rows.filter((_, n) => (n % 3 === 0) === archived).reverse()

  const page = index.listSessions({ archive, limit: 3, offset: 410 })

  expect(page.total).toBe(expected.length)
  expect(page.sessions.map(row => row.id)).toEqual(expected.slice(410, 413).map(row => row.id))
  expect(queries).toHaveLength(2)
  expect(materialized).toBe(3)
  expect(index.listSessions({ archive, limit: 0 }).total).toBe(expected.length)
  expect(index.listSessions({ archive, offset: expected.length })).toEqual({ sessions: [], total: expected.length })
})

test('preserves project, worker exclusion, duplicate identities and deterministic tie order', () => {
  seed([
    { id: 'shared', project: 'a', modified: 100 },
    { id: 'shared', project: 'b', modified: 100 },
    { id: 'shared', project: 'a', modified: 100 },
    { id: 'worker', project: 'a', modified: 200, worker: true },
    { id: 'ordinary', project: 'a', modified: 50 },
  ])
  const archive = { ids: ['shared', 'worker'], archived: true }
  expect(index.listSessions({ archive, limit: 10 })).toMatchObject({
    total: 3,
    sessions: [{ transcriptPath: '/fixture/00000.jsonl' }, { transcriptPath: '/fixture/00001.jsonl' }, { transcriptPath: '/fixture/00002.jsonl' }],
  })
  expect(index.listSessions({ archive, project: 'a', offset: 1, limit: 1 })).toMatchObject({
    total: 2, sessions: [{ transcriptPath: '/fixture/00002.jsonl' }],
  })
  expect(index.listSessions({ archive: { ...archive, archived: false }, project: 'a' })).toMatchObject({
    total: 1, sessions: [{ id: 'ordinary' }],
  })
  expect(index.listSessions({ archive, project: 'missing' })).toEqual({ total: 0, sessions: [] })
})

test('classifies nullable legacy evidence before count and pagination, with explicit overrides', () => {
  seed([
    { id: 'ordinary' }, { id: 'legacy' }, { id: 'unknown' },
    { id: 'restored' }, { id: 'explicit' },
    { id: 'conflict', project: 'a' }, { id: 'conflict', project: 'b' },
    { id: 'incomplete', project: 'a' }, { id: 'incomplete', project: 'b' },
  ])
  database.transaction(operation => {
    for (const [n, value] of [[0, 0], [1, 1], [3, 1], [5, 0], [6, 1], [7, 0]] as const) {
      operation.run('UPDATE sessions SET legacy_archived = ? WHERE transcript_path = ?', value, `/fixture/${String(n).padStart(5, '0')}.jsonl`)
    }
  })
  const archive = { ids: ['explicit'], ordinaryIds: ['restored'], migrationComplete: false, archived: false }
  expect(index.listSessions({ archive, limit: 1, offset: 1 })).toMatchObject({ total: 2, sessions: [{ id: 'ordinary', legacyArchived: false }] })
  expect(queries).toHaveLength(2)
  expect(materialized).toBe(1)
  expect(index.listSessions({ archive: { ...archive, archived: true } })).toMatchObject({ total: 2, sessions: [{ id: 'explicit' }, { id: 'legacy', legacyArchived: true }] })
  expect(index.listSessions({ archive, project: 'a' })).toEqual({ total: 0, sessions: [] })
  expect(index.getSession('conflict')?.legacyArchived).toBeNull()
  expect(index.getProjectionSeed('/fixture/00002.jsonl')?.summary.legacyArchived).toBeNull()
  expect(index.getProjectionSeed('/fixture/00001.jsonl')?.summary.legacyArchived).toBe(true)
  expect(index.listSessions({ archive, limit: 0 })).toEqual({ total: 2, sessions: [] })
  expect(index.listSessions({ archive: { ...archive, migrationComplete: true } }).total).toBe(8)
  expect(index.listSessions({ archive: { ...archive, migrationComplete: true, archived: true } }).total).toBe(1)
})

test('handles empty and large archive sets as bound values without SQL variable limits', () => {
  seed([{ id: "quoted-'id" }, { id: 'ordinary' }])
  const ids = Array.from({ length: 40000 }, (_, n) => `missing-${n}`)
  ids.push("quoted-'id", "quoted-'id")
  expect(index.listSessions({ archive: { ids, archived: true } })).toMatchObject({ total: 1, sessions: [{ id: "quoted-'id" }] })
  expect(index.listSessions({ archive: { ids, archived: false } })).toMatchObject({ total: 1, sessions: [{ id: 'ordinary' }] })
  expect(index.listSessions({ archive: { ids: [], archived: true } })).toEqual({ total: 0, sessions: [] })
  expect(index.listSessions({ archive: { ids: [], archived: false } }).total).toBe(2)
  expect(index.listSessions().total).toBe(2)
})
