import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { ElectronUpdaterService, normalizeUpdateInfo, updaterSessionProxyConfig, type ElectronUpdaterLike } from './updater'
import { DIRECT_GITHUB_RELEASE_FEED_URL, resolveUpdateFeedConfig } from './updateFeed'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeUpdater(): ElectronUpdaterLike & {
  emitProgress(progress: { transferred?: number, total?: number }): void
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
  setFeedURL: ReturnType<typeof vi.fn>
} {
  let progressHandler: ((progress: { transferred?: number, total?: number }) => void) | null = null
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    on: vi.fn((_event, handler) => {
      progressHandler = handler
      return updater
    }),
    off: vi.fn((_event, handler) => {
      if (progressHandler === handler) progressHandler = null
      return updater
    }),
    emitProgress(progress) {
      progressHandler?.(progress)
    },
  } as ElectronUpdaterLike & {
    emitProgress(progress: { transferred?: number, total?: number }): void
    checkForUpdates: ReturnType<typeof vi.fn>
    downloadUpdate: ReturnType<typeof vi.fn>
    quitAndInstall: ReturnType<typeof vi.fn>
    setFeedURL: ReturnType<typeof vi.fn>
  }
  return updater
}

const updater = fakeUpdater()

describe('Electron updater service', () => {
  it('normalizes update metadata from electron-updater', () => {
    expect(normalizeUpdateInfo({ version: '1.2.3', releaseNotes: 'Notes' })).toEqual({
      version: '1.2.3',
      body: 'Notes',
    })
    expect(normalizeUpdateInfo({ version: '1.2.4', releaseNotes: [{ note: 'One' }, { note: 'Two' }] })).toEqual({
      version: '1.2.4',
      body: 'One\n\nTwo',
    })
    expect(normalizeUpdateInfo(undefined)).toBeNull()
  })

  it('keeps electron-updater autoDownload disabled and emits store-compatible progress', async () => {
    updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.3', body: 'Fixes' } })
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emitProgress({ transferred: 40, total: 100 })
      updater.emitProgress({ transferred: 100, total: 100 })
    })
    const service = new ElectronUpdaterService(updater)
    const events: unknown[] = []

    await expect(service.checkForUpdates()).resolves.toEqual({ version: '1.2.3', body: 'Fixes' })
    await service.downloadUpdate(event => events.push(event))

    expect(updater.autoDownload).toBe(false)
    expect(updater.logger).toBeNull()
    expect(events).toEqual([
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 40 } },
      { event: 'Progress', data: { chunkLength: 60 } },
      { event: 'Finished' },
    ])
  })

  it('treats missing unpacked app update metadata as no update', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockRejectedValueOnce(Object.assign(new Error("ENOENT: no such file or directory, open '/App/Contents/Resources/app-update.yml'"), {
      code: 'ENOENT',
      path: '/App/Contents/Resources/app-update.yml',
    }))

    await expect(service.checkForUpdates()).resolves.toBeNull()
  })

  it('skips electron-updater when packaged update config is absent', async () => {
    const localUpdater = fakeUpdater()
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-haha-updater-'))
    try {
      const service = new ElectronUpdaterService(localUpdater, undefined, {
        updateConfigPath: join(tempDir, 'app-update.yml'),
      })

      await expect(service.checkForUpdates()).resolves.toBeNull()

      expect(localUpdater.checkForUpdates).not.toHaveBeenCalled()
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('treats missing GitHub channel metadata as no update', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockRejectedValueOnce(Object.assign(
      new Error('Cannot find latest-mac.yml in the latest release artifacts (https://github.com/NanmiCoder/cc-haha/releases/download/v0.3.2/latest-mac.yml): HttpError: 404'),
      { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' },
    ))

    await expect(service.checkForUpdates()).resolves.toBeNull()
  })

  it('treats missing GitHub channel metadata as no update even without an error code', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockRejectedValueOnce(
      new Error('Cannot find latest-mac.yml in the latest release artifacts (https://github.com/NanmiCoder/cc-haha/releases/download/v0.3.2/latest-mac.yml): HttpError: 404'),
    )

    await expect(service.checkForUpdates()).resolves.toBeNull()
  })

  it('treats stringified missing GitHub channel metadata as no update', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockRejectedValueOnce(
      'Error: Cannot find latest-mac.yml in the latest release artifacts (https://github.com/NanmiCoder/cc-haha/releases/download/v0.3.2/latest-mac.yml): HttpError: 404',
    )

    await expect(service.checkForUpdates()).resolves.toBeNull()
  })

  it('applies manual updater proxy before checking and clears it when returning to system proxy', async () => {
    const localUpdater = fakeUpdater()
    const proxyController = {
      apply: vi.fn().mockResolvedValue(undefined),
    }
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.5' } })
    const service = new ElectronUpdaterService(localUpdater, proxyController)

    await service.checkForUpdates({ proxy: 'http://127.0.0.1:7890' })
    await service.checkForUpdates({ proxy: 'http://127.0.0.1:7890' })
    await service.checkForUpdates()

    expect(proxyController.apply).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:7890')
    expect(proxyController.apply).toHaveBeenNthCalledWith(2, null)
    expect(proxyController.apply).toHaveBeenCalledTimes(2)
    expect(localUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('disables differential downloads by default', () => {
    const localUpdater = fakeUpdater()

    void new ElectronUpdaterService(localUpdater)

    expect(localUpdater.disableDifferentialDownload).toBe(true)
  })

  it('enables differential downloads for the verified direct release feed', () => {
    const feedConfig = resolveUpdateFeedConfig({})
    const localUpdater = fakeUpdater()

    void new ElectronUpdaterService(localUpdater, undefined, {
      downloadFeedUrls: [DIRECT_GITHUB_RELEASE_FEED_URL],
      differentialDownload: true,
      differentialDownloadFeedUrls: feedConfig.differentialDownloadFeedUrls,
      differentialDownloadContracts: feedConfig.differentialDownloadContracts,
    })

    expect(localUpdater.disableDifferentialDownload).toBe(false)
  })

  it('uses single-range provider objects through metadata and download feed switching', async () => {
    const feedConfig = resolveUpdateFeedConfig({})
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '2.0.0', path: 'app.zip', sha2: 'a'.repeat(64) } })
    localUpdater.downloadUpdate.mockResolvedValue([])
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: feedConfig.metadataUrl,
      downloadFeedUrls: [DIRECT_GITHUB_RELEASE_FEED_URL],
      differentialDownload: true,
      differentialDownloadFeedUrls: feedConfig.differentialDownloadFeedUrls,
      differentialDownloadContracts: feedConfig.differentialDownloadContracts,
    })
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})
    expect(localUpdater.setFeedURL.mock.calls).toEqual([
      [{ provider: 'generic', url: feedConfig.metadataUrl, useMultipleRangeRequest: false }],
      [{ provider: 'generic', url: DIRECT_GITHUB_RELEASE_FEED_URL, useMultipleRangeRequest: false }],
    ])
  })

  it('keeps differential downloads disabled for an unverified feed', () => {
    const feedConfig = resolveUpdateFeedConfig({})
    const localUpdater = fakeUpdater()

    void new ElectronUpdaterService(localUpdater, undefined, {
      downloadFeedUrls: ['https://mirror.example.com/update/'],
      differentialDownload: true,
      differentialDownloadFeedUrls: feedConfig.differentialDownloadFeedUrls,
      differentialDownloadContracts: feedConfig.differentialDownloadContracts,
    })

    expect(localUpdater.disableDifferentialDownload).toBe(true)
  })

  it('only enables differential downloads for each verified download feed', async () => {
    const feedConfig = resolveUpdateFeedConfig({})
    const localUpdater = fakeUpdater()
    const states: Array<boolean | undefined> = []
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '2.0.0', path: 'app.zip', sha2: 'a'.repeat(64) } })
    localUpdater.downloadUpdate.mockImplementation(async () => {
      states.push(localUpdater.disableDifferentialDownload)
      if (states.length === 1) throw new Error('mirror unavailable')
    })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: feedConfig.metadataUrl,
      downloadFeedUrls: ['https://mirror.example.com/update/', DIRECT_GITHUB_RELEASE_FEED_URL],
      differentialDownload: true,
      differentialDownloadFeedUrls: feedConfig.differentialDownloadFeedUrls,
      differentialDownloadContracts: feedConfig.differentialDownloadContracts,
    })
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})
    expect(states).toEqual([true, false])
  })

  it('maps proxy settings to the updater net session proxy config', () => {
    expect(updaterSessionProxyConfig(null)).toEqual({ mode: 'system' })
    expect(updaterSessionProxyConfig('http://127.0.0.1:7890')).toEqual({
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<local>',
    })
  })

  it('does not hide non-metadata updater failures', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockRejectedValueOnce(new Error('feed unavailable'))

    await expect(service.checkForUpdates()).rejects.toThrow('feed unavailable')
  })

  it('does not offer metadata that electron-updater marks unavailable', async () => {
    const localUpdater = fakeUpdater()
    // A release can be newer but unavailable due to its minimum OS version
    // or staged rollout. electron-updater still returns its metadata.
    localUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '9.9.9', body: 'Not eligible for this installation' },
    })
    const service = new ElectronUpdaterService(localUpdater)

    await expect(service.checkForUpdates()).resolves.toBeNull()
    await expect(service.downloadUpdate(() => {})).rejects.toThrow('No Electron update')
    expect(localUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('offers metadata that electron-updater explicitly marks available', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '1.2.4', body: 'Eligible update' },
    })
    const service = new ElectronUpdaterService(localUpdater)

    await expect(service.checkForUpdates()).resolves.toEqual({ version: '1.2.4', body: 'Eligible update' })
    await service.downloadUpdate(() => {})
    expect(localUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('stages then installs through quitAndInstall only after an update has downloaded', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.4' } })
    updater.downloadUpdate.mockResolvedValue(undefined)

    expect(() => service.stageDownloadedUpdate()).toThrow('No Electron update is ready')
    await service.checkForUpdates()
    expect(() => service.stageDownloadedUpdate()).toThrow('has not finished downloading')
    await service.downloadUpdate(() => {})
    service.stageDownloadedUpdate()
    service.quitAndInstallDownloadedUpdate()

    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('keeps ordinary quits and cached-download restarts from installing an update', async () => {
    const install = vi.fn()
    const cache = { downloaded: false }
    for (let restart = 0; restart < 3; restart += 1) {
      const app = new EventEmitter()
      const localUpdater = fakeUpdater()
      localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.4' } })
      localUpdater.downloadUpdate.mockImplementation(async () => {
        cache.downloaded = true
        // BaseUpdater registers this after either a fresh or cached download.
        app.once('quit', () => {
          if (localUpdater.autoInstallOnAppQuit && cache.downloaded) install()
        })
      })
      const service = new ElectronUpdaterService(localUpdater)
      await service.checkForUpdates()
      await service.downloadUpdate(() => {})
      app.emit('quit')
    }

    expect(cache.downloaded).toBe(true)
    expect(install).not.toHaveBeenCalled()
  })

  it('requires an explicit install request before the downloaded update may restart into installation', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.4' } })
    localUpdater.downloadUpdate.mockResolvedValue(undefined)
    const service = new ElectronUpdaterService(localUpdater)
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})

    expect(service.hasStagedUpdate()).toBe(false)
    expect(() => service.quitAndInstallDownloadedUpdate({})).toThrow('has not been requested')
    expect(localUpdater.quitAndInstall).not.toHaveBeenCalled()

    service.stageDownloadedUpdate()
    expect(service.hasStagedUpdate()).toBe(true)
    service.quitAndInstallDownloadedUpdate({})

    expect(localUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(localUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(localUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('disarms canceled installs while keeping the download available for an explicit retry', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.4' } })
    localUpdater.downloadUpdate.mockResolvedValue(undefined)
    const service = new ElectronUpdaterService(localUpdater)
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})
    service.stageDownloadedUpdate()
    service.cancelInstall()

    expect(service.hasDownloadedUpdate()).toBe(true)
    expect(service.hasStagedUpdate()).toBe(false)
    expect(() => service.quitAndInstallDownloadedUpdate({})).toThrow('has not been requested')

    await service.downloadUpdate(() => {})
    service.stageDownloadedUpdate()
    service.quitAndInstallDownloadedUpdate({})

    expect(localUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(localUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not carry install consent over to a newly checked version', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockResolvedValueOnce({ updateInfo: { version: '1.2.4' } })
      .mockResolvedValueOnce({ updateInfo: { version: '1.2.5' } })
    localUpdater.downloadUpdate.mockResolvedValue(undefined)
    const service = new ElectronUpdaterService(localUpdater)
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})
    service.stageDownloadedUpdate()
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})

    expect(service.hasStagedUpdate()).toBe(false)
    expect(() => service.quitAndInstallDownloadedUpdate({})).toThrow('has not been requested')
    expect(localUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('hands the spawned installer an environment without the app-managed portable selection', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.4' } })
    updater.downloadUpdate.mockResolvedValue(undefined)
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})
    service.stageDownloadedUpdate()

    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: 'E:\\cc-haha-data',
      CC_HAHA_APP_PORTABLE_DIR: '1',
      WEBVIEW2_USER_DATA_FOLDER: 'E:\\cc-haha-data\\EBWebView',
      APPDATA: 'C:\\Users\\someone\\AppData\\Roaming',
    }
    service.quitAndInstallDownloadedUpdate(env)

    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(env).toEqual({ APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' })
  })

  it('leaves an externally supplied CLAUDE_CONFIG_DIR untouched when installing', async () => {
    const service = new ElectronUpdaterService(updater)
    updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.4' } })
    updater.downloadUpdate.mockResolvedValue(undefined)
    await service.checkForUpdates()
    await service.downloadUpdate(() => {})
    service.stageDownloadedUpdate()

    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: 'E:\\external-data' }
    service.quitAndInstallDownloadedUpdate(env)

    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: 'E:\\external-data' })
  })
})

