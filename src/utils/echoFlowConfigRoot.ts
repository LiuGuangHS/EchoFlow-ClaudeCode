import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

export const ECHOFLOW_APP_NAME = 'EchoFlow Code'
export const ECHOFLOW_APP_ID = 'com.echoflowai-claude-code.desktop'
export const ECHOFLOW_INTERNAL_DIR = 'echoflow'
export const ECHOFLOW_MARKER_FILE = 'app.json'
export const ECHOFLOW_DATA_ENV = 'CLAUDE_CONFIG_DIR'

type ResolveOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
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

  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'echoflow-code')
}

export function getEchoFlowConfigDir(options: ResolveOptions = {}): string {
  const env = options.env ?? process.env
  return env[ECHOFLOW_DATA_ENV] || getDefaultEchoFlowConfigDir(options)
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
  try {
    await fs.access(markerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.writeFile(markerPath, JSON.stringify(buildEchoFlowOwnershipMarker(), null, 2) + '\n', 'utf-8')
  }
}
