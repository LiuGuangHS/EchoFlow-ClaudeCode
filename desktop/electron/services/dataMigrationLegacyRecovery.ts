import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MigrationStatus } from '../../src/lib/desktopHost/types'
import type { AppModeAppLike } from './appMode'
import { buildEchoFlowOwnershipMarker, resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { macOsKeychainRootSuffix } from '../../../src/utils/secureStorage/macOsKeychainRootSuffix'
import { assertMigrationDirectory, assertMigrationManifest, assertUnlinkedDirectoryPath, canonicalPath, isWithin, migrationDirectoryIdentity, validateMigrationManifest, type MigrationDirectoryIdentity, type VerifiedMigrationFile } from './dataMigrationFiles'
import { removeMigrationCredentials, systemMigrationCredentialStore, verifyMigrationCredentials, type MigrationCredentialReceipt, type MigrationCredentialStore } from './migrationCredentials'

export const MIGRATION_JOURNAL_FILE = 'data-migration-v1.json'
type Journal = {
  version: 1
  status: MigrationStatus
  oldMode: string | null
  stagingDir: string
  manifest: VerifiedMigrationFile[]
  createdCredentials: MigrationCredentialReceipt[]
  credentials: MigrationCredentialReceipt[]
  directories?: { source: MigrationDirectoryIdentity; target: MigrationDirectoryIdentity }
  stagingIdentity?: MigrationDirectoryIdentity
}

const stages = ['preparing', 'quiescing', 'copying', 'verifying', 'committing', 'restarting', 'completed', 'failed', 'cancelled']
const absoluteDirectory = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value) && path.resolve(value) === value
const directoryIdentity = (value: unknown): value is MigrationDirectoryIdentity => {
  if (!value || typeof value !== 'object') return false
  const identity = value as MigrationDirectoryIdentity
  return absoluteDirectory(identity.canonical) && typeof identity.dev === 'string' && /^\d+$/.test(identity.dev) && typeof identity.ino === 'string' && /^\d+$/.test(identity.ino)
}

function parseJournal(value: unknown): Journal {
  if (!value || typeof value !== 'object') throw new Error('Unsupported migration recovery record')
  const parsed = value as Journal
  if (parsed.version !== 1 || !parsed.status || typeof parsed.status.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(parsed.status.id) ||
    !stages.includes(parsed.status.stage) || !absoluteDirectory(parsed.status.sourceDir) || !absoluteDirectory(parsed.status.targetDir) ||
    !absoluteDirectory(parsed.stagingDir) || parsed.stagingDir !== path.join(parsed.status.targetDir, `.cc-haha-migration-${parsed.status.id}`) ||
    !Array.isArray(parsed.createdCredentials) || !Array.isArray(parsed.credentials) || (parsed.oldMode !== null && typeof parsed.oldMode !== 'string') ||
    (parsed.directories !== undefined && (!directoryIdentity(parsed.directories?.source) || !directoryIdentity(parsed.directories?.target))) ||
    (parsed.stagingIdentity !== undefined && !directoryIdentity(parsed.stagingIdentity))) throw new Error('Unsupported migration recovery record')
  assertMigrationManifest(parsed.manifest)
  if (isWithin(parsed.status.sourceDir, parsed.status.targetDir) || isWithin(parsed.status.targetDir, parsed.status.sourceDir)) throw new Error('Migration recovery directories overlap')
  if (parsed.directories && (isWithin(parsed.directories.source.canonical, parsed.directories.target.canonical) || isWithin(parsed.directories.target.canonical, parsed.directories.source.canonical))) throw new Error('Migration recovery directories overlap')
  const targetHash = macOsKeychainRootSuffix(parsed.status.targetDir)
  for (const receipts of [parsed.credentials, parsed.createdCredentials]) {
    const services = new Set<string>()
    for (const receipt of receipts) {
      if (!receipt || typeof receipt.service !== 'string' || !new RegExp(`^Claude Code(?:-(?:custom|staging|local)-oauth)?(?:-credentials)?${targetHash}$`).test(receipt.service) ||
        typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest) || services.has(receipt.service)) throw new Error('Invalid migration credential receipt')
      services.add(receipt.service)
    }
  }
  if (parsed.oldMode !== null) {
    const mode: unknown = JSON.parse(parsed.oldMode)
    // Restore the user-owned snapshot byte for byte, including old defaults
    // and unknown fields. AppMode remains the authority for its known fields.
    if (!mode || typeof mode !== 'object' || Array.isArray(mode)) throw new Error('Invalid previous migration mode')
  }
  return parsed
}

