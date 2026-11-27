// The desktop adapter and headless entrypoints use the same portable primitives.
export {
  assertMigrationDirectory, assertMigrationManifest, assertUnlinkedDirectoryPath,
  canonicalPath, copyMigrationFiles, hashFile, isWithin, migrationDirectoryIdentity,
  migrationManifest, restoreMigrationPermissions, scanMigrationFiles,
  skipMigrationEntry, validateMigrationManifest, verifyMigrationSource,
  type MigrationDirectoryIdentity, type MigrationFile, type VerifiedMigrationFile,
} from '../../../src/services/storageMigration'
