import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSandboxedTestEnvironment, removeTestSandbox } from '../../scripts/pr/test-environment'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const inspectRoots = `
  import { getClaudeConfigHomeDir, getCcHahaDir } from './src/utils/envUtils.ts'
  import { getEchoFlowConfigDir, getEchoFlowInternalDir } from './src/utils/echoFlowConfigRoot.ts'
  console.log(JSON.stringify({
    runtimeRoot: getClaudeConfigHomeDir(),
    productRoot: getEchoFlowConfigDir(),
    runtimeInternal: getCcHahaDir(),
    productInternal: getEchoFlowInternalDir(),
  }))
`

describe('product storage root convergence', () => {
  test('binding rejects conflicting launch controls, root switches and later environment mutation', () => {
    const home = mkdtempSync(join(tmpdir(), 'echoflow-root-binding-'))
    try {
      const result = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import { join } from 'node:path'
        import { resolveStorageBinding, bindStorageRoot, getEchoFlowConfigDir } from './src/utils/echoFlowConfigRoot.ts'
        import { getClaudeConfigHomeDir, getCcHahaDir } from './src/utils/envUtils.ts'
        const binding = resolveStorageBinding()
        const other = join(binding.root, '..', 'other')
        assert.throws(() => resolveStorageBinding({ roots: [other] }), /Conflicting/)
        assert.throws(() => resolveStorageBinding({ env: {}, roots: ['relative'] }), /absolute/)
        bindStorageRoot(binding)
        bindStorageRoot(binding)
        assert.equal(getClaudeConfigHomeDir(), binding.root)
        assert.equal(getCcHahaDir(), binding.internalDir)
        assert.throws(() => bindStorageRoot(resolveStorageBinding({ env: {}, roots: [other] })), /already bound/)
        process.env.CLAUDE_CONFIG_DIR = other
        assert.throws(() => getEchoFlowConfigDir(), /changed after binding/)
        assert.throws(() => getClaudeConfigHomeDir(), /changed after binding/)
        assert.throws(() => getCcHahaDir(), /changed after binding/)
      `], { cwd: repositoryRoot, env: createSandboxedTestEnvironment(home), stdout: 'pipe', stderr: 'pipe' })
      expect(result.stderr.toString()).toBe('')
      expect(result.exitCode).toBe(0)
    } finally {
      removeTestSandbox(home, 'storage root binding')
    }
  })

  for (const directory of ['plugins', 'cowork_plugins']) {
    test(`default ${directory} refuses a physical escape before plugin data is written`, () => {
      const home = mkdtempSync(join(tmpdir(), 'echoflow-plugin-containment-'))
      try {
        const result = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', `
          import assert from 'node:assert/strict'
          import fs from 'node:fs'
          import path from 'node:path'
          const root = process.env.CLAUDE_CONFIG_DIR
          const outside = path.join(process.env.HOME, 'foreign')
          fs.mkdirSync(root, { recursive: true })
          fs.mkdirSync(outside)
          fs.writeFileSync(path.join(outside, 'state'), 'unrelated bytes')
          fs.symlinkSync(outside, path.join(root, ${JSON.stringify(directory)}), process.platform === 'win32' ? 'junction' : 'dir')
          const { getPluginsDirectory, getPluginDataDir } = await import('./src/utils/plugins/pluginDirectories.ts')
          assert.throws(() => getPluginsDirectory(), /outside/)
          assert.throws(() => getPluginDataDir('fixture'), /outside/)
          assert.deepEqual(fs.readdirSync(outside), ['state'])
          assert.equal(fs.readFileSync(path.join(outside, 'state'), 'utf8'), 'unrelated bytes')
        `], {
          cwd: repositoryRoot,
          env: createSandboxedTestEnvironment(home, { CLAUDE_CODE_USE_COWORK_PLUGINS: directory === 'cowork_plugins' ? '1' : '0' }),
          stdout: 'pipe', stderr: 'pipe',
        })
        expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: '' })
      } finally {
        removeTestSandbox(home, 'plugin storage containment')
      }
    })
  }

  for (const mode of ['default', 'explicit', 'empty-override'] as const) {
    test(`${mode}: runtime and product consumers resolve one root and internal directory`, () => {
      const home = mkdtempSync(join(tmpdir(), 'echoflow-root-convergence-'))
      try {
        const env = createSandboxedTestEnvironment(home)
        if (mode === 'default') delete env.CLAUDE_CONFIG_DIR
        if (mode === 'explicit') env.CLAUDE_CONFIG_DIR = join(home, 'selected-profile')
        if (mode === 'empty-override') env.CLAUDE_CONFIG_DIR = ''
        const result = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', inspectRoots], {
          cwd: repositoryRoot,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        })
        expect(result.stderr.toString()).toBe('')
        expect(result.exitCode).toBe(0)
        const roots = JSON.parse(result.stdout.toString())
        if (mode === 'explicit') expect(roots.productRoot).toBe(env.CLAUDE_CONFIG_DIR)
        expect(roots.runtimeRoot).toBe(roots.productRoot)
        expect(roots.runtimeInternal).toBe(roots.productInternal)
      } finally {
        removeTestSandbox(home, 'storage root convergence')
      }
    })
  }
})
