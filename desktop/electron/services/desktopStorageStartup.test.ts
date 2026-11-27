// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { acquireStorageWriter, completeStorageMigration, executeStorageMigration, readStorageLocation, readStorageMigrationStatus, selectStartupStorage, storageLocationFile, type StorageMigrationHooks } from '../../../src/services/storageMigration'
import { desktopStorageIdentity, desktopStorageRelaunchArgs, discoverDesktopStorage, initializeDesktopStorage, type DesktopStorageLaunch } from './desktopStorageStartup'
import { desktopMoveRelaunchArgs } from './desktopStorageMove'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture() {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'desktop-storage-startup-')))
  directories.push(home)
  const env: NodeJS.ProcessEnv = {
    HOME: home, USERPROFILE: home,
    XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config'),
    APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'),
  }
  const userData = path.join(home, 'old-profile')
  const switches: Record<string, string> = {}
  const app = {
    getPath(name: 'home' | 'exe' | 'userData') {
      return name === 'home' ? home : name === 'exe' ? path.join(home, 'install', 'echoflow') : userData
    },
    commandLine: { hasSwitch: (name: string) => name in switches, getSwitchValue: (name: string) => switches[name] ?? '' },
  }
  const put = (directory: string, name: string, bytes: string) => {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
    writeFileSync(path.join(directory, name), bytes)
  }
  const owned = (directory: string, files: Record<string, string>) => {
    put(directory, 'app.json', JSON.stringify(buildEchoFlowOwnershipMarker()))
    for (const [name, bytes] of Object.entries(files)) put(directory, name, bytes)
    return { directory, markerRoot: directory }
  }
  const discover = () => discoverDesktopStorage(app, env, 'linux', home)
  const binding = resolveStorageBinding({ env: {}, roots: [path.join(home, 'selected')] })
  const launch: DesktopStorageLaunch = { binding, sources: [], issues: [] }
  // Only these temporary fixtures exist; no desktop, adapter or provider is started.
  const hooks: StorageMigrationHooks = { assertQuiescent: vi.fn(async () => {}), platform: 'linux' }
  return { home, env, userData, switches, app, put, owned, discover, launch, hooks }
}

