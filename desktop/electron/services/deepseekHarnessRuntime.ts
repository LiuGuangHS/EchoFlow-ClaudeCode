import { spawn as spawnProcess, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
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

const DSH_VERSION = '0.1.5-rc.2'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const DSH_EXECUTABLE_PATH = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']
const DSH_STARTUP_TIMEOUT_MS = 30_000
const HARNESS_ENV_KEYS = [
  'APPDATA',
  'ComSpec',
  'HOME',
  'LANG',
  'LOCALAPPDATA',
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
] as const

export type DeepSeekHarnessState = 'unavailable' | 'not-installed' | 'installing' | 'installed' | 'starting' | 'running' | 'stopped' | 'error'

export type DeepSeekHarnessStatus = {
  state: DeepSeekHarnessState
  version: string | null
  url: string | null
  error: string | null
}

type StoredState = {
  version: string
}

export type DeepSeekHarnessChild = ChildProcessByStdio<null, Readable, Readable>

type DeepSeekHarnessRuntimeDeps = {
  exists: (target: string) => boolean
  mkdir: typeof fs.mkdir
  readFile: typeof fs.readFile
  writeFile: typeof fs.writeFile
  rename: typeof fs.rename
  rm: typeof fs.rm
  spawn: typeof spawnProcess
  reservePort: typeof reserveLocalPort
  waitForUrl: (url: string) => Promise<void>
  resolveNode: () => string | null
  resolveManagedNode: (userDataPath: string) => Promise<string | null>
  installNode: (userDataPath: string) => Promise<string>
  nodeVersion: (nodePath: string) => Promise<[number, number, number]>
  installPackage: (nodePath: string, directory: string) => Promise<void>
}

type DeepSeekHarnessRuntimeOptions = {
  userDataPath: string
  resourcesPath?: string
  deps?: Partial<DeepSeekHarnessRuntimeDeps>
}

const defaultDeps: DeepSeekHarnessRuntimeDeps = {
  exists: existsSync,
  mkdir: fs.mkdir,
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
  rm: fs.rm,
  spawn: spawnProcess,
  reservePort: reserveLocalPort,
  waitForUrl,
  resolveNode: () => {
    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path')
    const executable = process.platform === 'win32' ? 'node.exe' : 'node'
    const candidates = (pathKey ? process.env[pathKey] : undefined)?.split(path.delimiter)
      .filter(Boolean)
      .map(directory => path.join(directory, executable)) ?? []
    if (process.platform === 'win32' && process.env.ProgramFiles) {
      candidates.unshift(path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'))
    }
    return candidates.find(target => existsSync(target)) ?? null
  },
  resolveManagedNode: userDataPath => resolveManagedNode(userDataPath),
  installNode: userDataPath => installLatestLtsNode(userDataPath),
  nodeVersion: nodePath => readNodeVersion(nodePath),
  installPackage,
}

export function deepSeekHarnessRoot(userDataPath: string): string {
  return path.join(userDataPath, 'deepseek-harness')
}

function harnessDataRoot(root: string): string {
  return path.join(root, 'data')
}

function harnessRuntimeRoot(root: string): string {
  return path.join(root, 'runtime', 'dsh', DSH_VERSION)
}

function harnessExecutable(root: string): string {
  return path.join(harnessRuntimeRoot(root), ...DSH_EXECUTABLE_PATH)
}

function harnessStatePath(root: string): string {
  return path.join(root, 'state.json')
}

function status(
  state: DeepSeekHarnessState,
  version: string | null = null,
  url: string | null = null,
  error: string | null = null,
): DeepSeekHarnessStatus {
  return { state, version, url, error }
}

function harnessEnvironment(dataRoot: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    HARNESS_ENV_KEYS.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
  )
  return {
    ...environment,
    DSH_HOME: dataRoot,
    // ponytail: Clear proxy vars so dsh can bind to 127.0.0.1 without proxy interference
    http_proxy: undefined,
    https_proxy: undefined,
    HTTP_PROXY: undefined,
    HTTPS_PROXY: undefined,
  }
}

function parseStoredState(raw: string): StoredState | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const version = (value as { version?: unknown }).version
    return typeof version === 'string' && version ? { version } : null
  } catch {
    return null
  }
}

