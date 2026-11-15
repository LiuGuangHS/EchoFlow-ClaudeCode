import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ECHOFLOW_PRODUCT_NAME } from '../../src/constants/brand'
import { PRODUCT_IDENTITY } from '../../src/lib/productIdentity.generated'

export const ECHOFLOW_APP_NAME = ECHOFLOW_PRODUCT_NAME
export const ECHOFLOW_DEFAULT_CONFIG_ENV = 'ECHOFLOW_CODE_DEFAULT_CONFIG_DIR'

export function defaultEchoFlowDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string {
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), ECHOFLOW_APP_NAME)
  }

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', ECHOFLOW_APP_NAME)
  }

  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), PRODUCT_IDENTITY.configDir)
}

export function applyDefaultEchoFlowDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return defaultEchoFlowDataRoot(env)
}

// Unknown entries are user state; only known disposable Electron caches can be ignored.
const CACHE_ENTRIES = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'ShaderCache', 'GrShaderCache', 'Crashpad', 'logs',
])

function hasUserDataState(directory: string): boolean {
  try {
    return readdirSync(directory).some(name => !CACHE_ENTRIES.has(name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export class UserDataProfileConflictError extends Error {
  constructor(readonly directories: string[], readonly platform: NodeJS.Platform) {
    const system = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
    super(`${directories.length === 2 ? 'Both' : 'Multiple'} ${system} data directories contain user state. No data was moved or merged. Back up all directories before resolving this conflict manually:\n${directories.join('\n')}`)
    this.name = 'UserDataProfileConflictError'
  }
}

export function configureEchoFlowUserData(
  app: {
    commandLine: { hasSwitch(name: string): boolean }
    getPath(name: 'userData'): string
    setPath(name: 'userData', value: string): void
  },
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): void {
  if (!['win32', 'linux', 'darwin'].includes(platform)) return
  if (app.commandLine.hasSwitch('user-data-dir')) return
  const current = app.getPath('userData')
  const published = defaultEchoFlowDataRoot(env, platform, homeDir)
  const profileRoots = platform === 'win32'
    ? [env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')]
    : platform === 'darwin'
      ? [path.join(homeDir, 'Library', 'Application Support')]
      : [env.XDG_CONFIG_HOME || path.join(homeDir, '.config')]
  const names = [PRODUCT_IDENTITY.name, PRODUCT_IDENTITY.slug, PRODUCT_IDENTITY.legacyDesktopPackageName]
  const candidates = new Set([current, published, ...profileRoots.flatMap(root => names.map(name => path.join(root, name)))])
  const canonicalPaths = new Set<string>()
  const identities = new Set<string>()
  const populated: string[] = []
  for (const candidate of candidates) {
    if (!hasUserDataState(candidate)) continue
    const canonical = realpathSync.native(candidate)
    const stat = statSync(candidate, { bigint: true })
    const identity = `${stat.dev}:${stat.ino}`
    // Compare actual filesystem identities, not case-folded names (Windows can be case-sensitive).
    if (canonicalPaths.has(canonical) || (stat.ino !== 0n && identities.has(identity))) continue
    canonicalPaths.add(canonical)
    if (stat.ino !== 0n) identities.add(identity)
    populated.push(candidate)
  }
  if (populated.length > 1) {
    throw new UserDataProfileConflictError(populated, platform)
  }
  // Keep fresh non-Windows preview profiles, but resume any single existing profile in place.
  const selected = populated[0] ?? (platform === 'win32' ? published : current)
  if (selected === current) return
  try {
    if (realpathSync.native(current) === realpathSync.native(selected)) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  mkdirSync(selected, { recursive: true })
  app.setPath('userData', selected)
}
