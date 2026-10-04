import { create } from 'zustand'
import { gt, valid } from 'semver'
import { getDesktopHost } from '../lib/desktopHost'
import type { DesktopHost, DesktopUpdate } from '../lib/desktopHost'
import type { UpdateProxySettings } from '../types/settings'
import { useSettingsStore } from './settingsStore'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'restarting'
  | 'error'

export type UpdateErrorCode = 'network' | 'metadata' | 'proxy' | 'download' | 'install' | 'restart' | 'unknown'

type CheckOptions = {
  silent?: boolean
  autoDownload?: boolean
  background?: boolean
}

const DISMISSED_UPDATE_VERSION_KEY = 'echoflow-code-dismissed-update-version'
const RELAUNCH_WATCHDOG_MS = 15_000
const UPDATE_CHECK_INTERVAL_MS = 8 * 60 * 60 * 1_000
const UPDATE_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1_000

type UpdateStore = {
  status: UpdateStatus
  availableVersion: string | null
  releaseNotes: string | null
  progressPercent: number
  downloadedBytes: number
  totalBytes: number | null
  error: string | null
  errorCode: UpdateErrorCode | null
  checkedAt: number | null
  shouldPrompt: boolean
  initialize: () => Promise<void>
  checkForUpdates: (options?: CheckOptions) => Promise<DesktopUpdate | null>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  dismissPrompt: () => void
}

let pendingUpdate: DesktopUpdate | null = null
let pendingUpdateProxyKey: string | null = null
let pendingUpdateDownloaded = false
let downloadPromise: Promise<void> | null = null
let downloadingProxyKey: string | null = null
let startupCheckPromise: Promise<void> | null = null
let periodicCheckTimer: ReturnType<typeof setInterval> | null = null
let networkRecoveryListener: (() => void) | null = null
let relaunchWatchdog: ReturnType<typeof setTimeout> | null = null

function clearRelaunchWatchdog() {
  if (!relaunchWatchdog) return
  clearTimeout(relaunchWatchdog)
  relaunchWatchdog = null
}

function scheduleRelaunchWatchdog(host: DesktopHost) {
  clearRelaunchWatchdog()
  relaunchWatchdog = setTimeout(() => {
    relaunchWatchdog = null
    if (useUpdateStore.getState().status !== 'restarting') return

    void host.updates.cancelInstall().catch(() => undefined)
    void host.runtime.getServerUrl().catch(() => undefined)
    useUpdateStore.setState((state) => ({
      ...state,
      status: 'downloaded',
      error: null,
      errorCode: 'restart',
      shouldPrompt: true,
      progressPercent: 100,
    }))
  }, RELAUNCH_WATCHDOG_MS)
}

function readDismissedUpdateVersion(): string | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY)
  } catch {
    return null
  }
}

function writeDismissedUpdateVersion(version: string | null) {
  if (typeof window === 'undefined') return

  try {
    if (version) {
      window.localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version)
    } else {
      window.localStorage.removeItem(DISMISSED_UPDATE_VERSION_KEY)
    }
  } catch {
    // Ignore storage write failures.
  }
}

function getUpdateProxyUrl(settings: UpdateProxySettings = useSettingsStore.getState().updateProxy) {
  if (settings.mode !== 'manual') return null
  const proxy = settings.url.trim()
  return proxy || null
}

function getUpdateProxyKey(settings: UpdateProxySettings = useSettingsStore.getState().updateProxy) {
  const proxy = getUpdateProxyUrl(settings)
  return proxy ? `manual:${proxy}` : 'system'
}

function getUpdateCheckOptions() {
  const proxy = getUpdateProxyUrl()
  return proxy ? { proxy } : undefined
}

function getUpdateHost(): DesktopHost | null {
  const host = getDesktopHost()
  return host.capabilities.updates ? host : null
}

async function setPendingUpdate(next: DesktopUpdate | null, proxyKey: string | null) {
  const previous = pendingUpdate
  pendingUpdate = next
  pendingUpdateProxyKey = next ? proxyKey : null
  pendingUpdateDownloaded = false
  if (!downloadPromise) {
    downloadingProxyKey = null
  }

  if (previous && !next) {
    try {
      await previous.close()
    } catch {
      // Ignore stale resource cleanup failures.
    }
  }
}

