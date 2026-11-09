/**
 * Spike: a RuntimeDriver over the official Claude Agent SDK's query().
 *
 * The SDK spawns its own Claude Code binary and speaks stream-json to it, so one
 * query() is one engine process: this driver opens one per session. The package
 * is not a dependency yet; `query` is injected and the types below are the slice
 * of @anthropic-ai/claude-agent-sdk 0.3.317 that is read. No SDK type leaves this file.
 */
import { randomUUID } from 'node:crypto'
import {
  RuntimeBusyError,
  RuntimeStartupError,
  UnsupportedRuntimeCapabilityError,
  type ApprovalDecision,
  type Capability,
  type CapabilityState,
  type InterruptResult,
  type RuntimeCapabilities,
  type RuntimeConnection,
  type RuntimeDriver,
  type RuntimeEvent,
  type RuntimeEventBody,
  type RuntimeExit,
  type RuntimeSession,
  type RuntimeStartInput,
  type UserTurn,
} from './contract.js'
import { createEventStamper } from './eventStamp.js'

export type SdkMessage = { type: string; [key: string]: any }
export type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }
export type SdkPermissionResult = { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }
export type SdkOptions = Record<string, any>
export type SdkQueryHandle = AsyncGenerator<SdkMessage, void> & { interrupt(): Promise<unknown> }
export type SdkQuery = (params: { prompt: AsyncIterable<SdkUserMessage>; options: SdkOptions }) => SdkQueryHandle

export type ClaudeAgentSdkDriverOptions = {
  query?: SdkQuery
  now?: () => number
  newApprovalId?: () => string
  /** How long interrupt() waits for the engine to end the turn before it reports `cancelling`. */
  interruptTimeoutMs?: number
}

type TurnReason = Extract<RuntimeEventBody, { kind: 'turn.completed' }>['reason']

type Channel<T> = { push(item: T): void; close(): void; next(): Promise<IteratorResult<T>> }

// shortcut: unbounded, unlike dshDriver's turn channel; share one bounded channel before this leaves the spike
function createChannel<T>(): Channel<T> {
  const buffer: T[] = []
  const waiters: Array<(result: IteratorResult<T>) => void> = []
  let closed = false
  const flush = () => {
    while (waiters.length > 0) {
      if (buffer.length > 0) waiters.shift()!({ done: false, value: buffer.shift()! })
      else if (closed) waiters.shift()!({ done: true, value: undefined })
      else return
    }
  }
  return {
    push(item) {
      if (closed) return
      buffer.push(item)
      flush()
    },
    close() {
      closed = true
      flush()
    },
    next() {
      return new Promise((resolve) => {
        waiters.push(resolve)
        flush()
      })
    },
  }
}

