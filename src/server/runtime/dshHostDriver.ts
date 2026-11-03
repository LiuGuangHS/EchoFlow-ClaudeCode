import { dshHostCapabilities } from './capabilitySnapshot.js'
import { projectHostRecord, type HostRecord } from './hostProjection.js'
import {
  RuntimeBusyError,
  UnsupportedRuntimeCapabilityError,
  type InterruptResult,
  type RuntimeConnection,
  type RuntimeDriver,
  type RuntimeEvent,
  type RuntimeInstallation,
  type RuntimeProbe,
  type RuntimeSession,
  type RuntimeStartInput,
  type UserTurn,
} from './contract.js'
import { createEventStamper } from './eventStamp.js'

export type HostRemoteResult<T> = { value: T } | { error: unknown }

export type HostSessionLike = {
  readonly sessionId: string
  beginSubmission(input: { mode: 'queue' | 'steer'; text: string; attachments: unknown[] }): { requestId: string; abandon(): void }
  prompt(content: unknown[], mode: 'queue' | 'steer', signal?: AbortSignal, requestId?: string): Promise<HostRemoteResult<{ accepted: true }>>
  updateQueue(itemId: string, action: unknown): Promise<HostRemoteResult<{ accepted: true }>>
  cancel(): Promise<HostRemoteResult<{ accepted: true }>>
}

export type HostSessionBinding = {
  session: HostSessionLike
  eventSource: {
    getSnapshot(): { entries: Array<{ type: string; event: HostRecord }> }
    subscribe(listener: () => void): () => void
  }
}

export type HostSessionReference = {
  sessionId: string
  binding: HostSessionBinding
  ready: Promise<HostSessionBinding>
  release(): void
}

export type HostClientLike = {
  sessions: {
    list: { getSnapshot(): { items: Array<{ sessionId: string }> } }
    create(options?: { cwd?: string; sessionId?: string }): Promise<string>
    retain(sessionId: string, options: { source: string }): HostSessionReference
  }
  remote: { session: Record<string, unknown> }
  close(): Promise<void>
}

export type DshHostDriverOptions = {
  connectHost: () => Promise<HostClientLike>
}

class HostOpenError extends Error {
  readonly openError: unknown

  constructor(message: string, openError: unknown) {
    super(message)
    this.name = 'HostOpenError'
    this.openError = openError
  }
}

function contentBlocks(turn: UserTurn): unknown[] {
  return [{ type: 'text', text: turn.text }, ...(turn.attachments ?? [])]
}

