import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PRODUCT_IDENTITY } from '../../src/lib/productIdentity.generated'
import { resolveStorageBinding, type StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { assertMigrationDirectory, isWithin, legacyControlNames, legacyDesktopStateNames, readConsumedStorageControls, readPendingDesktopStorageHandoff, readStorageLocation, selectStartupStorage, storageLocationFile, type StorageMigrationHooks, type StorageMigrationInput, type StorageMigrationSource } from '../../../src/services/storageMigration'
import { determineStartupPortableDir, normalizedCustomDir, parseLegacyPortableSelection, type AppModeAppLike } from './appMode'
import { cleanupLegacyDataMigrationRecovery, inspectLegacyDataMigrationRecovery, readLegacyDataMigrationReceipt, type LegacyDataMigrationRecoveryPlan } from './dataMigrationLegacyRecovery'
import type { MigrationCredentialStore } from './migrationCredentials'
import { assertNoPendingDesktopMove, desktopMoveLaunch, inspectDesktopMove, lockDesktopMoveSource, type DesktopMoveLaunch } from './desktopStorageMove'
import { desktopStorageAdoptionLaunch, desktopStorageAdoptionSwitches, executeDesktopStorageAdoption, type DesktopStorageAdoptionLaunch } from './desktopStorageAdoption'

const flatIndexFile = /^(?:index-v1|trace-index-v1|search-index-v1|scheduled-runs-v1)\.sqlite(?:-(?:wal|shm|journal))?$/
const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex')
type ControlSnapshot = { directory: string; values: NonNullable<StorageMigrationSource['controls']>; appModeBytes?: string }
export type DesktopStorageControls = {
  /** Only controls present before bootstrap writes any environment or Chromium paths. */
  roots: string[]
  environmentRoot?: string
  runtimeConfig?: string
  webView?: string
  diskCache?: string
  mediaCache?: string
}
export type DesktopStorageLaunch = {
  binding: StorageBinding
  sources: StorageMigrationSource[]
  issues: string[]
  controls?: DesktopStorageControls
  locationFile?: string
  move?: DesktopMoveLaunch
  adoption?: DesktopStorageAdoptionLaunch
  /** The worker must rediscover after recovery; callbacks cannot cross workerData. */
  discovery?: { profileDirectories: string[]; homeDir: string; defaultRoot?: string; executable?: string; platform?: NodeJS.Platform }
  recovery?: { protectedDirectories: string[]; archiveDirectories: string[]; controls: ControlSnapshot[] }
}
export type DesktopStorageApp = AppModeAppLike & {
  commandLine: { hasSwitch(name: string): boolean; getSwitchValue(name: string): string }
}

/** Compare physical identities, including aliases whose final components do not exist yet. */
export function desktopStorageIdentity(directory: string): string {
  if (!path.isAbsolute(directory) || directory.includes('\0')) throw new Error('Storage root must be an absolute directory')
  let ancestor = path.resolve(directory)
  const suffix: string[] = []
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) throw new Error(`Storage ancestor is unavailable: ${directory}`)
    suffix.unshift(path.basename(ancestor))
    ancestor = parent
  }
  if (suffix.length && !statSync(ancestor).isDirectory()) throw new Error(`Storage ancestor is not a directory: ${ancestor}`)
  return path.join(realpathSync.native(ancestor), ...suffix)
}
function retainedSelection(directory: string, executable: string, homeDir: string): string | null {
  return determineStartupPortableDir({ getPath: name => name === 'userData' ? directory : name === 'exe' ? executable : homeDir }, {})
}
function controlSnapshot(directory: string): ControlSnapshot | null {
  const values: ControlSnapshot['values'] = {}
  let appModeBytes: string | undefined
  for (const name of legacyControlNames) {
    const file = path.join(directory, name)
    const stat = lstatSync(file, { bigint: true, throwIfNoEntry: false })
    if (!stat) continue
    if (!stat.isFile() || stat.nlink !== 1n) throw new Error(`Invalid legacy control file: ${file}`)
    const bytes = readFileSync(file, 'utf8')
    values[name] = { digest: digest(bytes), dev: String(stat.dev), ino: String(stat.ino) }
    if (name === 'app-mode.json') appModeBytes = bytes
  }
  return Object.keys(values).length ? { directory, values, appModeBytes } : null
}

