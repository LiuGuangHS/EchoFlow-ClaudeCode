import { create } from 'zustand'
import { migrateLegacySidebarWidth } from '../lib/persistenceMigrations'
import {
  isDarkTheme,
  isDarkThemeMode,
  isLightThemeMode,
  THEME_MODES,
  type DarkThemeMode,
  type LightThemeMode,
  type ThemeMode,
} from '../types/settings'
import {
  THEME_BACKGROUNDS,
  getSystemAppearance,
  readStoredFollowSystemTheme,
  readStoredLightTheme,
  readThemeSnapshot,
  updateThemePreferences,
  type ThemePreferences,
  type ThemePersistenceResult,
  type SystemAppearance,
  resolveAppliedTheme,
  subscribeSystemAppearance,
  subscribeThemeStorageChanges,
} from '../theme/systemAppearance'

const ACTIVE_SETTINGS_TAB_STORAGE_KEY = 'cc-haha-active-settings-tab'
const SIDEBAR_WIDTH_STORAGE_KEY = 'cc-haha-sidebar-width'

export const SIDEBAR_MIN_WIDTH = 240
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 280

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function getStoredSidebarWidth(): number {
  try {
    migrateLegacySidebarWidth(localStorage)
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
    if (Number.isFinite(stored) && stored > 0) return clampSidebarWidth(stored)
  } catch { /* localStorage unavailable */ }
  return SIDEBAR_DEFAULT_WIDTH
}

const SETTINGS_TABS = [
  'providers',
  'runtime',
  'activity',
  'general',
  'network',
  'data',
  'voice',
  'h5Access',
  'adapters',
  'terminal',
  'mcp',
  'agents',
  'skills',
  'memory',
  'plugins',
  'pets',
  'computerUse',
  'diagnostics',
  'trace',
  'about',
] as const

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch { /* localStorage unavailable */ }
}

function themeState(snapshot = readThemeSnapshot(), appearance = getSystemAppearance()) {
  const { preferences, persistence } = snapshot
  return {
    theme: resolveAppliedTheme({ ...preferences, systemAppearance: appearance }),
    lightTheme: preferences.lightTheme,
    darkTheme: preferences.darkTheme,
    followSystemTheme: preferences.followSystem,
    themePersistence: persistence,
  }
}

function refreshTheme(appearance = getSystemAppearance(), result?: ThemePersistenceResult) {
  const state = themeState(readThemeSnapshot(), appearance)
  useUIStore.setState({ ...state, themePersistence: result ?? state.themePersistence })
  applyTheme(state.theme, state.followSystemTheme, state.lightTheme)
}

function changeTheme(update: (current: ThemePreferences) => ThemePreferences, appearance: SystemAppearance = getSystemAppearance()) {
  const result = updateThemePreferences(update)
  refreshTheme(appearance, result)
}

function resolvedPreferences(current: ThemePreferences, appearance: SystemAppearance): ThemePreferences {
  return { ...current, theme: resolveAppliedTheme({ ...current, systemAppearance: appearance }) }
}

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value)
}

function getStoredSettingsTab(): SettingsTab {
  try {
    const stored = localStorage.getItem(ACTIVE_SETTINGS_TAB_STORAGE_KEY)
    if (isSettingsTab(stored)) return stored
  } catch { /* localStorage unavailable */ }
  return 'providers'
}

/**
 * Repaint the document for `theme`. Shared with the cross-window storage sync
 * below so a palette change made in another window lands identically here —
 * the `theme-color` meta in particular, which colors the iOS status bar and
 * the Android address bar and would otherwise stay on the palette this window
 * booted with.
 */
function paintDocumentTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme)
  // Two of the six palettes sit on a dark ground, so this cannot test for the
  // literal 'dark' key — ink-blue would render native scrollbars and form
  // controls in their light variant against a near-black page.
  document.documentElement.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BACKGROUNDS[theme])
}

export function applyTheme(
  theme: ThemeMode,
  followSystem = readStoredFollowSystemTheme(),
  lightTheme = readStoredLightTheme(),
) {
  if (typeof document === 'undefined') return
  paintDocumentTheme(theme)
  notifyHostAppearance(theme, followSystem, lightTheme)
}

/**
 * Tell the Electron main process which theme ended up applied, so the native
 * window background matches it on the next launch. Best effort: the browser
 * host and the Tauri shell have no such channel and simply no-op.
 *
 * `lightBackground` travels along because a cache written at night would
 * otherwise have no way to know which light theme to repaint in the morning.
 */
