import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { connectDshHost } from '../src/hostClient.js'
import { startDshHost } from '../src/hostProcess.js'

const TEST_TIMEOUT = 60_000
const API_KEY = 'echoflow-sessions-key'

const hosts: Array<{ close(): Promise<void> }> = []
const clients: Array<{ close(): Promise<void> }> = []
const mocks: Array<{ close?: () => Promise<void> }> = []
const sandboxes: string[] = []
const previousKey = process.env.ECHOFLOW_API_KEY

afterEach(async () => {
  while (clients.length > 0) await clients.pop()?.close()
  while (hosts.length > 0) await hosts.pop()?.close()
  while (mocks.length > 0) await mocks.pop()?.close?.()
  while (sandboxes.length > 0) rmSync(sandboxes.pop()!, { recursive: true, force: true })
  if (previousKey === undefined) delete process.env.ECHOFLOW_API_KEY
  else process.env.ECHOFLOW_API_KEY = previousKey
})

async function waitFor(condition: () => boolean, message: string) {
  for (let i = 0; i < 300; i += 1) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function connect(options: { mock?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'echoflow-dsh-sessions-'))
  sandboxes.push(root)
  const env = {
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
  if (options.mock) {
    process.env.ECHOFLOW_API_KEY = API_KEY
    const mock = await startMockLlmServer({ apiKey: API_KEY, sequence: ['success'], repeatLast: true, successText: 'hello from mock', chunkSize: 5, chunkDelayMs: 10 })
    mocks.push(mock)
    writeFileSync(join(env.DSH_HOME, 'cordis.patch.yml'), [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      echoflow:',
      '        displayName: EchoFlow sessions test',
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
  }
  const workspace = join(root, 'workspace')
  const host = await startDshHost({ cwd: workspace, env })
  hosts.push(host)
  const client = await connectDshHost({ origin: host.origin, token: host.token })
  clients.push(client)
  return { client, workspace }
}

describe('the Host sessions facade', () => {
  test('creates, retains and releases a session', async () => {
    const { client, workspace } = await connect()
    const sessionId = await client.sessions.create({ cwd: workspace })
    expect(typeof sessionId).toBe('string')

    const reference = client.sessions.retain(sessionId, { source: 'echoflow-test' })
    const binding = await reference.ready
    expect(reference.sessionId).toBe(sessionId)
    expect(Array.isArray(binding.eventSource.getSnapshot().entries)).toBe(true)
    expect(typeof binding.eventSource.subscribe(() => {})).toBe('function')

    reference.release()
    reference.release()
  }, TEST_TIMEOUT)

  test('streams durable records into the event source after a prompt', async () => {
    const { client, workspace } = await connect({ mock: true })
    const sessionId = await client.sessions.create({ cwd: workspace })
    const reference = client.sessions.retain(sessionId, { source: 'echoflow-test' })
    const binding = await reference.ready
    let notified = 0
    const unsubscribe = binding.eventSource.subscribe(() => { notified += 1 })

    const handle = binding.session.beginSubmission({ mode: 'queue', text: 'hi', attachments: [] })
    const result = await binding.session.prompt([{ type: 'text', text: 'hi' }], 'queue', undefined, handle.requestId)
    expect(result).toMatchObject({ value: { accepted: true } })

    const types = () => binding.eventSource.getSnapshot().entries.map((entry: { event: { type: string } }) => entry.event.type)
    await waitFor(() => types().includes('turn/end'), 'the turn never ended')
    expect(types()).toEqual(expect.arrayContaining(['user/message', 'assistant/message', 'turn/end']))
    const seqs = binding.eventSource.getSnapshot().entries.map((entry: { event: { seq: number } }) => entry.event.seq)
    expect(seqs).toEqual([...seqs].sort((a: number, b: number) => a - b))
    expect(notified).toBeGreaterThan(0)

    unsubscribe()
    reference.release()
  }, TEST_TIMEOUT)
})
