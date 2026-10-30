/**
 * The behavior every runtime driver must show. One suite, run against each
 * driver, so the contract is proven by the code that implements it rather than
 * by a document.
 */
import { describe, expect, test } from 'bun:test'
import {
  RuntimeBusyError,
  UnsupportedRuntimeCapabilityError,
  type RuntimeDriver,
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

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition never became true')
}
