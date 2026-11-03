import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeEvent } from '../contract.js'
import { createDshHostDriver } from '../dshHostDriver.js'
import { connectDshHost } from '../../../../harness/src/hostClient.js'
import { spawn } from 'node:child_process'

// These tests drive the driver against a real dsh Host and the official mock
// LLM; the hand-written fake Host in dshHostDriver.test.ts cannot prove the
// driver fits what the Host actually emits.

const TEST_TIMEOUT = 60_000
const API_KEY = 'echoflow-real-host-key'
const harnessDir = join(import.meta.dir, '..', '..', '..', '..', 'harness')
const cleanups: Array<() => Promise<void> | void> = []
const previousKey = process.env.ECHOFLOW_API_KEY

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  if (previousKey === undefined) delete process.env.ECHOFLOW_API_KEY
  else process.env.ECHOFLOW_API_KEY = previousKey
})

// dsh's boot needs a real Node runtime, so the Host runs in a Node child and
// the driver under test stays in Bun, talking to it over loopback.
async function startNodeHost(env: Record<string, string>) {
  const child = spawn('node', [join(harnessDir, 'src', 'hostRunner.js')], { env, stdio: ['pipe', 'pipe', 'inherit'] })
  const line = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      if (buffer.includes('\n')) resolve(buffer.split('\n')[0]!)
    })
    child.once('exit', code => reject(new Error(`the Host runner exited with ${String(code)} before it was ready`)))
  })
  const { origin, token } = JSON.parse(line) as { origin: string; token: string }
  return {
    origin,
    token,
    close: async () => {
      if (child.exitCode !== null) return
      child.stdin!.end()
      await new Promise<void>(resolve => {
        child.once('exit', () => resolve())
        setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 10_000).unref()
      })
    },
  }
}

async function boot(sequence: string[]) {
  const { startMockLlmServer } = await import(Bun.resolveSync('@deepseek-ai/dsh-llm-mock-server', harnessDir))
  const root = mkdtempSync(join(tmpdir(), 'echoflow-real-host-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const env: Record<string, string> = {
    HOME: join(root, 'home'),
    CLAUDE_CONFIG_DIR: join(root, 'config'),
    DSH_HOME: join(root, 'dsh-home'),
    DSH_AGENTS_HOME: join(root, 'agents-home'),
    XDG_CONFIG_HOME: join(root, 'home', '.config'),
    XDG_DATA_HOME: join(root, 'home', '.local', 'share'),
    XDG_CACHE_HOME: join(root, 'home', '.cache'),
    PATH: process.env.PATH ?? '',
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  process.env.ECHOFLOW_API_KEY = API_KEY
  const mock = await startMockLlmServer({
    apiKey: API_KEY,
    sequence,
    repeatLast: true,
    toolName: 'bash',
    toolArguments: JSON.stringify({ description: 'Echo a word', command: 'echo marker' }),
    successText: 'hello from mock',
    chunkSize: 5,
    chunkDelayMs: 10,
  })
  cleanups.push(() => mock.close?.())
  writeFileSync(join(env.DSH_HOME, 'cordis.patch.yml'), [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      echoflow:',
    '        displayName: EchoFlow real host test',
    '        api: anthropic-messages',
    `        baseURL: ${mock.baseURL}`,
    '        apiKeyEnv: ECHOFLOW_API_KEY',
    '        models:',
    '          - id: echoflow-mock',
    '            name: EchoFlow Mock',
    '            contextWindow: 128000',
    '- id: agent-default-model',
    '  config:',
    '    provider: echoflow',
    '    model: echoflow-mock',
    '',
  ].join('\n'))
  const workspace = join(root, 'workspace')
  const host = await startNodeHost({ ...env, ECHOFLOW_API_KEY: API_KEY, ECHOFLOW_HOST_CWD: workspace })
  cleanups.push(() => host.close())
  const driver = createDshHostDriver({ connectHost: () => connectDshHost({ origin: host.origin, token: host.token }) })
  const connection = await driver.start({ installation: {} as never, runId: 'run-real', cwd: workspace })
  cleanups.push(() => connection.close())
  const session = await connection.openSession({ sessionId: 'product-real', cwd: workspace })
  return { session }
}

async function collect(iterable: AsyncIterable<RuntimeEvent>) {
  const events: RuntimeEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('dshHostDriver against a real dsh Host', () => {
  test('a text turn yields the reply and ends with end_turn', async () => {
    const { session } = await boot(['success'])
    const events = await collect(session.send({ text: 'hi' }))
    expect(events.find(event => event.kind === 'assistant.message')).toMatchObject({ text: 'hello from mock' })
    expect(events.filter(event => event.kind === 'turn.completed')).toHaveLength(1)
    expect(events.find(event => event.kind === 'turn.completed')).toMatchObject({ reason: 'end_turn' })
  }, TEST_TIMEOUT)

  test('a tool turn pairs tool.started with tool.completed by call id', async () => {
    const { session } = await boot(['tool_call_success', 'success'])
    const events = await collect(session.send({ text: 'run it' }))
    const started = events.findIndex(event => event.kind === 'tool.started')
    const completed = events.findIndex(event => event.kind === 'tool.completed')
    expect(started).toBeGreaterThanOrEqual(0)
    expect(completed).toBeGreaterThan(started)
    expect(events[started]).toMatchObject({ name: 'bash', input: { command: 'echo marker' } })
    expect(events[completed]).toMatchObject({ isError: false, output: expect.stringContaining('marker') })
    expect((events[completed] as { toolCallId: string }).toolCallId).toBe((events[started] as { toolCallId: string }).toolCallId)
    expect(events.at(-2)).toMatchObject({ kind: 'turn.completed', reason: 'end_turn' })
  }, TEST_TIMEOUT)

  test('a second turn on the same session works after the first ends', async () => {
    const { session } = await boot(['success'])
    await collect(session.send({ text: 'one' }))
    const second = await collect(session.send({ text: 'two' }))
    expect(second.find(event => event.kind === 'turn.completed')).toMatchObject({ reason: 'end_turn' })
  }, TEST_TIMEOUT)

  test('close is idempotent', async () => {
    const { session } = await boot(['success'])
    await session.close()
    await session.close()
  }, TEST_TIMEOUT)
})
