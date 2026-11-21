import type { LocalIndexDatabase, LocalIndexReadOperation } from './database.js'
import { createActivityIndex, type ActivityIndex } from './activityIndex.js'
import type {
  ClaudeCodeStats,
  StatsDateRange,
} from '../../../utils/stats.js'
import type {
  LocalIndexMode,
  LocalIndexStatus,
  PersistedRepositorySession,
  PersistedWorktreeSession,
  TranscriptEntryLocator,
  TranscriptProjection,
} from './types.js'

export type IndexedSessionRow = {
  transcriptPath: string
  legacyArchived?: boolean | null
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  workDir: string | null
  agentProfile?: 'standard' | 'lean'
  permissionMode?: string
  runtimeProviderId?: string | null
  runtimeModelId?: string
  effortLevel?: string
  openAIFastMode?: boolean
  repository?: PersistedRepositorySession
  worktreeSession?: PersistedWorktreeSession | null
}

export type SessionIndexPage = {
  sessions: IndexedSessionRow[]
  total: number
}

export type SessionFileMatch = {
  filePath: string
  projectDir: string
}

export type SessionSearchCandidateFilters = {
  project?: string
  modifiedAfterMs?: number
  modifiedBeforeMs?: number
}

export type IndexedSessionSearchCandidate = Pick<
  IndexedSessionRow,
  'transcriptPath' | 'id' | 'title' | 'modifiedAt' | 'projectPath' | 'workDir'
>

export type SessionEntryLocatorPage = {
  source: SessionSourceRecord
  entries: TranscriptEntryLocator[]
}

export interface SessionIndexReader {
  getSessionReadRevision?(): string | null
  getSessionSuggestionMetadata?(sessionIds: string[]): IndexedSessionRow[] | null
  searchSessionMetadata?(query: string, options?: { limit?: number; offset?: number }): SessionIndexPage | null
  listSessions(options?: {
    project?: string
    limit?: number
    offset?: number
    archive?: { ids: readonly string[]; archived: boolean; ordinaryIds?: readonly string[]; migrationComplete?: boolean }
  }): SessionIndexPage
  findSessionFiles(sessionId: string): SessionFileMatch[]
  getSession?(sessionId: string): IndexedSessionRow | null
  findSearchCandidates?(
    filters: SessionSearchCandidateFilters,
  ): IndexedSessionSearchCandidate[] | null
}

export interface LocalIndexGateway extends SessionIndexReader {
  start(): Promise<void>
  stop(): Promise<void>
  getMode(): LocalIndexMode
  getPublicStatus(): LocalIndexStatus
  isSessionScopeReady(): boolean
  isActivityScopeReady?(): boolean
  getActivityStats?(range: StatsDateRange, now?: Date): ClaudeCodeStats | null
  rebuild(): Promise<LocalIndexStatus>
  updateSessionTitle?(sessionId: string, title: string): boolean
  getSessionEntryLocators?(
    transcriptPath: string,
    entryTypes?: string[],
  ): SessionEntryLocatorPage | null
  /**
   * When every outstanding failure belongs to a single transcript, the paths
   * of those transcripts (empty when there are none). Null when the snapshot
   * as a whole cannot be trusted, or there are too many to overlay.
   */
  getSourceScopedFailurePaths?(): readonly string[] | null
}

export type SessionSourceRecord = {
  path: string
  size: number
  mtimeMs: number
  fileIdentity: string | null
  fingerprint: string
  indexedBytes: number
  parserVersion: number
  state: 'ready' | 'pending' | 'degraded'
  lastErrorCode: string | null
  updatedAtMs: number
}

export type PersistedBackfillState = {
  scope: string
  state: string
  watermark: string | null
  discovered: number
  indexed: number
  degraded: number
  lastErrorCode: string | null
  updatedAtMs: number
}

export interface SessionIndex extends SessionIndexReader, ActivityIndex {
  getSession(sessionId: string): IndexedSessionRow | null
  getSource(path: string): SessionSourceRecord | null
  listSources(): SessionSourceRecord[]
  countSources(): number
  getProjectionSeed(path: string): TranscriptProjection | null
  getBackfillState(scope: string): PersistedBackfillState | null
  updateSessionTitle?(sessionId: string, title: string): boolean
  getSessionEntryLocators(
    transcriptPath: string,
    entryTypes?: string[],
  ): SessionEntryLocatorPage | null
}

