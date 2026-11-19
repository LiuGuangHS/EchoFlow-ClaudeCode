import { DARK_THEME_MODES, LIGHT_THEME_MODES, THEME_MODES } from '../types/settings'
import { migrateLegacyLocalePreference } from '../i18n/locale'
import {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_STORAGE_VERSION,
} from './workspace/storageKey'
import {
  APP_ZOOM_STORAGE_KEY,
  LEGACY_UI_ZOOM_STORAGE_KEY,
  isValidStoredAppZoomLevel,
  normalizeAppZoomLevel,
} from './appZoom'

import { CHAT_APPEARANCE_STORAGE_KEY, CHAT_APPEARANCE_VERSION, migrateChatAppearance } from './chatAppearance'
import { PREVENT_SLEEP_STORAGE_KEY } from './preventSleepPreference'
import {
  THEME_STORAGE_KEY as CURRENT_THEME_STORAGE_KEY,
  FOLLOW_SYSTEM_THEME_STORAGE_KEY as CURRENT_FOLLOW_SYSTEM_THEME_STORAGE_KEY,
  LIGHT_THEME_STORAGE_KEY as CURRENT_LIGHT_THEME_STORAGE_KEY,
  DARK_THEME_STORAGE_KEY as CURRENT_DARK_THEME_STORAGE_KEY,
  THEME_PREFERENCES_STORAGE_KEY,
  readThemeSnapshot,
} from '../theme/systemAppearance'

import {
  CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION,
  DESKTOP_PERSISTENCE_VERSION_KEY,
  copyLegacyPreference,
  LegacyCopyBlockedError,
} from './legacyPreferenceMigration'

export { CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION, DESKTOP_PERSISTENCE_VERSION_KEY }

