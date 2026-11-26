import { createReadStream } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'

export type ArchiveRecord = { archived: boolean; [key: string]: unknown }
export type ArchiveState = { schemaVersion: 1; sessions: Record<string, ArchiveRecord>; [key: string]: unknown }
export const sessionArchiveStateName = 'session-archives.json'
export const sessionArchiveMarkerName = 'session-archives.legacy-jsonl-migration.json'

export function migrateArchiveState(value: unknown): ArchiveState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session archive state; existing data was preserved')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== undefined && record.schemaVersion !== 0 && record.schemaVersion !== 1) {
    throw new Error('Unsupported session archive state version; update the app before modifying archives')
  }
  if (!record.sessions || typeof record.sessions !== 'object' || Array.isArray(record.sessions)) throw new Error('Invalid session archive records')
  for (const entry of Object.values(record.sessions)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof (entry as ArchiveRecord).archived !== 'boolean') {
      throw new Error('Invalid session archive record; existing data was preserved')
    }
  }
  // Unversioned metadata has the same records. Forward reads supply v1 and the
  // next intentional mutation persists it without dropping extension fields.
  return { ...record, schemaVersion: 1, sessions: record.sessions as Record<string, ArchiveRecord> }
}

type ArchiveMarker = { schemaVersion: 1; archiveStateRequired: boolean; [key: string]: unknown }

export function parseSessionArchiveMarker(value: unknown): ArchiveMarker {
  const marker = value as ArchiveMarker
  if (!marker || marker.schemaVersion !== 1 || typeof marker.archiveStateRequired !== 'boolean') {
    throw new Error('Invalid or unsupported legacy session archive migration marker')
  }
  return marker
}

export async function* listLegacyArchiveTranscripts(configDir: string, includeSession?: (id: string) => boolean): AsyncGenerator<string> {
  const projectsDir = join(configDir, 'projects')
  let projects
  try {
    if (!(await lstat(projectsDir)).isDirectory()) throw new Error('Cannot migrate archives from a linked or non-directory projects path')
    projects = await readdir(projectsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  for (const project of projects) {
    if (project.isSymbolicLink()) throw new Error('Cannot migrate archives from a linked project')
    if (!project.isDirectory()) continue
    const projectDir = join(projectsDir, project.name)
    for (const file of await readdir(projectDir, { withFileTypes: true })) {
      if (!file.name.endsWith('.jsonl')) continue
      const transcript = join(projectDir, file.name)
      if (includeSession && !includeSession(basename(transcript, '.jsonl'))) continue
      if (!file.isFile()) throw new Error('Cannot migrate archives from a non-file transcript')
      yield transcript
    }
  }
}

export async function readLegacyArchiveTranscript(file: string): Promise<boolean | undefined> {
  const before = await stat(file)
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let archived: boolean | undefined
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      const entry = JSON.parse(line)
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid legacy transcript record')
      if (entry.type !== 'session-archive' && entry.type !== 'session-meta') continue
      if (entry.type === 'session-meta' && !Object.hasOwn(entry, 'archived')) continue
      if (typeof entry.archived !== 'boolean') throw new Error('Invalid legacy session archive state')
      archived = entry.archived
    }
  } finally {
    lines.close()
    stream.destroy()
  }
  const after = await stat(file)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error('Transcript changed during archive migration; retry')
  }
  return archived
}
