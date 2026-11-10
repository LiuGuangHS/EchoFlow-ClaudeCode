import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type RequestOptions } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { NodeHttpExecutor } from 'builder-util/out/nodeHttpExecutor'
import { CancellationError, CancellationToken, CURRENT_APP_INSTALLER_FILE_NAME, type DownloadOptions } from 'builder-util-runtime'
import { NsisUpdater } from 'electron-updater/out/NsisUpdater'
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor'
import { wrapDifferentialHttpExecutor } from './differentialHttpExecutor'

// 仅替换网络传输；完整包仍使用依赖自身的下载、取消及摘要验证实现。
class LoopbackExecutor extends NodeHttpExecutor {
  createRequest(options: RequestOptions, callback: Parameters<NodeHttpExecutor['createRequest']>[1]) {
    if (options.hostname !== '127.0.0.1' || options.protocol !== 'http:') {
      throw new Error('测试仅允许 loopback HTTP')
    }
    return request(options, callback)
  }

  download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
    return ElectronHttpExecutor.prototype.download.call(this, url, destination, options)
  }
}

class FixtureNsisUpdater extends NsisUpdater {
  get stagedInstaller() { return this.installerPath }
}

type Mode = 'valid' | 'wrong-range' | 'missing-accept-ranges' | 'missing-content-range'
  | 'missing-content-length' | 'range-200' | 'range-416' | 'missing-cache'
  | 'missing-old-blockmap' | 'missing-new-blockmap' | 'cancel-range' | 'bad-full-digest'

const oldChunks = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)]
const newChunks = [oldChunks[0]!, Buffer.alloc(32, 4), oldChunks[2]!]
const artifact = Buffer.concat(newChunks)
const sha512 = (bytes: Buffer) => createHash('sha512').update(bytes).digest('base64')
const blockmap = (chunks: Buffer[]) => gzipSync(JSON.stringify({
  version: '2',
  files: [{
    name: 'installer.exe', offset: 0,
    sizes: chunks.map(chunk => chunk.length),
    checksums: chunks.map(chunk => createHash('sha256').update(chunk).digest('hex')),
  }],
}))

