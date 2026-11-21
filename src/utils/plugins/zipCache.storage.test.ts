import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getSessionPluginCachePath, cleanupSessionPluginCache } from './src/utils/plugins/zipCache.ts'
import { resolveStorageBinding, bindStorageRoot } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
if (process.env.SCENARIO === 'linked') {
  const outside = join(process.env.HOME, 'outside')
  mkdirSync(outside)
  mkdirSync(binding.internalDir, { recursive: true })
  symlinkSync(outside, temporary, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(getSessionPluginCachePath())
  assert.deepEqual(readdirSync(outside), [])
} else {
  const [first, same] = await Promise.all([getSessionPluginCachePath(), getSessionPluginCachePath()])
  assert.equal(first, same)
  assert.equal(dirname(first), temporary)
  if (process.platform !== 'win32') assert.equal(lstatSync(first).mode & 0o777, 0o700)
  writeFileSync(join(first, 'extracted-plugin.json'), '{"unknown":"retained"}')
  assert.equal(await getSessionPluginCachePath(), first)
  await cleanupSessionPluginCache()
  assert.equal(existsSync(first), false)
  assert.deepEqual(readdirSync(temporary), [])
  const second = await getSessionPluginCachePath()
  assert.notEqual(first, second)
  assert.equal(dirname(second), temporary)
  await cleanupSessionPluginCache()
  await cleanupSessionPluginCache()
  assert.deepEqual(readdirSync(temporary), [])
}
`

for (const scenario of ['lifecycle', 'linked']) {
  test(`plugin extraction scratch is private and root-contained: ${scenario}`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'plugin-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, { SCENARIO: scenario, CLAUDE_CONFIG_DIR: join(home, 'product') }),
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
}
