import { afterEach, describe, expect, test } from 'bun:test'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { RuntimeBusyError, RuntimeStartupError, UnsupportedRuntimeCapabilityError, type RuntimeEvent } from '../contract.js'
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

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition never became true')
}

/** Requests cross the process boundary, so the fixture appends them to a file. */
async function openWithCallLog(options: { rejectConfigIds?: string[]; agentCapabilities?: unknown; env?: Record<string, string> } = {}) {
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
      ...options.env,
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

  test('rejects a handshake whose protocol version is not the one we speak', async () => {
    const driver = createDshDriver({ resolveCommand: () => [process.execPath, fixture, JSON.stringify({ protocolVersion: 99 })] })
    const failure = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() }).catch(error => error)
    expect(failure).toBeInstanceOf(RuntimeStartupError)
    expect(failure.message).toContain('99')
  })

  test('probe reports the protocol version the handshake answered with', async () => {
    const driver = createDshDriver({
      resolveCommand: () => [process.execPath, fixture, JSON.stringify({ agentInfo: { name: 'fixture', version: '9.9.9' } })],
    })
    // The installation fixture carries no version, so the effective version is
    // the handshake's answer alone.
    expect(await driver.probe(installation))
      .toMatchObject({ ok: true, protocolVersion: PROTOCOL_VERSION, agentVersion: '9.9.9', version: '9.9.9' })
  })

  test('probe reports a failed launch instead of throwing', async () => {
    const driver = createDshDriver({ resolveCommand: () => [process.execPath, '-e', 'process.exit(3)'] })
    expect(await driver.probe(installation)).toMatchObject({ ok: false })
  })

  test('probe reports the handshake version as version', async () => {
    const driver = createDshDriver({
      resolveCommand: () => [process.execPath, fixture, JSON.stringify({ agentInfo: { name: 'fixture', version: '9.9.9' } })],
    })
    expect(await driver.probe({ executablePath: fixture, version: '1.0.0' } as never))
      .toMatchObject({ ok: true, version: '9.9.9', agentVersion: '9.9.9' })
  })

  test('probe keeps the installation version when the handshake carries none', async () => {
    const driver = createDshDriver({
      resolveCommand: () => [process.execPath, fixture, JSON.stringify({ agentInfo: { name: 'fixture' } })],
    })
    expect(await driver.probe({ executablePath: fixture, version: '1.0.0' } as never))
      .toMatchObject({ ok: true, version: '1.0.0', agentVersion: null })
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
    // dsh lists model choices in its session config catalog as this JSON pair;
    // a "provider/model" string does not match the shape those candidates carry.
    expect(sets.map(call => [call.params.configId, call.params.value]))
      .toEqual([['model', '["echoflow","kimi-k3"]'], ['reasoning_effort', 'high']])
    await connection.close()
  })

  test('config.changed keeps the engine catalog over a real child process', async () => {
    const { connection } = await openWithCallLog()
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const events = await collect(session.send({ text: 'config-update' }))
    const changed = events.find(event => event.kind === 'config.changed')
    // The whole option table crosses the process boundary: candidates and groups
    // for a select, and a boolean kept as a boolean.
    expect(changed.options).toEqual([
      {
        kind: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        value: 'echoflow/kimi-k3',
        options: [
          { name: 'Main', options: [{ value: 'echoflow/kimi-k3', name: 'Kimi K3', description: 'default' }] },
          { name: 'Other', options: [{ value: 'echoflow/other', name: 'Other model' }] },
        ],
      },
      {
        kind: 'select',
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        value: 'high',
        options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
      },
      { kind: 'boolean', id: 'thinking', name: 'Thinking', value: true },
    ])
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

  test('opening a session fails instead of hanging when the engine never answers session/new', async () => {
    const driver = createDshDriver({ resolveCommand: command, sessionOpenTimeoutMs: 300 })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      env: { FIXTURE_STALL_SESSION_NEW: '1' },
    })
    const failure = await connection
      .openSession({ sessionId: 'session-1', cwd: process.cwd() })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('session/new')
    await connection.close()
  })

  test('one budget covers the whole open, not each request in it', async () => {
    const driver = createDshDriver({ resolveCommand: command, sessionOpenTimeoutMs: 400 })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      env: { FIXTURE_LATE_CONFIG_MS: '300' },
    })
    const started = Date.now()
    const failure = await connection
      .openSession({
        sessionId: 'session-1',
        cwd: process.cwd(),
        model: { provider: 'anthropic', model: 'claude-opus-5' },
        reasoningEffort: 'high',
      })
      .catch((error: unknown) => error)
    // The model option eats most of the budget; the reasoning-effort option
    // that follows must not get another full one.
    expect(failure).toBeInstanceOf(Error)
    expect(Date.now() - started).toBeLessThan(900)
    await connection.close()
  })

  test('a config option that runs out of time names the open budget', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-budget-'))
    sandboxes.push(sandbox)
    const callsPath = join(sandbox, 'calls.ndjson')
    const driver = createDshDriver({ resolveCommand: command, sessionOpenTimeoutMs: 200 })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      // The model option is answered long after the budget, so the open fails
      // on it rather than on the option that was never reached.
      env: { FIXTURE_CALLS_MARKER: callsPath, FIXTURE_LATE_CONFIG_MS: '1500' },
    })
    const failure = await connection
      .openSession({
        sessionId: 'session-1',
        cwd: process.cwd(),
        model: { provider: 'anthropic', model: 'claude-opus-5' },
        reasoningEffort: 'high',
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    // The whole open budget ran out, not just this one option.
    expect((failure as Error).message).toContain('budget')
    // Closing waits for the engine to exit, so its call log is complete.
    await connection.close()
    const calls = existsSync(callsPath)
      ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
    // And the reasoning-effort option was never even asked for.
    expect(calls.filter(call => call.method === 'session/set_config_option')).toHaveLength(1)
  })

  test('a spent open budget sends no further config option', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-spent-'))
    sandboxes.push(sandbox)
    const callsPath = join(sandbox, 'calls.ndjson')
    // The clock moves a fixed step per reading, so the deadline falls between
    // the two config options without any timing race: the session and the
    // model option still fit, the reasoning-effort option does not.
    let clock = 0
    const driver = createDshDriver({
      resolveCommand: command,
      sessionOpenTimeoutMs: 250,
      now: () => {
        clock += 100
        return clock
      },
    })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      env: { FIXTURE_CALLS_MARKER: callsPath },
    })
    const failure = await connection
      .openSession({
        sessionId: 'session-1',
        cwd: process.cwd(),
        model: { provider: 'anthropic', model: 'claude-opus-5' },
        reasoningEffort: 'high',
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('budget')
    // Closing waits for the engine to exit, so its call log is complete.
    await connection.close()
    const calls = existsSync(callsPath)
      ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
    // The model option was asked for; the reasoning-effort option that would
    // have followed it found no budget and was never sent.
    expect(calls.filter(call => call.method === 'session/set_config_option')).toHaveLength(1)
  })

  test('an open with no budget left sends no request at all', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-nobudget-'))
    sandboxes.push(sandbox)
    const callsPath = join(sandbox, 'calls.ndjson')
    const driver = createDshDriver({ resolveCommand: command, sessionOpenTimeoutMs: 0 })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      env: { FIXTURE_CALLS_MARKER: callsPath },
    })
    const failure = await connection
      .openSession({
        sessionId: 'session-1',
        cwd: process.cwd(),
        model: { provider: 'anthropic', model: 'claude-opus-5' },
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('budget')
    // Closing waits for the engine to exit, so a request that was sent would
    // have been written to the log by now.
    await connection.close()
    // Not even session/new: a spent budget buys no request.
    const calls = existsSync(callsPath)
      ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
    expect(calls).toHaveLength(0)
  })

  test('a session the engine opens after the budget is closed instead of left half-open', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'echoflow-late-'))
    sandboxes.push(sandbox)
    const callsPath = join(sandbox, 'calls.ndjson')
    const driver = createDshDriver({ resolveCommand: command, sessionOpenTimeoutMs: 200 })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      env: { FIXTURE_CALLS_MARKER: callsPath, FIXTURE_LATE_SESSION_NEW_MS: '600' },
    })
    const failure = await connection
      .openSession({ sessionId: 'session-1', cwd: process.cwd() })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    // The engine answers late: the session it created must be closed, or the
    // engine keeps a session nobody owns.
    await waitUntil(() =>
      existsSync(callsPath)
      && readFileSync(callsPath, 'utf8').includes('session/close'))
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

  test('close finishes locally even when the engine ignores session/close and cancel', async () => {
    const { connection, readCalls } = await openWithCallLog({ env: { FIXTURE_IGNORE_CLOSE: '1' } })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const turn = collect(session.send({ text: 'unresponsive' }))
    const started = Date.now()
    await session.close()
    expect(Date.now() - started).toBeLessThan(2_250)
    // close() must not return before the turn it owns has been laid down.
    const events = await turn
    expect(events.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ kind: 'session.state', state: 'idle' })
    await session.close()
    expect(readCalls().filter(call => call.method === 'session/close')).toHaveLength(1)
    await connection.close()
  })

  test('closing a session mid-turn keeps the engine stop and does not wait out the budget', async () => {
    const { connection, session } = await open()
    const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
    await iterator.next()
    const started = Date.now()
    await session.close()
    // The fixture answers cancel at once; only a dropped stop makes close sit
    // out the whole 2 s session budget.
    expect(Date.now() - started).toBeLessThan(1_000)
    const rest = []
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value)
    expect(rest.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('closing mid-turn still reads the stop when the engine sends an update before it', async () => {
    const { connection, session } = await open()
    const iterator = session.send({ text: 'slow-chatty' })[Symbol.asyncIterator]()
    await iterator.next()
    const started = Date.now()
    await session.close()
    expect(Date.now() - started).toBeLessThan(1_000)
    const rest = []
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value)
    expect(rest.filter(event => event.kind === 'turn.completed').map(event => event.reason)).toEqual(['cancelled'])
    await connection.close()
  })

  test('openSession settles when the engine ignores the cleanup close of a rejected config', async () => {
    const driver = createDshDriver({ resolveCommand: command, sessionCloseTimeoutMs: 200 })
    const connection = await driver.start({
      installation,
      runId: 'run-1',
      cwd: process.cwd(),
      env: { FIXTURE_REJECT_CONFIG_IDS: 'reasoning_effort', FIXTURE_IGNORE_CLOSE: '1' },
    })
    const started = Date.now()
    await expect(connection.openSession({ sessionId: 'session-1', cwd: process.cwd(), reasoningEffort: 'high' }))
      .rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1_000)
    await connection.close()
  })

  test('engine output after the connection closed does not crash the driver process', async () => {
    const { connection } = await openWithCallLog({ env: { FIXTURE_WRITE_AFTER_CLOSE: '1' } })
    const crashes: unknown[] = []
    const onCrash = (error: unknown) => crashes.push(error)
    process.on('uncaughtException', onCrash)
    try {
      const exited = new Promise(resolve => connection.onExit(resolve))
      await connection.close()
      await exited
      // Let any late 'data' callback run before looking.
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(crashes).toEqual([])
    } finally {
      process.off('uncaughtException', onCrash)
    }
  })

  test('session capabilities carry what the handshake negotiated', async () => {
    const { connection } = await openWithCallLog({
      agentCapabilities: { promptCapabilities: { image: true }, mcpCapabilities: { http: true } },
    })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    expect(session.capabilities.prompt.image).toMatchObject({ state: 'native', source: 'handshake' })
    expect(session.capabilities.extensions.mcpHttp).toMatchObject({ state: 'native', source: 'handshake' })
    await connection.close()
  })

  test('passes declared MCP servers into session/new', async () => {
    const { connection, readCalls } = await openWithCallLog({ agentCapabilities: { mcpCapabilities: { http: true } } })
    await connection.openSession({
      sessionId: 'session-1',
      cwd: process.cwd(),
      mcpServers: [
        { kind: 'stdio', name: 'fs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        { kind: 'http', name: 'docs', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } },
      ],
    })
    expect(readCalls().find(call => call.method === 'session/new').params.mcpServers).toEqual([
      { name: 'fs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: [] },
      { type: 'http', name: 'docs', url: 'https://example.test/mcp', headers: [{ name: 'Authorization', value: 'Bearer x' }] },
    ])
    await connection.close()
  })

  test('rejects an HTTP MCP server the handshake did not advertise', async () => {
    const { connection, readCalls } = await openWithCallLog()
    await expect(connection.openSession({
      sessionId: 'session-1',
      cwd: process.cwd(),
      mcpServers: [{ kind: 'http', name: 'docs', url: 'https://example.test/mcp' }],
    })).rejects.toBeInstanceOf(UnsupportedRuntimeCapabilityError)
    expect(readCalls().some(call => call.method === 'session/new')).toBe(false)
    await connection.close()
  })

  test('writing to a dead engine does not crash the driver process', async () => {
    const driver = createDshDriver({ resolveCommand: command })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const exited = new Promise(resolve => connection.onExit(resolve))
    await collect(session.send({ text: 'die' }))
    await exited
    const events = await collect(session.send({ text: 'hello' }))
    expect(events.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('a send after the engine refused a prompt still completes', async () => {
    const { connection, session } = await open()
    const events = await collect(session.send({ text: 'reject-prompt' }))
    expect(events.filter(event => event.kind === 'turn.completed').map(event => event.reason)).toEqual(['error'])
    // The refusal also leaves an error entry in the update queue; it must not
    // cost the session its reader, or this turn's stop is never picked up.
    const after = await collect(session.send({ text: 'hello' }))
    expect(after.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('a turn closes when stdout closes without ending', async () => {
    let child: ChildProcess | undefined
    const spawn = ((file: string, args: string[], options: SpawnOptions) => {
      child = nodeSpawn(file, args, options)
      return child
    }) as typeof nodeSpawn
    const driver = createDshDriver({ resolveCommand: command, spawn })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const turn = session.send({ text: 'slow' })
    // A destroyed pipe emits 'close' with neither 'end' nor 'error'. The engine
    // is still alive, so only the pipe can tell the driver this turn is over.
    child!.stdout!.destroy()
    const events = await collect(turn)
    expect(events.filter(event => event.kind === 'turn.completed').map(event => event.reason)).toEqual(['error'])
    await connection.close()
  }, 3000)

  test('a turn that dies mid-stream is closed as an error and the session stays usable', async () => {
    const driver = createDshDriver({ resolveCommand: command })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const events = await collect(session.send({ text: 'die-midturn' }))
    // The engine dies mid-stream, so no stopReason ever arrives: the driver has to
    // lay the turn down itself instead of leaving the iterator open forever.
    expect(events.filter(event => event.kind === 'turn.completed').map(event => event.reason)).toEqual(['error'])
    expect(events.some(event => event.kind === 'diagnostic' && event.code === 'acp.turn_failed')).toBe(true)
    const after = await collect(session.send({ text: 'hello' }))
    expect(after.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('a turn still closes when the engine exits but a descendant keeps stdout open', async () => {
    const driver = createDshDriver({ resolveCommand: command })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    // Stream teardown never happens here — the descendant holds the pipe — so the
    // engine's exit itself has to be what lays the turn down.
    const events = await collect(session.send({ text: 'die-midturn-leaky' }))
    expect(events.filter(event => event.kind === 'turn.completed').map(event => event.reason)).toEqual(['error'])
    const after = await collect(session.send({ text: 'hello' }))
    expect(after.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  }, 5000)

  test('an engine that stopped reading stdin does not crash the driver process', async () => {
    const driver = createDshDriver({ resolveCommand: command })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    await collect(session.send({ text: 'close-stdin' }))
    await new Promise(resolve => setTimeout(resolve, 100))
    // The pipe is broken but the process is alive: the write must fail the turn,
    // not raise an uncaught EPIPE that takes the whole server down.
    const events = await collect(session.send({ text: 'hello' }))
    expect(events.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('a stalled consumer does not grow the turn buffer without bound', async () => {
    const driver = createDshDriver({ resolveCommand: command, turnBufferLimit: 4 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const iterator = session.send({ text: 'flood' })[Symbol.asyncIterator]()
    await iterator.next()
    // Stop reading while the engine keeps talking: the buffer must cap itself.
    await new Promise(resolve => setTimeout(resolve, 400))
    const rest = []
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value)
    expect(rest.some(event => event.kind === 'diagnostic' && event.code === 'runtime.turn_buffer_overflow')).toBe(true)
    await connection.close()
  })

  test('an engine-initiated turn between user turns is not attributed to the next send', async () => {
    const driver = createDshDriver({ resolveCommand: command, engineTurnIdleMs: 100 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    await collect(session.send({ text: 'hello' }))

    const engineTurns: string[][] = []
    session.onEngineTurn(async (events) => {
      const kinds: string[] = []
      for await (const event of events) kinds.push(event.kind)
      engineTurns.push(kinds)
    })
    await collect(session.send({ text: 'schedule-fired' }))
    await waitUntil(() => engineTurns.length === 1)
    expect(engineTurns[0]).toEqual(['turn.started', 'assistant.delta', 'turn.completed'])

    const second = await collect(session.send({ text: 'hello' }))
    expect(second.filter(event => event.kind === 'assistant.delta').map(event => event.text))
      .toEqual(['hello from fixture'])
    await connection.close()
  })

  test('the pump survives an engine-initiated turn that fails', async () => {
    const driver = createDshDriver({ resolveCommand: command, engineTurnIdleMs: 100 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const seen: string[] = []
    session.onEngineTurn(async (events) => {
      for await (const event of events) seen.push(event.kind)
    })
    await collect(session.send({ text: 'schedule-failed' }))
    await waitUntil(() => seen.includes('turn.completed'))
    await expect(collect(session.send({ text: 'hello' }))).resolves.toBeDefined()
    await connection.close()
  })

  test('a throwing engine listener does not stop the pump', async () => {
    const driver = createDshDriver({ resolveCommand: command, engineTurnIdleMs: 100 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const streams: Array<AsyncIterable<RuntimeEvent>> = []
    session.onEngineTurn((events) => {
      streams.push(events)
      throw new Error('listener blew up')
    })
    await collect(session.send({ text: 'schedule-fired' }))
    await waitUntil(() => streams.length === 1)
    const events = await collect(streams[0])
    expect(events.some((event: { kind?: string; code?: string }) => event.kind === 'diagnostic' && event.code === 'runtime.engine_listener_failed')).toBe(true)
    // The contract only knows info/warn/error; any other level falls through
    // a consumer's switch.
    expect(events.find((event: { code?: string }) => event.code === 'runtime.engine_listener_failed')).toMatchObject({ level: 'warn' })
    expect(events.some((event: { kind?: string }) => event.kind === 'turn.completed')).toBe(true)
    const after = await collect(session.send({ text: 'hello' }))
    expect(after.filter((event: { kind?: string }) => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('a rejecting engine listener does not stop the pump', async () => {
    const driver = createDshDriver({ resolveCommand: command, engineTurnIdleMs: 100 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const streams: Array<AsyncIterable<RuntimeEvent>> = []
    session.onEngineTurn((events) => {
      streams.push(events)
      return Promise.reject(new Error('listener rejected'))
    })
    await collect(session.send({ text: 'schedule-fired' }))
    await waitUntil(() => streams.length === 1)
    const events = await collect(streams[0])
    expect(events.some((event: { kind?: string; code?: string }) => event.kind === 'diagnostic' && event.code === 'runtime.engine_listener_failed')).toBe(true)
    expect(events.some((event: { kind?: string }) => event.kind === 'turn.completed')).toBe(true)
    const after = await collect(session.send({ text: 'hello' }))
    expect(after.filter((event: { kind?: string }) => event.kind === 'turn.completed')).toHaveLength(1)
    await connection.close()
  })

  test('a second engine listener registration throws and its disposer is idempotent', async () => {
    const driver = createDshDriver({ resolveCommand: command, engineTurnIdleMs: 100 })
    const connection = await driver.start({ installation, runId: 'run-1', cwd: process.cwd() })
    const session = await connection.openSession({ sessionId: 'session-1', cwd: process.cwd() })
    const dispose = session.onEngineTurn(() => {})
    expect(() => session.onEngineTurn(() => {})).toThrow('an engine turn listener is already registered')
    dispose()
    dispose()
    expect(() => session.onEngineTurn(() => {})).not.toThrow()
    await connection.close()
  })
})