async function fixture(mode: Mode) {
  const root = mkdtempSync(join(tmpdir(), 'echoflow-nsis-update-'))
  const cache = join(root, 'cache', 'fixture-updater')
  mkdirSync(cache, { recursive: true })
  const config = join(root, 'app-update.yml')
  writeFileSync(config, 'updaterCacheDirName: fixture-updater\n')
  if (mode !== 'missing-cache') writeFileSync(join(cache, CURRENT_APP_INSTALLER_FILE_NAME), Buffer.concat(oldChunks))
  const requests: Array<{ path: string, range?: string, bytes: number }> = []
  const errors: string[] = []
  let cancelRange = mode === 'cancel-range'
  let cancel: (() => void) | undefined
  let downloaded = 0
  let cancelled = 0
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://127.0.0.1').pathname
    const entry = { path, range: req.headers.range, bytes: 0 }
    requests.push(entry)
    const send = (status: number, bytes: Buffer, headers: Record<string, string | number> = {}) => {
      entry.bytes = bytes.length
      res.writeHead(status, { 'Content-Length': bytes.length, ...headers })
      res.end(bytes)
    }
    if (path.endsWith('.yml')) {
      send(200, Buffer.from(JSON.stringify({
        version: '2.0.0', files: [{ url: 'fixture-2.0.0.exe', size: artifact.length, sha512: sha512(artifact) }],
      })))
    } else if (path.endsWith('.blockmap')) {
      const old = path.includes('1.0.0')
      if ((old && mode === 'missing-old-blockmap') || (!old && mode === 'missing-new-blockmap')) {
        send(404, Buffer.alloc(0))
      } else send(200, blockmap(old ? oldChunks : newChunks))
    } else if (path === '/fixture-2.0.0.exe' && req.headers.range) {
      if (cancelRange) {
        cancelRange = false
        res.writeHead(206, { 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes 32-63/96', 'Content-Length': 32 })
        res.flushHeaders()
        cancel?.()
        entry.bytes = 32
        res.end(newChunks[1]!)
        return
      }
      if (mode === 'range-200') return send(200, artifact, { 'Accept-Ranges': 'bytes' })
      if (mode === 'range-416') return send(416, Buffer.alloc(0), { 'Content-Range': 'bytes */96' })
      const headers: Record<string, string | number> = {
        'Accept-Ranges': 'bytes', 'Content-Range': mode === 'wrong-range' ? 'bytes 0-31/96' : 'bytes 32-63/96',
      }
      if (mode === 'missing-accept-ranges') delete headers['Accept-Ranges']
      if (mode === 'missing-content-range') delete headers['Content-Range']
      if (mode === 'missing-content-length') {
        entry.bytes = 32
        res.writeHead(206, headers)
        res.write(newChunks[1]!)
        res.end()
      } else send(206, newChunks[1]!, headers)
    } else if (path === '/fixture-2.0.0.exe') {
      send(200, mode === 'bad-full-digest' ? Buffer.alloc(96, 9) : artifact)
    } else send(404, Buffer.alloc(0))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('loopback 未绑定端口')
  const failInstall = () => { throw new Error('测试禁止安装或退出') }
  const updater = new FixtureNsisUpdater(undefined, {
    version: '1.0.0', name: 'fixture', isPackaged: true,
    appUpdateConfigPath: config, userDataPath: root, baseCachePath: join(root, 'cache'),
    whenReady: async () => {}, relaunch: failInstall, quit: failInstall, onQuit: failInstall,
  })
  updater.logger = { info() {}, warn() {}, debug() {}, error(message: string) { errors.push(message) } }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.disableWebInstaller = true
  updater.disableDifferentialDownload = false
  // 不设置 _testOnlyOptions，否则依赖会绕开生产 fallback catch 分支。
  const executorHost = Object.assign(updater, { httpExecutor: new LoopbackExecutor() })
  expect(wrapDifferentialHttpExecutor(executorHost)).toBe(true)
  updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${address.port}`, useMultipleRangeRequest: false })
  // 与 ElectronUpdaterService 一致，进度监听启用依赖内置的差分取消检查。
  updater.on('download-progress', () => {})
  updater.on('update-downloaded', () => { downloaded++ })
  updater.on('update-cancelled', () => { cancelled++ })
  if (mode === 'bad-full-digest') rmSync(join(cache, CURRENT_APP_INSTALLER_FILE_NAME))
  return {
    updater, requests, errors, cache,
    get downloaded() { return downloaded },
    get cancelled() { return cancelled },
    cancelWith(token: CancellationToken) { cancel = () => token.cancel() },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
      rmSync(root, { recursive: true, force: true })
    },
  }
}

async function verifyArtifact(f: Awaited<ReturnType<typeof fixture>>, paths: string[]) {
  expect(paths).toHaveLength(1)
  expect(readFileSync(paths[0]!)).toEqual(artifact)
  expect(sha512(readFileSync(paths[0]!))).toBe(sha512(artifact))
  expect(f.downloaded).toBe(1)
}

const installerRequests = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(r => r.path.endsWith('.exe'))

describe('真实 NsisUpdater downloadUpdate / doDownloadUpdate 离线入口', () => {
  it('正常差分仅请求变化的 32 字节，产物通过 SHA512 且没有完整包请求', async () => {
    const f = await fixture('valid')
    try {
      expect((await f.updater.checkForUpdates())?.isUpdateAvailable).toBe(true)
      await verifyArtifact(f, await f.updater.downloadUpdate())
      expect(installerRequests(f)).toEqual([{ path: '/fixture-2.0.0.exe', range: 'bytes=32-63', bytes: 32 }])
      expect(f.errors).toEqual([])
    } finally { await f.close() }
  })

  it.each<Mode>([
    'wrong-range', 'missing-accept-ranges', 'missing-content-range', 'missing-content-length',
    'range-200', 'range-416', 'missing-cache', 'missing-old-blockmap', 'missing-new-blockmap',
  ])('%s 经真实 catch 分支回退完整包，并验证最终 SHA512', async mode => {
    const f = await fixture(mode)
    try {
      await f.updater.checkForUpdates()
      await verifyArtifact(f, await f.updater.downloadUpdate())
      const installers = installerRequests(f)
      expect(installers.filter(r => !r.range)).toEqual([{ path: '/fixture-2.0.0.exe', range: undefined, bytes: 96 }])
      const failsBeforeRange = ['missing-cache', 'missing-old-blockmap', 'missing-new-blockmap'].includes(mode)
      expect(installers.filter(r => r.range)).toHaveLength(failsBeforeRange ? 0 : 1)
      expect(f.errors.some(e => e.includes('fallback to full download'))).toBe(true)
      if (mode.endsWith('blockmap')) {
        const version = mode === 'missing-old-blockmap' ? '1.0.0' : '2.0.0'
        expect(f.requests.some(r => r.path === `/fixture-${version}.exe.blockmap`)).toBe(true)
      }
    } finally { await f.close() }
  })

  it('取消中的差分不发布成功、不留下可安装文件，使用新 token 可以重试', async () => {
    const f = await fixture('cancel-range')
    try {
      await f.updater.checkForUpdates()
      const token = new CancellationToken()
      f.cancelWith(token)
      await expect(f.updater.downloadUpdate(token)).rejects.toBeInstanceOf(CancellationError)
      expect(f.downloaded).toBe(0)
      expect(f.cancelled).toBe(1)
      expect(f.updater.stagedInstaller).toBeNull()
      expect(installerRequests(f).filter(r => !r.range)).toHaveLength(0)
      await verifyArtifact(f, await f.updater.downloadUpdate(new CancellationToken()))
      expect(installerRequests(f).filter(r => r.range)).toHaveLength(2)
      expect(installerRequests(f).filter(r => !r.range)).toHaveLength(0)
    } finally { await f.close() }
  })

  it('回退完整包的 SHA512 不符时拒绝成功', async () => {
    const f = await fixture('bad-full-digest')
    try {
      await f.updater.checkForUpdates()
      await expect(f.updater.downloadUpdate()).rejects.toThrow(/sha512|checksum/i)
      expect(installerRequests(f).filter(r => !r.range)).toHaveLength(1)
      expect(f.downloaded).toBe(0)
      expect(f.updater.stagedInstaller).toBeNull()
      expect(existsSync(join(f.cache, 'pending', 'fixture-2.0.0.exe'))).toBe(false)
    } finally { await f.close() }
  })
})
