import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeBusyError, RuntimeStartupError, UnsupportedRuntimeCapabilityError, type RuntimeEvent } from '../contract.js'
import { createClaudeAgentSdkDriver, type ClaudeAgentSdkDriverOptions } from '../claudeAgentSdkDriver.js'
import { createFakeSdk, sdkDelta } from '../__fixtures__/fakeSdkQuery.js'
import { runRuntimeContractSuite, runScriptedTurn } from '../__fixtures__/contractSuite.js'

runRuntimeContractSuite('claude-agent-sdk over a fake query()', () => createClaudeAgentSdkDriver({ query: createFakeSdk().query }))

const installation = {} as never
const sandboxes: string[] = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Temp config dir and a fake key: nothing here can reach the real HOME, ~/.claude, a model, or the network. */
async function open(overrides: Partial<ClaudeAgentSdkDriverOptions> = {}) {
  const sdk = createFakeSdk()
  const driver = createClaudeAgentSdkDriver({ query: sdk.query, interruptTimeoutMs: 50, ...overrides })
  const config = mkdtempSync(join(tmpdir(), 'echoflow-sdk-'))
  sandboxes.push(config)
  const env = { CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'sk-test-fake' }
  const connection = await driver.start({ installation, runId: 'run-1', cwd: config, env })
  const session = await connection.openSession({ sessionId: 'session-1', cwd: config })
  return { sdk, connection, session, config }
}

async function drain(iterator: AsyncIterator<RuntimeEvent>) {
  const events: RuntimeEvent[] = []
  for (let step = await iterator.next(); !step.done; step = await iterator.next()) events.push(step.value)
  return events
}

const kinds = (events: RuntimeEvent[]) => events.map((event) => event.kind)

describe('claudeAgentSdkDriver', () => {
  test('start without an injected query() fails with a typed startup error', async () => {
    await expect(createClaudeAgentSdkDriver().start({ installation, runId: 'run-1', cwd: '/tmp' })).rejects.toBeInstanceOf(RuntimeStartupError)
  })

  test('opens the SDK in streaming-input mode with the given env and manual approvals', async () => {
    const { sdk, session, config, connection } = await open()
    expect(sdk.calls).toHaveLength(1)
    const { options } = sdk.calls[0]!
    expect(options.permissionMode).toBe('default')
    expect(options.includePartialMessages).toBe(true)
    expect(options.cwd).toBe(config)
    expect(options.env.CLAUDE_CONFIG_DIR).toBe(config)
    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-test-fake')
    expect(options.sessionId).toBe(session.nativeSessionId)
    expect(options.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof options.canUseTool).toBe('function')
    expect(options.abortController).toBeInstanceOf(AbortController)
    await connection.close()
  })

  test('inputs the SDK path cannot honor are rejected, not dropped', async () => {
    const { sdk, connection, config } = await open()
    const inputs = [
      { model: { provider: 'p', model: 'm' } },
      { reasoningEffort: 'high' },
      { mcpServers: [{ kind: 'stdio' as const, name: 'x', command: 'x' }] },
    ]
    for (const input of inputs) {
      await expect(connection.openSession({ sessionId: 'session-2', cwd: config, ...input })).rejects.toBeInstanceOf(UnsupportedRuntimeCapabilityError)
    }
    expect(sdk.calls).toHaveLength(1)
    await connection.close()
  })

  test('capabilities claim only what a test drives, and every unsupported leaf says why', async () => {
    const { connection } = await open()
    const c = connection.capabilities
    for (const leaf of [c.prompt.text, c.approval.tool, c.session.close, c.observability.usage]) expect(leaf.state).toBe('native')
    const unsupported = [
      c.session.list, c.session.resume, c.session.fork, c.session.delete,
      c.prompt.image, c.prompt.steer, c.prompt.queue,
      c.config.model, c.config.reasoningEffort, c.config.permissionMode,
      c.extensions.mcpStdio, c.extensions.mcpHttp,
      c.subagent.delegate, c.jobs.list, c.checkpoints.files, c.commands.catalog,
    ]
    for (const leaf of unsupported) {
      expect(leaf.state).toBe('unsupported')
      expect((leaf.note ?? '').length).toBeGreaterThan(0)
    }
    await connection.close()
  })

  test('a denied approval reaches the SDK as a deny with a message', async () => {
    const { sdk, session, connection } = await open()
    const iterator = session.send({ text: 'ask' })[Symbol.asyncIterator]()
    await iterator.next()
    const requested = (await iterator.next()).value as Extract<RuntimeEvent, { kind: 'approval.requested' }>
    expect(requested.kind).toBe('approval.requested')
    expect(requested.request.options.map((option) => option.effect)).toEqual(['allow-once', 'deny'])
    await session.respondApproval(requested.request.requestId, 'deny')
    const rest = await drain(iterator)
    expect(sdk.permissionResults[0]).toMatchObject({ behavior: 'deny' })
    expect(typeof (sdk.permissionResults[0] as { message: unknown }).message).toBe('string')
    expect(rest[0]).toMatchObject({ kind: 'approval.resolved', decision: { optionId: 'deny', decidedBy: 'user' } })
    expect(kinds(rest)).toContain('turn.completed')
    await connection.close()
  })

  test('interrupt reaches the SDK, ends the turn as cancelled, and the next send works', async () => {
    const { sdk, session, connection } = await open()
    const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
    await iterator.next()
    const result = await session.interrupt()
    expect(sdk.calls[0]!.interrupts).toBe(1)
    expect(result).toMatchObject({ status: 'cancelled', forcedTerminate: false })
    expect((await drain(iterator)).find((event) => event.kind === 'turn.completed')).toMatchObject({ reason: 'cancelled' })
    expect(kinds(await runScriptedTurn(session, 'hello'))).toContain('turn.completed')
    await connection.close()
  })

  test('an engine that ignores interrupt is reported as cancelling, not cancelled', async () => {
    const { sdk, session, connection } = await open()
    const iterator = session.send({ text: 'stuck' })[Symbol.asyncIterator]()
    await iterator.next()
    const result = await session.interrupt()
    expect(sdk.calls[0]!.interrupts).toBe(1)
    expect(result).toMatchObject({ status: 'cancelling', forcedTerminate: false })
    expect(() => session.send({ text: 'hello' })).toThrow(RuntimeBusyError)
    await connection.close()
  })

  test('closing a session mid-turn ends the turn as cancelled and tears the engine down', async () => {
    const { sdk, session, connection } = await open()
    const iterator = session.send({ text: 'slow' })[Symbol.asyncIterator]()
    await iterator.next()
    await session.close()
    expect(sdk.calls[0]!.aborted).toBe(true)
    expect((await drain(iterator)).find((event) => event.kind === 'turn.completed')).toMatchObject({ reason: 'cancelled' })
    await connection.close()
  })
})