type SessionRow = {
  transcript_path: string
  session_id: string
  project_path: string
  title: string
  created_at: string
  modified_at: string
  modified_at_ms: number
  message_count: number
  work_dir: string | null
  agent_profile?: 'standard' | 'lean'
  permission_mode: string | null
  runtime_provider_id: string | null
  runtime_provider_present: number
  runtime_model_id: string | null
  effort_level: string | null
  openai_fast_mode: number | null
  repository_json: string | null
  worktree_session_json: string | null
  legacy_archived: number | null
}

type SourceRow = {
  path: string
  size_bytes: number
  mtime_ms: number
  file_identity: string | null
  prefix_hash: string
  indexed_bytes: number
  parser_version: number
  state: SessionSourceRecord['state']
  last_error_code: string | null
  updated_at_ms: number
}

type BackfillRow = {
  scope: string
  state: string
  watermark: string | null
  discovered: number
  indexed: number
  degraded: number
  last_error_code: string | null
  updated_at_ms: number
}

type SessionEntryRow = {
  ordinal: number
  jsonl_line: number
  byte_start: number
  byte_length: number
  entry_type: string
  message_id: string | null
  role: string | null
  timestamp: string | null
  parent_tool_use_id: string | null
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value!))
}

/** A picker query must not scan an unbounded session table synchronously.
 * Past this many rows the page is a lower bound: exact matches already seen
 * stay ranked first, and the caller reports the total as incomplete. */
const UNICODE_METADATA_SCAN_ROWS = 4096

function searchUnicodeSessionMetadata(operation: LocalIndexReadOperation, needle: string, limit: number, offset: number): SessionIndexPage {
  const rank = (row: SessionRow): number => {
    const names = [row.title.toLowerCase(), row.session_id.toLowerCase()]
    if (![...names, row.work_dir?.toLowerCase() ?? '', row.project_path.toLowerCase()].some(value => value.includes(needle))) return -1
    return names.includes(needle) ? 3 : names.some(value => value.startsWith(needle)) ? 2 : names.some(value => value.includes(needle)) ? 1 : 0
  }
  const scan = (visit: (row: SessionRow) => boolean) => {
    let last: SessionRow | undefined
    let scanned = 0
    while (scanned < UNICODE_METADATA_SCAN_ROWS) {
      const rows = operation.all<SessionRow>(`
        SELECT * FROM sessions
        ${last ? 'WHERE modified_at_ms < ? OR (modified_at_ms = ? AND session_id > ?) OR (modified_at_ms = ? AND session_id = ? AND transcript_path > ?)' : ''}
        ORDER BY modified_at_ms DESC, session_id ASC, transcript_path ASC LIMIT 256
      `, ...(last ? [last.modified_at_ms, last.modified_at_ms, last.session_id, last.modified_at_ms, last.session_id, last.transcript_path] : []))
      for (const row of rows) {
        if (!visit(row)) return
        if (++scanned >= UNICODE_METADATA_SCAN_ROWS) return
      }
      if (rows.length < 256) return
      last = rows[rows.length - 1]
    }
  }
  // One pass. The scan cap bounds how many matches can be retained, so the
  // page can be sliced after ranking instead of scanning the table twice.
  const buckets: SessionRow[][] = [[], [], [], []]
  scan(row => {
    const value = rank(row)
    if (value >= 0) buckets[value]!.push(row)
    return true
  })
  const ordered = [3, 2, 1, 0].flatMap(value => buckets[value]!)
  return { sessions: ordered.slice(offset, offset + limit).map(sessionFromRow), total: ordered.length }
}

const LEGACY_ARCHIVE_SQL = `(CASE WHEN NOT EXISTS (
  SELECT 1 FROM sessions AS copy WHERE copy.session_id = sessions.session_id
    AND copy.is_team_worker = 0 AND copy.legacy_archived IS NOT sessions.legacy_archived
) THEN legacy_archived ELSE NULL END)`

