/**
 * A minimal ACP agent speaking the real protocol over stdio.
 *
 * The driver's tests spawn this file through `process.execPath`, so the driver
 * is proven against a separate process, not an in-process fake. Scripted by the
 * prompt text: `hello`, `needs-approval`, `slow`, `slow-chatty`, `unresponsive`,
 * `stray-permission`, `schedule-fired`, `schedule-failed`, `close-stdin`, `die`,
 * `die-midturn`, `die-midturn-leaky`, `reject-prompt`, `config-update`, `flood`.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, agent, ndJsonStream } from '@agentclientprotocol/sdk'

const marker = process.env.FIXTURE_PERMISSION_MARKER
const callsMarker = process.env.FIXTURE_CALLS_MARKER
const rejectConfigIds = new Set((process.env.FIXTURE_REJECT_CONFIG_IDS ?? '').split(',').filter(Boolean))
const ignoreClose = process.env.FIXTURE_IGNORE_CLOSE === '1'
const writeAfterClose = process.env.FIXTURE_WRITE_AFTER_CLOSE === '1'
const stallSessionNew = process.env.FIXTURE_STALL_SESSION_NEW === '1'
const app = agent({ name: 'fixture-acp-agent' })

/** Requests cross the process boundary, so the test reads them from a file. */
function record(method: string, params: unknown) {
  if (callsMarker === undefined) return
  appendFileSync(callsMarker, `${JSON.stringify({ method, params })}\n`)
}

let sessionCounter = 0
let cancelCurrentTurn: (() => void) | null = null
let refusedPrompt = false

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

app.onRequest(AGENT_METHODS.session_new, async (ctx) => {
  record('session/new', ctx.params)
  if (stallSessionNew) await new Promise<void>(() => {})
  sessionCounter += 1
  return { sessionId: `fixture-native-${sessionCounter}` }
})

app.onRequest(AGENT_METHODS.session_set_config_option, (ctx) => {
  record('session/set_config_option', ctx.params)
  if (rejectConfigIds.has(ctx.params.configId)) throw new Error(`unsupported config: ${ctx.params.configId}`)
  return { configOptions: [] }
})

app.onRequest(AGENT_METHODS.session_close, async (ctx) => {
  record('session/close', ctx.params)
  if (ignoreClose) await new Promise<void>(() => {})
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

    case 'slow-chatty':
      // Answer cancel the way a real engine does: one last update, then the stop.
      await new Promise<void>((resolve) => {
        cancelCurrentTurn = resolve
      })
      await send('wrapping up')
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

    case 'die-midturn':
      // Die while the turn is still open: no stopReason ever arrives, so the
      // driver has to close the turn itself.
      await send('partial')
      process.exit(4)

    case 'die-midturn-leaky': {
      // Same death, but a descendant inherits stdout and outlives us: the read
      // pipe does not tear down, so only the exit event can close the turn.
      // stdin is deliberately not inherited — a later write to the dead engine
      // has to fail rather than buffer silently.
      await send('partial')
      spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: ['ignore', 'inherit', 'ignore'] })
      process.exit(4)
    }

    case 'reject-prompt':
      // Refuse the request itself, the way an engine that will not take a
      // prompt does: the turn has to fail through the prompt rejection.
      if (!refusedPrompt) {
        refusedPrompt = true
        throw new Error('the engine refused this prompt')
      }
      await send('hello after a refusal')
      return { stopReason: 'end_turn' as const }

    case 'config-update':
      // Publish the engine's configuration catalog the way ACP does: select
      // values with candidates and groups, and a real boolean value.
      await ctx.client.notify(CLIENT_METHODS.session_update, {
        sessionId,
        update: {
          sessionUpdate: 'config_option_update',
          configOptions: [
            {
              type: 'select',
              id: 'model',
              name: 'Model',
              category: 'model',
              currentValue: 'echoflow/kimi-k3',
              options: [
                { group: 'main', name: 'Main', options: [{ value: 'echoflow/kimi-k3', name: 'Kimi K3', description: 'default' }] },
                { group: 'other', name: 'Other', options: [{ value: 'echoflow/other', name: 'Other model' }] },
              ],
            },
            {
              type: 'select',
              id: 'reasoning_effort',
              name: 'Reasoning effort',
              currentValue: 'high',
              options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
            },
            { type: 'boolean', id: 'thinking', name: 'Thinking', currentValue: true },
          ],
        },
      })
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

if (writeAfterClose) {
  // Keep talking after the client hung up, the way a late reply or a final
  // notification reaches a driver that has already closed its reader.
  connection.closed.then(() => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'late', update: {} } })}\n`)
    setTimeout(() => process.exit(0), 100)
  })
} else {
  connection.closed.then(() => process.exit(0), () => process.exit(1))
}
