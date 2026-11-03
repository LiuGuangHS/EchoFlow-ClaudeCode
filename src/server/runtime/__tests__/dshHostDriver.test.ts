import { describe, expect, test } from 'bun:test'
import { createDshHostDriver, type HostClientLike, type HostRemoteResult } from '../dshHostDriver.js'
import type { RuntimeEvent } from '../contract.js'
import { projectHostRecord, type HostRecord } from '../hostProjection.js'

function createHost(options: {
  beginSubmissionError?: Error
  promptGate?: { promise: Promise<HostRemoteResult<{ accepted: true }>>; resolve: (result: HostRemoteResult<{ accepted: true }>) => void }
} = {}) {
  const records = new Map<string, HostRecord[]>()
  const listeners = new Map<string, Set<() => void>>()
  const calls: string[] = []
  let nextId = 0
  let beginAttempts = 0
  const client: HostClientLike = {
    sessions: {
      list: { getSnapshot: () => ({ items: [...records.keys()].map(sessionId => ({ sessionId })) }) },
      async create() {
        const id = `host-${++nextId}`
        records.set(id, [])
        listeners.set(id, new Set())
        return id
      },
      retain(sessionId) {
        if (!records.has(sessionId)) throw Object.assign(new Error('missing session'), { openError: 'session/not-found' })
        const source = {
          getSnapshot: () => ({ entries: records.get(sessionId)!.map(event => ({ type: 'event', event })) }),
          subscribe(listener: () => void) {
            listeners.get(sessionId)!.add(listener)
            return () => listeners.get(sessionId)!.delete(listener)
          },
        }
        const session = {
          sessionId,
          beginSubmission: () => {
            beginAttempts += 1
            if (options.beginSubmissionError && beginAttempts === 1) throw options.beginSubmissionError
            return { requestId: `request-${sessionId}`, abandon() {} }
          },
          async prompt() {
            calls.push('prompt')
            push(sessionId, { seq: 1, type: 'assistant/message', time: 1, data: { text: 'hello' } })
            if (options.promptGate) return options.promptGate.promise
            push(sessionId, { seq: 2, type: 'turn/end', time: 2, data: { reason: 'end_turn' } })
            return { value: { accepted: true } }
          },
          async updateQueue(itemId: string, action: unknown) {
            calls.push(`queue:${itemId}:${JSON.stringify(action)}`)
            return { value: { accepted: true } }
          },
          async cancel() {
            calls.push('cancel')
            return { value: { accepted: true } }
          },
        }
        const binding = { session, eventSource: source }
        return {
          sessionId,
          binding,
          ready: Promise.resolve(binding),
          release() {
            records.delete(sessionId)
            listeners.delete(sessionId)
          },
        }
      },
    },
    remote: { session: {} },
    close: async () => {},
  }
  function push(sessionId: string, event: HostRecord) {
    records.get(sessionId)!.push(event)
    for (const listener of listeners.get(sessionId) ?? []) listener()
  }
  return { client, calls, push }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(value => { resolve = value })
  return { promise, resolve }
}

describe('Host record projection', () => {
  test('unwraps durable assistant content and turn reason kind', () => {
    expect(projectHostRecord({ seq: 1, type: 'assistant/message', data: { message: { content: 'hello' } } })).toEqual([
      { kind: 'assistant.message', text: 'hello', native: expect.anything() },
    ])
    expect(projectHostRecord({ seq: 2, type: 'turn/end', data: { reason: { kind: 'end_turn' } } })).toEqual([
      { kind: 'turn.completed', reason: 'end_turn', native: expect.anything() },
    ])
  })
})