describe('desktop cold storage discovery', () => {
  it.each(['echoflow-move-source', 'echoflow-move-request', 'echoflow-move-proof', 'user-data-dir'])('rejects a cold request missing %s instead of opening a default profile', missing => {
    const f = fixture()
    Object.assign(f.switches, { 'echoflow-move-source': path.join(f.home, 'source'), 'echoflow-move-request': '11111111-1111-4111-8111-111111111111', 'echoflow-move-proof': 'a'.repeat(64) + ':1:2', 'user-data-dir': path.join(f.home, 'target') })
    delete f.switches[missing]
    expect(f.discover).toThrow(/Incomplete|explicit target/)
    expect(readdirSync(f.home)).toEqual([])
  })

  it('replaces only storage controls in relaunch arguments and preserves unrelated arguments', () => {
    const request = { source: path.resolve('/source'), id: '11111111-1111-4111-8111-111111111111', proof: 'a'.repeat(64) + ':1:2' }
    const target = path.resolve('/target')
    expect(desktopMoveRelaunchArgs(['main.cjs', '--user-data-dir', '/old', '--disk-cache-dir=/old/cache', '--media-cache-dir', '/old/media', '--echoflow-move-source=/prior', '--echoflow-move-request', 'old', '--echoflow-move-proof=old', '--unrelated', 'keep'], target, request)).toEqual(['main.cjs', '--unrelated', 'keep', `--user-data-dir=${target}`, `--echoflow-move-source=${request.source}`, `--echoflow-move-request=${request.id}`, `--echoflow-move-proof=${request.proof}`])
  })

  it.each(['linux', 'darwin', 'win32'] as const)('selects the shared %s default without creating a profile or claiming shared state', platform => {
    const f = fixture()
    const shared = path.join(f.home, '.claude')
    f.put(shared, 'settings.json', '{"otherProduct":true}')
    const launch = discoverDesktopStorage(f.app, f.env, platform, f.home)
    const expected = resolveStorageBinding({ env: f.env, platform, homeDir: f.home })
    expect(launch.binding).toEqual(expected)
    expect(launch.sources).toEqual([])
    expect(launch.issues).toEqual([])
    expect(existsSync(launch.binding.root)).toBe(false)
    expect(readFileSync(path.join(shared, 'settings.json'), 'utf8')).toBe('{"otherProduct":true}')
  })

  it('does not make the admitted default root an override on ordinary restart', () => {
    const f = fixture()
    const launch = f.discover()
    const args = desktopStorageRelaunchArgs(['main.cjs', '--unrelated'], launch)
    expect(args).toEqual(['main.cjs', '--unrelated'])
  })

  it('preserves genuine profile and cache overrides on ordinary restart', () => {
    const f = fixture()
    const root = path.join(f.home, 'selected')
    f.switches['user-data-dir'] = root
    f.switches['disk-cache-dir'] = path.join(root, 'Cache')
    const args = ['main.cjs', `--disk-cache-dir=${f.switches['disk-cache-dir']}`, `--user-data-dir=${root}`, '--unrelated']
    expect(desktopStorageRelaunchArgs(args, f.discover())).toEqual(args)
  })

  it('collects both historical profiles even when the target already has data', () => {
    const f = fixture()
    const target = resolveStorageBinding({ env: f.env, platform: 'linux', homeDir: f.home }).root
    const second = path.join(f.env.XDG_CONFIG_HOME!, 'claude-code-desktop')
    f.owned(target, { 'projects/current.jsonl': 'current' })
    f.owned(f.userData, { 'Local Storage/leveldb/000001.log': 'first' })
    f.owned(second, { 'projects/second.jsonl': 'second' })
    const launch = f.discover()
    expect(launch.binding.root).toBe(target)
    expect(launch.sources.map(source => source.directory).sort()).toEqual([f.userData, second].sort())
    expect(readFileSync(path.join(f.userData, 'Local Storage/leveldb/000001.log'), 'utf8')).toBe('first')
  })

  it('accepts physical aliases of the same complete root, including missing final components', () => {
    const f = fixture()
    const actual = path.join(f.home, 'actual')
    const alias = path.join(f.home, 'alias')
    mkdirSync(actual)
    symlinkSync(actual, alias, 'junction')
    f.env.CLAUDE_CONFIG_DIR = path.join(alias, 'new-root')
    f.switches['user-data-dir'] = path.join(actual, 'new-root')
    expect(f.discover().binding.root).toBe(path.join(actual, 'new-root'))
    expect(existsSync(path.join(actual, 'new-root'))).toBe(false)
  })

  it('rejects conflicting environment, Chromium and portable selections without changing their bytes', () => {
    const f = fixture()
    f.env.CLAUDE_CONFIG_DIR = path.join(f.home, 'environment-root')
    f.switches['user-data-dir'] = path.join(f.home, 'chromium-root')
    expect(f.discover).toThrow('Conflicting storage root selections')
    delete f.switches['user-data-dir']
    const pointer = '{"mode":"portable","portable_dir":' + JSON.stringify(path.join(f.home, 'portable-root')) + ',"future":1}'
    f.put(f.userData, 'app-mode.json', pointer)
    expect(f.discover).toThrow('Conflicting storage root selections')
    expect(readFileSync(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(pointer)
    expect(existsSync(f.env.CLAUDE_CONFIG_DIR)).toBe(false)
  })

  it('retains the legacy custom root after consuming the app-mode pointer', async () => {
    const f = fixture()
    const selected = path.join(f.home, 'portable-root')
    f.put(f.userData, 'app-mode.json', JSON.stringify({ mode: 'portable', portable_dir: selected }))
    const startup = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
    try { expect(startup.binding.root).toBe(selected) }
    finally { await startup.release() }
    expect(existsSync(path.join(f.userData, 'app-mode.json'))).toBe(false)
    const defaultBinding = resolveStorageBinding({ env: f.env, platform: 'linux', homeDir: f.home })
    expect(selectStartupStorage(defaultBinding, storageLocationFile(f.home)).root).toBe(selected)
    const restarted = await initializeDesktopStorage(f.discover(), f.hooks, async () => { throw new Error('accepted validation must not replay') })
    try { expect(restarted.binding.root).toBe(selected) }
    finally { await restarted.release() }
  })

  it('keeps the old pointer through failed validation and recovers accepted publication without revalidating', async () => {
    const f = fixture()
    const selected = path.join(f.home, 'portable-root')
    const pointer = JSON.stringify({ mode: 'portable', portable_dir: selected })
    f.put(f.userData, 'app-mode.json', pointer)
    const file = storageLocationFile(f.home)
    await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => { throw new Error('validation interrupted') })).rejects.toThrow('validation interrupted')
    expect(readStorageLocation(file)).toBeUndefined()
    expect(readFileSync(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(pointer)

    const database = new DatabaseSync(file)
    try {
      database.exec("CREATE TRIGGER interrupt_publication BEFORE INSERT ON active_root BEGIN SELECT RAISE(ABORT, 'publication interrupted'); END")
      await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('publication interrupted')
      expect(readStorageLocation(file)).toBeUndefined()
      expect(readFileSync(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(pointer)
      expect((await readStorageMigrationStatus(f.discover().binding))?.state).toBe('cleanup-pending')
      database.exec('DROP TRIGGER interrupt_publication')
    } finally { database.close() }

    const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => { throw new Error('accepted validation must not replay') })
    await lease.release()
    expect(existsSync(path.join(f.userData, 'app-mode.json'))).toBe(false)
    expect(f.discover().binding.root).toBe(selected)
  })

  it.each(['environment', 'chromium'])('does not persist a launch-only %s root after migrating old files', async override => {
    const f = fixture()
    const defaultRoot = f.discover().binding.root
    const selected = path.join(f.home, 'override-root')
    if (override === 'environment') f.env.CLAUDE_CONFIG_DIR = selected
    else f.switches['user-data-dir'] = selected
    f.owned(f.userData, { 'projects/legacy.jsonl': 'legacy data' })
    const validate = vi.fn(async () => {})
    const lease = await initializeDesktopStorage(f.discover(), f.hooks, validate)
    try { expect(lease.binding.root).toBe(selected) }
    finally { await lease.release() }
    expect(validate).toHaveBeenCalledOnce()
    expect(readStorageLocation(storageLocationFile(f.home))).toBeUndefined()
    delete f.env.CLAUDE_CONFIG_DIR
    delete f.switches['user-data-dir']
    expect(f.discover().binding.root).toBe(defaultRoot)
  })

  it('inspects a portable-selected root for its own conflicting retained pointer', () => {
    const f = fixture()
    const selected = path.join(f.home, 'portable-root')
    const next = path.join(f.home, 'unexpected-next-root')
    const first = JSON.stringify({ mode: 'portable', portable_dir: selected })
    const second = JSON.stringify({ mode: 'portable', portable_dir: next, future: true })
    f.put(f.userData, 'app-mode.json', first)
    f.put(selected, 'app-mode.json', second)
    expect(f.discover).toThrow('Conflicting storage root selections in the selected portable profile')
    expect(readFileSync(path.join(f.userData, 'app-mode.json'), 'utf8')).toBe(first)
    expect(readFileSync(path.join(selected, 'app-mode.json'), 'utf8')).toBe(second)
    expect(existsSync(next)).toBe(false)
  })

  it('defers a v1 journal inside a portable-selected root to the cold inspector and rejects malformed evidence', async () => {
    const f = fixture()
    const selected = path.join(f.home, 'portable-root')
    const journal = '{"stage":"restarting","future":true}'
    f.put(f.userData, 'app-mode.json', JSON.stringify({ mode: 'portable', portable_dir: selected }))
    f.put(selected, 'data-migration-v1.json', journal)
    const launch = f.discover()
    expect(launch.binding.root).toBe(selected)
    expect(launch.issues).toEqual([])
    await expect(initializeDesktopStorage(launch, f.hooks, async () => {})).rejects.toThrow('Unsupported migration recovery record')
    expect(launch.sources.map(source => source.directory)).not.toContain(selected)
    expect(readFileSync(path.join(selected, 'data-migration-v1.json'), 'utf8')).toBe(journal)
  })

  it('treats an empty environment override as the platform default', () => {
    const f = fixture()
    f.env.CLAUDE_CONFIG_DIR = ''
    expect(f.discover().binding).toEqual(resolveStorageBinding({ env: f.env, platform: 'linux', homeDir: f.home }))
  })

  it('rejects relative environment roots and empty explicit Chromium roots', () => {
    const f = fixture()
    f.env.CLAUDE_CONFIG_DIR = 'relative-root'
    expect(f.discover).toThrow('absolute directory')
    delete f.env.CLAUDE_CONFIG_DIR
    f.switches['user-data-dir'] = ''
    expect(f.discover).toThrow('absolute directory')
  })

  it('rejects dangling root aliases instead of treating them as fresh directories', () => {
    const f = fixture()
    const alias = path.join(f.home, 'dangling')
    symlinkSync(path.join(f.home, 'missing'), alias, 'junction')
    expect(() => desktopStorageIdentity(path.join(alias, 'root'))).toThrow()
  })

  it('rejects custom roots inside the application installation', () => {
    const f = fixture()
    f.env.CLAUDE_CONFIG_DIR = path.join(f.home, 'install', 'data')
    expect(f.discover).toThrow('outside the application install directory')
  })

  it('rejects malformed v1 evidence before importing shared desktop state', async () => {
    const f = fixture()
    f.put(f.userData, 'data-migration-v1.json', '{"stage":"restarting","future":1}')
    f.put(path.join(f.home, '.claude'), 'window-state.json', '{"width":1200}')
    const launch = f.discover()
    expect(launch.issues).toEqual([])
    await expect(initializeDesktopStorage(launch, f.hooks, async () => {})).rejects.toThrow('Unsupported migration recovery record')
    expect(existsSync(launch.binding.root)).toBe(false)
    expect(readFileSync(path.join(f.userData, 'data-migration-v1.json'), 'utf8')).toBe('{"stage":"restarting","future":1}')
  })

  it('discovers only fixed flat index files in the selected internal directory, not its active contents', () => {
    const f = fixture()
    const root = f.launch.binding.root
    f.env.CLAUDE_CONFIG_DIR = root
    f.owned(root, { 'echoflow-code/db/index-v1.sqlite': 'active', 'echoflow-code/settings.json': '{}' })
    expect(f.discover().sources).toEqual([])
    f.put(root, 'echoflow-code/trace-index-v1.sqlite-wal', 'flat sidecar')
    expect(f.discover().sources).toEqual([{
      directory: path.join(root, 'echoflow-code'), markerRoot: root,
      destination: 'echoflow-code', layout: 'flat-indexes',
    }])
    expect(readFileSync(path.join(root, 'echoflow-code/db/index-v1.sqlite'), 'utf8')).toBe('active')
    expect(existsSync(path.join(root, 'echoflow-code/migrations'))).toBe(false)
  })

  it('only inventories the product subtree of shared .claude', () => {
    const f = fixture()
    const shared = path.join(f.home, '.claude')
    f.put(shared, 'sentinel', 'not owned')
    f.put(shared, 'cc-haha/providers.json', '{"version":1,"providers":[]}')
    const launch = f.discover()
    expect(launch.sources).toEqual([{
      directory: path.join(shared, 'cc-haha'), markerRoot: shared,
      ownership: 'legacy-internal', destination: 'echoflow-code',
    }])
    expect(readFileSync(path.join(shared, 'sentinel'), 'utf8')).toBe('not owned')
  })
})

describe('desktop shared-transaction startup admission', () => {
  it('admits a fresh root without a legacy validation run and returns a releasable lifetime lease', async () => {
    const f = fixture()
    const validate = vi.fn(async () => {})
    const lease = await initializeDesktopStorage(f.launch, f.hooks, validate)
    try {
      expect(validate).not.toHaveBeenCalled()
      expect(JSON.parse(readFileSync(path.join(f.launch.binding.root, 'app.json'), 'utf8'))).toEqual(buildEchoFlowOwnershipMarker())
      expect(readdirSync(path.join(f.launch.binding.internalDir, 'migrations', 'writers'))).toHaveLength(1)
    } finally { await lease.release() }
    expect(readdirSync(path.join(f.launch.binding.internalDir, 'migrations', 'writers'))).toEqual([])
  })

  it('does not take the migration exclusion lock for an already-ready root with another leased writer', async () => {
    const f = fixture()
    const existing = await acquireStorageWriter(f.launch.binding)
    let desktop: Awaited<ReturnType<typeof initializeDesktopStorage>> | undefined
    try {
      desktop = await initializeDesktopStorage(f.launch, f.hooks, async () => {})
      expect(readdirSync(path.join(f.launch.binding.internalDir, 'migrations', 'writers'))).toHaveLength(2)
      expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
    } finally {
      await desktop?.release()
      await existing.release()
    }
  })

  it('unions two owned sources, validates before cleanup, then never reimports or rewrites a retired profile', async () => {
    const f = fixture()
    const root = f.launch.binding.root
    f.owned(root, { 'projects/current.jsonl': 'current' })
    const first = f.owned(path.join(f.home, 'legacy-a'), { 'Local Storage/leveldb/000001.log': 'chromium' })
    const second = f.owned(path.join(f.home, 'legacy-b'), { 'projects/second.jsonl': 'second' })
    f.launch.sources = [first, second]
    const validate = vi.fn(async () => {
      expect(existsSync(first.directory)).toBe(true)
      expect(readFileSync(path.join(root, 'Local Storage/leveldb/000001.log'), 'utf8')).toBe('chromium')
      await expect(acquireStorageWriter(f.launch.binding)).rejects.toThrow('validation-required')
    })
    const lease = await initializeDesktopStorage(f.launch, f.hooks, validate)
    await lease.release()
    expect(validate).toHaveBeenCalledOnce()
    expect(existsSync(first.directory)).toBe(false)
    expect(existsSync(second.directory)).toBe(false)
    expect(readFileSync(path.join(root, 'projects/current.jsonl'), 'utf8')).toBe('current')
    const transactions = path.join(f.launch.binding.internalDir, 'migrations')
    const transaction = readdirSync(transactions).find(name => /^[a-f0-9-]{36}$/.test(name))!
    expect(readFileSync(path.join(transactions, transaction, 'sources', '0', 'Local Storage/leveldb/000001.log'), 'utf8')).toBe('chromium')
    const restarted = await initializeDesktopStorage({ ...f.launch, sources: [] }, f.hooks, validate)
    await restarted.release()
    expect(validate).toHaveBeenCalledOnce()
    f.owned(first.directory, { 'Local Storage/leveldb/000001.log': 'late old writer' })
    await expect(initializeDesktopStorage(f.launch, f.hooks, validate)).rejects.toThrow()
    expect(readFileSync(path.join(first.directory, 'Local Storage/leveldb/000001.log'), 'utf8')).toBe('late old writer')
    expect(readFileSync(path.join(root, 'Local Storage/leveldb/000001.log'), 'utf8')).toBe('chromium')
  })

  it('does not accept, clean old sources or admit writers after restricted validation fails', async () => {
    const f = fixture()
    const source = f.owned(path.join(f.home, 'legacy'), { 'projects/keep.jsonl': 'keep' })
    f.launch.sources = [source]
    await expect(initializeDesktopStorage(f.launch, f.hooks, async () => { throw new Error('Native profile rejected') })).rejects.toThrow('Native profile rejected')
    expect(readFileSync(path.join(source.directory, 'projects/keep.jsonl'), 'utf8')).toBe('keep')
    await expect(acquireStorageWriter(f.launch.binding)).rejects.toThrow('validation-required')
    const lease = await initializeDesktopStorage(f.launch, f.hooks, async () => {})
    await lease.release()
    expect(existsSync(source.directory)).toBe(false)
  })

  it.each(['none', 'owned', 'unowned'] as const)('rediscovers sources after accepted cleanup recovery: %s', async variant => {
    const f = fixture()
    f.env.CLAUDE_CONFIG_DIR = f.launch.binding.root
    const source = f.owned(f.userData, { 'projects/accepted.jsonl': 'accepted bytes' })
    const imported = await executeStorageMigration({ binding: f.launch.binding, sources: [source], hooks: f.hooks })
    expect(imported.state).toBe('validation-required')
    f.put(source.directory, 'projects/accepted.jsonl', 'temporary late bytes')
    expect((await completeStorageMigration(f.launch.binding, imported.id!, f.hooks)).state).toBe('cleanup-pending')
    f.put(source.directory, 'projects/accepted.jsonl', 'accepted bytes')
    // The worker receives a structured clone, not a discovery callback.
    const launch = structuredClone(f.discover())
    expect(launch.sources.map(item => item.directory)).toContain(source.directory)
    const appeared = path.join(f.env.XDG_CONFIG_HOME!, 'claude-code-desktop')
    let injected = false
    f.hooks.assertQuiescent = async () => {
      if (injected || variant === 'none') return
      injected = true
      if (variant === 'owned') f.owned(appeared, { 'projects/new.jsonl': 'new source' })
      else f.put(appeared, 'Preferences', 'unknown owner')
    }
    const validate = vi.fn(async () => {
      expect(existsSync(source.directory)).toBe(false)
      expect(readFileSync(path.join(launch.binding.root, 'projects/new.jsonl'), 'utf8')).toBe('new source')
      expect(existsSync(appeared)).toBe(true)
      await expect(acquireStorageWriter(launch.binding)).rejects.toThrow('validation-required')
    })
    if (variant === 'unowned') {
      await expect(initializeDesktopStorage(launch, f.hooks, validate)).rejects.toThrow('Unproven or future storage ownership')
      expect(readFileSync(path.join(appeared, 'Preferences'), 'utf8')).toBe('unknown owner')
      expect(validate).not.toHaveBeenCalled()
    } else {
      const lease = await initializeDesktopStorage(launch, f.hooks, validate)
      await lease.release()
      expect(validate).toHaveBeenCalledTimes(variant === 'owned' ? 1 : 0)
      expect((await readStorageMigrationStatus(launch.binding))?.state).toBe('ready')
      expect(existsSync(appeared)).toBe(false)
    }
    expect(existsSync(source.directory)).toBe(false)
    expect(readFileSync(path.join(launch.binding.root, 'projects/accepted.jsonl'), 'utf8')).toBe('accepted bytes')
    const transactions = path.join(launch.binding.internalDir, 'migrations')
    expect(readFileSync(path.join(transactions, imported.id!, 'sources/0/projects/accepted.jsonl'), 'utf8')).toBe('accepted bytes')
    expect(readdirSync(transactions).filter(name => /^[a-f0-9-]{36}$/.test(name))).toHaveLength(variant === 'owned' ? 2 : 1)
    const writers = path.join(transactions, 'writers')
    expect(existsSync(writers) ? readdirSync(writers) : []).toEqual([])
  })

  it('still blocks a retired profile recreated while accepted recovery finishes', async () => {
    const f = fixture()
    f.env.CLAUDE_CONFIG_DIR = f.launch.binding.root
    const source = f.owned(f.userData, { 'projects/accepted.jsonl': 'accepted bytes' })
    const imported = await executeStorageMigration({ binding: f.launch.binding, sources: [source], hooks: f.hooks })
    expect(imported.state).toBe('validation-required')
    f.put(source.directory, 'projects/accepted.jsonl', 'temporary late bytes')
    expect((await completeStorageMigration(f.launch.binding, imported.id!, f.hooks)).state).toBe('cleanup-pending')
    f.put(source.directory, 'projects/accepted.jsonl', 'accepted bytes')
    const launch = structuredClone(f.discover())
    f.hooks.cleanupResources = async () => { f.owned(source.directory, { 'projects/accepted.jsonl': 'fork bytes' }) }
    const validate = vi.fn(async () => {})
    await expect(initializeDesktopStorage(launch, f.hooks, validate)).rejects.toThrow('Retired storage root')
    expect(validate).not.toHaveBeenCalled()
    expect(readFileSync(path.join(source.directory, 'projects/accepted.jsonl'), 'utf8')).toBe('fork bytes')
    expect(readFileSync(path.join(launch.binding.root, 'projects/accepted.jsonl'), 'utf8')).toBe('accepted bytes')
    const writers = path.join(launch.binding.internalDir, 'migrations/writers')
    expect(existsSync(writers) ? readdirSync(writers) : []).toEqual([])
  })

  it('does not infer complete-profile ownership from Chromium files', async () => {
    const f = fixture()
    const unowned = path.join(f.home, 'unknown-profile')
    f.put(unowned, 'Preferences', '{"unknown":true}')
    f.launch.sources = [{ directory: unowned, markerRoot: unowned }]
    await expect(initializeDesktopStorage(f.launch, f.hooks, async () => {})).rejects.toThrow()
    expect(readdirSync(unowned)).toEqual(['Preferences'])
    expect(readFileSync(path.join(unowned, 'Preferences'), 'utf8')).toBe('{"unknown":true}')
  })

  it('blocks before creating a profile when discovery or full owner verification fails', async () => {
    const f = fixture()
    f.launch.issues = ['Unresolved old profile']
    await expect(initializeDesktopStorage(f.launch, f.hooks, async () => {})).rejects.toThrow('Unresolved old profile')
    expect(existsSync(f.launch.binding.root)).toBe(false)
    f.launch.issues = []
    const source = f.owned(path.join(f.home, 'active-profile'), { 'Preferences': '{}' })
    f.launch.sources = [source]
    f.hooks.assertQuiescent = async () => { throw new Error('Chromium still owns the profile') }
    await expect(initializeDesktopStorage(f.launch, f.hooks, async () => {})).rejects.toThrow('Chromium still owns the profile')
    expect(readFileSync(path.join(source.directory, 'Preferences'), 'utf8')).toBe('{}')
    expect(existsSync(path.join(f.launch.binding.root, 'Preferences'))).toBe(false)
  })
})

describe('desktop complete-root relaunch', () => {
  it('drops consumed move controls without dropping unrelated arguments or positional values', () => {
    const root = path.join(os.tmpdir(), 'selected complete root')
    const move = { source: path.join(os.tmpdir(), 'source'), id: '11111111-1111-4111-8111-111111111111', proof: 'a'.repeat(64) + ':1:2' }
    const args = desktopMoveRelaunchArgs(['main.cjs', '--flag', 'echoflowcode://callback'], root, move)
    expect(desktopStorageRelaunchArgs([...args, '--', '--user-data-dir=positional'], { move }))
      .toEqual(['main.cjs', '--flag', 'echoflowcode://callback', '--', '--user-data-dir=positional'])
  })

  it('drops a completed adoption request while preserving its externally selected root', () => {
    const source = path.join(os.tmpdir(), 'openai-oauth.json')
    const adoption = { kind: 'openai-oauth' as const, source, id: '11111111-1111-4111-8111-111111111111', proof: 'a'.repeat(64) + ':1:2:3' }
    const rootArg = `--user-data-dir=${path.join(os.tmpdir(), 'selected')}`
    const args = ['main.cjs', rootArg, '--echoflow-openai-oauth-source', source, `--echoflow-openai-oauth-id=${adoption.id}`, `--echoflow-openai-oauth-proof=${adoption.proof}`]
    expect(desktopStorageRelaunchArgs(args, { adoption })).toEqual(['main.cjs', rootArg])
  })
})
