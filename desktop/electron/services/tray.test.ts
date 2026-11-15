import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_NAME } from '../../src/lib/productIdentity.generated'
import type { Locale } from '../../src/i18n/locale'
import { installTray, resolveTrayIconPath, shouldInstallTray } from './tray'

function createElectronTrayMocks() {
  const handlers = new Map<string, () => void>()
  return {
    handlers,
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
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

const roots: string[] = []
function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-'))
  roots.push(root)
  return root
}

function asset(root: string, relativePath: string) {
  const iconPath = path.join(root, relativePath)
  mkdirSync(path.dirname(iconPath), { recursive: true })
  writeFileSync(iconPath, 'fixture')
  return iconPath
}

async function installFixture(options: Partial<Parameters<typeof installTray>[0]> = {}) {
  const root = fixtureRoot()
  const iconPath = asset(root, 'src-tauri/icons/icon.png')
  const mocks = createElectronTrayMocks()
  const show = vi.fn()
  const quit = vi.fn()
  const controller = await installTray({
    desktopRoot: root,
    show,
    quit,
    ...options,
    electronRuntime: {
      Menu: { buildFromTemplate: mocks.buildFromTemplate },
      Tray: mocks.Tray.mockImplementation(() => mocks.tray),
      nativeImage: { createFromPath: mocks.createFromPath },
    } as never,
  })
  const menu = () => mocks.buildFromTemplate.mock.calls.at(-1)![0]
  const click = (id: string) => {
    const item = menu().find(item => item.id === id)
    expect(item?.click).toBeTypeOf('function')
    item!.click!({} as never, undefined, {} as never)
  }
  return { ...mocks, controller, iconPath, show, quit, menu, click }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Electron tray service', () => {
  it('prefers the dedicated small tray icon over the full application icon', () => {
    const root = fixtureRoot()
    asset(root, 'src-tauri/icons/icon.png')
    const trayPath = asset(root, 'src-tauri/icons/tray/tray.png')
    expect(resolveTrayIconPath(root)).toBe(trayPath)
  })

  it('ships a pixel-sized tray icon and a high-DPI companion in the packaged icon directory', () => {
    const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    for (const [filename, size] of [['tray.png', 16], ['tray@2x.png', 32]] as const) {
      const png = readFileSync(path.join(desktopRoot, 'src-tauri/icons/tray', filename))
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(png.readUInt32BE(16)).toBe(size)
      expect(png.readUInt32BE(20)).toBe(size)
    }
  })

  it.each(['src-tauri/icons/icon.png', 'public/app-icon.png', 'dist/app-icon.png'])(
    'preserves the existing %s fallback', relativePath => {
      const root = fixtureRoot()
      const iconPath = asset(root, relativePath)
      expect(resolveTrayIconPath(root)).toBe(iconPath)
    },
  )

  it('fails clearly when no tray icon exists', () => {
    expect(() => resolveTrayIconPath(fixtureRoot())).toThrow('Electron tray icon not found')
  })

  it('skips the status-bar tray on macOS and keeps it on Windows and Linux', () => {
    expect(shouldInstallTray('darwin')).toBe(false)
    expect(shouldInstallTray('win32')).toBe(true)
    expect(shouldInstallTray('linux')).toBe(true)
  })

  it('uses centralized product naming, preserves show/quit and has no invented status', async () => {
    const f = await installFixture()
    expect(f.createFromPath).toHaveBeenCalledWith(f.iconPath)
    expect(f.Tray).toHaveBeenCalledTimes(1)
    expect(f.tray.setToolTip).toHaveBeenCalledWith(PRODUCT_NAME)
    expect(f.menu().map(item => item.label ?? item.type)).toEqual([
      PRODUCT_NAME, 'separator', `Show ${PRODUCT_NAME}`, 'separator', `Quit ${PRODUCT_NAME}`,
    ])
    expect(f.menu()[0]).toMatchObject({ enabled: false })
    f.click('show')
    f.click('quit')
    f.handlers.get('click')?.()
    expect(f.show).toHaveBeenCalledTimes(2)
    expect(f.quit).toHaveBeenCalledTimes(1)
    f.controller.dispose()
    expect(f.tray.destroy).toHaveBeenCalledTimes(1)
  })

  it('delegates settings and mobile navigation to host callbacks without timers or duplicate show', async () => {
    const openSettings = vi.fn()
    const openMobileConnection = vi.fn()
    const f = await installFixture({ openSettings, openMobileConnection })
    expect(f.menu().map(item => item.id).filter(Boolean)).toEqual([
      'product', 'show', 'settings', 'mobile-connection', 'quit',
    ])
    f.click('settings')
    f.click('mobile-connection')
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(openMobileConnection).toHaveBeenCalledTimes(1)
    expect(f.show).not.toHaveBeenCalled()
    expect(f.quit).not.toHaveBeenCalled()
  })

  it.each([
    ['en', 'Settings…', 'Mobile connection…', 'Local service: ready'],
    ['zh', '设置…', '手机连接…', '本地服务：就绪'],
    ['zh-TW', '設定…', '手機連線…', '本機服務：就緒'],
    ['jp', '設定…', 'モバイル接続…', 'ローカルサービス：準備完了'],
    ['kr', '설정…', '모바일 연결…', '로컬 서비스: 준비됨'],
  ] satisfies [Locale, string, string, string][])(
    'localizes the native menu and status in %s', async (locale, settings, mobile, ready) => {
      const f = await installFixture({
        locale, serviceStatus: 'ready', openSettings: vi.fn(), openMobileConnection: vi.fn(),
      })
      expect(f.menu().find(item => item.id === 'settings')?.label).toBe(settings)
      expect(f.menu().find(item => item.id === 'mobile-connection')?.label).toBe(mobile)
      expect(f.menu().find(item => item.id === 'service-status')).toMatchObject({ label: ready, enabled: false })
      expect(f.tray.setToolTip).toHaveBeenLastCalledWith(`${PRODUCT_NAME}\n${ready}`)
      for (const id of ['show', 'quit']) {
        const label = f.menu().find(item => item.id === id)?.label
        expect(label).toContain(PRODUCT_NAME)
        if (locale !== 'en') expect(label).not.toMatch(/^(Show|Quit) /)
      }
    },
  )

  it('updates locale and actual service status on the same tray, retaining omitted state', async () => {
    const f = await installFixture({ serviceStatus: 'starting' })
    expect(f.tray.setToolTip).toHaveBeenLastCalledWith(`${PRODUCT_NAME}\nLocal service: starting`)
    f.controller.update({ locale: 'zh' })
    expect(f.tray.setToolTip).toHaveBeenLastCalledWith(`${PRODUCT_NAME}\n本地服务：启动中`)
    f.controller.update({ serviceStatus: 'unavailable' })
    expect(f.tray.setToolTip).toHaveBeenLastCalledWith(`${PRODUCT_NAME}\n本地服务：不可用`)
    expect(f.menu().find(item => item.id === 'service-status')?.enabled).toBe(false)
    f.controller.update({ serviceStatus: 'ready' })
    expect(f.tray.setToolTip).toHaveBeenLastCalledWith(`${PRODUCT_NAME}\n本地服务：就绪`)
    expect(f.Tray).toHaveBeenCalledTimes(1)
    expect(f.show).not.toHaveBeenCalled()
  })

  it('ignores late updates after disposal and destroys the tray only once', async () => {
    const f = await installFixture()
    f.controller.dispose()
    f.controller.dispose()
    f.controller.update({ locale: 'kr', serviceStatus: 'unavailable' })
    expect(f.tray.destroy).toHaveBeenCalledTimes(1)
    expect(f.buildFromTemplate).toHaveBeenCalledTimes(1)
    expect(f.tray.setToolTip).toHaveBeenCalledTimes(1)
  })
})
