import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../../..')

for (const scenario of ['stopped', 'bind-failed'] as const) {
  test(`public library releases its writer on natural host exit: ${scenario}`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'storage-library-exit-'))
    const env = createSandboxedTestEnvironment(home, {
      CLAUDE_CLI_PATH: join(home, 'env-cli'),
      ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: join(home, 'missing-runtime-settings.json'),
      SERVER_HOST: 'invalid host',
      SERVER_PORT: '-1',
    })
    try {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import fs from 'node:fs/promises'
        import path from 'node:path'
        const loopbackFetch = globalThis.fetch
        globalThis.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input)
          if (url.hostname !== '127.0.0.1') throw new Error('Unexpected network request')
          return loopbackFetch(input, init)
        }
        const cliPath = path.join(process.env.HOME, 'flag-cli.ts')
        await fs.writeFile(cliPath, 'await import(' + JSON.stringify(${JSON.stringify(new URL('./fixtures/mock-sdk-cli.ts', import.meta.url).href)}) + ')')
        process.argv = [process.execPath, 'server', '--cli-path', cliPath, '--host', '127.0.0.1', '--port', '0']
        const { startServer, stopServerRuntimeForShutdown } = await import('./src/server/index.ts')
        assert.equal(process.env.CLAUDE_CLI_PATH, cliPath)
        const writers = path.join(process.env.CLAUDE_CONFIG_DIR, 'echoflow-code', 'migrations', 'writers')
        assert.equal((await fs.readdir(writers)).length, 1)
        try {
          if (${JSON.stringify(scenario)} === 'bind-failed') {
            assert.throws(() => startServer(-1, '127.0.0.1'))
          } else {
            const server = startServer()
            try {
              const base = 'http://127.0.0.1:' + server.port
              const response = await server.fetch(new Request(base + '/health'))
              assert.equal(response.status, 200)
              const created = await fetch(base + '/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workDir: process.env.HOME }),
              })
              assert.ok(created.ok, await created.clone().text())
              const { sessionId } = await created.json()
              const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws/' + sessionId)
              try {
                const reply = await new Promise((resolve, reject) => {
                  let text = ''
                  const timer = setTimeout(() => reject(new Error('No completion from the flag-selected CLI')), 8_000)
                  socket.onmessage = event => {
                    const frame = JSON.parse(String(event.data))
                    if (frame.type === 'connected') socket.send(JSON.stringify({ type: 'user_message', content: 'CLI flag fixture' }))
                    if (frame.type === 'content_delta') text += frame.text
                    if (frame.type === 'message_complete' || frame.type === 'error') {
                      clearTimeout(timer)
                      if (frame.type === 'error') reject(new Error(JSON.stringify(frame)))
                      else resolve(text)
                    }
                  }
                })
                assert.equal(reply, 'Echo: CLI flag fixture')
                const removed = await fetch(base + '/api/sessions/' + sessionId, { method: 'DELETE' })
                assert.ok(removed.ok, await removed.text())
              } finally {
                socket.close()
              }
            } finally {
              await server.stop(true)
            }
          }
        } finally {
          await stopServerRuntimeForShutdown()
        }
        // No internal release or process.exit: the public host lifecycle owns this lease.
      `], { cwd: repository, env, stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, output: code === 0 ? '' : stdout + '\n' + stderr }).toEqual({ code: 0, output: '' })
      expect(stdout).not.toContain('[Server] Received SIGTERM')
      expect(await readdir(join(env.CLAUDE_CONFIG_DIR!, 'echoflow-code', 'migrations', 'writers'))).toEqual([])
    } finally { await rm(home, { recursive: true, force: true }) }
  }, 25_000)
}

for (const scenario of ['unowned', 'ready'] as const) {
  test(`public server library admits storage before business modules: ${scenario}`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'storage-library-'))
    try {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import fs from 'node:fs/promises'
        import path from 'node:path'
        const root = process.env.CLAUDE_CONFIG_DIR
        globalThis.fetch = async () => { throw new Error('Unexpected network request') }
        if (${JSON.stringify(scenario)} === 'unowned') {
          await fs.mkdir(root, { recursive: true })
          await fs.writeFile(path.join(root, 'foreign'), 'unrelated bytes')
          await assert.rejects(import('./src/server/index.ts'), /Unproven|ownership/)
          assert.deepEqual(await fs.readdir(root), ['foreign'])
          assert.equal(await fs.readFile(path.join(root, 'foreign'), 'utf8'), 'unrelated bytes')
        } else {
          const { startServer, stopServerRuntimeForShutdown, quiesceServerRuntimeForMigration } = await import('./src/server/index.ts')
          const writers = path.join(root, 'echoflow-code', 'migrations', 'writers')
          assert.equal((await fs.readdir(writers)).length, 1)
          const server = startServer(0, '127.0.0.1')
          try {
            const response = await server.fetch(new Request('http://127.0.0.1:' + server.port + '/health'))
            assert.equal(response.status, 200)
            assert.equal((await fs.readdir(writers)).length, 1)
          } finally {
            await server.stop(true)
            await stopServerRuntimeForShutdown()
            await quiesceServerRuntimeForMigration(true)
            const { releaseProcessStorage } = await import('./src/services/storageStartup.ts')
            await releaseProcessStorage()
          }
          assert.deepEqual(await fs.readdir(writers), [])
        }
        process.exit(0)
      `], {
        cwd: repository,
        env: createSandboxedTestEnvironment(home),
        stdout: 'pipe', stderr: 'pipe', timeout: 20_000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, output: code === 0 ? '' : stdout + '\n' + stderr }).toEqual({ code: 0, output: '' })
    } finally { await rm(home, { recursive: true, force: true }) }
  }, 25_000)
}
