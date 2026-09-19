import { createHash, randomUUID } from 'node:crypto'
import { spawn as spawnProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'

export const NODE_MIN_VERSION = [22, 19, 0] as const
export const NODE_DIST_INDEX_URL = 'https://nodejs.org/dist/index.json'
const NODE_DIST_BASE_URL = 'https://nodejs.org/dist'
const NODE_RUNTIME_DIRECTORY = 'runtimes/node'
const NODE_CURRENT_DIRECTORY = 'current'

type NodeRuntimeDeps = {
  exists: (target: string) => boolean
  mkdir: typeof fs.mkdir
  readFile: typeof fs.readFile
  writeFile: typeof fs.writeFile
  rename: typeof fs.rename
  rm: typeof fs.rm
  fetch: typeof fetch
  spawn: typeof spawnProcess
}

type NodeRelease = {
  version: string
  lts: string | boolean
  files: string[]
}

type NodeAsset = {
  target: string
  archiveName: string
  executableRelativePath: string
}

const defaultDeps: NodeRuntimeDeps = {
  exists: existsSync,
  mkdir: fs.mkdir,
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
  rm: fs.rm,
  fetch,
  spawn: spawnProcess,
}

export function nodeRuntimeRoot(userDataPath: string): string {
  return path.join(userDataPath, NODE_RUNTIME_DIRECTORY)
}

function nodeExecutablePath(root: string): string {
  return path.join(root, NODE_CURRENT_DIRECTORY, process.platform === 'win32' ? 'node.exe' : 'bin', ...(process.platform === 'win32' ? [] : ['node']))
}

export function isCompatibleNodeVersion(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version
  const [requiredMajor, requiredMinor, requiredPatch] = NODE_MIN_VERSION
  return major > requiredMajor || (major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch)))
}

export async function readNodeVersion(
  nodePath: string,
  spawn: typeof spawnProcess = spawnProcess,
): Promise<[number, number, number]> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(nodePath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`Node.js exited with code ${code ?? 'unknown'}`)))
  })
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(output.trim())
  if (!match) throw new Error('Unable to determine Node.js version')
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function resolveNodeAsset(): NodeAsset {
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return { target: 'win-x64', archiveName: '', executableRelativePath: 'node.exe' }
    if (process.arch === 'arm64') return { target: 'win-arm64', archiveName: '', executableRelativePath: 'node.exe' }
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return { target: 'darwin-x64', archiveName: '', executableRelativePath: 'bin/node' }
    if (process.arch === 'arm64') return { target: 'darwin-arm64', archiveName: '', executableRelativePath: 'bin/node' }
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return { target: 'linux-x64', archiveName: '', executableRelativePath: 'bin/node' }
    if (process.arch === 'arm64') return { target: 'linux-arm64', archiveName: '', executableRelativePath: 'bin/node' }
  }
  throw new Error(`Node.js runtime is not available for ${process.platform}/${process.arch}`)
}

function assetForRelease(version: string): NodeAsset {
  const asset = resolveNodeAsset()
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  return {
    ...asset,
    archiveName: `node-${version}-${asset.target}.${extension}`,
  }
}

function parseNodeVersion(value: string): [number, number, number] | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function parseRelease(value: unknown): NodeRelease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const release = value as Partial<NodeRelease>
  if (
    typeof release.version !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.version) ||
    (typeof release.lts !== 'string' && typeof release.lts !== 'boolean') ||
    !Array.isArray(release.files) || !release.files.every(file => typeof file === 'string')
  ) return null
  return { version: release.version, lts: release.lts, files: release.files }
}

async function fetchResponse(url: string, fetchFn: typeof fetch): Promise<Response> {
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`Unable to download Node.js runtime metadata (${response.status})`)
  return response
}

async function resolveLatestLts(deps: NodeRuntimeDeps): Promise<{ release: NodeRelease; asset: NodeAsset }> {
  const response = await fetchResponse(NODE_DIST_INDEX_URL, deps.fetch)
  const values = await response.json() as unknown
  if (!Array.isArray(values)) throw new Error('Node.js runtime metadata is invalid')

  for (const value of values) {
    const release = parseRelease(value)
    if (!release || !release.lts) continue
    const asset = assetForRelease(release.version)
    const version = parseNodeVersion(release.version)
    if (version && isCompatibleNodeVersion(version) && release.files.includes(asset.archiveName)) {
      return { release, asset }
    }
  }
  throw new Error(`No compatible Node.js LTS runtime is available for ${process.platform}/${process.arch}`)
}

