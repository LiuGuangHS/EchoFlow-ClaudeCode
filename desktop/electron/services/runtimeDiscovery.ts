import { spawn as spawnProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'

import type { RuntimeDiscoveryResult, RuntimeInstallation, RuntimeProductId } from '../../src/lib/desktopHost/types'
export type { RuntimeDiscoveryResult, RuntimeInstallation, RuntimeProductId } from '../../src/lib/desktopHost/types'
export type RuntimeSource = 'bundled' | 'current-system' | 'custom-path' | 'wsl'
export type RuntimeInstallationStatus = 'available' | 'not-found' | 'error' | 'not-applicable'

type ProbeChild = EventEmitter & { stdout: Readable | null; stderr: Readable | null; kill(): boolean }
type SpawnOptions = { shell: false; windowsHide: true; stdio: ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv }

export type RuntimeDiscoveryDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  exists(target: string): boolean
  realpath(target: string): string
  isFile(target: string): boolean
  isExecutable(target: string): boolean
  spawn(command: string, args: string[], options: SpawnOptions): ProbeChild
  timeoutMs: number
  wslTimeoutMs: number
}

const MAX_OUTPUT_BYTES = 16_384
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const PRODUCTS: Array<{ id: Exclude<RuntimeProductId, 'echoflow-agent' | 'wsl'>; command: string }> = [
  { id: 'claude-code', command: 'claude' },
  { id: 'codex', command: 'codex' },
]

const defaultDeps: RuntimeDiscoveryDeps = {
  platform: process.platform,
  env: process.env,
  exists: fs.existsSync,
  realpath: target => fs.realpathSync.native(target),
  isFile: target => fs.statSync(target).isFile(),
  isExecutable: target => process.platform === 'win32' || (fs.accessSync(target, fs.constants.X_OK), true),
  spawn: (command, args, options) => spawnProcess(command, args, options) as unknown as ProbeChild,
  timeoutMs: 5000,
  wslTimeoutMs: 10_000,
}

