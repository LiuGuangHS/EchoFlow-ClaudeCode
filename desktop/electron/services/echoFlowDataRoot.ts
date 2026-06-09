import os from 'node:os'
import path from 'node:path'

export const ECHOFLOW_APP_NAME = 'EchoFlow Code'
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
  const root = env.CLAUDE_CONFIG_DIR || defaultEchoFlowDataRoot(env)
  if (!env.CLAUDE_CONFIG_DIR) {
    env.CLAUDE_CONFIG_DIR = root
    env[ECHOFLOW_DEFAULT_CONFIG_ENV] = '1'
  }
  return root
}
