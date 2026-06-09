import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTray, resolveTrayIconPath, shouldInstallTray } from './tray'

const trayMocksKey = '__electronTrayMocks'

vi.mock('electron', () => {
  const getMocks = () => {
    const globalMocks = globalThis as Record<string, unknown>
    return (globalMocks[trayMocksKey] ??= createElectronTrayMocks()) as ReturnType<typeof createElectronTrayMocks>
  }

  return {
    Menu: {
      buildFromTemplate: (...args: Parameters<ReturnType<typeof createElectronTrayMocks>['buildFromTemplate']>) =>
        getMocks().buildFromTemplate(...args),
    },
    Tray: function MockTray(...args: unknown[]) {
      const mocks = getMocks()
      mocks.Tray(...args)
      return mocks.tray
    },
    nativeImage: {
      createFromPath: (...args: Parameters<ReturnType<typeof createElectronTrayMocks>['createFromPath']>) =>
        getMocks().createFromPath(...args),
    },
  }
})

function createElectronTrayMocks() {
  const handlers = new Map<string, () => void>()
  return {
    handlers,
    buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    createFromPath: vi.fn((iconPath: string) => ({ iconPath })),
    tray: {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler)
      }),
      destroy: vi.fn(),
    },
    Tray: vi.fn(),
  }
}

describe('Electron tray service', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[trayMocksKey]
  })

  it('uses the existing desktop icon assets for the tray icon', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-'))
    try {
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')

      expect(resolveTrayIconPath(root)).toBe(iconPath)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails clearly when no tray icon exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-missing-'))
    try {
      expect(() => resolveTrayIconPath(root)).toThrow('Electron tray icon not found')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips the status-bar tray on macOS and keeps it on Windows and Linux', () => {
    expect(shouldInstallTray('darwin')).toBe(false)
    expect(shouldInstallTray('win32')).toBe(true)
    expect(shouldInstallTray('linux')).toBe(true)
  })

  it('installs tray handlers that show the app, quit explicitly, and dispose cleanly', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-install-'))
    try {
      const trayMocks = createElectronTrayMocks()
      ;(globalThis as Record<string, unknown>)[trayMocksKey] = trayMocks
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')
      const show = vi.fn()
      const quit = vi.fn()

      const controller = await installTray({
        app: { name: 'EchoFlow Code' } as never,
        desktopRoot: root,
        show,
        quit,
      })

      expect(trayMocks.createFromPath).toHaveBeenCalledWith(iconPath)
      expect(trayMocks.Tray).toHaveBeenCalledTimes(1)
      expect(trayMocks.tray.setToolTip).toHaveBeenCalledWith('EchoFlow Code')
      expect(trayMocks.buildFromTemplate).toHaveBeenCalledTimes(1)

      const template = trayMocks.buildFromTemplate.mock.calls[0]?.[0] as Array<{ label?: string, click?: () => void, type?: string }>
      expect(template.map(item => item.label ?? item.type)).toEqual([
        'Show EchoFlow Code',
        'separator',
        'Quit EchoFlow Code',
      ])

      template[0]?.click?.()
      template[2]?.click?.()
      trayMocks.handlers.get('click')?.()

      expect(show).toHaveBeenCalledTimes(2)
      expect(quit).toHaveBeenCalledTimes(1)

      controller.dispose()
      expect(trayMocks.tray.destroy).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
