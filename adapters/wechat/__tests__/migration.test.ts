import { afterEach, beforeEach, expect, it } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import { ensureEchoFlowConfigRoot, getEchoFlowInternalDir } from '../../../src/utils/echoFlowConfigRoot.js'

const repo = resolve(import.meta.dirname, '../../..')
const token = 'fixture-migration-token'
const sidecarStartupTimeout = 15_000
let home: string
let data: string
let writers: string
let pairing: { code: string; expiresAt: number; createdAt: number }
let child: ChildProcessWithoutNullStreams | undefined
let closed: Promise<number | null> | undefined
let server: Bun.Server<undefined> | undefined
let stdout: string
let stderr: string

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'wechat-migration-')))
  data = join(home, 'data')
  writers = join(getEchoFlowInternalDir(data), 'migrations', 'writers')
  pairing = { code: 'ABC234', expiresAt: Date.now() + 60_000, createdAt: Date.now() }
  stdout = stderr = ''
  await ensureEchoFlowConfigRoot(data)
  await writeFile(join(data, 'adapters.json'), JSON.stringify({ wechat: { allowedUsers: ['authorized'] }, pairing }))
})

afterEach(async () => {
  if (child?.exitCode === null) child.kill('SIGKILL')
  await closed?.catch(() => {})
  await server?.stop(true)
  await rm(home, { recursive: true, force: true })
  child = closed = server = undefined
})

function start(fetch: (req: Request, server: Bun.Server<undefined>) => Response | undefined | Promise<Response | undefined>): void {
  server = Bun.serve<undefined>({ hostname: '127.0.0.1', port: 0, fetch, websocket: { message() {} } })
  const running = spawn(process.execPath, ['--no-env-file', join(repo, 'desktop/sidecars/claude-sidecar.ts'), 'adapters', '--app-root', repo, '--wechat'], {
    cwd: home,
    env: createSandboxedTestEnvironment(home, {
      CLAUDE_CONFIG_DIR: data,
      CC_HAHA_MIGRATION_CONTROL: '1',
      CC_HAHA_LOCAL_ACCESS_TOKEN: token,
      ADAPTER_SERVER_URL: `ws://${server.url.host}`,
      ADAPTER_DEFAULT_PROJECT_DIR: home,
      WECHAT_ACCOUNT_ID: 'fixture-account',
      WECHAT_BOT_TOKEN: 'fixture-bot-token',
      WECHAT_BASE_URL: server.url.href,
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child = running
  running.stdout.on('data', chunk => { stdout += String(chunk) })
  running.stderr.on('data', chunk => { stderr += String(chunk) })
  running.stdin.on('error', () => {})
  closed = new Promise((resolve, reject) => {
    running.once('error', reject)
    running.once('close', resolve)
  })
}

function quiesce(): void {
  child!.stdin.write(JSON.stringify({ type: 'migration_quiesce', requestId: 'stop', token }) + '\n')
}

async function eventually(assertion: () => void, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try { assertion(); return } catch (error) {
      if (Date.now() >= deadline) throw error
      await Bun.sleep(10)
    }
  }
}

async function expectStopped(timeoutMs?: number): Promise<void> {
  await eventually(() => expect(stdout, stderr).toContain('{"type":"migration_quiesced","requestId":"stop"}'), timeoutMs)
  expect(await closed, stderr).toBe(0)
  expect(await readdir(writers)).toEqual([])
}

function message(id: number, user: string, text: string) {
  return { message_id: id, from_user_id: user, item_list: [{ type: 1, text_item: { text } }] }
}

it('stops the configured sidecar and releases its writer lease while a long poll is held', async () => {
  let polls = 0
  const held = Promise.withResolvers<Response>()
  start(request => {
    if (new URL(request.url).pathname !== '/ilink/bot/getupdates') return new Response(null, { status: 404 })
    polls++
    return held.promise
  })
  try {
    await eventually(() => expect(polls, stderr).toBe(1), sidecarStartupTimeout)
    expect(await readdir(writers)).toHaveLength(1)
    quiesce()
    await expectStopped(2000)
    expect(polls).toBe(1)
  } finally {
    held.resolve(Response.json({ msgs: [message(1, 'unpaired', pairing.code)] }))
  }
  expect(JSON.parse(await readFile(join(data, 'adapters.json'), 'utf8')).pairing).toEqual(pairing)
}, 25_000)

it('cancels the retry delay without making another poll', async () => {
  let polls = 0
  start(() => {
    polls++
    return Response.json({ ret: 1, errmsg: 'fixture upstream failure' })
  })
  await eventually(() => expect(stderr).toContain('fixture upstream failure'), sidecarStartupTimeout)
  quiesce()
  await expectStopped(2000)
  expect(polls).toBe(1)
}, 25_000)

it('drains a session write already accepted and skips the rest of the poll batch', async () => {
  const createSession = Promise.withResolvers<Response>()
  const deniedReply = Promise.withResolvers<Response>()
  let polls = 0
  let creating = false
  const replies: string[] = []
  const leaseChanges: boolean[] = []
  start(async (request, server) => {
    switch (new URL(request.url).pathname) {
      case '/ilink/bot/getupdates':
        polls++
        return Response.json({ msgs: [
          message(1, 'authorized', '/new'),
          message(2, 'unpaired', '/help'),
          message(3, 'unpaired', pairing.code),
        ] })
      case '/ilink/bot/sendmessage': {
        const { msg } = await request.json() as { msg: { item_list: [{ text_item: { text: string } }] } }
        const text = msg.item_list[0].text_item.text
        replies.push(text)
        return text.startsWith('未授权') ? deniedReply.promise : Response.json({ ret: 0 })
      }
      case '/api/sessions/power-activity-lease':
        leaseChanges.push((await request.json() as { active: boolean }).active)
        return Response.json({ ok: true })
      case '/api/sessions':
        creating = true
        return createSession.promise
      case '/ws/fixture-session':
        if (server.upgrade(request, { data: undefined })) return
    }
    return new Response(null, { status: 404 })
  })
  try {
    await eventually(() => {
      expect(creating, stderr).toBe(true)
      expect(replies[0]).toStartWith('未授权')
    }, sidecarStartupTimeout)
    quiesce()
    await eventually(() => expect(stdout, stderr).toContain('Shutting down'))
    deniedReply.resolve(Response.json({ ret: 0 }))
    expect(await readdir(writers)).toHaveLength(1)
    expect(JSON.parse(await readFile(join(data, 'adapter-sessions.json'), 'utf8')).authorized).toBeUndefined()
    expect(stdout).not.toContain('migration_quiesced')
    createSession.resolve(Response.json({ sessionId: 'fixture-session' }))
    await expectStopped()
    expect(polls).toBe(1)
    expect(replies).toHaveLength(2)
    expect(replies[1]).toBe('已新建会话，可以开始对话了。')
    expect(leaseChanges).toEqual([true, false])
    expect(JSON.parse(await readFile(join(data, 'adapter-sessions.json'), 'utf8')).authorized).toMatchObject({
      sessionId: 'fixture-session', workDir: home,
    })
    expect(JSON.parse(await readFile(join(data, 'adapters.json'), 'utf8')).pairing).toEqual(pairing)
  } finally {
    deniedReply.resolve(Response.json({ ret: 0 }))
    createSession.resolve(Response.json({ sessionId: 'fixture-session' }))
  }
}, 30_000)
