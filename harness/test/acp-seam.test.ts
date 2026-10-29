import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectAcp } from '../src/acpClient.js'

const TEST_TIMEOUT = 120_000

type GatewayRequest = { url: string | undefined, authorization: string | undefined, body: string }

function startGateway(): Promise<{ server: Server, port: number, requests: GatewayRequest[] }> {
  return new Promise((resolve) => {
    const requests: GatewayRequest[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        requests.push({
          url: req.url,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const chunk = (delta: unknown, finishReason: string | null, usage?: unknown) => {
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-echoflow-loopback',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'echoflow-mock',
            choices: [{ index: 0, delta, finish_reason: finishReason }],
            ...(usage ? { usage } : {}),
          })}\n\n`)
        }
        chunk({ role: 'assistant', content: '' }, null)
        chunk({ content: 'Hello from the EchoFlow loopback gateway' }, null)
        chunk({}, 'stop', { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 })
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('gateway did not bind a TCP port')
      resolve({ server, port: address.port, requests })
    })
  })
}

function snapshotTopLevel(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  try {
    for (const entry of readdirSync(dir).sort()) {
      try {
        const stat = statSync(join(dir, entry))
        snapshot[entry] = `${stat.isDirectory() ? 'dir' : 'file'}:${stat.size}:${stat.mtimeMs}`
      } catch {
        snapshot[entry] = 'unreadable'
      }
    }
  } catch {
    return snapshot
  }
  return snapshot
}

function topLevelNames(dir: string): string[] {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

describe('the ACP seam boots our own launcher and completes one prompt', () => {
  let sandbox: string
  let home: string
  let dshHome: string
  let agentsHome: string
  let workspace: string
  let gateway: Awaited<ReturnType<typeof startGateway>>
  let session: Awaited<ReturnType<typeof connectAcp>>
  let initialization: { agentInfo?: { name?: string }, agentCapabilities?: unknown }
  let newSession: { sessionId: string, configOptions?: unknown }
  let realHomeBefore: Record<string, Record<string, string>> = {}
  let realClaudeBefore: string[] = []
  // Only dsh-owned directories are compared in full. `~/.claude` belongs to
  // whatever Claude Code session is running these tests, so its files change
  // for reasons that have nothing to do with the launcher; a new top-level
  // entry there is still a meaningful canary for a leaked HOME.
  const realHomes = () => [
    join(process.env.HOME ?? '', '.dsh'),
    join(process.env.HOME ?? '', '.agents'),
  ].filter(path => path.length > 6)
  const realClaude = () => join(process.env.HOME ?? '', '.claude')

  beforeAll(async () => {
    realHomeBefore = Object.fromEntries(realHomes().map(dir => [dir, snapshotTopLevel(dir)]))
    realClaudeBefore = topLevelNames(realClaude())
    sandbox = mkdtempSync(join(tmpdir(), 'echoflow-acp-seam-'))
    home = join(sandbox, 'home')
    dshHome = join(sandbox, 'dsh-home')
    agentsHome = join(sandbox, 'agents-home')
    workspace = join(sandbox, 'workspace')
    for (const dir of [home, dshHome, agentsHome, workspace]) mkdirSync(dir, { recursive: true })

    gateway = await startGateway()

    writeFileSync(join(dshHome, 'cordis.patch.yml'), [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      echoflow:',
      '        displayName: EchoFlow loopback',
      '        api: openai-completions',
      `        baseURL: http://127.0.0.1:${gateway.port}/v1`,
      '        apiKeyEnv: ECHOFLOW_API_KEY',
      '        models:',
      '          - id: echoflow-mock',
      '            name: EchoFlow Mock',
      '            contextWindow: 128000',
      '- id: agent-default-model',
      '  config:',
      '    provider: echoflow',
      '    model: echoflow-mock',
      '- id: acp',
      '  config:',
      '    provider: echoflow',
      '    model: echoflow-mock',
      '',
    ].join('\n'))

    session = await connectAcp({
      cwd: workspace,
      env: {
        HOME: home,
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: agentsHome,
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_DATA_HOME: join(home, '.local', 'share'),
        XDG_CACHE_HOME: join(home, '.cache'),
        PATH: process.env.PATH ?? '',
        LANG: process.env.LANG ?? 'C.UTF-8',
        ECHOFLOW_API_KEY: 'echoflow-test-key',
      },
    })

    initialization = await session.initialize()
    newSession = await session.newSession({ cwd: workspace, mcpServers: [] })
  }, TEST_TIMEOUT)

  afterAll(async () => {
    await session?.close()
    await new Promise<void>((resolve) => gateway?.server.close(() => resolve()))
    if (sandbox) rmSync(sandbox, { recursive: true, force: true })
  })

  test('initialize identifies the dsh runtime', () => {
    expect(initialization.agentInfo?.name).toBe('deepseek-harness-acp')
    expect(initialization.agentCapabilities).toBeTruthy()
  }, TEST_TIMEOUT)

  test('session/new returns a session and no DeepSeek route', () => {
    expect(newSession.sessionId.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(newSession.configOptions ?? {})
    expect(serialized).not.toContain('deepseek-official')
    expect(serialized).not.toContain('deepseek-account')
  }, TEST_TIMEOUT)

  test('one prompt reaches the EchoFlow loopback gateway and ends the turn', async () => {
    const before = gateway.requests.length
    const result = await session.prompt('Say hello')
    expect(result.text).toContain('Hello from the EchoFlow loopback gateway')
    expect(result.stopReason).toBe('end_turn')
    expect(gateway.requests.length).toBeGreaterThan(before)
    const request = gateway.requests.at(-1)
    expect(request?.url).toContain('/chat/completions')
    expect(request?.authorization).toBe('Bearer echoflow-test-key')
    const body = JSON.parse(request?.body ?? '{}')
    expect(body.model).toBe('echoflow-mock')
    expect(body.stream).toBe(true)
  }, TEST_TIMEOUT)

  test('the sandbox home received the runtime state, not the real home', () => {
    expect(readdirSync(dshHome).length).toBeGreaterThan(0)
    for (const dir of realHomes()) {
      expect(snapshotTopLevel(dir), `${dir} must not change`).toEqual(realHomeBefore[dir])
    }
    expect(topLevelNames(realClaude()), 'no new entry may appear in ~/.claude').toEqual(realClaudeBefore)
  }, TEST_TIMEOUT)

  test('closing the client ends the process successfully', async () => {
    const exit = await session.close()
    expect(exit.code).toBe(0)
    expect(exit.stderr).not.toContain('Error:')
  }, TEST_TIMEOUT)
})
