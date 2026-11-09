/**
 * Shared contract checks and a separate exact regression for the scripted fakes.
 * Test fixtures demonstrate substitutability, not production engine support.
 */
import { describe, expect, test } from 'bun:test'
import {
  RuntimeBusyError,
  UnsupportedRuntimeCapabilityError,
  type RuntimeDriver,
  type RuntimeEvent,
  type RuntimeSession,
} from '../contract.js'

export async function runScriptedTurn(session: RuntimeSession, text: string) {
  const events = []
  for await (const event of session.send({ text })) events.push(event)
  return events
}

export function runRuntimeContractSuite(label: string, makeDriver: () => RuntimeDriver): void {
  async function open() {
    const connection = await makeDriver().start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: '/tmp' })
    return { connection, session }
  }

  describe(`runtime contract: ${label}`, () => {
    test('start returns a connection with an explicit capability snapshot', async () => {
      const connection = await makeDriver().start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
      const leaves = Object.values(connection.capabilities).flatMap((group) => Object.values(group))
      expect(leaves.length).toBeGreaterThan(0)
      for (const leaf of leaves) {
        expect(['native', 'unsupported']).toContain(leaf.state)
        expect(['handshake', 'protocol-baseline', 'version-assumption', 'extension']).toContain(leaf.source)
      }
      await connection.close()
    })

    test('openSession returns a native session id distinct from the product id', async () => {
      const { connection, session } = await open()
      expect(session.nativeSessionId).not.toBe('session-1')
      expect(session.nativeSessionId.length).toBeGreaterThan(0)
      await connection.close()
    })

    test('one turn yields stamped events with consecutive seq and ends with turn.completed', async () => {
      const { connection, session } = await open()
      const events = await runScriptedTurn(session, 'hello')
      expect(events.map((event) => event.kind)).toEqual([
        'session.state',
        'assistant.delta',
        'assistant.delta',
        'turn.completed',
        'session.state',
      ])
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
      expect(events.every((event) => event.sessionId === 'session-1' && event.runId === 'run-1')).toBe(true)
      expect(events.every((event) => typeof event.eventId === 'string' && event.eventId.length > 0)).toBe(true)
      expect(events[3]).toMatchObject({ kind: 'turn.completed', reason: 'end_turn' })
      await connection.close()
    })

    test('a second send while a turn is active throws RuntimeBusyError', async () => {
      const { connection, session } = await open()
      const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
      await iterator.next()
      expect(() => session.send({ text: 'hello' })).toThrow(RuntimeBusyError)
      await session.interrupt()
      await connection.close()
    })

    test('an approval request is answered by request id', async () => {
      const { connection, session } = await open()
      const iterator = session.send({ text: 'ask' })[Symbol.asyncIterator]()
      await iterator.next()
      const requested = await iterator.next()
      const request = requested.value as { kind: string; request: { requestId: string } }
      expect(request.kind).toBe('approval.requested')
      await session.respondApproval(request.request.requestId, 'allow')
      const resolved = await iterator.next()
      expect(resolved.value).toMatchObject({
        kind: 'approval.resolved',
        requestId: request.request.requestId,
        decision: { optionId: 'allow', decidedBy: 'user' },
      })
      await connection.close()
    })

    test('respondApproval with an unknown request id rejects', async () => {
      const { connection, session } = await open()
      await expect(session.respondApproval('missing', 'allow')).rejects.toThrow('unknown approval request')
      await connection.close()
    })

    test('interrupt with no active turn reports not-running', async () => {
      const { connection, session } = await open()
      expect(await session.interrupt()).toMatchObject({ status: 'not-running', forcedTerminate: false })
      await connection.close()
    })

    test('resumeSession throws UnsupportedRuntimeCapabilityError', async () => {
      const { connection } = await open()
      await expect(
        connection.resumeSession({ sessionId: 'session-1', nativeSessionId: 'x', cwd: '/tmp' }),
      ).rejects.toBeInstanceOf(UnsupportedRuntimeCapabilityError)
      await connection.close()
    })

    test('close is idempotent and onExit fires once', async () => {
      const { connection } = await open()
      const exits: unknown[] = []
      connection.onExit((exit) => exits.push(exit))
      await connection.close()
      await connection.close()
      expect(exits).toHaveLength(1)
    })

    test('abandoning a turn stream cancels only that turn', async () => {
      const { connection, session } = await open()
      const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
      await iterator.next()
      await iterator.return?.(undefined)
      const events = await runScriptedTurn(session, 'hello')
      expect(events.map((event) => event.kind)).toEqual([
        'session.state',
        'assistant.delta',
        'assistant.delta',
        'turn.completed',
        'session.state',
      ])
      await connection.close()
    })

    test('an engine-initiated turn is delivered to onEngineTurn, never to a later send', async () => {
      const { connection, session } = await open()
      const engineTurns: string[][] = []
      session.onEngineTurn(async (events) => {
        const kinds: string[] = []
        for await (const event of events) kinds.push(event.kind)
        engineTurns.push(kinds)
      })
      await runScriptedTurn(session, 'schedule')
      await waitUntil(() => engineTurns.length === 1)
      expect(engineTurns[0]).toEqual(['turn.started', 'assistant.delta', 'turn.completed'])
      const events = await runScriptedTurn(session, 'hello')
      expect(events.filter((event) => event.kind === 'assistant.delta')).toHaveLength(2)
      await connection.close()
    })

    test('send rejects attachments when prompt.image is unsupported', async () => {
      const { connection, session } = await open()
      expect(() =>
        session.send({ text: 'hello', attachments: [{ kind: 'image', mimeType: 'image/png', dataBase64: 'AA==' }] }),
      ).toThrow(UnsupportedRuntimeCapabilityError)
      await connection.close()
    })

    test('thinking events precede the message text of the same turn', async () => {
      const { connection, session } = await open()
      const kinds = (await runScriptedTurn(session, 'think')).map((event) => event.kind)
      expect(kinds).toEqual(['session.state', 'assistant.thinking', 'assistant.delta', 'turn.completed', 'session.state'])
      await connection.close()
    })

    test('usage carries context numbers when the engine reports them', async () => {
      const { connection, session } = await open()
      const usage = (await runScriptedTurn(session, 'usage')).find((event) => event.kind === 'usage')
      expect(usage).toMatchObject({ contextUsed: 10, contextSize: 100 })
      await connection.close()
    })

    test('closing a session twice is idempotent', async () => {
      const { connection, session } = await open()
      await session.close()
      await session.close()
      await connection.close()
    })
  })
}