type DesktopMigrationReport = {
  status: 'completed' | 'blocked' | 'unsupported'
  migratedKeys: string[]
  unchangedKeys: string[]
  unsupportedKeys: string[]
  failedKeys: string[]
  blockedKeys: string[]
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const TAB_STORAGE_KEY = 'cc-haha-open-tabs'
const SESSION_RUNTIME_STORAGE_KEY = 'cc-haha-session-runtime'
const THEME_STORAGE_KEY = 'cc-haha-theme'
const FOLLOW_SYSTEM_THEME_STORAGE_KEY = 'cc-haha-follow-system-theme'
const LIGHT_THEME_STORAGE_KEY = 'cc-haha-light-theme'
const DARK_THEME_STORAGE_KEY = 'cc-haha-dark-theme'
const LOCALE_STORAGE_KEY = 'cc-haha-locale'
const ACTIVE_SETTINGS_TAB_STORAGE_KEY = 'cc-haha-active-settings-tab'
// v0.7.4 and the builds that followed stored open tabs and per-session
// runtime choices under the old product prefix. The key rename shipped
// without a forward copy, so upgrading silently dropped both. `main.tsx`
// runs these migrations synchronously before any store hydrates; copy only
// when the current key is missing, never overwrite a newer value, and never
// remove the legacy source so a downgrade can still read it.
const LEGACY_STORAGE_RULES = [
  { targetKey: TAB_STORAGE_KEY, sourceKeys: ['echoflow-code-open-tabs'] },
  { targetKey: SESSION_RUNTIME_STORAGE_KEY, sourceKeys: ['echoflow-code-session-runtime'] },
] as const
// Schema 6 retired the standalone Trace page: its list tab, its per-session
// tabs and its Settings rail entry. Per-session traces now live in the chat's
// 轨迹 view, so a trace tab reopens as that session's chat tab.
const LEGACY_TRACE_LIST_TAB_ID = '__traces__'
const LEGACY_TRACE_TAB_PREFIX = '__trace__'
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const PERSISTED_SPECIAL_TAB_TYPES = ['settings', 'scheduled', 'market', 'connectors'] as const
const PERSISTED_SPECIAL_TAB_IDS: Record<(typeof PERSISTED_SPECIAL_TAB_TYPES)[number], string> = {
  settings: '__settings__',
  scheduled: '__scheduled__',
  market: '__market__',
  connectors: '__connectors__',
}
const SUPPORTED_LOCALES = ['en', 'zh', 'zh-TW', 'jp', 'kr']
const WORKSPACE_PERSISTED_TAB_KINDS = ['file', 'browser', 'review', 'terminal']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPersistedSpecialTabType(value: unknown): value is (typeof PERSISTED_SPECIAL_TAB_TYPES)[number] {
  return typeof value === 'string' && (PERSISTED_SPECIAL_TAB_TYPES as readonly string[]).includes(value)
}

function getPersistedSpecialTabType(tab: Record<string, unknown>): (typeof PERSISTED_SPECIAL_TAB_TYPES)[number] | null {
  if (tab.sessionId === '__settings__') return 'settings'
  if (tab.sessionId === '__scheduled__') return 'scheduled'
  if (tab.sessionId === '__connectors__') return 'market'
  if (tab.sessionId === '__market__') return 'market'
  return isPersistedSpecialTabType(tab.type) ? tab.type === 'connectors' ? 'market' : tab.type : null
}

function isLegacyTraceListTab(tab: Record<string, unknown>): boolean {
  return tab.sessionId === LEGACY_TRACE_LIST_TAB_ID || tab.type === 'traces'
}

function isLegacyTraceTab(tab: Record<string, unknown>): boolean {
  return tab.type === 'trace' || String(tab.sessionId).startsWith(LEGACY_TRACE_TAB_PREFIX)
}

/** The session a retired per-session trace tab pointed at, or null. */
function getLegacyTraceSessionId(tab: Record<string, unknown>): string | null {
  if (!isLegacyTraceTab(tab)) return null
  const sessionId = String(tab.sessionId)
  const traced = typeof tab.traceSessionId === 'string' && tab.traceSessionId
    ? tab.traceSessionId
    : sessionId.slice(LEGACY_TRACE_TAB_PREFIX.length)
  return traced && !traced.startsWith(LEGACY_TRACE_TAB_PREFIX) ? traced : null
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value))
}

function migrateTabs(storage: StorageLike, report: DesktopMigrationReport): void {
  const raw = storage.getItem(TAB_STORAGE_KEY)
  if (!raw) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    storage.removeItem(TAB_STORAGE_KEY)
    report.migratedKeys.push(TAB_STORAGE_KEY)
    return
  }
  const rawTabs = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.openTabs)
      ? parsed.openTabs
      : []
  const openTabs = rawTabs
    .filter((tab): tab is Record<string, unknown> => isRecord(tab))
    .filter((tab) => typeof tab.sessionId === 'string' && typeof tab.title === 'string')
    .filter((tab) => tab.type !== 'terminal' && !String(tab.sessionId).startsWith('__terminal__'))
    .filter((tab) => !isLegacyTraceListTab(tab))
    .filter((tab) => !isLegacyTraceTab(tab) || getLegacyTraceSessionId(tab) !== null)
    .map((tab) => {
      const specialType = getPersistedSpecialTabType(tab)
      const tracedSessionId = getLegacyTraceSessionId(tab)
      return {
        sessionId: specialType
          ? PERSISTED_SPECIAL_TAB_IDS[specialType]
          : tracedSessionId ?? tab.sessionId as string,
        title: tab.title as string,
        type: specialType ?? 'session',
      }
    })
    .filter((tab, index, tabs) => tabs.findIndex(other => other.sessionId === tab.sessionId) === index)
  const legacyActive = isRecord(parsed) ? rawTabs.find(tab => isRecord(tab) && tab.sessionId === parsed.activeTabId) : undefined
  const activeType = isRecord(legacyActive) ? getPersistedSpecialTabType(legacyActive) : null
  const activeTracedSessionId = isRecord(parsed) && typeof parsed.activeTabId === 'string'
    ? getLegacyTraceSessionId(isRecord(legacyActive) ? legacyActive : { sessionId: parsed.activeTabId })
    : null
  const normalizedActive = activeType
    ? PERSISTED_SPECIAL_TAB_IDS[activeType]
    : activeTracedSessionId ?? (isRecord(parsed) ? parsed.activeTabId : null)
  const activeTabId =
    isRecord(parsed) &&
    typeof normalizedActive === 'string' &&
    openTabs.some((tab) => tab.sessionId === normalizedActive)
      ? normalizedActive
      : (openTabs[0]?.sessionId ?? null)

  if (openTabs.length === 0) {
    storage.removeItem(TAB_STORAGE_KEY)
  } else {
    const next = JSON.stringify({ openTabs, activeTabId })
    if (raw === next) return
    storage.setItem(TAB_STORAGE_KEY, next)
  }
  report.migratedKeys.push(TAB_STORAGE_KEY)
}

