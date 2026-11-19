import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  addInstalledPlugin,
  addPluginInstallation,
  clearInstalledPluginsCache,
  deletePluginCache,
  loadInstalledPluginsFromDisk,
  loadInstalledPluginsV2,
  migrateToSinglePluginFile,
  resetMigrationState,
} from './installedPluginsManager.js'

describe('deletePluginCache', () => {
  let tempDir: string
  let originalConfigDir: string | undefined
  let originalPluginCacheDir: string | undefined

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-cache-delete-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalPluginCacheDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    process.env.CLAUDE_CONFIG_DIR = path.join(tempDir, '.claude')
    delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    if (originalPluginCacheDir === undefined) {
      delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    } else {
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = originalPluginCacheDir
    }
    await fs.rm(tempDir, { recursive: true, force: true })
    clearInstalledPluginsCache()
  })

  test('refuses to delete paths outside the managed plugin cache', async () => {
    const protectedDir = path.join(tempDir, '.claude')
    const sentinel = path.join(protectedDir, 'settings.json')
    await fs.mkdir(protectedDir, { recursive: true })
    await fs.writeFile(sentinel, '{"keep":true}', 'utf-8')

    expect(() => deletePluginCache(protectedDir)).toThrow(
      'Refusing to delete plugin cache outside managed cache directory',
    )

    await expect(fs.readFile(sentinel, 'utf-8')).resolves.toBe('{"keep":true}')
  })

  test('deletes only versioned directories under the managed plugin cache', async () => {
    const versionDir = path.join(
      tempDir,
      '.claude',
      'plugins',
      'cache',
      'marketplace',
      'plugin',
      '1.0.0',
    )
    const sentinel = path.join(versionDir, 'plugin.json')
    await fs.mkdir(versionDir, { recursive: true })
    await fs.writeFile(sentinel, '{"name":"plugin"}', 'utf-8')

    deletePluginCache(versionDir)

    await expect(fs.stat(versionDir)).rejects.toThrow()
    await expect(fs.stat(path.join(tempDir, '.claude'))).resolves.toBeDefined()
  })

  test.each([true, false])('preserves an external installation when a matching cache exists (source exists: %s)', async sourceExists => {
    const configDir = process.env.CLAUDE_CONFIG_DIR!
    const pluginId = 'external-plugin@external-market'
    const installPath = path.join(tempDir, 'external-market', 'plugins', 'external-plugin')
    const cachePath = path.join(configDir, 'plugins', 'cache', 'external-market', 'external-plugin', '1.0.0')
    await fs.mkdir(cachePath, { recursive: true })
    if (sourceExists) await fs.mkdir(installPath, { recursive: true })
    const installedFile = path.join(configDir, 'plugins', 'installed_plugins.json')
    const contents = JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: 'user', installPath, version: '1.0.0' }] },
    })
    await fs.writeFile(installedFile, contents)
    clearInstalledPluginsCache()

    expect(loadInstalledPluginsFromDisk().plugins[pluginId]?.[0]?.installPath).toBe(installPath)
    expect(loadInstalledPluginsV2().plugins[pluginId]?.[0]?.installPath).toBe(installPath)
    expect(await fs.readFile(installedFile, 'utf-8')).toBe(contents)
  })

  test('preserves a still-present cache installation when another config has a matching cache', async () => {
    const configDir = process.env.CLAUDE_CONFIG_DIR!
    const pluginId = 'portable-proof-plugin@portable-proof-market'
    const suffix = path.join('plugins', 'cache', 'portable-proof-market', 'portable-proof-plugin', '1.0.0')
    const installPath = path.join(tempDir, 'old-config', suffix)
    await fs.mkdir(installPath, { recursive: true })
    await fs.mkdir(path.join(configDir, suffix), { recursive: true })
    const installedFile = path.join(configDir, 'plugins', 'installed_plugins.json')
    const contents = JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: 'user', installPath, version: '1.0.0' }] },
    })
    await fs.writeFile(installedFile, contents)
    clearInstalledPluginsCache()

    expect(loadInstalledPluginsFromDisk().plugins[pluginId]?.[0]?.installPath).toBe(installPath)
    expect(loadInstalledPluginsV2().plugins[pluginId]?.[0]?.installPath).toBe(installPath)
    expect(await fs.readFile(installedFile, 'utf-8')).toBe(contents)
  })

  test('preserves schema-valid installations without a version when loading from disk and cache', async () => {
    const pluginsDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'plugins')
    const registry = path.join(pluginsDir, 'installed_plugins.json')
    const pluginId = 'versionless-plugin@preserved-market'
    const entry = { scope: 'user', installPath: path.join(tempDir, 'existing'), futureInstallation: { keep: true } }
    const data = { version: 2, plugins: { [pluginId]: [entry] } }
    await fs.mkdir(pluginsDir, { recursive: true })
    const contents = JSON.stringify(data)
    await fs.writeFile(registry, contents)
    clearInstalledPluginsCache()

    expect(loadInstalledPluginsFromDisk()).toEqual(data)
    expect(loadInstalledPluginsV2()).toEqual(data)
    expect(await fs.readFile(registry, 'utf-8')).toBe(contents)
  })

  describe('startup registry consolidation', () => {
    beforeEach(resetMigrationState)
    afterEach(resetMigrationState)

    const v1 = JSON.stringify({ version: 1, plugins: {} })
    const v2 = JSON.stringify({ version: 2, plugins: {}, registryMetadata: { keep: true } })

    test.each([
      ['current', v2],
      ['future', JSON.stringify({ version: 3, plugins: {}, futureMetadata: { keep: true } })],
      ['invalid', '{"version":2,"plugins":null}'],
      ['malformed', '{"version":2,'],
    ])('preserves a %s registry alongside the legacy file', async (_kind, contents) => {
      const pluginsDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'plugins')
      const registry = path.join(pluginsDir, 'installed_plugins.json')
      const legacy = path.join(pluginsDir, 'installed_plugins_v2.json')
      await fs.mkdir(pluginsDir, { recursive: true })
      await fs.writeFile(registry, contents)
      await fs.writeFile(legacy, '{"version":2,"plugins":{}}')

      migrateToSinglePluginFile()

      expect(await fs.readFile(registry, 'utf-8')).toBe(contents)
      expect(await fs.readFile(legacy, 'utf-8')).toBe('{"version":2,"plugins":{}}')
    })

    test('preserves both files and cache when the legacy V2 file fails validation', async () => {
      const pluginsDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'plugins')
      const registry = path.join(pluginsDir, 'installed_plugins.json')
      const legacy = path.join(pluginsDir, 'installed_plugins_v2.json')
      const cache = path.join(pluginsDir, 'cache', 'old-installation')
      const invalid = '{"version":2,"plugins":null}'
      await fs.mkdir(cache, { recursive: true })
      await fs.writeFile(registry, v1)
      await fs.writeFile(legacy, invalid)

      migrateToSinglePluginFile()

      expect(await fs.readFile(registry, 'utf-8')).toBe(v1)
      expect(await fs.readFile(legacy, 'utf-8')).toBe(invalid)
      expect((await fs.stat(cache)).isDirectory()).toBe(true)
    })

    test.each([v1, undefined])('promotes a valid legacy V2 registry over %s', async contents => {
      const pluginsDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'plugins')
      const registry = path.join(pluginsDir, 'installed_plugins.json')
      const legacy = path.join(pluginsDir, 'installed_plugins_v2.json')
      await fs.mkdir(pluginsDir, { recursive: true })
      if (contents !== undefined) await fs.writeFile(registry, contents)
      await fs.writeFile(legacy, v2)

      migrateToSinglePluginFile()

      expect(await fs.readFile(registry, 'utf-8')).toBe(v2)
      expect(await fs.stat(legacy).catch(error => error.code)).toBe('ENOENT')
    })
  })

  describe.each(['scoped', 'legacy'] as const)('%s registry writes', api => {
    const pluginId = 'preserved-plugin@preserved-market'
    const metadata = {
      version: '2.0.0',
      installedAt: '2026-11-17T00:00:00.000Z',
      lastUpdated: '2026-11-17T01:00:00.000Z',
      gitCommitSha: 'new-commit',
    }
    const register = (installPath: string) => {
      const projectPath = path.join(tempDir, 'project')
      if (api === 'scoped') {
        addPluginInstallation(pluginId, 'project', installPath, metadata, projectPath)
      } else {
        addInstalledPlugin(pluginId, { ...metadata, installPath }, 'project', projectPath)
      }
    }

    test.each([
      ['future', JSON.stringify({ version: 3, plugins: {}, futureRegistry: { keep: true } })],
      ['invalid', JSON.stringify({ version: 2, plugins: { [pluginId]: [{ scope: 'user', installPath: false }] } })],
      ['malformed', '{"version":2,"plugins":'],
    ])('refuses to overwrite a %s registry even with a cached valid snapshot', async (_kind, contents) => {
      const pluginsDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'plugins')
      const registry = path.join(pluginsDir, 'installed_plugins.json')
      const installPath = path.join(pluginsDir, 'cache', 'preserved-market', 'preserved-plugin', '1.0.0')
      await fs.mkdir(installPath, { recursive: true })
      const sentinel = path.join(installPath, 'sentinel.txt')
      await fs.writeFile(sentinel, 'keep cache')
      await fs.writeFile(registry, JSON.stringify({ version: 2, plugins: { [pluginId]: [{ scope: 'user', installPath, version: '1.0.0' }] } }))
      clearInstalledPluginsCache()
      expect(loadInstalledPluginsV2().plugins[pluginId]).toHaveLength(1)
      await fs.writeFile(registry, contents)

      expect(() => register(installPath)).toThrow()
      expect(await fs.readFile(registry, 'utf-8')).toBe(contents)
      expect(await fs.readFile(sentinel, 'utf-8')).toBe('keep cache')
    })

    test('preserves unknown metadata when updating a matching scope and project', async () => {
      const pluginsDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'plugins')
      const registry = path.join(pluginsDir, 'installed_plugins.json')
      const installPath = path.join(pluginsDir, 'cache', 'preserved-market', 'preserved-plugin', '2.0.0')
      const sibling = { scope: 'user', installPath: path.join(tempDir, 'sibling'), version: '1.0.0', futureInstallation: { keep: 'sibling' } }
      const entry = { scope: 'project', projectPath: path.join(tempDir, 'project'), installPath: path.join(tempDir, 'old'), version: '1.0.0', futureInstallation: { keep: true } }
      await fs.mkdir(pluginsDir, { recursive: true })
      await fs.writeFile(registry, JSON.stringify({ version: 2, futureRegistry: { keep: true }, plugins: { [pluginId]: [sibling, entry] } }))
      clearInstalledPluginsCache()

      register(installPath)

      const saved = JSON.parse(await fs.readFile(registry, 'utf-8'))
      expect(saved.futureRegistry).toEqual({ keep: true })
      expect(saved.plugins[pluginId]).toHaveLength(2)
      expect(saved.plugins[pluginId][0]).toEqual(sibling)
      expect(saved.plugins[pluginId][1]).toMatchObject({ ...entry, ...metadata, installPath, lastUpdated: expect.any(String) })
    })

    test('still creates a registry when the file is genuinely absent', async () => {
      const installPath = path.join(tempDir, 'new-plugin')
      register(installPath)
      const saved = loadInstalledPluginsFromDisk()
      expect(saved.version).toBe(2)
      expect(saved.plugins[pluginId]?.[0]).toMatchObject({ scope: 'project', ...metadata, installPath, lastUpdated: expect.any(String) })
    })
  })

  test('rebases installed plugin paths when a portable config directory moves', async () => {
    const oldConfigDir = path.join(tempDir, 'old-config')
    const newConfigDir = path.join(tempDir, 'new-config')
    const pluginId = 'portable-proof-plugin@portable-proof-market'
    const oldInstallPath = path.join(
      oldConfigDir,
      'plugins',
      'cache',
      'portable-proof-market',
      'portable-proof-plugin',
      '1.0.0',
    )
    const newInstallPath = path.join(
      newConfigDir,
      'plugins',
      'cache',
      'portable-proof-market',
      'portable-proof-plugin',
      '1.0.0',
    )
    const installedPluginsPath = path.join(
      newConfigDir,
      'plugins',
      'installed_plugins.json',
    )

    await fs.mkdir(newInstallPath, { recursive: true })
    await fs.writeFile(path.join(newInstallPath, 'sentinel.txt'), 'ok', 'utf-8')
    await fs.mkdir(path.dirname(installedPluginsPath), { recursive: true })
    await fs.writeFile(
      installedPluginsPath,
      JSON.stringify({
        version: 2,
        plugins: {
          [pluginId]: [
            {
              scope: 'user',
              installPath: oldInstallPath,
              version: '1.0.0',
              installedAt: '2026-05-24T00:00:00.000Z',
              lastUpdated: '2026-05-24T00:00:00.000Z',
            },
          ],
        },
      }, null, 2),
      'utf-8',
    )

    process.env.CLAUDE_CONFIG_DIR = newConfigDir
    clearInstalledPluginsCache()

    const loaded = loadInstalledPluginsV2()

    expect(loaded.plugins[pluginId]?.[0]?.installPath).toBe(newInstallPath)
    const healed = JSON.parse(await fs.readFile(installedPluginsPath, 'utf-8'))
    expect(healed.plugins[pluginId][0].installPath).toBe(newInstallPath)
  })
})