describe('claudeAgentSdkDriver transport faults', () => {
  test('a request the engine refuses ends the turn as an error and the session stays usable', async () => {
    const { sdk, session, connection } = await open()
    const events = await runScriptedTurn(session, 'refuse')
    expect(sdk.faults).toEqual(['refuse'])
    expect(events.find((event) => event.kind === 'diagnostic')).toMatchObject({ level: 'error', code: 'sdk.turn_failed', message: expect.stringContaining('401') })
    expect(events.find((event) => event.kind === 'turn.completed')).toMatchObject({ reason: 'error' })
    expect(events.at(-1)).toMatchObject({ kind: 'session.state', state: 'idle' })
    expect(kinds(await runScriptedTurn(session, 'hello'))).toContain('assistant.delta')
    await connection.close()
  })

  test('a stream that throws mid-turn closes the turn as an error and reports the engine gone', async () => {
    const { sdk, session, connection } = await open()
    const events = await runScriptedTurn(session, 'crash')
    expect(sdk.faults).toEqual(['crash'])
    expect(kinds(events)).toEqual(['session.state', 'assistant.delta', 'diagnostic', 'engine.exited', 'turn.completed', 'session.state'])
    expect(events[2]).toMatchObject({ level: 'error', code: 'sdk.engine_failed', message: expect.stringContaining('EPIPE') })
    expect(events[3]).toMatchObject({ code: null, signal: null })
    expect(events[4]).toMatchObject({ reason: 'error' })
    expect(events.at(-1)).toMatchObject({ state: 'closed' })
    // A later send neither throws nor hangs: it fails closed.
    const later = await runScriptedTurn(session, 'hello')
    expect(kinds(later)).toEqual(['session.state', 'diagnostic', 'turn.completed', 'session.state'])
    expect(later[1]).toMatchObject({ code: 'sdk.engine_gone' })
    expect(later[2]).toMatchObject({ reason: 'error' })
    await connection.close()
  })

  test('a stream that ends without a result is an engine exit, not a hung turn', async () => {
    const { sdk, session, connection } = await open()
    const events = await runScriptedTurn(session, 'vanish')
    expect(sdk.faults).toEqual(['vanish'])
    expect(kinds(events)).toEqual(['session.state', 'assistant.delta', 'diagnostic', 'engine.exited', 'turn.completed', 'session.state'])
    expect(events[2]).toMatchObject({ code: 'sdk.engine_failed' })
    expect(events[4]).toMatchObject({ reason: 'error' })
    await connection.close()
  })

  test('output that arrives after close is dropped without an event or an unhandled error', async () => {
    const { sdk, session, connection } = await open()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const engineTurns: RuntimeEvent[][] = []
      session.onEngineTurn(async (events) => {
        const seen: RuntimeEvent[] = []
        for await (const event of events) seen.push(event)
        engineTurns.push(seen)
      })
      await runScriptedTurn(session, 'hello')
      await session.close()
      sdk.emit(sdkDelta('too late'))
      expect(sdk.calls[0]!.aborted).toBe(true)
      expect(sdk.lateOutput).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(engineTurns).toEqual([])
      expect(unhandled).toEqual([])
      await connection.close()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