function assertUnambiguousLegacyCredentials(journal: Journal, receipts: MigrationCredentialReceipt[]): void {
  const { sourceDir, targetDir } = journal.status
  // V1 forbids in-place moves and does not record whether the source used an unhashed service.
  if (receipts.length && macOsKeychainRootSuffix(sourceDir) === macOsKeychainRootSuffix(targetDir)) {
    throw new Error('Legacy migration directories share the same macOS Keychain namespace; manual recovery is required')
  }
}

import type { DataMigrationHooks } from './dataMigration'

async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// Staging receives the source's permissions before publication, so a rollback
// can meet read-only directories. POSIX unlink needs write access to the
// parent; open those directories up without following any link.
async function makeDirectoryTreeRemovable(directory: string): Promise<void> {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory()) return
  if ((stat.mode & 0o700) !== 0o700) await fs.chmod(directory, stat.mode | 0o700)
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeDirectoryTreeRemovable(path.join(directory, entry.name))
  }
}

async function atomicWrite(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await fs.open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(value)
    await handle.sync()
  } finally { await handle.close() }
  try { await fs.rename(temporary, file) } finally { await fs.rm(temporary, { force: true }) }
}

export type LegacyDataMigrationReceipt = {
  journalPath: string
  /** Preserve these original bytes in the shared transaction's history. */
  rawJournal: string
  journal: Journal
  journalIdentity: { dev: string; ino: string }
}
export type LegacyDataMigrationRecoveryPlan = LegacyDataMigrationReceipt & {
  /** Null means only a protected, ownership-scoped import is safe. */
  requiredRoot: string | null
  selectedDirectory: string
  selectedIdentity: MigrationDirectoryIdentity
  protectedSources: string[]
}

async function productOwnedRoot(directory: string, shared: string): Promise<boolean> {
  const real = await canonicalPath(directory)
  const file = path.join(directory, 'app.json')
  if (!await exists(file)) return false
  await assertUnlinkedDirectoryPath(directory)
  if (!(await fs.lstat(file)).isFile()) throw new Error('Invalid legacy product ownership marker')
  const marker = JSON.parse(await fs.readFile(file, 'utf8'))
  const expected = buildEchoFlowOwnershipMarker()
  if (!marker || marker.owner !== expected.owner || marker.appId !== expected.appId || marker.schemaVersion !== expected.schemaVersion) throw new Error('Invalid or future legacy product ownership marker')
  return !isWithin(real, shared) && !isWithin(shared, real)
}

/** Parse selection hints without interpreting the obsolete target manifest. */
export async function readLegacyDataMigrationReceipt(profileDir: string): Promise<LegacyDataMigrationReceipt | null> {
  const journalPath = path.join(profileDir, MIGRATION_JOURNAL_FILE)
  if (!await exists(journalPath)) return null
  await assertUnlinkedDirectoryPath(profileDir)
  const before = await fs.lstat(journalPath, { bigint: true })
  if (!before.isFile() || before.nlink !== 1n) throw new Error('Invalid migration recovery record file')
  const rawJournal = await fs.readFile(journalPath, 'utf8')
  const journal = parseJournal(JSON.parse(rawJournal))
  const after = await fs.lstat(journalPath, { bigint: true })
  if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size) throw new Error('Migration recovery record changed during inspection')
  return { journalPath, rawJournal, journal, journalIdentity: { dev: String(before.dev), ino: String(before.ino) } }
}

