import { createHash } from 'node:crypto'

// This suffix identifies existing Keychain entries and migration receipts.
export function macOsKeychainRootSuffix(root: string): string {
  return `-${createHash('sha256').update(root.normalize('NFC')).digest('hex').slice(0, 8)}`
}
