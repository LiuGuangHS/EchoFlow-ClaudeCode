import { THEME_MODES } from '../types/settings'
import {
  APP_ZOOM_STORAGE_KEY,
  isValidStoredAppZoomLevel,
} from './appZoom'

export const CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION = 1
export const DESKTOP_PERSISTENCE_VERSION_KEY = 'echoflow-code.persistence.schemaVersion'

type DesktopMigrationReport = {
  migratedKeys: string[]
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const TAB_STORAGE_KEY = 'echoflow-code-open-tabs'
const SESSION_RUNTIME_STORAGE_KEY = 'echoflow-code-session-runtime'
const THEME_STORAGE_KEY = 'echoflow-code-theme'
const LOCALE_STORAGE_KEY = 'echoflow-code-locale'
const EFFORT_LEVELS = ['low', 'medium', 'high', 'max']
const PERSISTED_SPECIAL_TAB_TYPES = ['settings', 'scheduled', 'market', 'traces'] as const
const PERSISTED_SPECIAL_TAB_IDS: Record<(typeof PERSISTED_SPECIAL_TAB_TYPES)[number], string> = {
  settings: '__settings__',
  scheduled: '__scheduled__',
  market: '__market__',
  traces: '__traces__',
}
const VALID_LOCALES = ['en', 'zh', 'zh-TW', 'jp', 'kr']

function readJson(storage: StorageLike, key: string): unknown {
  const raw = storage.getItem(key)
  if (!raw) return null
  return JSON.parse(raw)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPersistedSpecialTabType(value: unknown): value is (typeof PERSISTED_SPECIAL_TAB_TYPES)[number] {
  return typeof value === 'string' && (PERSISTED_SPECIAL_TAB_TYPES as readonly string[]).includes(value)
}

function getPersistedSpecialTabType(tab: Record<string, unknown>): (typeof PERSISTED_SPECIAL_TAB_TYPES)[number] | null {
  if (tab.sessionId === '__settings__') return 'settings'
  if (tab.sessionId === '__scheduled__') return 'scheduled'
  if (tab.sessionId === '__market__') return 'market'
  if (tab.sessionId === '__traces__') return 'traces'
  return isPersistedSpecialTabType(tab.type) ? tab.type : null
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value))
}

function migrateTabs(storage: StorageLike, report: DesktopMigrationReport): void {
  const raw = storage.getItem(TAB_STORAGE_KEY)
  if (!raw) return

  try {
    const parsed = readJson(storage, TAB_STORAGE_KEY)
    const rawTabs = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.openTabs)
        ? parsed.openTabs
        : []
    const openTabs = rawTabs
      .filter((tab): tab is Record<string, unknown> => isRecord(tab))
      .filter((tab) => typeof tab.sessionId === 'string' && typeof tab.title === 'string')
      .filter((tab) => tab.type !== 'terminal' && !String(tab.sessionId).startsWith('__terminal__'))
      .map((tab) => {
        const specialType = getPersistedSpecialTabType(tab)
        return {
          sessionId: specialType ? PERSISTED_SPECIAL_TAB_IDS[specialType] : tab.sessionId as string,
          title: tab.title as string,
          type: specialType ?? 'session',
        }
      })
    const activeTabId =
      isRecord(parsed) &&
      typeof parsed.activeTabId === 'string' &&
      openTabs.some((tab) => tab.sessionId === parsed.activeTabId)
        ? parsed.activeTabId
        : (openTabs[0]?.sessionId ?? null)

    if (openTabs.length === 0) {
      storage.removeItem(TAB_STORAGE_KEY)
    } else {
      writeJson(storage, TAB_STORAGE_KEY, { openTabs, activeTabId })
    }
  } catch {
    storage.removeItem(TAB_STORAGE_KEY)
  }
  report.migratedKeys.push(TAB_STORAGE_KEY)
}

function migrateSessionRuntime(storage: StorageLike, report: DesktopMigrationReport): void {
  const raw = storage.getItem(SESSION_RUNTIME_STORAGE_KEY)
  if (!raw) return

  try {
    const parsed = readJson(storage, SESSION_RUNTIME_STORAGE_KEY)
    if (!isRecord(parsed)) {
      storage.removeItem(SESSION_RUNTIME_STORAGE_KEY)
      report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
      return
    }

    const next = Object.fromEntries(
      Object.entries(parsed).filter(([, selection]) => (
        isRecord(selection) &&
        typeof selection.modelId === 'string' &&
        selection.modelId.trim().length > 0 &&
        (selection.providerId === null || typeof selection.providerId === 'string') &&
        (
          selection.effortLevel === undefined ||
          (
            typeof selection.effortLevel === 'string' &&
            EFFORT_LEVELS.includes(selection.effortLevel)
          )
        )
      )),
    )

    if (Object.keys(next).length === 0) {
      storage.removeItem(SESSION_RUNTIME_STORAGE_KEY)
    } else {
      writeJson(storage, SESSION_RUNTIME_STORAGE_KEY, next)
    }

    if (JSON.stringify(next) !== JSON.stringify(parsed)) {
      report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
    }
  } catch {
    storage.removeItem(SESSION_RUNTIME_STORAGE_KEY)
    report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
  }
}

function normalizeEnumKey(
  storage: StorageLike,
  key: string,
  allowedValues: string[],
  report: DesktopMigrationReport,
): void {
  const value = storage.getItem(key)
  if (value !== null && !allowedValues.includes(value)) {
    storage.removeItem(key)
    report.migratedKeys.push(key)
  }
}

function normalizeAppZoomKey(storage: StorageLike, report: DesktopMigrationReport): void {
  const value = storage.getItem(APP_ZOOM_STORAGE_KEY)
  if (!isValidStoredAppZoomLevel(value)) {
    storage.removeItem(APP_ZOOM_STORAGE_KEY)
    report.migratedKeys.push(APP_ZOOM_STORAGE_KEY)
  }
}

function runMigrationStep(
  report: DesktopMigrationReport,
  fallbackKey: string,
  step: () => void,
): void {
  try {
    step()
  } catch {
    report.migratedKeys.push(fallbackKey)
  }
}

function getDefaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function runDesktopPersistenceMigrations(storage: StorageLike | null = getDefaultStorage()): DesktopMigrationReport {
  const report: DesktopMigrationReport = { migratedKeys: [] }
  if (!storage) return report

  runMigrationStep(report, TAB_STORAGE_KEY, () => migrateTabs(storage, report))
  runMigrationStep(report, SESSION_RUNTIME_STORAGE_KEY, () => migrateSessionRuntime(storage, report))
  runMigrationStep(report, THEME_STORAGE_KEY, () => normalizeEnumKey(storage, THEME_STORAGE_KEY, [...THEME_MODES], report))
  runMigrationStep(report, LOCALE_STORAGE_KEY, () => normalizeEnumKey(storage, LOCALE_STORAGE_KEY, VALID_LOCALES, report))
  runMigrationStep(report, APP_ZOOM_STORAGE_KEY, () => normalizeAppZoomKey(storage, report))
  try {
    storage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))
  } catch {
    report.migratedKeys.push(DESKTOP_PERSISTENCE_VERSION_KEY)
  }

  return report
}