function checksumForAsset(checksums: string, assetName: string): string {
  const escapedAssetName = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^([a-f0-9]{64})\\s+${escapedAssetName}$`, 'mi').exec(checksums)
  if (!match) throw new Error(`Node.js runtime checksum is missing for ${assetName}`)
  return match[1]!.toLowerCase()
}

async function downloadAsset(
  url: string,
  destination: string,
  expectedChecksum: string,
  deps: NodeRuntimeDeps,
): Promise<void> {
  const response = await fetchResponse(url, deps.fetch)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actualChecksum = createHash('sha256').update(bytes).digest('hex')
  if (actualChecksum !== expectedChecksum) throw new Error('Node.js runtime checksum verification failed')
  await deps.writeFile(destination, bytes)
}

async function extractArchive(archive: string, destination: string, deps: NodeRuntimeDeps): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = deps.spawn('tar', ['-xf', archive, '-C', destination], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Node.js runtime extraction failed with exit code ${code ?? 'unknown'}`)))
  })
}

export async function resolveManagedNode(
  userDataPath: string,
  overrides: Partial<NodeRuntimeDeps> = {},
): Promise<string | null> {
  const deps = { ...defaultDeps, ...overrides }
  const candidate = nodeExecutablePath(nodeRuntimeRoot(userDataPath))
  if (!deps.exists(candidate)) return null
  try {
    const version = await readNodeVersion(candidate, deps.spawn)
    return isCompatibleNodeVersion(version) ? candidate : null
  } catch {
    return null
  }
}

export async function installLatestLtsNode(
  userDataPath: string,
  overrides: Partial<NodeRuntimeDeps> = {},
): Promise<string> {
  const deps = { ...defaultDeps, ...overrides }
  const { release, asset } = await resolveLatestLts(deps)
  const root = nodeRuntimeRoot(userDataPath)
  const temporaryRoot = `${root}.installing-${randomUUID()}`
  const backupRoot = `${root}.backup-${randomUUID()}`
  const archive = path.join(temporaryRoot, asset.archiveName)
  const extractionRoot = path.join(temporaryRoot, 'extract')
  const extractedRoot = path.join(extractionRoot, `node-${release.version}-${asset.target}`)
  const currentRoot = path.join(root, NODE_CURRENT_DIRECTORY)
  let backupCreated = false
  let promoted = false

  try {
    await deps.mkdir(extractionRoot, { recursive: true })
    const checksumResponse = await fetchResponse(`${NODE_DIST_BASE_URL}/${release.version}/SHASUMS256.txt`, deps.fetch)
    const checksum = checksumForAsset(await checksumResponse.text(), asset.archiveName)
    await downloadAsset(`${NODE_DIST_BASE_URL}/${release.version}/${asset.archiveName}`, archive, checksum, deps)
    await extractArchive(archive, extractionRoot, deps)
    const extractedExecutable = path.join(extractedRoot, asset.executableRelativePath)
    if (!deps.exists(extractedExecutable)) throw new Error('Node.js runtime archive did not contain its executable')
    const extractedVersion = await readNodeVersion(extractedExecutable, deps.spawn)
    if (!isCompatibleNodeVersion(extractedVersion)) throw new Error('Downloaded Node.js runtime does not meet the minimum version')

    await deps.mkdir(root, { recursive: true })
    if (deps.exists(currentRoot)) {
      await deps.rename(currentRoot, backupRoot)
      backupCreated = true
    }
    await deps.rename(extractedRoot, currentRoot)
    promoted = true
    if (backupCreated) await deps.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
    await deps.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    return nodeExecutablePath(root)
  } catch (error) {
    await deps.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    if (promoted) await deps.rm(currentRoot, { recursive: true, force: true }).catch(() => undefined)
    if (backupCreated) await deps.rename(backupRoot, currentRoot).catch(() => undefined)
    throw error
  }
}
