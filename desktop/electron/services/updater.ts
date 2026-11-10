import type { DesktopUpdateDownloadEvent } from '../../src/lib/desktopHost/types'
import { existsSync } from 'node:fs'
import { clearAppManagedPortableEnv } from './appMode'
import { isVerifiedDifferentialDownloadFeed, type UpdateFeedConfig } from './updateFeed'

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
  isUpdateAvailable?: boolean
  updateInfo?: ElectronUpdateInfo
} | null

export type ElectronUpdateCheckOptions = {
  proxy?: string
}

export type ElectronUpdaterLike = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableDifferentialDownload?: boolean
  logger?: unknown
  setFeedURL?(options: string | { provider: 'generic', url: string, useMultipleRangeRequest: false }): void
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
  feedUrl?: string
  feedUrls?: string[]
  metadataFeedUrl?: string
  metadataFallbackUrls?: string[]
  downloadFeedUrls?: string[]
  differentialDownload?: boolean
  differentialDownloadFeedUrls?: string[]
  differentialDownloadContracts?: UpdateFeedConfig['differentialDownloadContracts']
  differentialDownloadContract?: UpdateFeedConfig['differentialDownloadContracts'][string]
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function formatFeedAttempt(attempt: ElectronUpdateFeedAttempt): string {
  const feedLabel = attempt.feedUrl ?? 'default feed'
  const error = attempt.error ? ` (${attempt.error})` : ''
  return `${feedLabel}: ${attempt.result}${error}`
}

