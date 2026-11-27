// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { cpSync, existsSync, renameSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildEchoFlowOwnershipMarker } from '../../../src/utils/echoFlowConfigRoot'
import { legacyStorageArchive, migrationManifest, migrationDirectoryIdentity, readStorageMigrationStatus, type StorageMigrationHooks } from '../../../src/services/storageMigration'
import { discoverDesktopStorage, initializeDesktopStorage } from './desktopStorageStartup'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }) })

async function fixture(stage = 'restarting', inPlace = false) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-cold-v1-')))
  homes.push(home)
  const source = path.join(home, 'source')
  const target = path.join(home, 'target')
  const profile = inPlace ? target : path.join(home, 'profile')
  const put = async (directory: string, name: string, value: string) => {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await fs.writeFile(path.join(directory, name), value)
  }
  for (const directory of [source, target]) {
    await put(directory, 'app.json', JSON.stringify(buildEchoFlowOwnershipMarker()))
    await put(directory, 'projects/keep.jsonl', 'original')
  }
  const id = 'released-fixture'
  const receipt = JSON.stringify({ version: 1, status: { id, sourceDir: source, targetDir: target, stage, cancellable: false },
    oldMode: '{ "mode": "default", "unknown": 42 }', stagingDir: path.join(target, `.cc-haha-migration-${id}`),
    directories: { source: await migrationDirectoryIdentity(source), target: await migrationDirectoryIdentity(target) },
    manifest: await migrationManifest(target), credentials: [], createdCredentials: [], future: { keep: true } }) + '\n'
  await put(profile, 'data-migration-v1.json', receipt)
  await put(profile, 'app-mode.json', JSON.stringify({ mode: 'portable', portable_dir: target, future: 73 }))
  const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config') }
  const switches: Record<string, string> = {}
  const app = { getPath: (name: 'home' | 'userData' | 'exe') => name === 'home' ? home : name === 'userData' ? profile : path.join(home, 'install', 'echoflow'),
    commandLine: { hasSwitch: (name: string) => name in switches, getSwitchValue: (name: string) => switches[name] ?? '' } }
  const hooks: StorageMigrationHooks = { platform: 'linux', assertQuiescent: vi.fn(async () => {}) }
  const discover = () => discoverDesktopStorage(app, env, 'linux', home)
  const archiveReceipts = async (root: string): Promise<string[]> => {
    const found: string[] = []
    async function walk(directory: string) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) await walk(file)
        else if (entry.name === 'data-migration-v1.json') found.push(await fs.readFile(file, 'utf8'))
      }
    }
    await walk(path.join(root, 'echoflow-code'))
    return found
  }
  return { home, source, target, profile, receipt, put, env, switches, hooks, discover, archiveReceipts }
}

it.each([false, true])('admits the inspector-selected restarting root and archives exact evidence (in-place %s)', async inPlace => {
  const f = await fixture('restarting', inPlace)
  const validate = vi.fn(async binding => {
    expect(binding.root).toBe(f.target)
    expect((await readStorageMigrationStatus(binding))?.state).toBe('validation-required')
    expect(await fs.readFile(path.join(f.profile, 'data-migration-v1.json'), 'utf8')).toBe(f.receipt)
  })
  const factory = vi.fn(() => f.hooks)
  const lease = await initializeDesktopStorage(f.discover(), factory, validate)
  try {
    expect(lease.binding.root).toBe(f.target)
    expect(factory).toHaveBeenCalledWith(lease.binding)
    expect(validate).toHaveBeenCalledOnce()
    expect(existsSync(path.join(f.target, 'data-migration-v1.json'))).toBe(false)
    expect(existsSync(path.join(f.target, 'app-mode.json'))).toBe(false)
    expect(await f.archiveReceipts(f.target)).toEqual(expect.arrayContaining([f.receipt]))
    expect(await fs.readFile(path.join(f.target, 'projects/keep.jsonl'), 'utf8')).toBe('original')
  } finally { await lease.release() }
  // No permanent root locator is recreated at the retired profile.
  expect(existsSync(path.join(f.profile, 'app-mode.json'))).toBe(false)
  await f.put(f.target, 'projects/keep.jsonl', 'legitimate subsequent write')
  const again = await initializeDesktopStorage(f.discover(), f.hooks, async () => { throw new Error('already accepted') })
  try { expect(again.binding.root).toBe(f.target) }
  finally { await again.release() }
})

it('reconciles a receipt before parsing its obsolete pointer and preserves the pointer bytes', async () => {
  const f = await fixture('copying')
  const obsolete = '{invalid obsolete pointer\n'
  await f.put(f.profile, 'app-mode.json', obsolete)
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
  await lease.release()
  expect(lease.binding.root).toBe(f.source)
  expect(await fs.readFile(path.join(f.source, legacyStorageArchive(f.profile), 'app-mode.json'), 'utf8')).toBe(obsolete)
})

