import type { DesktopUpdateDownloadEvent } from '../../src/lib/desktopHost/types'
import { existsSync } from 'node:fs'

export type ElectronUpdateInfo = {
  version: string
  body?: string | null
  releaseNotes?: string | Array<{ note?: string | null }> | null
}

export type ElectronUpdateCheckResult = {
  updateInfo?: ElectronUpdateInfo
} | null

export type ElectronUpdateCheckOptions = {
  proxy?: string
}

export type ElectronUpdaterLike = {
  autoDownload: boolean
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
}

export type ElectronUpdaterProxyController = {
  apply(proxy: string | null): Promise<void>
}

export type ElectronUpdaterRuntimeOptions = {
  updateConfigPath?: string
  feedUrl?: string | null
  feedUrls?: Array<string | null | undefined>
  currentVersion?: string
}

export function normalizeUpdateInfo(info: ElectronUpdateInfo | undefined): ElectronUpdateMetadata | null {
  if (!info?.version) return null
  const releaseNotes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map(note => note.note).filter(Boolean).join('\n\n')
    : info.releaseNotes
  return {
    version: info.version,
    body: info.body ?? releaseNotes ?? null,
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

function normalizeVersionForCompare(version: string): string {
  return version.trim().replace(/^v/i, '')
}

type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

function parseVersion(version: string): ParsedVersion | null {
  const match = normalizeVersionForCompare(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

function comparePrerelease(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1

  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber)
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart)
  }

  return 0
}

function compareVersions(left: string, right: string): number | null {
  const normalizedLeft = normalizeVersionForCompare(left)
  const normalizedRight = normalizeVersionForCompare(right)
  if (normalizedLeft === normalizedRight) return 0

  const parsedLeft = parseVersion(normalizedLeft)
  const parsedRight = parseVersion(normalizedRight)
  if (!parsedLeft || !parsedRight) return null

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (parsedLeft[key] !== parsedRight[key]) return Math.sign(parsedLeft[key] - parsedRight[key])
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
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

export class ElectronUpdaterService {
  private readonly updater: ElectronUpdaterLike
  private readonly proxyController?: ElectronUpdaterProxyController
  private readonly updateConfigPath?: string
  private readonly feedUrls: string[]
  private readonly currentVersion?: string
  private pendingUpdate: ElectronUpdateMetadata | null = null
  private downloaded = false
  private proxyKey: string | null = null
  private pendingUpdateFeedIndex = 0

  constructor(
    updater: ElectronUpdaterLike,
    proxyController?: ElectronUpdaterProxyController,
    runtimeOptions: ElectronUpdaterRuntimeOptions = {},
  ) {
    this.updater = updater
    this.proxyController = proxyController
    this.updateConfigPath = runtimeOptions.updateConfigPath
    this.feedUrls = normalizeFeedUrls(runtimeOptions)
    this.currentVersion = runtimeOptions.currentVersion?.trim() || undefined
    this.updater.autoDownload = false
    this.updater.logger = null

    this.setActiveFeed(0)
  }

  private setActiveFeed(index: number) {
    if (!this.feedUrls.length) return
    const feedUrl = this.feedUrls[index]
    if (!feedUrl) return
    if (!this.updater.setFeedURL) {
      throw new Error('Electron updater does not support custom update feed URLs')
    }
    this.updater.setFeedURL(feedUrl)
  }

  private async applyProxy(options?: ElectronUpdateCheckOptions) {
    if (!this.proxyController) return

    const proxy = options?.proxy?.trim() || null
    const nextProxyKey = proxy ? `manual:${proxy}` : 'system'
    if (this.proxyKey === nextProxyKey) return

    await this.proxyController.apply(proxy)
    this.proxyKey = nextProxyKey
  }

  private normalizeRealUpdate(result: ElectronUpdateCheckResult): ElectronUpdateMetadata | null {
    const update = normalizeUpdateInfo(result?.updateInfo)
    if (!update || !this.currentVersion) return update

    const comparison = compareVersions(update.version, this.currentVersion)
    if (comparison !== null && comparison <= 0) return null
    return update
  }

  private async checkForUpdatesOnActiveFeed(): Promise<ElectronUpdateMetadata | null> {
    try {
      if (this.updateConfigPath && !existsSync(this.updateConfigPath)) {
        return null
      }
      return this.normalizeRealUpdate(await this.updater.checkForUpdates())
    } catch (error) {
      if (!isMissingUpdateMetadataError(error)) throw error
      throw new MissingUpdateMetadataError()
    }
  }

  private async checkForUpdatesFromFeedIndex(feedIndex: number): Promise<ElectronUpdateMetadata | null> {
    this.setActiveFeed(feedIndex)
    return this.checkForUpdatesOnActiveFeed()
  }

  async checkForUpdates(options?: ElectronUpdateCheckOptions): Promise<ElectronUpdateMetadata | null> {
    await this.applyProxy(options)
    this.pendingUpdate = null
    this.downloaded = false

    const feedCount = Math.max(this.feedUrls.length, 1)
    for (let feedIndex = 0; feedIndex < feedCount; feedIndex += 1) {
      try {
        const update = await this.checkForUpdatesFromFeedIndex(feedIndex)
        if (update) {
          this.pendingUpdate = update
          this.pendingUpdateFeedIndex = feedIndex
        }
        return update
      } catch (error) {
        if (feedIndex >= feedCount - 1) {
          if (error instanceof MissingUpdateMetadataError) return null
          throw error
        }
      }
    }

    return null
  }

  private nextFallbackFeedIndex(fromIndex: number): number | null {
    const nextIndex = fromIndex + 1
    return nextIndex < this.feedUrls.length ? nextIndex : null
  }

  private async downloadUpdateOnce(emit: (event: DesktopUpdateDownloadEvent) => void): Promise<void> {
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
      await this.updater.downloadUpdate()
      if (!started) {
        emit({ event: 'Started', data: { contentLength: null } })
      }
      emit({ event: 'Finished' })
      this.downloaded = true
    } finally {
      this.updater.off('download-progress', onProgress)
    }
  }

  private async tryFallbackDownload(originalUpdate: ElectronUpdateMetadata, emit: (event: DesktopUpdateDownloadEvent) => void): Promise<boolean> {
    const fallbackFeedIndex = this.nextFallbackFeedIndex(this.pendingUpdateFeedIndex)
    if (fallbackFeedIndex === null) return false

    let fallbackUpdate: ElectronUpdateMetadata | null
    try {
      fallbackUpdate = await this.checkForUpdatesFromFeedIndex(fallbackFeedIndex)
    } catch {
      return false
    }
    if (!fallbackUpdate || fallbackUpdate.version !== originalUpdate.version) return false

    this.pendingUpdate = fallbackUpdate
    this.pendingUpdateFeedIndex = fallbackFeedIndex
    await this.downloadUpdateOnce(emit)
    return true
  }

  async downloadUpdate(emit: (event: DesktopUpdateDownloadEvent) => void): Promise<void> {
    if (!this.pendingUpdate) {
      throw new Error('No Electron update is available to download')
    }
    if (this.downloaded) {
      emit({ event: 'Finished' })
      return
    }

    const originalUpdate = this.pendingUpdate
    this.setActiveFeed(this.pendingUpdateFeedIndex)

    try {
      await this.downloadUpdateOnce(emit)
    } catch (error) {
      this.downloaded = false
      if (await this.tryFallbackDownload(originalUpdate, emit)) return
      throw error
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

  quitAndInstallDownloadedUpdate() {
    this.stageDownloadedUpdate()
    this.updater.quitAndInstall(false, true)
  }
}
