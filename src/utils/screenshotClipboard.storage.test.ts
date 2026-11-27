import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const outcome = process.env.OUTCOME
const temporary = join(binding.internalDir, 'tmp')
let screenshot
let commandCount = 0
mock.module('./src/utils/ansiToPng.ts', () => ({ ansiToPng: () => {
  if (outcome === 'render-error') throw new Error('fixture render failed')
  return new Uint8Array([1, 2, 3])
} }))
mock.module('./src/utils/platform.ts', () => ({ getPlatform: () => 'linux' }))
mock.module('./src/utils/log.ts', () => ({ logError: () => {} }))
mock.module('./src/utils/execFileNoThrow.ts', () => ({ execFileNoThrowWithCwd: async (command, args) => {
  commandCount++
  if (command === 'xclip') {
    screenshot = args[args.indexOf('-i') + 1]
    assert.deepEqual(Array.from(readFileSync(screenshot)), [1, 2, 3])
    if (outcome === 'throw') throw new Error('fixture clipboard failed')
  } else assert.equal(command, 'xsel')
  return { code: outcome === 'success' ? 0 : 1, stdout: '', stderr: 'fixture unavailable' }
} }))
const { copyAnsiToClipboard } = await import('./src/utils/screenshotClipboard.ts')
const result = await copyAnsiToClipboard('fixture text')
assert.equal(result.success, outcome === 'success')
if (outcome === 'render-error') assert.equal(commandCount, 0)
else {
  assert.ok(screenshot)
  assert.equal(dirname(dirname(screenshot)), temporary)
  assert.equal(existsSync(screenshot), false)
  assert.equal(existsSync(dirname(screenshot)), false)
}
assert.deepEqual(readdirSync(temporary), [])
if (process.platform !== 'win32') assert.equal(lstatSync(temporary).mode & 0o777, 0o700)
`

for (const outcome of ['success', 'failure', 'throw', 'render-error']) {
  test(`clipboard screenshot scratch is root-contained and cleaned (${outcome})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'clipboard-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { OUTCOME: outcome, CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
