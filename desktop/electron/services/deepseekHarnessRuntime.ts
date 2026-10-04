import { spawn as spawnProcess, type ChildProcessByStdio } from 'node:child_process'
import { get as httpGet } from 'node:http'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { killSidecar, reserveLocalPort } from './sidecarManager'
import {
  installLatestLtsNode,
  isCompatibleNodeVersion,
  readNodeVersion,
  resolveManagedNode,
} from './nodeRuntime'

const DSH_PACKAGE = '@deepseek-ai/dsh'
const DSH_STARTUP_TIMEOUT_MS = 30_000
const HARNESS_ENV_KEYS = [
  'APPDATA', 'ComSpec', 'HOME', 'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'LOCALAPPDATA', 'PATH', 'Path',
  'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE',
] as const

export type DeepSeekHarnessState = 'unavailable' | 'installing' | 'starting' | 'running' | 'stopped' | 'error'
export type DeepSeekHarnessStatus = {
  state: DeepSeekHarnessState
  version: string | null
  url: string | null
  error: string | null
  nodeVersion: string | null
  nodeSource: 'system' | 'managed' | null
}
export type DeepSeekHarnessChild = ChildProcessByStdio<null, Readable, Readable>

type RuntimeDeps = {
  exists: (target: string) => boolean
  mkdir: typeof fs.mkdir
  spawn: typeof spawnProcess
  reservePort: typeof reserveLocalPort
  waitForUrl: (url: string) => Promise<void>
  resolveNode: () => string | null
  resolveManagedNode: (userDataPath: string) => Promise<string | null>
  installNode: (userDataPath: string) => Promise<string>
  nodeVersion: (nodePath: string) => Promise<[number, number, number]>
  resolveNpxCli: (nodePath: string) => string | null
}

type RuntimeOptions = {
  userDataPath: string
  deps?: Partial<RuntimeDeps>
}

const defaultDeps: RuntimeDeps = {
  exists: existsSync,
  mkdir: fs.mkdir,
  spawn: spawnProcess,
  reservePort: reserveLocalPort,
  waitForUrl,
  resolveNode: () => {
    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path')
    const executable = process.platform === 'win32' ? 'node.exe' : 'node'
    const candidates = (pathKey ? process.env[pathKey] : undefined)?.split(path.delimiter)
      .filter(Boolean).map(directory => path.join(directory, executable)) ?? []
    if (process.platform === 'win32' && process.env.ProgramFiles) {
      candidates.unshift(path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'))
    }
    return candidates.find(target => existsSync(target)) ?? null
  },
  resolveManagedNode: userDataPath => resolveManagedNode(userDataPath),
  installNode: userDataPath => installLatestLtsNode(userDataPath),
  nodeVersion: nodePath => readNodeVersion(nodePath),
  resolveNpxCli,
}

export function deepSeekHarnessRoot(userDataPath: string): string {
  return path.join(userDataPath, 'deepseek-harness')
}

function status(
  state: DeepSeekHarnessState,
  version: string | null = null,
  url: string | null = null,
  error: string | null = null,
  nodeVersion: string | null = null,
  nodeSource: 'system' | 'managed' | null = null,
): DeepSeekHarnessStatus {
  return { state, version, url, error, nodeVersion, nodeSource }
}

function harnessEnvironment(dataRoot: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    HARNESS_ENV_KEYS.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
  )
  return { ...environment, DSH_HOME: dataRoot }
}

function resolveNpxCli(nodePath: string): string | null {
  const nodeDirectory = path.dirname(nodePath)
  const candidates = process.platform === 'win32'
    ? [
        path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
      ]
    : [
        path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        path.join(nodeDirectory, '..', 'share', 'nodejs', 'npm', 'bin', 'npx-cli.js'),
      ]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + DSH_STARTUP_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const reachable = await new Promise<boolean>((resolve) => {
        const request = httpGet(url, response => {
          response.resume()
          resolve((response.statusCode ?? 500) < 500)
        })
        request.setTimeout(1_000, () => request.destroy(new Error('Local request timed out')))
        request.once('error', () => resolve(false))
      })
      if (reachable) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const reason = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`DeepSeek Harness did not start in time${reason}`)
}

