import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSandboxedTestEnvironment } from '../../scripts/pr/test-environment.js'

const repository = resolve(import.meta.dir, '../..')

const cases = ['plugin', 'zip', 'cowork', 'remote', 'setting', 'trace', 'oauth', 'whatsapp']
  .map(consumer => ({ consumer, inPlace: false }))
cases.push({ consumer: 'plugin', inPlace: true })

for (const { consumer, inPlace } of cases) {
  test(`retired configured ${consumer} paths consume the migrated ${inPlace ? 'in-place namespace' : 'owned profile'} without recreating it`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'storage-override-chain-'))
    try {
      const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', `
        import assert from 'node:assert/strict'
        import fs from 'node:fs/promises'
        import path from 'node:path'
        import { mock } from 'bun:test'
        globalThis.fetch = async () => { throw new Error('Unexpected network request') }
        const root = process.env.CLAUDE_CONFIG_DIR
        const home = process.env.HOME
        const old = ${inPlace} ? root : path.join(process.env.XDG_CONFIG_HOME, 'claude-code-desktop')
        const retired = ${inPlace} ? path.join(old, 'cc-haha') : old
        const oldCustom = path.join(old, 'cc-haha', 'custom-café')
        const destination = path.join(root, 'echoflow-code', 'custom-café')
        const { ensureEchoFlowConfigRoot } = await import('./src/utils/echoFlowConfigRoot.ts')
        await ensureEchoFlowConfigRoot(old)
        await fs.mkdir(oldCustom, { recursive: true })
        const raw = JSON.stringify({ unknown: 'retained bytes' }) + '\\n'
        await fs.writeFile(path.join(oldCustom, 'state'), raw)
        const tokens = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: 9999999999999 }
        await fs.writeFile(path.join(oldCustom, 'oauth.json'), JSON.stringify(tokens))
        await fs.writeFile(path.join(old, 'settings.json'), JSON.stringify({ autoMemoryDirectory: oldCustom }))
        const transcript = JSON.stringify({ type: 'user', content: oldCustom, unknown: true }) + '\\n'
        await fs.mkdir(path.join(old, 'projects', 'fixture'), { recursive: true })
        await fs.writeFile(path.join(old, 'projects', 'fixture', 'session.jsonl'), transcript)
        process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = oldCustom
        process.env.CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE = '1'
        process.env.CC_HAHA_TRACE_DIR = oldCustom
        process.env.OPENAI_CODEX_OAUTH_FILE = path.join(oldCustom, 'oauth.json')
        process.env.WHATSAPP_AUTH_DIR = oldCustom
        const consumer = ${JSON.stringify(consumer)}
        if (consumer === 'cowork') process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = oldCustom
        if (consumer === 'remote') process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = oldCustom
        const inventory = await import('./src/server/migrationInventory.ts')
        mock.module('./src/server/migrationInventory.ts', () => ({
          ...inventory,
          assertMigrationQuiescent: async (roots, owned) => {
            assert.ok(roots.length > 0 && roots.every(value => value.startsWith(home + path.sep)))
            assert.deepEqual(owned, [process.pid])
          },
        }))
        const { initializeProcessStorage, releaseProcessStorage } = await import('./src/services/storageStartup.ts')
        await initializeProcessStorage()
        try {
          await assert.rejects(fs.lstat(retired), { code: 'ENOENT' })
          let selected
          if (consumer === 'plugin') {
            const { getPluginsDirectory, getPluginDataDir, getPluginSeedDirs } = await import('./src/utils/plugins/pluginDirectories.ts')
            selected = getPluginsDirectory()
            const data = getPluginDataDir('fixture@market')
            assert.equal(data, path.join(destination, 'data', 'fixture-market'))
            await fs.writeFile(path.join(data, 'state'), raw)
            process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = path.join(home, 'read-only-seed')
            assert.deepEqual(getPluginSeedDirs(), [process.env.CLAUDE_CODE_PLUGIN_SEED_DIR])
          } else if (consumer === 'zip') {
            const { getPluginZipCachePath, getZipCacheInstalledPluginsPath } = await import('./src/utils/plugins/zipCache.ts')
            selected = getPluginZipCachePath()
            assert.equal(getZipCacheInstalledPluginsPath(), path.join(destination, 'installed_plugins.json'))
          } else if (['cowork', 'remote', 'setting'].includes(consumer)) {
            const { getMemoryBaseDir, getAutoMemPath, getAutoMemEntrypoint, hasAutoMemPathOverride, isAutoMemPath } = await import('./src/memdir/paths.ts')
            if (consumer === 'remote') {
              assert.equal(getMemoryBaseDir(), destination)
              // The trusted full-path setting still has precedence over the remote base.
            }
            selected = getAutoMemPath().slice(0, -path.sep.length)
            assert.equal(selected, destination)
            assert.equal(hasAutoMemPathOverride(), consumer === 'cowork')
            assert.equal(isAutoMemPath(path.join(destination, 'topic.md')), true)
            assert.equal(isAutoMemPath(path.join(oldCustom, 'topic.md')), false)
            await fs.writeFile(getAutoMemEntrypoint(), raw)
            assert.equal(await fs.readFile(getAutoMemEntrypoint(), 'utf8'), raw)
          } else if (consumer === 'trace') {
            const { getTraceStorageDir } = await import('./src/services/api/traceCapture.ts')
            selected = getTraceStorageDir()
          } else if (consumer === 'oauth') {
            const { getOpenAIOAuthTokens, getOpenAIOAuthTokensAsync, saveOpenAIOAuthTokens } = await import('./src/services/openaiAuth/storage.ts')
            assert.deepEqual(getOpenAIOAuthTokens(), tokens)
            assert.deepEqual(await getOpenAIOAuthTokensAsync(), tokens)
            const next = { ...tokens, accessToken: 'fixture-updated' }
            assert.equal(saveOpenAIOAuthTokens(next).success, true)
            assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'oauth.json'), 'utf8')), next)
            selected = destination
          } else {
            const { loadConfig } = await import('./adapters/common/config.ts')
            selected = loadConfig().whatsapp.authDir
          }
          assert.equal(selected, destination)
          assert.equal(await fs.readFile(path.join(selected, 'state'), 'utf8'), raw)
          assert.equal(await fs.readFile(path.join(root, 'projects', 'fixture', 'session.jsonl'), 'utf8'), transcript)
          await assert.rejects(fs.lstat(retired), { code: 'ENOENT' })
        } finally { await releaseProcessStorage() }
      `], {
        cwd: repository,
        env: createSandboxedTestEnvironment(home, { CLAUDE_CONFIG_DIR: join(home, 'selected-café') }),
        stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: '', stdout: '' })
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}
