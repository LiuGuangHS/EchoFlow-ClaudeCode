import type { UIMessage } from '../types/chat'

export const CHAT_HISTORY_MAX_ROWS = 500
export const CHAT_HISTORY_MAX_BYTES = 2 * 1024 * 1024
export const CHAT_STREAM_MAX_CHARS = 64 * 1024
const MESSAGE_MAX_CHARS = 32 * 1024
const cache = new WeakMap<UIMessage, { message: UIMessage; bytes: number; clipped: boolean }>()

export function copyChatPreview(value: string, maxChars: number, tail = false): string {
  if (value.length <= maxChars) return value
  // V8 substrings may retain the entire source string's backing storage.
  // Round-trip only the bounded slice so the preview owns its small buffer.
  const slice = tail ? value.slice(-maxChars) : value.slice(0, maxChars)
  return new TextDecoder().decode(new TextEncoder().encode(slice))
}

function previewMessage(message: UIMessage, maxChars = MESSAGE_MAX_CHARS, maxNodes = 2048) {
  const cached = maxChars === MESSAGE_MAX_CHARS && maxNodes === 2048 ? cache.get(message) : undefined
  if (cached) return cached
  let remaining = maxChars
  let nodes = 0
  let clipped = false
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 16) {
      clipped = true
      return null
    }
    if (typeof value === 'string') {
      const allowed = Math.max(0, remaining)
      remaining -= Math.min(value.length, allowed)
      if (value.length <= allowed) return value
      clipped = true
      // A partial base64 URI cannot render. Keep its attachment metadata only.
      if (value.startsWith('data:')) return undefined
      return copyChatPreview(value, allowed)
    }
    if (!value || typeof value !== 'object') return value
    const output: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {}
    let changed = false
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      if (nodes > maxNodes || remaining <= 0) { clipped = true; changed = true; break }
      const before = (value as Record<string, unknown>)[key]
      const after = visit(before, depth + 1)
      const target = output as Record<string, unknown>
      target[key] = after
      changed ||= before !== after
    }
    return changed ? output : value
  }
  // Identity and timestamps stay intact. Only display payloads are shortened;
  // permission requests and runtime recovery state live outside these rows.
  const result = { ...message } as UIMessage & Record<string, unknown>
  for (const key of ['content', 'input', 'modelContent', 'partialInput', 'summary', 'objective', 'message', 'tasks', 'attachments', 'task', 'files']) {
    if (key in result) result[key] = visit(result[key], 0)
  }
  const entry = { message: clipped ? result : message, bytes: 256 + (maxChars - remaining) * 2 + nodes * 32, clipped }
  if (maxChars === MESSAGE_MAX_CHARS && maxNodes === 2048) {
    cache.set(message, entry)
    cache.set(entry.message, entry)
  }
  return entry
}

export function boundChatHistory(messages: UIMessage[], budget = CHAT_HISTORY_MAX_BYTES) {
  const retained: UIMessage[] = []
  let bytes = 0
  let clipped = false
  let start = messages.length
  while (start > 0 && retained.length < CHAT_HISTORY_MAX_ROWS) {
    const entry = previewMessage(messages[start - 1]!)
    if (bytes + entry.bytes > budget) break
    retained.push(entry.message)
    bytes += entry.bytes
    clipped ||= entry.clipped
    start--
  }
  retained.reverse()
  return { messages: start === 0 && retained.every((message, index) => message === messages[index]) ? messages : retained, bytes, dropped: start, clipped: clipped || start > 0 }
}

// A cursor describes a whole page. Preserve every row identity when tightening
// a page's display budget, otherwise trimmed rows become unreachable by scrolling.
export function previewHistoryPage(messages: UIMessage[], budget: number): UIMessage[] {
  if (!messages.length) return messages
  const entries = messages.map(message => previewMessage(message))
  const result = entries.map(entry => entry.message)
  if (entries.reduce((sum, entry) => sum + entry.bytes, 0) > budget) {
    // Small messages keep their full content. Share the remaining allowance
    // among larger payloads, rather than truncating every row to an equal size.
    const order = entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.bytes - b.entry.bytes)
    let remaining = budget
    for (let index = 0; index < order.length; index++) {
      const item = order[index]!
      const allowance = Math.max(0, Math.floor(remaining / (order.length - index)))
      if (item.entry.bytes <= allowance) { remaining -= item.entry.bytes; continue }
      const payload = Math.max(0, allowance - 288)
      const entry = previewMessage(item.entry.message, Math.min(MESSAGE_MAX_CHARS, Math.floor(payload / 4)), Math.max(1, Math.min(2048, Math.floor(payload / 64))))
      result[item.index] = entry.message
      remaining -= entry.bytes
    }
  }
  return result.every((message, index) => message === messages[index]) ? messages : result
}

export const CHAT_TERMINAL_ACTIVITY_MAX_PER_SESSION = 500
export const CHAT_TERMINAL_ACTIVITY_MAX_TOTAL = 4000
const activityCache = new WeakMap<object, { budget: number; terminalLimit: number; result: object }>()

// UI projections retain every active lifecycle, plus recent terminal evidence.
// Runtime/provider input and pending permission requests live elsewhere.
export function boundActivityText<T extends object>(
  records: Record<string, T> | undefined,
  budget: number,
  terminalLimit = CHAT_TERMINAL_ACTIVITY_MAX_PER_SESSION,
): Record<string, T> | undefined {
  if (!records) return records
  const cached = activityCache.get(records)
  if (cached?.budget === budget && cached.terminalLimit === terminalLimit) return cached.result as Record<string, T>
  const fields = ['prompt', 'result', 'summary', 'description'] as const
  const entries = Object.entries(records)
  const terminal = entries.filter(([, entry]) => {
    const status = (entry as Record<string, unknown>).status
    return status === 'completed' || status === 'failed' || status === 'stopped'
  })
  let result = records
  if (terminal.length > terminalLimit) {
    function time(entry: T): number {
      const value = entry as Record<string, unknown>
      const timestamp = value.updatedAt ?? value.timestamp ?? value.startedAt
      const parsed = typeof timestamp === 'number' ? timestamp : typeof timestamp === 'string' ? Date.parse(timestamp) : 0
      return Number.isFinite(parsed) ? parsed : 0
    }
    // Stable sort keeps insertion order for bookends without timestamps.
    terminal.sort((a, b) => time(a[1]) - time(b[1]))
    const dropped = new Set(terminal.slice(0, terminal.length - terminalLimit).map(([id]) => id))
    result = Object.fromEntries(entries.filter(([id]) => !dropped.has(id)))
  }
  const retained = result === records ? entries : Object.entries(result)
  const maxChars = Math.min(16 * 1024, Math.floor(budget / (2 * Math.max(1, retained.length) * fields.length)))
  for (const [id, entry] of retained) {
    let next = entry
    for (const field of fields) {
      const value = (entry as Record<string, unknown>)[field]
      if (typeof value !== 'string' || value.length <= maxChars) continue
      if (next === entry) next = { ...entry }
      const target = next as Record<string, unknown>
      target[field] = copyChatPreview(value, maxChars)
    }
    if (next === entry) continue
    if (result === records) result = { ...records }
    result[id] = next
  }
  const memo = { budget, terminalLimit, result }
  activityCache.set(records, memo)
  activityCache.set(result, memo)
  return result
}
