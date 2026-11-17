/**
 * "Follow the system appearance" support for the desktop themes.
 *
 * The OS only hands us a dark/light signal, while the app ships six palettes —
 * four paper grounds and two ink ones. So each half carries its own
 * preference. A versioned record owns four preferences, mirrored to the
 * historical scalar keys for sequential downgrade compatibility:
 *
 *   followSystemTheme — is the switch on
 *   theme             — the applied theme (also the manual choice when off)
 *   lightTheme        — which paper palette the light half resolves to
 *   darkTheme         — which ink palette the dark half resolves to
 *
 * Detection goes through `prefers-color-scheme` rather than an Electron IPC
 * round-trip on purpose: the same renderer runs under Electron, the legacy
 * Tauri shell and the browser/H5 entry, and the media query is the only
 * signal all three share. Under Electron it is authoritative because the main
 * process never pins `nativeTheme.themeSource` — see
 * `desktop/electron/services/nativeAppearance.ts` for why.
 */

import {
  isDarkThemeMode,
  isLightThemeMode,
  isThemeMode,
  type DarkThemeMode,
  type LightThemeMode,
  type ThemeMode,
} from '../types/settings'

export type SystemAppearance = 'dark' | 'light'

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export const THEME_STORAGE_KEY = 'echoflow-code-theme'
export const FOLLOW_SYSTEM_THEME_STORAGE_KEY = 'echoflow-code-follow-system-theme'
export const LIGHT_THEME_STORAGE_KEY = 'echoflow-code-light-theme'
export const DARK_THEME_STORAGE_KEY = 'echoflow-code-dark-theme'

export const DEFAULT_THEME: ThemeMode = 'white'
export const DEFAULT_LIGHT_THEME: LightThemeMode = 'white'
export const DEFAULT_DARK_THEME: DarkThemeMode = 'dark'

/**
 * Base ground of each palette — the `--cc-bg` source value each
 * `[data-theme]` block sets in globals.css, which `--color-background` then
 * maps to. Duplicated here because the Electron window background and the
 * pre-hydration inline script both need it before any CSS is parsed;
 * theme/globals.test.ts keeps the two in sync.
 */
export const THEME_BACKGROUNDS: Record<ThemeMode, string> = {
  white: '#FFFFFF',
  paper: '#FBF9F4',
  'warm-classic': '#F6F0E1',
  celadon: '#F5F8F5',
  dark: '#201D17',
  'ink-blue': '#1A1D24',
}

/**
 * Fold the stored values into the theme that should be on `<html>`.
 * Pure so the pre-hydration inline script in index.html can be checked
 * against it (see theme/bootstrapScript.test.ts).
 */
export function resolveAppliedTheme(input: {
  followSystem: boolean
  theme: ThemeMode
  lightTheme: LightThemeMode
  darkTheme: DarkThemeMode
  systemAppearance: SystemAppearance
}): ThemeMode {
  if (!input.followSystem) return input.theme
  return input.systemAppearance === 'dark' ? input.darkTheme : input.lightTheme
}

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia(DARK_SCHEME_QUERY)
  } catch {
    // jsdom without a matchMedia stub, or a WebView that rejects the query.
    return null
  }
}

/**
 * Current OS appearance. Falls back to `'light'` where the query is
 * unavailable, matching the app's historical default theme.
 */
export function getSystemAppearance(): SystemAppearance {
  return getMediaQueryList()?.matches ? 'dark' : 'light'
}

/**
 * Subscribe to OS appearance flips. Returns an unsubscribe function; a no-op
 * one where the query is unavailable.
 */
export function subscribeSystemAppearance(
  onChange: (appearance: SystemAppearance) => void,
): () => void {
  const query = getMediaQueryList()
  if (!query) return () => {}

  const listener = (event: MediaQueryListEvent) => {
    onChange(event.matches ? 'dark' : 'light')
  }

  // Safari < 14 (and the older WebKit the Tauri shell runs on) only has the
  // deprecated addListener/removeListener pair.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }
  if (typeof query.addListener === 'function') {
    query.addListener(listener)
    return () => query.removeListener(listener)
  }
  return () => {}
}

export const THEME_PREFERENCES_STORAGE_KEY = 'echoflow-code-theme-preferences'
export const THEME_MIRROR_KEYS = [
  THEME_STORAGE_KEY,
  LIGHT_THEME_STORAGE_KEY,
  DARK_THEME_STORAGE_KEY,
  FOLLOW_SYSTEM_THEME_STORAGE_KEY,
] as const

const THEME_KEYS: readonly string[] = [THEME_PREFERENCES_STORAGE_KEY, ...THEME_MIRROR_KEYS]

/**
 * Subscribe to appearance changes made by *another* window.
 *
 * The pet window, the trace windows and the main window each run the renderer
 * bootstrap with their own store instance over one shared localStorage. The
 * `storage` event only fires in the windows that did not perform the write,
 * which is exactly the set that needs to catch up.
 */