function withFeedAttemptErrorMessage(error: unknown, attempts: ElectronUpdateFeedAttempt[]): Error {
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

function dedupeFeedUrls(urls: Array<string | undefined | null>): string[] {
  const result: string[] = []
  for (const raw of urls) {
    const feedUrl = raw?.trim()
    if (feedUrl && !result.includes(feedUrl)) result.push(feedUrl)
  }
  return result
}

// Compares the release identity advertised by a metadata feed with the bytes a
// download feed is about to serve. Version, file names, hashes, and sizes must
// all agree so a mixed/partial artifact from two different sources is refused.
function updateMetadataFingerprint(update: ElectronUpdateMetadata | null): string | null {
  if (!update) return null
  const validHash = (sha512?: string, sha2?: string) =>
    (typeof sha512 === 'string' && (/^[a-f\d]{128}$/i.test(sha512) || /^[A-Za-z0-9+/]{85}[AQgw]==$/.test(sha512)))
    || (typeof sha2 === 'string' && /^[a-f\d]{64}$/i.test(sha2))
  const fileName = (url: unknown) => typeof url === 'string' ? url.split(/[?#]/, 1)[0]?.split('/').at(-1)?.trim() : ''
  const entries = update.files?.length ? update.files : [{ url: update.path, sha512: update.sha512, sha2: update.sha2 }]
  if (entries.some(file => !fileName(file.url) || !validHash(file.sha512, file.sha2))) return null
  const files = (update.files ?? []).map(file => ({
    name: fileName(file.url),
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
  private readonly metadataFallbackUrls: string[]
  private readonly downloadFeedUrls: string[]
  private readonly hasConfiguredFeeds: boolean
  private readonly differentialDownload: boolean
  private readonly differentialFeedConfig: Pick<UpdateFeedConfig, 'differentialDownloadFeedUrls' | 'differentialDownloadContracts'>
  private pendingUpdate: ElectronUpdateMetadata | null = null
  private lastFeedAttempts: ElectronUpdateFeedAttempt[] = []
  private downloaded = false
  private installRequested = false
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
    this.metadataFallbackUrls = dedupeFeedUrls(runtimeOptions.metadataFallbackUrls ?? [])
    this.downloadFeedUrls = dedupeFeedUrls(
      runtimeOptions.downloadFeedUrls ?? runtimeOptions.feedUrls ?? (runtimeOptions.feedUrl ? [runtimeOptions.feedUrl] : []),
    )
    this.hasConfiguredFeeds = !!(this.metadataFeedUrl
      || this.metadataFallbackUrls.length
      || this.downloadFeedUrls.length)
    this.updater.autoDownload = false
    // Background downloads must stay pending after "Later", normal quits,
    // and app-mode restarts. On macOS this also keeps the ZIP out of Squirrel
    // until the user explicitly requests quitAndInstall.
    this.updater.autoInstallOnAppQuit = false
    // Differential downloads are only enabled when the caller explicitly asks
    // for them AND the download feed carries a verified range contract.
    const differentialFeedUrls = runtimeOptions.differentialDownloadFeedUrls ?? []
    const differentialDownloadContracts = runtimeOptions.differentialDownloadContracts ?? {}
    this.differentialDownload = runtimeOptions.differentialDownload === true
    this.differentialFeedConfig = { differentialDownloadFeedUrls: differentialFeedUrls, differentialDownloadContracts }
    const verifiedFeed = this.downloadFeedUrls.find(feedUrl =>
      differentialFeedUrls.includes(feedUrl)
      && isVerifiedDifferentialDownloadFeed(feedUrl, {
        differentialDownloadFeedUrls: differentialFeedUrls,
        differentialDownloadContracts,
      }),
    )
    this.updater.disableDifferentialDownload = !(
      runtimeOptions.differentialDownload === true && !!verifiedFeed
    )
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

  private setFeedUrl(feedUrl?: string) {
    if (!feedUrl) return
    const setFeedURL = this.updater.setFeedURL
    if (!setFeedURL) {
      throw new Error('Configured updater does not support switching update feeds')
    }
    setFeedURL.call(this.updater, this.updater.disableDifferentialDownload === false
      ? { provider: 'generic', url: feedUrl, useMultipleRangeRequest: false }
      : feedUrl)
  }

  private async checkForUpdatesOnCurrentFeed(): Promise<ElectronUpdateMetadata | null> {
    if (this.updateConfigPath && !existsSync(this.updateConfigPath)) return null
    const result = await this.updater.checkForUpdates()
    if (result?.isUpdateAvailable === false) return null
    return normalizeUpdateInfo(result?.updateInfo)
  }

  getLastFeedAttempts(): ElectronUpdateFeedAttempt[] {
    return [...this.lastFeedAttempts]
  }

  async checkForUpdates(options?: ElectronUpdateCheckOptions): Promise<ElectronUpdateMetadata | null> {
    this.installRequested = false

    // Without an explicit feed configuration, behave as a single-source
    // updater: no feed switching, no diagnostics fields on the result. This
    // keeps the packaged app-update.yml guard and the clean metadata contract.
    if (!this.hasConfiguredFeeds) {
      let result: ElectronUpdateCheckResult
      try {
        await this.applyProxy(options)
        if (this.updateConfigPath && !existsSync(this.updateConfigPath)) {
          result = null
        } else {
          result = await this.updater.checkForUpdates()
        }
      } catch (error) {
        if (!isMissingUpdateMetadataError(error)) throw error
        result = null
      }
      this.pendingUpdate = result?.isUpdateAvailable === false ? null : normalizeUpdateInfo(result?.updateInfo)
      this.downloaded = false
      this.lastFeedAttempts = []
      return this.pendingUpdate
    }

    await this.applyProxy(options)

    const primaryFeedUrl = this.metadataFeedUrl ?? this.downloadFeedUrls[0] ?? null
    const feedChain: Array<string | null> = [primaryFeedUrl]
    for (const fallback of this.metadataFallbackUrls) {
      if (!fallback || fallback === primaryFeedUrl || feedChain.includes(fallback)) continue
      feedChain.push(fallback)
    }

    const attempts: ElectronUpdateFeedAttempt[] = []
    let firstError: unknown = null
    for (const feedUrl of feedChain) {
      try {
        if (feedUrl) this.setFeedUrl(feedUrl)
        const update = await this.checkForUpdatesOnCurrentFeed()
        if (!update?.version) {
          attempts.push({ feedUrl, result: 'no-update' })
          continue
        }
        const metadata = withFeedDiagnostics(update, feedUrl ?? 'default feed', attempts)
        this.lastFeedAttempts = metadata.feedAttempts ?? []
        this.pendingUpdate = metadata
        this.downloaded = false
        return metadata
      } catch (error) {
        const missing = isMissingUpdateMetadataError(error)
        attempts.push({
          feedUrl,
          result: missing ? 'missing-metadata' : 'error',
          error: getErrorMessage(error),
        })
        if (!missing && firstError === null) firstError = error
      }
    }

    this.lastFeedAttempts = attempts
    this.pendingUpdate = null
    this.downloaded = false
    if (firstError !== null) {
      throw withFeedAttemptErrorMessage(firstError, attempts)
    }
    return null
  }

  async downloadUpdate(emit: (event: DesktopUpdateDownloadEvent) => void): Promise<void> {
    if (!this.pendingUpdate) {
      throw new Error('No Electron update is available to download')
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
      // Single-source download: keep the plain progress/finished contract.
      if (this.downloadFeedUrls.length === 0) {
        await this.updater.downloadUpdate()
        if (!started) {
          emit({ event: 'Started', data: { contentLength: null } })
        }
        emit({ event: 'Finished' })
        this.downloaded = true
        return
      }

      // Multi-source download: each feed must serve metadata whose release
      // fingerprint matches the one selected during the metadata check.
      const expectedFingerprint = updateMetadataFingerprint(this.pendingUpdate)
      const attempts = this.lastFeedAttempts
      let lastError: unknown = null
      for (const feedUrl of this.downloadFeedUrls) {
        try {
          this.updater.disableDifferentialDownload = !(this.differentialDownload
            && isVerifiedDifferentialDownloadFeed(feedUrl, this.differentialFeedConfig))
          this.setFeedUrl(feedUrl)
          const candidate = await this.checkForUpdatesOnCurrentFeed()
          if (!candidate) {
            attempts.push({ feedUrl, result: 'no-update' })
            continue
          }
          if (!expectedFingerprint || updateMetadataFingerprint(candidate) !== expectedFingerprint) {
            attempts.push({ feedUrl, result: 'mismatched-metadata' })
            continue
          }
          await this.updater.downloadUpdate()
          if (!started) {
            emit({ event: 'Started', data: { contentLength: null } })
          }
          emit({ event: 'Finished' })
          this.downloaded = true
          this.lastFeedAttempts = attempts
          return
        } catch (error) {
          lastError = error
          attempts.push({
            feedUrl,
            result: isMissingUpdateMetadataError(error) ? 'missing-metadata' : 'error',
            error: getErrorMessage(error),
          })
        }
      }
      this.lastFeedAttempts = attempts
      throw withFeedAttemptErrorMessage(lastError ?? new Error('Update download failed'), attempts)
    } finally {
      this.updater.off('download-progress', onProgress)
    }
  }

  cancelInstall() {
    // The renderer retains the downloaded update on an install/relaunch
    // failure. Revoke the install request, but keep the download retryable.
    this.installRequested = false
  }

  stageDownloadedUpdate() {
    if (!this.pendingUpdate) {
      throw new Error('No Electron update is ready to install')
    }
    if (!this.downloaded) {
      throw new Error('Electron update has not finished downloading')
    }
    this.installRequested = true
  }

  hasDownloadedUpdate(): boolean {
    return !!this.pendingUpdate && this.downloaded
  }

  hasStagedUpdate(): boolean {
    return this.hasDownloadedUpdate() && this.installRequested
  }

  quitAndInstallDownloadedUpdate(env: NodeJS.ProcessEnv = process.env) {
    if (!this.hasStagedUpdate()) {
      throw new Error('Electron update installation has not been requested')
    }
    clearAppManagedPortableEnv(env)
    this.updater.quitAndInstall(false, true)
  }
}
