import { expect, it } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment.js'
import { ensureEchoFlowConfigRoot } from '../../../src/utils/echoFlowConfigRoot.js'

const run = promisify(execFile)
const entry = fileURLToPath(new URL('../index.ts', import.meta.url))
const runtime = fileURLToPath(new URL('../runtime.ts', import.meta.url))
const lifecycle = fileURLToPath(new URL('../../common/migration-lifecycle.ts', import.meta.url))
const attachmentStore = fileURLToPath(new URL('../../common/attachment/attachment-store.ts', import.meta.url))

it.each(['idle poll', 'active reply', 'pending attachment GC'] as const)('quiesces WeChat during %s without consuming late updates', async (scenario) => {
  const home = await mkdtemp(join(tmpdir(), 'wechat-quiesce-'))
  const root = join(home, 'data')
  try {
    await ensureEchoFlowConfigRoot(root)
    await writeFile(join(root, 'adapters.json'), JSON.stringify({
      serverUrl: 'ws://fixture.invalid',
      wechat: { accountId: 'fixture-account', botToken: 'fixture-token', baseUrl: 'https://fixture.invalid' },
      pairing: { code: 'ABC234', expiresAt: Date.now() + 60_000 },
    }))
    const { stdout } = await run(process.execPath, ['--no-env-file', '--eval', `
      import assert from 'node:assert/strict'
      import { readFile, readdir } from 'node:fs/promises'
      import { join } from 'node:path'
      const root = process.env.CLAUDE_CONFIG_DIR
      const config = join(root, 'adapters.json')
      const initial = await readFile(config, 'utf8')
      const writers = join(root, 'echoflow-code/migrations/writers')
      const active = ${scenario === 'active reply'}
      const pendingGc = ${scenario === 'pending attachment GC'}
      const message = (id, text) => ({
        message_id: id, from_user_id: 'fixture-user-' + id, item_list: [{ type: 1, text_item: { text } }],
      })
      const late = message(2, 'ABC234')
      const started = Promise.withResolvers()
      const finishReply = Promise.withResolvers()
      let aborted = false
      let polls = 0
      let replies = 0
      globalThis.fetch = (url, init) => {
        switch (new URL(url).pathname) {
          case '/ilink/bot/getupdates':
            polls++
            if (active) return Response.json({ msgs: [message(1, 'ordinary message'), late] })
            return new Promise(resolve => {
              init.signal.addEventListener('abort', () => {
                aborted = true
                // A response can win the race with transport cancellation.
                resolve(Response.json({ msgs: [late] }))
              }, { once: true })
              started.resolve()
            })
          case '/ilink/bot/sendmessage':
            replies++
            started.resolve()
            return finishReply.promise
          default: throw new Error('Unexpected fixture request: ' + url)
        }
      }
      const finishGc = Promise.withResolvers()
      let gcCalls = 0
      if (pendingGc) {
        const { AttachmentStore } = await import(${JSON.stringify(attachmentStore)})
        // Hold the cleanup work while leaving AttachmentStore.gc() lifecycle tracking intact.
        AttachmentStore.prototype.gcOnce = () => {
          gcCalls++
          return finishGc.promise
        }
        await import(${JSON.stringify(runtime)})
        assert.equal(gcCalls, 0, 'importing the runtime must not start attachment GC')
      }
      const { adapterMigrationLifecycle, quiesceAdapterProcess } = await import(${JSON.stringify(lifecycle)})
      process.argv.push('--wechat')
      await import(${JSON.stringify(entry)})
      if (pendingGc) assert.equal(gcCalls, 1, 'starting the adapter must start attachment GC')
      let stage = 'fixture transport did not start'
      const watchdog = setTimeout(() => { throw new Error(stage) }, 2_000)
      await started.promise
      stage = 'WeChat migration quiescence did not complete before the fixture deadline'
      const shutdownStarted = Promise.withResolvers()
      adapterMigrationLifecycle.registerShutdown(shutdownStarted.resolve)
      let drained = false
      const shuttingDown = quiesceAdapterProcess()
      const draining = adapterMigrationLifecycle.quiesce().then(() => { drained = true })
      if (active || pendingGc) {
        await shutdownStarted.promise
        await new Promise(setImmediate)
        if (active) {
          assert.equal(drained, false, 'quiescence must wait for the reply already in progress')
          finishReply.resolve(Response.json({ ret: 0 }))
        }
        if (pendingGc) {
          assert.equal(aborted, true, 'attachment GC must not delay poll cancellation')
          assert.equal(drained, false, 'quiescence must wait for pending attachment GC')
          assert.equal((await readdir(writers)).length, 1, 'attachment GC must retain the writer lease')
          finishGc.resolve({ removed: 0, bytes: 0 })
        }
      }
      await Promise.all([draining, shuttingDown])
      clearTimeout(watchdog)
      if (!active) assert.equal(aborted, true, 'the outstanding long poll must be cancelled')
      assert.equal(polls, 1)
      assert.equal(replies, active ? 1 : 0)
      assert.equal(await readFile(config, 'utf8'), initial, 'late update must not write pairing state')
      assert.deepEqual(await readdir(writers), [])
      console.log('WECHAT_QUIESCED')
    `], {
      cwd: home,
      env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: root }),
      timeout: 8_000,
      killSignal: 'SIGKILL',
    })
    expect(stdout).toContain('WECHAT_QUIESCED')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 10_000)
