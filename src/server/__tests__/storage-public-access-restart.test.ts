import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../../..')

// Separate processes prove that neither device authorization nor history comes from a singleton.
const fixture = `
  import assert from 'node:assert/strict'
  import fs from 'node:fs/promises'
  import path from 'node:path'
  const home = process.env.HOME
  const root = process.env.CLAUDE_CONFIG_DIR
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname !== '127.0.0.1') throw new Error('Public network disabled in storage restart fixture')
    return originalFetch(input, options)
  }
  const { mock } = await import('bun:test')
  // The previous process has exited; only OS inventory is replaced, never migration or consumers.
  const inventory = await import('./src/server/migrationInventory.ts')
  mock.module('./src/server/migrationInventory.ts', () => ({
    ...inventory,
    assertMigrationQuiescent: async (roots, owned) => {
      assert.ok(roots.length > 0)
      assert.ok(roots.every(value => value.startsWith(home + path.sep)))
      assert.deepEqual(owned, [process.pid])
    },
  }))
  const { releaseProcessStorage } = await import('./src/services/storageStartup.ts')
  const { startServer, stopServerRuntimeForShutdown, quiesceServerRuntimeForMigration } = await import('./src/server/index.ts')
  const server = startServer(0, '127.0.0.1')
  const base = 'http://127.0.0.1:' + server.port
  const origin = 'https://storage-fixture.invalid'
  const control = (route, body) => fetch(base + '/api/public-access' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + process.env.CC_HAHA_LOCAL_ACCESS_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = async response => {
    assert.equal(response.ok, true, await response.clone().text())
    return response.json()
  }
  const checkpoint = path.join(home, 'restart-checkpoint.json')
  try {
    if (process.env.PHASE === 'pair') {
      const enabled = await json(await control('/enable', { publicUrl: origin }))
      const remote = 'http://127.0.0.1:' + enabled.port
      const pairing = await json(await control('/pairing', {}))
      const pending = await json(await fetch(remote + '/api/public-access/pair', {
        method: 'POST', headers: { Origin: origin },
        body: JSON.stringify({ secret: pairing.secret, name: 'Storage fixture browser' }),
      }))
      await json(await control('/approve', { id: pending.id }))
      const claim = await fetch(remote + '/api/public-access/claim', {
        method: 'POST', headers: { Origin: origin }, body: JSON.stringify(pending),
      })
      assert.equal(claim.ok, true)
      const cookie = claim.headers.get('set-cookie').split(';')[0]
      const workspace = path.join(home, 'workspace')
      await fs.mkdir(workspace)
      const created = await json(await fetch(remote + '/api/sessions', {
        method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: workspace, permissionMode: 'default' }),
      }))
      const { sessionService } = await import('./src/server/services/sessionService.ts')
      const found = await sessionService.findSessionFile(created.sessionId)
      assert.ok(found)
      const record = JSON.stringify({ type: 'assistant', uuid: crypto.randomUUID(), sessionId: created.sessionId,
        timestamp: new Date().toISOString(), unknown: { preserve: true },
        message: { role: 'assistant', content: [{ type: 'text', text: 'history-survives-storage-restart' }] } }) + '\\n'
      await fs.appendFile(found.filePath, record)
      const devicesFile = path.join(root, 'echoflow-code', 'public-access-devices.json')
      const devices = JSON.parse(await fs.readFile(devicesFile, 'utf8'))
      devices.unknown = { preserve: true }
      await fs.writeFile(devicesFile, JSON.stringify(devices))
      await fs.writeFile(checkpoint, JSON.stringify({ port: enabled.port, cookie, deviceId: pending.id,
        sessionId: created.sessionId, transcript: path.relative(root, found.filePath),
        raw: (await fs.readFile(found.filePath)).toString('base64'), oldRoot: root }))
    } else {
      const saved = JSON.parse(await fs.readFile(checkpoint, 'utf8'))
      await assert.rejects(fs.lstat(saved.oldRoot), { code: 'ENOENT' })
      assert.equal((await fs.readFile(path.join(root, saved.transcript))).toString('base64'), saved.raw)
      const enabled = await json(await control('/enable', { publicUrl: origin, port: saved.port }))
      assert.equal(enabled.port, saved.port)
      assert.ok(enabled.devices.some(device => device.id === saved.deviceId))
      const remote = 'http://127.0.0.1:' + saved.port
      const route = remote + '/api/sessions/' + saved.sessionId + '/messages'
      assert.equal((await fetch(route, { headers: { Origin: origin } })).status, 401)
      const restored = await fetch(route, { headers: { Origin: origin, Cookie: saved.cookie } })
      assert.equal(restored.status, 200)
      assert.ok((await restored.text()).includes('history-survives-storage-restart'))
      const devices = JSON.parse(await fs.readFile(path.join(root, 'echoflow-code', 'public-access-devices.json'), 'utf8'))
      assert.deepEqual(devices.unknown, { preserve: true })
      assert.equal((await fs.readFile(path.join(root, saved.transcript))).toString('base64'), saved.raw)
      await assert.rejects(fs.lstat(saved.oldRoot), { code: 'ENOENT' })
    }
  } finally {
    await server.stop(true)
    await stopServerRuntimeForShutdown()
    await quiesceServerRuntimeForMigration(true)
    await releaseProcessStorage()
  }
  assert.deepEqual(await fs.readdir(path.join(root, 'echoflow-code', 'migrations', 'writers')), [])
  process.exit(0)
`

test('fixed-port browser authorization and transcript bytes survive migration and a real server process restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'storage-public-restart-'))
  const env = createSandboxedTestEnvironment(home, { CC_HAHA_LOCAL_ACCESS_TOKEN: 'fixture-local-credential' })
  const oldRoot = join(env.XDG_CONFIG_HOME!, 'claude-code-desktop')
  try {
    for (const phase of ['pair', 'restore']) {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', fixture], {
        cwd: repository,
        env: { ...env, PHASE: phase, CLAUDE_CONFIG_DIR: phase === 'pair' ? oldRoot : join(home, 'selected-café') },
        stdout: 'pipe', stderr: 'pipe', timeout: 25_000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ phase, code, output: code === 0 ? '' : stdout + '\n' + stderr }).toEqual({ phase, code: 0, output: '' })
    }
  } finally { await rm(home, { recursive: true, force: true }) }
}, 60_000)