function sessionFromRow(row: SessionRow): IndexedSessionRow {
  const repository = parseStoredJson<PersistedRepositorySession>(row.repository_json)
  const worktreeSession = row.worktree_session_json === 'null'
    ? null
    : parseStoredJson<PersistedWorktreeSession>(row.worktree_session_json)
  return {
    transcriptPath: row.transcript_path,
    legacyArchived: row.legacy_archived == null ? null : row.legacy_archived === 1,
    id: row.session_id,
    title: row.title,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    messageCount: row.message_count,
    projectPath: row.project_path,
    workDir: row.work_dir,
    agentProfile: row.agent_profile ?? 'standard',
    ...(row.permission_mode ? { permissionMode: row.permission_mode } : {}),
    ...(row.runtime_provider_present === 1
      ? { runtimeProviderId: row.runtime_provider_id }
      : {}),
    ...(row.runtime_model_id ? { runtimeModelId: row.runtime_model_id } : {}),
    ...(row.effort_level ? { effortLevel: row.effort_level } : {}),
    ...(row.openai_fast_mode != null ? { openAIFastMode: row.openai_fast_mode === 1 } : {}),
    ...(repository ? { repository } : {}),
    ...(row.worktree_session_json !== null ? { worktreeSession } : {}),
  }
}

function sourceFromRow(row: SourceRow): SessionSourceRecord {
  return {
    path: row.path,
    size: row.size_bytes,
    mtimeMs: row.mtime_ms,
    fileIdentity: row.file_identity,
    fingerprint: row.prefix_hash,
    indexedBytes: row.indexed_bytes,
    parserVersion: row.parser_version,
    state: row.state,
    lastErrorCode: row.last_error_code,
    updatedAtMs: row.updated_at_ms,
  }
}