function resolveNpmCli(nodePath: string): string | null {
  const nodeDirectory = path.dirname(nodePath)
  const candidates = process.platform === 'win32'
    ? [
        path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ]
    : [
        path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(nodeDirectory, '..', 'share', 'nodejs', 'npm', 'bin', 'npm-cli.js'),
      ]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

async function installPackage(nodePath: string, directory: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const npmCli = resolveNpmCli(nodePath)
    const npmPath = process.platform === 'win32' ? path.join(path.dirname(nodePath), 'npm.cmd') : path.join(path.dirname(nodePath), 'npm')
    const command = npmCli ?? npmPath
    const args = [
      ...(npmCli ? [npmCli] : []),
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--prefix',
      directory,
      `${DSH_PACKAGE}@${DSH_VERSION}`,
    ]
    const child = spawnProcess(npmCli ? nodePath : command, args, {
      stdio: 'ignore',
      windowsHide: true,
      shell: !npmCli && process.platform === 'win32',
    })
    child.once('error', () => reject(new Error('npm was not found beside the compatible Node.js runtime')))
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`DeepSeek Harness installation failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + DSH_STARTUP_TIMEOUT_MS
  let lastError: unknown
  // ponytail: Save and clear proxy env vars for localhost fetch
  const savedProxy = {
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
  }
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  try {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url)
        if (response.ok || response.status === 401) return
      } catch (error) {
        lastError = error
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    const reason = lastError instanceof Error ? `: ${lastError.message}` : ''
    throw new Error(`DeepSeek Harness did not start in time${reason}`)
  } finally {
    // ponytail: Restore proxy env vars
    Object.assign(process.env, savedProxy)
  }
}

export class DeepSeekHarnessRuntime {
  private readonly userDataPath: string
  private readonly root: string
  private readonly resourcesPath?: string
  private readonly deps: DeepSeekHarnessRuntimeDeps
  private nodePath: string | null = null
  private currentStatus: DeepSeekHarnessStatus = status('not-installed')
  private child: DeepSeekHarnessChild | null = null
  private startPromise: Promise<DeepSeekHarnessStatus> | null = null
  private installPromise: Promise<DeepSeekHarnessStatus> | null = null
  private generation = 0

  constructor(options: DeepSeekHarnessRuntimeOptions) {
    this.userDataPath = options.userDataPath
    this.root = deepSeekHarnessRoot(options.userDataPath)
    this.resourcesPath = options.resourcesPath
    this.deps = { ...defaultDeps, ...options.deps }
  }

  private resolveUserExecutable(): string | null {
    const runtimeBase = path.join(this.root, 'runtime', 'dsh')
    try {
      const versions = this.deps.exists(runtimeBase)
        ? readdirSync(runtimeBase).filter((version: string) => {
            const executable = path.join(runtimeBase, version, ...DSH_EXECUTABLE_PATH)
            return this.deps.exists(executable)
          })
        : []
      if (versions.length > 0) {
        const preferredVersion = versions.includes(DSH_VERSION) ? DSH_VERSION : versions[0]!
        return path.join(runtimeBase, preferredVersion, ...DSH_EXECUTABLE_PATH)
      }
    } catch {
      // If directory listing fails, fall back to checking the expected version.
    }

    const userInstalled = harnessExecutable(this.root)
    return this.deps.exists(userInstalled) ? userInstalled : null
  }

  private resolveBestExecutable(): string | null {
    const userInstalled = this.resolveUserExecutable()
    if (userInstalled) return userInstalled

    if (this.resourcesPath) {
      const bundled = path.join(this.resourcesPath, 'deepseek-harness', DSH_VERSION, ...DSH_EXECUTABLE_PATH)
      if (this.deps.exists(bundled)) return bundled
    }

    return null
  }

  async getStatus(): Promise<DeepSeekHarnessStatus> {
    if (this.currentStatus.state !== 'not-installed') return this.currentStatus
    if (!await this.resolveCompatibleNode()) return this.currentStatus

    // Check if any version is available (user-installed or bundled)
    const executable = this.resolveBestExecutable()
    if (executable) {
      const stored = await this.readStoredState()
      // Use stored version if available, otherwise assume bundled version
      const version = stored?.version || DSH_VERSION
      this.currentStatus = status('installed', version)
    }

    return this.currentStatus
  }

  install(): Promise<DeepSeekHarnessStatus> {
    if (this.installPromise) return this.installPromise
    const installation = this.installOnce().finally(() => {
      if (this.installPromise === installation) this.installPromise = null
    })
    this.installPromise = installation
    return installation
  }

  start(): Promise<DeepSeekHarnessStatus> {
    if (this.installPromise) return Promise.reject(new Error('Wait for the DeepSeek Harness update to finish before starting it'))
    if (this.startPromise) return this.startPromise
    const start = this.startOnce().finally(() => {
      if (this.startPromise === start) this.startPromise = null
    })
    this.startPromise = start
    return start
  }

  async stop(sync = false): Promise<DeepSeekHarnessStatus> {
    ++this.generation
    const child = this.child
    this.child = null
    if (child) killSidecar(child, sync)
    const current = await this.getStatus()
    this.currentStatus = status(current.version ? 'stopped' : 'not-installed', current.version)
    return this.currentStatus
  }

  async restart(): Promise<DeepSeekHarnessStatus> {
    await this.stop()
    return await this.start()
  }

  private async installOnce(): Promise<DeepSeekHarnessStatus> {
    if (this.child || this.startPromise) throw new Error('Stop DeepSeek Harness before installing updates')
    let nodePath = await this.resolveCompatibleNode()
    if (!nodePath) {
      this.currentStatus = status('installing')
      try {
        const installedNode = await this.deps.installNode(this.userDataPath)
        const version = await this.deps.nodeVersion(installedNode)
        if (!isCompatibleNodeVersion(version)) {
          throw new Error('Downloaded Node.js runtime does not meet the minimum version')
        }
        nodePath = installedNode
        this.nodePath = installedNode
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.currentStatus = status('error', null, null, message)
        throw error
      }
    }

    const userExecutable = this.resolveUserExecutable()
    const bundledExecutable = this.resolveBestExecutable()
    if (!userExecutable && bundledExecutable) {
      try {
        await this.deps.mkdir(this.root, { recursive: true })
        await this.deps.mkdir(harnessDataRoot(this.root), { recursive: true })
        await this.writeStoredState({ version: DSH_VERSION })
        this.currentStatus = status('installed', DSH_VERSION)
        return this.currentStatus
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.currentStatus = status('error', null, null, message)
        throw error
      }
    }

    const runtimeRoot = harnessRuntimeRoot(this.root)
    const temporaryRuntime = `${runtimeRoot}.installing-${randomUUID()}`
    const backupRuntime = `${runtimeRoot}.backup-${randomUUID()}`
    let backupCreated = false
    try {
      await this.deps.mkdir(temporaryRuntime, { recursive: true })
      await this.deps.installPackage(nodePath, temporaryRuntime)
      const executable = path.join(temporaryRuntime, ...DSH_EXECUTABLE_PATH)
      if (!this.deps.exists(executable)) throw new Error('DeepSeek Harness installation did not produce its launcher')
      await this.deps.mkdir(this.root, { recursive: true })
      await this.deps.mkdir(harnessDataRoot(this.root), { recursive: true })
      await this.deps.mkdir(path.dirname(runtimeRoot), { recursive: true })
      if (this.deps.exists(runtimeRoot)) {
        await this.deps.rename(runtimeRoot, backupRuntime)
        backupCreated = true
      }
      await this.deps.rename(temporaryRuntime, runtimeRoot)
      await this.writeStoredState({ version: DSH_VERSION })
      this.currentStatus = status('installed', DSH_VERSION)
      if (backupCreated) await this.deps.rm(backupRuntime, { recursive: true, force: true }).catch(() => undefined)
      return this.currentStatus
    } catch (error) {
      await this.deps.rm(temporaryRuntime, { recursive: true, force: true })
      if (backupCreated) {
        await this.deps.rm(runtimeRoot, { recursive: true, force: true })
        await this.deps.rename(backupRuntime, runtimeRoot)
      }
      const message = error instanceof Error ? error.message : String(error)
      const existing = await this.readStoredState()
      const executable = this.resolveBestExecutable()
      this.currentStatus = existing && executable
        ? status('installed', existing.version, null, message)
        : status('error', null, null, message)
      throw error
    }
  }

  private async startOnce(): Promise<DeepSeekHarnessStatus> {
    const current = await this.getStatus()
    if (current.state === 'running') return current
    if (!current.version) throw new Error('Install DeepSeek Harness before starting it')
    const nodePath = await this.resolveCompatibleNode()
    if (!nodePath) throw new Error('Node.js 22.19.0 or later is required to start DeepSeek Harness')

    // Resolve best available executable
    const executable = this.resolveBestExecutable()
    if (!executable) throw new Error('DeepSeek Harness installation is incomplete')

    const port = await this.deps.reservePort('127.0.0.1')
    const url = `http://127.0.0.1:${port}`
    const generation = ++this.generation
    this.currentStatus = status('starting', current.version, url)
    try {
      const child = this.deps.spawn(nodePath, [executable, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
        cwd: harnessDataRoot(this.root),
        env: harnessEnvironment(harnessDataRoot(this.root)),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }) as DeepSeekHarnessChild
      this.child = child
      child.once('exit', () => {
        if (generation !== this.generation || this.child !== child) return
        this.child = null
        this.currentStatus = status('stopped', current.version)
      })
      child.once('error', error => {
        if (generation !== this.generation || this.child !== child) return
        this.child = null
        this.currentStatus = status('error', current.version, null, error.message)
      })
      await this.deps.waitForUrl(url)
      if (generation !== this.generation || this.child !== child) throw new Error('DeepSeek Harness startup stopped')
      this.currentStatus = status('running', current.version, url)
      return this.currentStatus
    } catch (error) {
      if (generation === this.generation) {
        const child = this.child
        this.child = null
        if (child) killSidecar(child)
        const message = error instanceof Error ? error.message : String(error)
        this.currentStatus = status('error', current.version, null, message)
      }
      throw error
    }
  }

  private async resolveCompatibleNode(): Promise<string | null> {
    if (this.nodePath) return this.nodePath
    const candidates = [this.deps.resolveNode(), await this.deps.resolveManagedNode(this.userDataPath)]
    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        const version = await this.deps.nodeVersion(candidate)
        if (isCompatibleNodeVersion(version)) {
          this.nodePath = candidate
          return candidate
        }
      } catch {
        // Try the next available runtime.
      }
    }
    this.currentStatus = status('unavailable', null, null, 'Node.js 22.19.0 or later is required')
    return null
  }

  private async readStoredState(): Promise<StoredState | null> {
    try {
      return parseStoredState(await this.deps.readFile(harnessStatePath(this.root), 'utf8'))
    } catch {
      return null
    }
  }

  private async writeStoredState(next: StoredState): Promise<void> {
    const file = harnessStatePath(this.root)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await this.deps.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await this.deps.rename(temporary, file)
    } catch (error) {
      await this.deps.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