function findLaunchUrl(output: string, expectedPort: number): string | null {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  for (const match of clean.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const candidate = match[0]!.replace(/[),.;]+$/, '')
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === String(expectedPort) && url.searchParams.has('token')) {
        return url.toString()
      }
    } catch {
      // Ignore non-URL output.
    }
  }
  return null
}

function findVersion(output: string): string | null {
  const match = output.match(/(?:deepseek harness|\bdsh)\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i)
  return match?.[1] ?? null
}

export class DeepSeekHarnessRuntime {
  private readonly userDataPath: string
  private readonly root: string
  private readonly deps: RuntimeDeps
  private nodePath: string | null = null
  private nodeVersion: string | null = null
  private nodeSource: 'system' | 'managed' | null = null
  private currentStatus: DeepSeekHarnessStatus = status('unavailable')
  private launchUrl: string | null = null
  private child: DeepSeekHarnessChild | null = null
  private startPromise: Promise<DeepSeekHarnessStatus> | null = null
  private generation = 0

  constructor(options: RuntimeOptions) {
    this.userDataPath = options.userDataPath
    this.root = deepSeekHarnessRoot(options.userDataPath)
    this.deps = { ...defaultDeps, ...options.deps }
  }

  async getStatus(): Promise<DeepSeekHarnessStatus> {
    if (['installing', 'starting', 'running'].includes(this.currentStatus.state)) return this.currentStatus
    const nodePath = await this.resolveCompatibleNode()
    if (!nodePath) {
      this.currentStatus = status('unavailable', this.currentStatus.version, null, 'Node.js 22.19.0 or later is required', this.nodeVersion, this.nodeSource)
      return this.currentStatus
    }
    if (this.currentStatus.state === 'unavailable') {
      this.currentStatus = status('stopped', this.currentStatus.version, null, null, this.nodeVersion, this.nodeSource)
    }
    return this.currentStatus
  }

  start(): Promise<DeepSeekHarnessStatus> {
    if (this.startPromise) return this.startPromise
    const start = this.startOnce(false).finally(() => {
      if (this.startPromise === start) this.startPromise = null
    })
    this.startPromise = start
    return start
  }

  update(): Promise<DeepSeekHarnessStatus> {
    if (this.startPromise) return this.startPromise
    const update = this.stop().then(() => this.startOnce(true)).finally(() => {
      if (this.startPromise === update) this.startPromise = null
    })
    this.startPromise = update
    return update
  }

  async stop(sync = false): Promise<DeepSeekHarnessStatus> {
    ++this.generation
    const child = this.child
    this.child = null
    this.launchUrl = null
    if (child) killSidecar(child, sync)
    const nodePath = await this.resolveCompatibleNode()
    this.currentStatus = status(nodePath ? 'stopped' : 'unavailable', this.currentStatus.version, null, null, this.nodeVersion, this.nodeSource)
    return this.currentStatus
  }

  async restart(): Promise<DeepSeekHarnessStatus> {
    await this.stop()
    return await this.start()
  }