function parseStoredJson<T>(value: string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function backfillFromRow(row: BackfillRow): PersistedBackfillState {
  return {
    scope: row.scope,
    state: row.state,
    watermark: row.watermark,
    discovered: row.discovered,
    indexed: row.indexed,
    degraded: row.degraded,
    lastErrorCode: row.last_error_code,
    updatedAtMs: row.updated_at_ms,
  }
}

function locatorFromRow(row: SessionEntryRow): TranscriptEntryLocator {
  return {
    ordinal: row.ordinal,
    jsonlLine: row.jsonl_line,
    byteStart: row.byte_start,
    byteLength: row.byte_length,
    entryType: row.entry_type,
    messageId: row.message_id,
    role: row.role,
    timestamp: row.timestamp,
    parentToolUseId: row.parent_tool_use_id,
  }
}

export function createSessionIndex(database: LocalIndexDatabase): SessionIndex {
  const activityIndex = createActivityIndex(database)
  return {
    ...activityIndex,
    getSessionReadRevision() {
      // SQLite tracks this connection and other connections separately.
      return database.read(operation => operation.get<{ revision: string }>(
        "SELECT total_changes() || ':' || data_version AS revision FROM pragma_data_version",
      )?.revision ?? null)
    },
    listSessions(options): SessionIndexPage {
      const limit = boundedInteger(options?.limit, 50)
      const offset = boundedInteger(options?.offset, 0)
      const conditions = ['is_team_worker = 0']
      const bindings: string[] = []
      if (options?.project !== undefined) {
        conditions.push('project_path = ?')
        bindings.push(options.project)
      }
      if (options?.archive) {
        // Bound JSON arrays avoid SQLite's variable limit. Older direct callers
        // supply an exhaustive archive set; browsing supplies completion explicitly.
        conditions.push(`(CASE
          WHEN session_id IN (SELECT value FROM json_each(?)) THEN 1
          WHEN session_id IN (SELECT value FROM json_each(?)) THEN 0
          WHEN ${options.archive.migrationComplete !== false ? '1' : '0'} THEN 0
          ELSE ${LEGACY_ARCHIVE_SQL} END) = ${options.archive.archived ? 1 : 0}`)
        bindings.push(JSON.stringify(options.archive.ids), JSON.stringify(options.archive.ordinaryIds ?? []))
      }
      const where = conditions.join(' AND ')

      return database.read(operation => {
        const total = operation.get<{ total: number }>(
          `SELECT COUNT(*) AS total FROM sessions WHERE ${where}`, ...bindings,
        )?.total ?? 0
        const rows = operation.all<SessionRow>(`
          SELECT transcript_path, session_id, project_path, title, created_at,
            modified_at, message_count, work_dir, permission_mode, agent_profile,
            runtime_provider_id, runtime_provider_present,
            runtime_model_id, effort_level, openai_fast_mode,
            repository_json, worktree_session_json, legacy_archived
          FROM sessions
          WHERE ${where}
          ORDER BY modified_at_ms DESC, session_id ASC, transcript_path ASC
          LIMIT ? OFFSET ?
        `, ...bindings, limit, offset)

        return { sessions: rows.map(sessionFromRow), total }
      })
    },

    getSessionSuggestionMetadata(sessionIds): IndexedSessionRow[] {
      const ids = [...new Set(sessionIds)].slice(0, 100)
      if (!ids.length) return []
      return database.read(operation => operation.all<SessionRow>(`
        SELECT transcript_path, session_id, project_path, title, created_at,
          modified_at, message_count, work_dir, permission_mode, agent_profile,
          runtime_provider_id, runtime_provider_present, runtime_model_id,
          effort_level, openai_fast_mode, repository_json, worktree_session_json, legacy_archived
        FROM sessions WHERE session_id IN (${ids.map(() => '?').join(',')})
        ORDER BY modified_at_ms DESC, session_id ASC, transcript_path ASC
        LIMIT 100
      `, ...ids).map(sessionFromRow))
    },

    searchSessionMetadata(query, options): SessionIndexPage {
      const needle = query.trim().toLowerCase()
      const limit = Math.min(100, Math.max(1, boundedInteger(options?.limit, 30)))
      const offset = boundedInteger(options?.offset, 0)
      return database.read(operation => {
        // Bun SQLite's built-in lower() only folds ASCII. Keep common English
        // and uncased scripts on SQL, and scan metadata in bounded batches when
        // matching non-ASCII letters needs the same Unicode folding as JS.
        if (Array.from(needle).some(char => char.codePointAt(0)! > 127 && char.toLowerCase() !== char.toUpperCase())) {
          return searchUnicodeSessionMetadata(operation, needle, limit, offset)
        }
        // These Unicode capitals lowercase into ASCII (or an ASCII prefix),
        // so even an ASCII query must consider them on the fast path.
        const lower = (column: string) => `replace(replace(lower(${column}), 'K', 'k'), 'İ', 'i̇')`
        const title = lower('title')
        const sessionId = lower('session_id')
        const where = `instr(${title}, ?) > 0 OR instr(${sessionId}, ?) > 0 OR instr(${lower("coalesce(work_dir, '')")}, ?) > 0 OR instr(${lower('project_path')}, ?) > 0`
        const total = operation.get<{ total: number }>(`SELECT COUNT(*) AS total FROM sessions WHERE ${where}`, needle, needle, needle, needle)?.total ?? 0
        const rows = operation.all<SessionRow>(`
          SELECT transcript_path, session_id, project_path, title, created_at,
            modified_at, message_count, work_dir, permission_mode, agent_profile,
            runtime_provider_id, runtime_provider_present, runtime_model_id,
            effort_level, openai_fast_mode, repository_json, worktree_session_json, legacy_archived
          FROM sessions WHERE ${where}
          ORDER BY CASE
            WHEN ? = '' THEN 0
            WHEN ${title} = ? OR ${sessionId} = ? THEN 3
            WHEN instr(${title}, ?) = 1 OR instr(${sessionId}, ?) = 1 THEN 2
            WHEN instr(${title}, ?) > 0 OR instr(${sessionId}, ?) > 0 THEN 1
            ELSE 0 END DESC,
            modified_at_ms DESC, session_id ASC, transcript_path ASC
          LIMIT ? OFFSET ?
        `, needle, needle, needle, needle, needle, needle, needle, needle, needle, needle, needle, limit, offset)
        return { sessions: rows.map(sessionFromRow), total }
      })
    },

    findSessionFiles(sessionId): SessionFileMatch[] {
      return database.read(operation => operation.all<{
        transcript_path: string
        project_path: string
      }>(`
          SELECT sessions.transcript_path, sessions.project_path
          FROM sessions
          JOIN source_files ON source_files.path = sessions.transcript_path
          WHERE sessions.session_id = ?
          ORDER BY source_files.mtime_ms DESC, sessions.transcript_path ASC
        `, sessionId).map(row => ({
        filePath: row.transcript_path,
        projectDir: row.project_path,
      })))
    },

    getSession(sessionId): IndexedSessionRow | null {
      return database.read(operation => {
        const row = operation.get<SessionRow>(`
          SELECT transcript_path, session_id, project_path, title, created_at,
            modified_at, message_count, work_dir, permission_mode, agent_profile,
            runtime_provider_id, runtime_provider_present,
            runtime_model_id, effort_level, openai_fast_mode,
            repository_json, worktree_session_json, ${LEGACY_ARCHIVE_SQL} AS legacy_archived
          FROM sessions
          WHERE session_id = ?
          ORDER BY modified_at_ms DESC, transcript_path ASC
          LIMIT 1
        `, sessionId)
        return row ? sessionFromRow(row) : null
      })
    },

    updateSessionTitle(sessionId, title): boolean {
      return database.write(operation => operation.run(
        'UPDATE sessions SET title = ? WHERE session_id = ?',
        title,
        sessionId,
      ).changes > 0)
    },

    findSearchCandidates(filters): IndexedSessionSearchCandidate[] {
      const clauses: string[] = []
      const values: Array<string | number> = []
      if (filters.project !== undefined) {
        clauses.push('project_path = ?')
        values.push(filters.project)
      }
      if (filters.modifiedAfterMs !== undefined) {
        clauses.push('modified_at_ms >= ?')
        values.push(filters.modifiedAfterMs)
      }
      if (filters.modifiedBeforeMs !== undefined) {
        clauses.push('modified_at_ms <= ?')
        values.push(filters.modifiedBeforeMs)
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
      return database.read(operation => operation.all<Pick<
        SessionRow,
        | 'transcript_path'
        | 'session_id'
        | 'project_path'
        | 'title'
        | 'modified_at'
        | 'work_dir'
      >>(`
          SELECT transcript_path, session_id, project_path, title,
            modified_at, work_dir
          FROM sessions
          ${where}
          ORDER BY modified_at_ms DESC, session_id ASC, transcript_path ASC
        `, ...values).map(row => ({
        transcriptPath: row.transcript_path,
        id: row.session_id,
        title: row.title,
        modifiedAt: row.modified_at,
        projectPath: row.project_path,
        workDir: row.work_dir,
      })))
    },

    getSource(path): SessionSourceRecord | null {
      return database.read(operation => {
        const row = operation.get<SourceRow>(`
          SELECT path, size_bytes, mtime_ms, file_identity, prefix_hash,
            indexed_bytes, parser_version, state, last_error_code, updated_at_ms
          FROM source_files
          WHERE path = ?
        `, path)
        return row ? sourceFromRow(row) : null
      })
    },

    listSources(): SessionSourceRecord[] {
      return database.read(operation => operation.all<SourceRow>(`
          SELECT path, size_bytes, mtime_ms, file_identity, prefix_hash,
            indexed_bytes, parser_version, state, last_error_code, updated_at_ms
          FROM source_files
          ORDER BY path ASC
        `).map(sourceFromRow))
    },

    countSources(): number {
      return database.read(operation => operation.get<{ count: number }>(`
          SELECT COUNT(*) AS count
          FROM source_files
        `)?.count ?? 0)
    },

    getProjectionSeed(path): TranscriptProjection | null {
      return database.read(operation => {
        const row = operation.get<SessionRow & {
          indexed_bytes: number
          size_bytes: number
        }>(`
          SELECT sessions.transcript_path, sessions.session_id,
            sessions.project_path, sessions.title, sessions.created_at,
            sessions.modified_at, sessions.modified_at_ms,
            sessions.message_count, sessions.work_dir,
            sessions.permission_mode, sessions.agent_profile, sessions.runtime_provider_id,
            sessions.runtime_provider_present,
            sessions.runtime_model_id, sessions.effort_level, sessions.openai_fast_mode,
            sessions.repository_json, sessions.worktree_session_json, sessions.legacy_archived,
            source_files.indexed_bytes, source_files.size_bytes
          FROM sessions
          JOIN source_files ON source_files.path = sessions.transcript_path
          WHERE sessions.transcript_path = ?
        `, path)
        if (!row) return null
        const repository = parseStoredJson<NonNullable<TranscriptProjection['summary']['repository']>>(
          row.repository_json,
        )
        const worktreeSession = row.worktree_session_json === 'null'
          ? null
          : parseStoredJson<NonNullable<TranscriptProjection['summary']['worktreeSession']>>(
            row.worktree_session_json,
          )
        return {
          summary: {
            legacyArchived: row.legacy_archived == null ? null : row.legacy_archived === 1,
            title: row.title,
            createdAt: row.created_at,
            modifiedAt: row.modified_at,
            messageCount: row.message_count,
            workDir: row.work_dir,
            agentProfile: row.agent_profile ?? 'standard',
            ...(row.permission_mode ? { permissionMode: row.permission_mode } : {}),
            ...(row.runtime_provider_present === 1
              ? { runtimeProviderId: row.runtime_provider_id }
              : {}),
            ...(row.runtime_model_id ? { runtimeModelId: row.runtime_model_id } : {}),
            ...(row.effort_level ? { effortLevel: row.effort_level } : {}),
            ...(row.openai_fast_mode != null ? { openAIFastMode: row.openai_fast_mode === 1 } : {}),
            ...(repository ? { repository } : {}),
            ...(row.worktree_session_json !== null
              ? { worktreeSession }
              : {}),
          },
          indexedBytes: row.indexed_bytes,
          pendingTailBytes: row.size_bytes - row.indexed_bytes,
          // v1 intentionally does not persist reducer internals. A process restart
          // therefore rebuilds this source before accepting a later append.
          malformedLineCount: 0,
        }
      })
    },

    getBackfillState(scope): PersistedBackfillState | null {
      return database.read(operation => {
        const row = operation.get<BackfillRow>(`
          SELECT scope, state, watermark, discovered, indexed, degraded,
            last_error_code, updated_at_ms
          FROM backfill_state
          WHERE scope = ?
        `, scope)
        return row ? backfillFromRow(row) : null
      })
    },

    getSessionEntryLocators(transcriptPath, entryTypes): SessionEntryLocatorPage | null {
      const normalizedTypes = entryTypes === undefined
        ? undefined
        : [...new Set(entryTypes.filter(type => type.length > 0))].slice(0, 32)
      return database.read(operation => {
        const source = operation.get<SourceRow>(`
          SELECT path, size_bytes, mtime_ms, file_identity, prefix_hash,
            indexed_bytes, parser_version, state, last_error_code, updated_at_ms
          FROM source_files
          WHERE path = ?
        `, transcriptPath)
        if (!source) return null

        let rows: SessionEntryRow[]
        if (normalizedTypes === undefined) {
          rows = operation.all<SessionEntryRow>(`
            SELECT ordinal, jsonl_line, byte_start, byte_length, entry_type,
              message_id, role, timestamp, parent_tool_use_id
            FROM session_entries
            WHERE transcript_path = ?
            ORDER BY ordinal ASC
          `, transcriptPath)
        } else if (normalizedTypes.length === 0) {
          rows = []
        } else {
          const placeholders = normalizedTypes.map(() => '?').join(', ')
          rows = operation.all<SessionEntryRow>(`
            SELECT ordinal, jsonl_line, byte_start, byte_length, entry_type,
              message_id, role, timestamp, parent_tool_use_id
            FROM session_entries
            WHERE transcript_path = ? AND entry_type IN (${placeholders})
            ORDER BY ordinal ASC
          `, transcriptPath, ...normalizedTypes)
        }

        return {
          source: sourceFromRow(source),
          entries: rows.map(locatorFromRow),
        }
      })
    },
  }
}
