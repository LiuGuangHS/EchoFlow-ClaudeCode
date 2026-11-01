/**
 * ACP session updates, translated into contract events.
 *
 * Nothing is dropped silently: an update the contract has no shape for still
 * becomes a diagnostic carrying the native payload, so a newer dsh cannot make
 * a turn go quiet.
 */
import type { RuntimeEventBody, SessionConfigGroup, SessionConfigState } from './contract.js'

/** ACP updates that carry metadata the contract has no product meaning for yet. */
const METADATA_UPDATES = new Set([
  'available_commands_update',
  'current_mode_update',
  'session_info_update',
  'plan_update',
  'plan_removed',
  'compaction_update',
  'compaction_summary_chunk',
])

type AnyUpdate = Record<string, unknown>

export function projectSessionUpdate(update: unknown): RuntimeEventBody | null {
  if (update === null || typeof update !== 'object') return unknownUpdate(update)
  const record = update as AnyUpdate
  const kind = record.sessionUpdate
  if (typeof kind !== 'string') return unknownUpdate(update)

  switch (kind) {
    case 'user_message_chunk':
      // Our own input echoed back; the caller already has it.
      return null
    case 'agent_message_chunk': {
      const text = textOf(record)
      if (text !== null) return { kind: 'assistant.delta', text }
      return diagnostic('info', 'acp.unsupported_content', 'the agent sent content this driver does not render', update)
    }
    case 'agent_thought_chunk': {
      const text = textOf(record)
      if (text !== null) return { kind: 'assistant.thinking', text }
      return diagnostic('info', 'acp.unsupported_content', 'the agent sent content this driver does not render', update)
    }
    case 'config_option_update':
      return { kind: 'config.changed', options: configOptions(record.configOptions) }
    case 'tool_call':
      return {
        kind: 'tool.started',
        toolCallId: String(record.toolCallId ?? ''),
        name: typeof record.title === 'string' ? record.title : typeof record.kind === 'string' ? record.kind : 'tool',
        input: record.rawInput,
        native: update,
      }
    case 'tool_call_update':
      return toolUpdate(record, update)
    case 'plan':
      return { kind: 'plan', entries: Array.isArray(record.entries) ? record.entries : [], native: update }
    case 'usage_update':
      return usage(record, update)
    default:
      if (METADATA_UPDATES.has(kind)) {
        return diagnostic('info', `acp.${kind}`, `ACP update ${kind} has no contract meaning yet`, update)
      }
      return unknownUpdate(update)
  }
}

function toolUpdate(record: AnyUpdate, native: unknown): RuntimeEventBody {
  const toolCallId = String(record.toolCallId ?? '')
  if (record.status === 'completed' || record.status === 'failed') {
    return {
      kind: 'tool.completed',
      toolCallId,
      output: record.rawOutput,
      isError: record.status === 'failed',
      native,
    }
  }
  return { kind: 'tool.updated', toolCallId, native }
}

/** ACP reports context pressure, not per-turn tokens; only these three fields are real. */
function usage(record: AnyUpdate, native: unknown): RuntimeEventBody {
  const body: Extract<RuntimeEventBody, { kind: 'usage' }> = { kind: 'usage', native }
  if (isFiniteNumber(record.used)) body.contextUsed = record.used
  if (isFiniteNumber(record.size)) body.contextSize = record.size
  const cost = record.cost as { amount?: unknown; currency?: unknown } | null | undefined
  if (isFiniteNumber(cost?.amount) && typeof cost?.currency === 'string' && cost.currency !== '') {
    body.cost = { amount: cost.amount, currency: cost.currency }
  }
  return body
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** ACP sends the whole option table, with select values and booleans mixed. */
function configOptionCandidates(raw: unknown): SessionConfigState['options'] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const record = (entry ?? {}) as AnyUpdate
    const nested = record.options
    if (Array.isArray(nested)) {
      return {
        name: String(record.name ?? ''),
        options: configOptionCandidates(nested) as SessionConfigGroup['options'],
      }
    }
    return {
      value: String(record.value ?? ''),
      name: String(record.name ?? ''),
      ...(record.description == null ? {} : { description: String(record.description) }),
    }
  })
}

function configOptions(raw: unknown): SessionConfigState[] {
  if (!Array.isArray(raw)) return []
  return raw.map((option) => {
    const record = (option ?? {}) as AnyUpdate
    const base = {
      id: String(record.id ?? ''),
      name: String(record.name ?? ''),
      // ACP makes these `string | null`: an explicit null is absent, not the word "null".
      ...(record.category == null ? {} : { category: String(record.category) }),
      ...(record.description == null ? {} : { description: String(record.description) }),
    }
    // value has to stay the variant `kind` promises, not a stringified copy.
    if (record.type === 'boolean') return { ...base, kind: 'boolean' as const, value: record.currentValue === true }
    return {
      ...base,
      kind: 'select' as const,
      value: String(record.currentValue ?? ''),
      options: configOptionCandidates(record.options),
    }
  })
}

function textOf(record: AnyUpdate): string | null {
  const content = record.content
  if (content === null || typeof content !== 'object') return null
  const { type, text } = content as { type?: unknown; text?: unknown }
  return type === 'text' && typeof text === 'string' ? text : null
}

function unknownUpdate(native: unknown): RuntimeEventBody {
  return diagnostic('warn', 'acp.unknown_update', 'unrecognised ACP session update', native)
}

function diagnostic(
  level: 'info' | 'warn' | 'error',
  code: string,
  message: string,
  native: unknown,
): RuntimeEventBody {
  return { kind: 'diagnostic', level, code, message, native }
}
