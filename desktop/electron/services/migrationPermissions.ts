// Desktop compatibility exports; headless and native startup share one permission owner.
export {
  createWindowsMigrationPermissionsRunner,
  preflightWindowsMigrationPermissions,
  preserveWindowsMigrationPermissions,
  restrictWindowsMigrationStaging,
  type MigrationPermissionEntry,
  type MigrationPermissionsRunner,
} from '../../../src/services/storageMigrationPermissions'
