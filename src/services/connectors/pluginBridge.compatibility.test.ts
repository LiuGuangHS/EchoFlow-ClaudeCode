import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cp, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { uninstallPluginOp } from '../plugins/pluginOperations.js'
import { getConnectorDefinition } from './catalog.js'
import { REMOTE_RECIPES } from './remoteCatalog.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { migrateFromEnabledPlugins } from '../../utils/plugins/installedPluginsManager.js'
import { installConnectorPlugin, isConnectorPluginReady, removeConnectorPlugin, resolveConnectorPluginDefinition, setConnectorPluginEnabled } from './pluginBridge.js'
import { canonicalId, legacyId, releasedConnectorFixture, releasedFeishu } from './fixtures/releasedConnector.js'

test('native, remote and skill catalogs retain the published v0.7.4 namespace', () => {
  expect(getConnectorDefinition('feishu')?.pluginId).toBe('office-feishu@echoflow-connectors')
  expect(getConnectorDefinition('context7')?.pluginId).toBe('office-context7@echoflow-connectors')
  expect(REMOTE_RECIPES.find(item => item.id === 'context7')?.pluginId).toBe('office-context7@echoflow-connectors')
  expect(getConnectorDefinition('remotion')?.pluginId).toBe('office-remotion@echoflow-connectors')
})

