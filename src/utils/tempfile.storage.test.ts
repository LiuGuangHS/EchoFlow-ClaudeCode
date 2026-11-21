import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
import { generateTempFilePath } from './src/utils/tempfile.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const mode = process.env.CASE
if (mode === 'tmp-link' || mode === 'internal-link') {
  const outside = join(process.env.HOME, 'outside')
  mkdirSync(outside)
  mkdirSync(mode === 'tmp-link' ? binding.internalDir : binding.root, { recursive: true })
  symlinkSync(outside, mode === 'tmp-link' ? temporary : binding.internalDir, 'dir')
  assert.throws(() => generateTempFilePath())
  assert.deepEqual(readdirSync(outside), [])
} else if (mode === 'invalid') {
  for (const [prefix, extension] of [['../outside', '.md'], ['prefix', '/../outside'], ['prefix', '.md/../../outside']]) {
    assert.throws(() => generateTempFilePath(prefix, extension))
  }
  assert.equal(existsSync(temporary), false)
} else {
  const filename = mode === 'stable'
    ? generateTempFilePath('claude-settings', '.json', { contentHash: '{"extension":"preserved"}' })
    : generateTempFilePath()
  assert.equal(dirname(filename), temporary)
  if (mode === 'stable') {
    const digest = createHash('sha256').update('{"extension":"preserved"}').digest('hex').slice(0, 16)
    assert.equal(filename, join(temporary, 'claude-settings-' + digest + '.json'))
    assert.equal(generateTempFilePath('claude-settings', '.json', { contentHash: '{"extension":"preserved"}' }), filename)
  } else assert.notEqual(generateTempFilePath(), filename)
  assert.equal(existsSync(filename), false)
  writeFileSync(filename, 'fixture')
  unlinkSync(filename)
  assert.deepEqual(readdirSync(temporary), [])
  if (process.platform !== 'win32') assert.equal(lstatSync(temporary).mode & 0o777, 0o700)
}
`

for (const mode of ['stable', 'random', 'tmp-link', 'internal-link', 'invalid']) {
  test(`synchronous scratch file paths use the selected root (${mode})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'tempfile-storage-test-'))
    try {
      const env = createSandboxedTestEnvironment(home, { CASE: mode, CLAUDE_CONFIG_DIR: join(home, 'product') })
      for (let attempt = 0; attempt < (mode === 'stable' ? 2 : 1); attempt++) {
        const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
          cwd: new URL('../../', import.meta.url).pathname,
          env, encoding: 'utf8', timeout: 30_000,
        })
        expect(result.status, result.stderr || result.stdout).toBe(0)
      }
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