/** Inputs are fixture scenarios, not magic prompts required of real engines. */
export type RuntimeContractScenarios = {
  text: string
  approval: string
  usage: string
}

export function runRuntimeCapabilitySuite(
  label: string,
  makeDriver: () => RuntimeDriver,
  scenarios: RuntimeContractScenarios,
): void {
  async function withSession(check: (session: RuntimeSession, connection: Awaited<ReturnType<RuntimeDriver['start']>>) => Promise<void>) {
    const connection = await makeDriver().start({ installation: {} as never, runId: 'run-contract', cwd: '/tmp' })
    try {
      const session = await connection.openSession({ sessionId: 'product-session', cwd: '/tmp' })
      await check(session, connection)
    } finally {
      await connection.close()
    }
  }

  describe(`generic runtime contract: ${label}`, () => {
    test('connection and session expose explicit capabilities and an opaque native id', async () => {
      await withSession(async (session, connection) => {
        expect(typeof session.nativeSessionId).toBe('string')
        expect(session.nativeSessionId.length).toBeGreaterThan(0)
        // Native and product identifiers have different roles, not necessarily different bytes.
        for (const snapshot of [session.capabilities, connection.capabilities]) {
          for (const group of Object.values(snapshot)) {
            for (const capability of Object.values(group)) {
              expect(['native', 'unsupported']).toContain(capability.state)
              expect(['handshake', 'protocol-baseline', 'version-assumption', 'extension']).toContain(capability.source)
            }
          }
        }
      })
    })

    test('text support is honest and events remain stamped across turns without prescribing chunks', async () => {
      await withSession(async (session) => {
        if (session.capabilities.prompt.text.state === 'unsupported') {
          await expectUnsupported(() => runScriptedTurn(session, scenarios.text), 'prompt.text')
          return
        }
        const first = await runScriptedTurn(session, scenarios.text)
        const second = await runScriptedTurn(session, scenarios.text)
        for (const events of [first, second]) {
          expect(events.filter((event) => event.kind === 'turn.completed')).toHaveLength(1)
          expect(events.some((event) => event.kind === 'assistant.delta' || event.kind === 'assistant.message')).toBe(true)
        }
        assertStampedEvents([...first, ...second])
      })
    })

    test('busy is enforced while consuming a turn and releasing an iterator permits the next turn', async () => {
      await withSession(async (session) => {
        if (session.capabilities.prompt.text.state === 'unsupported') return
        const iterator = session.send({ text: scenarios.text })[Symbol.asyncIterator]()
        try {
          expect((await iterator.next()).done).not.toBe(true)
          // send may throw eagerly or on the first next() of a lazy iterator.
          await expect((async () => {
            for await (const _event of session.send({ text: scenarios.text })) { /* consume */ }
          })()).rejects.toBeInstanceOf(RuntimeBusyError)
        } finally {
          await iterator.return?.()
        }
        expect((await runScriptedTurn(session, scenarios.text)).some((event) => event.kind === 'turn.completed')).toBe(true)
      })
    })

    test('list and resume agree with their connection capability claims', async () => {
      await withSession(async (session, connection) => {
        const list = async () => {
          const items = []
          for await (const item of connection.listSessions({ cwd: '/tmp' })) items.push(item)
          return items
        }
        if (connection.capabilities.session.list.state === 'unsupported') {
          await expectUnsupported(list, 'session.list')
        } else {
          expect((await list()).some((item) => item.nativeSessionId === session.nativeSessionId)).toBe(true)
        }
        const resume = () => connection.resumeSession({
          sessionId: 'resumed-product', nativeSessionId: session.nativeSessionId, cwd: '/tmp',
        })
        if (connection.capabilities.session.resume.state === 'unsupported') {
          await expectUnsupported(resume, 'session.resume')
        } else {
          const resumed = await resume()
          expect(resumed.nativeSessionId).toBe(session.nativeSessionId)
          if (resumed.capabilities.prompt.text.state === 'native') {
            const events = await runScriptedTurn(resumed, scenarios.text)
            expect(events.every((event) => event.sessionId === 'resumed-product')).toBe(true)
          }
          await resumed.close()
        }
      })
    })

    test('image support accepts an image or rejects explicitly, never silently downgrades', async () => {
      await withSession(async (session) => {
        const image = async () => {
          const events = []
          for await (const event of session.send({ text: scenarios.text, attachments: [
            { kind: 'image', mimeType: 'image/png', dataBase64: 'AA==' },
          ] })) events.push(event)
          return events
        }
        if (session.capabilities.prompt.image.state === 'unsupported') {
          await expectUnsupported(image, 'prompt.image')
        } else {
          expect((await image()).some((event) => event.kind === 'turn.completed')).toBe(true)
        }
      })
    })

    test('a tool approval scenario follows the advertised capability', async () => {
      await withSession(async (session) => {
        if (session.capabilities.approval.tool.state === 'unsupported') {
          await expectUnsupported(() => runScriptedTurn(session, scenarios.approval), 'approval.tool')
          return
        }
        const events: RuntimeEvent[] = []
        for await (const event of session.send({ text: scenarios.approval })) {
          events.push(event)
          if (event.kind === 'approval.requested') {
            expect(event.request.kind).toBe('tool')
            const option = event.request.options[0]
            expect(option).toBeDefined()
            await session.respondApproval(event.request.requestId, option!.id)
          }
        }
        const requested = events.find((event) => event.kind === 'approval.requested')
        expect(requested).toBeDefined()
        expect(events.some((event) => event.kind === 'approval.resolved' && event.requestId === requested!.request.requestId)).toBe(true)
        expect(events.some((event) => event.kind === 'turn.completed')).toBe(true)
      })
    })

    test('usage is observed when advertised and not emitted when unsupported', async () => {
      await withSession(async (session) => {
        const events = await runScriptedTurn(session, scenarios.usage)
        const usage = events.filter((event) => event.kind === 'usage')
        if (session.capabilities.observability.usage.state === 'native') {
          expect(usage.length).toBeGreaterThan(0)
        } else {
          expect(usage).toHaveLength(0)
        }
      })
    })
  })
}

async function expectUnsupported(operation: () => Promise<unknown>, capability: string) {
  try {
    await operation()
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedRuntimeCapabilityError)
    expect((error as Error).message).toContain(capability)
    return
  }
  throw new Error(`expected explicit unsupported error for ${capability}`)
}

function assertStampedEvents(events: RuntimeEvent[]) {
  expect(events.length).toBeGreaterThan(0)
  expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length)
  let previous = 0
  for (const event of events) {
    expect(event.sessionId).toBe('product-session')
    expect(event.runId).toBe('run-contract')
    expect(event.eventId.length).toBeGreaterThan(0)
    expect(Number.isInteger(event.seq)).toBe(true)
    expect(event.seq).toBeGreaterThan(previous)
    expect(Number.isFinite(event.at)).toBe(true)
    expect(['engine', 'echoflow']).toContain(event.source)
    previous = event.seq
  }
}

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition never became true')
}