/** Resolves `true` when the promise did not settle in time. */
function timedOut(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms)
    timer.unref?.()
    void promise.then(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

type TurnState = {
  /** A user turn carries session.state events; an engine-started turn does not. */
  user: boolean
  channel: Channel<RuntimeEvent>
  finished: Promise<void>
  settle(): void
  done: boolean
  interrupted: boolean
}

function newTurn(user: boolean): TurnState {
  let settle!: () => void
  const finished = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { user, channel: createChannel(), finished, settle, done: false, interrupted: false }
}

const NOT_DRIVEN = 'the SDK may offer it, but no test drives it in this spike'

/** Claimed only where a test drives it; everything else says why it is not. */
function claudeAgentSdkCapabilities(): RuntimeCapabilities {
  const cap = (state: CapabilityState, note: string): Capability => ({ state, source: 'version-assumption', note })
  const yes = (note: string) => cap('native', note)
  const no = (note = NOT_DRIVEN) => cap('unsupported', note)
  return {
    session: {
      list: no('SDK listSessions() exists; transcripts are the CLI jsonl files, not wired here'),
      resume: no('SDK resume option exists; the contract suite pins resumeSession to throw until a test drives it'),
      fork: no(),
      close: yes('aborts the query; the CLI child exits after stdin EOF'),
      delete: no(),
    },
    prompt: {
      text: yes('streaming-input user message'),
      image: no('the SDK takes image blocks; send() rejects attachments until a test drives them'),
      embeddedResource: no('send() rejects references'),
      steer: no('the SDK has message priority; not driven'),
      queue: no('one active turn; a second send() throws RuntimeBusyError'),
    },
    config: {
      model: no('Options.model is fixed at query() start; provider routing is not mapped, so openSession rejects it'),
      reasoningEffort: no('same as model; rejected at openSession'),
      permissionMode: no('fixed to default; SDK setPermissionMode exists but is not driven'),
    },
    approval: {
      tool: yes('canUseTool with allow-once and deny only'),
      command: no('shell commands arrive as the Bash tool request'),
      fileChange: no('file edits arrive as tool requests'),
      userInput: no('AskUserQuestion is a tool request; not mapped to user-input'),
      network: no(),
    },
    commands: {
      catalog: no('the init message lists slash_commands; not projected'),
      execute: no(),
    },
    subagent: {
      delegate: no('subagent stream events are dropped'),
      control: no(),
    },
    jobs: { list: no(), output: no(), kill: no() },
    checkpoints: { session: no(), files: no() },
    extensions: {
      mcpStdio: no('SDK mcpServers exists; not mapped, so openSession rejects specs'),
      mcpHttp: no('SDK mcpServers exists; not mapped, so openSession rejects specs'),
      hooks: no(),
      skills: no(),
      plugins: no(),
      schedule: no(),
      teams: no(),
    },
    observability: {
      usage: yes('result.usage; a per-turn sum, so contextUsed over-counts a multi-request turn'),
      cost: no('total_cost_usd exists; not projected'),
      diffs: no(),
      contextPressure: no('result.usage is not the live context window'),
      stats: no(),
    },
  }
}

function projectMessage(message: SdkMessage): RuntimeEventBody | null {
  switch (message.type) {
    case 'stream_event': {
      // subagent output is not the main answer
      if (message.parent_tool_use_id != null) return null
      const delta = message.event?.type === 'content_block_delta' ? message.event.delta : null
      if (delta?.type === 'text_delta') return { kind: 'assistant.delta', text: String(delta.text) }
      if (delta?.type === 'thinking_delta') return { kind: 'assistant.thinking', text: String(delta.thinking) }
      return null
    }
    // shortcut: whole assistant/user/system messages (tool_use, tool_result, init) are not projected, so no tool.* events; add when a test drives them
    case 'assistant':
    case 'user':
    case 'system':
      return null
    default:
      return { kind: 'diagnostic', level: 'warn', code: 'sdk.unprojected_message', message: `unprojected SDK message type: ${message.type}`, native: message }
  }
}

function usageBody(message: SdkMessage): RuntimeEventBody | null {
  const usage = message.usage
  if (usage == null) return null
  const windows = Object.values<any>(message.modelUsage ?? {})
    .map((entry) => entry?.contextWindow)
    .filter((size) => typeof size === 'number')
  return {
    kind: 'usage',
    contextUsed: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    ...(windows.length > 0 ? { contextSize: Math.max(...windows) } : {}),
    native: { usage, modelUsage: message.modelUsage, totalCostUsd: message.total_cost_usd },
  }
}

function successReason(stopReason: unknown): TurnReason {
  return stopReason === 'max_tokens' || stopReason === 'refusal' ? stopReason : 'end_turn'
}

export function createClaudeAgentSdkDriver(options: ClaudeAgentSdkDriverOptions = {}): RuntimeDriver {
  const now = options.now ?? Date.now
  const newApprovalId = options.newApprovalId ?? (() => randomUUID())
  const interruptTimeoutMs = options.interruptTimeoutMs ?? 5_000

  return {
    engineId: 'claude-code',
    driverId: 'claude-agent-sdk',

    async probe(installation) {
      // shortcut: reports only that a query() was injected; it does not launch the CLI. Spawn a real handshake when this leaves the spike.
      const ok = options.query !== undefined
      return { ok, version: installation.version ?? null, agentVersion: null, protocolVersion: null, error: ok ? null : 'no SDK query() was injected' }
    },

    async start(input: RuntimeStartInput): Promise<RuntimeConnection> {
      const query = options.query
      if (query === undefined) throw new RuntimeStartupError('the Claude Agent SDK is not available: no query() was injected', '')
      const sessions = new Set<RuntimeSession>()
      const exitListeners = new Set<(exit: RuntimeExit) => void>()
      let closing: Promise<void> | null = null

      function createSession(sessionId: string, cwd: string, onClosed: () => void): RuntimeSession {
        const nativeSessionId = randomUUID()
        const stamp = createEventStamper({ sessionId, runId: input.runId, now })
        const abort = new AbortController()
        const prompts = createChannel<SdkUserMessage>()
        const pending = new Map<string, { state: TurnState; input: Record<string, unknown>; resolve(result: SdkPermissionResult): void }>()
        const engineListeners = new Set<(events: AsyncIterable<RuntimeEvent>) => void | Promise<void>>()
        let activeTurn: TurnState | null = null
        let engineTurn: TurnState | null = null
        let closed = false
        let engineGone = false

        const diagnostic = (code: string, message: string, native?: unknown) =>
          stamp({ kind: 'diagnostic', level: 'error', code, message, ...(native === undefined ? {} : { native }) })

        function resolveApproval(requestId: string, optionId: string | null, decidedBy: ApprovalDecision['decidedBy']) {
          const entry = pending.get(requestId)
          if (entry === undefined) return
          pending.delete(requestId)
          entry.state.channel.push(stamp({ kind: 'approval.resolved', requestId, decision: { requestId, optionId, decidedBy, at: now() } }))
          entry.resolve(
            optionId === 'allow'
              ? { behavior: 'allow', updatedInput: entry.input }
              : { behavior: 'deny', message: optionId === null ? 'The turn ended before this tool call was approved.' : 'The user denied this tool call.' },
          )
        }

        function completeTurn(state: TurnState, reason: TurnReason, native: unknown, finalState: 'idle' | 'closed' = 'idle') {
          if (state.done) return
          // Answer waiting approvals first so approval.resolved precedes turn.completed.
          for (const [requestId, entry] of [...pending]) if (entry.state === state) resolveApproval(requestId, null, 'cancelled')
          state.done = true
          state.channel.push(stamp({ kind: 'turn.completed', reason, native }))
          if (state.user) state.channel.push(stamp({ kind: 'session.state', state: finalState }, 'echoflow'))
          state.channel.close()
          if (activeTurn === state) activeTurn = null
          if (engineTurn === state) engineTurn = null
          state.settle()
        }

        function engineFailed(error: unknown) {
          if (engineGone) return
          engineGone = true
          abort.abort()
          prompts.close()
          const state = activeTurn ?? engineTurn
          if (state === null) return
          state.channel.push(diagnostic('sdk.engine_failed', error instanceof Error ? error.message : String(error), error))
          state.channel.push(stamp({ kind: 'engine.exited', code: null, signal: null }))
          completeTurn(state, 'error', null, 'closed')
        }

        /** A listener that throws or rejects must not take the pump down with it. */
        function notifyEngineListener(listener: (events: AsyncIterable<RuntimeEvent>) => void | Promise<void>, stream: AsyncIterable<RuntimeEvent>, state: TurnState) {
          const report = (error: unknown) =>
            state.channel.push(
              stamp({ kind: 'diagnostic', level: 'warn', code: 'runtime.engine_listener_failed', message: error instanceof Error ? error.message : String(error), native: error }),
            )
          try {
            const result = listener(stream)
            if (result && typeof (result as Promise<void>).then === 'function') void (result as Promise<void>).then(undefined, report)
          } catch (error) {
            report(error)
          }
        }

        function startEngineTurn(first: SdkMessage): TurnState | null {
          // A turn started with no listener is dropped, as the contract says.
          if (engineListeners.size === 0) return null
          const state = newTurn(false)
          engineTurn = state
          state.channel.push(stamp({ kind: 'turn.started', origin: 'engine', native: first }))
          const stream: AsyncIterable<RuntimeEvent> = { [Symbol.asyncIterator]: () => ({ next: () => state.channel.next() }) }
          for (const listener of engineListeners) notifyEngineListener(listener, stream, state)
          return state
        }

        function onResult(message: SdkMessage) {
          const state = activeTurn ?? engineTurn
          if (state === null) return
          const usage = usageBody(message)
          if (usage !== null) state.channel.push(stamp(usage))
          const failed = message.is_error === true || message.subtype !== 'success'
          if (failed && !state.interrupted) {
            state.channel.push(diagnostic('sdk.turn_failed', String(message.result || (message.errors ?? []).join('; ') || message.subtype), message))
          }
          completeTurn(state, failed ? (state.interrupted ? 'cancelled' : 'error') : successReason(message.stop_reason), message)
        }

        function onMessage(message: SdkMessage) {
          if (message.type === 'result') return onResult(message)
          const body = projectMessage(message)
          if (body === null) return
          const state = activeTurn ?? engineTurn ?? startEngineTurn(message)
          state?.channel.push(stamp(body))
        }

        function approve(
          toolName: string,
          toolInput: Record<string, unknown>,
          extra: { signal?: AbortSignal; toolUseID?: string; title?: string },
        ): Promise<SdkPermissionResult> {
          const state = activeTurn ?? engineTurn
          // Fail closed: a request with no turn to show it in can never be answered.
          if (state === null) return Promise.resolve({ behavior: 'deny', message: 'No turn is waiting for this approval.' })
          const requestId = newApprovalId()
          return new Promise((resolve) => {
            pending.set(requestId, { state, input: toolInput, resolve })
            extra.signal?.addEventListener('abort', () => resolveApproval(requestId, null, 'cancelled'), { once: true })
            state.channel.push(
              stamp({
                kind: 'approval.requested',
                request: {
                  requestId,
                  kind: 'tool',
                  title: extra.title ?? `Run ${toolName}`,
                  details: { toolName, input: toolInput },
                  options: [
                    { id: 'allow', label: 'Allow', effect: 'allow-once' },
                    { id: 'deny', label: 'Deny', effect: 'deny' },
                  ],
                  defaultOptionId: 'deny',
                  native: { toolName, input: toolInput, toolUseID: extra.toolUseID },
                },
              }),
            )
          })
        }

        let handle: SdkQueryHandle
        try {
          handle = query({
            prompt: { [Symbol.asyncIterator]: () => ({ next: () => prompts.next() }) },
            options: {
              cwd,
              env: { ...process.env, ...input.env },
              sessionId: nativeSessionId,
              permissionMode: 'default',
              includePartialMessages: true,
              canUseTool: approve,
              abortController: abort,
              ...(input.installation.executablePath ? { pathToClaudeCodeExecutable: input.installation.executablePath } : {}),
            },
          })
        } catch (error) {
          throw new RuntimeStartupError(error instanceof Error ? error.message : String(error), '')
        }

        async function interruptTurn(state: TurnState): Promise<InterruptResult> {
          if (activeTurn !== state) return { status: 'not-running', forcedTerminate: false }
          state.interrupted = true
          // Not awaited: an engine that never answers must not outlast the budget below.
          void handle.interrupt().catch(() => {})
          if (await timedOut(state.finished, interruptTimeoutMs)) {
            // The turn is still running; claiming it stopped would make the next send race it.
            return { status: 'cancelling', residualWork: ['turn'], forcedTerminate: false }
          }
          return { status: 'cancelled', forcedTerminate: false }
        }

        function send(turn: UserTurn): AsyncIterable<RuntimeEvent> {
          if (closed) throw new Error('the session is closed')
          if (activeTurn !== null) throw new RuntimeBusyError()
          if (engineTurn !== null) throw new RuntimeBusyError('the engine is running a turn of its own')
          if ((turn.attachments?.length ?? 0) > 0) throw new UnsupportedRuntimeCapabilityError('prompt.image')
          if ((turn.references?.length ?? 0) > 0) throw new UnsupportedRuntimeCapabilityError('prompt.embeddedResource')
          const state = newTurn(true)
          activeTurn = state
          state.channel.push(stamp({ kind: 'session.state', state: 'running' }, 'echoflow'))
          if (engineGone) {
            state.channel.push(diagnostic('sdk.engine_gone', 'the Claude Code engine is no longer running'))
            completeTurn(state, 'error', null, 'closed')
          } else {
            prompts.push({ type: 'user', message: { role: 'user', content: turn.text }, parent_tool_use_id: null })
          }
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => state.channel.next(),
                async return() {
                  // Dropping the stream cancels this turn only, never a later one.
                  await interruptTurn(state)
                  return { done: true as const, value: undefined }
                },
              }
            },
          }
        }

        async function pump() {
          try {
            for (;;) {
              const step = await handle.next()
              if (closed) return
              if (step.done) return engineFailed(new Error('the SDK stream ended without a result'))
              onMessage(step.value as SdkMessage)
            }
          } catch (error) {
            if (!closed) engineFailed(error)
          }
        }

        void pump()

        return {
          nativeSessionId,
          capabilities: claudeAgentSdkCapabilities(),
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
            if (!pending.has(requestId)) throw new Error(`unknown approval request: ${requestId}`)
            if (optionId !== 'allow' && optionId !== 'deny') throw new Error(`unknown approval option: ${optionId}`)
            resolveApproval(requestId, optionId, 'user')
          },
          async interrupt(): Promise<InterruptResult> {
            // shortcut: an engine-started turn is not interruptible here; add when a test drives it
            return activeTurn === null ? { status: 'not-running', forcedTerminate: false } : interruptTurn(activeTurn)
          },
          async close() {
            if (closed) return
            closed = true
            abort.abort()
            prompts.close()
            void Promise.resolve(handle.return(undefined)).catch(() => {})
            for (const state of [activeTurn, engineTurn]) if (state !== null) completeTurn(state, 'cancelled', null, 'closed')
            onClosed()
          },
        }
      }

      return {
        capabilities: claudeAgentSdkCapabilities(),

        async openSession({ sessionId, cwd, model, reasoningEffort, mcpServers }) {
          if (closing !== null) throw new Error('the connection is closed')
          // Rejected, not dropped: a silent downgrade is what the contract forbids.
          if (model !== undefined) throw new UnsupportedRuntimeCapabilityError('config.model')
          if (reasoningEffort !== undefined) throw new UnsupportedRuntimeCapabilityError('config.reasoningEffort')
          const server = mcpServers?.[0]
          if (server !== undefined) throw new UnsupportedRuntimeCapabilityError(server.kind === 'http' ? 'extensions.mcpHttp' : 'extensions.mcpStdio')
          const session = createSession(sessionId, cwd, () => sessions.delete(session))
          sessions.add(session)
          return session
        },

        async resumeSession() {
          throw new UnsupportedRuntimeCapabilityError('session.resume')
        },

        // eslint-disable-next-line require-yield
        async *listSessions() {
          throw new UnsupportedRuntimeCapabilityError('session.list')
        },

        close() {
          // shortcut: one engine per session, so a session's engine death surfaces as engine.exited in its stream; onExit fires only from close()
          closing ??= (async () => {
            await Promise.all([...sessions].map((session) => session.close()))
            for (const listener of exitListeners) listener({ code: 0, signal: null })
          })()
          return closing
        },

        onExit(listener) {
          exitListeners.add(listener)
          return () => {
            exitListeners.delete(listener)
          }
        },
      }
    },
  }
}
