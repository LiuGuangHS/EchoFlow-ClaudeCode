// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertDesktopStorageControls, desktopStorageIdentity, desktopStorageRelaunchArgs, type DesktopStorageLaunch } from './services/desktopStorageStartup'
import { hasExternalDesktopStorageControls, recordDesktopStorageLaunch, restoreDesktopLaunchEnvironment } from './services/desktopStorageProvenance'

const desktop = path.basename(process.cwd()) === 'desktop' ? process.cwd() : path.join(process.cwd(), 'desktop')
const source = ts.transpileModule(readFileSync(path.join(desktop, 'electron/storageBootstrap.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

// Executes the real synchronous entry with a fake worker. No Electron, Chromium,
// migration, keychain, provider or business module is loaded by this fixture.
function fixture(options: { error?: string, missingWorker?: boolean, timeout?: boolean, differentRoot?: boolean, response?: unknown } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'desktop-cold-bootstrap-'))
  directories.push(home)
  const bundleDir = path.join(home, 'electron-dist')
  const workerPath = path.join(bundleDir, 'storage-bootstrap.cjs')
  mkdirSync(bundleDir)
  if (!options.missingWorker) writeFileSync(workerPath, '')
  const root = path.join(home, 'selected')
  const binding = { root, internalDir: path.join(root, 'echoflow-code'), selection: 'explicit' }
  const finalRoot = options.differentRoot ? path.join(home, 'admitted') : root
  const finalBinding = { ...binding, root: finalRoot, internalDir: path.join(finalRoot, 'echoflow-code') }
  const env: NodeJS.ProcessEnv = {}
  const switches: Record<string, string> = {}
  const events: string[] = []
  const app = {
    setPath: vi.fn((name: string, _directory: string) => { events.push(name) }),
    setAppLogsPath: vi.fn(() => { events.push('logs') }),
    exit: vi.fn(),
    commandLine: {
      hasSwitch: (name: string) => name in switches,
      getSwitchValue: (name: string) => switches[name] ?? '',
      appendSwitch: vi.fn((name: string) => { events.push(name) }),
    },
  }
  const dialog = { showErrorBox: vi.fn() }
  const bind = vi.fn(() => { events.push('bind') })
  const mkdir = vi.fn()
  const unref = vi.fn()
  const makeWorker = vi.fn()
  class Worker {
    constructor(file: string, { workerData }: { workerData: { memory: SharedArrayBuffer; launch: DesktopStorageLaunch } }) {
      makeWorker(file)
      events.push('worker')
      let response = options.response ?? (options.error ? { ok: false, error: options.error } : { ok: true, binding: finalBinding, controls: workerData.launch.controls })
      try { assertDesktopStorageControls(finalBinding as DesktopStorageLaunch['binding'], workerData.launch.controls) }
      catch (error) { response = { ok: false, error: String(error) } }
      const bytes = new TextEncoder().encode(JSON.stringify(response))
      new Uint8Array(workerData.memory, 8).set(bytes)
      const state = new Int32Array(workerData.memory, 0, 2)
      Atomics.store(state, 1, bytes.length)
      Atomics.store(state, 0, 1)
    }
    on() { return this }
    unref = unref
  }
  const requireMock = (name: string) => {
    switch (name) {
      case 'electron': return { app, dialog }
      case 'node:path': return path
      case 'node:fs': return { mkdirSync: mkdir }
      case 'node:worker_threads': return { Worker }
      case '../../src/utils/echoFlowConfigRoot': return { bindStorageRoot: bind }
      case './services/desktopStorageStartup': return { discoverDesktopStorage: () => ({ binding, sources: [], issues: [], controls: {
        roots: env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : [], runtimeConfig: env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG, webView: env.WEBVIEW2_USER_DATA_FOLDER,
        diskCache: switches['disk-cache-dir'], mediaCache: switches['media-cache-dir'],
      } }), desktopStorageIdentity, assertDesktopStorageControls, desktopStorageRelaunchArgs }
      case './services/desktopStorageProvenance': return { recordDesktopStorageLaunch: (selected: DesktopStorageLaunch['binding'], controls: NonNullable<DesktopStorageLaunch['controls']>) => recordDesktopStorageLaunch(selected, controls, env) }
      case './services/stdioGuards': return { installStdioWriteFailureGuards() {} }
      default: throw new Error(`Unexpected bootstrap dependency: ${name}`)
    }
  }
  const exports: { desktopRelaunchArgs?: string[] } = {}
  const run = () => runInNewContext(source, {
    require: Object.assign(requireMock, { resolve: createRequire(path.join(bundleDir, 'main.cjs')).resolve }),
    exports, __dirname: path.join(home, 'source'),
    process: { env, argv: ['electron', 'main.cjs', '--unrelated'], exit() { throw new Error('fixture process exited') } },
    SharedArrayBuffer, TextDecoder,
    Atomics: { wait: () => { events.push('barrier'); return options.timeout ? 'timed-out' : 'not-equal' }, load: Atomics.load },
  })
  return { run, root, binding, finalRoot, finalBinding, env, switches, events, app, dialog, bind, mkdir, makeWorker, workerPath, unref, exports }
}

describe('pre-Chromium desktop bootstrap entry', () => {
  it('waits for acceptance before binding any Chromium, log, cache or WebView path', () => {
    const f = fixture()
    f.run()
    expect(f.events.slice(0, 3)).toEqual(['worker', 'barrier', 'bind'])
    expect(f.makeWorker).toHaveBeenCalledWith(f.workerPath)
    expect(f.app.setPath).toHaveBeenCalledWith('userData', f.root)
    expect(f.app.setPath).toHaveBeenCalledWith('sessionData', f.root)
    expect(f.app.setPath).toHaveBeenCalledWith('crashDumps', path.join(f.binding.internalDir, 'crashes'))
    expect(f.app.setAppLogsPath).toHaveBeenCalledWith(path.join(f.binding.internalDir, 'logs'))
    expect(f.app.commandLine.appendSwitch).toHaveBeenCalledWith('disk-cache-dir', path.join(f.root, 'Cache'))
    expect(f.app.commandLine.appendSwitch).toHaveBeenCalledWith('media-cache-dir', path.join(f.root, 'Media Cache'))
    expect(f.env.WEBVIEW2_USER_DATA_FOLDER).toBe(path.join(f.root, 'EBWebView'))
    expect(f.env.CLAUDE_CONFIG_DIR).toBe(f.root)
    expect(hasExternalDesktopStorageControls(f.env, f.root)).toBe(false)
    expect(f.unref).toHaveBeenCalledOnce()
    expect(f.app.exit).not.toHaveBeenCalled()
  })

  it('prepares a clean restart without discarding the current host bindings', () => {
    const f = fixture()
    f.env.OTHER = 'keep'
    f.run()
    const current = { ...f.env }
    const restore = restoreDesktopLaunchEnvironment(f.root, f.env)
    expect(f.exports.desktopRelaunchArgs).toEqual(['main.cjs', '--unrelated'])
    expect(f.env).toEqual({ OTHER: 'keep' })
    restore()
    expect(f.env).toEqual(current)
  })

  it('delivers genuine aligned environment overrides with their original spelling on restart', () => {
    const f = fixture()
    const override = `${f.root}${path.sep}..${path.sep}${path.basename(f.root)}${path.sep}EBWebView`
    f.env.WEBVIEW2_USER_DATA_FOLDER = override
    f.run()
    expect(hasExternalDesktopStorageControls(f.env, f.root)).toBe(true)
    const restore = restoreDesktopLaunchEnvironment(f.root, f.env)
    expect(f.env).toEqual({ WEBVIEW2_USER_DATA_FOLDER: override })
    restore()
    expect(f.env.WEBVIEW2_USER_DATA_FOLDER).toBe(path.join(f.root, 'EBWebView'))
  })

  it('uses the worker-admitted root for every environment, Chromium and internal path', () => {
    const f = fixture({ differentRoot: true })
    f.run()
    expect(f.bind).toHaveBeenCalledWith(f.finalBinding)
    expect(f.app.setPath).toHaveBeenCalledWith('userData', f.finalRoot)
    expect(f.app.setPath).toHaveBeenCalledWith('sessionData', f.finalRoot)
    expect(f.app.setPath).toHaveBeenCalledWith('crashDumps', path.join(f.finalBinding.internalDir, 'crashes'))
    expect(f.app.setAppLogsPath).toHaveBeenCalledWith(path.join(f.finalBinding.internalDir, 'logs'))
    expect(f.app.commandLine.appendSwitch).toHaveBeenCalledWith('disk-cache-dir', path.join(f.finalRoot, 'Cache'))
    expect(f.app.commandLine.appendSwitch).toHaveBeenCalledWith('media-cache-dir', path.join(f.finalRoot, 'Media Cache'))
    expect(f.env.CLAUDE_CONFIG_DIR).toBe(f.finalRoot)
    expect(f.env.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG).toBe(path.join(f.finalRoot, 'claude-code-runtime.json'))
    expect(f.env.WEBVIEW2_USER_DATA_FOLDER).toBe(path.join(f.finalRoot, 'EBWebView'))
    expect(f.app.exit).not.toHaveBeenCalled()
  })

  it.each([{}, { ok: true }, { ok: true, binding: { root: 'relative', internalDir: 'relative/echoflow-code', selection: 'explicit' } },
    { ok: true, binding: { root: '/absolute', internalDir: '/outside', selection: 'explicit' } }])('rejects a malformed worker response: %j', response => {
    const f = fixture({ response })
    expect(f.run).toThrow('fixture process exited')
    expect(f.bind).not.toHaveBeenCalled()
    expect(f.app.setPath).not.toHaveBeenCalled()
    expect(f.mkdir).not.toHaveBeenCalled()
  })

  it.each([
    { error: 'Old Chromium owner still active' }, { missingWorker: true }, { timeout: true },
  ])('exits without opening a fallback profile when bootstrap fails: %j', options => {
    const f = fixture(options)
    expect(f.run).toThrow('fixture process exited')
    expect(f.dialog.showErrorBox).toHaveBeenCalledOnce()
    expect(f.app.exit).toHaveBeenCalledWith(1)
    expect(f.bind).not.toHaveBeenCalled()
    expect(f.app.setPath).not.toHaveBeenCalled()
    expect(f.mkdir).not.toHaveBeenCalled()
    expect(f.env.WEBVIEW2_USER_DATA_FOLDER).toBeUndefined()
  })

  it.each(['ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG', 'WEBVIEW2_USER_DATA_FOLDER'] as const)('rejects an external %s override before binding desktop paths', key => {
    const f = fixture()
    f.env[key] = path.join(path.dirname(f.root), 'outside-selected-root')
    expect(f.run).toThrow('fixture process exited')
    expect(f.makeWorker).toHaveBeenCalledOnce()
    expect(f.app.setPath).not.toHaveBeenCalled()
  })

  it.each(['disk-cache-dir', 'media-cache-dir'])('rejects a conflicting Chromium %s launch switch', name => {
    const f = fixture()
    f.switches[name] = path.join(path.dirname(f.root), 'outside-cache')
    expect(f.run).toThrow('fixture process exited')
    expect(f.makeWorker).toHaveBeenCalledOnce()
    expect(f.app.setPath).not.toHaveBeenCalled()
  })
})
