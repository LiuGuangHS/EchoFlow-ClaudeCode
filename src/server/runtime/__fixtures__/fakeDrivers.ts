/**
 * Contract-only stand-ins for a real engine driver.
 *
 * Two shapes exist on purpose: the dsh-shaped fake echoes dsh-looking `native`
 * payloads, the minimal fake carries none. Both must pass the same suite — that
 * is how we know the upper layer never reads an engine field outside `native`.
 */
import { dshBaselineCapabilities } from '../capabilitySnapshot.js'
import {
  RuntimeBusyError,
  UnsupportedRuntimeCapabilityError,
  type RuntimeConnection,
  type RuntimeDriver,
  type RuntimeEvent,
  type RuntimeSession,
  type RuntimeStartInput,
  type UserTurn,
} from '../contract.js'
import { createEventStamper } from '../eventStamp.js'

/**
 * Independent in-memory implementation, only a test fixture. It deliberately
 * uses lazy send acquisition, whole messages, and identical native/product ids.
 * This is not a second production engine or a wrapper around createFakeDriver.
 */
export function createMemoryContractDriver(): RuntimeDriver {
  const capabilities = dshBaselineCapabilities()
  for (const group of Object.values(capabilities)) {
    for (const capability of Object.values(group)) capability.state = 'unsupported'
  }
  capabilities.prompt.text.state = 'native'
  capabilities.prompt.image.state = 'native'
  capabilities.session.close.state = 'native'
  capabilities.session.list.state = 'native'
  capabilities.session.resume.state = 'native'
  return {
    engineId: 'dsh',
    driverId: 'dsh-acp',
    async probe() {
      return { ok: true, version: null, agentVersion: null, protocolVersion: null, error: null }
    },
    async start({ runId }) {
      const sessions = new Map<string, RuntimeSession>()
      const listeners = new Set<(exit: { code: number | null; signal: string | null }) => void>()
      let closed = false
      function sessionFor(sessionId: string, nativeSessionId = sessionId): RuntimeSession {
        const stamp = createEventStamper({ sessionId, runId })
        let active = false
        return {
          nativeSessionId,
          capabilities,
          async *send(input) {
            if (active) throw new RuntimeBusyError()
            if (input.text === 'approval fixture') throw new UnsupportedRuntimeCapabilityError('approval.tool')
            active = true
            try {
              yield stamp({ kind: 'assistant.message', text: input.attachments?.length ? 'image received' : 'whole answer', native: null })
              yield stamp({ kind: 'turn.completed', reason: 'end_turn', native: null })
            } finally {
              active = false
            }
          },
          onEngineTurn() { return () => {} },
          async respondApproval() { throw new UnsupportedRuntimeCapabilityError('approval.tool') },
          async interrupt() { return { status: active ? 'unsupported' : 'not-running', forcedTerminate: false } },
          async close() { active = false },
        }
      }
      return {
        capabilities,
        async openSession({ sessionId }) {
          const session = sessionFor(sessionId)
          sessions.set(session.nativeSessionId, session)
          return session
        },
        async resumeSession({ sessionId, nativeSessionId }) {
          if (!sessions.has(nativeSessionId)) throw new Error('unknown native session')
          return sessionFor(sessionId, nativeSessionId)
        },
        async *listSessions() {
          for (const nativeSessionId of sessions.keys()) yield { nativeSessionId }
        },
        async close() {
          if (closed) return
          closed = true
          for (const session of sessions.values()) await session.close()
          for (const listener of listeners) listener({ code: 0, signal: null })
        },
        onExit(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    },
  }
}

type FakeShape = 'dsh' | 'minimal'

type FakeInput = { sessionId: string; runId: string; nativeSessionId: string }

export function createFakeDshShapedDriver(): RuntimeDriver {
  return createFakeDriver('dsh')
}

export function createFakeMinimalDriver(): RuntimeDriver {
  return createFakeDriver('minimal')
}

function createFakeDriver(shape: FakeShape): RuntimeDriver {
  let sessions = 0

  return {
    engineId: 'dsh',
    driverId: 'dsh-acp',
    async probe() {
      return { ok: true, version: null, agentVersion: null, protocolVersion: null, error: null }
    },
    async start(input: RuntimeStartInput): Promise<RuntimeConnection> {
      return createFakeConnection(shape, input.runId, () => `fake-native-${(sessions += 1)}`)
    },
  }
}

function createFakeConnection(shape: FakeShape, runId: string, nextNativeId: () => string): RuntimeConnection {
  const capabilities = dshBaselineCapabilities()
  const exitListeners = new Set<(exit: { code: number | null; signal: string | null }) => void>()
  let closed = false

  return {
    capabilities,
    async openSession({ sessionId }) {
      return createFakeSession(shape, { sessionId, runId, nativeSessionId: nextNativeId() })
    },
    async resumeSession() {
      throw new UnsupportedRuntimeCapabilityError('session.resume')
    },
    // eslint-disable-next-line require-yield
    async *listSessions() {
      throw new UnsupportedRuntimeCapabilityError('session.list')
    },
    async close() {
      if (closed) return
      closed = true
      for (const listener of exitListeners) listener({ code: 0, signal: null })
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
  }
}

function createFakeSession(shape: FakeShape, input: FakeInput): RuntimeSession {
  const capabilities = dshBaselineCapabilities()
  const stamp = createEventStamper({ sessionId: input.sessionId, runId: input.runId })
  const native = (payload: unknown) => (shape === 'dsh' ? payload : undefined)
  let active = false
  let interruptRequested = false
  let interruptWaiter: (() => void) | null = null
  let pending: { requestId: string; resolve: (optionId: string) => void } | null = null
  const engineListeners = new Set<(events: AsyncIterable<RuntimeEvent>) => void>()

  const state = (value: 'idle' | 'running') => stamp({ kind: 'session.state', state: value }, 'echoflow')
  const completed = (reason: 'end_turn' | 'cancelled') =>
    stamp({ kind: 'turn.completed', reason, native: native({ stopReason: reason }) })

  async function* eventsOf(events: RuntimeEvent[]): AsyncGenerator<RuntimeEvent> {
    for (const event of events) yield event
  }

  function emitEngineTurn() {
    const events = [
      stamp({ kind: 'turn.started', origin: 'engine', native: native({ origin: 'engine' }) }),
      stamp({ kind: 'assistant.delta', text: 'engine note' }),
      completed('end_turn'),
    ]
    // Each listener gets its own iterator over the same script.
    for (const listener of engineListeners) listener(eventsOf(events))
  }

  function waitForInterrupt(): Promise<void> {
    if (interruptRequested) return Promise.resolve()
    return new Promise<void>((resolve) => {
      interruptWaiter = resolve
    })
  }

  async function* turn(text: string): AsyncGenerator<RuntimeEvent> {
    try {
      yield state('running')
      if (text === 'hello') {
        yield stamp({ kind: 'assistant.delta', text: 'one' })
        yield stamp({ kind: 'assistant.delta', text: 'two' })
        yield completed('end_turn')
      } else if (text === 'think') {
        yield stamp({ kind: 'assistant.thinking', text: 'planning' })
        yield stamp({ kind: 'assistant.delta', text: 'answer' })
        yield completed('end_turn')
      } else if (text === 'usage') {
        yield stamp({ kind: 'usage', contextUsed: 10, contextSize: 100, native: native({ used: 10, size: 100 }) })
        yield completed('end_turn')
      } else if (text === 'schedule') {
        yield completed('end_turn')
        // Speak after the user's turn, the way an armed job would.
        setTimeout(emitEngineTurn, 20)
      } else if (text === 'ask') {
        const requestId = `approval-${input.nativeSessionId}`
        let answer!: (optionId: string) => void
        const pendingAnswer = new Promise<string>((resolve) => {
          answer = resolve
        })
        pending = { requestId, resolve: answer }
        yield stamp({
          kind: 'approval.requested',
          request: {
            requestId,
            kind: 'tool',
            title: 'Run a tool',
            details: {},
            options: [{ id: 'allow', label: 'Allow', effect: 'allow-once' }],
            native: native({ toolCallId: 'tool-1' }),
          },
        })
        const optionId = await pendingAnswer
        pending = null
        yield stamp({
          kind: 'approval.resolved',
          requestId,
          decision: { requestId, optionId, decidedBy: 'user', at: Date.now() },
        })
        yield completed('end_turn')
      } else if (text === 'slow') {
        await waitForInterrupt()
        yield completed('cancelled')
      } else {
        yield completed('end_turn')
      }
      yield state('idle')
    } finally {
      // An abandoned stream still ends its turn, exactly like a real driver.
      active = false
    }
  }

  return {
    nativeSessionId: input.nativeSessionId,
    capabilities,
    send(turnInput: UserTurn) {
      if (active) throw new RuntimeBusyError()
      if ((turnInput.attachments?.length ?? 0) > 0 && capabilities.prompt.image.state !== 'native') {
        throw new UnsupportedRuntimeCapabilityError('prompt.image')
      }
      active = true
      return turn(turnInput.text)
    },
    async respondApproval(requestId, optionId) {
      if (pending === null || pending.requestId !== requestId) {
        throw new Error(`unknown approval request: ${requestId}`)
      }
      pending.resolve(optionId)
    },
    async updateQueue() {
      throw new UnsupportedRuntimeCapabilityError('prompt.queue')
    },
    async interrupt() {
      if (!active) return { status: 'not-running', forcedTerminate: false }
      interruptRequested = true
      interruptWaiter?.()
      return { status: 'cancelled', forcedTerminate: false }
    },
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
    async close() {
      active = false
    },
  }
}
