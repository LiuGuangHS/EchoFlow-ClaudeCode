import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Session-scoped state for the agent quality gate.
 *
 * Events are appended to one log per session and reduced at read time. Hooks are
 * separate processes and run concurrently whenever a batch of tool calls goes
 * out, so a read-modify-write drops events — and losing an edit record is the
 * one failure that makes the gate pass an unreviewed change. Appends never merge.
 *
 * Order is line order: `seq` is the event's 1-based position, so two events can
 * never tie and "was the review after the edit" needs no clock.
 */
export type GateState = {
  sessionId: string
  seq: number
  lastEditSeq: number | null
  lastReviewSeq: number | null
  lastTestSeq: number | null
  lastReviewer: string | null
  editedFiles: string[]
  waiver: { seq: number; reason: string } | null
  blockCount: number
}

export type GateVerdict = {
  blocked: boolean
  waived: boolean
  missing: string[]
  reason: string
}

type GateEvent =
  | { kind: 'base'; state: GateState }
  | { kind: 'edit'; file: string }
  | { kind: 'review'; reviewer?: string }
  | { kind: 'test' }
  | { kind: 'waiver'; reason: string }
  | { kind: 'block' }

const EVENT_KINDS = new Set(['base', 'edit', 'review', 'test', 'waiver', 'block'])

export function defaultStateDir(): string {
  return process.env.AGENT_QUALITY_GATE_DIR ?? path.join(homedir(), '.claude', 'agent-quality-gate')
}

export function statePath(sessionId: string, dir = defaultStateDir()): string {
  return path.join(dir, `${sessionId}.jsonl`)
}

/** The one-record-per-file shape this gate kept before it logged events. */
export function legacyStatePath(sessionId: string, dir = defaultStateDir()): string {
  return path.join(dir, `${sessionId}.json`)
}

function emptyState(sessionId: string): GateState {
  return {
    sessionId,
    seq: 0,
    lastEditSeq: null,
    lastReviewSeq: null,
    lastTestSeq: null,
    lastReviewer: null,
    editedFiles: [],
    waiver: null,
    blockCount: 0,
  }
}

function isGateState(value: unknown): value is GateState {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<GateState>
  return (
    typeof record.sessionId === 'string' &&
    typeof record.seq === 'number' &&
    Array.isArray(record.editedFiles)
  )
}

function isGateEvent(value: unknown): value is GateEvent {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  if (typeof kind !== 'string' || !EVENT_KINDS.has(kind)) return false
  // A truncated base line must be skipped like any other torn record, not fed
  // to reduce() where it would take the whole state down.
  if (kind === 'base') return isGateState((value as { state?: unknown }).state)
  return true
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** A gate that cannot read its own history must not block the session. */
async function readEvents(sessionId: string, dir: string): Promise<GateEvent[]> {
  let raw: string
  try {
    raw = await readFile(statePath(sessionId, dir), 'utf-8')
  } catch {
    return []
  }
  const events: GateEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line)
      if (isGateEvent(value)) events.push(value)
    } catch {
      // A torn trailing line must not cost the session the rest of its history.
    }
  }
  return events
}

async function readLegacy(sessionId: string, dir: string): Promise<GateState | null> {
  try {
    const value = JSON.parse(await readFile(legacyStatePath(sessionId, dir), 'utf-8'))
    return isGateState(value) ? value : null
  } catch {
    return null
  }
}

