import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment'

const setup = `
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { bindStorageRoot, resolveStorageBinding } from './src/utils/echoFlowConfigRoot.ts'
const binding = resolveStorageBinding()
bindStorageRoot(binding)
const temporary = join(binding.internalDir, 'tmp')
const shellTemporary = join(temporary, 'shell')
const external = process.env.CLAUDE_CODE_TMPDIR
mkdirSync(external, { recursive: true })
writeFileSync(join(external, 'old-scratch'), 'preserve')
`

const cases = {
  permissions: `
globalThis.MACRO = { VERSION: 'fixture-version' }
const { setOriginalCwd } = await import('./src/bootstrap/state.ts')
setOriginalCwd(join(process.env.HOME, 'workspace'))
const { getClaudeTempDir, getProjectTempDir, getScratchpadDir, getBundledSkillsRoot, checkReadableInternalPath } = await import('./src/utils/permissions/filesystem.ts')
assert.equal(getClaudeTempDir(), realpathSync(shellTemporary) + sep)
assert.equal(getClaudeTempDir(), getClaudeTempDir())
assert.equal(dirname(getProjectTempDir().slice(0, -1)), realpathSync(shellTemporary))
assert.ok(getScratchpadDir().startsWith(getProjectTempDir()))
const first = getBundledSkillsRoot()
assert.match(first.slice(first.lastIndexOf(sep) + 1), /^[a-f0-9]{32}$/)
assert.equal(first, getBundledSkillsRoot())
getBundledSkillsRoot.cache.clear()
assert.notEqual(first, getBundledSkillsRoot())
for (const path of [join(getProjectTempDir(), 'another-session', 'tasks', 'fixture.output'), join(getBundledSkillsRoot(), 'skill', 'reference.txt')]) {
  assert.equal(checkReadableInternalPath(path, {}).behavior, 'allow')
}
for (const path of [join(binding.root, 'private.txt'), join(temporary, 'unrelated.txt'), join(getProjectTempDir().slice(0, -1) + '-other', 'file'), join(first, 'reference.txt'), join(getProjectTempDir(), '..', 'other-project', 'file')]) {
  assert.equal(checkReadableInternalPath(path, {}).behavior, 'passthrough')
}
const { registerBundledSkill, getBundledSkills, getBundledSkillExtractDir } = await import('./src/skills/bundledSkills.ts')
registerBundledSkill({ name: 'storage-fixture', description: 'fixture', files: { 'reference.txt': 'fixture bytes' }, getPromptForCommand: async () => [] })
await getBundledSkills().find(skill => skill.name === 'storage-fixture').getPromptForCommand('', {})
const reference = join(getBundledSkillExtractDir('storage-fixture'), 'reference.txt')
assert.equal(readFileSync(reference, 'utf8'), 'fixture bytes')
assert.equal(checkReadableInternalPath(reference, {}).behavior, 'allow')
const { getTaskOutputDir } = await import('./src/utils/task/diskOutput.ts')
assert.ok(getTaskOutputDir().startsWith(getProjectTempDir()))
const { getToolResultsDir } = await import('./src/utils/toolResultStorage.ts')
assert.ok(getToolResultsDir().startsWith(binding.root + sep))
const { convertToSandboxRuntimeConfig } = await import('./src/utils/sandbox/sandbox-adapter.ts')
const config = convertToSandboxRuntimeConfig({})
assert.ok(config.filesystem.allowWrite.includes(getClaudeTempDir()))
assert.ok(!config.filesystem.allowWrite.includes(temporary))
assert.ok(!config.filesystem.allowWrite.includes(temporary + sep))
assert.ok(!config.filesystem.allowWrite.includes(binding.root))
assert.ok(!config.filesystem.allowWrite.includes(binding.internalDir))
assert.ok(!config.filesystem.allowWrite.includes(external))
assert.ok(config.filesystem.denyWrite.some(path => path.endsWith('settings.json')))
process.env.CLAUDE_CONFIG_DIR = join(process.env.HOME, 'different-root')
assert.throws(() => getClaudeTempDir(), /Storage root changed after binding/)
`,
  'linked-shell-root': `
if (process.platform !== 'win32') {
  const { ensurePrivateStorageTempRoot } = await import('./src/utils/cachePaths.ts')
  ensurePrivateStorageTempRoot()
  symlinkSync(external, shellTemporary, 'dir')
  const { getClaudeTempDir } = await import('./src/utils/permissions/filesystem.ts')
  assert.throws(() => getClaudeTempDir(), /not a link or special entry/)
}
`,
  providers: `
const { quote } = await import('./src/utils/bash/shellQuote.ts')
const { createBashShellProvider } = await import('./src/utils/shell/bashProvider.ts')
const { createPowerShellProvider } = await import('./src/utils/shell/powershellProvider.ts')
const { getClaudeTempDir } = await import('./src/utils/permissions/filesystem.ts')
const { windowsPathToPosixPath } = await import('./src/utils/windowsPaths.ts')
const sandboxTmpDir = getClaudeTempDir()
const bash = await createBashShellProvider('/bin/bash', { skipSnapshot: true })
const powershell = createPowerShellProvider('/fixture tools/pwsh')
for (const provider of [bash, powershell]) {
  for (const useSandbox of [false, true]) {
    if (useSandbox && process.platform === 'win32') continue
    const opts = { id: 'random-nonce', useSandbox, sandboxTmpDir }
    const result = await provider.buildExecCommand('fixture-command', opts)
    assert.equal(dirname(result.cwdFilePath), useSandbox ? sandboxTmpDir.slice(0, -1) : temporary)
    assert.ok(existsSync(temporary))
    assert.equal(existsSync(result.cwdFilePath), false)
    const content = provider.type === 'powershell' && useSandbox
      ? Buffer.from(result.commandString.split(' ').at(-1), 'base64').toString('utf16le')
      : result.commandString
    assert.ok(content.includes('fixture-command'))
    const bashCwdPath = process.platform === 'win32' ? windowsPathToPosixPath(result.cwdFilePath) : result.cwdFilePath
    assert.ok(content.includes(provider.type === 'bash' ? quote([bashCwdPath]) : result.cwdFilePath.replace(/['\\u2018-\\u201B]/g, '$&$&')))
    if (useSandbox) {
      const env = await provider.getEnvironmentOverrides('fixture-command')
      assert.equal(env.TMPDIR, sandboxTmpDir)
      assert.equal(env.CLAUDE_CODE_TMPDIR, sandboxTmpDir)
      if (provider.type === 'bash') assert.equal(env.TMPPREFIX, join(sandboxTmpDir, 'zsh'))
    }
  }
}
assert.deepEqual(readdirSync(shellTemporary), [])
assert.deepEqual(readdirSync(temporary), ['shell'])
`,
  shell: `
let tracked
mock.module('./src/utils/shell/bashProvider.ts', () => ({ createBashShellProvider: async () => ({
  shellPath: '/fixture/bash', type: 'bash',
  buildExecCommand: async (_command, opts) => {
    tracked = opts.sandboxTmpDir
    assert.equal(tracked, realpathSync(shellTemporary) + sep)
    return { commandString: 'fixture-not-executed', cwdFilePath: join(tracked, 'cwd-fixture') }
  },
}) }))
mock.module('./src/utils/sandbox/sandbox-adapter.ts', () => ({ SandboxManager: {
  wrapWithSandbox: async () => {
    assert.equal(lstatSync(tracked).isDirectory(), true)
    throw new Error('fixture stopped before process spawn')
  },
} }))
process.env.CLAUDE_CODE_SHELL = process.execPath
mock.module('./src/utils/which.ts', () => ({ which: async () => process.execPath, whichSync: () => process.execPath }))
const { exec } = await import('./src/utils/Shell.ts')
await assert.rejects(exec('fixture-not-executed', new AbortController().signal, 'bash', { shouldUseSandbox: true }), /fixture stopped before process spawn/)
`,
}

for (const [name, fixture] of Object.entries(cases)) {
  test(`shell product scratch uses the complete root (${name})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'shell-storage-test-'))
    try {
      const result = spawnSync(process.execPath, ['--no-env-file', '--eval', setup + fixture + `
assert.equal(readFileSync(join(external, 'old-scratch'), 'utf8'), 'preserve')
assert.deepEqual(readdirSync(external), ['old-scratch'])
if (process.platform !== 'win32') assert.equal(lstatSync(temporary).mode & 0o777, 0o700)
`], {
        cwd: new URL('../../', import.meta.url).pathname,
        env: createSandboxedTestEnvironment(home, {
          CLAUDE_CONFIG_DIR: join(home, process.platform === 'win32' ? "product spaces '$`中文’" : 'product spaces \'"$`中文’'),
          CLAUDE_CODE_TMPDIR: join(home, 'legacy-scratch'),
        }),
        encoding: 'utf8', timeout: 30_000,
      })
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