function shouldPromptForVersion(version: string | null) {
  return !!version && readDismissedUpdateVersion() !== version
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function classifyUpdateError(error: unknown): UpdateErrorCode {
  const message = getErrorMessage(error).toLowerCase()
  if (message.includes('proxy')) return 'proxy'
  if (message.includes('metadata') || message.includes('latest-') || message.includes('channel')) return 'metadata'
  if (message.includes('download') || message.includes('checksum') || message.includes('sha')) return 'download'
  if (message.includes('install')) return 'install'
  if (message.includes('restart') || message.includes('relaunch')) return 'restart'
  if (message.includes('network') || message.includes('timeout') || message.includes('enotfound') || message.includes('econn')) return 'network'
  return 'unknown'
}

function canRunBackgroundCheck(checkedAt: number | null): boolean {
  return checkedAt === null || Date.now() - checkedAt >= UPDATE_CHECK_MIN_INTERVAL_MS
}

function isUpdateNewerThanCurrent(updateVersion: string, currentVersion: string | null): boolean {
  const update = valid(updateVersion)
  const current = currentVersion ? valid(currentVersion) : null
  if (!update || !current) return false
  return gt(update, current)
}

async function getCurrentAppVersion(host: DesktopHost) {
  try {
    return await host.app.getVersion()
  } catch {
    return null
  }
}

async function closeIgnoredUpdate(update: DesktopUpdate) {
  try {
    await update.close()
  } catch {
    // Best effort: a stale same-version update should not keep the prompt alive.
  }
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: 'idle',
  availableVersion: null,
  releaseNotes: null,
  progressPercent: 0,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  errorCode: null,
  checkedAt: null,
  shouldPrompt: false,

  initialize: async () => {
    if (!getUpdateHost()) return
    if (!startupCheckPromise) {
      startupCheckPromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        await get().checkForUpdates({ silent: true, background: true })
      })().finally(() => {
        startupCheckPromise = null
      })
    }

    if (!periodicCheckTimer && typeof window !== 'undefined') {
      periodicCheckTimer = setInterval(() => {
        if (!canRunBackgroundCheck(get().checkedAt)) return
        void get().checkForUpdates({ silent: true, background: true })
      }, UPDATE_CHECK_INTERVAL_MS)
    }
    if (!networkRecoveryListener && typeof window !== 'undefined') {
      networkRecoveryListener = () => {
        if (!canRunBackgroundCheck(get().checkedAt)) return
        void get().checkForUpdates({ silent: true, background: true })
      }
      window.addEventListener('online', networkRecoveryListener)
    }

    await startupCheckPromise
  },

  checkForUpdates: async ({ silent = false, autoDownload = true, background = false } = {}) => {
    const host = getUpdateHost()
    if (!host) return null
    const currentStatus = get().status
    if (downloadPromise && pendingUpdate && (currentStatus === 'downloading' || background)) return pendingUpdate
    if (background && pendingUpdate && (
      currentStatus === 'downloading'
      || currentStatus === 'downloaded'
      || currentStatus === 'installing'
      || currentStatus === 'restarting'
    )) return pendingUpdate
    clearRelaunchWatchdog()

    set((state) => ({
      ...state,
      status: 'checking',
      error: null,
      errorCode: null,
    }))

    try {
      const updateProxyKey = getUpdateProxyKey()
      const update = await host.updates.check(getUpdateCheckOptions())

      if (update && !isUpdateNewerThanCurrent(update.version, await getCurrentAppVersion(host))) {
        await closeIgnoredUpdate(update)
        await setPendingUpdate(null, null)

        const checkedAt = Date.now()
        writeDismissedUpdateVersion(null)
        set((state) => ({
          ...state,
          status: 'up-to-date',
          availableVersion: null,
          releaseNotes: null,
          progressPercent: 0,
          downloadedBytes: 0,
          totalBytes: null,
          checkedAt,
          error: null,
          errorCode: null,
          shouldPrompt: false,
        }))
        return null
      }

      await setPendingUpdate(update, updateProxyKey)

      const checkedAt = Date.now()

      if (!update) {
        writeDismissedUpdateVersion(null)
        set((state) => ({
          ...state,
          status: 'up-to-date',
          availableVersion: null,
          releaseNotes: null,
          progressPercent: 0,
          downloadedBytes: 0,
          totalBytes: null,
          checkedAt,
          error: null,
          errorCode: null,
          shouldPrompt: false,
        }))
        return null
      }

      const dismissedVersion = readDismissedUpdateVersion()
      const shouldOffer = dismissedVersion !== update.version

      set((state) => ({
        ...state,
        status: 'available',
        availableVersion: update.version,
        releaseNotes: update.body ?? null,
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: null,
        checkedAt,
        error: null,
        shouldPrompt: false,
      }))

      if (autoDownload && (shouldOffer || !silent)) {
        void get().downloadUpdate().catch(() => {
          // The store records the failure and keeps the manual install path retryable.
        })
      }
      return update
    } catch (error) {
      if (!silent) {
        set((state) => ({
          ...state,
          status: 'error',
          error: null,
          errorCode: classifyUpdateError(error),
          checkedAt: Date.now(),
        }))
      } else {
        set((state) => ({
          ...state,
          status: state.availableVersion ? 'available' : 'idle',
          error: null,
          errorCode: classifyUpdateError(error),
          checkedAt: Date.now(),
        }))
      }
      return null
    }
  },

  downloadUpdate: async () => {
    if (!getUpdateHost()) return
    clearRelaunchWatchdog()

    let update = pendingUpdate
    if (update && pendingUpdateProxyKey !== getUpdateProxyKey()) {
      await setPendingUpdate(null, null)
      update = null
    }
    if (!update) {
      update = await get().checkForUpdates({ autoDownload: false })
      if (!update) return
    }

    if (pendingUpdateDownloaded) {
      set((state) => ({
        ...state,
        status: 'downloaded',
        progressPercent: 100,
        shouldPrompt: shouldPromptForVersion(state.availableVersion),
      }))
      return
    }

    if (downloadPromise) {
      await downloadPromise
      return
    }

    set((state) => ({
      ...state,
      status: 'downloading',
      error: null,
      shouldPrompt: false,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
    }))

    const downloadingUpdate = update
    downloadingProxyKey = pendingUpdateProxyKey
    const activeDownload = (async () => {
      let totalBytes: number | null = null
      let downloadedBytes = 0

      await downloadingUpdate.download((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? null
          downloadedBytes = 0
          set((state) => ({
            ...state,
            totalBytes,
            downloadedBytes: 0,
            progressPercent: 0,
          }))
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength
          const progressPercent =
            totalBytes && totalBytes > 0
              ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100)
              : 0

          set((state) => ({
            ...state,
            downloadedBytes,
            totalBytes,
            progressPercent,
          }))
        } else if (event.event === 'Finished') {
          set((state) => ({
            ...state,
            progressPercent: 100,
          }))
        }
      })

      if (pendingUpdate !== downloadingUpdate) return
      if (getUpdateProxyKey() !== downloadingProxyKey) {
        await setPendingUpdate(null, null)
        set((state) => ({
          ...state,
          status: 'available',
          progressPercent: 0,
          shouldPrompt: false,
        }))
        return
      }

      pendingUpdateDownloaded = true
      set((state) => ({
        ...state,
        status: 'downloaded',
        error: null,
        shouldPrompt: shouldPromptForVersion(state.availableVersion),
        progressPercent: 100,
      }))
    })()
    downloadPromise = activeDownload

    try {
      await downloadPromise
    } catch (error) {
      if (pendingUpdate === downloadingUpdate) {
        set((state) => ({
          ...state,
          status: 'available',
          error: null,
          errorCode: 'download',
          shouldPrompt: false,
        }))
      }
      throw error
    } finally {
      if (downloadPromise === activeDownload) {
        downloadPromise = null
        downloadingProxyKey = null
      }
    }
  },

  installUpdate: async () => {
    const host = getUpdateHost()
    if (!host) return

    let update = pendingUpdate
    if (update && pendingUpdateProxyKey !== getUpdateProxyKey()) {
      await setPendingUpdate(null, null)
      update = null
    }
    if (!update) {
      update = await get().checkForUpdates({ autoDownload: false })
      if (!update) return
    }

    let prepareInstallAttempted = false
    try {
      writeDismissedUpdateVersion(null)
      if (!pendingUpdateDownloaded) {
        await get().downloadUpdate()
      }
      if (!pendingUpdateDownloaded) return

      set((state) => ({
        ...state,
        status: 'installing',
        error: null,
        shouldPrompt: false,
        progressPercent: 100,
      }))

      prepareInstallAttempted = true
      await host.updates.prepareInstall()
      await update.install()

      set((state) => ({
        ...state,
        status: 'restarting',
        progressPercent: 100,
      }))

      scheduleRelaunchWatchdog(host)
      await host.updates.relaunch()
    } catch (error) {
      clearRelaunchWatchdog()
      if (prepareInstallAttempted) {
        try {
          await host.updates.cancelInstall()
        } catch {
          // Best effort: keep the update prompt recoverable even if native reset fails.
        }
      }
      set((state) => ({
        ...state,
        status: pendingUpdateDownloaded ? 'downloaded' : 'available',
        error: null,
        errorCode: pendingUpdateDownloaded ? 'install' : classifyUpdateError(error),
        shouldPrompt: true,
      }))
    }
  },

  dismissPrompt: () => {
    writeDismissedUpdateVersion(get().availableVersion)
    set((state) => ({
      ...state,
      shouldPrompt: false,
    }))
  },
}))
