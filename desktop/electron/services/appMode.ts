import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { AppModeConfig, AppModeSetInput } from '../../src/lib/desktopHost/types'
import { getDefaultEchoFlowConfigDir, resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import { hasExternalDesktopStorageControls } from './desktopStorageProvenance'

const APP_MODE_FILE = 'app-mode.json'

export type AppModeAppLike = {
  getPath(name: 'exe' | 'home' | 'userData'): string
}

type PersistedAppModeConfig = {
  mode?: string
  portable_dir?: string | null
}

export function systemClaudeConfigDir(app: AppModeAppLike, env: NodeJS.ProcessEnv = process.env): string {
  return getDefaultEchoFlowConfigDir({ env, homeDir: app.getPath('home') })
}

export function parseLegacyPortableSelection(app: AppModeAppLike, bytes: string): string | null {
  const parsed: unknown = JSON.parse(bytes)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('mode' in parsed) || typeof parsed.mode !== 'string') {
    throw new Error('Invalid legacy portable storage selection')
  }
  const mode = parsed.mode.toLowerCase()
  if (mode === 'default') return null
  const directory = 'portable_dir' in parsed && typeof parsed.portable_dir === 'string' ? parsed.portable_dir.trim() : ''
  if (mode !== 'portable' || !path.isAbsolute(directory)) throw new Error('Invalid legacy portable storage selection')
  return normalizedCustomDir(app, directory)
}

function writeAppModeConfig(configDir: string, config: PersistedAppModeConfig): void {
  fs.mkdirSync(configDir, { recursive: true })
  const target = path.join(configDir, APP_MODE_FILE)
  const temporary = path.join(configDir, `.${APP_MODE_FILE}.${randomUUID()}.tmp`)
  let previous: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600)
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ ...previous, ...config }, null, 2))
      fs.fsyncSync(descriptor)
    } finally { fs.closeSync(descriptor) }
    fs.renameSync(temporary, target)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function resolveWithExistingAncestor(inputPath: string): string {
  let existingPath = path.resolve(inputPath)
  const missingSegments: string[] = []
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath)
    if (parent === existingPath) return path.resolve(inputPath)
    missingSegments.unshift(path.basename(existingPath))
    existingPath = parent
  }
  return path.join(fs.realpathSync.native(existingPath), ...missingSegments)
}

function isPathAtOrBelow(parentDir: string, candidateDir: string): boolean {
  const relative = path.relative(
    resolveWithExistingAncestor(parentDir),
    resolveWithExistingAncestor(candidateDir),
  )
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function normalizedCustomDir(app: AppModeAppLike, value: string | null | undefined): string {
  const selectedDir = value?.trim()
  if (!selectedDir) throw new Error('Choose an absolute custom data directory')
  if (!path.isAbsolute(selectedDir)) throw new Error('Custom data storage must use an absolute path')

  const normalized = path.resolve(selectedDir)
  const shared = path.join(app.getPath('home'), '.claude')
  if (isPathAtOrBelow(shared, normalized) || isPathAtOrBelow(normalized, shared)) throw new Error('Protected shared storage cannot be the complete product root')
  if (isPathAtOrBelow(path.dirname(app.getPath('exe')), normalized)) {
    throw new Error('Custom data storage must stay outside the application install directory')
  }
  return normalized
}

function externallyControlled(env: NodeJS.ProcessEnv): boolean {
  return hasExternalDesktopStorageControls(env, resolveStorageBinding({ env }).root)
}

// Retire old mode flags, but keep the complete root through relaunch/updater.
// An old profile is no longer a hidden locator for custom storage.
export function clearAppManagedPortableEnv(env: NodeJS.ProcessEnv = process.env): void {
  delete env.CC_HAHA_APP_PORTABLE_DIR
  delete env.ECHOFLOW_APP_PORTABLE_DIR
}

export function determineStartupPortableDir(
  app: AppModeAppLike,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.CLAUDE_CONFIG_DIR) return null

  let bytes: string
  try { bytes = fs.readFileSync(path.join(app.getPath('userData'), APP_MODE_FILE), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return parseLegacyPortableSelection(app, bytes)
}

export function applyStartupPortableMode(
  app: AppModeAppLike,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const binding = resolveStorageBinding({ env, homeDir: app.getPath('home') })
  if (resolveWithExistingAncestor(binding.root) !== resolveWithExistingAncestor(app.getPath('userData'))) {
    throw new Error('The complete desktop root must be selected before Chromium startup')
  }
  env.CLAUDE_CONFIG_DIR = binding.root
  clearAppManagedPortableEnv(env)
  return binding.root === systemClaudeConfigDir(app, env) ? null : binding.root
}

export function getAppMode(
  app: AppModeAppLike,
  env: NodeJS.ProcessEnv = process.env,
): AppModeConfig {
  const root = resolveStorageBinding({ env, homeDir: app.getPath('home') }).root
  const isDefault = resolveWithExistingAncestor(root) === resolveWithExistingAncestor(systemClaudeConfigDir(app, env))
  return {
    mode: isDefault ? 'default' : 'portable',
    portableDir: isDefault ? null : root,
    activeConfigDir: root,
    configDirSource: isDefault ? 'system' : externallyControlled(env) ? 'environment' : 'portable',
  }
}

export function setAppMode(
  app: AppModeAppLike,
  input: AppModeSetInput,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (input.mode !== 'default' && input.mode !== 'portable') throw new Error(`Unsupported app mode: ${String(input.mode)}`)
  const selectedDir = input.mode === 'default' ? systemClaudeConfigDir(app, env) : normalizedCustomDir(app, input.portableDir)
  const active = getAppMode(app, env).activeConfigDir!
  if (resolveWithExistingAncestor(selectedDir) !== resolveWithExistingAncestor(active) ||
      resolveWithExistingAncestor(active) !== resolveWithExistingAncestor(app.getPath('userData'))) {
    throw new Error(externallyControlled(env)
      ? 'CLAUDE_CONFIG_DIR is controlled by the launch environment; migrate the complete root in a cold launch'
      : 'Changing the complete data root requires cold profile migration, not an app-mode pointer')
  }
  writeAppModeConfig(active, { mode: input.mode, portable_dir: input.mode === 'portable' ? active : null })
}