describe('released connector bridge compatibility', () => {
  let f: Awaited<ReturnType<typeof releasedConnectorFixture>>
  beforeEach(async () => { f = await releasedConnectorFixture() })
  afterEach(async () => { await f?.cleanup() })

  test('discovers a preinstalled v0.7.4 plugin without rewriting its records, then disables and re-enables it', async () => {
    const before = await f.snapshot()
    const loaded = await loadAllPluginsCacheOnly()
    expect(loaded.enabled.some(plugin => plugin.source === canonicalId)).toBe(true)
    expect(await isConnectorPluginReady(releasedFeishu)).toBe(true)
    expect(await f.snapshot()).toEqual(before)
    await setConnectorPluginEnabled(releasedFeishu, false)
    expect((await f.readJson(f.files.settings)).enabledPlugins[canonicalId]).toBe(false)
    expect(await isConnectorPluginReady(releasedFeishu)).toBe(false)
    await setConnectorPluginEnabled(releasedFeishu, true)
    expect(await isConnectorPluginReady(releasedFeishu)).toBe(true)
    expect((await f.readJson(f.files.settings)).futureSettings).toEqual({ keep: true })
  })

  test('binds a registered managed legacy installation without moving options, secrets or registry records', async () => {
    await f.useLegacy()
    const before = await f.snapshot()
    const resolved = await resolveConnectorPluginDefinition(getConnectorDefinition('feishu')!)
    expect(resolved.pluginId).toBe(legacyId)
    expect(await isConnectorPluginReady(resolved)).toBe(true)
    expect(await f.snapshot()).toEqual(before)
    await setConnectorPluginEnabled(resolved, false)
    await setConnectorPluginEnabled(resolved, true)
    expect((await f.readJson(f.files.settings)).enabledPlugins).toEqual({ [legacyId]: true })
    expect((await f.readJson(f.files.settings)).pluginConfigs).toEqual(JSON.parse(before[0]!).pluginConfigs)
    expect(await readFile(f.files.credentials, 'utf8')).toBe(before[before.length - 1])
  })

  test('adds a catalog connector to a proven legacy marketplace without rewriting the registration', async () => {
    await f.useLegacy()
    const beforeKnown = await readFile(f.files.known, 'utf8')
    const credentials = await readFile(f.files.credentials, 'utf8')
    const remote = getConnectorDefinition('context7')!
    const resolved = await resolveConnectorPluginDefinition(remote)
    expect(resolved.pluginId).toBe('office-context7@haha-connectors')
    await installConnectorPlugin(resolved, { directory: join(f.root, 'remote', 'context7', '1.0.0'), command: '', args: [], env: {} })
    await setConnectorPluginEnabled(resolved, true)
    expect(await isConnectorPluginReady(resolved)).toBe(true)
    expect(await readFile(f.files.known, 'utf8')).toBe(beforeKnown)
    expect((await f.readJson(f.files.market)).name).toBe('haha-connectors')
    expect(await readFile(f.files.credentials, 'utf8')).toBe(credentials)
  })

  test.each(['missing', 'external', 'other-install-location'])('requires both directory registration and source proof for a legacy identity (%s)', async proof => {
    if (proof !== 'missing') {
      const external = join(f.config, 'external-marketplace')
      await f.json(f.files.known, { 'echoflow-connectors': f.registration, 'haha-connectors': {
        ...f.registration, installLocation: external,
        source: { source: 'directory', path: proof === 'external' ? external : f.marketplace },
      } })
      f.resetCaches()
    }
    const before = await f.snapshot()
    await expect(resolveConnectorPluginDefinition({ ...releasedFeishu, pluginId: legacyId })).rejects.toThrow('Unverified legacy')
    expect(await f.snapshot()).toEqual(before)
  })

  async function coexist(legacyEnabled: boolean) {
    await f.json(f.files.known, { 'echoflow-connectors': f.registration, 'haha-connectors': f.registration })
    const installed = await f.readJson(f.files.installed)
    const legacyCache = join(f.config, 'plugins', 'cache', 'haha-connectors', 'office-feishu', '1.0.95-connector.1')
    await cp(f.plugin, legacyCache, { recursive: true })
    installed.plugins[legacyId] = [{ ...f.userEntry, installPath: legacyCache }]
    await f.json(f.files.installed, installed)
    const settings = await f.readJson(f.files.settings)
    settings.enabledPlugins = { [canonicalId]: !legacyEnabled, [legacyId]: legacyEnabled }
    await f.json(f.files.settings, settings)
    f.resetCaches()
    return settings
  }

  test.each([false, true])('managed aliases preserve false values on reads and both detach on disable (legacy enabled: %s)', async legacyEnabled => {
    const settings = await coexist(legacyEnabled)
    const before = await f.snapshot()
    const credentialsBefore = await readFile(f.files.credentials, 'utf8')
    await isConnectorPluginReady(getConnectorDefinition('feishu')!)
    expect(await f.snapshot()).toEqual(before)
    await setConnectorPluginEnabled(getConnectorDefinition('feishu')!, false)
    expect((await f.readJson(f.files.settings)).enabledPlugins).toEqual({ [canonicalId]: false, [legacyId]: false })
    expect((await loadAllPluginsCacheOnly()).enabled.filter(plugin => [canonicalId, legacyId].includes(plugin.source))).toHaveLength(0)
    await setConnectorPluginEnabled(getConnectorDefinition('feishu')!, true)
    expect((await loadAllPluginsCacheOnly()).enabled.filter(plugin => [canonicalId, legacyId].includes(plugin.source))).toHaveLength(1)
    expect(await readFile(f.files.credentials, 'utf8')).toBe(credentialsBefore)
    expect((await f.readJson(f.files.settings)).pluginConfigs).toEqual(settings.pluginConfigs)
  })

  test('readiness counts an enabled project-only managed alias without writing a user override', async () => {
    await f.json(f.files.known, { 'echoflow-connectors': f.registration, 'haha-connectors': f.registration })
    const home = dirname(f.config)
    const legacyCache = join(f.config, 'plugins', 'cache', 'haha-connectors', 'office-feishu', '1.0.95-connector.1')
    await cp(f.plugin, legacyCache, { recursive: true })
    const installed = await f.readJson(f.files.installed)
    installed.plugins[legacyId] = [{ ...f.projectEntry, projectPath: home, installPath: legacyCache }]
    await f.json(f.files.installed, installed)
    await f.json(join(home, '.claude', 'settings.json'), { enabledPlugins: { [legacyId]: true } })
    f.resetCaches()
    expect((await loadAllPluginsCacheOnly()).enabled.filter(plugin => [canonicalId, legacyId].includes(plugin.source))).toHaveLength(2)
    const before = await f.snapshot()
    expect(await isConnectorPluginReady(releasedFeishu)).toBe(false)
    expect(await f.snapshot()).toEqual(before)
  })

  test.each(['future', 'invalid'])('startup sync refuses an existing %s registry without changing records or cache', async kind => {
    const installed = await f.readJson(f.files.installed)
    if (kind === 'future') installed.version = 3
    else installed.plugins[canonicalId][0].installPath = false
    await f.json(f.files.installed, installed)
    f.resetCaches()
    const before = await f.snapshot()
    const manifest = await readFile(join(f.plugin, '.claude-plugin', 'plugin.json'), 'utf8')

    await expect(migrateFromEnabledPlugins()).rejects.toThrow()

    expect(await f.snapshot()).toEqual(before)
    expect(await readFile(join(f.plugin, '.claude-plugin', 'plugin.json'), 'utf8')).toBe(manifest)
  })

  test('startup sync preserves registry extensions when adding a known enabled plugin', async () => {
    const installed = await f.readJson(f.files.installed)
    installed.plugins[canonicalId] = []
    await f.json(f.files.installed, installed)
    f.resetCaches()

    await migrateFromEnabledPlugins()

    const saved = await f.readJson(f.files.installed)
    expect(saved.futureRegistry).toEqual(installed.futureRegistry)
    expect(saved.plugins[canonicalId]?.length).toBeGreaterThan(0)
    expect(saved.plugins[canonicalId][0].installPath).toBe(f.userEntry.installPath)
  })

  test('a missing qualified installation never removes its installed namesake', async () => {
    const before = await f.snapshot()
    const result = await uninstallPluginOp(legacyId, 'user', false)
    expect(result.success).toBe(false)
    expect(await f.snapshot()).toEqual(before)
  })

  test('the shared uninstall helper honors a full legacy ID even when the canonical namesake is listed first', async () => {
    await coexist(false)
    const result = await uninstallPluginOp(legacyId, 'user', false)
    expect(result).toMatchObject({ success: true, pluginId: legacyId })
    const installed = await f.readJson(f.files.installed)
    expect(installed.plugins[canonicalId]).toEqual([f.userEntry, f.projectEntry])
    expect(installed.plugins[legacyId]).toBeUndefined()
    expect((await f.readJson(f.files.settings)).enabledPlugins[canonicalId]).toBe(true)
  })

  test('removes only the canonical user installation, not a same-name external legacy marketplace or another scope', async () => {
    const foreign = join(f.config, 'external-marketplace')
    const foreignPlugin = join(foreign, 'plugins', 'office-feishu')
    await cp(f.plugin, foreignPlugin, { recursive: true })
    const foreignManifest = join(foreign, '.claude-plugin', 'marketplace.json')
    await f.json(foreignManifest, { name: 'haha-connectors', owner: { name: 'External owner' }, plugins: [{ name: 'office-feishu', source: './plugins/office-feishu', version: '1.0.95-connector.1' }] })
    const external = { ...f.registration, source: { source: 'directory', path: foreign, futureSource: 'external' }, installLocation: foreign }
    await f.json(f.files.known, { 'echoflow-connectors': f.registration, 'haha-connectors': external })
    const installed = await f.readJson(f.files.installed)
    installed.plugins[legacyId] = [{ ...f.userEntry, installPath: foreignPlugin }]
    await f.json(f.files.installed, installed)
    const settings = await f.readJson(f.files.settings)
    // Put the foreign name first, opposite to the fully-qualified uninstall request.
    settings.enabledPlugins = { [legacyId]: true, [canonicalId]: false }
    await f.json(f.files.settings, settings)
    f.resetCaches()
    const foreignBefore = await readFile(foreignManifest, 'utf8')
    const foreignPluginBefore = await readFile(join(foreignPlugin, '.claude-plugin', 'plugin.json'), 'utf8')
    const credentialsBefore = await readFile(f.files.credentials, 'utf8')
    await removeConnectorPlugin(releasedFeishu)
    const after = await f.readJson(f.files.installed)
    expect(after.plugins[canonicalId]).toEqual([f.projectEntry])
    expect(after.plugins[legacyId]).toEqual(installed.plugins[legacyId])
    expect(after.futureRegistry).toEqual({ keep: true })
    expect((await f.readJson(f.files.known))['haha-connectors']).toEqual(external)
    const remainingSettings = await f.readJson(f.files.settings)
    expect(remainingSettings.enabledPlugins[legacyId]).toBe(true)
    expect(remainingSettings.pluginConfigs[legacyId]).toEqual(settings.pluginConfigs[legacyId])
    expect(await readFile(foreignManifest, 'utf8')).toBe(foreignBefore)
    expect(await readFile(join(foreignPlugin, '.claude-plugin', 'plugin.json'), 'utf8')).toBe(foreignPluginBefore)
    expect(await readFile(f.files.credentials, 'utf8')).toBe(credentialsBefore)
    expect((await f.readJson(f.files.market)).plugins).toEqual([])
    expect((await f.readJson(f.files.market)).futureMarketplace).toEqual({ keep: true })
  })

  test('rejects a conflicting on-disk marketplace before changing any existing plugin, settings or registration', async () => {
    await f.json(f.files.known, { 'echoflow-connectors': f.registration, 'haha-connectors': f.registration })
    const market = await f.readJson(f.files.market)
    await f.json(f.files.market, { ...market, name: 'unrelated-marketplace' })
    f.resetCaches()
    const before = await f.snapshot()
    await expect(installConnectorPlugin(getConnectorDefinition('feishu')!, f.installation)).rejects.toThrow()
    expect(await f.snapshot()).toEqual(before)
  })
})