/** Read-only cold discovery. A v1 receipt is evidence, never authority to claim a shared root. */
export async function inspectLegacyDataMigrationRecovery(
  profileDir: string,
  options: { homeDir: string; platform?: NodeJS.Platform; credentialStore?: MigrationCredentialStore },
): Promise<LegacyDataMigrationRecoveryPlan | null> {
  const receipt = await readLegacyDataMigrationReceipt(profileDir)
  if (!receipt) return null
  const { journal } = receipt
  const { sourceDir, targetDir, stage } = journal.status
  const sourceReal = await canonicalPath(sourceDir)
  const targetReal = await canonicalPath(targetDir)
  if (isWithin(sourceReal, targetReal) || isWithin(targetReal, sourceReal)) throw new Error('Migration recovery directories overlap')
  const forward = stage === 'restarting' || stage === 'completed'
  const usesKeychain = (options.platform ?? process.platform) === 'darwin'
  if (usesKeychain && stage !== 'completed') assertUnambiguousLegacyCredentials(journal, forward ? journal.credentials : journal.createdCredentials)
  const selectedDirectory = forward ? targetDir : sourceDir
  const identity = forward ? journal.directories?.target : journal.directories?.source
  if (identity) await assertMigrationDirectory(selectedDirectory, identity)
  else await assertUnlinkedDirectoryPath(selectedDirectory)
  const selectedIdentity = await migrationDirectoryIdentity(selectedDirectory)
  const other = forward ? sourceDir : targetDir
  if (journal.directories && await exists(other)) await assertMigrationDirectory(other, forward ? journal.directories.source : journal.directories.target)
  if (stage === 'restarting') {
    await validateMigrationManifest(targetDir, journal.manifest)
    if (usesKeychain) await verifyMigrationCredentials(journal.credentials, options.credentialStore ?? systemMigrationCredentialStore())
    if (identity) await assertMigrationDirectory(targetDir, identity)
    else await assertUnlinkedDirectoryPath(targetDir)
  }
  const shared = await canonicalPath(path.join(options.homeDir, '.claude'))
  const protectedSources: string[] = []
  for (const directory of [sourceDir, targetDir]) {
    if (!await productOwnedRoot(directory, shared)) protectedSources.push(directory)
  }
  await assertMigrationDirectory(selectedDirectory, selectedIdentity)
  return { ...receipt, selectedDirectory, selectedIdentity, requiredRoot: protectedSources.includes(selectedDirectory) ? null : selectedDirectory, protectedSources }
}

async function removeLegacyStaging(journal: Journal): Promise<void> {
  const expected = path.join(journal.status.targetDir, `.cc-haha-migration-${journal.status.id}`)
  if (journal.stagingDir !== expected || path.dirname(expected) !== journal.status.targetDir || expected === journal.status.targetDir) throw new Error('Invalid migration staging path')
  const stat = await fs.lstat(expected).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!stat) return
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Migration staging directory was replaced')
  if (journal.directories) await assertMigrationDirectory(journal.status.targetDir, journal.directories.target)
  else await assertUnlinkedDirectoryPath(journal.status.targetDir)
  const targetReal = await fs.realpath(journal.status.targetDir)
  const stageReal = await fs.realpath(expected)
  if (path.relative(targetReal, path.dirname(stageReal)) !== '' || path.basename(stageReal) !== path.basename(expected)) throw new Error('Invalid migration staging path')
  if (journal.stagingIdentity) await assertMigrationDirectory(expected, journal.stagingIdentity)
  await makeDirectoryTreeRemovable(expected)
  await fs.rm(expected, { recursive: true, force: true })
}

/** Only receipt-scoped rollback resources; no pointer restoration or v1 journal writes. */
export async function cleanupLegacyDataMigrationRecovery(
  plan: LegacyDataMigrationRecoveryPlan,
  assertQuiescent: (roots: readonly string[]) => Promise<void>,
  options: { platform?: NodeJS.Platform; credentialStore?: MigrationCredentialStore } = {},
): Promise<void> {
  const { stage, sourceDir, targetDir } = plan.journal.status
  if (['restarting', 'completed'].includes(stage)) return
  await assertQuiescent([path.dirname(plan.journalPath), sourceDir, targetDir])
  const current = await readLegacyDataMigrationReceipt(path.dirname(plan.journalPath))
  if (!current || current.rawJournal !== plan.rawJournal || current.journalIdentity.dev !== plan.journalIdentity.dev || current.journalIdentity.ino !== plan.journalIdentity.ino) throw new Error('Migration recovery record changed after inspection')
  if (plan.journal.directories) await assertMigrationDirectory(sourceDir, plan.journal.directories.source)
  else await assertUnlinkedDirectoryPath(sourceDir)
  const usesKeychain = (options.platform ?? process.platform) === 'darwin'
  if (usesKeychain) assertUnambiguousLegacyCredentials(current.journal, current.journal.createdCredentials)
  await removeLegacyStaging(plan.journal)
  if (usesKeychain) await removeMigrationCredentials(current.journal.createdCredentials, options.credentialStore ?? systemMigrationCredentialStore())
}

/** Compatibility for receipts written by released v1 builds. No new migration can start here. */
export class LegacyDataMigrationRecovery {
  private journal: Journal | null = null
  private validationReceipt: string | null = null
  private readonly journalPath: string
  private readonly modePath: string
  constructor(private readonly app: AppModeAppLike, private readonly hooks: DataMigrationHooks, private readonly env: NodeJS.ProcessEnv) {
    this.journalPath = path.join(app.getPath('userData'), MIGRATION_JOURNAL_FILE)
    this.modePath = path.join(app.getPath('userData'), 'app-mode.json')
  }
  get status(): MigrationStatus | null { return this.journal?.status ?? null }
  private async save(): Promise<void> {
    await atomicWrite(this.journalPath, JSON.stringify(this.journal))
  }

