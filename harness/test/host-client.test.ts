import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectDshHost } from '../src/hostClient.js'
import { startDshHost } from '../src/hostProcess.js'

const TEST_TIMEOUT = 60_000

function sandboxEnv(root: string) {
  const home = join(root, 'home')
  const dshHome = join(root, 'dsh-home')
  const config = join(root, 'config')
  mkdirSync(home, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(config, { recursive: true })
  return {
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    DSH_HOME: dshHome,
    PATH: process.env.PATH ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
  }
}

describe('the official dsh Host seam', () => {
  const hosts: Array<{ close(): Promise<void> }> = []
  const clients: Array<{ close(): Promise<void> }> = []
  const sandboxes: string[] = []

  afterEach(async () => {
    while (clients.length > 0) await clients.pop()?.close()
    while (hosts.length > 0) await hosts.pop()?.close()
    while (sandboxes.length > 0) rmSync(sandboxes.pop()!, { recursive: true, force: true })
  })

  test('boots on loopback and authenticates the one-time connect token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echoflow-dsh-host-'))
    sandboxes.push(root)
    const host = await startDshHost({ cwd: join(root, 'workspace'), env: sandboxEnv(root) })
    hosts.push(host)

    expect(new URL(host.origin).hostname).toBe('127.0.0.1')
    const response = await fetch(`${host.origin}/connect?token=${encodeURIComponent(host.token)}&interactions=answer`, {
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('set-cookie')).toMatch(/^\S+=\S+; Max-Age=/)
    expect(response.headers.get('location')).toBe('./api/remote.mux')
    const repeated = await fetch(`${host.origin}/connect?token=${encodeURIComponent(host.token)}&interactions=answer`)
    expect(repeated.status).toBe(401)

    for (const service of [
      'agentDefaultModel', 'agents', 'attachments', 'fileUploads', 'fs', 'llm',
      'remoteAccess', 'sessions', 'sessionProjections', 'sessionQuery', 'typert',
      'workspaceRegistry',
    ]) {
      expect(host.ctx.get(service), `missing Host service ${service}`).toBeTruthy()
    }
  }, TEST_TIMEOUT)

  test('connects through the official Node client transport', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echoflow-dsh-host-'))
    sandboxes.push(root)
    const host = await startDshHost({ cwd: join(root, 'workspace'), env: sandboxEnv(root) })
    hosts.push(host)
    expect(host.origin).toMatch(/^http:\/\/127\.0\.0\.1:/)
  }, TEST_TIMEOUT)

  test('rejects an invalid token and invalid interactions declaration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echoflow-dsh-host-'))
    sandboxes.push(root)
    const host = await startDshHost({ cwd: join(root, 'workspace'), env: sandboxEnv(root) })
    hosts.push(host)

    const headers = { host: new URL(host.origin).host }
    const invalidToken = await fetch(`${host.origin}/connect?token=wrong&interactions=answer`, { headers })
    expect(invalidToken.status).toBe(401)
    const invalidInteractions = await fetch(`${host.origin}/connect?token=${encodeURIComponent(host.token)}&interactions=maybe`, { headers })
    expect(invalidInteractions.status).toBe(400)
  }, TEST_TIMEOUT)

  test('lists sessions through the mounted Remote session namespace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echoflow-dsh-host-'))
    sandboxes.push(root)
    const host = await startDshHost({ cwd: join(root, 'workspace'), env: sandboxEnv(root) })
    hosts.push(host)
    const client = await connectDshHost({ origin: host.origin, token: host.token })
    clients.push(client)

    const listed = await client.remote.session.list({})
    expect(listed).toMatchObject({ ok: true })
  }, TEST_TIMEOUT)

  test('opens the Remote stream WebSocket and follows a session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echoflow-dsh-host-'))
    sandboxes.push(root)
    const host = await startDshHost({ cwd: join(root, 'workspace'), env: sandboxEnv(root) })
    hosts.push(host)
    const client = await connectDshHost({ origin: host.origin, token: host.token })
    clients.push(client)

    const created = await client.remote.session.create({ cwd: join(root, 'workspace') })
    expect(created).toMatchObject({ ok: true })
    const abort = new AbortController()
    const stream = client.remote.session.follow({ address: { kind: 'session', sessionId: created.value.sessionId } }, abort.signal)
    try {
      const first = await Promise.race([
        stream[Symbol.asyncIterator]().next(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('no follow frame within 10s')), 10_000)),
      ])
      expect(first.value).toMatchObject({ type: 'snapshot' })
    } finally {
      abort.abort()
    }
  }, TEST_TIMEOUT)
})
