import type { DesktopUpdateDownloadEvent } from '../../src/lib/desktopHost/types'
import { existsSync } from 'node:fs'
import { clearAppManagedPortableEnv } from './appMode'

export type ElectronUpdateFileInfo = {
  url: string
  sha512?: string
  sha2?: string
  size?: number
}

export type ElectronUpdateInfo = {
  version: string
  body?: string | null
  releaseNotes?: string | Array<{ note?: string | null }> | null
  files?: ElectronUpdateFileInfo[]
  path?: string
  sha512?: string
  sha2?: string
}

export type ElectronUpdateCheckResult = {
  updateInfo?: ElectronUpdateInfo
} | null

export type ElectronUpdateCheckOptions = {
  proxy?: string
}

export type ElectronUpdaterLike = {
  autoDownload: boolean
  disableDifferentialDownload?: boolean
  logger?: unknown
  setFeedURL?(options: string): void
  checkForUpdates(): Promise<ElectronUpdateCheckResult>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', handler: (progress: { transferred?: number, total?: number }) => void): ElectronUpdaterLike
  off(event: 'download-progress', handler: (progress: { transferred?: number, total?: number }) => void): ElectronUpdaterLike
}

export type ElectronUpdateMetadata = {
  version: string
  body: string | null
  feedUrl?: string | null
  feedAttempts?: ElectronUpdateFeedAttempt[]
  files?: ElectronUpdateFileInfo[]
  path?: string
  sha512?: string
  sha2?: string
}

export type ElectronUpdateFeedAttempt = {
  feedUrl: string | null
  result: 'selected' | 'no-update' | 'missing-metadata' | 'mismatched-metadata' | 'error'
  error?: string
}

export type ElectronUpdaterProxyController = {
  apply(proxy: string | null): Promise<void>
}

export type ElectronUpdaterRuntimeOptions = {
  updateConfigPath?: string
  feedUrl?: string | null
  feedUrls?: Array<string | null | undefined>
  metadataFeedUrl?: string | null
  downloadFeedUrls?: Array<string | null | undefined>
}

export type UpdaterSessionProxyConfig = {
  mode?: 'system'
  proxyRules?: string
  proxyBypassRules?: string
}

// electron-updater performs all update traffic (metadata + downloads) on its
// own session partition, so proxy settings must target that session. Passing
// an empty config would mean fixed_servers with no rules (= direct), so the
// system fallback has to be an explicit `mode: 'system'`.
export function updaterSessionProxyConfig(proxy: string | null): UpdaterSessionProxyConfig {
  return proxy
    ? { proxyRules: proxy, proxyBypassRules: '<local>' }
    : { mode: 'system' }
}

export function normalizeUpdateInfo(info: ElectronUpdateInfo | undefined): ElectronUpdateMetadata | null {
  if (!info?.version) return null
  const releaseNotes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map(note => note.note).filter(Boolean).join('\n\n')
    : info.releaseNotes
  return {
    version: info.version,
    body: info.body ?? releaseNotes ?? null,
    ...(info.files ? { files: info.files } : {}),
    ...(info.path ? { path: info.path } : {}),
    ...(info.sha512 ? { sha512: info.sha512 } : {}),
    ...(info.sha2 ? { sha2: info.sha2 } : {}),
  }
}

function isMissingUpdateMetadataError(error: unknown): boolean {
  if (!error) return false
  const maybeError = typeof error === 'object'
    ? error as { code?: unknown, message?: unknown, path?: unknown }
    : {}
  const code = typeof maybeError.code === 'string' ? maybeError.code : ''
  const path = typeof maybeError.path === 'string' ? maybeError.path : ''
  const message = typeof maybeError.message === 'string' && maybeError.message
    ? maybeError.message
    : String(error)
  const referencesChannelMetadata = /latest(?:-[a-z0-9]+)?(?:-[a-z0-9]+)?\.ya?ml/i.test(message)
  if (code === 'ENOENT') {
    return path.endsWith('app-update.yml') || message.includes('app-update.yml')
  }
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    return referencesChannelMetadata
  }
  return referencesChannelMetadata && /cannot find|not found|404/i.test(message)
}

