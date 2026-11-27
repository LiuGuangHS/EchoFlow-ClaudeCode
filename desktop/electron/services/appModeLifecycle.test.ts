import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { desktopMoveRelaunchArgs } from './desktopStorageMove'
import { clearDesktopStorageInjections, recordDesktopStorageLaunch, restoreDesktopLaunchEnvironment } from './desktopStorageProvenance'
import { resolveStorageBinding } from '../../../src/utils/echoFlowConfigRoot'
import type { DataMigrationHooks } from './dataMigration'

describe('app mode restart lifecycle', () => {
  it('synchronously stops Windows sidecars when preparing a restart', () => {
    const desktopDir = path.basename(process.cwd()) === 'desktop'
      ? process.cwd()
      : path.join(process.cwd(), 'desktop')
    const source = readFileSync(path.join(desktopDir, 'electron', 'main.ts'), 'utf8')
    const handler = source.match(
      /registerHandler\(ELECTRON_IPC_CHANNELS\.appModePrepareRestart,[\s\S]*?\n\s*registerHandler/,
    )?.[0]

    expect(handler).toContain('getServerRuntime().stopAll(true)')
  })


  it.each([false, true])('restarts with only genuine launch controls (external=%s)', external => {
    const desktopDir = path.basename(process.cwd()) === 'desktop' ? process.cwd() : path.join(process.cwd(), 'desktop')
    const source = readFileSync(path.join(desktopDir, 'electron/main.ts'), 'utf8')
    const helperStart = source.indexOf('function relaunchDesktop(')
    const helperEnd = source.indexOf('function getDataMigration()', helperStart)
    expect(helperStart).toBeGreaterThanOrEqual(0)
    expect(helperEnd).toBeGreaterThan(helperStart)
    const helpers = source.slice(helperStart, helperEnd)
    const start = source.indexOf('registerHandler(ELECTRON_IPC_CHANNELS.appModeRestart,')
    const end = source.indexOf('registerHandler(ELECTRON_IPC_CHANNELS.adaptersRestartSidecar,', start)
    const root = path.resolve('/fixture/selected complete root')
    const runtimeConfig = path.join(root, 'claude-code-runtime.json')
    const original = external ? { OTHER: 'keep', ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: runtimeConfig } : { OTHER: 'keep' }
    const env: NodeJS.ProcessEnv = { ...original }
    const desktopRelaunchArgs = ['main.cjs', '--unrelated', ...(external ? [`--user-data-dir=${root}`] : [])]
    recordDesktopStorageLaunch(resolveStorageBinding({ env: {}, roots: [root] }), {
      roots: external ? [root] : [], runtimeConfig: original.ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG,
    }, env)
    const injected = { OTHER: 'keep', CLAUDE_CONFIG_DIR: root, ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: runtimeConfig, WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'EBWebView') }
    Object.assign(env, injected)
    const app = { getPath: () => root, relaunch: vi.fn(() => { expect(env).toEqual(original) }), quit: vi.fn() }
    const context = {
      app, isQuitting: false, desktopRelaunchArgs,
      restoreDesktopLaunchEnvironment: (selected: string) => restoreDesktopLaunchEnvironment(selected, env),
      ELECTRON_IPC_CHANNELS: { appModeRestart: 'restart' },
      registerHandler: (_channel: string, handler: () => void) => handler(),
    }
    runInNewContext(helpers + source.slice(start, end), context)
    expect(context.isQuitting).toBe(true)
    expect(app.relaunch).toHaveBeenCalledWith({ args: desktopRelaunchArgs })
    expect(env).toEqual(injected)
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it('keeps the Electron host alive until graceful server shutdown finishes', () => {
    const desktopDir = path.basename(process.cwd()) === 'desktop'
      ? process.cwd()
      : path.join(process.cwd(), 'desktop')
    const source = readFileSync(path.join(desktopDir, 'electron', 'main.ts'), 'utf8')
    const handler = source.match(/app\.on\('before-quit',[\s\S]*\n\}\)\s*$/)?.[0]

    expect(handler).toContain('event.preventDefault()')
    expect(handler).toContain('getServerRuntime().stopAllAndWait()')
    expect(handler).toMatch(/stopAllAndWait\(\)[\s\S]*app\.quit\(\)/)
  })
})

// Runs the production updatePrepareInstall handler from main.ts against
// fixtures, without booting Electron or a sidecar.
function prepareInstallFixture() {
  const desktopDir = path.basename(process.cwd()) === 'desktop'
    ? process.cwd()
    : path.join(process.cwd(), 'desktop')
  const source = readFileSync(path.join(desktopDir, 'electron', 'main.ts'), 'utf8')
  const start = source.indexOf('registerHandler(ELECTRON_IPC_CHANNELS.updatePrepareInstall,')
  const end = source.indexOf('registerHandler(ELECTRON_IPC_CHANNELS.updateCancelInstall,', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)

  const calls: string[] = []
  let finishRuntime!: (error?: Error) => void
  const runtimeExited = new Promise<void>((resolve, reject) => {
    finishRuntime = error => error ? reject(error) : resolve()
  })
  let handler: (() => Promise<void>) | null = null
  runInNewContext(source.slice(start, end), {
    ELECTRON_IPC_CHANNELS: { updatePrepareInstall: 'update-prepare-install' },
    registerHandler: (_channel: string, fn: () => Promise<void>) => { handler = fn },
    publicAccessManager: { stop: async () => { calls.push('publicAccess') } },
    getServerRuntime: () => ({
      stopAllAndWait: () => {
        calls.push('runtime')
        return runtimeExited
      },
      stopAll: () => { calls.push('stopAll') },
    }),
    Error,
    String,
  })
  if (!handler) throw new Error('updatePrepareInstall handler was not registered')
  return { run: handler as () => Promise<void>, calls, finishRuntime }
}

function migrationLifecycleFixture(failRelaunch = false) {
  const desktopDir = path.basename(process.cwd()) === 'desktop' ? process.cwd() : path.join(process.cwd(), 'desktop')
  const source = readFileSync(path.join(desktopDir, 'electron/main.ts'), 'utf8')
  const start = source.indexOf('function getDataMigration()')
  const end = source.indexOf('function getP2PTerminator()', start)
  const root = path.resolve('/fixture/source')
  const env: NodeJS.ProcessEnv = { OTHER: 'keep' }
  recordDesktopStorageLaunch(resolveStorageBinding({ env: {}, roots: [root] }), { roots: [] }, env)
  Object.assign(env, { CLAUDE_CONFIG_DIR: root, ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: path.join(root, 'claude-code-runtime.json'), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'EBWebView') })
  const events: string[] = []
  let drained!: () => void
  const operations = new Promise<void>(resolve => { drained = resolve })
  let hooks!: DataMigrationHooks
  const app = {
    getPath: () => root,
    relaunch: vi.fn(() => { events.push('relaunch'); expect(env).toEqual({ OTHER: 'keep' }); if (failRelaunch) throw new Error('relaunch failed') }),
    quit: vi.fn(() => { events.push('quit') }),
  }
  const runtime = { quiesceForMigration: vi.fn(async () => { events.push('runtime') }), resumeAfterMigration: vi.fn(async () => {}) }
  const context = {
    dataMigration: null, DataMigration: class { constructor(_app: unknown, selected: DataMigrationHooks) { hooks = selected } },
    app, isQuitting: false, process: { argv: ['electron', 'main.cjs', '--user-data-dir=/old', '--disk-cache-dir', '/old/cache', '--unrelated'], env },
    hostOperations: new Set([operations]), setStorageWritesFrozen: (value: boolean) => events.push(value ? 'freeze' : 'resume'),
    mainWindow: { isDestroyed: () => false }, saveWindowState: () => events.push('window'),
    petWindowController: { dispose: () => events.push('pet') }, p2pTerminator: { dispose: async () => { events.push('direct') } },
    publicAccessManager: { dispose: async () => { events.push('public') } }, getServerRuntime: () => runtime,
    getPublicAccessManager: () => ({ restore: async () => {} }),
    clearDesktopStorageInjections: (selected: string) => clearDesktopStorageInjections(selected, env), desktopMoveRelaunchArgs,
  }
  runInNewContext(source.slice(start, end) + '\ngetDataMigration()', context)
  return { root, env, hooks, app, runtime, context, events, drained }
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('live desktop cold-move lifecycle', () => {
  it('saves window state before freezing writes, drains operations, and relaunches explicitly', async () => {
    const f = migrationLifecycleFixture()
    const stopping = f.hooks.quiesce()
    await settle()
    expect(f.events).toEqual(['window', 'freeze'])
    f.drained()
    await stopping
    expect(f.events).toEqual(['window', 'freeze', 'pet', 'direct', 'public', 'runtime'])
    await expect(f.hooks.assertQuiescent!([f.root])).rejects.toThrow('Chromium is active')
    const target = path.resolve('/fixture/target')
    const request = { source: f.root, id: '11111111-1111-4111-8111-111111111111', proof: 'a'.repeat(64) + ':1:2' }
    await f.hooks.restart(target, request)
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['main.cjs', '--unrelated', `--user-data-dir=${target}`, `--echoflow-move-source=${f.root}`, `--echoflow-move-request=${request.id}`, `--echoflow-move-proof=${request.proof}`] })
    expect(f.context.isQuitting).toBe(true)
    expect(f.events.slice(-2)).toEqual(['relaunch', 'quit'])
  })

  it('restores only managed environment injections when relaunch throws before exit', async () => {
    const f = migrationLifecycleFixture(true)
    const before = { ...f.env }
    expect(() => f.hooks.restart(path.resolve('/fixture/target'), { source: f.root, id: '11111111-1111-4111-8111-111111111111', proof: 'a'.repeat(64) + ':1:2' })).toThrow('relaunch failed')
    expect(f.env).toEqual(before)
    expect(f.context.isQuitting).toBe(false)
    expect(f.app.quit).not.toHaveBeenCalled()
  })
})