it('completed receipts tolerate legitimate subsequent target writes and do not merge obsolete source data', async () => {
  const f = await fixture('completed')
  await f.put(f.target, 'projects/keep.jsonl', 'new target data')
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
  await lease.release()
  expect(await fs.readFile(path.join(f.target, 'projects/keep.jsonl'), 'utf8')).toBe('new target data')
  expect(await f.archiveReceipts(f.target)).toContain(f.receipt)
})

it.each(['preparing', 'quiescing', 'copying', 'verifying', 'committing', 'failed', 'cancelled'])('reconciles a %s receipt before its obsolete target pointer', async stage => {
  const f = await fixture(stage)
  if (!['failed', 'cancelled'].includes(stage)) await f.put(f.target, '.cc-haha-migration-released-fixture/partial', 'partial, never live')
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async binding => { expect(binding.root).toBe(f.source) })
  await lease.release()
  expect(lease.binding.root).toBe(f.source)
  expect(await fs.readFile(path.join(f.source, 'projects/keep.jsonl'), 'utf8')).toBe('original')
  expect(existsSync(path.join(f.source, '.cc-haha-migration-released-fixture'))).toBe(false)
  expect(await f.archiveReceipts(f.source)).toContain(f.receipt)
})

it('rejects genuine explicit root conflicts and root-dependent overrides before migration side effects', async () => {
  const f = await fixture()
  f.env.CLAUDE_CONFIG_DIR = f.source
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('Conflicting')
  delete f.env.CLAUDE_CONFIG_DIR
  f.env.WEBVIEW2_USER_DATA_FOLDER = path.join(f.source, 'EBWebView')
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('WebView')
  expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
  expect(existsSync(path.join(f.target, 'echoflow-code'))).toBe(false)
  expect(await fs.readFile(path.join(f.profile, 'data-migration-v1.json'), 'utf8')).toBe(f.receipt)
})

it.each(['ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG', 'WEBVIEW2_USER_DATA_FOLDER', 'disk-cache-dir', 'media-cache-dir'])('checks %s against the inspector-selected root before mutation', async control => {
  const f = await fixture('copying')
  await f.put(f.target, '.cc-haha-migration-released-fixture/partial', 'must remain on rejection')
  if (control.includes('-')) f.switches[control] = path.join(f.source, 'outside')
  else f.env[control] = path.join(f.source, 'outside')
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('conflicts')
  expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
  expect(await fs.readFile(path.join(f.target, '.cc-haha-migration-released-fixture/partial'), 'utf8')).toBe('must remain on rejection')
  expect(existsSync(path.join(f.source, 'echoflow-code'))).toBe(false)
})

it('accepts identical duplicate receipts but rejects conflicting stages before mutating either root', async () => {
  const f = await fixture('completed')
  await f.put(f.target, 'data-migration-v1.json', f.receipt)
  const changed = JSON.stringify({ ...JSON.parse(f.receipt), status: { ...JSON.parse(f.receipt).status, stage: 'failed' } })
  await f.put(f.target, 'data-migration-v1.json', changed)
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('Conflicting')
  expect(existsSync(path.join(f.source, 'echoflow-code'))).toBe(false)
  expect(existsSync(path.join(f.target, 'echoflow-code'))).toBe(false)
  await f.put(f.target, 'data-migration-v1.json', f.receipt)
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
  await lease.release()
  expect(existsSync(path.join(f.target, 'data-migration-v1.json'))).toBe(false)
  expect(await f.archiveReceipts(f.target)).toContain(f.receipt)
})

it('receipt replacement with identical bytes after inspection cannot be consumed', async () => {
  const f = await fixture('completed', true)
  let replaced = false
  f.hooks.assertQuiescent = async () => {
    if (replaced) return
    replaced = true
    await fs.rename(path.join(f.target, 'data-migration-v1.json'), path.join(f.target, 'original-receipt'))
    await f.put(f.target, 'data-migration-v1.json', f.receipt)
  }
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('changed after inspection')
  expect(await fs.readFile(path.join(f.target, 'data-migration-v1.json'), 'utf8')).toBe(f.receipt)
  expect(await fs.readFile(path.join(f.target, 'original-receipt'), 'utf8')).toBe(f.receipt)
})

it('rejects replacement of the inspector-selected root before migration admission', async () => {
  const f = await fixture('completed')
  const original = `${f.target}-original`
  const factory = () => {
    renameSync(f.target, original)
    cpSync(original, f.target, { recursive: true })
    return f.hooks
  }
  await expect(initializeDesktopStorage(f.discover(), factory, async () => {})).rejects.toThrow(/replaced|identity/)
  expect(f.hooks.assertQuiescent).not.toHaveBeenCalled()
  expect(existsSync(path.join(f.target, 'echoflow-code'))).toBe(false)
  expect(await fs.readFile(path.join(f.profile, 'data-migration-v1.json'), 'utf8')).toBe(f.receipt)
})

