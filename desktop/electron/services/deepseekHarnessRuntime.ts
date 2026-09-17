import { spawn as spawnProcess, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { killSidecar, reserveLocalPort } from './sidecarManager'

const DSH_VERSION = '0.1.1-rc.2'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const DSH_EXECUTABLE_PATH = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']
const DSH_MIN_NODE_VERSION = [22, 19, 0] as const
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

export type DeepSeekHarnessState = 'unavailable' | 'not-installed' | 'installed' | 'starting' | 'running' | 'stopped' | 'error'

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
  nodeVersion: (nodePath: string) => Promise<[number, number, number]>
  installPackage: (nodePath: string, directory: string) => Promise<void>
}

type DeepSeekHarnessRuntimeOptions = {
  userDataPath: string
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
  nodeVersion: async nodePath => {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnProcess(nodePath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let stdout = ''
      child.stdout?.on('data', chunk => { stdout += String(chunk) })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`Node.js exited with code ${code ?? 'unknown'}`)))
    })
    const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(output.trim())
    if (!match) throw new Error('Unable to determine Node.js version')
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  },
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
  return { ...environment, DSH_HOME: dataRoot }
}

function isCompatibleNodeVersion(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version
  const [requiredMajor, requiredMinor, requiredPatch] = DSH_MIN_NODE_VERSION
  return major > requiredMajor || (major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch)))
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

async function installPackage(nodePath: string, directory: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const npmPath = process.platform === 'win32' ? path.join(path.dirname(nodePath), 'npm.cmd') : path.join(path.dirname(nodePath), 'npm')
    const child = spawnProcess(npmPath, [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--prefix',
      directory,
      `${DSH_PACKAGE}@${DSH_VERSION}`,
    ], {
      stdio: 'ignore',
      windowsHide: true,
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
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const reason = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`DeepSeek Harness did not start in time${reason}`)
}

export class DeepSeekHarnessRuntime {
  private readonly root: string
  private readonly deps: DeepSeekHarnessRuntimeDeps
  private nodePath: string | null = null
  private currentStatus: DeepSeekHarnessStatus = status('not-installed')
  private child: DeepSeekHarnessChild | null = null
  private startPromise: Promise<DeepSeekHarnessStatus> | null = null
  private installPromise: Promise<DeepSeekHarnessStatus> | null = null
  private generation = 0

  constructor(options: DeepSeekHarnessRuntimeOptions) {
    this.root = deepSeekHarnessRoot(options.userDataPath)
    this.deps = { ...defaultDeps, ...options.deps }
  }

  async getStatus(): Promise<DeepSeekHarnessStatus> {
    if (this.currentStatus.state !== 'not-installed') return this.currentStatus
    if (!await this.resolveCompatibleNode()) return this.currentStatus
    const stored = await this.readStoredState()
    if (stored && this.deps.exists(harnessExecutable(this.root))) {
      this.currentStatus = status('installed', stored.version)
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
    const nodePath = await this.resolveCompatibleNode()
    if (!nodePath) throw new Error('Node.js 22.19.0 or later is required to install DeepSeek Harness')
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
      this.currentStatus = existing && this.deps.exists(harnessExecutable(this.root))
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
    const executable = harnessExecutable(this.root)
    if (!this.deps.exists(executable)) throw new Error('DeepSeek Harness installation is incomplete')
    const port = await this.deps.reservePort('127.0.0.1')
    const url = `http://127.0.0.1:${port}`
    const generation = ++this.generation
    this.currentStatus = status('starting', DSH_VERSION, url)
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
        this.currentStatus = status('stopped', DSH_VERSION)
      })
      child.once('error', error => {
        if (generation !== this.generation || this.child !== child) return
        this.child = null
        this.currentStatus = status('error', DSH_VERSION, null, error.message)
      })
      await this.deps.waitForUrl(url)
      if (generation !== this.generation || this.child !== child) throw new Error('DeepSeek Harness startup stopped')
      this.currentStatus = status('running', DSH_VERSION, url)
      return this.currentStatus
    } catch (error) {
      if (generation === this.generation) {
        const child = this.child
        this.child = null
        if (child) killSidecar(child)
        const message = error instanceof Error ? error.message : String(error)
        this.currentStatus = status('error', DSH_VERSION, null, message)
      }
      throw error
    }
  }

  private async resolveCompatibleNode(): Promise<string | null> {
    if (this.nodePath) return this.nodePath
    const candidate = this.deps.resolveNode()
    if (!candidate) {
      this.currentStatus = status('unavailable', null, null, 'Node.js 22.19.0 or later is required')
      return null
    }
    try {
      const version = await this.deps.nodeVersion(candidate)
      if (!isCompatibleNodeVersion(version)) {
        this.currentStatus = status('unavailable', null, null, 'Node.js 22.19.0 or later is required')
        return null
      }
      this.nodePath = candidate
      return candidate
    } catch {
      this.currentStatus = status('unavailable', null, null, 'Node.js 22.19.0 or later is required')
      return null
    }
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
    await this.deps.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await this.deps.rename(temporary, file)
  }
}
