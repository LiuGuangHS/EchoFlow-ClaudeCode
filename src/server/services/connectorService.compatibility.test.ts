import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ConnectorService, type ConnectorServiceDependencies } from './connectorService.js'
import { getConnectorDefinition } from '../../services/connectors/catalog.js'
import * as bridge from '../../services/connectors/pluginBridge.js'
import { canonicalId, legacyId, releasedConnectorFixture } from '../../services/connectors/fixtures/releasedConnector.js'
import type { ConnectorAdapter } from '../../services/connectors/types.js'

describe('released connector service compatibility with the real plugin bridge', () => {
  let f: Awaited<ReturnType<typeof releasedConnectorFixture>>
  let service: ConnectorService
  let dependencies: ConnectorServiceDependencies
  let calls: string[]
  let adapterIds: string[]
  let initialFiles: string[]
  beforeEach(async () => {
    f = await releasedConnectorFixture()
    initialFiles = await f.snapshot()
    calls = []
    adapterIds = []
    const adapter: ConnectorAdapter = {
      prepare: async () => { calls.push('prepare'); throw new Error('Existing release must not need reinstalling') },
      authenticate: async () => { calls.push('authenticate'); throw new Error('Fixture is already authenticated') },
      check: async () => { calls.push('check'); return { authenticated: true, verification: 'remote' } },
      deactivate: async () => { calls.push('deactivate') },
      remove: async () => { calls.push('remove') },
    }
    dependencies = {
      root: f.root, definitions: [getConnectorDefinition('feishu')!], platform: 'darwin-arm64', createAdapter: definition => { adapterIds.push(definition.pluginId); return adapter },
      // No live sessions belong to this isolated fixture; keep all disk/loader bridge methods real.
      bridge: { ...bridge, reloadConnectorSessions: async () => {} },
    }
    service = new ConnectorService(dependencies)
  })
  afterEach(async () => { await f?.cleanup() })

  async function settled() {
    for (let attempt = 0; attempt < 200 && service.get('feishu').operation; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(service.get('feishu').operation).toBeUndefined()
  }

  test('startup finds the released disabled installation through the current catalog without a hidden migration', async () => {
    expect(service.list()[0]).toMatchObject({ pluginId: canonicalId, installed: true, installedVersion: '1.0.95', enabled: false, status: 'disabled', runtime: 'missing' })
    expect(service.get('feishu').updateAvailable).toBe(false)
    expect(calls).toEqual([])
    expect(await f.snapshot()).toEqual(initialFiles)
  })

  test('a managed legacy installation keeps the same actual identity through detach, adapter and runtime checks', async () => {
    await f.useLegacy()
    await f.json(f.files.known, { 'echoflow-connectors': f.registration, 'haha-connectors': f.registration })
    const installed = await f.readJson(f.files.installed)
    await f.json(f.files.installed, { ...installed, plugins: { ...installed.plugins, [canonicalId]: [f.userEntry, f.projectEntry] } })
    await f.json(f.files.settings, { ...await f.readJson(f.files.settings), enabledPlugins: { [canonicalId]: false, [legacyId]: true } })
    f.resetCaches()
    const before = await f.snapshot()
    expect(service.list()[0]).toMatchObject({ installed: true, enabled: false })
    expect(await f.snapshot()).toEqual(before)
    service.action('feishu', 'check')
    await settled()
    expect(service.get('feishu')).toMatchObject({ pluginId: legacyId, enabled: true, runtime: 'ready', status: 'ready' })
    expect(adapterIds).toEqual([legacyId])
    expect((await f.readJson(f.files.settings)).enabledPlugins).toEqual({ [canonicalId]: false, [legacyId]: true })
    expect((await f.readJson(f.files.settings)).pluginConfigs).toEqual(JSON.parse(before[0]!).pluginConfigs)
    expect((await f.snapshot()).at(-1)).toBe(before.at(-1))
    service.action('feishu', 'deactivate')
    await settled()
    const disabled = await f.snapshot()
    service = new ConnectorService(dependencies)
    expect(service.get('feishu')).toMatchObject({ pluginId: legacyId, enabled: false, status: 'disabled' })
    expect(await f.snapshot()).toEqual(disabled)
    service.action('feishu', 'check')
    await settled()
    expect(adapterIds).toEqual([legacyId, legacyId, legacyId])
    expect(calls).toEqual(['check', 'deactivate', 'check'])
  })

  test('marketplace conflicts fail before adapter or plugin/configuration writes', async () => {
    await f.json(f.files.market, { ...await f.readJson(f.files.market), name: 'external-marketplace' })
    f.resetCaches()
    const before = await f.snapshot()
    service.action('feishu', 'check')
    await settled()
    expect(service.get('feishu')).toMatchObject({ enabled: false, status: 'error' })
    expect(adapterIds).toEqual([])
    expect(calls).toEqual([])
    const after = await f.snapshot()
    expect(after.filter((_value, index) => index !== 3)).toEqual(before.filter((_value, index) => index !== 3))
  })

  test('an already-installed released connector reaches ready, deactivates, reconnects and removes without reinstall or login', async () => {
    service.action('feishu', 'check')
    await settled()
    expect(service.get('feishu')).toMatchObject({ installed: true, enabled: true, runtime: 'ready', status: 'ready' })
    expect(await bridge.isConnectorPluginReady(getConnectorDefinition('feishu')!)).toBe(true)
    service.action('feishu', 'deactivate')
    await settled()
    expect(service.get('feishu')).toMatchObject({ enabled: false, status: 'disabled', runtime: 'missing' })
    expect((await f.readJson(f.files.settings)).enabledPlugins[canonicalId]).toBe(false)
    expect(await bridge.isConnectorPluginReady(getConnectorDefinition('feishu')!)).toBe(false)
    service.action('feishu', 'check')
    await settled()
    expect(service.get('feishu')).toMatchObject({ enabled: true, runtime: 'ready', status: 'ready' })
    service.action('feishu', 'remove')
    await settled()
    expect(service.get('feishu')).toMatchObject({ installed: false, enabled: false, status: 'not-installed', runtime: 'missing' })
    expect(calls).toEqual(['check', 'deactivate', 'check', 'deactivate', 'remove'])
    expect((await f.readJson(f.files.installed)).plugins[canonicalId]).toEqual([f.projectEntry])
    expect((await f.readJson(f.files.state)).futureState).toEqual({ keep: true })
  })
})
