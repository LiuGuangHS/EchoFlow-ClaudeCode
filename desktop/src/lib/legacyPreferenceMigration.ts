export const CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION = 9
export const DESKTOP_PERSISTENCE_VERSION_KEY = 'cc-haha.persistence.schemaVersion'

type CopyStorage = Pick<Storage, 'getItem' | 'setItem'>

export class LegacyCopyBlockedError extends Error {}

/** Shared by startup and eager locale/sidebar imports, without importing their consumers. */
export function copyLegacyPreference(
  storage: CopyStorage,
  targetKey: string,
  readLegacy: (schemaVersion: number) => string | null,
): boolean {
  const version = Number(storage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY) ?? 0)
  if (version > CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION) return false
  const completionKey = `cc-haha.persistence.legacyCopied.${targetKey}`
  const completion = storage.getItem(completionKey)
  if (completion === '1') return false
  if (completion !== null && completion !== 'pending' && completion !== 'retry') {
    throw new LegacyCopyBlockedError(`Unsupported completion state for ${targetKey}`)
  }
  const mark = (value: string) => {
    try {
      storage.setItem(completionKey, value)
    } catch {
      throw new LegacyCopyBlockedError(`Completion unavailable for ${targetKey}`)
    }
  }
  const current = storage.getItem(targetKey)
  if (completion === 'pending' && current === null) {
    // A crash or failed completion write followed by a user clear is indistinguishable.
    throw new LegacyCopyBlockedError(`Uncertain legacy copy for ${targetKey}`)
  }
  // A confirmed failed copy remains eligible even if another startup advanced the schema.
  const legacy = current === null ? readLegacy(completion === 'retry' ? 0 : version) : null
  if (legacy === null) {
    mark('1')
    return false
  }
  mark('pending')
  try {
    storage.setItem(targetKey, legacy)
  } catch (error) {
    // Only a confirmed absent target is safe to retry; otherwise retain the intent.
    if (storage.getItem(targetKey) === null) mark('retry')
    throw error
  }
  mark('1')
  return true
}
