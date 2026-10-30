/**
 * A minimal ACP agent speaking the real protocol over stdio.
 *
 * The driver's tests spawn this file through `process.execPath`, so the driver
 * is proven against a separate process, not an in-process fake. Scripted by the
 * prompt text: `hello`, `needs-approval`, `slow`, `stray-permission`,
 * `schedule-fired`, `schedule-failed`, `die`, `flood`.
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, agent, ndJsonStream } from '@agentclientprotocol/sdk'

const marker = process.env.FIXTURE_PERMISSION_MARKER
const callsMarker = process.env.FIXTURE_CALLS_MARKER
const rejectConfigIds = new Set((process.env.FIXTURE_REJECT_CONFIG_IDS ?? '').split(',').filter(Boolean))
const app = agent({ name: 'fixture-acp-agent' })

/** Requests cross the process boundary, so the test reads them from a file. */
function record(method: string, params: unknown) {
  if (callsMarker === undefined) return
  appendFileSync(callsMarker, `${JSON.stringify({ method, params })}\n`)
}

let sessionCounter = 0
let cancelCurrentTurn: (() => void) | null = null

const options = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
]

const agentCapabilities = JSON.parse(process.env.FIXTURE_AGENT_CAPABILITIES ?? '{}')
// Handshake knobs ride on argv so probe(), which passes no env, can vary them.
const handshake = JSON.parse(process.argv[2] ?? '{}')

app.onRequest(AGENT_METHODS.initialize, () => ({
  protocolVersion: handshake.protocolVersion ?? PROTOCOL_VERSION,
  agentCapabilities,
  ...(handshake.agentInfo === undefined ? {} : { agentInfo: handshake.agentInfo }),
}))

app.onRequest(AGENT_METHODS.session_new, (ctx) => {
  record('session/new', ctx.params)
  sessionCounter += 1
  return { sessionId: `fixture-native-${sessionCounter}` }
})

app.onRequest(AGENT_METHODS.session_set_config_option, (ctx) => {
  record('session/set_config_option', ctx.params)
  if (rejectConfigIds.has(ctx.params.configId)) throw new Error(`unsupported config: ${ctx.params.configId}`)
  return { configOptions: [] }
})

app.onRequest(AGENT_METHODS.session_close, (ctx) => {
  record('session/close', ctx.params)
  return {}
})

app.onNotification(AGENT_METHODS.session_cancel, () => {
  const cancel = cancelCurrentTurn
  cancelCurrentTurn = null
  cancel?.()
})

app.onRequest(AGENT_METHODS.session_prompt, async (ctx) => {
  record('session/prompt', ctx.params)
  const { sessionId, prompt } = ctx.params
  const text = prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
  const send = (chunk: string) =>
    ctx.client.notify(CLIENT_METHODS.session_update, {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } },
    })

  switch (text) {
    case 'hello':
      await send('hello from fixture')
      return { stopReason: 'end_turn' as const }

    case 'needs-approval': {
      const response = await ctx.client.request(CLIENT_METHODS.session_request_permission, {
        sessionId,
        toolCall: { toolCallId: 'tool-1', title: 'Run a tool' },
        options,
      })
      const approved = response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow'
      await send(approved ? 'approved' : 'denied')
      return { stopReason: 'end_turn' as const }
    }

    case 'slow':
      await new Promise<void>((resolve) => {
        cancelCurrentTurn = resolve
      })
      return { stopReason: 'cancelled' as const }

    case 'unresponsive':
      // Never registers a cancel resolver: the turn ignores session/cancel, so
      // the driver's interrupt path has to time out honestly.
      await new Promise<void>(() => {})
      return { stopReason: 'cancelled' as const }

    case 'stray-permission':
      // Ask for permission after this turn has ended: the driver has no active
      // turn to attach it to and must answer 'cancelled' rather than hang.
      setTimeout(() => {
        void ctx.client
          .request(CLIENT_METHODS.session_request_permission, {
            sessionId,
            toolCall: { toolCallId: 'tool-2', title: 'Stray tool' },
            options,
          })
          .then((response) => {
            if (marker !== undefined) writeFileSync(marker, response.outcome.outcome)
          })
      }, 50)
      return { stopReason: 'end_turn' as const }

    case 'schedule-fired':
      // Answer the prompt, then speak with no prompt in flight — how an
      // autonomous schedule or background job reaches the client.
      setTimeout(() => {
        void ctx.client.notify(CLIENT_METHODS.session_update, {
          sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'engine note' } },
        })
      }, 50)
      return { stopReason: 'end_turn' as const }

    case 'schedule-failed':
      // An autonomous turn that opens and then dies with the engine: the only
      // failure mode ACP offers, since an update itself cannot fail.
      setTimeout(() => {
        void ctx.client.notify(CLIENT_METHODS.session_update, {
          sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'engine note' } },
        })
      }, 30)
      setTimeout(() => process.exit(1), 60)
      return { stopReason: 'end_turn' as const }

    case 'close-stdin':
      // Stop reading stdin but keep the transport alive: the driver's next
      // write hits a closed pipe while it still believes the engine is up.
      setTimeout(() => process.stdin.destroy(), 30)
      return { stopReason: 'end_turn' as const }

    case 'die':
      // Answer, then die between turns: the next write goes to a dead pipe.
      setTimeout(() => process.exit(3), 30)
      return { stopReason: 'end_turn' as const }

    case 'flood': {
      for (let i = 0; i < 20; i += 1) {
        await send(`chunk ${i}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return { stopReason: 'end_turn' as const }
    }

    default:
      await send(`unscripted prompt: ${text}`)
      return { stopReason: 'end_turn' as const }
  }
})

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
)
const connection = app.connect(stream)

connection.closed.then(() => process.exit(0), () => process.exit(1))
