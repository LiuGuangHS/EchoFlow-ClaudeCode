import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { resolveStorageBinding, type StorageBinding } from '../../src/utils/echoFlowConfigRoot'
import {
  armStorageHandoff, assertUnlinkedDirectoryPath, canonicalPath, completeStorageMigration, executeStorageMigration,
  isWithin, legacyControlNames, prepareStorageHandoff, prepareStorageMigration, readStorageHandoff, readStorageLocation, readStorageMigrationStatus, recoverStorageMigration, storageLocationFile,
  type StorageMigrationHooks, type StorageMigrationResult, type StorageMigrationSource,
} from '../../src/services/storageMigration'
import { createStorageMigrationHooks } from '../../src/services/storageMigrationValidation'
import { validateRestrictedHeadlessStorage } from '../../src/services/storageStartupValidation'
import { readLegacyDataMigrationReceipt } from '../electron/services/dataMigrationLegacyRecovery'

type InstallerRecoveryRequest = { source?: string; profile: string; installDirs: string[]; env?: NodeJS.ProcessEnv }
type InstallerRecoveryOptions = {
  hooks?: StorageMigrationHooks
  validateRestrictedStartup?(binding: StorageBinding): Promise<void>
}

async function inspectedControls(directory: string, source: string): Promise<StorageMigrationSource['controls']> {
  const controls: NonNullable<StorageMigrationSource['controls']> = {}
  for (const name of legacyControlNames) {
    const file = path.join(directory, name)
    let stat
    try { stat = await fs.lstat(file, { bigint: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (!stat.isFile() || stat.nlink !== 1n) throw new Error('Installer recovery control is not an independent regular file')
    if (name === 'data-migration-v1.json') {
      const receipt = await readLegacyDataMigrationReceipt(directory)
      if (!receipt || !['completed', 'failed', 'cancelled'].includes(receipt.journal.status.stage)) throw new Error('Finish legacy receipt recovery in the application before upgrading')
      // Terminal paths describe history, not current ownership or current directory identities.
      controls[name] = { digest: createHash('sha256').update(receipt.rawJournal).digest('hex'), ...receipt.journalIdentity }
    } else {
      const bytes = await fs.readFile(file)
      const mode = JSON.parse(bytes.toString('utf8'))
      if (!mode || typeof mode !== 'object' || Array.isArray(mode) ||
        (mode.mode !== undefined && !['default', 'portable'].includes(mode.mode)) ||
        (mode.portable_dir !== undefined && mode.portable_dir !== null && typeof mode.portable_dir !== 'string')) throw new Error('Invalid legacy installer selection')
      if (mode.mode === 'portable' && mode.portable_dir && await canonicalPath(mode.portable_dir) !== source) throw new Error('Conflicting legacy installer selection')
      controls[name] = { digest: createHash('sha256').update(bytes).digest('hex'), dev: String(stat.dev), ino: String(stat.ino) }
    }
  }
  return Object.keys(controls).length ? controls : undefined
}

async function assertNativeValidationAvailable(roots: string[]): Promise<void> {
  // shortcut: this Bun runtime has no native profile owner; block before arming until one is packaged and qualified.
  const nativeNames = new Set(['local state', 'preferences', 'local storage', 'indexeddb', 'session storage', 'webstorage', 'partitions', 'cookies', 'network', 'login data', 'service worker', 'file system', 'storage', 'databases', 'ebwebview', 'default'])
  for (const root of roots) {
    let names: string[]
    try { names = await fs.readdir(root) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (names.some(name => nativeNames.has(name.toLowerCase()))) throw new Error('Chromium profile data requires restricted native desktop validation before installer recovery')
  }
}

function requireReady(result: StorageMigrationResult): void {
  if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Installer storage migration is ${result.state}`)
}

/** Called only after the PowerShell discovery/identity guards, before the old uninstaller. */
export async function recoverInstallerStorage(request: InstallerRecoveryRequest, options: InstallerRecoveryOptions = {}): Promise<{ root: string; state: 'ready' }> {
  const env = request.env ?? process.env
  const homeDir = env.USERPROFILE || env.HOME || homedir()
  const targetBinding = resolveStorageBinding({ env: { ...env, CLAUDE_CONFIG_DIR: undefined }, homeDir })
  if (request.source === undefined) {
    // Accepted cleanup can retire the source and its pointer before the ready receipt is durable.
    const status = await readStorageMigrationStatus(targetBinding)
    if (status && status.state !== 'ready') throw new Error(`Finish storage recovery in the application before upgrading (${status.state})`)
    return { root: targetBinding.root, state: 'ready' }
  }
  const source = await canonicalPath(request.source)
  const profile = await canonicalPath(request.profile)
  let profileAncestor = request.profile
  while (!await fs.exists(profileAncestor)) profileAncestor = path.dirname(profileAncestor)
  await assertUnlinkedDirectoryPath(profileAncestor)
  const selected = env.CLAUDE_CONFIG_DIR
  if (selected && (env.CC_HAHA_APP_PORTABLE_DIR !== '1' || await canonicalPath(selected) !== source)) throw new Error('Installer cannot replace an externally managed storage root')
  // An install-contained legacy selection cannot remain the final R after uninstall.
  const file = storageLocationFile(homeDir)
  const binding = { ...targetBinding, location: { file, moveSource: source } }
  const activeRoot = readStorageLocation(file)
  if (activeRoot && activeRoot !== binding.root && activeRoot !== source) throw new Error('Installer source conflicts with the active EchoFlow storage directory')
  const target = await canonicalPath(binding.root)
  if (target !== binding.root) throw new Error('Installer target has an unresolved storage alias')
  if (!request.installDirs.length) throw new Error('Installer recovery needs protected install directories')
  const installs = await Promise.all(request.installDirs.map(canonicalPath))
  if (!installs.some(install => install !== source && isWithin(install, source))) throw new Error('Installer source is not contained in an old install directory')
  for (const install of installs) {
    if ([binding.root, profile, process.execPath].some(file => isWithin(install, file))) throw new Error('Installer target, metadata or recovery runtime is inside an install directory')
  }
  if (isWithin(source, binding.root) || isWithin(binding.root, source)) throw new Error('Installer storage roots overlap')
  const hooks = options.hooks ?? createStorageMigrationHooks(binding)
  const validate = async () => {
    // Never substitute Bun/schema/integrity checks for a restricted native Chromium owner.
    await assertNativeValidationAvailable([binding.root])
    await validateRestrictedHeadlessStorage(binding)
    await options.validateRestrictedStartup?.(binding)
  }
  const finish = async (result: StorageMigrationResult) => {
    if (result.state === 'validation-required') {
      await validate()
      result = await completeStorageMigration(binding, result.id!, hooks)
    }
    requireReady(result)
  }
  const status = await readStorageMigrationStatus(binding)
  if (status && (status.state !== 'ready' || status.sources.includes(source))) {
    if (!status.sources.includes(source)) throw new Error('Installer source conflicts with the existing storage transaction')
    // Recover before a new preview/arm, including accepted cleanup with an absent source.
    await hooks.assertQuiescent([binding.root, ...status.sources])
    await assertNativeValidationAvailable([source, binding.root])
    if (status.state === 'ready') await validate()
    await finish(await recoverStorageMigration(binding, hooks))
    return { root: binding.root, state: 'ready' }
  }
  await assertUnlinkedDirectoryPath(request.source)
  await hooks.assertQuiescent([binding.root, source, profile])
  await assertNativeValidationAvailable([source, binding.root])
  const controls = await inspectedControls(source, source)
  const sources: StorageMigrationSource[] = [{ directory: source, markerRoot: source, ...(controls ? { controls } : {}) }]
  if (profile !== source) {
    const controls = await inspectedControls(profile, source)
    if (controls) sources.push({ directory: profile, markerRoot: profile, layout: 'legacy-controls', controls })
  }
  const plan = await prepareStorageMigration({ binding, sources })
  // A pre-transaction crash reuses the shared durable request; a consumed one is recovered above.
  if (!await readStorageHandoff(source, binding.root)) {
    const preview = await prepareStorageHandoff(plan)
    await hooks.assertQuiescent([binding.root, ...sources.map(source => source.directory)])
    await assertNativeValidationAvailable([source, binding.root])
    await armStorageHandoff(preview, randomUUID())
  }
  await finish(await executeStorageMigration({ binding, sources, hooks }))
  return { root: binding.root, state: 'ready' }
}

export function parseInstallerRecoveryArgs(args: string[]): InstallerRecoveryRequest {
  const values = new Map<string, string>()
  const installDirs: string[] = []
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!
    const value = args[index + 1]
    if (!['--source', '--profile', '--install-dir'].includes(flag) || !value || !path.isAbsolute(value) || value.includes('\0')) throw new Error('Invalid installer recovery arguments')
    if (flag === '--install-dir') installDirs.push(value)
    else {
      if (values.has(flag)) throw new Error('Duplicate installer recovery argument')
      values.set(flag, value)
    }
  }
  if (!values.has('--profile') || !installDirs.length) throw new Error('Missing installer recovery arguments')
  return { source: values.get('--source'), profile: values.get('--profile')!, installDirs }
}
