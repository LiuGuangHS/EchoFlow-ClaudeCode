import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultEchoFlowConfigDir } from '../../../src/utils/echoFlowConfigRoot'
import {
  applyStartupPortableMode, clearAppManagedPortableEnv, determineStartupPortableDir,
  getAppMode, setAppMode, systemClaudeConfigDir, type AppModeAppLike,
} from './appMode'

const tempDirs: string[] = []
const portableEnvKeys = ['CC_HAHA_APP_PORTABLE_DIR', 'ECHOFLOW_APP_PORTABLE_DIR'] as const
function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'echoflow-app-mode-'))
  tempDirs.push(directory)
  return directory
}
function app(root = tempDir(), selected?: string): AppModeAppLike & { root: string } {
  const home = path.join(root, 'home')
  const exe = path.join(root, 'install', 'Claude Code Haha')
  const userData = selected ?? getDefaultEchoFlowConfigDir({ env: {}, homeDir: home })
  fs.mkdirSync(path.dirname(exe), { recursive: true })
  fs.writeFileSync(exe, '')
  return { root, getPath: name => name === 'home' ? home : name === 'exe' ? exe : userData }
}
function writeMode(fakeApp: AppModeAppLike, value: unknown) {
  fs.mkdirSync(fakeApp.getPath('userData'), { recursive: true })
  fs.writeFileSync(path.join(fakeApp.getPath('userData'), 'app-mode.json'), JSON.stringify(value))
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Electron complete-root mode service', () => {
  it('uses the shared platform default and leaves app-adjacent legacy data untouched', () => {
    const fakeApp = app()
    const legacy = path.join(path.dirname(fakeApp.getPath('exe')), 'CLAUDE_CONFIG_DIR')
    fs.mkdirSync(legacy)
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"legacy":true}')
    expect(systemClaudeConfigDir(fakeApp, {})).toBe(fakeApp.getPath('userData'))
    expect(determineStartupPortableDir(fakeApp, {})).toBeNull()
    const env: NodeJS.ProcessEnv = {}
    expect(applyStartupPortableMode(fakeApp, env)).toBeNull()
    expect(env.CLAUDE_CONFIG_DIR).toBe(fakeApp.getPath('userData'))
    expect(getAppMode(fakeApp, {})).toEqual({
      mode: 'default', portableDir: null, activeConfigDir: fakeApp.getPath('userData'), configDirSource: 'system',
    })
    expect(fs.readFileSync(path.join(legacy, 'settings.json'), 'utf8')).toBe('{"legacy":true}')
  })

  it('reads historical portable pointers only as migration inputs, never as runtime selectors', () => {
    const fakeApp = app()
    const custom = path.join(fakeApp.root, 'custom-data')
    const record = { mode: 'portable', portable_dir: custom, future: { preserve: true } }
    writeMode(fakeApp, record)
    expect(determineStartupPortableDir(fakeApp, {})).toBe(custom)
    expect(determineStartupPortableDir(fakeApp, { CLAUDE_CONFIG_DIR: custom })).toBeNull()
    expect(getAppMode(fakeApp, {}).activeConfigDir).toBe(fakeApp.getPath('userData'))
    expect(fs.existsSync(custom)).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(fakeApp.getPath('userData'), 'app-mode.json'), 'utf8'))).toEqual(record)
  })

  it('requires the complete custom profile to have been selected before Chromium startup', () => {
    const root = tempDir()
    const custom = path.join(root, 'custom-data')
    const fakeApp = app(root, custom)
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: custom }
    expect(applyStartupPortableMode(fakeApp, env)).toBe(custom)
    expect(getAppMode(fakeApp, env)).toEqual({
      mode: 'portable', portableDir: custom, activeConfigDir: custom, configDirSource: 'environment',
    })
    const mismatched = app(root)
    expect(() => applyStartupPortableMode(mismatched, env)).toThrow('before Chromium startup')
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: custom })
  })

  it.each(portableEnvKeys)('retires %s but keeps the complete root and WebView location across updater/relaunch', key => {
    const custom = path.join(tempDir(), 'custom-data')
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: custom, [key]: '1', WEBVIEW2_USER_DATA_FOLDER: path.join(custom, 'EBWebView'), OTHER: 'preserve',
    }
    clearAppManagedPortableEnv(env)
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: custom, WEBVIEW2_USER_DATA_FOLDER: path.join(custom, 'EBWebView'), OTHER: 'preserve' })
    const external: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: custom }
    clearAppManagedPortableEnv(external)
    expect(external).toEqual({ CLAUDE_CONFIG_DIR: custom })
  })

  it('does not allow a mode pointer to move a live complete root or overwrite unknown state', () => {
    const fakeApp = app()
    const mode = { mode: 'default', portable_dir: null, future: { preserve: true } }
    writeMode(fakeApp, mode)
    const custom = path.join(fakeApp.root, 'custom')
    expect(() => setAppMode(fakeApp, { mode: 'portable', portableDir: custom }, {})).toThrow('cold profile migration')
    expect(fs.existsSync(custom)).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(fakeApp.getPath('userData'), 'app-mode.json'), 'utf8'))).toEqual(mode)
  })

  it.each(portableEnvKeys)('does not let inherited %s authorize or silently reset a launch-controlled custom root', key => {
    const root = tempDir()
    const custom = path.join(root, 'custom')
    const fakeApp = app(root, custom)
    writeMode(fakeApp, { mode: 'portable', portable_dir: custom })
    fs.writeFileSync(path.join(custom, 'settings.json'), '{"keep":true}')
    const env = { CLAUDE_CONFIG_DIR: custom, [key]: '1' }
    expect(() => setAppMode(fakeApp, { mode: 'default', portableDir: null }, env)).toThrow('launch environment')
    expect(fs.readFileSync(path.join(custom, 'settings.json'), 'utf8')).toBe('{"keep":true}')
    expect(getAppMode(fakeApp, env)).toMatchObject({ activeConfigDir: custom, configDirSource: 'environment' })
  })

  it('preserves unknown fields in an atomic mode record contained in the active root', () => {
    const root = tempDir()
    const custom = path.join(root, 'custom')
    const fakeApp = app(root, custom)
    writeMode(fakeApp, { mode: 'portable', portable_dir: custom, future: { preserve: true } })
    setAppMode(fakeApp, { mode: 'portable', portableDir: custom }, { CLAUDE_CONFIG_DIR: custom })
    expect(JSON.parse(fs.readFileSync(path.join(custom, 'app-mode.json'), 'utf8'))).toEqual({
      mode: 'portable', portable_dir: custom, future: { preserve: true },
    })
    expect(fs.readdirSync(custom)).toEqual(['app-mode.json'])
  })

  it('keeps the prior record and removes temporary files when atomic replacement fails', () => {
    const fakeApp = app()
    const previous = { mode: 'default', portable_dir: null, future: 42 }
    writeMode(fakeApp, previous)
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed') })
    expect(() => setAppMode(fakeApp, { mode: 'default', portableDir: null }, {})).toThrow('rename failed')
    expect(JSON.parse(fs.readFileSync(path.join(fakeApp.getPath('userData'), 'app-mode.json'), 'utf8'))).toEqual(previous)
    expect(fs.readdirSync(fakeApp.getPath('userData'))).toEqual(['app-mode.json'])
  })

  it.each([
    null, [], {}, { mode: 'portable', portable_dir: null }, { mode: 'portable', portable_dir: '' },
    { mode: 'portable', portable_dir: 'relative-data' }, { mode: 'unknown', portable_dir: '/tmp/custom' },
  ].map(value => [value] as const))('rejects malformed historical selections without silently choosing the default: %j', value => {
    const fakeApp = app()
    writeMode(fakeApp, value)
    expect(() => determineStartupPortableDir(fakeApp, {})).toThrow()
    expect(JSON.parse(fs.readFileSync(path.join(fakeApp.getPath('userData'), 'app-mode.json'), 'utf8'))).toEqual(value)
  })

  it.each([null, '', '   ', 'relative-data'])('rejects invalid custom roots: %j', portableDir => {
    const fakeApp = app()
    expect(() => setAppMode(fakeApp, { mode: 'portable', portableDir }, {})).toThrow()
    expect(fs.existsSync(fakeApp.getPath('userData'))).toBe(false)
  })

  it('rejects install-contained custom roots including aliases', () => {
    const fakeApp = app()
    const install = path.dirname(fakeApp.getPath('exe'))
    const alias = path.join(fakeApp.root, 'install-alias')
    fs.symlinkSync(install, alias, 'junction')
    for (const directory of [install, alias]) {
      expect(() => setAppMode(fakeApp, { mode: 'portable', portableDir: path.join(directory, 'data') }, {})).toThrow('outside the application install directory')
    }
  })

  it('does not mutate the launch environment when complete-root preparation fails', () => {
    const fakeApp = app()
    const env = { CLAUDE_CONFIG_DIR: path.join(fakeApp.root, 'different-root'), ECHOFLOW_APP_PORTABLE_DIR: '1' }
    const previous = { ...env }
    expect(() => applyStartupPortableMode(fakeApp, env)).toThrow('before Chromium startup')
    expect(env).toEqual(previous)
  })
})
