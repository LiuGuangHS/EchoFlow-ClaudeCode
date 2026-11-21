import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readAppIconPng } from './src/server/services/macAppIcon.ts'
import { resolveStorageBinding, bindStorageRoot } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
let scratch
const fail = process.env.FAIL === '1'
Bun.spawn = command => {
  assert.equal(command[0], '/usr/bin/sips')
  const output = command[command.indexOf('--out') + 1]
  scratch = dirname(output)
  assert.equal(dirname(scratch), temporary)
  if (process.platform !== 'win32') assert.equal(lstatSync(scratch).mode & 0o777, 0o700)
  if (!fail) writeFileSync(output, new Uint8Array([1, 2, 3]))
  return { exited: Promise.resolve(fail ? 1 : 0) }
}
const result = await readAppIconPng('/fixture/App.app', 64, {
  readIconFileName: async () => 'AppIcon',
  pathExists: async () => true,
})
assert.ok(scratch)
assert.deepEqual(result, fail ? null : new Uint8Array([1, 2, 3]))
assert.equal(existsSync(scratch), false)
assert.deepEqual(readdirSync(temporary), [])
`

for (const fail of [false, true]) {
  test(`application icon scratch stays root-contained and is removed (conversion failure=${fail})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'icon-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { FAIL: fail ? '1' : '0', CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
