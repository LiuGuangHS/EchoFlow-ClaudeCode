import { mkdirSync, readdirSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ECHOFLOW_PRODUCT_NAME } from '../../src/constants/brand'

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

  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'echoflow-code')
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
  if (platform !== 'win32' && platform !== 'linux') return
  if (app.commandLine.hasSwitch('user-data-dir')) return
  const current = app.getPath('userData')
  const published = defaultEchoFlowDataRoot(env, platform, homeDir)
  if (platform === 'win32'
    ? path.resolve(current).toLowerCase() === path.resolve(published).toLowerCase()
    : path.resolve(current) === path.resolve(published)) return
  try {
    if (realpathSync.native(current) === realpathSync.native(published)) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const publishedHasState = hasUserDataState(published)
  const currentHasState = hasUserDataState(current)
  if (publishedHasState && currentHasState) {
    throw new Error(`Both ${platform === 'win32' ? 'Windows' : 'Linux'} data directories contain user state. No data was moved or merged. Back up both directories before resolving this conflict manually:\n${published}\n${current}`)
  }
  // Resume published Linux profiles without redirecting fresh preview overrides.
  if (currentHasState || (platform === 'linux' && !publishedHasState)) return
  mkdirSync(published, { recursive: true })
  app.setPath('userData', published)
}
