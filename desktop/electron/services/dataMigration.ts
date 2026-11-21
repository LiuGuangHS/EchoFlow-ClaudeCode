import { randomUUID } from 'node:crypto'
import type { MigrationPreview, MigrationStatus } from '../../src/lib/desktopHost/types'
import { resolveStorageBinding, type StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import {
  cancelColdStorageApproval, canonicalPath, completeStorageMigration,
  prepareStorageMigration, readStorageMigrationStatus, recoverStorageMigration, storageLocationFile,
  type StorageMigrationHooks,
} from '../../../src/services/storageMigration'
import { normalizedCustomDir, type AppModeAppLike } from './appMode'
import { hasExternalDesktopStorageControls } from './desktopStorageProvenance'
import { armDesktopMove, assertDesktopMovePreview, assertNoPendingDesktopMove, cancelDesktopMove, desktopMovePreview, type DesktopMoveLaunch, type DesktopMovePreview } from './desktopStorageMove'
import { approveOpenAiOauth, previewOpenAiOauth, type DesktopOpenAiOauthLaunch } from './desktopStorageAdoption'
import { LegacyDataMigrationRecovery } from './dataMigrationLegacyRecovery'
import { createStorageMigrationCredentialHooks, systemMigrationCredentialStore, type MigrationCredentialStore } from './migrationCredentials'
import { preflightWindowsMigrationPermissions, preserveWindowsMigrationPermissions, restrictWindowsMigrationStaging } from './migrationPermissions'

export { MIGRATION_JOURNAL_FILE } from './dataMigrationLegacyRecovery'
export type DataMigrationHooks = {
  preview(): Promise<{ activeTasks: number; externalProcesses: number }>
  quiesce(): Promise<void>
  resume(): Promise<void>
  /** Cold relaunch with this complete root in the launch controls. No old-root pointer is written. */
  restart(root?: string, request?: DesktopMoveLaunch): Promise<void> | void
  restartForOpenAiOauth?(root: string, request: DesktopOpenAiOauthLaunch): Promise<void> | void
  progress(status: MigrationStatus): void
  credentialStore?: MigrationCredentialStore
  permissions?: StorageMigrationHooks['permissions']
  platform?: NodeJS.Platform
  /** The host must prove Chromium and all other owners are stopped, not just the sidecar. */
  assertQuiescent?: StorageMigrationHooks['assertQuiescent']
  upgradeJson?: StorageMigrationHooks['upgradeJson']
  validateSQLite?: StorageMigrationHooks['validateSQLite']
  prepareResources?: StorageMigrationHooks['prepareResources']
  validateResources?: StorageMigrationHooks['validateResources']
  cleanupResources?: StorageMigrationHooks['cleanupResources']
}

/** Desktop protocol adapter. All new transactions, including recovery and cleanup,
 * belong to the same core used by headless startup. V1 is recovery-only. */
export class DataMigration {
  private previewState: { preview: MigrationPreview; cold: DesktopMovePreview | { binding: StorageBinding; oauth: Awaited<ReturnType<typeof previewOpenAiOauth>> } } | null = null
  private choosingOauth = false
  private operation: Promise<void> | null = null
  private abort: AbortController | null = null
  private currentStatus: MigrationStatus | null = null
  private target: StorageBinding | null = null
  private transactionId: string | null = null
  private readonly legacy: LegacyDataMigrationRecovery

  constructor(private readonly app: AppModeAppLike, private readonly hooks: DataMigrationHooks, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.legacy = new LegacyDataMigrationRecovery(app, hooks, env)
  }

  get sourceDir(): string { return resolveStorageBinding({ env: this.env, homeDir: this.app.getPath('home') }).root }
  get running(): boolean { return this.operation !== null }
  get status(): MigrationStatus | null { return this.currentStatus ?? this.legacy.status }
  wait(): Promise<void> { return this.operation ?? Promise.resolve() }

  private coreHooks(): StorageMigrationHooks {
    const resources = !this.hooks.prepareResources && (this.hooks.platform ?? process.platform) === 'darwin'
      ? createStorageMigrationCredentialHooks(this.target?.root ?? this.sourceDir, this.hooks.credentialStore ?? systemMigrationCredentialStore())
      : { prepareResources: this.hooks.prepareResources, validateResources: this.hooks.validateResources, cleanupResources: this.hooks.cleanupResources }
    return {
      assertQuiescent: async roots => {
        if (!this.hooks.assertQuiescent) throw new Error('Cold profile migration requires host quiescence confirmation')
        await this.hooks.assertQuiescent(roots)
      },
      signal: this.abort?.signal,
      platform: this.hooks.platform,
      permissions: this.hooks.permissions ?? { restrictStaging: restrictWindowsMigrationStaging, preflight: preflightWindowsMigrationPermissions, preserve: preserveWindowsMigrationPermissions },
      validateSQLite: this.hooks.validateSQLite,
      upgradeJson: this.hooks.upgradeJson,
      ...resources,
    }
  }

  async prepare(targetDir: string): Promise<MigrationPreview> {
    if (this.running || this.choosingOauth) throw new Error('Data migration is already running')
    this.previewState = null
    if (hasExternalDesktopStorageControls(this.env, this.sourceDir)) throw new Error('Storage paths are controlled by the launch environment')
    await assertNoPendingDesktopMove(this.sourceDir)
    const binding = {
      ...resolveStorageBinding({ env: {}, roots: [await canonicalPath(normalizedCustomDir(this.app, targetDir))] }),
      location: { file: storageLocationFile(this.app.getPath('home')), moveSource: this.sourceDir },
    }
    const plan = await prepareStorageMigration({ binding, sources: [{ directory: this.sourceDir, markerRoot: this.sourceDir }] })
    const runtime = await this.hooks.preview()
    if (runtime.externalProcesses) throw new Error('Another process is using this data directory; close it and retry')
    const preview = { id: randomUUID(), sourceDir: this.sourceDir, targetDir: binding.root, files: plan.files, bytes: plan.bytes, activeTasks: runtime.activeTasks }
    this.previewState = { preview, cold: await desktopMovePreview(plan) }
    return preview
  }

  async prepareOpenAiOauth(
    choose: () => Promise<string | null>,
    confirm: (preview: MigrationPreview) => Promise<boolean>,
  ): Promise<void> {
    if (this.running || this.choosingOauth) throw new Error('Data migration is already running')
    this.choosingOauth = true
    this.previewState = null
    try {
      const root = normalizedCustomDir(this.app, this.sourceDir)
      if (hasExternalDesktopStorageControls(this.env, root)) throw new Error('Storage paths are controlled by the launch environment')
      await assertNoPendingDesktopMove(root)
      const file = await choose()
      if (!file) return
      const binding = { ...resolveStorageBinding({ env: {}, roots: [root] }), location: { file: storageLocationFile(this.app.getPath('home')) } }
      const oauth = await previewOpenAiOauth(binding, file)
      const runtime = await this.hooks.preview()
      if (runtime.externalProcesses) throw new Error('Another process is using this data directory; close it and retry')
      const preview = { id: randomUUID(), sourceDir: file, targetDir: oauth.target, files: 1, bytes: oauth.identity.size, activeTasks: runtime.activeTasks }
      if (!await confirm(preview)) return
      if (this.running || root !== this.sourceDir) throw new Error('The active data directory changed while confirming')
      this.previewState = { preview, cold: { binding, oauth } }
      await this.start(preview.id)
    } finally {
      this.choosingOauth = false
    }
  }

  async start(id: string): Promise<void> {
    if (this.running || this.previewState?.preview.id !== id) throw new Error('Migration preview expired; choose the directory again')
    const { preview, cold } = this.previewState
    this.previewState = null
    this.abort = new AbortController()
    this.currentStatus = { ...preview, stage: 'quiescing', files: 0, totalFiles: preview.files, bytes: 0, totalBytes: preview.bytes, cancellable: true }
    this.operation = this.execute(cold).finally(() => { this.operation = null; this.abort = null })
    void this.operation.catch(() => {})
  }

  private notify(stage: MigrationStatus['stage'], error?: string): void {
    this.currentStatus = { ...this.currentStatus!, stage, cancellable: stage === 'quiescing', ...(error ? { error } : {}) }
    this.hooks.progress({ ...this.currentStatus })
  }

  private async execute(cold: NonNullable<DataMigration['previewState']>['cold']): Promise<void> {
    let quiesced = false
    let undoApproval: (() => Promise<void>) | undefined
    try {
      this.notify('quiescing')
      this.abort!.signal.throwIfAborted()
      if (hasExternalDesktopStorageControls(this.env, this.sourceDir)) throw new Error('Storage paths are controlled by the launch environment')
      if (!('oauth' in cold)) await assertDesktopMovePreview(cold)
      if ((await this.hooks.preview()).externalProcesses) throw new Error('Another process is using this data directory')
      this.abort!.signal.throwIfAborted()
      quiesced = true
      await this.hooks.quiesce()
      this.abort!.signal.throwIfAborted()
      // Chromium and the host lease remain live until the cold restart.
      if ('oauth' in cold) {
        if (!this.hooks.restartForOpenAiOauth) throw new Error('OpenAI sign-in migration requires a cold desktop restart')
        const request = await approveOpenAiOauth(cold.binding, cold.oauth)
        undoApproval = () => cancelColdStorageApproval(cold.binding, request.id)
        this.abort!.signal.throwIfAborted()
        this.notify('restarting')
        await this.hooks.restartForOpenAiOauth(cold.binding.root, request)
      } else {
        const request = await armDesktopMove(cold, this.currentStatus!.id, { desktop: true })
        undoApproval = () => cancelDesktopMove(request)
        this.abort!.signal.throwIfAborted()
        this.notify('restarting')
        await this.hooks.restart(cold.plan.binding.root, request)
      }
    } catch (error) {
      this.notify(this.abort?.signal.aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error))
      if (undoApproval) {
        try { await undoApproval() } catch (cancelError) {
          this.notify('failed', `Cold request could not be cancelled; keep services stopped: ${String(cancelError)}`)
          return
        }
      }
      if (quiesced) {
        try { await assertNoPendingDesktopMove('oauth' in cold ? cold.binding.root : cold.plan.sources[cold.sourceIndex]!.directory) } catch (pendingError) {
          this.notify('failed', `Cold request state is uncertain; keep services stopped: ${String(pendingError)}`)
          return
        }
        try { await this.hooks.resume() } catch (resumeError) { this.notify('failed', `Original services could not restart: ${String(resumeError)}`) }
      }
    }
  }

  cancel(id: string): void {
    if (this.status?.id !== id || !this.status.cancellable) throw new Error('Migration can no longer be cancelled')
    this.abort?.abort(new Error('Migration cancelled'))
  }
  cancelActive(): void { if (this.status?.cancellable) this.cancel(this.status.id) }

  async recover(): Promise<'validate' | 'normal' | 'restart'> {
    const binding = resolveStorageBinding({ env: this.env, homeDir: this.app.getPath('home') })
    // Do not create/claim a root just to search for an old receipt.
    const status = await readStorageMigrationStatus(binding)
    if (!status) return this.legacy.recover()
    this.target = binding
    this.transactionId = status.id ?? null
    this.currentStatus = { id: status.id!, sourceDir: status.sources[0] ?? binding.root, targetDir: binding.root,
      stage: 'verifying', files: status.files, totalFiles: status.files, bytes: status.bytes, totalBytes: status.bytes, cancellable: false }
    const result = await recoverStorageMigration(binding, this.coreHooks())
    if (result.state === 'validation-required') { this.notify('restarting'); return 'validate' }
    if (result.state !== 'ready') { this.notify('failed', result.issues.join('; ')); throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`) }
    this.notify('completed')
    return 'normal'
  }

  async completeValidation(): Promise<void> {
    if (!this.target || !this.transactionId) return this.legacy.completeValidation()
    const result = await completeStorageMigration(this.target, this.transactionId, this.coreHooks())
    if (result.state !== 'ready') { this.notify('failed', result.issues.join('; ')); throw new Error(result.issues.join('; ') || `Storage migration is ${result.state}`) }
    this.notify('completed')
  }

  async failValidation(error: unknown): Promise<void> {
    if (!this.target) return this.legacy.failValidation(error)
    this.notify('failed', error instanceof Error ? error.message : String(error))
    throw error instanceof Error ? error : new Error(String(error))
  }
}
