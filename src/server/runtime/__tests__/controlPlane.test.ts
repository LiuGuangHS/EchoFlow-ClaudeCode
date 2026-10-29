import { describe, expect, test } from 'bun:test'
import { createFakeDshShapedDriver } from '../__fixtures__/fakeDrivers.js'
import {
  UnsupportedRuntimeCapabilityError,
  type RuntimeDriver,
  type RuntimeInstallation,
} from '../contract.js'
import {
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
