import fs from 'node:fs/promises'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { assertUnlinkedDirectoryPath } from './storageMigration.js'
import { validateStorageSQLite } from './storageMigrationValidation.js'
import type { StorageBinding } from '../utils/echoFlowConfigRoot.js'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations.js'
import { openLocalIndexDatabase } from '../server/services/localIndex/database.js'
import { openTraceIndexDatabase } from '../server/services/localIndex/traceDatabase.js'
import { openSearchContentDatabase } from '../server/services/localIndex/searchContentDatabase.js'
import { migrateScheduledRunIndexDatabase } from '../server/services/localIndex/scheduledRunMigrations.js'

/** Headless startup cannot prove Chromium data is consumable without its native owner. */
export async function validateRestrictedHeadlessStorage(binding: StorageBinding): Promise<void> {
  await assertUnlinkedDirectoryPath(binding.root)
  for (const name of ['Local State', 'Preferences', 'Local Storage', 'IndexedDB', 'Session Storage', 'WebStorage', 'Partitions', 'Cookies', 'Network', 'Login Data']) {
    try {
      await fs.lstat(path.join(binding.root, name))
      throw new Error('Chromium profile data requires restricted native desktop validation before headless startup')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (const relative of [path.join('echoflow-code', 'providers.json'), path.join('echoflow-code', 'settings.json'), 'scheduled_tasks.json']) {
    const file = path.join(binding.root, relative)
    try {
      await assertUnlinkedDirectoryPath(path.dirname(file))
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid managed JSON snapshot')
      const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (JSON.stringify(upgradePersistentStorageValue(relative, value)) !== JSON.stringify(value)) throw new Error('Published managed JSON was not upgraded by its schema owner')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const consumers = {
    'index-v1.sqlite': (file: string) => openLocalIndexDatabase({ path: file }).close(),
    'trace-index-v1.sqlite': (file: string) => openTraceIndexDatabase({ path: file }).close(),
    'search-index-v1.sqlite': (file: string) => openSearchContentDatabase({ path: file }).close(),
    'scheduled-runs-v1.sqlite': (file: string) => {
      const database = new Database(file)
      try { migrateScheduledRunIndexDatabase(database) } finally { database.close() }
    },
  }
  for (const [name, consume] of Object.entries(consumers)) {
    const file = path.join(binding.internalDir, 'db', name)
    try { await fs.lstat(file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await validateStorageSQLite(file, consume)
  }
}