export function createDshHostDriver(options: DshHostDriverOptions): RuntimeDriver {
  return {
    engineId: 'dsh',
    driverId: 'dsh-host',
    async probe(_installation: RuntimeInstallation): Promise<RuntimeProbe> {
      return { ok: true, version: null, agentVersion: null, protocolVersion: null, error: null }
    },
    async start(input: RuntimeStartInput): Promise<RuntimeConnection> {
      const host = await options.connectHost()
      const opening = new Map<string, Promise<HostSessionReference>>()
      const sessions = new Set<RuntimeSession>()
      let closed = false

      async function retain(sessionId: string, cwd: string, create: boolean): Promise<HostSessionReference> {
        const existing = opening.get(sessionId)
        if (existing) return existing
        const promise = (async () => {
          const nativeId = create ? await host.sessions.create({ cwd, sessionId }) : sessionId
          const reference = host.sessions.retain(nativeId, { source: 'echoflow-runtime' })
          try {
            await reference.ready
            return reference
          } catch (error) {
            reference.release()
            throw new HostOpenError(`dsh Host failed to open session ${nativeId}`, error)
          }
        })()
        opening.set(sessionId, promise)
        try {
          return await promise
        } finally {
          opening.delete(sessionId)
        }
      }

      async function open(input: { sessionId: string; cwd: string; create: boolean; runId: string }): Promise<RuntimeSession> {
        if (closed) throw new Error('dsh Host connection is closed')
        const reference = await retain(input.sessionId, input.cwd, input.create)
        const nativeSessionId = reference.sessionId
        const sessionId = input.sessionId
        const capabilities = dshHostCapabilities()
        const eventStamp = createEventStamper({ sessionId, runId: input.runId })
        let active = false
        let released = false
        let cancelRequested = false
        let closeRequested = false
        let unsubscribe: (() => void) | undefined
        const wakeEvents = new Set<() => void>()

        const recordKey = (record: HostRecord) => `${String(record.eventId ?? record.type)}:${record.seq}:${record.time ?? ''}`
        const readProjected = (state: { cursor: number; seen: Set<string> }) => {
          const snapshot = reference.binding.eventSource.getSnapshot()
          const projected: RuntimeEvent[] = []
          for (const entry of snapshot.entries.slice(state.cursor)) {
            state.cursor += 1
            const key = recordKey(entry.event)
            if (state.seen.has(key)) continue
            state.seen.add(key)
            for (const body of projectHostRecord(entry.event)) projected.push(eventStamp(body))
          }
          return projected
        }

        const waitForEvents = () => new Promise<void>(resolve => {
          wakeEvents.add(resolve)
        })

        const notifyEvents = () => {
          for (const resolve of wakeEvents) resolve()
          wakeEvents.clear()
        }

        const session: RuntimeSession = {
          nativeSessionId,
          capabilities,
          async *send(turn: UserTurn) {
            if (active) throw new RuntimeBusyError()
            const sendState = {
              cursor: reference.binding.eventSource.getSnapshot().entries.length,
              seen: new Set<string>(),
            }
            active = true
            cancelRequested = false
            closeRequested = false
            const controller = new AbortController()
            let handle: ReturnType<HostSessionLike['beginSubmission']> | undefined
            let promptDone = false
            try {
              yield eventStamp({ kind: 'session.state', state: 'running' }, 'echoflow')
              let failure: unknown = null
              const prompt = (async () => {
                try {
                  handle = reference.binding.session.beginSubmission({ mode: 'queue', text: turn.text, attachments: [] })
                  const result = await reference.binding.session.prompt(contentBlocks(turn), 'queue', controller.signal, handle.requestId)
                  if ('error' in result) failure = result.error
                } catch (error) {
                  failure = error
                } finally {
                  promptDone = true
                  notifyEvents()
                }
              })()
              // prompt() only acknowledges the inbox; the turn ends on the Host's turn/end record.
              let sawTurnEnd = false
              while (!sawTurnEnd && failure === null && !cancelRequested && !closeRequested) {
                const events = readProjected(sendState)
                if (events.length) {
                  for (const event of events) {
                    yield event
                    if (event.kind === 'turn.completed') sawTurnEnd = true
                  }
                  continue
                }
                await waitForEvents()
              }
              const remaining = closeRequested || sawTurnEnd ? [] : readProjected(sendState)
              for (const event of remaining) {
                yield event
                if (event.kind === 'turn.completed') sawTurnEnd = true
              }
              if (closeRequested) {
                yield eventStamp({ kind: 'turn.completed', reason: 'error', native: new Error('dsh Host session closed') })
              } else if (cancelRequested) {
                if (!sawTurnEnd) yield eventStamp({ kind: 'turn.completed', reason: 'cancelled', native: null })
              } else if (failure !== null) {
                handle?.abandon()
                yield eventStamp({ kind: 'diagnostic', level: 'error', code: 'host.prompt_failed', message: String(failure), native: failure })
                yield eventStamp({ kind: 'turn.completed', reason: 'error', native: failure })
              } else if (!sawTurnEnd) {
                yield eventStamp({ kind: 'turn.completed', reason: 'end_turn', native: null })
              }
              yield eventStamp({ kind: 'session.state', state: 'idle' }, 'echoflow')
              void prompt
            } finally {
              if (!promptDone) {
                controller.abort()
                handle?.abandon()
              }
              active = false
            }
          },
          onEngineTurn(listener) {
            let stopped = false
            const state = { cursor: 0, seen: new Set<string>() }
            const events = async function* () {
              while (!released && !stopped) {
                const projected = readProjected(state)
                if (projected.length) {
                  for (const event of projected) yield event
                  return
                }
                await waitForEvents()
              }
            }()
            void listener(events)
            return () => {
              stopped = true
              notifyEvents()
            }
          },
          async respondApproval() {
            throw new UnsupportedRuntimeCapabilityError('approval')
          },
          async updateQueue(itemId, action) {
            const result = await reference.binding.session.updateQueue(itemId, action)
            if ('error' in result) throw result.error
          },
          async interrupt(): Promise<InterruptResult> {
            if (!active) return { status: 'not-running', forcedTerminate: false }
            cancelRequested = true
            notifyEvents()
            const result = await reference.binding.session.cancel()
            if ('error' in result) return { status: 'cancelling', residualWork: ['prompt'], forcedTerminate: false }
            return { status: 'cancelled', forcedTerminate: false }
          },
          async close() {
            if (released) return
            released = true
            closeRequested = true
            notifyEvents()
            unsubscribe?.()
            unsubscribe = undefined
            reference.release()
            sessions.delete(session)
          },
        }
        unsubscribe = reference.binding.eventSource.subscribe(notifyEvents)
        sessions.add(session)
        return session
      }

      return {
        capabilities: dshHostCapabilities(),
        async openSession(sessionInput) {
          return open({ ...sessionInput, create: true, runId: input.runId })
        },
        async resumeSession(sessionInput) {
          return open({ ...sessionInput, create: false, runId: input.runId })
        },
        async *listSessions() {
          for (const item of host.sessions.list.getSnapshot().items) yield { nativeSessionId: item.sessionId }
        },
        async close() {
          if (closed) return
          closed = true
          for (const session of [...sessions]) await session.close()
          await host.close()
        },
        onExit() {
          return () => {}
        },
      }
    },
  }
}
