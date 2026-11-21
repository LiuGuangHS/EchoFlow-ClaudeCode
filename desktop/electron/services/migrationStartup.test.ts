import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// Run the actual startup registration with isolated host/runtime dependencies.
// No Electron process, user configuration, providers or credentials are loaded.
function startupFixture(
  failure?: 'start',
  options: { restore?: Promise<void>, createWindow?: Promise<void>, tray?: boolean } = {},
) {
  const desktopDir = path.basename(process.cwd()) === 'desktop' ? process.cwd() : path.join(process.cwd(), 'desktop')
  const source = readFileSync(path.join(desktopDir, 'electron/main.ts'), 'utf8')
  const start = source.indexOf('app.whenReady().then(async () => {')
  const end = source.indexOf("app.on('window-all-closed'", start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const calls: string[] = []
  const step = (name: string) => { calls.push(name) }
  const env: NodeJS.ProcessEnv = {}
  const runtime = {
    async startServer() { step('start'); if (failure === 'start') throw new Error('Runtime could not start') },
  }
  const context = {
    nativeMenuNavigation: { navigate: vi.fn() },
    trayServiceStatus: 'unavailable',
    readLocalePreference: () => 'en',
    app: { whenReady: () => Promise.resolve(), on: vi.fn() },
    process: { env, platform: 'win32' },
    applyWindowsAppUserModelId: () => {},
    createMainWindow: vi.fn(async () => { step('window'); await options.createWindow }), installSystemAppearanceWatch: () => {},
    powerMonitor: { on: vi.fn<(event: string, listener: () => void) => void>() },
    idlePowerService: { stop: vi.fn(), start: vi.fn(), getState: vi.fn(() => ({ countdown: { id: 'fixture' } })), cancel: vi.fn() },
    screen: { on: vi.fn() }, mainWindow: null, workspaceBrowserService: null,
    getServerRuntime: () => runtime, serverRuntime: runtime as typeof runtime | null,
    getPublicAccessManager: vi.fn(() => ({ restore: async () => { step('publicAccess'); await options.restore } })),
    installApplicationMenu: vi.fn(async () => {}), shouldInstallTray: () => options.tray ?? false,
    installTray: vi.fn(async () => ({ dispose: vi.fn(), update: vi.fn() })), trayController: null,
    appRoot: () => '/fixture/desktop', showMainWindow: vi.fn(), isQuitting: false,
    scheduleNotificationSmoke: vi.fn(), Notification: {}, emitNotificationAction: () => {},
    console: { error: vi.fn() },
  }
  const startup = runInNewContext(source.slice(start, end), context) as Promise<void>
  return { calls, context, env, startup }
}

describe('cold migration startup admission boundary', () => {
  it('runs the cold bootstrap before ordinary Electron imports and never recovers a profile after ready', () => {
    const desktopDir = path.basename(process.cwd()) === 'desktop' ? process.cwd() : path.join(process.cwd(), 'desktop')
    const source = readFileSync(path.join(desktopDir, 'electron/main.ts'), 'utf8')
    expect(source.startsWith("import './storageBootstrap'")).toBe(true)
    const ready = source.slice(source.indexOf('app.whenReady().then'))
    expect(ready).not.toContain('getDataMigration().recover()')
    expect(ready).not.toContain('completeValidation()')
    expect(ready).not.toContain('failValidation()')
  })

  it('starts the ordinary runtime once after the cold barrier has admitted the profile', async () => {
    const f = startupFixture()
    await f.startup
    expect(f.calls).toEqual(['start', 'window', 'publicAccess'])
    expect(f.env.CC_HAHA_MIGRATION_VALIDATION).toBeUndefined()
  })

  it('reports a runtime startup failure without replaying profile migration or restarting an old root', async () => {
    const f = startupFixture('start')
    await f.startup
    expect(f.calls.filter(call => call === 'start')).toHaveLength(1)
    expect(f.context.console.error).toHaveBeenCalledWith('[desktop] failed to start Electron server sidecar', expect.any(Error))
  })
})

describe('idle power system lifecycle during startup', () => {
  it('invalidates suspended work and restarts only while the application is running', async () => {
    const f = startupFixture()
    await f.startup
    const listeners = new Map(f.context.powerMonitor.on.mock.calls)
    listeners.get('suspend')?.()
    expect(f.context.idlePowerService.stop).toHaveBeenCalledTimes(1)
    listeners.get('resume')?.()
    expect(f.context.idlePowerService.start).toHaveBeenCalledTimes(1)
    listeners.get('lock-screen')?.()
    expect(f.context.idlePowerService.cancel).toHaveBeenCalledWith('user-activity')
    f.context.isQuitting = true
    listeners.get('resume')?.()
    expect(f.context.idlePowerService.start).toHaveBeenCalledTimes(1)
  })
})

describe('public access restore during startup', () => {
  it('makes the local window, menu and tray available while remote restore is pending', async () => {
    let resolveRestore!: () => void
    const restore = new Promise<void>(resolve => { resolveRestore = resolve })
    const f = startupFixture(undefined, { restore, tray: true })
    let startupFinished = false
    void f.startup.then(() => { startupFinished = true })
    try {
      // Yield one event-loop turn so the real startup's awaited local work runs.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      expect(f.context.installApplicationMenu).toHaveBeenCalledOnce()
      expect(f.context.installTray).toHaveBeenCalledOnce()
      expect(f.context.createMainWindow).toHaveBeenCalledOnce()
      expect(f.context.scheduleNotificationSmoke).toHaveBeenCalledOnce()
      const activate = f.context.app.on.mock.calls.find(([event]) => event === 'activate')
      expect(typeof activate?.[1]).toBe('function')
      expect(f.calls).toContain('publicAccess')
      expect(startupFinished).toBe(true)
    } finally {
      resolveRestore()
      await f.startup
    }
  })

  it('handles a background restore failure after local startup completes', async () => {
    let rejectRestore!: (error: Error) => void
    const restore = new Promise<void>((_resolve, reject) => { rejectRestore = reject })
    const f = startupFixture(undefined, { restore })
    await f.startup
    rejectRestore(new Error('Tunnel verification unavailable'))
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(f.context.createMainWindow).toHaveBeenCalledOnce()
    const activate = f.context.app.on.mock.calls.find(([event]) => event === 'activate')
    expect(typeof activate?.[1]).toBe('function')
  })

  it('does not begin remote restore when quitting during window creation', async () => {
    let resolveWindow!: () => void
    const createWindow = new Promise<void>(resolve => { resolveWindow = resolve })
    const f = startupFixture(undefined, { createWindow })
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      expect(f.context.createMainWindow).toHaveBeenCalledOnce()
      f.context.isQuitting = true
    } finally {
      resolveWindow()
      await f.startup
    }
    expect(f.context.getPublicAccessManager).not.toHaveBeenCalled()
  })
})