it('requires actual cold quiescence before removing interrupted staging or admitting a writer', async () => {
  const f = await fixture('copying')
  await f.put(f.target, '.cc-haha-migration-released-fixture/partial', 'must remain')
  f.hooks.assertQuiescent = async () => { throw new Error('external Chromium owner') }
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => {})).rejects.toThrow('external Chromium owner')
  expect(await fs.readFile(path.join(f.target, '.cc-haha-migration-released-fixture/partial'), 'utf8')).toBe('must remain')
  expect(await fs.readFile(path.join(f.profile, 'data-migration-v1.json'), 'utf8')).toBe(f.receipt)
})

it('uses only fixed owned projections when the v1 selected root is protected shared state', async () => {
  const f = await fixture('completed')
  const shared = path.join(f.home, '.claude')
  await f.put(shared, 'app.json', JSON.stringify(buildEchoFlowOwnershipMarker()))
  await f.put(shared, 'settings.json', '{"foreign":true}')
  await f.put(shared, 'projects/foreign.jsonl', 'foreign transcript')
  await f.put(shared, 'terminal-config.json', '{"bash_path":null,"future":42}')
  await f.put(shared, 'cc-haha/providers.json', '{"providers":[],"activeId":null,"unknown":7}')
  const raw = JSON.stringify({ ...JSON.parse(f.receipt), status: { ...JSON.parse(f.receipt).status, targetDir: shared }, stagingDir: path.join(shared, '.cc-haha-migration-released-fixture'), directories: undefined })
  await f.put(f.profile, 'data-migration-v1.json', raw)
  await f.put(f.profile, 'app-mode.json', JSON.stringify({ mode: 'portable', portable_dir: shared }))
  f.hooks.upgradeJson = (_relative, value) => value
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
  await lease.release()
  expect(lease.binding.root).not.toBe(shared)
  expect(await fs.readFile(path.join(shared, 'settings.json'), 'utf8')).toBe('{"foreign":true}')
  expect(await fs.readFile(path.join(shared, 'projects/foreign.jsonl'), 'utf8')).toBe('foreign transcript')
  expect(await fs.readFile(path.join(lease.binding.root, 'terminal-config.json'), 'utf8')).toBe('{"bash_path":null,"future":42}')
  expect(await f.archiveReceipts(lease.binding.root)).toContain(raw)
  expect(existsSync(path.join(shared, 'app-mode.json'))).toBe(false)
})

it('does not let a consumed pointer hide a new conflicting recovery receipt', async () => {
  const f = await fixture('failed')
  await fs.rm(path.join(f.profile, 'data-migration-v1.json'))
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => { throw new Error('interrupted pointer validation') })).rejects.toThrow('interrupted pointer validation')
  await f.put(f.profile, 'data-migration-v1.json', f.receipt)
  const validate = vi.fn(async () => {})
  await expect(initializeDesktopStorage(f.discover(), f.hooks, validate)).rejects.toThrow('Conflicting')
  expect(validate).not.toHaveBeenCalled()
  expect(await fs.readFile(path.join(f.profile, 'data-migration-v1.json'), 'utf8')).toBe(f.receipt)
})

it('recovers a published v2 transaction without reinterpreting its consumed v1 manifest', async () => {
  const f = await fixture('restarting', true)
  await expect(initializeDesktopStorage(f.discover(), f.hooks, async () => { throw new Error('interrupted validator') })).rejects.toThrow('interrupted validator')
  // Publication of relocation/history files legitimately changed the old v1 manifest.
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
  await lease.release()
  expect(await f.archiveReceipts(f.target)).toContain(f.receipt)
})

it('imports only proven shared desktop files and leaves unrelated shared state and credentials untouched', async () => {
  const f = await fixture('completed')
  const shared = path.join(f.home, '.claude')
  const state = '{"x":0,"y":0,"width":1280,"height":820,"maximized":false,"future":42}\n'
  await f.put(shared, 'window-state.json', state)
  await f.put(shared, 'settings.json', '{"foreign":true}')
  await f.put(shared, 'projects/foreign.jsonl', 'foreign transcript')
  const resources = vi.fn<NonNullable<StorageMigrationHooks['prepareResources']>>(async () => {})
  f.hooks.prepareResources = resources
  const lease = await initializeDesktopStorage(f.discover(), f.hooks, async () => {})
  await lease.release()
  expect(await fs.readFile(path.join(f.target, 'window-state.json'), 'utf8')).toBe(state)
  expect(await fs.readFile(path.join(shared, 'settings.json'), 'utf8')).toBe('{"foreign":true}')
  expect(await fs.readFile(path.join(shared, 'projects/foreign.jsonl'), 'utf8')).toBe('foreign transcript')
  expect(existsSync(path.join(shared, 'window-state.json'))).toBe(false)
  const relocations = JSON.parse(await fs.readFile(path.join(f.target, 'echoflow-code/storage-relocations.json'), 'utf8'))
  expect(relocations.mappings.some((mapping: { from: string }) => mapping.from === shared || mapping.from === f.target)).toBe(false)
  for (const [, sources] of resources.mock.calls) expect(sources.every((source: { layout?: string }) => !source.layout)).toBe(true)
})