  private async stage(stage: MigrationStatus['stage']): Promise<void> {
    this.journal!.status.stage = stage
    this.journal!.status.cancellable = !['committing', 'restarting', 'completed', 'failed', 'cancelled'].includes(stage)
    await this.save()
    this.hooks.progress({ ...this.journal!.status })
  }

  private credentialStore(): MigrationCredentialStore {
    return this.hooks.credentialStore ?? systemMigrationCredentialStore()
  }

  private async restoreMode(): Promise<void> {
    try {
      if (this.journal!.directories) await assertMigrationDirectory(this.journal!.status.sourceDir, this.journal!.directories.source)
      else if (!(await fs.stat(this.journal!.status.sourceDir)).isDirectory()) throw new Error('Original path is not a directory')
    } catch (error) {
      throw new Error('Original data directory is unavailable; restore it before retrying migration recovery', { cause: error })
    }
    if (this.journal!.oldMode === null) await fs.rm(this.modePath, { force: true })
    else await atomicWrite(this.modePath, this.journal!.oldMode)
  }

  private async removeStaging(): Promise<void> {
    await removeLegacyStaging(this.journal!)
  }

  async recover(): Promise<'validate' | 'normal' | 'restart'> {
    this.validationReceipt = null
    const plan = await inspectLegacyDataMigrationRecovery(this.app.getPath('userData'), {
      homeDir: this.app.getPath('home'), platform: this.hooks.platform, credentialStore: this.hooks.credentialStore,
    })
    if (!plan) return 'normal'
    const parsed = this.journal = plan.journal
    if (parsed.status.stage === 'restarting' || parsed.status.stage === 'completed') {
      if (!plan.requiredRoot) throw new Error(`Legacy migration requires an ownership-scoped cold import of protected data: ${plan.selectedDirectory}`)
      const root = await canonicalPath(plan.requiredRoot)
      const active = await canonicalPath(resolveStorageBinding({ env: this.env, homeDir: this.app.getPath('home') }).root)
      if (active !== root || await canonicalPath(this.app.getPath('userData')) !== root) {
        await this.hooks.restart(plan.requiredRoot)
        return 'restart'
      }
      this.validationReceipt = parsed.status.stage === 'restarting' ? plan.rawJournal : null
      return this.validationReceipt ? 'validate' : 'normal'
    }
    if (!['failed', 'cancelled'].includes(parsed.status.stage)) {
      if (!this.hooks.assertQuiescent) throw new Error('Interrupted legacy recovery requires cold host quiescence confirmation')
      await this.hooks.assertQuiescent([this.app.getPath('userData'), parsed.status.sourceDir, parsed.status.targetDir])
      await this.restoreMode()
      await this.removeStaging()
      if ((this.hooks.platform ?? process.platform) === 'darwin') await removeMigrationCredentials(parsed.createdCredentials, this.credentialStore())
      this.journal.status.error = 'Migration was interrupted; original data directory restored'
      await this.stage('failed')
    }
    return 'normal'
  }

  async completeValidation(): Promise<void> {
    if (!this.validationReceipt) throw new Error('Legacy migration requires validation in its selected cold root')
    const plan = await inspectLegacyDataMigrationRecovery(this.app.getPath('userData'), {
      homeDir: this.app.getPath('home'), platform: this.hooks.platform, credentialStore: this.hooks.credentialStore,
    })
    if (!plan || plan.rawJournal !== this.validationReceipt) throw new Error('Legacy migration recovery record changed during validation')
    this.journal = plan.journal
    await this.stage('completed')
    this.validationReceipt = null
  }

  async failValidation(error: unknown): Promise<void> {
    this.validationReceipt = null
    if (this.journal?.status.stage === 'restarting' || this.journal?.status.stage === 'completed') throw error instanceof Error ? error : new Error(String(error))
    if (!this.hooks.assertQuiescent) throw new Error('Interrupted legacy recovery requires cold host quiescence confirmation')
    await this.hooks.assertQuiescent([this.app.getPath('userData'), this.journal!.status.sourceDir, this.journal!.status.targetDir])
    await this.restoreMode()
    this.journal!.status.error = error instanceof Error ? error.message : 'New directory startup failed'
    await this.stage('failed')
  }
}
