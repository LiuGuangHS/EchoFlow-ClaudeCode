import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeBusyError, RuntimeStartupError, UnsupportedRuntimeCapabilityError } from '../contract.js'
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

/** Requests cross the process boundary, so the fixture appends them to a file. */
async function openWithCallLog(options: { rejectConfigIds?: string[]; agentCapabilities?: unknown } = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-calls-'))
  sandboxes.push(sandbox)
  const callsPath = join(sandbox, 'calls.ndjson')
  const driver = createDshDriver({ resolveCommand: command })
  const connection = await driver.start({
    installation,
    runId: 'run-1',
    cwd: process.cwd(),
    env: {
      FIXTURE_CALLS_MARKER: callsPath,
      FIXTURE_REJECT_CONFIG_IDS: (options.rejectConfigIds ?? []).join(','),
      FIXTURE_AGENT_CAPABILITIES: JSON.stringify(options.agentCapabilities ?? {}),
    },
  })
  const readCalls = () =>
    existsSync(callsPath)
      ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
  return { connection, readCalls }
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

  test('applies the requested model and reasoning effort through set_config_option', async () => {
    const { connection, readCalls } = await openWithCallLog()
    await connection.openSession({
      sessionId: 'session-1',
      cwd: process.cwd(),
      model: { provider: 'echoflow', model: 'kimi-k3' },
      reasoningEffort: 'high',
    })
    const sets = readCalls().filter(call => call.method === 'session/set_config_option')
    expect(sets.map(call => [call.params.configId, call.params.value]))
      .toEqual([['model', 'echoflow/kimi-k3'], ['reasoning_effort', 'high']])
    await connection.close()
  })

  test('a rejected config option closes the half-open session and throws', async () => {
    const { connection, readCalls } = await openWithCallLog({ rejectConfigIds: ['reasoning_effort'] })
    await expect(connection.openSession({ sessionId: 'session-1', cwd: process.cwd(), reasoningEffort: 'high' }))
      .rejects.toThrow()
    expect(readCalls().some(call => call.method === 'session/close')).toBe(true)
    await connection.close()
  })

  test('projects attachments and references into ACP prompt content in order', async () => {
    const { connection, readCalls } = await openWithCallLog({ agentCapabilities: { promptCapabilities: { image: true } } })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    await collect(session.send({
      text: 'look',
      attachments: [{ kind: 'image', mimeType: 'image/png', dataBase64: 'AA==' }],
      references: [{ kind: 'file', uri: 'file:///tmp/a.ts', label: 'a.ts' }],
    }))
    const prompt = readCalls().find(call => call.method === 'session/prompt')
    expect(prompt.params.prompt.map(block => block.type)).toEqual(['text', 'image', 'resource_link'])
    expect(prompt.params.prompt[1]).toMatchObject({ mimeType: 'image/png', data: 'AA==' })
    expect(prompt.params.prompt[2]).toMatchObject({ uri: 'file:///tmp/a.ts', name: 'a.ts' })
    await connection.close()
  })

  test('rejects image turns when the handshake advertises no image support', async () => {
    const { connection, readCalls } = await openWithCallLog({ agentCapabilities: { promptCapabilities: { image: false } } })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    expect(() => session.send({ text: 'x', attachments: [{ kind: 'image', mimeType: 'image/png', dataBase64: 'AA==' }] }))
      .toThrow(UnsupportedRuntimeCapabilityError)
    expect(readCalls().some(call => call.method === 'session/prompt')).toBe(false)
    await connection.close()
  })

  test('closing a session closes it on the engine, not just the local router', async () => {
    const { connection, readCalls } = await openWithCallLog()
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    await session.close()
    expect(readCalls().filter(call => call.method === 'session/close').map(call => call.params.sessionId))
      .toEqual([session.nativeSessionId])
    await connection.close()
  })

  test('closing an already closed session does not send a second close', async () => {
    const { connection, readCalls } = await openWithCallLog()
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    await session.close()
    await session.close()
    expect(readCalls().filter(call => call.method === 'session/close')).toHaveLength(1)
    await connection.close()
  })
})
