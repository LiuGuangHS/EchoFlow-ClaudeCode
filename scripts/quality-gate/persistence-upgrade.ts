#!/usr/bin/env bun

type Check = {
  title: string
  command: string[]
  cwd?: string
}

const rootDir = process.cwd()
const checks: Check[] = [
  {
    title: 'Single-root transactions, startup ownership and consumer boundaries',
    command: ['bun', '--no-env-file', 'test', './src/services/storageMigration.test.ts', './src/services/storageMigration.configAdoption.test.ts', './src/services/storageMigration.sqliteCohorts.test.ts', './src/services/storageMigration.inPlace.test.ts', './src/services/storageMigration.legacyNamespaces.test.ts', './src/services/storageMigration.selective.test.ts', './src/services/storageMigration.externalSources.test.ts', './src/services/storageMigration.handoff.test.ts', './src/services/storageStartup.migration.test.ts', './src/services/storageStartup.overrides.test.ts', './src/services/storageStartup.externalSources.test.ts', './src/utils/fsOperations.storage.test.ts', './src/server/__tests__/storage-library-startup.test.ts', './src/server/migrationInventory.test.ts', './src/server/migrationInventoryWindows.test.ts', './src/utils/echoFlowConfigRoot.test.ts', './src/utils/storageRootConvergence.test.ts', './src/utils/managedStoragePath.test.ts', './src/services/storageStartup.test.ts', './src/server/services/storageConsumers.test.ts', './adapters/common/storageConsumers.test.ts', './scripts/quality-gate/sandbox.test.ts'],
  },
  {
    title: 'Exact IM config and complete WhatsApp sign-in adoption',
    command: ['bun', '--no-env-file', 'test', './src/services/storageAdoption.test.ts', './adapters/whatsapp/storageAdoption.test.ts', './src/services/storageMigration.whatsapp.test.ts'],
  },
  {
    title: 'Private product scratch containment and cleanup',
    command: ['bun', '--no-env-file', 'test', './src/bridge/sessionRunner.storage.test.ts', './src/commands/copy/copy.storage.test.ts', './src/screens/REPL.storage.test.ts', './src/utils/computerUse/replRuntime.storage.test.ts', './src/utils/computerUse/cuHelperInstall.storage.test.ts', './src/utils/privateStorageTempDirectory.test.ts', './src/utils/tempfile.storage.test.ts', './src/utils/ide.storage.test.ts', './src/utils/__tests__/cachePaths.test.ts', './src/utils/plugins/zipCache.storage.test.ts', './src/utils/screenshotClipboard.storage.test.ts', './src/server/__tests__/market-install.test.ts', './src/server/services/macAppIcon.storage.test.ts', './src/server/services/openTargetService.storage.test.ts', './src/server/services/sessionHistoryScratch.test.ts', './src/server/services/reviewService.test.ts'],
  },
  {
    title: 'Shell scratch permissions, provider paths and clipboard cleanup',
    command: ['bun', '--no-env-file', 'test', './src/utils/shellStorage.test.ts', './src/utils/imagePaste.storage.test.ts', './src/utils/shell/bashProvider.test.ts', './src/utils/shell/powershellProvider.test.ts', './src/utils/permissions/filesystem.test.ts', './src/utils/task/diskOutput.test.ts', './src/server/__tests__/background-task-output-route.test.ts'],
  },
  {
    title: 'Auto-memory keeps the selected physical root and existing prompt contract',
    command: ['bun', '--no-env-file', 'test', './src/memdir/paths.storage.test.ts', './src/memdir/memdir.test.ts', './src/services/autoDream/consolidationLock.test.ts'],
  },
  {
    title: 'Team archives import through the storage transaction without resurrection',
    command: ['bun', '--no-env-file', 'test', './src/server/__tests__/teams.test.ts', '--test-name-pattern', 'imports legacy archives through the transaction'],
  },
  {
    title: 'Cold desktop storage admission and merged sidecar ownership',
    command: ['bun', 'run', 'test', '--run', 'electron/services/desktopStorageStartup.test.ts', 'electron/services/desktopStorageColdRecovery.test.ts', 'electron/services/desktopStorageAdoption.test.ts', 'electron/services/desktopStorageProvenance.test.ts', 'electron/services/appMode.test.ts', 'electron/services/appModeLifecycle.test.ts', 'electron/storageBootstrap.test.ts', 'electron/services/desktopStorageValidation.test.ts', 'electron/storageValidation.test.ts', 'electron/main.security.test.ts', 'sidecars/storageStartup.test.ts'],
    cwd: 'desktop',
  },
  {
    title: 'Legacy desktop transaction journal recovery',
    command: ['bun', 'run', 'test', '--', '--run', 'electron/services/dataMigrationLegacyRecovery.test.ts'],
    cwd: 'desktop',
  },
  {
    title: 'Installer storage bridge uses the shared durable transaction before uninstall',
    command: ['bun', '--no-env-file', 'test', './desktop/sidecars/installerStorageRecovery.test.ts', './scripts/pr/windows-installer-process-check.test.ts', './scripts/pr/windows-installer-recovery.test.ts'],
  },
  {
    title: 'Project auxiliary directories and legacy session snapshots',
    command: ['bun', 'test', './src/server/services/sessionService.additionalDirectories.test.ts'],
  },
  {
    title: 'Idle power preferences migrate disabled and preserve the last action record',
    command: ['bun', 'run', 'test', '--', '--run', 'electron/services/idlePowerPersistence.test.ts'],
    cwd: 'desktop',
  },
  {
    title: 'Session archive metadata migration and transcript-preserving restart recovery',
    command: ['bun', 'test', './src/server/__tests__/session-archive.test.ts', './src/utils/cleanup.sessionArchive.test.ts', './src/utils/sessionArchiveStore.test.ts', './src/server/services/sessionService.runtimeSelection.test.ts', './src/server/services/sessionService.archivePagination.test.ts', './src/server/services/localIndex/sessionIndex.archivePagination.test.ts', './src/server/services/localIndex/transcriptReducer.test.ts', './src/server/services/localIndex/sessionProjector.test.ts', './src/server/services/sessionMetadataReader.test.ts'],
  },
  {
    title: 'Issue router shared SQLite schema migration and consistent backup recovery',
    command: ['bun', '--no-env-file', 'test', './scripts/issue-router/persistence.test.ts'],
  },
  {
    title: 'Desktop scheduled tasks preserve legacy definitions and replay scheduled provenance',
    command: ['bun', 'test', './src/server/services/scheduledTaskRuntime.test.ts', './src/server/services/sessionService.scheduledTask.test.ts'],
  },
  {
    title: 'Desktop WebSearch settings migrate old fixtures for the DeepSeek backend',
    command: ['bun', 'run', 'test', '--', '--run', 'src/stores/settingsStoreWebSearch.test.ts'],
    cwd: 'desktop',
  },
  {
    title: 'Desktop terminal font settings upgrade shell-only fixtures without rewriting user settings',
    command: ['bun', 'run', 'test', '--', '--run', 'src/stores/settingsStore.test.ts', '-t', 'desktop terminal'],
    cwd: 'desktop',
  },
  {
    title: 'WebSearch legacy settings remain compatible with the DeepSeek backend',
    command: ['bun', 'test', './src/tools/WebSearchTool/deepseekSearch.test.ts'],
  },
  {
    title: 'Data directory relocation metadata and legacy attachment aliases',
    command: ['bun', 'test', './src/utils/storageMigrationMetadata.test.ts', './src/utils/storageRelocations.test.ts', './src/server/__tests__/storage-attachment-migration.test.ts', './src/server/__tests__/storage-public-access-restart.test.ts', './src/server/__tests__/conversation-attachments.test.ts'],
  },
  {
    title: 'Desktop data migration journal recovery and credential namespace copy',
    command: ['bun', 'run', 'test', '--', '--run', 'electron/services/dataMigration.test.ts', 'electron/services/migrationCredentials.test.ts'],
    cwd: 'desktop',
  },
  {
    title: 'Agent Teams plan sidecar compatibility and approval recovery',
    command: ['bun', 'test', './src/utils/swarm/teamPlanStore.test.ts', './src/server/services/teamPlanService.test.ts'],
  },
  {
    title: 'Agent Teams legacy mailbox migration to unread inbox plus history',
    command: ['bun', 'test', './src/utils/teammateMailbox.test.ts', '--test-name-pattern', 'legacy inbox files'],
  },
  {
    title: 'Agent Teams members recorded before deferred instructions rehydrate as already instructed',
    command: ['bun', 'test', './src/server/services/teamPlanRuntime.supervisor.test.ts', '--test-name-pattern', 'written before deferred instructions'],
  },
  {
    title: 'Agent Teams teammate resume from agent metadata written before the teammate fields',
    command: ['bun', 'test', './src/utils/swarm/inProcessRunner.resume.test.ts', '--test-name-pattern', 'metadata written before'],
  },
  {
    title: 'SubAgent runs from agent metadata written before launch effort was recorded report no effort',
    command: ['bun', 'test', './src/server/services/subagentRunService.test.ts', '--test-name-pattern', 'metadata written before effort was recorded'],
  },
  {
    title: 'Session collaboration state migration and recovery',
    command: ['bun', 'test', './src/server/services/sessionCollaborationService.test.ts', './src/server/services/sessionCollaborationService.delegation.test.ts', '--test-name-pattern', 'migrat|recover'],
  },
  {
    title: 'Connector installation state migrations',
    command: ['bun', 'test', './src/server/services/connectorsPersistence.test.ts'],
  },
  {
    title: 'Mobile push registration encryption and schema migration',
    command: ['bun', 'test', './src/server/services/mobilePushService.test.ts', '--test-name-pattern', 'migration|extensions|encrypted'],
  },
  {
    title: 'Public browser device store migration',
    command: ['bun', 'test', './src/server/publicAccess.test.ts', '--test-name-pattern', 'old store migration'],
  },
  {
    title: 'Private remote access settings migrate from legacy tunnels to Cloudflare',
    command: ['bun', 'run', 'test', '--', '--run', 'electron/services/publicAccess.test.ts', '-t', 'migrat'],
    cwd: 'desktop',
  },
  {
    title: 'Local index schema compatibility after protocol rollback and archive classification',
    command: [
      'bun', 'test', './src/server/services/localIndex/database.test.ts',
      '--test-name-pattern', 'frozen v[45789]',
    ],
  },
  {
    title: 'Trace projection resource-window schema migrations',
    command: ['bun', 'test', './src/server/services/localIndex/traceIndex.test.ts'],
  },
  {
    title: 'SiHub account store migration and preservation',
    command: ['bun', '--no-env-file', 'test', './src/server/services/echoflowApiService.test.ts', '--test-name-pattern', 'account data|extension fields|corrupt account'],
  },
  {
    title: 'Server persistent JSON migrations',
    command: ['bun', 'test', './src/server/__tests__/persistence-upgrade.test.ts'],
  },
  {
    title: 'Desktop UI preference migrations',
    command: [
      'bun',
      'test',
      './src/server/__tests__/desktop-ui-preferences.test.ts',
      '--test-name-pattern',
      'normalizes old schema files',
    ],
  },
  {
    title: 'Voice input preferences saved before AI correction and the personal vocabulary file',
    command: [
      'bun',
      'test',
      './src/server/__tests__/desktop-ui-preferences.test.ts',
      './src/server/services/voice/vocabulary/store.test.ts',
      '--test-name-pattern',
      'voiceInput|voice vocabulary file',
    ],
  },
  {
    title: 'Desktop localStorage migrations and complete persistence consumers',
    command: [
      'bun', 'run', 'test', '--', '--run', '--maxWorkers=1', '--no-file-parallelism',
      'src/theme/systemAppearance.test.ts',
      'src/theme/bootstrapScript.test.ts',
      'src/stores/uiStore.test.ts',
      'src/stores/settingsStore.test.ts',
      'src/pages/settings/H5Settings.test.tsx',
      'src/pages/settings/GeneralSettingsTheme.test.tsx',
      'src/lib/persistenceMigrations.test.ts',
      'src/lib/legacyPreferenceMigration.test.ts',
      'src/i18n/locale.test.ts',
      'src/lib/workspace/persistence.test.ts',
      'src/lib/workspace/persistenceBridge.test.ts',
      'src/lib/persistenceHydration.test.tsx',
      'src/lib/chatAppearance.test.ts',
      'src/lib/appZoom.test.ts',
      'src/stores/openTargetStore.test.ts',
      'src/__tests__/generalSettings.test.tsx',
      'src/pages/TerminalSettings.test.tsx',
    ],
    cwd: 'desktop',
  },
]

async function runCheck(check: Check): Promise<number> {
  const cwd = check.cwd ? `${rootDir}/${check.cwd}` : rootDir
  console.log(`\n[persistence-upgrade] ${check.title}`)
  console.log(`$ ${check.command.join(' ')}`)
  const proc = Bun.spawn(check.command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return proc.exited
}

let failures = 0
for (const check of checks) {
  const code = await runCheck(check)
  if (code !== 0) {
    failures += 1
  }
}

if (failures > 0) {
  console.error(`\n[persistence-upgrade] failed checks: ${failures}`)
  process.exit(1)
}

console.log('\n[persistence-upgrade] all checks passed')
