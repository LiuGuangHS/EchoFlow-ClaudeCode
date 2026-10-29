import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeBusyError, RuntimeStartupError } from '../contract.js'
import { createDshDriver } from '../dshDriver.js'

const fixture = join(import.meta.dir, '..', '__fixtures__', 'fixtureAcpAgent.ts')
const command = () => [process.execPath, fixture]
const installation = { executablePath: fixture } as never

const sandboxes: string[] = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function open(env: Record<string, string> = {}) {
  const driver = createDshDriver({ resolveCommand: command })
  const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd(), env })
  const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
  return { driver, connection, session }
}
async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}
const lastDelta = events => events.filter(event => event.kind === 'assistant.delta').at(-1)
async function waitForFile(path: string) {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(path)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${path} never appeared`)
}

describe('dshDriver over a real ACP child process', () => {
  test('completes one turn and stamps every event with the product session and run', async () => {
    const { connection, session } = await open()
    const events = await collect(session.send({ text: 'hello' }))
    expect(events.map(event => event.kind)).toEqual(['session.state', 'assistant.delta', 'turn.completed', 'session.state'])
    expect(events[1]).toMatchObject({ text: 'hello from fixture', sessionId: 'session-1', runId: 'run-1' })
    expect(events[2]).toMatchObject({ kind: 'turn.completed', reason: 'end_turn' })
    await connection.close()
  })

  test('surfaces an approval request and continues after allow', async () => {
    const { connection, session } = await open()
    const events = []
    for await (const event of session.send({ text: 'needs-approval' })) {
      events.push(event)
      if (event.kind === 'approval.requested') await session.respondApproval(event.request.requestId, 'allow')
    }
    expect(events.filter(event => event.kind === 'approval.resolved')).toHaveLength(1)
    expect(lastDelta(events)).toMatchObject({ text: 'approved' })
    await connection.close()
  })

  test('continues with the deny outcome when the user denies', async () => {
    const { connection, session } = await open()
    const events = []
    for await (const event of session.send({ text: 'needs-approval' })) {
      if (event.kind === 'approval.requested') await session.respondApproval(event.request.requestId, 'deny')
      events.push(event)
    }
    expect(lastDelta(events)).toMatchObject({ text: 'denied' })
    await connection.close()
  })

  test('interrupt cancels a running turn and the next send works', async () => {
    const { connection, session } = await open()
    const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
    await iterator.next()
    expect(await session.interrupt()).toMatchObject({ status: 'cancelled', forcedTerminate: false })
    const rest = []
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value)
    expect(rest.filter(event => event.kind === 'turn.completed').at(-1)).toMatchObject({ reason: 'cancelled' })
    expect(lastDelta(await collect(session.send({ text: 'hello' })))).toMatchObject({ text: 'hello from fixture' })
    await connection.close()
  })

  test('an engine that ignores cancel is reported as cancelling, not cancelled', async () => {
    const driver = createDshDriver({ resolveCommand: command, interruptTimeoutMs: 100 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const iterator = session.send({ text: 'unresponsive' })[Symbol.asyncIterator]()
    await iterator.next()
    expect(await session.interrupt()).toMatchObject({
      status: 'cancelling',
      residualWork: ['prompt'],
      forcedTerminate: false,
    })
    // The turn is still live: a new send must be rejected, not silently queued.
    expect(() => session.send({ text: 'hello' })).toThrow(RuntimeBusyError)
    await connection.close()
  })

  test("a finished turn's iterator return does not cancel the next turn", async () => {
    const { connection, session } = await open()
    const first = session.send({ text: 'hello' })[Symbol.asyncIterator]()
    for (let next = await first.next(); !next.done; next = await first.next()) {
      // drain the finished turn
    }
    const second = session.send({ text: 'slow' })[Symbol.asyncIterator]()
    await second.next()
    // A late cleanup of the finished turn must not touch the running one.
    await first.return?.()
    expect(() => session.send({ text: 'hello' })).toThrow(RuntimeBusyError)
    await session.interrupt()
    await connection.close()
  })

  test('a consumer that breaks out of the stream cancels the engine turn before the next send', async () => {
    const { connection, session } = await open()
    for await (const event of session.send({ text: 'slow' })) {
      if (event.kind === 'session.state') break
    }
    // iterator.return() must wait for the cancel to land, else this throws RuntimeBusyError.
    expect(lastDelta(await collect(session.send({ text: 'hello' })))).toMatchObject({ text: 'hello from fixture' })
    await connection.close()
  })

  test('a second send while a turn is active is rejected, not queued', async () => {
    const { connection, session } = await open()
    const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
    await iterator.next()
    expect(() => session.send({ text: 'hello' })).toThrow(RuntimeBusyError)
    await session.interrupt()
    await connection.close()
  })

  test('answers a permission request that arrives with no active turn as cancelled', async () => {
    // The fixture ends the turn on 'stray-permission', then sends one more permission
    // request. It records the outcome it received, which is how we know the driver
    // answered 'cancelled' instead of leaving the engine waiting.
    const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-driver-'))
    sandboxes.push(sandbox)
    const marker = join(sandbox, 'permission-outcome')
    const { connection, session } = await open({ FIXTURE_PERMISSION_MARKER: marker })
    await collect(session.send({ text: 'stray-permission' }))
    await waitForFile(marker)
    expect(readFileSync(marker, 'utf8')).toBe('cancelled')
    await connection.close()
  })

  test('probe reports a successful handshake without opening a session', async () => {
    const driver = createDshDriver({ resolveCommand: command })
    expect(await driver.probe(installation)).toMatchObject({ ok: true, error: null })
  })

  test('probe reports a failed launch instead of throwing', async () => {
    const driver = createDshDriver({ resolveCommand: () => [process.execPath, '-e', 'process.exit(3)'] })
    expect(await driver.probe(installation)).toMatchObject({ ok: false })
  })

  test('start rejects with a typed error carrying stderr when the launcher dies immediately', async () => {
    const driver = createDshDriver({
      resolveCommand: () => [process.execPath, '-e', 'console.error("boom"); process.exit(2)'],
    })
    const failure = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() }).catch(error => error)
    expect(failure).toBeInstanceOf(RuntimeStartupError)
    expect(failure.stderr).toContain('boom')
  })

  test('close is idempotent and onExit fires once', async () => {
    const { connection } = await open()
    const exits = []
    connection.onExit(exit => exits.push(exit))
    await connection.close()
    await connection.close()
    expect(exits).toHaveLength(1)
    expect(exits[0].code).toBe(0)
  })
})
