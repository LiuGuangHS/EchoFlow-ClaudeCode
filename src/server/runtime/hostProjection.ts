import type { RuntimeEventBody, SessionConfigState } from './contract.js'

export type HostRecord = {
  type: string
  seq: number
  time?: number
  data?: unknown
  [key: string]: unknown
}

export type ProjectionContext = {
  modelCatalog?: unknown
}

type Fields = Record<string, unknown>
type TurnReason = Extract<RuntimeEventBody, { kind: 'turn.completed' }>['reason']

function fieldsOf(value: unknown): Fields | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : null
}

/** Joins the text blocks of a message content; null when there is no text. */
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts = content.flatMap(block => {
    const fields = fieldsOf(block)
    return fields?.type === 'text' && typeof fields.text === 'string' ? [fields.text] : []
  })
  return parts.length > 0 ? parts.join('') : null
}

/** The Host serializes tool arguments as a JSON string; keep the raw string when it does not parse. */
function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function turnReason(value: unknown): TurnReason {
  const kind = fieldsOf(value)?.kind ?? value
  switch (kind) {
    case 'completed':
    case 'end_turn':
      return 'end_turn'
    case 'cancelled':
    case 'max_tokens':
    case 'refusal':
      return kind
    default:
      return 'error'
  }
}

/**
 * Record shapes follow what a real dsh Host (0.2.1-rc.5) emits: tool calls are
 * `tool/call` with a JSON-string `arguments`, results are `tool/result` with the
 * message nested under `data.message`, and a finished turn ends with
 * `turn/end` whose reason is `{ kind: 'completed' }`.
 */
export function projectHostRecord(record: HostRecord, _ctx: ProjectionContext = {}): RuntimeEventBody[] {
  const data = fieldsOf(record.data) ?? {}
  switch (record.type) {
    case 'assistant/message': {
      const message = fieldsOf(data.message)
      if (message) {
        const text = textOf(message.content)
        return text === null ? [] : [{ kind: 'assistant.message', text, native: record }]
      }
      const text = typeof data.text === 'string' ? data.text : typeof data.content === 'string' ? data.content : null
      return text === null ? [] : [{ kind: 'assistant.delta', text }]
    }
    case 'assistant/attempt': {
      const text = typeof data.text === 'string' ? data.text : typeof data.content === 'string' ? data.content : null
      return text === null ? [] : [{ kind: 'assistant.delta', text }]
    }
    case 'tool/call':
    case 'tool/start':
      return [{
        kind: 'tool.started',
        toolCallId: String(data.callId ?? data.toolCallId ?? data.id ?? ''),
        name: String(data.name ?? data.title ?? 'tool'),
        input: 'arguments' in data ? parseArguments(data.arguments) : data.input ?? data.rawInput,
        native: record,
      }]
    case 'tool/result':
    case 'tool/end': {
      const message = fieldsOf(data.message) ?? data
      return [{
        kind: 'tool.completed',
        toolCallId: String(message.toolCallId ?? data.callId ?? data.toolCallId ?? data.id ?? ''),
        output: textOf(message.content) ?? message.output ?? message.rawOutput,
        isError: message.isError === true || message.status === 'failed',
        native: record,
      }]
    }
    case 'usage':
    case 'usage/update':
      return [{
        kind: 'usage',
        ...(typeof data.contextUsed === 'number' ? { contextUsed: data.contextUsed } : {}),
        ...(typeof data.contextSize === 'number' ? { contextSize: data.contextSize } : {}),
        native: record,
      }]
    case 'turn/start':
      return [{ kind: 'turn.started', origin: 'engine', native: record }]
    case 'turn/end':
      return [{ kind: 'turn.completed', reason: turnReason(data.reason), native: record }]
    case 'config/options':
      return [{ kind: 'config.changed', options: Array.isArray(data.options) ? data.options as SessionConfigState[] : [] }]
    default:
      return [{ kind: 'diagnostic', level: 'info', code: `host.${record.type}`, message: `Host record ${record.type} has no contract projection`, native: record }]
  }
}
