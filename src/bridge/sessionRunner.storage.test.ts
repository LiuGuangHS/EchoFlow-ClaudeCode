import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { spyOn } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const mode = process.env.CASE
let args
spyOn(childProcess, 'spawn').mockImplementation((command, argv) => {
  args = argv
  const child = new EventEmitter()
  child.pid = 99999
  queueMicrotask(() => child.emit('close', 0, null))
  return child
})
if (mode === 'linked') {
  const outside = join(process.env.HOME, 'outside')
  mkdirSync(outside)
  mkdirSync(binding.internalDir, { recursive: true })
  symlinkSync(outside, temporary, 'dir')
}
const { createSessionSpawner } = await import('./src/bridge/sessionRunner.ts')
const spawner = createSessionSpawner({
  execPath: '/fixture-no-execution', scriptArgs: [], env: {},
  verbose: mode !== 'quiet', sandbox: false, onDebug: () => {},
})
const spawn = () => spawner.spawn({ sessionId: '../../fixture-session', sdkUrl: 'ws://127.0.0.1:1', accessToken: 'fake-token' }, process.env.HOME)
if (mode === 'linked') {
  assert.throws(spawn)
  assert.equal(args, undefined)
  assert.deepEqual(readdirSync(join(process.env.HOME, 'outside')), [])
} else {
  assert.equal(await spawn().done, 'completed')
  const flag = args.indexOf('--debug-file')
  if (mode === 'quiet') {
    assert.equal(flag, -1)
    assert.equal(existsSync(temporary), false)
  } else {
    assert.ok(flag >= 0)
    const filename = args[flag + 1]
    assert.equal(dirname(filename), temporary)
    assert.equal(filename, join(temporary, 'bridge-session-______fixture-session.log'))
    writeFileSync(filename, 'fixture log')
    if (process.platform !== 'win32') assert.equal(lstatSync(temporary).mode & 0o777, 0o700)
  }
}
`

for (const mode of ['verbose', 'quiet', 'linked']) {
  test(`bridge session default debug logs stay in the selected root (${mode})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'bridge-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { CASE: mode, CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
