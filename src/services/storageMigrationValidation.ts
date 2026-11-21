import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assertUnlinkedDirectoryPath, type StorageMigrationHooks } from './storageMigration.js'
import { assertMigrationQuiescent } from '../server/migrationInventory.js'
import { upgradePersistentStorageValue } from '../server/services/persistentStorageMigrations.js'
import { createStorageMigrationCredentialHooks, systemMigrationCredentialStore } from './storageMigrationCredentials.js'
import { preflightWindowsMigrationPermissions, preserveWindowsMigrationPermissions, restrictWindowsMigrationStaging } from './storageMigrationPermissions.js'
import type { StorageBinding } from '../utils/echoFlowConfigRoot.js'

/** Never let a validator or consumer create SHM or checkpoint the frozen input. */
export async function validateStorageSQLite(database: string, consume?: (copy: string) => void): Promise<void> {
  await assertUnlinkedDirectoryPath(path.dirname(database))
  const temporary = await fs.mkdtemp(path.join(path.dirname(database), '.sqlite-validation-'))
  try {
    const copy = path.join(temporary, path.basename(database))
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const source = database + suffix
      let stat
      try { stat = await fs.lstat(source) } catch (error) {
        if (suffix && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('SQLite validation requires independent regular files')
      await fs.copyFile(source, copy + suffix)
    }
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const rows = db.prepare('PRAGMA integrity_check').all()
      if (rows.length !== 1 || Object.values(rows[0]!)[0] !== 'ok') throw new Error('SQLite snapshot failed integrity_check')
      db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema').all()
    } finally { db.close() }
    consume?.(copy)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

export function createStorageMigrationHooks(binding: StorageBinding): StorageMigrationHooks {
  return {
    assertQuiescent: roots => assertMigrationQuiescent(roots, [process.pid]),
    validateSQLite: validateStorageSQLite,
    upgradeJson: upgradePersistentStorageValue,
    permissions: { restrictStaging: restrictWindowsMigrationStaging, preflight: preflightWindowsMigrationPermissions, preserve: preserveWindowsMigrationPermissions },
    ...(process.platform === 'darwin' ? createStorageMigrationCredentialHooks(binding.root, systemMigrationCredentialStore()) : {}),
  }
}