function executableName(command: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${command}.exe` : command
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  return (pathKey ? env[pathKey] : undefined)?.split(platform === 'win32' ? ';' : ':').filter(Boolean) ?? []
}

function findExecutable(command: string, deps: RuntimeDiscoveryDeps): string | null {
  const name = executableName(command, deps.platform)
  const pathApi = deps.platform === 'win32' ? path.win32 : path
  for (const directory of pathEntries(deps.env, deps.platform)) {
    const candidate = pathApi.resolve(directory, name)
    try {
      if (deps.exists(candidate) && deps.isFile(candidate) && deps.isExecutable(candidate)) return deps.realpath(candidate)
    } catch {
      // A bad PATH entry must not prevent checking later entries.
    }
  }
  return null
}

function parseVersion(output: string, productId: RuntimeProductId): string | null {
  const text = output.trim()
  const version = text.match(/\bv?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/)
  if (!version) return null
  if (productId === 'codex' && !/\bcodex\b/i.test(text)) return null
  return version[1] ?? null
}

function safeProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  const result: NodeJS.ProcessEnv = pathKey && env[pathKey] ? { PATH: env[pathKey] } : {}
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'LANG']) {
    if (env[key]) result[key] = env[key]
  }
  return result
}

function runVersionProbe(
  productId: Exclude<RuntimeProductId, 'echoflow-agent' | 'wsl'>,
  executable: string,
  deps: RuntimeDiscoveryDeps,
): Promise<RuntimeInstallation> {
  return new Promise(resolve => {
    let child: ProbeChild
    try {
      child = deps.spawn(executable, ['--version'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: safeProbeEnv(deps.env),
      })
    } catch {
      resolve({ productId, source: 'current-system', path: executable, status: 'error', error: 'probe-failed' })
      return
    }

    let output = ''
    let outputBytes = 0
    let settled = false
    const finish = (result: RuntimeInstallation) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const collect = (chunk: Buffer | string) => {
      const text = String(chunk)
      outputBytes += Buffer.byteLength(text)
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill()
        finish({ productId, source: 'current-system', path: executable, status: 'error', error: 'probe-failed' })
        return
      }
      output += text
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({ productId, source: 'current-system', path: executable, status: 'error', error: 'probe-timeout' })
    }, deps.timeoutMs)

    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', () => finish({ productId, source: 'current-system', path: executable, status: 'error', error: 'probe-failed' }))
    child.on('close', code => {
      if (code !== 0) {
        finish({ productId, source: 'current-system', path: executable, status: 'error', error: 'probe-failed' })
        return
      }
      const version = parseVersion(output, productId)
      finish(version
        ? { productId, source: 'current-system', path: executable, version, status: 'available' }
        : { productId, source: 'current-system', path: executable, status: 'error', error: 'invalid-version' })
    })
  })
}

function validatePath(selectedPath: string, deps: RuntimeDiscoveryDeps): string {
  if (!selectedPath || CONTROL_CHARACTERS.test(selectedPath)) throw new Error('Runtime path is invalid')
  const pathApi = deps.platform === 'win32' ? path.win32 : path
  if (!pathApi.isAbsolute(selectedPath)) throw new Error('Runtime path must be absolute')
  let resolved: string
  try {
    resolved = deps.realpath(selectedPath)
    if (!deps.isFile(resolved)) throw new Error('Runtime path must be a file')
    if (deps.platform === 'win32' && path.win32.extname(resolved).toLowerCase() !== '.exe') throw new Error('Runtime path must be an .exe file on Windows')
    if (!deps.isExecutable(resolved)) throw new Error('Runtime path is not executable')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Runtime path')) throw error
    throw new Error('Runtime path is unavailable')
  }
  return resolved
}

export async function probeRuntimePath(
  selectedPath: string,
  deps: RuntimeDiscoveryDeps = defaultDeps,
): Promise<RuntimeInstallation> {
  const executable = validatePath(selectedPath, deps)
  const pathApi = deps.platform === 'win32' ? path.win32 : path
  const name = pathApi.basename(executable).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  const product = PRODUCTS.find(candidate => candidate.command === 'claude'
    ? name === 'claude' || name.startsWith('claude-')
    : name === 'codex' || name.startsWith('codex-'))
  if (!product) throw new Error('Choose a Claude Code or Codex executable')
  const result = await runVersionProbe(product.id, executable, deps)
  return { ...result, source: 'custom-path' }
}

export async function discoverRuntimes(
  options: { includeWsl?: boolean; bundledVersion?: string } = {},
  deps: RuntimeDiscoveryDeps = defaultDeps,
): Promise<RuntimeDiscoveryResult> {
  const installations: RuntimeInstallation[] = [
    { productId: 'echoflow-agent', source: 'bundled', status: 'available', ...(options.bundledVersion ? { version: options.bundledVersion } : {}) },
  ]
  const discovered = await Promise.all(PRODUCTS.map(async product => {
    const executable = findExecutable(product.command, deps)
    return executable
      ? runVersionProbe(product.id, executable, deps)
      : { productId: product.id, source: 'current-system' as const, status: 'not-found' as const }
  }))
  installations.push(...discovered)
  if (options.includeWsl) installations.push(...await discoverWsl(deps))
  return { installations }
}


function decodeWslOutput(bytes: Buffer): string {
  return bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8')
}

export function parseWslDistributions(output: Buffer): string[] {
  const names = decodeWslOutput(output).replace(/^\uFEFF/, '').split(/\r?\n/).map(name => name.trim()).filter(Boolean)
  return [...new Set(names.filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)))]
}

function runWslCommand(args: string[], deps: RuntimeDiscoveryDeps): Promise<{ code: number | null; output: Buffer; error: boolean }> {
  return new Promise(resolve => {
    let child: ProbeChild
    try {
      child = deps.spawn('wsl.exe', args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: safeProbeEnv(deps.env),
      })
    } catch {
      resolve({ code: null, output: Buffer.alloc(0), error: true })
      return
    }
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (code: number | null, error: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, output: Buffer.concat(chunks), error })
    }
    const collect = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += data.length
      if (bytes > MAX_OUTPUT_BYTES) {
        child.kill()
        finish(null, true)
        return
      }
      chunks.push(data)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(null, true)
    }, deps.wslTimeoutMs)
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', () => finish(null, true))
    child.on('close', code => finish(code, false))
  })
}

async function discoverWsl(deps: RuntimeDiscoveryDeps): Promise<RuntimeInstallation[]> {
  if (deps.platform !== 'win32') return [{ productId: 'wsl', source: 'wsl', status: 'not-applicable' }]
  const list = await runWslCommand(['--list', '--quiet'], deps)
  if (list.error || list.code !== 0) return [{ productId: 'wsl', source: 'wsl', status: 'error', error: 'probe-failed' }]
  const distributions = parseWslDistributions(list.output)
  if (!distributions.length) return [{ productId: 'wsl', source: 'wsl', status: 'not-found' }]
  const script = 'for tool in claude codex; do p=$(command -v "$tool" 2>/dev/null) || continue; v=$("$p" --version 2>/dev/null | head -n 1); printf "%s\t%s\t%s\n" "$tool" "$p" "$v"; done'
  const results = await Promise.all(distributions.map(async distribution => {
    const response = await runWslCommand(['-d', distribution, '--exec', 'sh', '-c', script], deps)
    if (response.error || response.code !== 0) {
      return PRODUCTS.map(product => ({ productId: product.id, source: 'wsl' as const, distribution, status: 'error' as const, error: 'probe-failed' as const }))
    }
    const lines = decodeWslOutput(response.output).split(/\r?\n/)
    return PRODUCTS.map(product => {
      const line = lines.find(entry => entry.startsWith(`${product.command}\t`))
      if (!line) return { productId: product.id, source: 'wsl' as const, distribution, status: 'not-found' as const }
      const [, runtimePath, versionText] = line.split('\t')
      const version = versionText ? parseVersion(versionText, product.id) : null
      return version && runtimePath
        ? { productId: product.id, source: 'wsl' as const, distribution, path: runtimePath, version, status: 'available' as const }
        : { productId: product.id, source: 'wsl' as const, distribution, status: 'error' as const, error: 'invalid-version' as const }
    })
  }))
  return results.flat()
}