function notifyHostAppearance(theme: ThemeMode, followSystem: boolean, lightTheme: LightThemeMode) {
  void import('../lib/desktopHost')
    .then(({ desktopHost }) => desktopHost.appearance.setApplied({
      isDark: isDarkTheme(theme),
      background: THEME_BACKGROUNDS[theme],
      lightBackground: THEME_BACKGROUNDS[lightTheme],
      followSystem,
    }))
    .catch(() => { /* host channel unavailable */ })
}

let stopSystemAppearanceWatch: (() => void) | null = null
let stopStorageSync: (() => void) | null = null

export function initializeTheme() {
  teardownTheme()
  // Eager imports may predate startup migrations or another window's update.
  const appearance = getSystemAppearance()
  changeTheme(current => resolvedPreferences(current, appearance), appearance)
  stopSystemAppearanceWatch = subscribeSystemAppearance((nextAppearance) => {
    changeTheme(current => resolvedPreferences(current, nextAppearance), nextAppearance)
  })
  // Storage events project authority only; they must never repair/write it.
  stopStorageSync = subscribeThemeStorageChanges(() => refreshTheme())
}

/** Test seam: drop the listeners installed by initializeTheme. */
export function teardownTheme() {
  stopSystemAppearanceWatch?.()
  stopSystemAppearanceWatch = null
  stopStorageSync?.()
  stopStorageSync = null
}

export type Toast = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
  /** One follow-up, such as undo. Running it also dismisses the toast. */
  action?: { label: string; onClick: () => void }
}

export type MarketTarget = {
  section: 'plugins' | 'skills'
  /** Open this connector's detail once the catalog loads. */
  connectorId?: string
}

export type SettingsTab =
  | 'providers'
  | 'activity'
  | 'general'
  | 'voice'
  | 'h5Access'
  | 'adapters'
  | 'terminal'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'memory'
  | 'plugins'
  | 'pets'
  | 'computerUse'
  | 'network'
  | 'runtime'
  | 'data'
  | 'diagnostics'
  | 'trace'
  | 'about'

type ActiveView = 'code' | 'scheduled' | 'terminal' | 'history' | 'settings'

/** The desktop's retained new-session composer. Memory only, never persisted. */
export type NewSessionDraft = {
  workDir: string
  /** Identifies one composer mount; a new draft gets a new one. */
  revision: number
  /**
   * Unsent text or attachments, as reported by the composer. Only an empty
   * draft may be moved to the project a "New session" entry asks for; picking
   * a project, model or mode alone is not content.
   */
  hasContent: boolean
}

/** A workspace action the draft composer should perform after it assigns a session. */
export type DraftWorkspaceAction = 'toggle-side' | 'toggle-bottom' | 'toggle-fullscreen'

export type DraftWorkspaceRequest = {
  action: DraftWorkspaceAction
  /** Only the draft revision that asked for it may consume the request. */
  revision: number
  nonce: number
  originatingTabId: string | null
  originatingView: ActiveView
}

