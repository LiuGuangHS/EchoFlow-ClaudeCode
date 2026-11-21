import path from 'node:path'
import type { StorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import type { DesktopStorageControls } from './desktopStorageStartup'

const storageEnv = (root: string) => ({ CLAUDE_CONFIG_DIR: root,
  ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: path.join(root, 'claude-code-runtime.json'), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'EBWebView') })
const launches = new WeakMap<NodeJS.ProcessEnv, { binding: StorageBinding; controls: DesktopStorageControls; original: NodeJS.ProcessEnv }>()

/** Capture before bootstrap injects paths; environment flags cannot grant this provenance. */
export function recordDesktopStorageLaunch(binding: StorageBinding, controls: DesktopStorageControls, env: NodeJS.ProcessEnv = process.env): void {
  const original = Object.fromEntries(Object.keys(storageEnv(binding.root)).map(key => [key, env[key]]))
  launches.set(env, { binding: { ...binding }, controls: { ...controls, roots: [...controls.roots] }, original })
}

export function hasExternalDesktopStorageControls(env: NodeJS.ProcessEnv, root: string): boolean {
  const launch = launches.get(env)
  if (!launch || launch.binding.root !== root) return Boolean(env.CLAUDE_CONFIG_DIR || env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG || env.WEBVIEW2_USER_DATA_FOLDER)
  const { controls } = launch
  return controls.roots.length > 0 || [controls.runtimeConfig, controls.webView, controls.diskCache, controls.mediaCache].some(value => value !== undefined) ||
    Object.entries(storageEnv(root)).some(([key, expected]) => env[key] !== undefined && env[key] !== expected)
}

function swapDesktopStorageInjections(root: string, env: NodeJS.ProcessEnv, original: NodeJS.ProcessEnv): () => void {
  const previous: NodeJS.ProcessEnv = {}
  for (const [key, expected] of Object.entries(storageEnv(root))) {
    if (env[key] !== expected) continue
    previous[key] = expected
    const value = original[key]
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return () => Object.assign(env, previous)
}

/** Electron's relauncher inherits the environment at the time it is started. */
export function restoreDesktopLaunchEnvironment(root: string, env: NodeJS.ProcessEnv = process.env): () => void {
  const launch = launches.get(env)
  if (!launch || launch.binding.root !== root) throw new Error('Storage launch environment was not captured')
  return swapDesktopStorageInjections(root, env, launch.original)
}

/** A cross-root launch must not inherit any genuine override from the source. */
export function clearDesktopStorageInjections(root: string, env: NodeJS.ProcessEnv = process.env): () => void {
  if (!launches.has(env) || hasExternalDesktopStorageControls(env, root)) throw new Error('Storage paths are controlled by the launch environment')
  return swapDesktopStorageInjections(root, env, {})
}
