import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const fixture = `
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const outcome = process.env.OUTCOME
assert.equal(homedir(), process.env.HOME)
if (outcome !== 'missing-auth') {
  writeFileSync(join(homedir(), '.npmrc'), outcome === 'no-token' ? 'registry=https://fixture.invalid\\n' : '//artifactory.infra.ant.dev/artifactory/api/npm/npm-all/:_authToken=fixture-token\\n')
}
const linked = outcome.endsWith('-link')
const outside = join(process.env.HOME, 'outside')
if (linked) {
  mkdirSync(outside)
  writeFileSync(join(outside, 'sentinel'), 'preserve')
  mkdirSync(binding.root, { recursive: true })
  const target = outcome === 'internal-link' ? binding.internalDir : temporary
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir')
}
const events = []
const errors = []
let config = { unrelated: 'preserve' }
let saves = 0
mock.module('./src/services/analytics/index.ts', () => ({ logEvent: name => events.push(name) }))
mock.module('./src/bootstrap/state.ts', () => ({ getIsScrollDraining: () => false, getOriginalCwd: () => process.cwd(), addSlowOperation: () => {} }))
mock.module('./src/services/mcp/client.ts', () => ({ callIdeRpc: () => { throw new Error('unexpected IDE RPC') } }))
mock.module('./src/utils/config.ts', () => ({
  getGlobalConfig: () => config,
  saveGlobalConfig: update => { saves++; config = update(config) },
}))
mock.module('./src/utils/env.ts', () => ({ env: { terminal: 'vscode' } }))
mock.module('./src/utils/envDynamic.ts', () => ({ envDynamic: { terminal: 'vscode' } }))
mock.module('./src/utils/genericProcessUtils.ts', () => ({ getAncestorPidsAsync: () => { throw new Error('unexpected process lookup') } }))
mock.module('./src/utils/jetbrains.ts', () => ({ isJetBrainsPluginInstalledCached: () => { throw new Error('unexpected JetBrains lookup') } }))
mock.module('./src/utils/platform.ts', () => ({ getPlatform: () => 'linux' }))
mock.module('./src/utils/log.ts', () => ({ logError: error => errors.push(String(error)) }))
mock.module('./src/utils/debug.ts', () => ({ logForDebugging: () => {} }))
mock.module('./src/utils/sleep.ts', () => ({ sleep: async delay => assert.equal(delay, 500) }))
mock.module('execa', () => ({ execa: () => { throw new Error('unexpected external process') } }))
const requests = []
const downloadDirectories = []
const privateModes = []
const axiosFailure = new Error('fixture download failed')
const versionUrl = 'https://artifactory.infra.ant.dev/artifactory/armorcode-claude-code-internal/claude-vscode-releases/stable'
mock.module('axios', () => ({ default: {
  isAxiosError: error => error === axiosFailure,
  get: async (url, options) => {
    requests.push(url)
    assert.deepEqual(options.headers, { Authorization: 'Bearer fixture-token' })
    if (url === versionUrl) {
      assert.equal(options.responseType, undefined)
      return { data: outcome === 'empty-version' ? '  ' : ' 1.2.3\\n' }
    }
    assert.equal(url, versionUrl.replace('/stable', '/1.2.3/claude-code.vsix'))
    assert.equal(options.responseType, 'stream')
    const directories = existsSync(temporary) ? readdirSync(temporary) : []
    downloadDirectories.push(directories.map(name => join(temporary, name)))
    for (const path of downloadDirectories.at(-1)) {
      privateModes.push(lstatSync(path).mode & 0o777)
    }
    if (outcome === 'download-error') throw axiosFailure
    return { data: Readable.from([Buffer.from('fixture VSIX bytes')]) }
  },
} }))
const installedPaths = []
mock.module('./src/utils/execFileNoThrow.ts', () => ({
  execFileNoThrow: () => { throw new Error('unexpected extension version process') },
  execSyncWithDefaults_DEPRECATED: () => { throw new Error('unexpected parent process lookup') },
  execFileNoThrowWithCwd: async (command, args, options) => {
    assert.equal(command, 'code')
    assert.deepEqual(args.slice(0, 2), ['--force', '--install-extension'])
    assert.equal(args.length, 3)
    assert.equal(options.env.DISPLAY, '')
    assert.equal(options.env.HOME, process.env.HOME)
    const path = args[2]
    installedPaths.push(path)
    assert.equal(readFileSync(path, 'utf8'), 'fixture VSIX bytes')
    if (outcome === 'install-throw') throw new Error('fixture install threw')
    return { code: outcome === 'install-error' ? 7 : 0, error: 'fixture error', stderr: 'fixture stderr' }
  },
}))
const { maybeInstallIDEExtension } = await import('./src/utils/ide.ts')
const attempts = outcome === 'success' ? 2 : 1
for (let attempt = 0; attempt < attempts; attempt++) {
  const result = await maybeInstallIDEExtension('vscode')
  if (outcome === 'success') {
    assert.deepEqual(result, { installed: true, error: null, installedVersion: '1.2.3', ideType: 'vscode' })
  } else {
    assert.equal(result.installed, false)
    assert.equal(result.installedVersion, null)
    assert.equal(result.ideType, 'vscode')
    if (outcome === 'download-error') assert.equal(result.error, 'Failed to fetch extension version from artifactory: fixture download failed')
    else if (outcome === 'install-error') assert.equal(result.error, '7: fixture error fixture stderr')
    else if (outcome === 'install-throw') assert.equal(result.error, 'fixture install threw')
    else if (outcome === 'empty-version') assert.equal(result.error, 'No version found in artifactory response')
    else if (outcome === 'no-token') assert.equal(result.error, 'No artifactory auth token found in ~/.npmrc')
    else if (outcome === 'missing-auth') assert.match(result.error, /^Failed to read npm authentication:/)
    else assert.match(result.error, /outside the selected storage root|link or special entry/)
  }
}
for (const path of installedPaths) {
  assert.equal(dirname(dirname(path)), temporary, 'VSIX must stay under managed I/tmp in its own directory')
  assert.equal(existsSync(path), false)
  assert.equal(existsSync(dirname(path)), false)
}
const downloads = ['success', 'download-error', 'install-error', 'install-throw'].includes(outcome)
assert.equal(downloadDirectories.length, downloads ? attempts : 0)
for (const directories of downloadDirectories) {
  assert.equal(directories.length, 1, 'download must own one disposable directory')
  assert.equal(existsSync(directories[0]), false)
}
assert.equal(installedPaths.length, ['success', 'install-error', 'install-throw'].includes(outcome) ? attempts : 0)
if (outcome === 'success') {
  assert.notEqual(dirname(installedPaths[0]), dirname(installedPaths[1]))
  assert.equal(saves, 1)
  assert.deepEqual(config, { unrelated: 'preserve', diffTool: 'auto' })
  assert.deepEqual(events, ['tengu_ext_installed', 'tengu_ext_installed'])
  assert.deepEqual(errors, [])
} else {
  assert.equal(saves, 0)
  assert.deepEqual(config, { unrelated: 'preserve' })
  assert.deepEqual(events, ['tengu_ext_install_error'])
  assert.ok(errors.length > 0)
}
assert.equal(requests.length, ['missing-auth', 'no-token'].includes(outcome) ? 0 : downloads ? attempts * 2 : 1)
if (linked) {
  assert.deepEqual(readdirSync(outside), ['sentinel'])
  assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'preserve')
} else if (downloads) {
  assert.deepEqual(readdirSync(temporary), [])
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(temporary).mode & 0o777, 0o700)
    assert.ok(privateModes.every(mode => mode === 0o700))
  }
} else assert.equal(existsSync(temporary), false)
`

for (const outcome of ['success', 'download-error', 'install-error', 'install-throw', 'tmp-link', 'internal-link', 'missing-auth', 'no-token', 'empty-version']) {
  test(`public IDE install scratch is root-contained and disposable (${outcome})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'ide-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', fixture], {
        cwd: new URL('../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, {
          OUTCOME: outcome,
          USER_TYPE: 'ant',
          CLAUDE_CONFIG_DIR: join(home, 'product'),
          DISPLAY: 'fixture-display',
        }),
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
}