function reduce(sessionId: string, events: GateEvent[]): GateState {
  const state = emptyState(sessionId)
  let seq = 0
  // Where the last gap closed. Refusals before that point belonged to a gap
  // that is already settled and must not be charged to the next one — reduce()
  // replays the whole log every time, so a plain running total would let three
  // refusals spread over unrelated tasks disarm the gate for good.
  let gapClosedAt = 0
  for (const event of events) {
    if (event.kind === 'base') {
      // Only the first base carries over. A second one written by a racing
      // writer must not erase the events already recorded after the first, and
      // the numbering has to resume past the record it replaces.
      if (state.seq !== 0) continue
      Object.assign(state, event.state, { sessionId })
      seq = event.state.seq
      continue
    }
    seq += 1
    if (event.kind === 'edit') {
      if (!state.editedFiles.includes(event.file)) state.editedFiles.push(event.file)
      state.lastEditSeq = seq
    } else if (event.kind === 'review') {
      state.lastReviewSeq = seq
      state.lastReviewer = event.reviewer ?? null
    } else if (event.kind === 'test') {
      state.lastTestSeq = seq
    } else if (event.kind === 'waiver') {
      state.waiver = { seq, reason: event.reason }
    } else if (event.kind === 'block') {
      if (seq > gapClosedAt) state.blockCount += 1
    }
    state.seq = seq
    if (state.lastEditSeq !== null && !evaluateGate(state).blocked) {
      gapClosedAt = seq
      state.blockCount = 0
    }
  }
  return state
}

export async function readState(sessionId: string, dir = defaultStateDir()): Promise<GateState> {
  const events = await readEvents(sessionId, dir)
  if (events.length > 0) return reduce(sessionId, events)
  return (await readLegacy(sessionId, dir)) ?? emptyState(sessionId)
}

async function append(sessionId: string, dir: string, event: GateEvent): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = statePath(sessionId, dir)
  const lines: string[] = []
  if (!(await exists(target))) {
    const legacy = await readLegacy(sessionId, dir)
    if (legacy) lines.push(JSON.stringify({ kind: 'base', state: legacy }))
  }
  lines.push(JSON.stringify(event))
  // shortcut: assumes one appendFile call lands as one atomic O_APPEND write,
  // which holds for lines this small; switch to a lock if a log line ever
  // approaches PIPE_BUF or the state dir lands on a filesystem without atomic appends.
  await appendFile(target, `${lines.join('\n')}\n`, 'utf-8')
}

async function record(sessionId: string, dir: string, event: GateEvent): Promise<GateState> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return emptyState(String(sessionId))
  await append(sessionId, dir, event)
  return readState(sessionId, dir)
}

export async function recordEdit(
  sessionId: string,
  file: string,
  dir = defaultStateDir(),
): Promise<GateState> {
  return record(sessionId, dir, { kind: 'edit', file })
}

export async function recordReview(
  sessionId: string,
  dir = defaultStateDir(),
  reviewer?: string,
): Promise<GateState> {
  return record(sessionId, dir, { kind: 'review', reviewer })
}

export async function recordTest(sessionId: string, dir = defaultStateDir()): Promise<GateState> {
  return record(sessionId, dir, { kind: 'test' })
}

export async function recordWaiver(
  sessionId: string,
  reason: string,
  dir = defaultStateDir(),
): Promise<GateState> {
  return record(sessionId, dir, { kind: 'waiver', reason })
}

export async function recordBlock(sessionId: string, dir = defaultStateDir()): Promise<GateState> {
  return record(sessionId, dir, { kind: 'block' })
}

export function evaluateGate(state: GateState): GateVerdict {
  const missing: string[] = []
  if (state.lastEditSeq === null) {
    return { blocked: false, waived: false, missing, reason: 'no code changed' }
  }
  if (state.lastReviewSeq === null || state.lastReviewSeq < state.lastEditSeq) missing.push('review')
  if (state.lastTestSeq === null || state.lastTestSeq < state.lastEditSeq) missing.push('test')

  if (missing.length > 0) {
    // A waiver covers the edits already made when it was recorded, never later
    // ones: the reason given for standing down does not travel forward.
    if (state.waiver && state.waiver.seq >= state.lastEditSeq) {
      return { blocked: false, waived: true, missing, reason: `waived: ${state.waiver.reason}` }
    }
    return { blocked: true, waived: false, missing, reason: `missing ${missing.join(' and ')}` }
  }
  return {
    blocked: false,
    waived: false,
    missing,
    reason: 'review and test both ran after the last edit',
  }
}
