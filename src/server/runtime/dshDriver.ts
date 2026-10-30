/**
 * The dsh runtime driver: one ACP child process per connection.
 *
 * dsh speaks ACP; this file is the only place that knows it. Everything leaves
 * here as contract events, so the upper layers never import an ACP type.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  client,
  ndJsonStream,
  type ActiveSession,
} from '@agentclientprotocol/sdk'
import { dshBaselineCapabilities } from './capabilitySnapshot.js'
import { projectSessionUpdate } from './acpProjection.js'
import {
  RuntimeBusyError,
  RuntimeStartupError,
  UnsupportedRuntimeCapabilityError,
  type ApprovalDecision,
  type InterruptResult,
  type RuntimeConnection,
  type RuntimeDriver,
  type RuntimeEvent,
  type RuntimeEventBody,
  type RuntimeExit,
  type RuntimeInstallation,
  type RuntimeProbe,
  type RuntimeSession,
  type RuntimeStartInput,
  type UserTurn,
} from './contract.js'
import { createEventStamper } from './eventStamp.js'

export type DshDriverOptions = {
  resolveCommand?: (installation: RuntimeInstallation) => string[]
  spawn?: typeof nodeSpawn
  now?: () => number
  newApprovalId?: () => string
  interruptTimeoutMs?: number
  closeTimeoutMs?: number
}

const STARTUP_TIMEOUT_MS = 15_000

type PermissionParams = {
  sessionId: string
  toolCall: { title?: string | null; [key: string]: unknown }
  options: Array<{ optionId: string; name: string; kind: string }>
}

type PermissionResponse =
  | { outcome: { outcome: 'cancelled' } }
  | { outcome: { outcome: 'selected'; optionId: string } }

type PendingApproval = (decision: { optionId: string | null; decidedBy: ApprovalDecision['decidedBy'] }) => void

type TurnReason = Extract<RuntimeEventBody, { kind: 'turn.completed' }>['reason']

type TurnChannel = {
  push(event: RuntimeEvent): void
  close(): void
  next(): Promise<IteratorResult<RuntimeEvent>>
}

type TurnState = {
  channel: TurnChannel
  finished: Promise<void>
  settle(): void
  done: boolean
}

function createTurnChannel(): TurnChannel {
  const buffer: RuntimeEvent[] = []
  const waiters: Array<(result: IteratorResult<RuntimeEvent>) => void> = []
  let closed = false

  const settle = () => {
    while (waiters.length > 0) {
      if (buffer.length > 0) {
        const event = buffer.shift()!
        waiters.shift()!({ done: false, value: event })
      } else if (closed) {
        waiters.shift()!({ done: true, value: undefined })
      } else {
        return
      }
    }
  }

  return {
    push(event) {
      if (closed) return
      buffer.push(event)
      settle()
    },
    close() {
      closed = true
      settle()
    },
    next() {
      if (buffer.length > 0) return Promise.resolve({ done: false, value: buffer.shift()! })
      if (closed) return Promise.resolve({ done: true, value: undefined })
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

/** Resolves `true` when the promise did not settle in time. */
function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs)
    timer.unref?.()
    void promise.then(
      () => {
        clearTimeout(timer)
        resolve(false)
      },
      () => {
        clearTimeout(timer)
        resolve(false)
      },
    )
  })
}

function approvalEffect(kind: string) {
  switch (kind) {
    case 'allow_once':
      return 'allow-once' as const
    case 'allow_always':
      return 'allow-always' as const
    case 'reject_once':
    case 'reject_always':
      return 'deny' as const
    default:
      return 'other' as const
  }
}

function turnReason(stopReason: string): TurnReason {
  switch (stopReason) {
    case 'end_turn':
    case 'cancelled':
    case 'max_tokens':
    case 'refusal':
      return stopReason
    default:
      // max_turn_requests cuts the turn short; the contract has no reason for it.
      return 'error'
  }
}

