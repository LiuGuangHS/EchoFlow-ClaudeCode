import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { getEchoFlowInternalDir } from './echoFlowConfigRoot.js'
import { lock } from './lockfile.js'
import { listLegacyArchiveTranscripts, migrateArchiveState, parseSessionArchiveMarker, readLegacyArchiveTranscript, sessionArchiveMarkerName, sessionArchiveStateName, type ArchiveRecord, type ArchiveState } from './sessionArchiveData.js'

type Snapshot = { revision: string; state: ArchiveState; ids: ReadonlySet<string> }
const cache = new Map<string, Snapshot>()
const mutationQueues = new Map<string, Promise<void>>()

function statePath(configDir: string): string {
  return join(getEchoFlowInternalDir(configDir), sessionArchiveStateName)
}

/** Cleanup and archive mutations share this lock, including across CLI/server
 * processes. Each caller locks only one candidate, never an entire sweep. */
export async function withSessionArchiveLock<T>(configDir: string, action: () => Promise<T>): Promise<T> {
  const filePath = statePath(configDir)
  const previous = mutationQueues.get(filePath) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(async () => {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
    const release = await lock(filePath, { realpath: false, retries: { retries: 30, minTimeout: 10, maxTimeout: 100 } })
    try { return await action() } finally { await release() }
  })
  const queued = operation.then(() => {}, () => {})
  mutationQueues.set(filePath, queued)
  try { return await operation } finally {
    if (mutationQueues.get(filePath) === queued) mutationQueues.delete(filePath)
  }
}

export function readSessionArchives(configDir: string): Snapshot {
  const filePath = statePath(configDir)
  let revision: string
  try {
    const stat = statSync(filePath)
    revision = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { revision: 'missing', state: { schemaVersion: 1, sessions: {} }, ids: new Set() }
  }
  const previous = cache.get(filePath)
  if (previous?.revision === revision) return previous
  const state = migrateArchiveState(JSON.parse(readFileSync(filePath, 'utf8')))
  const snapshot = { revision, state, ids: new Set(Object.entries(state.sessions).filter(([, value]) => value.archived).map(([id]) => id)) }
  cache.delete(filePath)
  cache.set(filePath, snapshot)
  while (cache.size > 16) cache.delete(cache.keys().next().value!)
  return snapshot
}

function legacyMigrationPath(configDir: string): string {
  return join(getEchoFlowInternalDir(configDir), sessionArchiveMarkerName)
}

function readLegacyMigrationMarker(configDir: string): { revision: string; archiveStateRequired: boolean } | null {
  let raw: string
  try { raw = readFileSync(legacyMigrationPath(configDir), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const marker = parseSessionArchiveMarker(JSON.parse(raw))
  if (marker.archiveStateRequired && readSessionArchives(configDir).revision === 'missing') {
    throw new Error('Migrated session archive state is missing; cleanup was stopped')
  }
  return { revision: raw, archiveStateRequired: marker.archiveStateRequired }
}

function legacyMigrationComplete(configDir: string): boolean {
  return readLegacyMigrationMarker(configDir) !== null
}

export type SessionArchiveSnapshot = Snapshot & { migrationComplete: boolean }

/** Browsing observes validated state without importing transcripts or publishing completion. */
export function readSessionArchiveSnapshot(configDir: string): SessionArchiveSnapshot {
  const marker = readLegacyMigrationMarker(configDir)
  const snapshot = readSessionArchives(configDir)
  if (marker?.archiveStateRequired && snapshot.revision === 'missing') {
    throw new Error('Migrated session archive state is missing; cleanup was stopped')
  }
  return { ...snapshot, migrationComplete: marker !== null, revision: JSON.stringify([snapshot.revision, marker?.revision ?? null]) }
}

export function resolveSessionArchive(snapshot: SessionArchiveSnapshot, sessionId: string, legacyArchived?: boolean | null): boolean | null {
  if (Object.hasOwn(snapshot.state.sessions, sessionId)) return snapshot.state.sessions[sessionId]!.archived
  if (snapshot.migrationComplete) return false
  return legacyArchived ?? null
}

/** An identity is known only when every copy agrees; explicit choices still win. */
export function classifySessionArchives(snapshot: SessionArchiveSnapshot, rows: Iterable<{ id: string; legacyArchived?: boolean | null }>): Map<string, boolean | null> {
  const states = new Map<string, boolean | null>()
  for (const row of rows) {
    const value = resolveSessionArchive(snapshot, row.id, row.legacyArchived)
    states.set(row.id, states.has(row.id) && states.get(row.id) !== value ? null : value)
  }
  return states
}

async function scanLegacySessionArchives(configDir: string, state: ArchiveState): Promise<Map<string, boolean>> {
  const imported = new Map<string, boolean>()
  for await (const file of listLegacyArchiveTranscripts(configDir)) {
    const sessionId = basename(file, '.jsonl')
    const archived = await readLegacyArchiveTranscript(file)
    if (archived === undefined || Object.hasOwn(state.sessions, sessionId)) continue
    if (imported.has(sessionId) && imported.get(sessionId) !== archived) throw new Error('Conflicting legacy session archive states')
    imported.set(sessionId, archived)
  }
  return imported
}

/** Preview validates the same legacy evidence as migration without publishing it. */
export async function readSessionArchiveRetentionIds(configDir: string): Promise<ReadonlySet<string>> {
  const snapshot = readSessionArchiveSnapshot(configDir)
  if (snapshot.migrationComplete) return snapshot.ids

  const ids = new Set(snapshot.ids)
  for (const [id, archived] of await scanLegacySessionArchives(configDir, snapshot.state)) {
    if (archived) ids.add(id)
  }
  return ids
}

/** Import once under the same lock as retention and archive changes. The marker
 * is published last, so interrupted imports retry without overriding explicit state. */
export async function ensureSessionArchivesMigrated(configDir: string): Promise<void> {
  if (legacyMigrationComplete(configDir)) return
  await withSessionArchiveLock(configDir, async () => {
    if (legacyMigrationComplete(configDir)) return
    const { state, revision } = readSessionArchives(configDir)
    const imported = await scanLegacySessionArchives(configDir, state)
    if (revision !== 'missing' || imported.size > 0) {
      const sessions: Record<string, ArchiveRecord> = Object.assign(Object.create(null), state.sessions)
      for (const [id, archived] of imported) sessions[id] = { archived }
      writeArchiveJson(statePath(configDir), { ...state, sessions })
    }
    writeArchiveJson(legacyMigrationPath(configDir), { schemaVersion: 1, archiveStateRequired: revision !== 'missing' || imported.size > 0 })
  })
}

/** Synchronous read-modify-rename keeps the final activity check and mutation
 * in one server turn. Archives never rewrite, move, or remove transcripts. */
export function writeSessionArchive(configDir: string, sessionId: string, archived: boolean): void {
  const { state } = readSessionArchives(configDir)
  writeArchiveJson(statePath(configDir), {
    ...state,
    sessions: { ...state.sessions, [sessionId]: { ...state.sessions[sessionId], archived } },
  })
}

function writeArchiveJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    const file = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
      fsyncSync(file)
    } finally { closeSync(file) }
    renameSync(temporary, filePath)
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(filePath), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
      // The lock may have created the internal directory on this first write.
      const parent = openSync(dirname(dirname(filePath)), 'r')
      try { fsyncSync(parent) } finally { closeSync(parent) }
    }
  } finally {
    try { unlinkSync(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  cache.delete(filePath)
}
