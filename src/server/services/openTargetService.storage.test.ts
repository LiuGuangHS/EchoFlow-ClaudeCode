import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { spyOn } from 'bun:test'
import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveStorageBinding, bindStorageRoot } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
let scratch
const fail = process.env.FAIL === '1'
const convert = async (command, args) => {
  assert.equal(command, '/usr/bin/sips')
  const output = args[args.indexOf('--out') + 1]
  scratch = dirname(output)
  if (fail) throw new Error('fixture conversion failed')
  writeFileSync(output, new Uint8Array([1, 2, 3]))
  return { stdout: '', stderr: '' }
}
const exec = spyOn(childProcess, 'execFile').mockImplementation(() => { throw new Error('Expected promisified conversion') })
Object.defineProperty(exec, promisify.custom, { value: convert, configurable: true })
const { createOpenTargetService } = await import('./src/server/services/openTargetService.ts')
const service = createOpenTargetService({
  platform: 'darwin', commandExists: async () => false, resolveCommand: async () => null,
  pathExists: async () => true, readPlistValue: async () => 'AppIcon',
  readDirNames: async () => ['AppIcon.icns'],
})
const result = service.getTargetIcon('vscode')
if (fail) await assert.rejects(result, /fixture conversion failed/)
else assert.deepEqual(Array.from((await result).data), [1, 2, 3])
assert.ok(scratch)
const temporary = join(binding.internalDir, 'tmp')
assert.equal(dirname(scratch), temporary)
assert.equal(existsSync(scratch), false)
assert.deepEqual(readdirSync(temporary), [])
`

for (const fail of [false, true]) {
  test(`open-target icon scratch is root-contained and removed (conversion failure=${fail})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'open-target-storage-test-'))
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
