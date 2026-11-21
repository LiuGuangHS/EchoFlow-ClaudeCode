import { lstat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { bindStorageRoot, resolveStorageBinding, type StorageBinding } from '../utils/echoFlowConfigRoot.js'
import { PRODUCT_IDENTITY } from '../utils/productIdentity.generated.js'
import type { StorageMigrationHooks, StorageMigrationResult, StorageMigrationSource } from './storageMigration.js'

async function populated(directory: string): Promise<boolean> {
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Linked or non-directory storage source requires explicit resolution: ${directory}`)
    return (await readdir(directory)).length > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Discovery never claims the shared .claude root or chooses a legacy profile over another. */
export async function discoverHeadlessStorageSources(binding: StorageBinding): Promise<StorageMigrationSource[]> {
  const { legacyDesktopStateNames } = await import('./storageMigration.js')
  const home = homedir()
  const sources: StorageMigrationSource[] = []
  const parents = process.platform === 'win32'
    ? [process.env.APPDATA || join(home, 'AppData', 'Roaming'), process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')]
    : process.platform === 'darwin'
      ? [join(home, 'Library', 'Application Support')]
      : [process.env.XDG_CONFIG_HOME || join(home, '.config')]
  const profiles = new Set(parents.flatMap(parent =>
    [PRODUCT_IDENTITY.name, PRODUCT_IDENTITY.slug, PRODUCT_IDENTITY.legacyDesktopPackageName].map(name => join(parent, name))))
  for (const directory of profiles) {
    if (resolve(directory) !== binding.root && await populated(directory)) sources.push({ directory, markerRoot: directory })
  }
  for (const parent of new Set([join(home, '.claude'), binding.root])) {
    for (const name of ['cc-haha', 'echoflow-code']) {
      if (resolve(parent) === binding.root && name === 'echoflow-code') continue
      const directory = join(parent, name)
      if (await populated(directory)) sources.push({ directory, markerRoot: parent, ownership: 'legacy-internal', destination: 'echoflow-code' })
    }
    if (resolve(parent) !== binding.root) {
      try {
        if ((await readdir(parent)).some(name => legacyDesktopStateNames.includes(name as typeof legacyDesktopStateNames[number]))) {
          sources.push({ directory: parent, markerRoot: parent, layout: 'desktop-state' })
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  try {
    await lstat(join(binding.root, '.config.json'))
    sources.push({ directory: binding.root, markerRoot: binding.root, layout: 'root-config' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    if ((await readdir(binding.internalDir)).some(name => /^(?:index-v1|trace-index-v1|search-index-v1|scheduled-runs-v1)\.sqlite(?:-(?:wal|shm|journal))?$/.test(name))) {
      sources.push({ directory: binding.internalDir, markerRoot: binding.root, destination: 'echoflow-code', layout: 'flat-indexes' })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return sources
}

export type StorageStartupOptions = {
  hooks: StorageMigrationHooks
  validateRestrictedStartup(binding: StorageBinding): Promise<void>
}

/** Run before dynamic imports of business modules. No unproven quiescence or automatic acceptance. */
export async function prepareHeadlessStorage(options?: StorageStartupOptions): Promise<{ binding: StorageBinding; release(): Promise<void> }> {
  const { acquireStorageWriter, completeStorageMigration, executeStorageMigration, prepareStorageMigration, readStorageMigrationStatus, recoverStorageMigration, selectStartupStorage, storageLocationFile } = await import('./storageMigration.js')
  const binding = selectStartupStorage(resolveStorageBinding(), storageLocationFile())
  const status = await readStorageMigrationStatus(binding)
  if (status && status.state !== 'ready' && (status.handoff || status.legacySelection)) {
    throw new Error('A desktop storage migration is pending; open EchoFlow Desktop to finish it')
  }
  let sources = await discoverHeadlessStorageSources(binding)
  if (sources.length || (status && status.state !== 'ready')) {
    if (!options) {
      const [{ createStorageMigrationHooks }, { validateRestrictedHeadlessStorage }] = await Promise.all([
        import('./storageMigrationValidation.js'),
        import('./storageStartupValidation.js'),
      ])
      options = { hooks: createStorageMigrationHooks(binding), validateRestrictedStartup: validateRestrictedHeadlessStorage }
    }
    let result: StorageMigrationResult = status && status.state !== 'ready'
      ? await recoverStorageMigration(binding, options.hooks)
      : { state: 'ready', issues: [] }
    if (result.state === 'validation-required') {
      await options.validateRestrictedStartup(binding)
      result = await completeStorageMigration(binding, result.id!, options.hooks)
    }
    // Recovery can retire old sources or expose another candidate before writer admission.
    if (result.state === 'ready') sources = await discoverHeadlessStorageSources(binding)
    if (result.state === 'ready' && sources.length) {
      await prepareStorageMigration({ binding, sources })
      result = await executeStorageMigration({ binding, sources, hooks: options.hooks })
    }
    if (result.state === 'validation-required') {
      await options.validateRestrictedStartup(binding)
      result = await completeStorageMigration(binding, result.id!, options.hooks)
    }
    if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`)
  }
  // acquire checks every retained receipt (including fork detection) without taking an
  // exclusive migration lock, so ready CLI/server/adapter writers can coexist.
  const lease = await acquireStorageWriter(binding)
  try {
    bindStorageRoot(binding)
    return { binding, release: lease.release }
  } catch (error) {
    await lease.release()
    throw error
  }
}

let lifetime: Promise<{ binding: StorageBinding; release(): Promise<void> }> | undefined
let releasing: Promise<void> | undefined

export async function initializeProcessStorage(): Promise<void> {
  if (lifetime) { await lifetime; return }
  lifetime = prepareHeadlessStorage()
  await lifetime
  process.once('beforeExit', () => {
    void releaseProcessStorage().catch(error => {
      console.error('[Storage] Writer lease release failed', error)
      process.exitCode = 1
    })
  })
}

/** Call only after the host has stopped and drained its writers. */
export async function releaseProcessStorage(): Promise<void> {
  if (!lifetime) return
  releasing ??= lifetime.then(lease => lease.release())
  await releasing
}
