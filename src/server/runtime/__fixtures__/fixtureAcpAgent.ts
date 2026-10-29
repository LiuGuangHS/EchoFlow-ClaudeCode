/**
 * A minimal ACP agent speaking the real protocol over stdio.
 *
 * The driver's tests spawn this file through `process.execPath`, so the driver
 * is proven against a separate process, not an in-process fake. Scripted by the
 * prompt text: `hello`, `needs-approval`, `slow`, `stray-permission`.
 */
import { writeFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, agent, ndJsonStream } from '@agentclientprotocol/sdk'

const marker = process.env.FIXTURE_PERMISSION_MARKER
const app = agent({ name: 'fixture-acp-agent' })

let sessionCounter = 0
let cancelCurrentTurn: (() => void) | null = null

const options = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
]

app.onRequest(AGENT_METHODS.initialize, () => ({
  protocolVersion: PROTOCOL_VERSION,
  agentCapabilities: {},
}))

app.onRequest(AGENT_METHODS.session_new, () => {
  sessionCounter += 1
  return { sessionId: `fixture-native-${sessionCounter}` }
})

app.onNotification(AGENT_METHODS.session_cancel, () => {
  const cancel = cancelCurrentTurn
  cancelCurrentTurn = null
  cancel?.()
})

app.onRequest(AGENT_METHODS.session_prompt, async (ctx) => {
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
