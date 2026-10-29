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
      return { ok: true, version: null, protocolVersion: null, error: null }
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

  const state = (value: 'idle' | 'running') => stamp({ kind: 'session.state', state: value }, 'echoflow')
  const completed = (reason: 'end_turn' | 'cancelled') =>
    stamp({ kind: 'turn.completed', reason, native: native({ stopReason: reason }) })

  function waitForInterrupt(): Promise<void> {
    if (interruptRequested) return Promise.resolve()
    return new Promise<void>((resolve) => {
      interruptWaiter = resolve
    })
  }

  async function* turn(text: string): AsyncGenerator<RuntimeEvent> {
    yield state('running')
    if (text === 'hello') {
      yield stamp({ kind: 'assistant.delta', text: 'one' })
      yield stamp({ kind: 'assistant.delta', text: 'two' })
      yield completed('end_turn')
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
    active = false
  }

  return {
    nativeSessionId: input.nativeSessionId,
    capabilities,
    send(turnInput: UserTurn) {
      if (active) throw new RuntimeBusyError()
      active = true
      return turn(turnInput.text)
    },
    async respondApproval(requestId, optionId) {
      if (pending === null || pending.requestId !== requestId) {
        throw new Error(`unknown approval request: ${requestId}`)
      }
      pending.resolve(optionId)
    },
    async interrupt() {
      if (!active) return { status: 'not-running', forcedTerminate: false }
      interruptRequested = true
      interruptWaiter?.()
      return { status: 'cancelled', forcedTerminate: false }
    },
    async close() {
      active = false
    },
  }
}
