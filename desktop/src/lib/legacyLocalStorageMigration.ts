type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type LegacyLocalStorageMigrationReport = {
  copiedKeys: string[]
  skippedKeys: string[]
  missingKeys: string[]
  failedKeys: string[]
}

type MigrationRule = {
  legacyKeys: string[]
  targetKey: string
}

export const LEGACY_LOCAL_STORAGE_TARGET_KEYS = {
  openTabs: 'echoflow-code-open-tabs',
  sessionRuntime: 'echoflow-code-session-runtime',
  theme: 'echoflow-code-theme',
  locale: 'echoflow-code-locale',
  appZoom: 'echoflow-code-app-zoom',
  dismissedUpdateVersion: 'echoflow-code-dismissed-update-version',
} as const

const RULES: MigrationRule[] = [
  { legacyKeys: ['echoflow-code-open-tabs'], targetKey: LEGACY_LOCAL_STORAGE_TARGET_KEYS.openTabs },
  { legacyKeys: ['echoflow-code-session-runtime'], targetKey: LEGACY_LOCAL_STORAGE_TARGET_KEYS.sessionRuntime },
  { legacyKeys: ['echoflow-code-theme'], targetKey: LEGACY_LOCAL_STORAGE_TARGET_KEYS.theme },
  { legacyKeys: ['echoflow-code-locale'], targetKey: LEGACY_LOCAL_STORAGE_TARGET_KEYS.locale },
  { legacyKeys: ['echoflow-code-app-zoom', 'echoflow-code-ui-zoom'], targetKey: LEGACY_LOCAL_STORAGE_TARGET_KEYS.appZoom },
  { legacyKeys: ['echoflow-code-dismissed-update-version'], targetKey: LEGACY_LOCAL_STORAGE_TARGET_KEYS.dismissedUpdateVersion },
]

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function runLegacyLocalStorageMigration(
  storage: StorageLike | null = defaultStorage(),
): LegacyLocalStorageMigrationReport {
  const report: LegacyLocalStorageMigrationReport = {
    copiedKeys: [],
    skippedKeys: [],
    missingKeys: [],
    failedKeys: [],
  }
  if (!storage) {
    report.failedKeys.push(...RULES.map((rule) => rule.targetKey))
    return report
  }

  for (const rule of RULES) {
    try {
      if (storage.getItem(rule.targetKey) !== null) {
        report.skippedKeys.push(rule.targetKey)
        continue
      }

      const sourceKey = rule.legacyKeys.find((legacyKey) => storage.getItem(legacyKey) !== null)
      if (!sourceKey) {
        report.missingKeys.push(rule.targetKey)
        continue
      }

      const value = storage.getItem(sourceKey)
      if (value === null) {
        report.missingKeys.push(rule.targetKey)
        continue
      }
      storage.setItem(rule.targetKey, value)
      report.copiedKeys.push(rule.targetKey)
    } catch {
      report.failedKeys.push(rule.targetKey)
    }
  }

  return report
}
