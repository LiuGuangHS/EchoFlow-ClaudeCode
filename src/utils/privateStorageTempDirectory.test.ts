import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixture = `
import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createPrivateStorageTempDirectory } from './src/utils/cachePaths.ts'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'

const binding = resolveStorageBinding()
bindStorageRoot(binding)
const internal = binding.internalDir
const temporary = join(internal, 'tmp')
const scenario = process.env.SCENARIO
if (scenario !== 'missing') mkdirSync(binding.root, { recursive: true })
const target = scenario.startsWith('internal-') ? internal : temporary
if (scenario !== 'missing' && scenario !== 'invalid-prefix') mkdirSync(dirname(target), { recursive: true })
if (scenario !== 'inside-link' && (scenario.endsWith('-link') || scenario.endsWith('-dangling'))) {
  const outside = join(dirname(binding.root), 'outside')
  if (scenario.endsWith('-link')) mkdirSync(outside)
  symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir')
} else if (scenario.endsWith('-file')) writeFileSync(target, 'preserve')
else if (scenario === 'inside-link') {
  const inside = join(binding.root, 'other')
  mkdirSync(inside)
  symlinkSync(inside, temporary, process.platform === 'win32' ? 'junction' : 'dir')
} else if (scenario === 'permissions') {
  mkdirSync(temporary)
  chmodSync(temporary, 0o777)
}
if (scenario === 'invalid-prefix') {
  for (const prefix of ['', '../escape-', 'nested/name-', '/absolute-', 'nul\\0']) {
    await assert.rejects(createPrivateStorageTempDirectory(prefix))
  }
  assert.deepEqual(readdirSync(binding.root), [])
} else if (scenario === 'changed-binding') {
  process.env.CLAUDE_CONFIG_DIR = join(dirname(binding.root), 'other-root')
  await assert.rejects(createPrivateStorageTempDirectory('fixture-'))
  assert.equal(existsSync(process.env.CLAUDE_CONFIG_DIR), false)
} else if (['missing', 'permissions'].includes(scenario)) {
  const first = await createPrivateStorageTempDirectory('fixture-')
  const second = await createPrivateStorageTempDirectory('fixture-')
  assert.notEqual(first, second)
  for (const path of [first, second]) {
    assert.equal(dirname(path), temporary)
    assert.equal(lstatSync(path).isSymbolicLink(), false)
    assert.deepEqual(readdirSync(path), [])
  }
  if (process.platform !== 'win32') {
    for (const path of [temporary, first, second]) assert.equal(lstatSync(path).mode & 0o777, 0o700)
    if (scenario === 'missing') {
      for (const path of [binding.root, internal]) assert.equal(lstatSync(path).mode & 0o777, 0o700)
    }
  }
} else {
  await assert.rejects(createPrivateStorageTempDirectory('fixture-'))
  if (scenario !== 'inside-link' && scenario.endsWith('-link')) assert.deepEqual(readdirSync(join(dirname(binding.root), 'outside')), [])
  if (scenario === 'inside-link') assert.deepEqual(readdirSync(join(binding.root, 'other')), [])
  if (scenario.endsWith('-file')) assert.equal(lstatSync(target).isFile(), true)
}
`

for (const scenario of ['missing', 'permissions', 'invalid-prefix', 'changed-binding', 'internal-link', 'internal-dangling', 'internal-file', 'tmp-link', 'tmp-dangling', 'tmp-file', 'inside-link']) {
  test(`private storage scratch directory: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'private-storage-temp-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../', import.meta.url).pathname,
        env: {
          ...process.env,
          HOME: join(directory, 'home'),
          CLAUDE_CONFIG_DIR: join(directory, 'product'),
          XDG_CONFIG_HOME: join(directory, 'config'),
          XDG_DATA_HOME: join(directory, 'data'),
          SCENARIO: scenario,
        },
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
