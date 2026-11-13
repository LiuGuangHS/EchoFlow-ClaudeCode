import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import * as dataRoot from './echoFlowDataRoot'
import { determineStartupPortableDir } from './appMode'
import { DataMigration } from './dataMigration'
import {
  applyDefaultEchoFlowDataRoot,
  defaultEchoFlowDataRoot,
  ECHOFLOW_DEFAULT_CONFIG_ENV,
} from './echoFlowDataRoot'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'echoflow-user-data-'))
  roots.push(root)
  const local = path.join(root, 'Local', 'EchoFlow Code')
  const roaming = path.join(root, 'Roaming', 'EchoFlow Code')
  let selected = roaming
  const app = {
    commandLine: { hasSwitch: vi.fn((_name: string) => false) },
    getPath(name: 'userData' | 'exe' | 'home') {
      return name === 'userData' ? selected : name === 'home' ? root : path.join(root, 'install', 'EchoFlow Code.exe')
    },
    setPath: vi.fn((_name: 'userData', value: string) => { selected = value }),
  }
  const put = (directory: string, name: string, text = '{}') => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, name), text)
  }
  const env = { LOCALAPPDATA: path.dirname(local) }
  return { root, local, roaming, app, put, env }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Electron EchoFlow data root', () => {
  it('selects the published Local root before portable startup and leaves its pointer unchanged', () => {
    const f = fixture()
    const custom = path.join(f.root, 'custom')
    const pointer = JSON.stringify({ mode: 'portable', portable_dir: custom, future: 1 })
    f.put(f.local, 'app-mode.json', pointer)
    f.put(path.join(f.roaming, 'Cache'), 'cache')
    dataRoot.configureEchoFlowUserData(f.app, f.env, 'win32', f.root)
    expect(f.app.setPath).toHaveBeenCalledWith('userData', f.local)
    expect(determineStartupPortableDir(f.app, {})).toBe(custom)
    expect(determineStartupPortableDir(f.app, { CLAUDE_CONFIG_DIR: path.join(f.root, 'external') })).toBeNull()
    expect(readFileSync(path.join(f.local, 'app-mode.json'), 'utf8')).toBe(pointer)
  })

  describe.each(['win32', 'linux'] as const)('explicit %s user-data-dir', platform => {
    it.each([false, true])('keeps the selected profile and its own portable choice (populated: %s)', populated => {
      const f = fixture()
      const published = platform === 'win32' ? f.local : path.join(f.root, '.local', 'share', 'echoflow-code')
      const pointer = JSON.stringify({ mode: 'portable', portable_dir: path.join(f.root, 'published-portable') })
      const ownPortable = path.join(f.root, 'selected-portable')
      const ownPointer = JSON.stringify({ mode: 'portable', portable_dir: ownPortable })
      f.put(published, 'app-mode.json', pointer)
      mkdirSync(f.roaming, { recursive: true })
      if (populated) f.put(f.roaming, 'app-mode.json', ownPointer)
      f.app.commandLine.hasSwitch.mockImplementation(name => name === 'user-data-dir')

      dataRoot.configureEchoFlowUserData(f.app, f.env, platform, f.root)

      expect(f.app.getPath('userData')).toBe(f.roaming)
      expect(f.app.setPath).not.toHaveBeenCalled()
      expect(determineStartupPortableDir(f.app, {})).toBe(populated ? ownPortable : null)
      expect(readFileSync(path.join(published, 'app-mode.json'), 'utf8')).toBe(pointer)
      expect(readdirSync(f.roaming)).toEqual(populated ? ['app-mode.json'] : [])
      if (populated) expect(readFileSync(path.join(f.roaming, 'app-mode.json'), 'utf8')).toBe(ownPointer)
    })

    it('does not inspect an unusable automatic root', () => {
      const f = fixture()
      const published = platform === 'win32' ? f.local : path.join(f.root, '.local', 'share', 'echoflow-code')
      mkdirSync(path.dirname(published), { recursive: true })
      writeFileSync(published, 'not a directory')
      f.app.commandLine.hasSwitch.mockImplementation(name => name === 'user-data-dir')

      expect(() => dataRoot.configureEchoFlowUserData(f.app, f.env, platform, f.root)).not.toThrow()
      expect(f.app.getPath('userData')).toBe(f.roaming)
      expect(f.app.setPath).not.toHaveBeenCalled()
      expect(readFileSync(published, 'utf8')).toBe('not a directory')
      expect(existsSync(f.roaming)).toBe(false)
    })
  })

  it('keeps a current-only profile, and chooses Local for a fresh Windows profile', () => {
    const f = fixture()
    f.put(f.roaming, 'Preferences', '{"keep":true}')
    dataRoot.configureEchoFlowUserData(f.app, f.env, 'win32', f.root)
    expect(f.app.getPath('userData')).toBe(f.roaming)
    const fresh = fixture()
    dataRoot.configureEchoFlowUserData(fresh.app, fresh.env, 'win32', fresh.root)
    expect(fresh.app.getPath('userData')).toBe(fresh.local)
  })

  it('refuses two populated roots without selecting or modifying either', () => {
    const f = fixture()
    f.put(f.local, 'app-mode.json', '{"mode":"default","portable_dir":null}')
    f.put(f.roaming, 'data-migration-v1.json', '{"pending":true}')
    expect(() => dataRoot.configureEchoFlowUserData(f.app, f.env, 'win32', f.root)).toThrow('Both Windows data directories')
    expect(f.app.setPath).not.toHaveBeenCalled()
    expect(readFileSync(path.join(f.roaming, 'data-migration-v1.json'), 'utf8')).toBe('{"pending":true}')
  })

  it('makes an unfinished Local journal visible to migration recovery without rewriting it', async () => {
    const f = fixture()
    const journal = '{"pending":"sentinel"}'
    f.put(f.local, 'data-migration-v1.json', journal)
    dataRoot.configureEchoFlowUserData(f.app, f.env, 'win32', f.root)
    const migration = new DataMigration(f.app, {
      preview: vi.fn(), quiesce: vi.fn(), resume: vi.fn(), restart: vi.fn(), progress: vi.fn(),
    }, {})
    await expect(migration.recover()).rejects.toThrow()
    expect(readFileSync(path.join(f.local, 'data-migration-v1.json'), 'utf8')).toBe(journal)
  })

  it.each([false, true])('resumes the published Linux portable pointer (custom XDG: %s)', customXdg => {
    const f = fixture()
    const env = customXdg ? { XDG_DATA_HOME: path.join(f.root, 'xdg-data') } : {}
    const published = path.join(env.XDG_DATA_HOME || path.join(f.root, '.local', 'share'), 'echoflow-code')
    const custom = path.join(f.root, 'custom')
    const pointer = JSON.stringify({ mode: 'portable', portable_dir: custom, future: 1 })
    f.put(published, 'app-mode.json', pointer)
    f.put(path.join(f.roaming, 'Cache'), 'cache')

    dataRoot.configureEchoFlowUserData(f.app, env, 'linux', f.root)

    expect(f.app.getPath('userData')).toBe(published)
    expect(determineStartupPortableDir(f.app, {})).toBe(custom)
    expect(determineStartupPortableDir(f.app, { CLAUDE_CONFIG_DIR: path.join(f.root, 'external') })).toBeNull()
    expect(readFileSync(path.join(published, 'app-mode.json'), 'utf8')).toBe(pointer)
    expect(readFileSync(path.join(f.roaming, 'Cache', 'cache'), 'utf8')).toBe('{}')
  })

  it('keeps Linux current-only and empty preview profiles when no published state exists', () => {
    for (const currentHasState of [false, true]) {
      const f = fixture()
      const published = path.join(f.root, '.local', 'share', 'echoflow-code')
      if (currentHasState) f.put(f.roaming, 'Preferences', '{"keep":true}')
      dataRoot.configureEchoFlowUserData(f.app, {}, 'linux', f.root)
      expect(f.app.setPath).not.toHaveBeenCalled()
      expect(existsSync(published)).toBe(false)
      f.put(path.join(published, 'Cache'), 'cache')
      dataRoot.configureEchoFlowUserData(f.app, {}, 'linux', f.root)
      expect(f.app.setPath).not.toHaveBeenCalled()
    }
  })

  it.skipIf(process.platform !== 'linux').each(['directory', 'parent'])('accepts a Linux %s symlink to the same populated profile without mutation', kind => {
    const f = fixture()
    const published = path.join(f.root, '.local', 'share', 'echoflow-code')
    const pointer = JSON.stringify({ mode: 'portable', portable_dir: path.join(f.root, 'custom') })
    f.put(published, 'app-mode.json', pointer)
    const link = path.join(f.root, 'profile-alias')
    symlinkSync(kind === 'directory' ? published : path.dirname(published), link, 'dir')
    const selected = kind === 'directory' ? link : path.join(link, 'echoflow-code')
    f.app.setPath('userData', selected)
    f.app.setPath.mockClear()

    expect(() => dataRoot.configureEchoFlowUserData(f.app, {}, 'linux', f.root)).not.toThrow()
    expect(f.app.getPath('userData')).toBe(selected)
    expect(f.app.setPath).not.toHaveBeenCalled()
    expect(determineStartupPortableDir(f.app, {})).toBe(path.join(f.root, 'custom'))
    expect(readFileSync(path.join(published, 'app-mode.json'), 'utf8')).toBe(pointer)
    expect(readdirSync(published)).toEqual(['app-mode.json'])
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })

  it.skipIf(process.platform !== 'linux').each(['current', 'published'])('propagates non-ENOENT filesystem errors from the %s root', brokenRoot => {
    const f = fixture()
    const published = path.join(f.root, '.local', 'share', 'echoflow-code')
    const broken = brokenRoot === 'current' ? f.roaming : published
    const healthy = brokenRoot === 'current' ? published : f.roaming
    f.put(healthy, 'Preferences', '{"keep":true}')
    mkdirSync(path.dirname(broken), { recursive: true })
    symlinkSync(broken, broken, 'dir')

    expect(() => dataRoot.configureEchoFlowUserData(f.app, {}, 'linux', f.root)).toThrow(expect.objectContaining({ code: 'ELOOP' }))
    expect(f.app.setPath).not.toHaveBeenCalled()
    expect(readFileSync(path.join(healthy, 'Preferences'), 'utf8')).toBe('{"keep":true}')
    expect(lstatSync(broken).isSymbolicLink()).toBe(true)
  })

  it('distinguishes Linux roots with case-only names by filesystem identity', () => {
    const f = fixture()
    const env = { XDG_DATA_HOME: path.join(f.root, 'xdg-data') }
    const legacy = path.join(env.XDG_DATA_HOME, 'echoflow-code')
    const currentCaseAlias = path.join(env.XDG_DATA_HOME, 'ECHOFLOW-CODE')
    f.app.setPath('userData', currentCaseAlias)
    f.app.setPath.mockClear()
    f.put(legacy, 'app-mode.json', '{"mode":"default","portable_dir":null}')
    const sameDirectory = existsSync(currentCaseAlias)
    f.put(currentCaseAlias, 'Preferences', '{"keep":true}')

    const configure = () => dataRoot.configureEchoFlowUserData(f.app, env, 'linux', f.root)
    if (sameDirectory) expect(configure).not.toThrow()
    else expect(configure).toThrow('Both Linux data directories')
    expect(f.app.setPath).not.toHaveBeenCalled()
    expect(readFileSync(path.join(legacy, 'app-mode.json'), 'utf8')).toBe('{"mode":"default","portable_dir":null}')
    expect(readFileSync(path.join(currentCaseAlias, 'Preferences'), 'utf8')).toBe('{"keep":true}')
  })

  it('exposes the published Linux migration journal without rewriting or replaying it', async () => {
    const f = fixture()
    const published = path.join(f.root, '.local', 'share', 'echoflow-code')
    const journal = '{"pending":"sentinel"}'
    f.put(published, 'data-migration-v1.json', journal)
    dataRoot.configureEchoFlowUserData(f.app, {}, 'linux', f.root)
    const migration = new DataMigration(f.app, {
      preview: vi.fn(), quiesce: vi.fn(), resume: vi.fn(), restart: vi.fn(), progress: vi.fn(),
    }, {})
    await expect(migration.recover()).rejects.toThrow()
    expect(readFileSync(path.join(published, 'data-migration-v1.json'), 'utf8')).toBe(journal)
  })

  it('does not change macOS Electron roots', () => {
    const f = fixture()
    dataRoot.configureEchoFlowUserData(f.app, f.env, 'darwin', f.root)
    expect(f.app.setPath).not.toHaveBeenCalled()
  })

  it('wires root selection before the single-instance lock and startup migration', () => {
    const desktop = existsSync(path.resolve('electron/main.ts')) ? process.cwd() : path.resolve('desktop')
    const source = readFileSync(path.join(desktop, 'electron/main.ts'), 'utf8')
    const select = source.indexOf('configureEchoFlowUserData(app)')
    expect(select).toBeGreaterThan(-1)
    expect(select).toBeLessThan(source.indexOf('if (!acquireSingleInstanceLock'))
    expect(select).toBeLessThan(source.indexOf('await getDataMigration().recover()'))
    expect(source.slice(select, source.indexOf('let mainWindow'))).toContain('setStorageWritesFrozen(true)')
    expect(source.slice(select, source.indexOf('let mainWindow'))).toContain('process.exit(1)')
  })

  it('keeps Electron userData separate without changing Claude config storage', () => {
    const homeDir = path.join('C:', 'Users', 'tester')
    const env: NodeJS.ProcessEnv = {
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    }

    expect(defaultEchoFlowDataRoot(env, 'win32', homeDir)).toBe(
      path.join(env.LOCALAPPDATA!, 'EchoFlow Code'),
    )
    expect(applyDefaultEchoFlowDataRoot(env)).toBe(defaultEchoFlowDataRoot(env))
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env[ECHOFLOW_DEFAULT_CONFIG_ENV]).toBeUndefined()
  })
})