  private async startOnce(preferOnline: boolean): Promise<DeepSeekHarnessStatus> {
    if (this.currentStatus.state === 'running' && !preferOnline) return this.currentStatus
    const generation = ++this.generation
    const previousVersion = preferOnline ? null : this.currentStatus.version
    this.currentStatus = status('installing', previousVersion, null, null, this.nodeVersion, this.nodeSource)
    try {
      let nodePath = await this.resolveCompatibleNode()
      if (generation !== this.generation) throw new Error('DeepSeek Harness startup stopped')
      if (!nodePath) {
        nodePath = await this.deps.installNode(this.userDataPath)
        if (generation !== this.generation) throw new Error('DeepSeek Harness startup stopped')
        const version = await this.deps.nodeVersion(nodePath)
        if (!isCompatibleNodeVersion(version)) throw new Error('Downloaded Node.js runtime does not meet the minimum version')
        this.nodePath = nodePath
        this.nodeVersion = `v${version.join('.')}`
        this.nodeSource = 'managed'
      }
      const npxCli = this.deps.resolveNpxCli(nodePath)
      if (!npxCli) throw new Error('npx was not found beside the compatible Node.js runtime')

      const dataRoot = path.join(this.root, 'data')
      await this.deps.mkdir(dataRoot, { recursive: true })
      const port = await this.deps.reservePort('127.0.0.1')
      if (generation !== this.generation) throw new Error('DeepSeek Harness startup stopped')
      const url = `http://127.0.0.1:${port}`
      const args = [npxCli, '--yes']
      if (preferOnline) args.push('--prefer-online')
      args.push('--package', DSH_PACKAGE, '--', 'dsh', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port))
      this.currentStatus = status('starting', previousVersion, url, null, this.nodeVersion, this.nodeSource)
      const child = this.deps.spawn(nodePath, args, {
        cwd: dataRoot,
        env: harnessEnvironment(dataRoot),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }) as DeepSeekHarnessChild
      this.child = child
      let stdout = ''
      let launchUrlCaptured = false
      child.stdout.on('data', chunk => {
        if (generation !== this.generation || this.child !== child) return
        const output = `${stdout}${String(chunk)}`.slice(-16_384)
        const version = findVersion(output)
        if (version && this.currentStatus.version !== version) {
          this.currentStatus = { ...this.currentStatus, version }
        }
        const launchUrl = launchUrlCaptured ? null : findLaunchUrl(output, port)
        if (launchUrl) {
          launchUrlCaptured = true
          this.launchUrl = launchUrl
          stdout = ''
        } else {
          stdout = output
        }
      })
      child.stderr.resume()
      child.once('exit', () => {
        if (generation !== this.generation || this.child !== child) return
        this.child = null
        this.currentStatus = status('stopped', this.currentStatus.version, null, null, this.nodeVersion, this.nodeSource)
      })
      child.once('error', error => {
        if (generation !== this.generation || this.child !== child) return
        this.child = null
        this.currentStatus = status('error', this.currentStatus.version, null, error.message, this.nodeVersion, this.nodeSource)
      })
      await this.deps.waitForUrl(url)
      if (!this.launchUrl) throw new Error('DeepSeek Harness started without printing its authenticated launch URL')
      if (generation !== this.generation || this.child !== child) throw new Error('DeepSeek Harness startup stopped')
      this.currentStatus = status('running', this.currentStatus.version, url, null, this.nodeVersion, this.nodeSource)
      return this.currentStatus
    } catch (error) {
      if (generation !== this.generation) throw error
      const message = error instanceof Error ? error.message : String(error)
      const child = this.child
      this.child = null
      if (child) killSidecar(child)
      this.currentStatus = status('error', previousVersion, null, message, this.nodeVersion, this.nodeSource)
      throw error
    }
  }

  private async resolveCompatibleNode(): Promise<string | null> {
    if (this.nodePath) return this.nodePath
    const candidates: Array<{ path: string | null, source: 'system' | 'managed' }> = [
      { path: this.deps.resolveNode(), source: 'system' },
      { path: await this.deps.resolveManagedNode(this.userDataPath), source: 'managed' },
    ]
    for (const candidate of candidates) {
      if (!candidate.path) continue
      try {
        const version = await this.deps.nodeVersion(candidate.path)
        if (!isCompatibleNodeVersion(version)) continue
        this.nodePath = candidate.path
        this.nodeVersion = `v${version.join('.')}`
        this.nodeSource = candidate.source
        return candidate.path
      } catch {
        // Try the next available runtime.
      }
    }
    return null
  }

  getOpenUrl(): string | null {
    return this.launchUrl ?? this.currentStatus.url
  }

  clearLaunchUrl(): void {
    this.launchUrl = null
  }
}