export function subscribeThemeStorageChanges(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }

  const listener = (event: StorageEvent) => {
    // key is null when the whole store was cleared — that affects us too.
    if (event.key !== null && !THEME_KEYS.includes(event.key)) return
    onChange()
  }

  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function getStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export type ThemePreferences = {
  theme: ThemeMode
  lightTheme: LightThemeMode
  darkTheme: DarkThemeMode
  followSystem: boolean
}

type MirrorTuple = [string | null, string | null, string | null, string | null]
type ThemeRecord = Record<string, unknown> & ThemePreferences & {
  version: 1
  mirrorSync: Record<string, unknown> & { baseline: MirrorTuple; pending: boolean }
}
export type ThemePersistenceResult =
  | { status: 'saved' }
  | { status: 'pending'; stage: 'mirror' | 'completion'; key: string }
  | { status: 'failed'; stage: 'record'; key: string }
  | { status: 'blocked'; reason: 'unsupported-record' | 'malformed-record' | 'unreadable-record' | 'incomplete-mirrors' | 'invalid-sync' | 'invalid-pending-preferences' | 'conflicting-mirrors' | 'authority-changed' }

type ThemeSnapshot = {
  recordStatus: 'missing' | 'supported' | 'unsupported' | 'malformed' | 'unreadable'
  rawRecord: string | null
  record: ThemeRecord | null
  mirrors: MirrorTuple
  preferences: ThemePreferences
  persistence: ThemePersistenceResult | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizePreferences(value: Record<string, unknown>): ThemePreferences {
  const theme = isThemeMode(value.theme) ? value.theme : DEFAULT_THEME
  return {
    theme,
    lightTheme: isLightThemeMode(value.lightTheme) ? value.lightTheme : isLightThemeMode(theme) ? theme : DEFAULT_LIGHT_THEME,
    darkTheme: isDarkThemeMode(value.darkTheme) ? value.darkTheme : isDarkThemeMode(theme) ? theme : DEFAULT_DARK_THEME,
    followSystem: value.followSystem === true,
  }
}

function scalarPreferences([theme, lightTheme, darkTheme, follow]: MirrorTuple): ThemePreferences {
  return normalizePreferences({ theme, lightTheme, darkTheme, followSystem: follow === '1' || (follow !== '0' && theme === null) })
}

function mirrorTarget(preferences: ThemePreferences): MirrorTuple {
  return [preferences.theme, preferences.lightTheme, preferences.darkTheme, preferences.followSystem ? '1' : '0']
}

function equalTuple(a: MirrorTuple, b: MirrorTuple): boolean {
  return a.every((value, i) => value === b[i])
}

function reachablePrefix(actual: MirrorTuple, baseline: MirrorTuple, target: MirrorTuple): boolean {
  // shortcut: external edits matching a reachable prefix are indistinguishable; use a transactional protocol for mixed-version concurrent multi-key atomicity.
  return [0, 1, 2, 3, 4].some(end => actual.every((value, i) => value === (i < end ? target[i] : baseline[i])))
}

/** One synchronous authority decision, shared by hydration and every writer. */
export function readThemeSnapshot(storage: StorageLike | null = getStorage()): ThemeSnapshot {
  let rawRecord: string | null = null
  let recordReadable = false
  try {
    if (storage) { rawRecord = storage.getItem(THEME_PREFERENCES_STORAGE_KEY); recordReadable = true }
  } catch { /* A failed read is not a missing record. */ }
  let mirrorsReadable = !!storage
  const mirrors = THEME_MIRROR_KEYS.map(key => {
    try { return storage?.getItem(key) ?? null } catch { mirrorsReadable = false; return null }
  }) as MirrorTuple
  const snapshot: ThemeSnapshot = {
    rawRecord, recordStatus: 'missing', record: null, mirrors,
    preferences: scalarPreferences(mirrors), persistence: null,
  }
  const blocked = (reason: Extract<ThemePersistenceResult, { status: 'blocked' }>['reason']) => {
    snapshot.persistence = { status: 'blocked', reason }
    return snapshot
  }
  if (!recordReadable) { snapshot.recordStatus = 'unreadable'; return blocked('unreadable-record') }
  if (rawRecord === null) return mirrorsReadable ? snapshot : blocked('incomplete-mirrors')
  let parsed: unknown
  try { parsed = JSON.parse(rawRecord) } catch { /* Preserve malformed bytes. */ }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    snapshot.recordStatus = 'malformed'
    return blocked('malformed-record')
  }
  if (parsed.version !== 1) { snapshot.recordStatus = 'unsupported'; return blocked('unsupported-record') }
  snapshot.recordStatus = 'supported'
  const preferences = normalizePreferences(parsed)
  snapshot.preferences = preferences
  const sync = parsed.mirrorSync
  if (!isRecord(sync) || typeof sync.pending !== 'boolean' || !Array.isArray(sync.baseline) || sync.baseline.length !== 4 || !sync.baseline.every(value => value === null || typeof value === 'string')) return blocked('invalid-sync')
  snapshot.record = parsed as ThemeRecord
  if (!mirrorsReadable) return blocked('incomplete-mirrors')
  if (sync.pending) {
    if (Object.entries(preferences).some(([key, value]) => parsed[key] !== value)) return blocked('invalid-pending-preferences')
    const target = mirrorTarget(preferences)
    if (!reachablePrefix(mirrors, sync.baseline as MirrorTuple, target)) return blocked('conflicting-mirrors')
    const index = mirrors.findIndex((value, i) => value !== target[i])
    snapshot.persistence = index < 0
      ? { status: 'pending', stage: 'completion', key: THEME_PREFERENCES_STORAGE_KEY }
      : { status: 'pending', stage: 'mirror', key: THEME_MIRROR_KEYS[index]! }
  } else if (!equalTuple(mirrors, sync.baseline as MirrorTuple)) {
    snapshot.preferences = scalarPreferences(mirrors)
  } else {
    snapshot.persistence = { status: 'saved' }
  }
  return snapshot
}

