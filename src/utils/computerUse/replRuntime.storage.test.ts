import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { mock, spyOn } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const linked = process.env.CASE === 'linked'
if (linked) {
  mkdirSync(binding.internalDir, { recursive: true })
  mkdirSync(join(process.env.HOME, 'outside'))
  symlinkSync(join(process.env.HOME, 'outside'), temporary, 'dir')
}
// Exercise allocation and build-failure cleanup without invoking a macOS worker.
Object.defineProperty(process, 'platform', { value: 'darwin' })
mock.module('./src/utils/bundledMode.ts', () => ({ isInBundledMode: () => false }))
let directory
spyOn(Bun, 'build').mockImplementation(async options => {
  directory = options.outdir
  assert.ok(existsSync(directory))
  assert.equal(lstatSync(directory).mode & 0o777, 0o700)
  throw new Error('fixture build failure, no worker started')
})
const { ComputerUseRepl } = await import('./src/utils/computerUse/replRuntime.ts')
const runtime = new ComputerUseRepl()
try {
  const result = await runtime.run({ code: '1', timeoutMs: 1000 }, async () => { throw new Error('must not dispatch') })
  assert.equal(result.isError, true)
  if (linked) {
    assert.equal(directory, undefined)
    assert.deepEqual(readdirSync(join(process.env.HOME, 'outside')), [])
  } else {
    assert.ok(directory, JSON.stringify(result))
    assert.equal(dirname(directory), temporary)
    assert.equal(existsSync(directory), false)
    assert.deepEqual(readdirSync(temporary), [])
    assert.ok(result.content.some(block => block.type === 'text' && block.text.includes('fixture build failure')))
  }
} finally { await runtime.reset() }
`

for (const mode of ['build-failure', 'linked']) {
  test(`Computer Use kernel scratch stays in the selected root (${mode})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'cu-repl-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { CASE: mode, CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
