import { describe, expect, test } from 'bun:test'
import { createFakeDshShapedDriver } from '../__fixtures__/fakeDrivers.js'
import {
  UnsupportedRuntimeCapabilityError,
  type RuntimeDriver,
  type RuntimeInstallation,
} from '../contract.js'
import {
  RuntimeHostClosedError,
  RuntimeSessionAlreadyOpenError,
  UnknownRuntimeDriverError,
  UnknownRuntimeInstallationError,
  UnknownRuntimeSessionError,
  createRuntimeHost,
} from '../controlPlane.js'

const installation: RuntimeInstallation = {
  installationId: 'inst-1',
  engineId: 'dsh',
  driverId: 'dsh-acp',
  distribution: 'bundled',
  location: { kind: 'local' },
  executablePath: '/bin/true',
  version: null,
}

async function hostWithSession(driver: RuntimeDriver = createFakeDshShapedDriver()) {
  const host = createRuntimeHost()
  host.registerDriver(driver)
  await host.connect({ installation, cwd: '/tmp' })
  const session = await host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' })
  return { host, session }
}

async function collect(iterable: AsyncIterable<{ kind: string }>) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('runtime control plane', () => {
  test('send routes to the session opened for that product id', async () => {
    const { host } = await hostWithSession()
    const events = await collect(host.send('session-1', { text: 'hello' }))
    expect(events.map((event) => event.kind)).toEqual([
      'session.state',
      'assistant.delta',
      'assistant.delta',
      'turn.completed',
      'session.state',
    ])
    await host.close()
  })

  test('unknown session ids are rejected, never routed by accident', async () => {
    const { host } = await hostWithSession()
    expect(() => host.send('session-404', { text: 'hello' })).toThrow(UnknownRuntimeSessionError)
    expect(() => host.getSession('session-404')).toThrow(UnknownRuntimeSessionError)
    expect(() => host.respondApproval('session-404', 'approval-1', 'allow')).toThrow(UnknownRuntimeSessionError)
    await host.close()
  })

  test('a second connect for the same installation closes the first connection', async () => {
    const base = createFakeDshShapedDriver()
    let closed = 0
    const driver: RuntimeDriver = {
      ...base,
      async start(input) {
        const connection = await base.start(input)
        return {
          ...connection,
          async close() {
            closed += 1
            await connection.close()
          },
        }
      },
    }
    const host = createRuntimeHost()
    host.registerDriver(driver)
    await host.connect({ installation, cwd: '/tmp' })
    await host.connect({ installation, cwd: '/tmp' })
    expect(closed).toBe(1)
    await host.close()
  })

  test('a late exit from the replaced connection leaves the new one usable', async () => {
    const exits: Array<(exit: { code: number | null; signal: string | null }) => void> = []
    const base = createFakeDshShapedDriver()
    const driver: RuntimeDriver = {
      ...base,
      async start(input) {
        const connection = await base.start(input)
        return {
          ...connection,
          onExit(listener) {
            exits.push(listener)
            // A real child process cannot be unsubscribed from: its exit may
            // arrive after the connection was replaced.
            return () => {}
          },
        }
      },
    }
    const host = createRuntimeHost()
    host.registerDriver(driver)
    await host.connect({ installation, cwd: '/tmp' })
    const second = await host.connect({ installation, cwd: '/tmp' })
    await host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' })
    exits[0]?.({ code: 1, signal: null })
    expect(host.capabilitiesOf('session-1')).toBeDefined()
    await second.connection.close()
    await host.close()
  })

  test('concurrent connects for one installation leave no connection the host cannot close', async () => {
    const base = createFakeDshShapedDriver()
    let started = 0
    let closed = 0
    const driver: RuntimeDriver = {
      ...base,
      async start(input) {
        started += 1
        await new Promise(resolve => setTimeout(resolve, 10))
        const connection = await base.start(input)
        return {
          ...connection,
          async close() {
            closed += 1
            await connection.close()
          },
        }
      },
    }
    const host = createRuntimeHost()
    host.registerDriver(driver)
    await Promise.allSettled([host.connect({ installation, cwd: '/tmp' }), host.connect({ installation, cwd: '/tmp' })])
    await host.close()
    expect(closed).toBe(started)
  })

  test('concurrent opens of one product session id open one engine session', async () => {
    const base = createFakeDshShapedDriver()
    let opened = 0
    const driver: RuntimeDriver = {
      ...base,
      async start(input) {
        const connection = await base.start(input)
        return {
          ...connection,
          async openSession(request) {
            opened += 1
            await new Promise(resolve => setTimeout(resolve, 10))
            return connection.openSession(request)
          },
        }
      },
    }
    const host = createRuntimeHost()
    host.registerDriver(driver)
    await host.connect({ installation, cwd: '/tmp' })
    const results = await Promise.allSettled([
      host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' }),
      host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' }),
    ])
    expect(opened).toBe(1)
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toBeInstanceOf(RuntimeSessionAlreadyOpenError)
    await host.close()
  })

  test('close waits for an in-flight connect and closes its eventual connection', async () => {
    const base = createFakeDshShapedDriver()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let closed = 0
    const host = createRuntimeHost()
    host.registerDriver({
      ...base,
      async start(input) {
        await gate
        const connection = await base.start(input)
        return {
          ...connection,
          async close() {
            closed += 1
            await connection.close()
          },
        }
      },
    })
    const connecting = host.connect({ installation, cwd: '/tmp' })
    const closing = host.close()
    release()
    await Promise.all([connecting, closing])
    expect(closed).toBe(1)
    await expect(host.openSession({ installationId: 'inst-1', sessionId: 'late', cwd: '/tmp' }))
      .rejects.toBeInstanceOf(RuntimeHostClosedError)
  })

  test('an open finishing after connection replacement is closed and never registered', async () => {
    const base = createFakeDshShapedDriver()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let staleClosed = 0
    let starts = 0
    const host = createRuntimeHost()
    host.registerDriver({
      ...base,
      async start(input) {
        const connection = await base.start(input)
        if (++starts !== 1) return connection
        return {
          ...connection,
          async openSession(request) {
            const session = await connection.openSession(request)
            await gate
            return {
              ...session,
              async close() {
                staleClosed += 1
                await session.close()
              },
            }
          },
        }
      },
    })
    await host.connect({ installation, cwd: '/tmp' })
    const opening = host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' })
    const outcome = Promise.allSettled([opening])
    await host.connect({ installation, cwd: '/tmp' })
    release()
    const [result] = await outcome
    expect(result?.status).toBe('rejected')
    expect(staleClosed).toBe(1)
    expect(() => host.getSession('session-1')).toThrow(UnknownRuntimeSessionError)
    await host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' })
    await host.close()
  })

  test('close waits for an in-flight session open and closes its eventual session', async () => {
    const base = createFakeDshShapedDriver()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let sessionClosed = 0
    const host = createRuntimeHost()
    host.registerDriver({
      ...base,
      async start(input) {
        const connection = await base.start(input)
        return {
          ...connection,
          async openSession(request) {
            const session = await connection.openSession(request)
            await gate
            return {
              ...session,
              async close() {
                sessionClosed += 1
                await session.close()
              },
            }
          },
        }
      },
    })
    await host.connect({ installation, cwd: '/tmp' })
    const opening = host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' })
    let closeFinished = false
    const closing = host.close().then(() => { closeFinished = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(closeFinished).toBe(false)
    release()
    const [result] = await Promise.allSettled([opening, closing])
    expect(result?.status).toBe('rejected')
    expect(sessionClosed).toBe(1)
    expect(() => host.getSession('session-1')).toThrow(UnknownRuntimeSessionError)
  })

  test('close does not wait forever for a session open the engine never answers', async () => {
    const base = createFakeDshShapedDriver()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let connectionClosed = 0
    const host = createRuntimeHost()
    host.registerDriver({
      ...base,
      async start(input) {
        const connection = await base.start(input)
        return {
          ...connection,
          async openSession(request) {
            await gate
            return connection.openSession(request)
          },
          async close() {
            connectionClosed += 1
            release()
            await connection.close()
          },
        }
      },
    })
    await host.connect({ installation, cwd: '/tmp' })
    void host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' }).catch(() => {})
    const closing = host.close()
    await expect(closing).resolves.toBeUndefined()
    expect(connectionClosed).toBe(1)
  })

  test('reopening the same product session id is a typed error', async () => {
    const { host } = await hostWithSession()
    await expect(host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' }))
      .rejects.toBeInstanceOf(RuntimeSessionAlreadyOpenError)
    await host.close()
  })

  test('connect rejects an installation whose driver was never registered', async () => {
    const host = createRuntimeHost()
    await expect(host.connect({ installation, cwd: '/tmp' })).rejects.toBeInstanceOf(UnknownRuntimeDriverError)
  })

  test('openSession rejects an installation with no live connection', async () => {
    const host = createRuntimeHost()
    host.registerDriver(createFakeDshShapedDriver())
    await expect(
      host.openSession({ installationId: 'inst-1', sessionId: 'session-1', cwd: '/tmp' }),
    ).rejects.toBeInstanceOf(UnknownRuntimeInstallationError)
  })

  test('approvals and interrupts reach the right session', async () => {
    const { host } = await hostWithSession()
    const iterator = host.send('session-1', { text: 'ask' })[Symbol.asyncIterator]()
    await iterator.next()
    const requested = await iterator.next()
    const request = requested.value as { kind: string; request: { requestId: string } }
    await host.respondApproval('session-1', request.request.requestId, 'allow')
    const resolved = await iterator.next()
    expect(resolved.value).toMatchObject({ kind: 'approval.resolved', decision: { optionId: 'allow' } })
    await host.close()
  })

  test('interrupt reaches the running turn', async () => {
    const { host } = await hostWithSession()
    const iterator = host.send('session-1', { text: 'slow' })[Symbol.asyncIterator]()
    await iterator.next()
    expect(await host.interrupt('session-1')).toMatchObject({ status: 'cancelled' })
    await host.close()
  })

  test('requireCapability passes native paths and rejects unsupported ones', async () => {
    const { host } = await hostWithSession()
    expect(() => host.requireCapability('session-1', 'prompt.text')).not.toThrow()
    expect(() => host.requireCapability('session-1', 'prompt.image')).toThrow(UnsupportedRuntimeCapabilityError)
    expect(host.capabilitiesOf('session-1').prompt.image.state).toBe('unsupported')
    await host.close()
  })

  test('a connection exit is forwarded once and forgets its sessions', async () => {
    const { host } = await hostWithSession()
    const exits: Array<{ installationId: string }> = []
    host.onConnectionExit((event) => exits.push(event))
    await host.close()
    expect(exits).toEqual([{ installationId: 'inst-1', exit: { code: 0, signal: null } }])
    expect(() => host.getSession('session-1')).toThrow(UnknownRuntimeSessionError)
  })

  test('close is idempotent', async () => {
    const { host } = await hostWithSession()
    await host.close()
    await host.close()
    expect(() => host.getSession('session-1')).toThrow(UnknownRuntimeSessionError)
  })
})