describe('dsh Host runtime driver', () => {
  test('creates a session, projects assistant text, and completes the turn', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'product-1', cwd: '/tmp' })
    const events = []
    for await (const event of session.send({ text: 'hello' })) events.push(event)
    expect(events.some(event => event.kind === 'assistant.delta' && event.text === 'hello')).toBe(true)
    expect(events.findLast(event => event.kind === 'turn.completed')).toMatchObject({ kind: 'turn.completed', reason: 'end_turn' })
  })

  test('shares concurrent opens and exposes queue mutation', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const [first, second] = await Promise.all([
      connection.openSession({ sessionId: 'same', cwd: '/tmp' }),
      connection.openSession({ sessionId: 'same', cwd: '/tmp' }),
    ])
    expect(first.nativeSessionId).toBe(second.nativeSessionId)
    await first.updateQueue('item-1', { kind: 'edit', text: 'changed' })
    expect(host.calls[0]).toContain('queue:item-1')
  })

  test('resume retains the native session while events keep the product session id', async () => {
    const host = createHost()
    const nativeSessionId = await host.client.sessions.create({ cwd: '/tmp' })
    const connection = await createDshHostDriver({ connectHost: async () => host.client }).start({ installation: {} as never, runId: 'resume-run', cwd: '/tmp' })
    try {
      const session = await connection.resumeSession({ sessionId: 'product-resumed', nativeSessionId, cwd: '/tmp' })
      expect(session.nativeSessionId).toBe(nativeSessionId)
      const events: RuntimeEvent[] = []
      for await (const event of session.send({ text: 'hello' })) events.push(event)
      expect(events.some(event => event.kind === 'assistant.delta')).toBe(true)
      expect(events.every(event => event.sessionId === 'product-resumed' && event.runId === 'resume-run')).toBe(true)
      expect(host.client.sessions.list.getSnapshot().items).toHaveLength(1)
    } finally {
      await connection.close()
    }
  })

  test('a missing resumed session rejects with an open error', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    await expect(connection.resumeSession({ sessionId: 'missing', nativeSessionId: 'missing', cwd: '/tmp' })).rejects.toMatchObject({ openError: 'session/not-found' })
  })

  test('streams records before prompt resolves', async () => {
    const gate = deferred<HostRemoteResult<{ accepted: true }>>()
    const host = createHost({ promptGate: gate })
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const iterator = session.send({ text: 'hello' })[Symbol.asyncIterator]()
    expect(await iterator.next()).toMatchObject({ value: { kind: 'session.state', state: 'running' }, done: false })
    const streamed = await Promise.race([
      iterator.next(),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 20)),
    ])
    expect(streamed).not.toBe('timeout')
    expect(streamed).toMatchObject({ value: { kind: 'assistant.delta', text: 'hello' }, done: false })
    gate.resolve({ value: { accepted: true } })
  })

  test('beginSubmission failure does not poison the next send', async () => {
    const host = createHost({ beginSubmissionError: new Error('reject') })
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const first: RuntimeEvent[] = []
    for await (const event of session.send({ text: 'hello' })) first.push(event)
    expect(first.some(event => event.kind === 'turn.completed' && event.reason === 'error')).toBe(true)
    const retry: RuntimeEvent[] = []
    for await (const event of session.send({ text: 'retry' })) retry.push(event)
    expect(retry.some(event => event.kind === 'turn.completed' && event.reason === 'end_turn')).toBe(true)
  })

  test('interrupt completes a pending turn as cancelled', async () => {
    const gate = deferred<HostRemoteResult<{ accepted: true }>>()
    const host = createHost({ promptGate: gate })
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const collecting = (async () => {
      const events = []
      for await (const event of session.send({ text: 'hello' })) events.push(event)
      return events
    })()
    await new Promise(resolve => setTimeout(resolve, 0))
    await session.interrupt()
    gate.resolve({ value: { accepted: true } })
    await expect(collecting).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'turn.completed', reason: 'cancelled' })]))
  })

  test('close completes a pending turn with an error', async () => {
    const gate = deferred<HostRemoteResult<{ accepted: true }>>()
    const host = createHost({ promptGate: gate })
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const collecting = (async () => {
      const events = []
      for await (const event of session.send({ text: 'hello' })) events.push(event)
      return events
    })()
    await new Promise(resolve => setTimeout(resolve, 0))
    await session.close()
    gate.resolve({ value: { accepted: true } })
    await expect(collecting).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'turn.completed', reason: 'error' })]))
  })

  test('delivers engine turns to the registered listener', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const received: RuntimeEvent[] = []
    const stop = session.onEngineTurn(async events => {
      for await (const event of events) received.push(event)
    })
    host.push('host-1', { seq: 1, type: 'assistant/message', time: 1, data: { text: 'background' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    stop()
    expect(received.some(event => event.kind === 'assistant.delta' && event.text === 'background')).toBe(true)
  })

  test('background listeners do not consume foreground turn events', async () => {
    const gate = deferred<HostRemoteResult<{ accepted: true }>>()
    const host = createHost({ promptGate: gate })
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const background: RuntimeEvent[] = []
    const stop = session.onEngineTurn(async events => {
      for await (const event of events) background.push(event)
    })
    const iterator = session.send({ text: 'hello' })[Symbol.asyncIterator]()
    await iterator.next()
    const foreground = await iterator.next()
    gate.resolve({ value: { accepted: true } })
    await new Promise(resolve => setTimeout(resolve, 0))
    stop()
    expect(foreground.value).toMatchObject({ kind: 'assistant.delta', text: 'hello' })
    expect(background.some(event => event.kind === 'assistant.delta' && event.text === 'hello')).toBe(true)
  })

  test('stopping an engine listener prevents later delivery', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const received: RuntimeEvent[] = []
    const stop = session.onEngineTurn(async events => {
      for await (const event of events) received.push(event)
    })
    stop()
    host.push('host-1', { seq: 1, type: 'assistant/message', time: 1, data: { text: 'late' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(received).toHaveLength(0)
  })

  test('deduplicates repeated Host records for each consumer', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const iterator = session.send({ text: 'hello' })[Symbol.asyncIterator]()
    await iterator.next()
    host.push('host-1', { seq: 1, type: 'assistant/message', eventId: 'event-1', time: 1, data: { text: 'once' } })
    host.push('host-1', { seq: 1, type: 'assistant/message', eventId: 'event-1', time: 1, data: { text: 'once' } })
    const first = await iterator.next()
    await iterator.return?.()
    expect(first.value).toMatchObject({ kind: 'assistant.delta', text: 'once' })
    expect((await iterator.next()).done).toBe(true)
  })

  test('early iterator return releases the active turn', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    const iterator = session.send({ text: 'hello' })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    await expect(session.send({ text: 'retry' }).next()).resolves.toMatchObject({ value: { kind: 'session.state', state: 'running' }, done: false })
  })

  test('close releases a reference idempotently', async () => {
    const host = createHost()
    const driver = createDshHostDriver({ connectHost: async () => host.client })
    const connection = await driver.start({ installation: {} as never, runId: 'run-1', cwd: '/tmp' })
    const session = await connection.openSession({ sessionId: 'same', cwd: '/tmp' })
    await session.close()
    await session.close()
    expect(host.client.sessions.list.getSnapshot().items).toHaveLength(0)
  })
})
