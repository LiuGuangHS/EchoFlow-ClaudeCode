import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { mock, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import * as childProcess from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const mode = process.env.CASE
if (mode === 'linked') {
  mkdirSync(binding.internalDir, { recursive: true })
  mkdirSync(join(process.env.HOME, 'outside'))
  symlinkSync(join(process.env.HOME, 'outside'), temporary, 'dir')
}
Object.defineProperty(process, 'platform', { value: 'darwin' })
mock.module('./src/utils/debug.ts', () => ({ logForDebugging: () => {} }))
mock.module('./src/utils/computerUse/cuHelperBridge.ts', () => ({ resolveCuHelperAppBundle: () => null }))
const certificates = []
const commands = []
spyOn(childProcess, 'spawnSync').mockImplementation((command, args) => {
  commands.push(command)
  const extraction = args.find(arg => arg.startsWith('--extract-certificates='))
  if (extraction) {
    const prefix = extraction.slice('--extract-certificates='.length)
    const directory = dirname(prefix)
    certificates.push({ directory, permissions: lstatSync(directory).mode & 0o777 })
    if (mode === 'certificate-error') return { status: 1, stdout: '', stderr: 'fixture extraction failure' }
    writeFileSync(prefix + '0', 'fixture certificate bytes, not a real certificate')
    return { status: 0, stdout: '', stderr: '' }
  }
  const identifier = args.at(-1) === process.execPath
    ? 'com.claude-code-haha.desktop.sidecar' : 'dev.cchaha.cu-helper'
  return { status: 0, stdout: '', stderr: 'Identifier=' + identifier + '\\nAuthority=Fixture\\nTeamIdentifier=FIXTURE\\n' }
})
const bytes = Buffer.from('fixture signed bundle bytes')
const hash = createHash('sha256')
for (const relative of [join('Contents', 'MacOS', 'cc-haha-computer-use'), join('Contents', 'Info.plist'), join('Contents', '_CodeSignature', 'CodeResources')]) {
  hash.update(relative).update('\\0').update(bytes).update('\\0')
}
const marker = hash.digest('hex')
const { prepareInstalledHelper } = await import('./src/utils/computerUse/cuHelperInstall.ts')
const result = prepareInstalledHelper({
  sourceApp: join(process.env.HOME, 'Fixture.app', 'Contents', 'Helper.app'),
  configHome: binding.internalDir,
  exists: () => true,
  readFileBytes: () => bytes,
  readMarker: () => marker,
  mkdir: () => {},
  rm: () => {},
  withInstallLock: (_path, operation) => operation(),
  copyApp: () => { throw new Error('fixture forbids installation') },
})
assert.ok(commands.every(command => command === '/usr/bin/codesign'))
if (mode === 'linked') {
  assert.equal(result.helper, null)
  assert.equal(certificates.length, 0)
  assert.deepEqual(readdirSync(join(process.env.HOME, 'outside')), [])
} else {
  assert.equal(certificates.length, mode === 'certificate-error' ? 6 : 3)
  for (const certificate of certificates) {
    assert.equal(dirname(certificate.directory), temporary)
    assert.equal(certificate.permissions, 0o700)
    assert.equal(existsSync(certificate.directory), false)
  }
  assert.deepEqual(readdirSync(temporary), [])
  assert.equal(Boolean(result.helper), mode === 'success')
}
`

for (const mode of ['success', 'certificate-error', 'linked']) {
  test(`helper signature scratch stays private and is removed (${mode})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'cu-signature-storage-test-'))
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
