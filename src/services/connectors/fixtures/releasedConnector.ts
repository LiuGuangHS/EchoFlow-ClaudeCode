import { spyOn } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getCwdState, getOriginalCwd, setCwdState, setOriginalCwd } from '../../../bootstrap/state.js'
import { clearAllCaches } from '../../../utils/plugins/cacheUtils.js'
import { clearMarketplacesCache } from '../../../utils/plugins/marketplaceManager.js'
import * as secureStorage from '../../../utils/secureStorage/index.js'
import { plainTextStorage } from '../../../utils/secureStorage/plainTextStorage.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import type { ConnectorDefinition, ConnectorInstallation } from '../types.js'

// v0.7.4 (e15eb6109): literal released identity and disk format, not today's catalog.
export const canonicalId = 'office-feishu@echoflow-connectors'
export const legacyId = 'office-feishu@haha-connectors'
export const releasedFeishu: ConnectorDefinition = {
  id: 'feishu', pluginId: canonicalId, packageName: '@larksuite/cli', version: '1.0.95',
  homepage: 'https://github.com/larksuite/cli', credentialMode: 'shared',
  platforms: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64'],
}

export async function releasedConnectorFixture() {
  const home = await mkdtemp(join(tmpdir(), 'connector-v074-'))
  const config = join(home, 'config')
  const root = join(config, 'connectors')
  const marketplace = join(root, 'marketplace')
  const plugin = join(marketplace, 'plugins', 'office-feishu')
  const cache = join(config, 'plugins', 'cache', 'echoflow-connectors', 'office-feishu', '1.0.95-connector.1')
  const previousEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CLAUDE_CODE_PLUGIN_CACHE_DIR: process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR, CLAUDE_CODE_PLUGIN_SEED_DIR: process.env.CLAUDE_CODE_PLUGIN_SEED_DIR }
  const previousCwd = getCwdState()
  const previousOriginalCwd = getOriginalCwd()
  Object.assign(process.env, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PLUGIN_CACHE_DIR: join(config, 'plugins') })
  delete process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
  setCwdState(home)
  setOriginalCwd(home)
  // Keep last-scope uninstall away from the real OS keychain, including on macOS.
  const storage = spyOn(secureStorage, 'getSecureStorage').mockReturnValue(plainTextStorage)
  const resetCaches = () => { resetSettingsCache(); clearAllCaches(); clearMarketplacesCache() }
  const json = async (path: string, value: unknown) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2))
  }
  const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
  const files = {
    settings: join(config, 'settings.json'), known: join(config, 'plugins', 'known_marketplaces.json'),
    installed: join(config, 'plugins', 'installed_plugins.json'), state: join(root, 'state.json'),
    market: join(marketplace, '.claude-plugin', 'marketplace.json'), manifest: join(plugin, '.claude-plugin', 'plugin.json'),
    skill: join(plugin, 'skills', 'office-feishu', 'SKILL.md'), credentials: join(config, '.credentials.json'),
  }
  const installation: ConnectorInstallation = { directory: join(root, 'runtime', 'feishu', '1.0.95-darwin-arm64'), command: join(root, 'runtime', 'lark-cli'), args: [], env: {} }
  await json(files.manifest, { name: 'office-feishu', version: '1.0.95-connector.1', description: 'Feishu desktop connector', skills: './skills' })
  await mkdir(dirname(files.skill), { recursive: true })
  await writeFile(files.skill, '---\nname: office-feishu\ndescription: Released Feishu connector fixture\n---\nUse the desktop-managed connector.\n')
  await cp(plugin, cache, { recursive: true })
  const registration = { source: { source: 'directory', path: marketplace, futureSource: 'keep' }, installLocation: marketplace,
    lastUpdated: '2026-01-01T00:00:00.000Z', autoUpdate: false, futureRegistration: { keep: true } }
  const userEntry = { scope: 'user', installPath: cache, version: '1.0.95-connector.1', installedAt: '2026-01-01T00:00:00.000Z', futureInstallation: { keep: true } }
  const projectEntry = { ...userEntry, scope: 'project', projectPath: join(home, 'another-project') }
  await json(files.known, { 'echoflow-connectors': registration })
  await json(files.market, { name: 'echoflow-connectors', owner: { name: 'EchoFlow Code', futureOwner: 'keep' }, futureMarketplace: { keep: true },
    plugins: [{ name: 'office-feishu', source: './plugins/office-feishu', version: '1.0.95-connector.1', strict: true }] })
  await json(files.installed, { version: 2, futureRegistry: { keep: true }, plugins: { [canonicalId]: [userEntry, projectEntry] } })
  await json(files.settings, { enabledPlugins: { [canonicalId]: true }, futureSettings: { keep: true }, pluginConfigs: { [canonicalId]: { options: { fixtureOption: 'canonical' } }, [legacyId]: { options: { fixtureOption: 'legacy' } } } })
  await json(files.credentials, { pluginSecrets: { [canonicalId]: { fixtureToken: 'fake-canonical' }, [legacyId]: { fixtureToken: 'fake-legacy' } }, futureCredential: 'keep' })
  await json(files.state, { schemaVersion: 1, futureState: { keep: true }, connectors: { feishu: {
    installed: true, installedVersion: '1.0.95', installation, enabled: false, connection: 'needs-auth', runtime: 'missing', status: 'disabled', sharedCredentialsAcknowledged: true,
  } } })
  resetCaches()
  return {
    config, root, marketplace, plugin, files, installation, registration, userEntry, projectEntry, json, readJson, resetCaches,
    snapshot: () => Promise.all(Object.values(files).map(file => readFile(file, 'utf8'))),
    async useLegacy() {
      const legacyCache = join(config, 'plugins', 'cache', 'haha-connectors', 'office-feishu', '1.0.95-connector.1')
      await cp(plugin, legacyCache, { recursive: true })
      await json(files.known, { 'haha-connectors': registration })
      await json(files.market, { ...await readJson(files.market), name: 'haha-connectors' })
      await json(files.installed, { version: 2, futureRegistry: { keep: true }, plugins: { [legacyId]: [{ ...userEntry, installPath: legacyCache }] } })
      await json(files.settings, { ...await readJson(files.settings), enabledPlugins: { [legacyId]: true } })
      resetCaches()
    },
    async cleanup() {
      resetCaches()
      storage.mockRestore()
      setCwdState(previousCwd)
      setOriginalCwd(previousOriginalCwd)
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await rm(home, { recursive: true, force: true })
    },
  }
}