/** Discovery only. Receipt-associated pointers are not authoritative until cold inspection. */
export function discoverDesktopStorage(
  app: DesktopStorageApp,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): DesktopStorageLaunch {
  const explicit = [env.CLAUDE_CONFIG_DIR || undefined]
  if (app.commandLine.hasSwitch('user-data-dir')) explicit.push(app.commandLine.getSwitchValue('user-data-dir'))
  if (explicit.some(value => value === '')) throw new Error('Storage root must be an absolute directory')
  const roots = explicit.filter((value): value is string => value !== undefined).map(desktopStorageIdentity)
  if (roots.some(root => root !== roots[0])) throw new Error(`Conflicting storage root selections: ${roots.join(', ')}`)
  const controls = { roots, environmentRoot: env.CLAUDE_CONFIG_DIR ? desktopStorageIdentity(env.CLAUDE_CONFIG_DIR) : undefined,
    runtimeConfig: env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG, webView: env.WEBVIEW2_USER_DATA_FOLDER,
    diskCache: app.commandLine.hasSwitch('disk-cache-dir') ? app.commandLine.getSwitchValue('disk-cache-dir') : undefined,
    mediaCache: app.commandLine.hasSwitch('media-cache-dir') ? app.commandLine.getSwitchValue('media-cache-dir') : undefined }
  const locationFile = storageLocationFile(homeDir)
  const move = desktopMoveLaunch(app.commandLine)
  const adoption = desktopStorageAdoptionLaunch(app.commandLine)
  if (move && adoption) throw new Error('Conflicting cold storage launch requests')
  if (move) {
    if (!app.commandLine.hasSwitch('user-data-dir') || !roots[0]) throw new Error('Desktop move requires its explicit target root')
    normalizedCustomDir(app, roots[0])
    normalizedCustomDir(app, move.source)
    return { binding: resolveStorageBinding({ env: {}, roots: [roots[0]] }), sources: [], issues: [], controls, locationFile, move }
  }
  if (adoption) {
    const selected = resolveStorageBinding({ env: { ...env, CLAUDE_CONFIG_DIR: undefined }, roots, platform, homeDir })
    const binding = selectStartupStorage({ ...resolveStorageBinding({ env: {}, roots: [desktopStorageIdentity(selected.root)] }), selection: selected.selection }, locationFile)
    normalizedCustomDir(app, binding.root)
    return { binding, sources: [], issues: [], controls, adoption }
  }
  const activeRoot = readStorageLocation(locationFile)
  if (activeRoot && roots.some(root => root !== activeRoot)) throw new Error('Explicit storage root conflicts with the active EchoFlow storage directory')
  const defaultRoot = desktopStorageIdentity(resolveStorageBinding({ env: { ...env, CLAUDE_CONFIG_DIR: undefined }, platform, homeDir }).root)
  const profileParents = platform === 'win32'
    ? [env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')]
    : platform === 'darwin' ? [path.join(homeDir, 'Library', 'Application Support')] : [env.XDG_CONFIG_HOME || path.join(homeDir, '.config')]
  const candidates = new Set([app.getPath('userData'), defaultRoot, ...profileParents.flatMap(parent =>
    [PRODUCT_IDENTITY.name, PRODUCT_IDENTITY.slug, PRODUCT_IDENTITY.legacyDesktopPackageName].map(name => path.join(parent, name))), ...roots].map(desktopStorageIdentity))
  const shared = path.join(homeDir, '.claude')
  if (existsSync(path.join(shared, 'data-migration-v1.json')) || existsSync(path.join(shared, 'app-mode.json'))) candidates.add(desktopStorageIdentity(shared))
  const portable = activeRoot ? [] : [...candidates].flatMap(directory => {
    if (existsSync(path.join(directory, 'data-migration-v1.json'))) return []
    const selected = retainedSelection(directory, app.getPath('exe'), homeDir)
    return selected ? [desktopStorageIdentity(selected)] : []
  })
  for (const directory of portable) candidates.add(directory)
  const hasReceipt = [...candidates].some(directory => existsSync(path.join(directory, 'data-migration-v1.json')))
  const selections = [...(activeRoot ? [activeRoot] : []), ...roots, ...portable]
  const root = selections[0] ?? defaultRoot
  if (!hasReceipt && selections.some(selected => selected !== root)) throw new Error(`Conflicting storage root selections: ${selections.join(', ')}`)
  if (!hasReceipt) {
    if (selections.length) normalizedCustomDir(app, root)
    const retained = retainedSelection(root, app.getPath('exe'), homeDir)
    if (retained && desktopStorageIdentity(retained) !== root) throw new Error('Conflicting storage root selections in the selected portable profile')
  }
  candidates.add(root)
  const binding = { ...resolveStorageBinding({ env: {}, roots: [root] }), selection: selections.length ? 'explicit' as const : 'default' as const }
  const discovery = { profileDirectories: [...candidates], homeDir, defaultRoot, executable: app.getPath('exe'), platform }
  return { binding, ...discoverDesktopStorageSources(binding, discovery), discovery, controls, locationFile }
}

/** Must run against the final root, before any transaction, cleanup or resource hook. */
export function assertDesktopStorageControls(binding: StorageBinding, controls?: DesktopStorageControls): void {
  if (!controls) return
  if (controls.roots.some(root => desktopStorageIdentity(root) !== binding.root)) throw new Error('Conflicting explicit storage root and legacy recovery selection')
  for (const [value, relative, label] of [
    [controls.runtimeConfig, 'claude-code-runtime.json', 'Runtime configuration'], [controls.webView, 'EBWebView', 'WebView storage'],
    [controls.diskCache, 'Cache', 'disk-cache-dir'], [controls.mediaCache, 'Media Cache', 'media-cache-dir'],
  ]) {
    if (value !== undefined && desktopStorageIdentity(value) !== desktopStorageIdentity(path.join(binding.root, relative!))) throw new Error(`${label} conflicts with the selected complete storage root`)
  }
}

async function resolveDesktopStorageLaunch(launch: DesktopStorageLaunch, options: { platform?: NodeJS.Platform; credentialStore?: MigrationCredentialStore }): Promise<{
  launch: DesktopStorageLaunch
  plans: LegacyDataMigrationRecoveryPlan[]
  legacySelection?: StorageMigrationInput['legacySelection']
}> {
  if (!launch.discovery) {
    assertDesktopStorageControls(launch.binding, launch.controls)
    return { launch, plans: [] }
  }
  const discovery = { ...launch.discovery, profileDirectories: [...launch.discovery.profileDirectories] }
  const { homeDir } = discovery
  const shared = desktopStorageIdentity(path.join(homeDir, '.claude'))
  const directories = new Set(discovery.profileDirectories)
  const consumed = new Map<string, { root: string; digest: string }>()
  // Parse hints only after looking for a current v2 receipt. Never revalidate an
  // old v1 manifest after the shared transaction has consumed those exact bytes.
  for (const directory of directories) {
    const binding = resolveStorageBinding({ env: {}, roots: [directory] })
    const activeControls = !isWithin(shared, directory) && !isWithin(directory, shared) && existsSync(path.join(directory, 'app.json'))
      ? await readConsumedStorageControls(binding) : []
    for (const control of activeControls) {
      const key = path.join(control.directory, control.name)
      const prior = consumed.get(key)
      if (prior && (prior.root !== directory || prior.digest !== control.digest)) throw new Error('Conflicting consumed legacy recovery evidence')
      consumed.set(key, { root: directory, digest: control.digest })
    }
    const journalPath = path.join(directory, 'data-migration-v1.json')
    const known = consumed.get(journalPath)
    if (known) continue
    const receipt = await readLegacyDataMigrationReceipt(directory)
    if (receipt) {
      directories.add(desktopStorageIdentity(receipt.journal.status.sourceDir))
      directories.add(desktopStorageIdentity(receipt.journal.status.targetDir))
    }
  }
  const plans: LegacyDataMigrationRecoveryPlan[] = []
  const selected = new Set<string>()
  const rawReceipts = new Set<string>()
  const controls: ControlSnapshot[] = []
  const protectedDirectories = new Set([shared])
  const archiveDirectories = new Set<string>()
  for (const directory of directories) {
    const snapshot = controlSnapshot(directory)
    if (snapshot) controls.push(snapshot)
    for (const [name, receipt] of Object.entries(snapshot?.values ?? {})) {
      const known = consumed.get(path.join(directory, name))
      if (!known) continue
      if (known.digest !== receipt.digest) throw new Error('Consumed legacy recovery evidence was changed or recreated')
      selected.add(known.root)
    }
    if (consumed.has(path.join(directory, 'data-migration-v1.json'))) continue
    const plan = await inspectLegacyDataMigrationRecovery(directory, { homeDir, platform: options.platform ?? discovery.platform, credentialStore: options.credentialStore })
    if (!plan) continue
    const receipt = snapshot?.values['data-migration-v1.json']
    if (receipt?.digest !== digest(plan.rawJournal) || receipt.dev !== plan.journalIdentity.dev || receipt.ino !== plan.journalIdentity.ino) {
      throw new Error('Legacy migration recovery record changed during discovery')
    }
    plans.push(plan)
    if (!existsSync(path.join(directory, 'app.json'))) protectedDirectories.add(directory)
    rawReceipts.add(digest(plan.rawJournal))
    if (rawReceipts.size > 1) throw new Error('Conflicting legacy migration recovery receipts')
    if (plan.requiredRoot) selected.add(desktopStorageIdentity(plan.requiredRoot))
    for (const protectedRoot of plan.protectedSources) protectedDirectories.add(desktopStorageIdentity(protectedRoot))
    const other = plan.selectedDirectory === plan.journal.status.sourceDir ? plan.journal.status.targetDir : plan.journal.status.sourceDir
    archiveDirectories.add(desktopStorageIdentity(other))
  }
  if (selected.size > 1) throw new Error('Conflicting legacy migration recovery selections')
  // Unrelated retained pointers still constrain selection; only receipt-scoped
  // or already-consumed controls lose their authority to select a root.
  const activeRoot = launch.locationFile && readStorageLocation(launch.locationFile)
  const portable: { directory: string; root: string }[] = []
  if (!activeRoot) for (const { directory, appModeBytes } of controls) {
    if (appModeBytes === undefined || plans.some(plan => path.dirname(plan.journalPath) === directory) || consumed.has(path.join(directory, 'app-mode.json')) || consumed.has(path.join(directory, 'data-migration-v1.json'))) continue
    const pointer = parseLegacyPortableSelection({ getPath: name => name === 'exe' ? discovery.executable! : name === 'home' ? homeDir : directory }, appModeBytes)
    if (pointer) portable.push({ directory, root: desktopStorageIdentity(pointer) })
  }
  const required = [...selected][0]
  if (activeRoot && (activeRoot !== launch.binding.root || (required && required !== activeRoot))) {
    throw new Error('Active EchoFlow storage directory conflicts with startup discovery; restart with the active directory')
  }
  const hasProtectedSelection = plans.some(plan => plan.requiredRoot === null)
  const root = activeRoot || (required ?? launch.controls?.roots[0] ?? portable[0]?.root ?? (hasProtectedSelection ? discovery.defaultRoot! : launch.binding.root))
  if (!activeRoot && portable.some(pointer => pointer.root !== root)) throw new Error('Conflicting retained storage root selections')
  if (protectedDirectories.has(root) || isWithin(shared, root) || isWithin(root, shared)) throw new Error('Protected shared storage cannot be the complete product root')
  if (discovery.executable) normalizedCustomDir({ getPath: name => name === 'exe' ? discovery.executable! : name === 'home' ? homeDir : root }, root)
  const binding: StorageBinding = { ...resolveStorageBinding({ env: {}, roots: [root] }),
    selection: required || portable.length || launch.controls?.roots.length ? 'explicit' : launch.binding.selection,
    ...(launch.locationFile ? { location: { file: launch.locationFile } } : {}) }
  assertDesktopStorageControls(binding, launch.controls)
  directories.add(root)
  discovery.profileDirectories = [...directories]
  const recovery = { protectedDirectories: [...protectedDirectories], archiveDirectories: [...archiveDirectories], controls }
  const plan = plans.find(item => item.requiredRoot && desktopStorageIdentity(item.requiredRoot) === root)
  const pointer = portable.find(item => item.root === root)
  const legacySelection = activeRoot ? undefined : plan
    ? { directory: path.dirname(plan.journalPath), name: 'data-migration-v1.json' as const }
    : pointer && { directory: pointer.directory, name: 'app-mode.json' as const }
  return { launch: { ...launch, binding, discovery, recovery, ...discoverDesktopStorageSources(binding, discovery, recovery) }, plans, legacySelection }
}

function discoverDesktopStorageSources(binding: StorageBinding, discovery: NonNullable<DesktopStorageLaunch['discovery']>, recovery?: DesktopStorageLaunch['recovery']): Pick<DesktopStorageLaunch, 'sources' | 'issues'> {
  const root = binding.root
  const { profileDirectories, homeDir } = discovery
  const sources: StorageMigrationSource[] = []
  const seen = new Set<string>()
  const add = (source: StorageMigrationSource) => {
    if (!existsSync(source.directory)) return
    const stat = statSync(source.directory, { bigint: true })
    if (!stat.isDirectory()) throw new Error(`Storage source is not a directory: ${source.directory}`)
    const canonical = desktopStorageIdentity(source.directory)
    const identity = `${stat.ino === 0n ? canonical : `${stat.dev}:${stat.ino}`}:${source.layout ?? 'profile'}`
    if (seen.has(identity)) return
    seen.add(identity)
    if (!readdirSync(source.directory).length) return
    sources.push(source)
  }
  const shared = desktopStorageIdentity(path.join(homeDir, '.claude'))
  const scoped = new Set([shared, ...(recovery?.protectedDirectories ?? [])])
  for (const directory of profileDirectories) {
    if (!existsSync(directory)) continue
    const controls = recovery?.controls.find(snapshot => snapshot.directory === directory)?.values
    const archive = recovery?.archiveDirectories.includes(directory) ? true : undefined
    const controlOnly = controls && readdirSync(directory).every(name => legacyControlNames.includes(name as typeof legacyControlNames[number]))
    if (directory !== root && !scoped.has(directory) && !controlOnly) add({ directory, markerRoot: directory, ...(controls ? { controls } : {}), ...(archive ? { archive } : {}) })
    else if (controls && Object.keys(controls).some(name => existsSync(path.join(directory, name)))) add({ directory, markerRoot: directory, layout: 'legacy-controls', controls })
  }
  for (const parent of new Set([shared, root, ...(recovery?.protectedDirectories ?? [])])) {
    const archive = recovery?.archiveDirectories.includes(parent) ? true : undefined
    for (const name of ['cc-haha', 'echoflow-code']) {
      if (parent === root && name === 'echoflow-code') continue
      const directory = path.join(parent, name)
      if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error(`Linked legacy storage requires explicit resolution: ${directory}`)
      add({ directory, markerRoot: parent, ownership: 'legacy-internal', destination: 'echoflow-code', ...(archive ? { archive } : {}) })
    }
    if (parent !== root && legacyDesktopStateNames.some(name => existsSync(path.join(parent, name)))) add({ directory: parent, markerRoot: parent, layout: 'desktop-state', ...(archive ? { archive } : {}) })
  }
  if (lstatSync(path.join(root, '.config.json'), { throwIfNoEntry: false })) add({ directory: root, markerRoot: root, layout: 'root-config' })
  if (existsSync(binding.internalDir) && readdirSync(binding.internalDir).some(name => flatIndexFile.test(name))) add({ directory: binding.internalDir, markerRoot: root, destination: 'echoflow-code', layout: 'flat-indexes' })
  return { sources, issues: [] }
}

async function initializeDesktopMove(
  launch: DesktopStorageLaunch,
  createHooks: StorageMigrationHooks | ((binding: StorageBinding) => StorageMigrationHooks),
  validate: (binding: StorageBinding) => Promise<void>,
): Promise<{ binding: StorageBinding; release(): Promise<void> }> {
  const binding = launch.locationFile ? { ...launch.binding, location: { file: launch.locationFile, moveSource: launch.move!.source } } : launch.binding
  assertDesktopStorageControls(binding, launch.controls)
  const move = await inspectDesktopMove(launch.move!, binding.root)
  const admit = async () => {
    const selected = launch.locationFile ? selectStartupStorage(launch.binding, launch.locationFile) : launch.binding
    return { binding: selected, ...await acquireStorageWriter(selected) }
  }
  await assertNoPendingDesktopMove(binding.root)
  if (!['accepted', 'completed'].includes(move.transaction?.phase ?? '')) await assertNoPendingDesktopMove(move.request.source, move.request.id)
  const sourceControls = !move.transaction ? controlSnapshot(move.request.source)?.values : undefined
  if (sourceControls?.['data-migration-v1.json']) throw new Error('Conflicting legacy recovery receipt and desktop move request')
  const { recoverStorageMigration, executeStorageMigration, completeStorageMigration, acquireStorageWriter, recordCompletedStorageMove } = await import('../../../src/services/storageMigration')
  if (move.transaction?.phase === 'completed') {
    await recordCompletedStorageMove(binding, move.transaction.id)
    return await admit()
  }
  if (launch.locationFile) {
    const activeRoot = readStorageLocation(launch.locationFile)
    if (activeRoot && activeRoot !== move.request.source && activeRoot !== binding.root) throw new Error('Active EchoFlow storage location conflicts with this cold move')
  }
  const original = typeof createHooks === 'function' ? createHooks(binding) : createHooks
  let collecting = !move.transaction
  let assertSourceLock: (() => Promise<void>) | undefined
  const hooks: StorageMigrationHooks = { ...original, assertQuiescent: async roots => {
    await original.assertQuiescent(roots)
    await assertMigrationDirectory(binding.root, move.request.targetIdentity)
    await assertSourceLock?.()
    if (collecting) await move.assertOriginal()
  } }
  await hooks.assertQuiescent([move.request.source, binding.root])
  if (move.transaction?.phase !== 'accepted' && existsSync(move.request.source)) {
    await assertMigrationDirectory(move.request.source, move.request.sourceIdentity)
    assertSourceLock = await lockDesktopMoveSource(move.request.source)
  }
  let result = move.transaction
    ? await recoverStorageMigration(binding, hooks)
    : await executeStorageMigration({ binding, sources: [{ directory: move.request.source, markerRoot: move.request.source,
      ...(sourceControls ? { controls: sourceControls } : {}) }], hooks })
  collecting = false
  if (result.state === 'validation-required') {
    await validate(binding)
    result = await completeStorageMigration(binding, result.id!, hooks)
  }
  if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`)
  return await admit()
}

/** The same transaction as CLI/server startup; this function must run before Chromium opens R. */
export async function initializeDesktopStorage(
  initial: DesktopStorageLaunch,
  createHooks: StorageMigrationHooks | ((binding: StorageBinding) => StorageMigrationHooks),
  validateRestrictedStartup: (binding: StorageBinding) => Promise<void>,
  options: { platform?: NodeJS.Platform; credentialStore?: MigrationCredentialStore } = {},
): Promise<{ binding: StorageBinding; release(): Promise<void> }> {
  if (initial.issues.length) throw new Error(initial.issues.join('; '))
  if (initial.adoption) {
    assertDesktopStorageControls(initial.binding, initial.controls)
    const hooks = typeof createHooks === 'function' ? createHooks(initial.binding) : createHooks
    const result = await executeDesktopStorageAdoption(initial.binding, initial.adoption, hooks, validateRestrictedStartup)
    if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`)
    const { acquireStorageWriter } = await import('../../../src/services/storageMigration')
    return { binding: initial.binding, ...await acquireStorageWriter(initial.binding) }
  }
  if (initial.move) return await initializeDesktopMove(initial, createHooks, validateRestrictedStartup)
  const { launch, plans, legacySelection } = await resolveDesktopStorageLaunch(initial, options)
  if (launch.locationFile && launch.discovery && !plans.length && !legacySelection) {
    const pending = await readPendingDesktopStorageHandoff(launch.binding.root)
    if (pending) {
      normalizedCustomDir({ getPath: name => name === 'exe' ? launch.discovery!.executable! : name === 'home' ? launch.discovery!.homeDir : pending.target }, pending.target)
      return await initializeDesktopMove({
        ...launch, binding: resolveStorageBinding({ env: {}, roots: [pending.target] }), move: pending.move,
      }, createHooks, validateRestrictedStartup)
    }
  }
  await assertNoPendingDesktopMove(launch.binding.root)
  const originalHooks = typeof createHooks === 'function' ? createHooks(launch.binding) : createHooks
  const assertSelection = async () => {
    for (const plan of plans) await assertMigrationDirectory(plan.selectedDirectory, plan.selectedIdentity)
  }
  await assertSelection()
  const hooks: StorageMigrationHooks = plans.length ? { ...originalHooks, assertQuiescent: async roots => {
    await originalHooks.assertQuiescent(roots)
    await assertSelection()
  } } : originalHooks
  const { readStorageMigrationStatus, recoverStorageMigration, prepareStorageMigration, executeStorageMigration, completeStorageMigration, acquireStorageWriter } = await import('../../../src/services/storageMigration')
  const admit = async () => ({ binding: launch.binding, ...await acquireStorageWriter(launch.binding) })
  if (!launch.sources.length && !plans.length) {
    const status = await readStorageMigrationStatus(launch.binding)
    // Ordinary startup shares R with other leased writers; only recovery needs exclusion.
    if (!status || status.state === 'ready') return await admit()
  }
  let result = await recoverStorageMigration(launch.binding, hooks)
  if (result.state === 'validation-required') {
    result = await completeStorageMigration(launch.binding, result.id!, hooks, validateRestrictedStartup)
  }
  if (result.state === 'ready') {
    for (const plan of plans) await cleanupLegacyDataMigrationRecovery(plan, roots => hooks.assertQuiescent(roots), { ...options, platform: options.platform ?? hooks.platform })
    const current = launch.discovery
      ? discoverDesktopStorageSources(launch.binding, launch.discovery, launch.recovery)
      : { sources: launch.sources.filter(source => existsSync(source.directory) && readdirSync(source.directory).some(name =>
        !source.layout || (source.layout === 'root-config' ? name === '.config.json' : source.layout === 'flat-indexes' ? flatIndexFile.test(name) : source.layout === 'desktop-state' ? legacyDesktopStateNames.includes(name as typeof legacyDesktopStateNames[number]) : !!source.controls?.[name as typeof legacyControlNames[number]]))), issues: [] }
    if (current.issues.length) throw new Error(current.issues.join('; '))
    if (current.sources.length) {
      await prepareStorageMigration({ binding: launch.binding, sources: current.sources })
      result = await executeStorageMigration({ binding: launch.binding, sources: current.sources, hooks, legacySelection })
    }
  }
  if (result.state === 'validation-required') {
    result = await completeStorageMigration(launch.binding, result.id!, hooks, validateRestrictedStartup)
  }
  if (result.state !== 'ready') throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`)
  return await admit()
}

export function desktopStorageRelaunchArgs(argv: readonly string[], launch: Pick<DesktopStorageLaunch, 'move' | 'adoption'>): string[] {
  const consumed = launch.move ? ['user-data-dir', 'echoflow-move-source', 'echoflow-move-request', 'echoflow-move-proof'] :
    launch.adoption ? desktopStorageAdoptionSwitches(launch.adoption) : []
  const args: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === '--') return [...args, ...argv.slice(index)]
    if (arg.startsWith('--') && consumed.includes(arg.slice(2).split('=', 1)[0]!)) {
      if (!arg.includes('=') && argv[index + 1] && !argv[index + 1]!.startsWith('-')) index++
      continue
    }
    args.push(arg)
  }
  return args
}