const METADATA_FEED = 'https://code.echoflow.cn/update/'
const FALLBACK_FEED = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/'

function channelMetadataMissing(feedUrl: string): Error {
  return Object.assign(
    new Error(`Cannot find latest-mac.yml in the latest release artifacts (${feedUrl}latest-mac.yml): HttpError: 404`),
    { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' },
  )
}

// Regression coverage for the metadata/download multi-source fallback,
// cross-source fingerprint consistency, and feed-attempt diagnostics.
describe('Electron updater metadata fallback chain', () => {
  it('falls back to the GitHub metadata feed when the own-domain mirror is missing', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockRejectedValueOnce(channelMetadataMissing(METADATA_FEED))
      .mockResolvedValueOnce({ updateInfo: { version: '2.0.0', body: 'Notes' } })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    const update = await service.checkForUpdates()

    expect(update).toMatchObject({ version: '2.0.0', feedUrl: FALLBACK_FEED })
    expect(localUpdater.setFeedURL.mock.calls).toEqual([[METADATA_FEED], [FALLBACK_FEED]])
    expect(service.getLastFeedAttempts()).toEqual([
      { feedUrl: METADATA_FEED, result: 'missing-metadata', error: expect.any(String) },
      { feedUrl: FALLBACK_FEED, result: 'selected' },
    ])
  })

  it('falls back after a plain network error on the primary feed instead of swallowing the check', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockRejectedValueOnce(new Error('feed unavailable'))
      .mockResolvedValueOnce({ updateInfo: { version: '2.0.0' } })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    await expect(service.checkForUpdates()).resolves.toMatchObject({ version: '2.0.0', feedUrl: FALLBACK_FEED })
    expect(service.getLastFeedAttempts()).toEqual([
      { feedUrl: METADATA_FEED, result: 'error', error: 'feed unavailable' },
      { feedUrl: FALLBACK_FEED, result: 'selected' },
    ])
  })

  it('queries the fallback feed when the primary feed reports no update', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ updateInfo: { version: '2.0.0' } })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    await expect(service.checkForUpdates()).resolves.toMatchObject({ version: '2.0.0', feedUrl: FALLBACK_FEED })
    expect(service.getLastFeedAttempts()).toEqual([
      { feedUrl: METADATA_FEED, result: 'no-update' },
      { feedUrl: FALLBACK_FEED, result: 'selected' },
    ])
  })

  it('stays silent when every metadata feed is missing', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockRejectedValueOnce(channelMetadataMissing(METADATA_FEED))
      .mockRejectedValueOnce(channelMetadataMissing(FALLBACK_FEED))
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    await expect(service.checkForUpdates()).resolves.toBeNull()
    expect(service.getLastFeedAttempts().map(attempt => attempt.result)).toEqual([
      'missing-metadata',
      'missing-metadata',
    ])
  })

  it('reports every attempted feed when all of them fail with plain errors', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockRejectedValueOnce(new Error('mirror down'))
      .mockRejectedValueOnce(new Error('github down'))
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    const error = await service.checkForUpdates().then(() => null, (thrown: unknown) => thrown as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain('mirror down')
    expect(error?.message).toContain('github down')
    expect(service.getLastFeedAttempts().map(attempt => attempt.result)).toEqual(['error', 'error'])
  })

  it.each([
    ['version only', { version: '2.0.0' }],
    ['missing filename', { version: '2.0.0', files: [{ url: '', sha512: Buffer.alloc(64).toString('base64') }] }],
    ['missing hash', { version: '2.0.0', files: [{ url: 'app.zip' }] }],
    ['invalid hash', { version: '2.0.0', files: [{ url: 'app.zip', sha512: 'invalid' }] }],
  ])('rejects cross-source downloads with %s metadata', async (_label, updateInfo) => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      downloadFeedUrls: [FALLBACK_FEED],
    })
    await service.checkForUpdates()

    await expect(service.downloadUpdate(() => {})).rejects.toThrow()
    expect(localUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('rejects incomplete download metadata even when the selected metadata is complete', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockResolvedValueOnce({ updateInfo: { version: '2.0.0', path: 'app.zip', sha2: 'a'.repeat(64) } })
      .mockResolvedValue({ updateInfo: { version: '2.0.0', path: 'app.zip' } })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      downloadFeedUrls: [FALLBACK_FEED],
    })
    await service.checkForUpdates()

    await expect(service.downloadUpdate(() => {})).rejects.toThrow()
    expect(localUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(service.getLastFeedAttempts().at(-1)?.result).toBe('mismatched-metadata')
  })

  it('rejects a download when every download feed serves mismatched metadata', async () => {
    const localUpdater = fakeUpdater()
    const updateInfo = { version: '2.0.0', files: [{ url: 'EchoFlow-Code-2.0.0-mac-arm64.dmg', sha512: Buffer.alloc(64).toString('base64') }] }
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      downloadFeedUrls: ['https://dl1.test/feed/', 'https://dl2.test/feed/'],
    })
    await service.checkForUpdates()
    localUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '2.0.0', files: [{ url: 'EchoFlow-Code-2.0.0-mac-arm64.dmg', sha512: Buffer.alloc(64, 1).toString('base64') }] },
    })

    await expect(service.downloadUpdate(() => {})).rejects.toThrow('Update download failed')
    expect(localUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(service.getLastFeedAttempts().map(attempt => attempt.result)).toEqual([
      'selected',
      'mismatched-metadata',
      'mismatched-metadata',
    ])
  })

  it('tries the next download feed after the primary source fails', async () => {
    const firstFeed = 'https://dl1.test/feed/'
    const secondFeed = 'https://dl2.test/feed/'
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockResolvedValueOnce({ updateInfo: { version: '2.0.0', files: [{ url: 'app.zip', sha512: Buffer.alloc(64).toString('base64') }] } })
      .mockResolvedValue({ updateInfo: { version: '2.0.0', files: [{ url: 'app.zip', sha512: Buffer.alloc(64).toString('base64') }] } })
    localUpdater.downloadUpdate
      .mockRejectedValueOnce(new Error('first source failed'))
      .mockResolvedValueOnce(undefined)
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      downloadFeedUrls: [firstFeed, secondFeed],
    })
    await service.checkForUpdates()

    await expect(service.downloadUpdate(() => {})).resolves.toBeUndefined()

    expect(localUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(localUpdater.setFeedURL).toHaveBeenNthCalledWith(1, METADATA_FEED)
    expect(localUpdater.setFeedURL).toHaveBeenNthCalledWith(2, firstFeed)
    expect(localUpdater.setFeedURL).toHaveBeenNthCalledWith(3, secondFeed)
    expect(service.hasDownloadedUpdate()).toBe(true)
  })

  it('reports every download source failure with feed diagnostics', async () => {
    const firstFeed = 'https://dl1.test/feed/'
    const secondFeed = 'https://dl2.test/feed/'
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates
      .mockResolvedValueOnce({ updateInfo: { version: '2.0.0', files: [{ url: 'app.zip', sha512: Buffer.alloc(64).toString('base64') }] } })
      .mockResolvedValue({ updateInfo: { version: '2.0.0', files: [{ url: 'app.zip', sha512: Buffer.alloc(64).toString('base64') }] } })
    localUpdater.downloadUpdate
      .mockRejectedValueOnce(new Error('first source failed'))
      .mockRejectedValueOnce(new Error('second source failed'))
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      downloadFeedUrls: [firstFeed, secondFeed],
    })
    await service.checkForUpdates()

    const error = await service.downloadUpdate(() => {}).then(() => null, thrown => thrown as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain(firstFeed)
    expect(error?.message).toContain(secondFeed)
    expect(service.hasDownloadedUpdate()).toBe(false)
  })

  it('hands out a copy of feed attempt diagnostics', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValueOnce({ updateInfo: { version: '2.0.0' } })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    await service.checkForUpdates()
    const attempts = service.getLastFeedAttempts()
    attempts.push({ feedUrl: 'https://tampered.test/', result: 'error', error: 'injected' })

    expect(service.getLastFeedAttempts()).toEqual([
      { feedUrl: METADATA_FEED, result: 'selected' },
    ])
  })

  it('does not query a metadata feed twice when a fallback repeats the primary URL', async () => {
    const localUpdater = fakeUpdater()
    localUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '2.0.0' } })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [METADATA_FEED, FALLBACK_FEED, FALLBACK_FEED],
    })

    await expect(service.checkForUpdates()).resolves.toMatchObject({ version: '2.0.0' })
    expect(localUpdater.setFeedURL.mock.calls).toEqual([[METADATA_FEED]])
    expect(service.getLastFeedAttempts()).toEqual([
      { feedUrl: METADATA_FEED, result: 'selected' },
    ])
  })

  it('surfaces feed-switching failures as feed diagnostics instead of a raw TypeError', async () => {
    const localUpdater = fakeUpdater()
    Object.assign(localUpdater, { setFeedURL: undefined })
    const service = new ElectronUpdaterService(localUpdater, undefined, {
      metadataFeedUrl: METADATA_FEED,
      metadataFallbackUrls: [FALLBACK_FEED],
    })

    const error = await service.checkForUpdates().then(() => null, thrown => thrown as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain('does not support switching update feeds')
    expect(error?.message).toContain(METADATA_FEED)
    expect(error?.message).toContain(FALLBACK_FEED)
    expect(service.getLastFeedAttempts().map(attempt => attempt.result)).toEqual(['error', 'error'])
  })

  it('keeps the packaged metadata-file guard on the multi-feed path', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'echoflow-updater-'))
    try {
      const localUpdater = fakeUpdater()
      const service = new ElectronUpdaterService(localUpdater, undefined, {
        updateConfigPath: join(configDir, 'app-update.yml'),
        metadataFeedUrl: METADATA_FEED,
        metadataFallbackUrls: [FALLBACK_FEED],
      })

      await expect(service.checkForUpdates()).resolves.toBeNull()
      expect(localUpdater.checkForUpdates).not.toHaveBeenCalled()
      expect(service.getLastFeedAttempts().map(attempt => attempt.result)).toEqual([
        'no-update',
        'no-update',
      ])
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
