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
  type McpServerSpec,
  type RuntimeConnection,
  type RuntimeCapabilities,
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
  /** Budget for a session close, across interrupt and session/close together. */
  sessionCloseTimeoutMs?: number
  /** Budget for opening a session, across session/new and the config options. */
  sessionOpenTimeoutMs?: number
  /** Quiet period that ends a turn the engine started on its own. */
  engineTurnIdleMs?: number
  /** Events held for a consumer that stopped reading before the oldest are dropped. */
  turnBufferLimit?: number
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

type TurnChannelOptions = {
  /** Bound on events held for a consumer that stopped reading. */
  limit: number
  /** The warning to leave in the stream when the bound is hit. */
  overflowEvent: () => RuntimeEvent
}

function createTurnChannel(options: TurnChannelOptions): TurnChannel {
  const limit = Math.max(1, options.limit)
  const buffer: RuntimeEvent[] = []
  const waiters: Array<(result: IteratorResult<RuntimeEvent>) => void> = []
  let closed = false
  let overflowPending = false

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
      // A consumer that walked away must not grow this forever. Drop the oldest
      // events — never the terminal one — and say once that it happened.
      while (buffer.length >= limit) {
        const index = buffer.findIndex((buffered) => buffered.kind !== 'turn.completed')
        if (index === -1) break
        buffer.splice(index, 1)
        overflowPending = true
      }
      buffer.push(event)
      settle()
    },
    close() {
      closed = true
      settle()
    },
    next() {
      if (overflowPending) {
        overflowPending = false
        return Promise.resolve({ done: false, value: options.overflowEvent() })
      }
      if (buffer.length > 0) return Promise.resolve({ done: false, value: buffer.shift()! })
      if (closed) return Promise.resolve({ done: true, value: undefined })
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

/** Resolves `true` when the promise did not settle in time. */
function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {  return new Promise((resolve) => {
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

/** Fails a request the engine never answers, so the caller is not stuck. */
async function withBudget<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** Only what the agent declared in the handshake may be claimed as native. */
function capabilitiesFromHandshake(
  handshake: { agentCapabilities?: Record<string, unknown> } | null,
): RuntimeCapabilities {
  const capabilities = dshBaselineCapabilities()
  const prompt = handshake?.agentCapabilities?.promptCapabilities as { image?: unknown } | undefined
  if (prompt?.image === true) {
    capabilities.prompt.image = { state: 'native', source: 'handshake' }
  }
  const mcp = handshake?.agentCapabilities?.mcpCapabilities as { http?: unknown } | undefined
  if (mcp?.http === true) {
    capabilities.extensions.mcpHttp = { state: 'native', source: 'handshake' }
  }
  return capabilities
}

type PromptContent = Parameters<ActiveSession['prompt']>[0]

/** Text first, then attachments, then references — the order the user built. */
function promptBlocks(turn: UserTurn): PromptContent {
  const blocks: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string }
    | { type: 'resource_link'; uri: string; name: string }
  > = [{ type: 'text', text: turn.text }]
  for (const attachment of turn.attachments ?? []) {
    blocks.push({ type: 'image', mimeType: attachment.mimeType, data: attachment.dataBase64 })
  }
  for (const reference of turn.references ?? []) {
    blocks.push({ type: 'resource_link', uri: reference.uri, name: reference.label ?? reference.uri })
  }
  return blocks as PromptContent
}

/** ACP spells env vars and headers as arrays of pairs, not maps. */
function pairs(map: Record<string, string> | undefined) {
  return Object.entries(map ?? {}).map(([name, value]) => ({ name, value }))
}

function toAcpMcpServer(server: McpServerSpec) {
  return server.kind === 'http'
    ? { type: 'http' as const, name: server.name, url: server.url, headers: pairs(server.headers) }
    : { name: server.name, command: server.command, args: server.args ?? [], env: pairs(server.env) }
}

function approvalEffect(kind: string) {  switch (kind) {
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
  const sessionCloseTimeoutMs = options.sessionCloseTimeoutMs ?? 2_000
  const sessionOpenTimeoutMs = options.sessionOpenTimeoutMs ?? 15_000
  const engineTurnIdleMs = options.engineTurnIdleMs ?? 1_000
  const turnBufferLimit = options.turnBufferLimit ?? 2_000

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
        const endInput = () => {
          try {
            controller.close()
          } catch {
            // already closed by the connection teardown or the other event
          }
        }
        child.stdout?.on('data', (chunk: Buffer) => {
          try {
            controller.enqueue(new Uint8Array(chunk))
          } catch {
            // the connection closed its reader; late engine output has no one
            // to read it, and throwing here is uncaught and kills the server
          }
        })
        child.stdout?.on('end', endInput)
        // A destroyed pipe emits 'close' without 'end'. Closing, not erroring,
        // keeps a normal end's still-queued tail when 'close' follows it.
        child.stdout?.on('close', endInput)
        child.stdout?.on('error', (error) => {
          try {
            controller.error(error)
          } catch {
            // the stream already ended; erroring a closed controller throws
            // here, and an uncaught throw in an event handler kills the server
          }
        })
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
    // An engine that stops reading stdin cannot receive another prompt; without
    // this listener the next write raises an uncaught EPIPE and takes the server
    // down with it.
    child.stdin?.on('error', () => recordExit({ code: null, signal: null }))

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

    /** Closes a session the engine opened after the client gave up on it. */
    function closeLateSession(late: ActiveSession): void {
      void settleWithin(
        connection.agent.request(AGENT_METHODS.session_close, { sessionId: late.sessionId }),
        sessionCloseTimeoutMs,
      )
      late.dispose()
    }

    let handshakeTimer: ReturnType<typeof setTimeout> | null = null
    const handshakeTimeout = new Promise<never>((_, reject) => {
      handshakeTimer = setTimeout(
        () => reject(new RuntimeStartupError('the dsh runtime did not answer the ACP handshake', stderr)),
        input.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
      )
      handshakeTimer.unref?.()
    })
    let answered: {
      protocolVersion?: number
      agentCapabilities?: Record<string, unknown>
      agentInfo?: { name?: string; version?: string }
    }
    try {
      answered = (await Promise.race([
        connection.agent.request(AGENT_METHODS.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
        startupFailure,
        handshakeTimeout,
      ])) as typeof answered
      // Anything else may answer our initialize; its replies are not ours to read.
      if (answered.protocolVersion !== PROTOCOL_VERSION) {
        throw new RuntimeStartupError(
          `the dsh runtime answered ACP protocol ${String(answered.protocolVersion)}, this driver speaks ${PROTOCOL_VERSION}`,
          stderr,
        )
      }
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
      const engineListeners = new Set<(events: AsyncIterable<RuntimeEvent>) => void>()
      let activeTurn: TurnState | null = null
      let engineTurn: TurnState | null = null
      let engineIdleTimer: ReturnType<typeof setTimeout> | null = null
      let closed = false

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

      // The engine process is the authority on whether it is still working. Its
      // pipes can outlive it — a descendant may have inherited stdout — so exit,
      // not stream teardown, is what has to lay a live turn down.
      let engineGone = false
      void exited.then(() => {
        engineGone = true
        const gone = new Error('the engine exited mid-turn')
        if (activeTurn !== null) failTurn(activeTurn, gone)
        if (engineTurn !== null) failEngineTurn(gone)
      })

      /** The session's single reader of the update cursor: one pump, always on. */
      async function pump() {
        for (;;) {
          let message
          try {
            message = await active.nextUpdate()
          } catch (error) {
            if (closed) return
            if (activeTurn !== null) failTurn(activeTurn, error)
            else failEngineTurn(error)
            // A refused prompt rejects one read but leaves the queue usable; a
            // closed connection fails it for good, so reading on would spin.
            if (connection.signal.aborted) return
            continue
          }
          // A closing session still owes its live turn the engine's stop: the
          // cancel that close() sent is answered here, and dropping it would
          // leave close() waiting out its whole budget.
          if (closed && activeTurn === null) return
          if (message.kind === 'stop') {
            if (activeTurn !== null) completeTurn(activeTurn, turnReason(message.stopReason))
            else finishEngineTurn(turnReason(message.stopReason))
            continue
          }
          const body = projectSessionUpdate(message.update)
          if (body === null) continue
          if (activeTurn !== null) activeTurn.channel.push(stamp(body))
          else pushEngineEvent(body)
        }
      }

      function newTurnChannel(): TurnChannel {
        return createTurnChannel({
          limit: turnBufferLimit,
          overflowEvent: () =>
            stamp({
              kind: 'diagnostic',
              level: 'warn',
              code: 'runtime.turn_buffer_overflow',
              message: 'the consumer stopped reading; the oldest turn events were dropped',
            }),
        })
      }

      /** A listener that throws or rejects must not take the pump down with it. */
      function notifyEngineListener(
        listener: (events: AsyncIterable<RuntimeEvent>) => void | Promise<void>,
        stream: AsyncIterable<RuntimeEvent>,
        state: TurnState,
      ) {
        const report = (error: unknown) => {
          state.channel.push(
            stamp({
              kind: 'diagnostic',
              level: 'warn',
              code: 'runtime.engine_listener_failed',
              message: error instanceof Error ? error.message : String(error),
              native: error,
            }),
          )
        }
        try {
          const result = listener(stream)
          if (result && typeof (result as Promise<void>).then === 'function') {
            void (result as Promise<void>).then(undefined, report)
          }
        } catch (error) {
          report(error)
        }
      }

      function startEngineTurn(): TurnState {
        const channel = newTurnChannel()
        let settle!: () => void
        const finished = new Promise<void>((resolve) => {
          settle = resolve
        })
        const state: TurnState = { channel, finished, settle, done: false }
        engineTurn = state
        channel.push(stamp({ kind: 'turn.started', origin: 'engine', native: null }))
        const stream: AsyncIterable<RuntimeEvent> = {
          [Symbol.asyncIterator]: () => ({ next: () => channel.next() }),
        }
        for (const listener of engineListeners) notifyEngineListener(listener, stream, state)
        return state
      }

      function pushEngineEvent(body: RuntimeEventBody) {
        const state = engineTurn ?? startEngineTurn()
        state.channel.push(stamp(body))
        // ACP has no end-of-turn notification for work the engine starts on its
        // own, so the turn is over when the engine stops talking.
        if (engineIdleTimer !== null) clearTimeout(engineIdleTimer)
        engineIdleTimer = setTimeout(() => finishEngineTurn('end_turn'), engineTurnIdleMs)
        engineIdleTimer.unref?.()
      }

      function finishEngineTurn(reason: TurnReason) {
        const state = engineTurn
        if (state === null || state.done) return
        if (engineIdleTimer !== null) {
          clearTimeout(engineIdleTimer)
          engineIdleTimer = null
        }
        engineTurn = null
        state.done = true
        state.channel.push(stamp({ kind: 'turn.completed', reason, native: { reason } }))
        state.channel.close()
        state.settle()
      }

      function failEngineTurn(error: unknown) {
        const state = engineTurn
        if (state === null || state.done) return
        state.channel.push(
          stamp({
            kind: 'diagnostic',
            level: 'error',
            code: 'acp.turn_failed',
            message: error instanceof Error ? error.message : String(error),
            native: error,
          }),
        )
        finishEngineTurn('error')
      }

      function runTurn(state: TurnState, turn: UserTurn) {
        // The prompt response arrives as a `stop` the pump reads; a live engine
        // reports a failure only by rejecting the prompt. A dead one is refused
        // before the prompt is sent.
        if (engineGone) return failTurn(state, new Error('the engine is not running'))
        void active.prompt(promptBlocks(turn)).catch((error: unknown) => failTurn(state, error))
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
        if ((turn.attachments?.length ?? 0) > 0 && capabilities.prompt.image.state !== 'native') {
          throw new UnsupportedRuntimeCapabilityError('prompt.image')
        }
        // The user takes the floor: what the engine was saying on its own ends
        // here instead of leaking into this turn.
        finishEngineTurn('end_turn')
        const channel = newTurnChannel()
        let settle!: () => void
        const finished = new Promise<void>((resolve) => {
          settle = resolve
        })
        const state: TurnState = { channel, finished, settle, done: false }
        activeTurn = state
        channel.push(stamp({ kind: 'session.state', state: 'running' }, 'echoflow'))
        runTurn(state, turn)
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
        capabilities: capabilitiesFromHandshake(answered),
        send,
        onEngineTurn(listener) {
          if (engineListeners.size > 0) throw new Error('an engine turn listener is already registered')
          engineListeners.add(listener)
          let disposed = false
          return () => {
            if (disposed) return
            disposed = true
            engineListeners.delete(listener)
          }
        },
        async respondApproval(requestId, optionId) {
          const resolve = pendingApprovals.get(requestId)
          if (resolve === undefined) throw new Error(`unknown approval request: ${requestId}`)
          pendingApprovals.delete(requestId)
          resolve({ optionId, decidedBy: 'user' })
        },
        interrupt,
        async close() {
          if (closed) return
          closed = true
          finishEngineTurn('cancelled')
          // The engine may ignore both cancel and session/close, so they are
          // sent together and the teardown is budgeted. dispose() only drops
          // the local router — the engine keeps the session until close lands.
          const teardown = Promise.allSettled([
            activeTurn === null ? Promise.resolve() : interrupt(),
            connection.agent.request(AGENT_METHODS.session_close, { sessionId: active.sessionId }),
          ])
          await settleWithin(teardown, sessionCloseTimeoutMs)
          // Unlike interrupt(), a session being torn down has no reader left to
          // lie to, so the turn is laid down locally once the budget runs out.
          if (activeTurn !== null) completeTurn(activeTurn, 'cancelled')
          active.dispose()
          sessions.delete(active.sessionId)
        },
      }

      void pump()

      return { session, approve }
    }

    let closing: Promise<void> | null = null
    const capabilities = capabilitiesFromHandshake(answered)
    const handshake = { protocolVersion: PROTOCOL_VERSION, agentVersion: answered.agentInfo?.version ?? null }

    return {
      capabilities,
      handshake,

      async openSession({ sessionId, cwd, mcpServers, model, reasoningEffort }) {
        // ACP only allows HTTP MCP servers when the agent advertised support.
        if ((mcpServers ?? []).some((server) => server.kind === 'http') && capabilities.extensions.mcpHttp.state !== 'native') {
          throw new UnsupportedRuntimeCapabilityError('extensions.mcpHttp')
        }
        let builder = connection.agent.buildSession(cwd)
        for (const server of mcpServers ?? []) builder = builder.withMcpServer(toAcpMcpServer(server))
        // One budget covers the whole open: session/new and the config options
        // share it, so a slow engine cannot stretch the open past it. The
        // injected clock measures it, so the deadline can be placed exactly.
        const deadline = now() + sessionOpenTimeoutMs
        const remaining = () => deadline - now()
        // A budget that is already gone must not buy another request: the
        // answer would arrive after the open was supposed to be over, and the
        // failure would blame one option instead of the budget that ran out.
        const budgetLeft = (option: string) => {
          const left = remaining()
          if (left <= 0) throw new Error(`the dsh runtime did not open the session within the ${sessionOpenTimeoutMs} ms open budget (while setting ${option})`)
          return left
        }
        // An engine that never answers session/new would otherwise hang the
        // caller — and the host's close — for good. A late answer still means
        // the engine opened a session, so it is closed instead of left behind.
        // The budget is taken before the request is built, so a spent budget
        // sends nothing at all.
        const sessionBudget = budgetLeft('the session')
        const started = builder.start()
        let active: ActiveSession
        try {
          active = await withBudget(
            started,
            sessionBudget,
            `the dsh runtime did not answer session/new within the ${sessionOpenTimeoutMs} ms open budget`,
          )
        } catch (error) {
          void started.then((late) => closeLateSession(late), () => {})
          throw error
        }
        try {
          if (model !== undefined) {
            // The budget is taken before the request is issued: a request sent
            // after the budget ran out would answer too late to be waited for.
            const budget = budgetLeft('the model option')
            await withBudget(
              connection.agent.request(AGENT_METHODS.session_set_config_option, {
                sessionId: active.sessionId,
                configId: 'model',
                value: JSON.stringify([model.provider, model.model]),
              }),
              budget,
              `the dsh runtime did not answer the model option within the ${sessionOpenTimeoutMs} ms open budget`,
            )
          }
          if (reasoningEffort !== undefined) {
            const budget = budgetLeft('the reasoning effort option')
            await withBudget(
              connection.agent.request(AGENT_METHODS.session_set_config_option, {
                sessionId: active.sessionId,
                configId: 'reasoning_effort',
                value: reasoningEffort,
              }),
              budget,
              `the dsh runtime did not answer the reasoning effort option within the ${sessionOpenTimeoutMs} ms open budget`,
            )
          }
        } catch (error) {
          // A half-open session with the wrong model is worse than no session:
          // later prompts would silently run on the engine default.
          await settleWithin(
            connection.agent.request(AGENT_METHODS.session_close, { sessionId: active.sessionId }),
            sessionCloseTimeoutMs,
          )
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
        const probe: RuntimeProbe = {
          ok: true,
          version: connection.handshake?.agentVersion ?? installation.version ?? null,
          agentVersion: connection.handshake?.agentVersion ?? null,
          protocolVersion: connection.handshake?.protocolVersion ?? null,
          error: null,
        }
        await connection.close()
        return probe
      } catch (error) {
        return {
          ok: false,
          version: null,
          agentVersion: null,
          protocolVersion: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    start: connect,
  }
}