export function createDshDriver(options: DshDriverOptions = {}): RuntimeDriver {
  const spawn = options.spawn ?? nodeSpawn
  const now = options.now ?? Date.now
  const newApprovalId = options.newApprovalId ?? (() => randomUUID())
  const resolveCommand = options.resolveCommand ?? ((installation) => [installation.executablePath])
  const interruptTimeoutMs = options.interruptTimeoutMs ?? 5_000
  const closeTimeoutMs = options.closeTimeoutMs ?? 10_000

  async function connect(input: RuntimeStartInput): Promise<RuntimeConnection> {
    const [command, ...args] = resolveCommand(input.installation)
    const child = spawn(command, args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString()
    })

    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        child.stdout?.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        child.stdout?.on('end', () => {
          try {
            controller.close()
          } catch {
            // already closed by the connection teardown
          }
        })
        child.stdout?.on('error', (error) => controller.error(error))
      },
    })
    const stdin = new WritableStream<Uint8Array>({
      write(chunk) {
        child.stdin?.write(chunk)
      },
      close() {
        child.stdin?.end()
      },
    })

    let exit: RuntimeExit | null = null
    let settleExit: ((value: RuntimeExit) => void) | null = null
    const exited = new Promise<RuntimeExit>((resolve) => {
      settleExit = resolve
    })
    const exitListeners = new Set<(value: RuntimeExit) => void>()
    const recordExit = (value: RuntimeExit) => {
      if (exit !== null) return
      exit = value
      settleExit?.(value)
      for (const listener of exitListeners) listener(value)
    }
    child.once('exit', (code, signal) => recordExit({ code, signal }))

    let startupReject: ((error: RuntimeStartupError) => void) | null = null
    const startupFailure = new Promise<never>((_, reject) => {
      startupReject = reject
    })
    startupFailure.catch(() => {
      // startup may win the race; a late rejection is not an unhandled error
    })
    const failStartup = (message: string) => {
      startupReject?.(new RuntimeStartupError(message, stderr))
    }
    child.once('exit', (code, signal) => {
      failStartup(`the dsh runtime exited during startup (code ${String(code)}, signal ${String(signal)})`)
    })
    child.once('error', (error: Error) => {
      recordExit({ code: null, signal: null })
      failStartup(`failed to launch ${command}: ${error.message}`)
    })

    const app = client({ name: 'echoflow-code' })
    const sessions = new Map<string, { approve(params: PermissionParams): Promise<PermissionResponse> }>()
    app.onRequest(CLIENT_METHODS.session_request_permission, async (ctx) => {
      const session = sessions.get(ctx.params.sessionId)
      if (session === undefined) return { outcome: { outcome: 'cancelled' as const } }
      return session.approve(ctx.params as PermissionParams)
    })

    const connection = app.connect(ndJsonStream(stdin, stdout))

    let handshakeTimer: ReturnType<typeof setTimeout> | null = null
    const handshakeTimeout = new Promise<never>((_, reject) => {
      handshakeTimer = setTimeout(
        () => reject(new RuntimeStartupError('the dsh runtime did not answer the ACP handshake', stderr)),
        input.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
      )
      handshakeTimer.unref?.()
    })
    try {
      await Promise.race([
        connection.agent.request(AGENT_METHODS.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
        startupFailure,
        handshakeTimeout,
      ])
    } catch (error) {
      try {
        connection.close()
      } catch {
        // already closed by the failed handshake
      }
      child.stdin?.end()
      // An engine that dies before answering closes the stream first; wait for
      // its exit so the error carries the stderr it wrote.
      await settleWithin(exited, 1_000)
      child.kill('SIGKILL')
      if (error instanceof RuntimeStartupError) throw error
      throw new RuntimeStartupError(error instanceof Error ? error.message : String(error), stderr)
    } finally {
      if (handshakeTimer !== null) clearTimeout(handshakeTimer)
      startupReject = null
    }

    function createSession(
      sessionId: string,
      active: ActiveSession,
    ): { session: RuntimeSession; approve(params: PermissionParams): Promise<PermissionResponse> } {
      const stamp = createEventStamper({ sessionId, runId: input.runId, now })
      const pendingApprovals = new Map<string, PendingApproval>()
      let activeTurn: TurnState | null = null

      function cancelPendingApprovals() {
        const pending = [...pendingApprovals.values()]
        pendingApprovals.clear()
        for (const resolve of pending) resolve({ optionId: null, decidedBy: 'cancelled' })
      }

      function completeTurn(state: TurnState, reason: TurnReason) {
        if (state.done) return
        state.done = true
        state.channel.push(stamp({ kind: 'turn.completed', reason, native: { stopReason: reason } }))
        state.channel.push(stamp({ kind: 'session.state', state: 'idle' }, 'echoflow'))
        state.channel.close()
        if (activeTurn === state) activeTurn = null
        cancelPendingApprovals()
        state.settle()
      }

      function failTurn(state: TurnState, error: unknown) {
        if (state.done) return
        state.channel.push(
          stamp({
            kind: 'diagnostic',
            level: 'error',
            code: 'acp.turn_failed',
            message: error instanceof Error ? error.message : String(error),
            native: error,
          }),
        )
        completeTurn(state, 'error')
      }

      async function runTurn(state: TurnState, text: string) {
        // The prompt response arrives as a `stop` message, so failures are caught
        // here rather than by the consumer of the stream.
        void active.prompt(text).catch((error: unknown) => failTurn(state, error))
        try {
          for (;;) {
            const message = await active.nextUpdate()
            if (state.done) return
            if (message.kind === 'stop') {
              completeTurn(state, turnReason(message.stopReason))
              return
            }
            const body = projectSessionUpdate(message.update)
            if (body !== null) state.channel.push(stamp(body))
          }
        } catch (error) {
          failTurn(state, error)
        }
      }

      async function interruptTurn(state: TurnState): Promise<InterruptResult> {
        if (activeTurn !== state) return { status: 'not-running', forcedTerminate: false }
        try {
          await connection.agent.notify(AGENT_METHODS.session_cancel, { sessionId: active.sessionId })
        } catch {
          // the engine may already be gone; the await below still settles
        }
        if (await settleWithin(state.finished, interruptTimeoutMs)) {
          // The engine has not acknowledged the cancel. Answering pending
          // approvals is the only lever left, and the turn is still running —
          // claiming it stopped would make the UI lie and the next send race a
          // second pump on the same update queue.
          cancelPendingApprovals()
          return { status: 'cancelling', residualWork: ['prompt'], forcedTerminate: false }
        }
        return { status: 'cancelled', forcedTerminate: false }
      }

      async function interrupt(): Promise<InterruptResult> {
        const state = activeTurn
        if (state === null) return { status: 'not-running', forcedTerminate: false }
        return interruptTurn(state)
      }

      async function approve(params: PermissionParams): Promise<PermissionResponse> {
        const state = activeTurn
        // A request with no turn to show it in can never be answered: say so
        // instead of leaving the engine waiting.
        if (state === null) return { outcome: { outcome: 'cancelled' } }

        const requestId = newApprovalId()
        const decision = new Promise<{ optionId: string | null; decidedBy: ApprovalDecision['decidedBy'] }>(
          (resolve) => {
            pendingApprovals.set(requestId, resolve)
          },
        )
        state.channel.push(
          stamp({
            kind: 'approval.requested',
            request: {
              requestId,
              kind: 'tool',
              title: params.toolCall.title ?? 'Tool call',
              details: { toolCall: params.toolCall },
              options: params.options.map((option) => ({
                id: option.optionId,
                label: option.name,
                effect: approvalEffect(option.kind),
              })),
              native: params,
            },
          }),
        )
        const decided = await decision
        state.channel.push(
          stamp({
            kind: 'approval.resolved',
            requestId,
            decision: { requestId, optionId: decided.optionId, decidedBy: decided.decidedBy, at: now() },
          }),
        )
        return decided.optionId === null
          ? { outcome: { outcome: 'cancelled' } }
          : { outcome: { outcome: 'selected', optionId: decided.optionId } }
      }

      function send(turn: UserTurn): AsyncIterable<RuntimeEvent> {
        if (activeTurn !== null) throw new RuntimeBusyError()
        const channel = createTurnChannel()
        let settle!: () => void
        const finished = new Promise<void>((resolve) => {
          settle = resolve
        })
        const state: TurnState = { channel, finished, settle, done: false }
        activeTurn = state
        channel.push(stamp({ kind: 'session.state', state: 'running' }, 'echoflow'))
        void runTurn(state, turn.text)
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => channel.next(),
              async return() {
                // Dropping the stream must not leave this turn running, but a
                // stale iterator from an earlier turn must not cancel the one
                // that is active now.
                await interruptTurn(state)
                return { done: true as const, value: undefined }
              },
            }
          },
        }
      }

      const session: RuntimeSession = {
        nativeSessionId: active.sessionId,
        capabilities: dshBaselineCapabilities(),
        send,
        async respondApproval(requestId, optionId) {
          const resolve = pendingApprovals.get(requestId)
          if (resolve === undefined) throw new Error(`unknown approval request: ${requestId}`)
          pendingApprovals.delete(requestId)
          resolve({ optionId, decidedBy: 'user' })
        },
        interrupt,
        async close() {
          if (activeTurn !== null) await interrupt()
          active.dispose()
          sessions.delete(active.sessionId)
        },
      }

      return { session, approve }
    }

    let closing: Promise<void> | null = null

    return {
      capabilities: dshBaselineCapabilities(),

      async openSession({ sessionId, cwd, model, reasoningEffort }) {
        const active = await connection.agent.buildSession(cwd).start()
        try {
          if (model !== undefined) {
            await connection.agent.request(AGENT_METHODS.session_set_config_option, {
              sessionId: active.sessionId,
              configId: 'model',
              value: `${model.provider}/${model.model}`,
            })
          }
          if (reasoningEffort !== undefined) {
            await connection.agent.request(AGENT_METHODS.session_set_config_option, {
              sessionId: active.sessionId,
              configId: 'reasoning_effort',
              value: reasoningEffort,
            })
          }
        } catch (error) {
          // A half-open session with the wrong model is worse than no session:
          // later prompts would silently run on the engine default.
          await connection.agent
            .request(AGENT_METHODS.session_close, { sessionId: active.sessionId })
            .catch(() => {})
          active.dispose()
          throw error
        }
        const created = createSession(sessionId, active)
        sessions.set(active.sessionId, created)
        return created.session
      },

      async resumeSession() {
        throw new UnsupportedRuntimeCapabilityError('session.resume')
      },

      // eslint-disable-next-line require-yield
      async *listSessions() {
        throw new UnsupportedRuntimeCapabilityError('session.list')
      },

      close() {
        if (closing !== null) return closing
        closing = (async () => {
          sessions.clear()
          try {
            connection.close()
          } catch {
            // already closed
          }
          child.stdin?.end()
          if (await settleWithin(exited, closeTimeoutMs)) {
            child.kill('SIGKILL')
            await settleWithin(exited, 1_000)
          }
          child.stdin?.destroy()
        })()
        return closing
      },

      onExit(listener: (value: RuntimeExit) => void) {
        exitListeners.add(listener)
        return () => {
          exitListeners.delete(listener)
        }
      },
    }
  }

  return {
    engineId: 'dsh',
    driverId: 'dsh-acp',

    async probe(installation): Promise<RuntimeProbe> {
      try {
        const connection = await connect({ installation, runId: 'probe', cwd: process.cwd() })
        await connection.close()
        return { ok: true, version: null, protocolVersion: PROTOCOL_VERSION, error: null }
      } catch (error) {
        return {
          ok: false,
          version: null,
          protocolVersion: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    start: connect,
  }
}