describe('staged update relaunch', () => {
  it.each([false, true])('passes genuine launch controls to the installer (external=%s)', external => {
    const desktopDir = path.basename(process.cwd()) === 'desktop' ? process.cwd() : path.join(process.cwd(), 'desktop')
    const source = readFileSync(path.join(desktopDir, 'electron/main.ts'), 'utf8')
    const start = source.indexOf('registerHandler(ELECTRON_IPC_CHANNELS.updateRelaunch,')
    const end = source.indexOf('registerHandler(ELECTRON_IPC_CHANNELS.notificationPermissionState,', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const root = path.resolve('/fixture/selected complete root')
    const original: NodeJS.ProcessEnv = external ? { CLAUDE_CONFIG_DIR: root, OTHER: 'keep' } : { OTHER: 'keep' }
    const env = { ...original }
    recordDesktopStorageLaunch(resolveStorageBinding({ env: {}, roots: [root] }), { roots: external ? [root] : [] }, env)
    const injected = { ...original, CLAUDE_CONFIG_DIR: root, ECHOFLOW_CLAUDE_CODE_RUNTIME_CONFIG: path.join(root, 'claude-code-runtime.json'), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'EBWebView') }
    Object.assign(env, injected)
    const quitAndInstallDownloadedUpdate = vi.fn(() => { expect(env).toEqual(original) })
    const context = {
      app: { getPath: () => root }, isQuitting: false,
      restoreDesktopLaunchEnvironment: (selected: string) => restoreDesktopLaunchEnvironment(selected, env),
      ELECTRON_IPC_CHANNELS: { updateRelaunch: 'update-relaunch' },
      registerHandler: (_channel: string, handler: () => void) => handler(),
      getUpdaterService: () => ({ hasStagedUpdate: () => true, quitAndInstallDownloadedUpdate }),
    }
    runInNewContext(source.slice(start, end), context)
    expect(quitAndInstallDownloadedUpdate).toHaveBeenCalledOnce()
    expect(context.isQuitting).toBe(true)
    expect(env).toEqual(injected)
  })
})

describe('update install preparation', () => {
  it('resolves only after the runtime and its children have exited', async () => {
    const fixture = prepareInstallFixture()
    let resolved = false
    const pending = fixture.run().then(() => { resolved = true })

    await settle()
    expect(fixture.calls).toEqual(['publicAccess', 'runtime'])
    expect(resolved).toBe(false)

    fixture.finishRuntime()
    await pending
    expect(resolved).toBe(true)
  })

  it('fails the install when the runtime does not exit, so the renderer can retry', async () => {
    const fixture = prepareInstallFixture()
    const pending = fixture.run()
    await settle()
    fixture.finishRuntime(new Error('Runtime processes did not exit'))

    await expect(pending).rejects.toThrow(/still shutting down[\s\S]*Runtime processes did not exit/)
  })
})