function finishMirrorSync(storage: StorageLike, snapshot: ThemeSnapshot): ThemePersistenceResult {
  const record = snapshot.record!
  const target = mirrorTarget(record)
  for (let i = 0; i < THEME_MIRROR_KEYS.length; i++) {
    if (snapshot.mirrors[i] === target[i]) continue
    const key = THEME_MIRROR_KEYS[i]!
    try { storage.setItem(key, target[i]!) } catch { return { status: 'pending', stage: 'mirror', key } }
  }
  const confirmed = readThemeSnapshot(storage)
  if (confirmed.persistence?.status === 'blocked') return confirmed.persistence
  if (confirmed.rawRecord !== snapshot.rawRecord) return { status: 'blocked', reason: 'authority-changed' }
  if (!equalTuple(confirmed.mirrors, target)) return { status: 'blocked', reason: 'conflicting-mirrors' }
  try {
    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...record, mirrorSync: { ...record.mirrorSync, baseline: target, pending: false } }))
    return { status: 'saved' }
  } catch { return { status: 'pending', stage: 'completion', key: THEME_PREFERENCES_STORAGE_KEY } }
}

/** Commit authority first; compatibility mirrors are repairable, never a second owner. */
export function updateThemePreferences(
  update: (current: ThemePreferences) => ThemePreferences,
  storage: StorageLike | null = getStorage(),
): ThemePersistenceResult {
  let snapshot = readThemeSnapshot(storage)
  if (snapshot.persistence?.status === 'blocked') return snapshot.persistence
  if (!storage) return { status: 'blocked', reason: 'unreadable-record' }
  if (snapshot.record?.mirrorSync.pending) {
    const recovered = finishMirrorSync(storage, snapshot)
    if (recovered.status !== 'saved') return recovered
    snapshot = readThemeSnapshot(storage)
    if (snapshot.persistence?.status === 'blocked') return snapshot.persistence
  }
  const desired = update({ ...snapshot.preferences })
  const target = mirrorTarget(desired)
  if (snapshot.record && equalTuple(snapshot.record.mirrorSync.baseline, target) && equalTuple(snapshot.mirrors, target)
    && Object.entries(desired).every(([key, value]) => snapshot.record![key] === value)) return { status: 'saved' }
  const record: ThemeRecord = {
    ...snapshot.record, version: 1, ...desired,
    mirrorSync: { ...snapshot.record?.mirrorSync, baseline: snapshot.mirrors, pending: true },
  }
  const rawRecord = JSON.stringify(record)
  try { storage.setItem(THEME_PREFERENCES_STORAGE_KEY, rawRecord) } catch { return { status: 'failed', stage: 'record', key: THEME_PREFERENCES_STORAGE_KEY } }
  return finishMirrorSync(storage, { ...snapshot, record, rawRecord })
}

export function readStoredTheme(storage: StorageLike | null = getStorage()): ThemeMode {
  return readThemeSnapshot(storage).preferences.theme
}

export function readStoredLightTheme(storage: StorageLike | null = getStorage()): LightThemeMode {
  return readThemeSnapshot(storage).preferences.lightTheme
}

export function readStoredDarkTheme(storage: StorageLike | null = getStorage()): DarkThemeMode {
  return readThemeSnapshot(storage).preferences.darkTheme
}

export function readStoredFollowSystemTheme(storage: StorageLike | null = getStorage()): boolean {
  return readThemeSnapshot(storage).preferences.followSystem
}