class MissingUpdateMetadataError extends Error {
  constructor() {
    super('Electron update channel metadata is missing')
    this.name = 'MissingUpdateMetadataError'
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatFeedAttempt(attempt: ElectronUpdateFeedAttempt): string {
  const feedUrl = attempt.feedUrl ?? 'default feed'
  return attempt.error
    ? `${attempt.result} ${feedUrl}: ${attempt.error}`
    : `${attempt.result} ${feedUrl}`
}

function withFeedAttemptErrorMessage(
  error: unknown,
  attempts: ElectronUpdateFeedAttempt[],
): Error {
  const message = getErrorMessage(error)
  if (!attempts.length) return error instanceof Error ? error : new Error(message)
  const diagnostics = attempts.map(formatFeedAttempt).join('; ')
  const nextError = new Error(`${message} (update feeds tried: ${diagnostics})`)
  if (error instanceof Error) {
    nextError.name = error.name
  }
  return nextError
}

function withFeedDiagnostics(
  update: ElectronUpdateMetadata,
  feedUrl: string,
  attempts: ElectronUpdateFeedAttempt[],
): ElectronUpdateMetadata {
  const selectedAttempt: ElectronUpdateFeedAttempt = { feedUrl, result: 'selected' }
  return {
    ...update,
    feedUrl,
    feedAttempts: [...attempts, selectedAttempt],
  }
}

function normalizeFeedUrls(runtimeOptions: ElectronUpdaterRuntimeOptions): string[] {
  const sourceUrls = runtimeOptions.feedUrls?.some(feedUrl => !!feedUrl?.trim())
    ? runtimeOptions.feedUrls
    : [runtimeOptions.feedUrl]
  const urls: string[] = []
  for (const rawUrl of sourceUrls ?? []) {
    const feedUrl = rawUrl?.trim()
    if (feedUrl && !urls.includes(feedUrl)) urls.push(feedUrl)
  }
  return urls
}

function updateMetadataFingerprint(update: ElectronUpdateMetadata | null): string | null {
  if (!update) return null

  const files = (update.files ?? []).map(file => ({
    name: file.url.split(/[?#]/, 1)[0]?.split('/').at(-1) ?? file.url,
    sha512: file.sha512 ?? null,
    sha2: file.sha2 ?? null,
    size: file.size ?? null,
  }))

  return JSON.stringify({
    version: update.version,
    files,
    path: update.path?.split(/[?#]/, 1)[0]?.split('/').at(-1) ?? null,
    sha512: update.sha512 ?? null,
    sha2: update.sha2 ?? null,
  })
}

export class ElectronUpdaterService {
  private readonly updater: ElectronUpdaterLike
  private readonly proxyController?: ElectronUpdaterProxyController
  private readonly updateConfigPath?: string
  private readonly metadataFeedUrl?: string
  private readonly downloadFeedUrls: string[]
  private pendingUpdate: ElectronUpdateMetadata | null = null
  private lastFeedAttempts: ElectronUpdateFeedAttempt[] = []
  private downloaded = false
  private proxyKey: string | null = null

  constructor(
    updater: ElectronUpdaterLike,
    proxyController?: ElectronUpdaterProxyController,
    runtimeOptions: ElectronUpdaterRuntimeOptions = {},
  ) {
    this.updater = updater
    this.proxyController = proxyController
    this.updateConfigPath = runtimeOptions.updateConfigPath
    this.metadataFeedUrl = runtimeOptions.metadataFeedUrl?.trim() || undefined
    this.downloadFeedUrls = normalizeFeedUrls({
      feedUrls: runtimeOptions.downloadFeedUrls ?? runtimeOptions.feedUrls,
      feedUrl: runtimeOptions.feedUrl,
    })
    this.updater.autoDownload = false
    // Differential download issues many small sequential range requests and is
    // RTT-bound against the GitHub CDN, so it downloads far below line speed.
    this.updater.disableDifferentialDownload = true
    this.updater.logger = null
  }

  private async applyProxy(options?: ElectronUpdateCheckOptions) {
    if (!this.proxyController) return

    const proxy = options?.proxy?.trim() || null
    const nextProxyKey = proxy ? `manual:${proxy}` : 'system'
    if (this.proxyKey === nextProxyKey) return

    await this.proxyController.apply(proxy)
    this.proxyKey = nextProxyKey
  }

  private setFeedUrl(feedUrl: string) {
    if (!this.updater.setFeedURL) {
      throw new Error('Electron updater does not support custom update feed URLs')
    }
    this.updater.setFeedURL(feedUrl)
  }

  private async checkForUpdatesOnCurrentFeed(): Promise<ElectronUpdateMetadata | null> {
    try {
      if (this.updateConfigPath && !existsSync(this.updateConfigPath)) {
        return null
      }
      return normalizeUpdateInfo((await this.updater.checkForUpdates())?.updateInfo)
    } catch (error) {
      if (!isMissingUpdateMetadataError(error)) throw error
      throw new MissingUpdateMetadataError()
    }
  }

  async checkForUpdates(options?: ElectronUpdateCheckOptions): Promise<ElectronUpdateMetadata | null> {
    await this.applyProxy(options)
    this.pendingUpdate = null
    this.lastFeedAttempts = []
    this.downloaded = false

    const metadataFeedUrl = this.metadataFeedUrl ?? this.downloadFeedUrls[0] ?? null

    try {
      if (metadataFeedUrl) this.setFeedUrl(metadataFeedUrl)
      const update = await this.checkForUpdatesOnCurrentFeed()
      if (!update) {
        this.lastFeedAttempts = [{ feedUrl: metadataFeedUrl, result: 'no-update' }]
        return null
      }
      const updateWithDiagnostics = withFeedDiagnostics(update, metadataFeedUrl ?? 'default feed', [])
      this.pendingUpdate = updateWithDiagnostics
      this.lastFeedAttempts = updateWithDiagnostics.feedAttempts ?? []
      return updateWithDiagnostics
    } catch (error) {
      this.lastFeedAttempts = [{
        feedUrl: metadataFeedUrl,
        result: error instanceof MissingUpdateMetadataError ? 'missing-metadata' : 'error',
        error: getErrorMessage(error),
      }]
      if (error instanceof MissingUpdateMetadataError) return null
      throw withFeedAttemptErrorMessage(error, this.lastFeedAttempts)
    }
  }

  getLastFeedAttempts(): ElectronUpdateFeedAttempt[] {
    return [...this.lastFeedAttempts]
  }

  async downloadUpdate(emit: (event: DesktopUpdateDownloadEvent) => void): Promise<void> {
    if (!this.pendingUpdate) {
      await this.checkForUpdates()
      if (!this.pendingUpdate) {
        throw new Error('No Electron update is available to download')
      }
    }
    if (this.downloaded) {
      emit({ event: 'Finished' })
      return
    }

    let lastTransferred = 0
    let started = false
    const onProgress = (progress: { transferred?: number, total?: number }) => {
      const transferred = Math.max(0, progress.transferred ?? 0)
      if (!started) {
        started = true
        emit({ event: 'Started', data: { contentLength: progress.total ?? null } })
      }
      const chunkLength = Math.max(0, transferred - lastTransferred)
      lastTransferred = transferred
      if (chunkLength > 0) {
        emit({ event: 'Progress', data: { chunkLength } })
      }
    }

    this.updater.on('download-progress', onProgress)
    try {
      const update = this.pendingUpdate
      if (!update) throw new Error('No Electron update is available to download')
      let lastError: unknown = null
      const downloadFeedUrls: Array<string | null> = this.downloadFeedUrls.length > 0
        ? this.downloadFeedUrls
        : [null]

      for (const feedUrl of downloadFeedUrls) {
        try {
          if (feedUrl) {
            this.setFeedUrl(feedUrl)
            const candidate = await this.checkForUpdatesOnCurrentFeed()
            if (!candidate) {
              this.lastFeedAttempts = [...this.lastFeedAttempts, { feedUrl, result: 'no-update' }]
              continue
            }
            if (updateMetadataFingerprint(candidate) !== updateMetadataFingerprint(update)) {
              this.lastFeedAttempts = [...this.lastFeedAttempts, { feedUrl, result: 'mismatched-metadata' }]
              continue
            }
          }
          await this.updater.downloadUpdate()
          if (!started) {
            emit({ event: 'Started', data: { contentLength: null } })
          }
          emit({ event: 'Finished' })
          this.downloaded = true
          return
        } catch (error) {
          lastError = error
          this.lastFeedAttempts = [...this.lastFeedAttempts, {
            feedUrl,
            result: error instanceof MissingUpdateMetadataError ? 'missing-metadata' : 'error',
            error: getErrorMessage(error),
          }]
        }
      }

      throw withFeedAttemptErrorMessage(lastError ?? new Error('Update download failed'), this.lastFeedAttempts)
    } finally {
      this.updater.off('download-progress', onProgress)
    }
  }

  cancelInstall() {
    this.pendingUpdate = null
    this.downloaded = false
  }

  stageDownloadedUpdate() {
    if (!this.pendingUpdate) {
      throw new Error('No Electron update is ready to install')
    }
    if (!this.downloaded) {
      throw new Error('Electron update has not finished downloading')
    }
  }

  hasDownloadedUpdate(): boolean {
    return !!this.pendingUpdate && this.downloaded
  }

  quitAndInstallDownloadedUpdate(env: NodeJS.ProcessEnv = process.env) {
    this.stageDownloadedUpdate()
    // The NSIS installer spawned here inherits this process's environment.
    // Hand it the same clean environment a manually launched setup gets, so
    // its legacy-data checks read the persisted app-mode.json instead of a
    // process-local snapshot that may disagree with it (#1160).
    clearAppManagedPortableEnv(env)
    this.updater.quitAndInstall(false, true)
  }
}