function migrateActiveSettingsTab(storage: StorageLike, report: DesktopMigrationReport): void {
  // Schema 6 rewrote a persisted 'trace' Settings selection to 'general' when
  // the standalone Trace page was retired. The Trace section is restored and
  // 'trace' is a valid SettingsTab again, so leave the stored value untouched —
  // otherwise a user's chosen section is silently lost on every startup.
  // The step keeps its slot (and its key/params) for older installs.
  void storage
  void report
  void ACTIVE_SETTINGS_TAB_STORAGE_KEY
}

function migrateSessionRuntime(storage: StorageLike, report: DesktopMigrationReport): void {
  const raw = storage.getItem(SESSION_RUNTIME_STORAGE_KEY)
  if (!raw) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    storage.removeItem(SESSION_RUNTIME_STORAGE_KEY)
    report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
    return
  }
  if (!isRecord(parsed)) {
    storage.removeItem(SESSION_RUNTIME_STORAGE_KEY)
    report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
    return
  }

  const next = Object.fromEntries(
    Object.entries(parsed).filter(([, selection]) => (
      isRecord(selection) &&
      typeof selection.modelId === 'string' &&
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
    report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
  } else {
    const serialized = JSON.stringify(next)
    if (raw !== serialized) {
      storage.setItem(SESSION_RUNTIME_STORAGE_KEY, serialized)
      report.migratedKeys.push(SESSION_RUNTIME_STORAGE_KEY)
    }
  }

}

/**
 * The 「纸 · 墨 · 印」 redesign replaced three theme keys with six.
 *
 * `light` was the warm workspace, labelled 经典暖色 in the picker, so it lands
 * on `warm-classic` — the palette carrying the same name. Without this it
 * would fail the enum check and silently reset those users to the default,
 * which reads as "the app forgot my theme" rather than as a rename.
 */
const RENAMED_THEMES: Record<string, string> = {
  light: 'warm-classic',
}

/**
 * Rename-aware normalization for any key holding a theme name. The applied
 * theme is not the only one: following the system stores a preference per
 * ground, and those hold theme names too, so a rename has to reach them or
 * the preference silently resets.
 */
function migrateThemeKey(
  storage: StorageLike,
  key: string,
  allowedValues: readonly string[],
  report: DesktopMigrationReport,
): void {
  const stored = storage.getItem(key)
  const renamed = stored === null ? null : RENAMED_THEMES[stored]
  if (renamed && allowedValues.includes(renamed)) {
    storage.setItem(key, renamed)
    report.migratedKeys.push(key)
    return
  }
  normalizeEnumKey(storage, key, [...allowedValues], report)
}

/**
 * Schema 2 introduced the unified workspace store. Schema 3 adds review viewed
 * paths and the turn checkpoint index to its descriptors. Old workspaces keep
 * their tabs, including the Files picker whose path is deliberately empty.
 *
 * Terminal descriptors are the reason this cannot be left to the hydrator
 * alone: a stale entry carrying a live-looking runtime id is exactly the shape
 * that would make a restored shell look like a running process.
 */
function migrateWorkspaceState(storage: StorageLike, report: DesktopMigrationReport): void {
  const raw = storage.getItem(WORKSPACE_STORAGE_KEY)
  if (!raw) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    storage.removeItem(WORKSPACE_STORAGE_KEY)
    report.migratedKeys.push(WORKSPACE_STORAGE_KEY)
    return
  }
  if (isRecord(parsed) && parsed.version !== 1 && parsed.version !== WORKSPACE_STORAGE_VERSION) {
    // A newer build wrote this. The hydrator already refuses a version it
    // does not know, so leave the entry alone — deleting it would mean that
    // downgrading once, briefly, permanently discards the workspace the newer
    // build is still using.
    report.unsupportedKeys.push(WORKSPACE_STORAGE_KEY)
    return
  }
  if (!isRecord(parsed) || !isRecord(parsed.sessions)) {
    storage.removeItem(WORKSPACE_STORAGE_KEY)
    report.migratedKeys.push(WORKSPACE_STORAGE_KEY)
    return
  }

  let changed = parsed.version !== WORKSPACE_STORAGE_VERSION
  const sessions: Record<string, unknown> = {}
  for (const [sessionId, value] of Object.entries(parsed.sessions)) {
    if (!isRecord(value) || !Array.isArray(value.tabs)) {
      changed = true
      continue
    }
    const tabs = value.tabs.filter((tab) =>
      isRecord(tab) &&
      typeof tab.id === 'string' &&
      // Anything naming a host resource is stale by definition once the
      // process that owned it is gone.
      !('runtimeId' in tab) &&
      !('browserTabId' in tab) &&
      WORKSPACE_PERSISTED_TAB_KINDS.includes(tab.kind as string))
      .map((tab) => parsed.version === 1 && tab.kind === 'review'
        ? { ...tab, viewedPaths: [] }
        : tab)
    if (tabs.length !== value.tabs.length) changed = true
    if (tabs.length === 0) {
      changed = true
      continue
    }
    sessions[sessionId] = { ...value, tabs }
  }

  if (Object.keys(sessions).length === 0) {
    storage.removeItem(WORKSPACE_STORAGE_KEY)
    report.migratedKeys.push(WORKSPACE_STORAGE_KEY)
    return
  }
  if (changed) {
    writeJson(storage, WORKSPACE_STORAGE_KEY, { ...parsed, version: WORKSPACE_STORAGE_VERSION, sessions })
    report.migratedKeys.push(WORKSPACE_STORAGE_KEY)
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

  const currentValue = storage.getItem(APP_ZOOM_STORAGE_KEY)
  const legacyValue = storage.getItem(LEGACY_UI_ZOOM_STORAGE_KEY)
  if (currentValue === null && legacyValue !== null && isValidStoredAppZoomLevel(legacyValue)) {
    storage.setItem(APP_ZOOM_STORAGE_KEY, String(normalizeAppZoomLevel(legacyValue)))
    report.migratedKeys.push(APP_ZOOM_STORAGE_KEY)
  }
  if (legacyValue !== null) {
    storage.removeItem(LEGACY_UI_ZOOM_STORAGE_KEY)
    report.migratedKeys.push(LEGACY_UI_ZOOM_STORAGE_KEY)
  }
}

function runMigrationStep(
  report: DesktopMigrationReport,
  fallbackKey: string,
  step: () => void,
): void {
  const migratedCount = report.migratedKeys.length
  const unsupportedCount = report.unsupportedKeys.length
  try {
    step()
    if (report.migratedKeys.length === migratedCount && report.unsupportedKeys.length === unsupportedCount) {
      report.unchangedKeys.push(fallbackKey)
    }
  } catch (error) {
    report.migratedKeys.splice(migratedCount)
    if (error instanceof LegacyCopyBlockedError) report.blockedKeys.push(fallbackKey)
    else report.failedKeys.push(fallbackKey)
  }
}

function getDefaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

// The workspace bridge imports uiStore before main.tsx runs migrations, so
// the store also calls this step before hydrating its width.
export function migrateLegacySidebarWidth(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  return copyLegacyPreference(storage, 'cc-haha-sidebar-width', (version) => {
    if (version >= 9) return null
    const legacy = storage.getItem('echoflow-code-sidebar-width')
    return legacy !== null && Number.isFinite(Number(legacy)) && Number(legacy) > 0 ? legacy : null
  })
}

export function runDesktopPersistenceMigrations(storage: StorageLike | null = getDefaultStorage()): DesktopMigrationReport {
  const report: DesktopMigrationReport = {
    status: 'blocked', migratedKeys: [], unchangedKeys: [], unsupportedKeys: [], failedKeys: [], blockedKeys: [],
  }
  if (!storage) {
    report.blockedKeys.push(DESKTOP_PERSISTENCE_VERSION_KEY)
    return report
  }
  let previousVersion: string | null
  try {
    previousVersion = storage.getItem(DESKTOP_PERSISTENCE_VERSION_KEY)
    if (Number(previousVersion) > CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION) {
      report.status = 'unsupported'
      report.unsupportedKeys.push(DESKTOP_PERSISTENCE_VERSION_KEY)
      return report
    }
  } catch {
    // An unreadable schema blocks all other reads and every mutation.
    report.failedKeys.push(DESKTOP_PERSISTENCE_VERSION_KEY)
    report.blockedKeys.push(DESKTOP_PERSISTENCE_VERSION_KEY)
    return report
  }

  // Forward-copy the pre-rename keys before any tab/runtime migration reads
  // them, so the copy is normalized by the steps below exactly like a normal
  // install.
  for (const rule of LEGACY_STORAGE_RULES) {
    runMigrationStep(report, rule.targetKey, () => {
      if (copyLegacyPreference(storage, rule.targetKey, () => {
        const sourceKey = rule.sourceKeys.find(key => storage.getItem(key) !== null)
        return sourceKey ? storage.getItem(sourceKey) : null
      })) report.migratedKeys.push(rule.targetKey)
      if (rule.targetKey === TAB_STORAGE_KEY) migrateTabs(storage, report)
      else migrateSessionRuntime(storage, report)
    })
  }
  runMigrationStep(report, ACTIVE_SETTINGS_TAB_STORAGE_KEY, () => migrateActiveSettingsTab(storage, report))
  // Copy legacy appearance values before normalizing only the current keys.
  // Legacy bytes remain intact for downgrade and recovery.
  const themeSnapshot = readThemeSnapshot(storage)
  if (themeSnapshot.recordStatus === 'missing' && themeSnapshot.persistence?.status !== 'blocked') {
    for (const [legacyKey, currentKey, allowed] of [
      [THEME_STORAGE_KEY, CURRENT_THEME_STORAGE_KEY, THEME_MODES],
      [FOLLOW_SYSTEM_THEME_STORAGE_KEY, CURRENT_FOLLOW_SYSTEM_THEME_STORAGE_KEY, ['0', '1']],
      [LIGHT_THEME_STORAGE_KEY, CURRENT_LIGHT_THEME_STORAGE_KEY, LIGHT_THEME_MODES],
      [DARK_THEME_STORAGE_KEY, CURRENT_DARK_THEME_STORAGE_KEY, DARK_THEME_MODES],
    ] as const) {
      runMigrationStep(report, currentKey, () => {
        if (copyLegacyPreference(storage, currentKey, (version) => version < 8 ? storage.getItem(legacyKey) : null)) {
          report.migratedKeys.push(currentKey)
        }
        migrateThemeKey(storage, currentKey, allowed, report)
      })
    }
  } else {
    // Present/unreadable authority or incomplete mirrors reserve the whole theme domain.
    const keys = themeSnapshot.recordStatus === 'unsupported' ? report.unsupportedKeys
      : themeSnapshot.recordStatus === 'unreadable' ? report.failedKeys
      : themeSnapshot.persistence?.status === 'blocked' ? report.blockedKeys
      : report.unchangedKeys
    keys.push(THEME_PREFERENCES_STORAGE_KEY)
  }
  runMigrationStep(report, LOCALE_STORAGE_KEY, () => {
    if (migrateLegacyLocalePreference(storage)) report.migratedKeys.push(LOCALE_STORAGE_KEY)
    normalizeEnumKey(storage, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, report)
  })
  runMigrationStep(report, 'cc-haha-sidebar-width', () => {
    if (migrateLegacySidebarWidth(storage)) report.migratedKeys.push('cc-haha-sidebar-width')
  })
  for (const [sourceKey, targetKey] of [
    ['echoflow-code-chat-appearance', CHAT_APPEARANCE_STORAGE_KEY],
    ['echoflow-code-app-zoom', APP_ZOOM_STORAGE_KEY],
    ['echoflow-code-open-target-preferences', 'cc-haha-open-target-preferences'],
  ] as const) {
    runMigrationStep(report, targetKey, () => {
      // Schema 9 predates these copies; retain their existing per-key boundaries.
      if (copyLegacyPreference(storage, targetKey, () => storage.getItem(sourceKey))) {
        report.migratedKeys.push(targetKey)
      }
      if (targetKey === APP_ZOOM_STORAGE_KEY) normalizeAppZoomKey(storage, report)
      if (targetKey === CHAT_APPEARANCE_STORAGE_KEY) {
        const raw = storage.getItem(targetKey)
        let value: unknown
        try { value = JSON.parse(raw ?? 'null') } catch { /* The domain normalizes malformed data. */ }
        if (isRecord(value) && value.version !== undefined && value.version !== CHAT_APPEARANCE_VERSION) {
          report.unsupportedKeys.push(targetKey)
        } else if (migrateChatAppearance(storage)) {
          report.migratedKeys.push(targetKey)
        }
      }
    })
  }
  runMigrationStep(report, WORKSPACE_STORAGE_KEY, () => migrateWorkspaceState(storage, report))
  // Schema 7 adds an opt-in power preference. Old installs stay off; upgrades
  // preserve either explicit choice and normalize incomplete/invalid values.
  runMigrationStep(report, PREVENT_SLEEP_STORAGE_KEY, () => {
    const stored = storage.getItem(PREVENT_SLEEP_STORAGE_KEY)
    if (stored !== '0' && stored !== '1') {
      storage.setItem(PREVENT_SLEEP_STORAGE_KEY, '0')
      report.migratedKeys.push(PREVENT_SLEEP_STORAGE_KEY)
    }
  })
  // A per-key copy is not a multi-key transaction; uncertain completion blocks the promise.
  const incomplete = new Set([...report.failedKeys, ...report.blockedKeys, ...report.unsupportedKeys])
  report.migratedKeys = [...new Set(report.migratedKeys)].filter(key => !incomplete.has(key))
  report.unchangedKeys = [...new Set(report.unchangedKeys)].filter(key => !incomplete.has(key) && !report.migratedKeys.includes(key))
  if (incomplete.size > 0) {
    report.status = report.failedKeys.length || report.blockedKeys.length ? 'blocked' : 'unsupported'
    return report
  }
  if (previousVersion !== String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION)) {
    try {
      storage.setItem(DESKTOP_PERSISTENCE_VERSION_KEY, String(CURRENT_DESKTOP_PERSISTENCE_SCHEMA_VERSION))
    } catch {
      report.blockedKeys.push(DESKTOP_PERSISTENCE_VERSION_KEY)
      return report
    }
  }
  report.status = 'completed'
  return report
}