type UIStore = {
  /** The theme currently on `<html>` — resolved, not necessarily the manual pick. */
  theme: ThemeMode
  /** Whether `theme` tracks the OS dark/light setting. */
  followSystemTheme: boolean
  /** Which paper palette the light half of "follow the system" resolves to. */
  lightTheme: LightThemeMode
  /** Which ink palette the dark half of "follow the system" resolves to. */
  darkTheme: DarkThemeMode
  /** Domain outcome only; never persisted as another preference. */
  themePersistence: ThemePersistenceResult | null
  sidebarOpen: boolean
  /** Expanded-state sidebar width in px, user-resizable within the clamp range. */
  sidebarWidth: number
  activeView: ActiveView
  activeSettingsTab: SettingsTab
  pendingSettingsTab: SettingsTab | null
  pendingMemoryPath: string | null
  /** Where the extension market should open next (set by the composer + menu). */
  pendingMarketTarget: MarketTarget | null
  /**
   * Bumped by Cmd+N. The sidebar's "New session" item answers it, so the
   * shortcut it advertises does exactly what clicking it does.
   */
  newSessionRequest: number
  /** Ephemeral composer seed. No server session exists until the first send. */
  newSessionDraft: NewSessionDraft | null
  /** Set when a workspace control is used before the draft owns a session. */
  draftWorkspaceRequest: DraftWorkspaceRequest | null
  activeModal: string | null
  toasts: Toast[]

  setTheme: (theme: ThemeMode, followSystem?: boolean) => void
  setFollowSystemTheme: (follow: boolean) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setActiveView: (view: ActiveView) => void
  setActiveSettingsTab: (tab: SettingsTab) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  setPendingMemoryPath: (path: string | null) => void
  setPendingMarketTarget: (target: MarketTarget | null) => void
  requestNewSession: () => void
  /**
   * Opens the retained draft for `workDir`. An empty draft moves there; one
   * with unsent content keeps its project. No `workDir` keeps the draft as is.
   */
  startNewSessionDraft: (workDir?: string) => void
  /** The composer of draft `revision` reports whether it holds unsent content. */
  setNewSessionDraftContent: (revision: number, hasContent: boolean) => void
  requestDraftWorkspace: (action: DraftWorkspaceAction, originatingTabId?: string | null, originatingView?: ActiveView) => void
  clearDraftWorkspaceRequest: (nonce: number) => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastCounter = 0
let newSessionDraftRevision = 0
let draftWorkspaceRequestNonce = 0

export const useUIStore = create<UIStore>((set) => ({
  ...themeState(),
  sidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  activeView: 'code',
  activeSettingsTab: getStoredSettingsTab(),
  pendingSettingsTab: null,
  pendingMemoryPath: null,
  pendingMarketTarget: null,
  newSessionRequest: 0,
  newSessionDraft: null,
  draftWorkspaceRequest: null,
  activeModal: null,
  toasts: [],

  // Picking a palette while following the system does not fight the OS: it
  // becomes the preference for its own half and shows up once the OS is on
  // that ground. So choosing ink-blue at noon is remembered for tonight.
  setTheme: (theme, followSystem) => {
    const appearance = getSystemAppearance()
    changeTheme(current => resolvedPreferences({
      ...current,
      theme,
      lightTheme: isLightThemeMode(theme) ? theme : current.lightTheme,
      darkTheme: isDarkThemeMode(theme) ? theme : current.darkTheme,
      followSystem: followSystem ?? current.followSystem,
    }, appearance), appearance)
  },

  // Turning the switch off freezes the currently resolved palette.
  setFollowSystemTheme: (follow) => {
    const appearance = getSystemAppearance()
    changeTheme(current => resolvedPreferences({
      ...resolvedPreferences(current, appearance), followSystem: follow,
    }, appearance), appearance)
  },

  // Cycling is an explicit takeover, so it also releases the OS switch.
  toggleTheme: () => {
    const appearance = getSystemAppearance()
    changeTheme(current => {
      const applied = resolvedPreferences(current, appearance).theme
      const next = THEME_MODES[(THEME_MODES.indexOf(applied) + 1) % THEME_MODES.length] ?? 'white'
      return {
        ...current, theme: next, followSystem: false,
        lightTheme: isLightThemeMode(next) ? next : current.lightTheme,
        darkTheme: isDarkThemeMode(next) ? next : current.darkTheme,
      }
    }, appearance)
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => {
    const clamped = clampSidebarWidth(width)
    persist(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped))
    set({ sidebarWidth: clamped })
  },
  setActiveView: (view) => set({ activeView: view }),
  setActiveSettingsTab: (tab) => {
    try { localStorage.setItem(ACTIVE_SETTINGS_TAB_STORAGE_KEY, tab) } catch { /* noop */ }
    set({ activeSettingsTab: tab })
  },
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  setPendingMemoryPath: (path) => set({ pendingMemoryPath: path }),
  setPendingMarketTarget: (target) => set({ pendingMarketTarget: target }),
  startNewSessionDraft: (workDir) => set(state => {
    const draft = state.newSessionDraft
    if (!draft) {
      return {
        activeView: 'code',
        newSessionDraft: { workDir: workDir ?? '', revision: ++newSessionDraftRevision, hasContent: false },
        draftWorkspaceRequest: null,
      }
    }
    // New-chat navigation returns to the retained composer and never replaces
    // its revision: that would unmount it and silently discard unsent input,
    // attachments and the mode picked in it. An empty one is moved in place;
    // unsent content keeps the project it was written for.
    if (workDir === undefined || draft.hasContent || draft.workDir === workDir) return { activeView: 'code' }
    return { activeView: 'code', newSessionDraft: { ...draft, workDir } }
  }),
  setNewSessionDraftContent: (revision, hasContent) => set(state => (
    state.newSessionDraft?.revision === revision && state.newSessionDraft.hasContent !== hasContent
      ? { newSessionDraft: { ...state.newSessionDraft, hasContent } }
      : state
  )),
  requestDraftWorkspace: (action, originatingTabId = null, originatingView = 'code') => set(state => state.newSessionDraft
    ? {
        draftWorkspaceRequest: {
          action,
          revision: state.newSessionDraft.revision,
          nonce: ++draftWorkspaceRequestNonce,
          originatingTabId,
          originatingView,
        },
      }
    : state),
  clearDraftWorkspaceRequest: (nonce) => set(state =>
    state.draftWorkspaceRequest?.nonce === nonce ? { draftWorkspaceRequest: null } : state),
  requestNewSession: () => set((state) => ({ newSessionRequest: state.newSessionRequest + 1 })),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    // Auto-remove after duration
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
