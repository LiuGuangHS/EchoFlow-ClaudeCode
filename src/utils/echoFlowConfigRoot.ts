import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { PRODUCT_NAME, PRODUCT_APP_ID, PRODUCT_CONFIG_DIR } from './productIdentity.generated'

export const ECHOFLOW_APP_NAME = PRODUCT_NAME
export const ECHOFLOW_APP_ID = PRODUCT_APP_ID
export const ECHOFLOW_INTERNAL_DIR = PRODUCT_CONFIG_DIR
export const ECHOFLOW_MARKER_FILE = 'app.json'
export const ECHOFLOW_DATA_ENV = 'CLAUDE_CONFIG_DIR'

export type ResolveOptions = {
  env?: Readonly<Record<string, string | undefined>>
  platform?: NodeJS.Platform
  homeDir?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export type EchoFlowOwnershipMarker = {
  owner: typeof ECHOFLOW_APP_NAME
  appId: typeof ECHOFLOW_APP_ID
  schemaVersion: 1
}

export function getDefaultEchoFlowConfigDir(options: ResolveOptions = {}): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? os.homedir()

  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), ECHOFLOW_APP_NAME)
  }

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', ECHOFLOW_APP_NAME)
  }

  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), PRODUCT_CONFIG_DIR)
}

export type StorageBinding = Readonly<{
  root: string
  internalDir: string
  selection: 'default' | 'explicit'
  /** Launch context for storage maintenance, never a source of business data. */
  location?: { file: string; moveSource?: string }
}>

let boundRoot: StorageBinding | undefined

/** Pure resolution. All launch controls must describe the same complete root. */
export function resolveStorageBinding(options: ResolveOptions & { roots?: readonly string[] } = {}): StorageBinding {
  const env = options.env ?? process.env
  const candidates = [env[ECHOFLOW_DATA_ENV], ...(options.roots ?? [])].filter((value): value is string => !!value)
  const normalize = (value: string): string => {
    if (value.includes('\0') || !path.isAbsolute(value)) throw new Error('Storage root must be an absolute directory')
    return path.resolve(value)
  }
  const root = normalize(candidates[0] ?? getDefaultEchoFlowConfigDir(options))
  if (candidates.some(candidate => normalize(candidate) !== root)) throw new Error('Conflicting storage root selections')
  return Object.freeze({ root, internalDir: path.join(root, ECHOFLOW_INTERNAL_DIR), selection: candidates.length ? 'explicit' : 'default' })
}

/** Call only after migration/validation, before importing any business writer. */
export function bindStorageRoot(binding: StorageBinding): void {
  const resolved = resolveStorageBinding({ env: {}, roots: [binding.root] })
  if (resolved.internalDir !== binding.internalDir) throw new Error('Invalid storage binding')
  if (boundRoot && boundRoot.root !== binding.root) throw new Error('Storage root is already bound; restart before changing it')
  const selected = process.env[ECHOFLOW_DATA_ENV]
  if (selected && path.resolve(selected) !== binding.root) throw new Error('Storage binding conflicts with launch environment')
  boundRoot = Object.freeze({ ...binding })
  process.env[ECHOFLOW_DATA_ENV] = binding.root
}

export function getEchoFlowConfigDir(options: ResolveOptions = {}): string {
  if (boundRoot && !options.env && !options.platform && !options.homeDir) {
    if (process.env[ECHOFLOW_DATA_ENV] !== boundRoot.root) throw new Error('Storage root changed after binding')
    return boundRoot.root
  }
  return resolveStorageBinding(options).root
}

export function getEchoFlowInternalDir(configDir = getEchoFlowConfigDir()): string {
  return path.join(configDir, ECHOFLOW_INTERNAL_DIR)
}

export function getEchoFlowMarkerPath(configDir = getEchoFlowConfigDir()): string {
  return path.join(configDir, ECHOFLOW_MARKER_FILE)
}

export function buildEchoFlowOwnershipMarker(): EchoFlowOwnershipMarker {
  return {
    owner: ECHOFLOW_APP_NAME,
    appId: ECHOFLOW_APP_ID,
    schemaVersion: 1,
  }
}

export async function ensureEchoFlowConfigRoot(configDir = getEchoFlowConfigDir()): Promise<void> {
  await fs.mkdir(configDir, { recursive: true })
  const markerPath = getEchoFlowMarkerPath(configDir)
  const marker = buildEchoFlowOwnershipMarker()
  try {
    const raw = await fs.readFile(markerPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.owner !== marker.owner || parsed.appId !== marker.appId || parsed.schemaVersion !== 1) {
      throw new Error('Storage ownership marker is foreign, invalid, or from a future version')
    }
    const existing = parsed
    const next = { ...existing, ...marker }
    if (JSON.stringify(existing) === JSON.stringify(next)) return
    await fs.writeFile(markerPath, JSON.stringify(next, null, 2) + '\n', 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  }
}
