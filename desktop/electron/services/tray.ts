import { existsSync } from 'node:fs'
import path from 'node:path'
import type { MenuItemConstructorOptions, Tray } from 'electron'
import type { Locale } from '../../src/i18n/locale'
import { PRODUCT_NAME } from '../../src/lib/productIdentity.generated'

type ElectronTrayRuntime = Pick<typeof import('electron'), 'Menu' | 'Tray' | 'nativeImage'>

type TrayState = {
  locale: Locale
  serviceStatus: 'starting' | 'ready' | 'unavailable'
}

const LABELS: Record<Locale, {
  show: string
  quit: string
  settings: string
  mobileConnection: string
  status: Record<TrayState['serviceStatus'], string>
}> = {
  en: {
    show: `Show ${PRODUCT_NAME}`, quit: `Quit ${PRODUCT_NAME}`,
    settings: 'Settings…', mobileConnection: 'Mobile connection…',
    status: { starting: 'Local service: starting', ready: 'Local service: ready', unavailable: 'Local service: unavailable' },
  },
  zh: {
    show: `显示 ${PRODUCT_NAME}`, quit: `退出 ${PRODUCT_NAME}`,
    settings: '设置…', mobileConnection: '手机连接…',
    status: { starting: '本地服务：启动中', ready: '本地服务：就绪', unavailable: '本地服务：不可用' },
  },
  'zh-TW': {
    show: `顯示 ${PRODUCT_NAME}`, quit: `結束 ${PRODUCT_NAME}`,
    settings: '設定…', mobileConnection: '手機連線…',
    status: { starting: '本機服務：啟動中', ready: '本機服務：就緒', unavailable: '本機服務：無法使用' },
  },
  jp: {
    show: `${PRODUCT_NAME} を表示`, quit: `${PRODUCT_NAME} を終了`,
    settings: '設定…', mobileConnection: 'モバイル接続…',
    status: { starting: 'ローカルサービス：起動中', ready: 'ローカルサービス：準備完了', unavailable: 'ローカルサービス：利用不可' },
  },
  kr: {
    show: `${PRODUCT_NAME} 표시`, quit: `${PRODUCT_NAME} 종료`,
    settings: '설정…', mobileConnection: '모바일 연결…',
    status: { starting: '로컬 서비스: 시작 중', ready: '로컬 서비스: 준비됨', unavailable: '로컬 서비스: 사용 불가' },
  },
}

export type TrayController = {
  tray: Tray
  update(state: Partial<TrayState>): void
  dispose(): void
}

export function resolveTrayIconPath(desktopRoot: string): string {
  const candidates = [
    path.join(desktopRoot, 'src-tauri', 'icons', 'tray', 'tray.png'),
    path.join(desktopRoot, 'src-tauri', 'icons', 'icon.png'),
    path.join(desktopRoot, 'public', 'app-icon.png'),
    path.join(desktopRoot, 'dist', 'app-icon.png'),
  ]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`Electron tray icon not found under ${desktopRoot}`)
  }
  return resolved
}

export function shouldInstallTray(platform = process.platform): boolean {
  return platform !== 'darwin'
}

export async function installTray({
  desktopRoot,
  show,
  quit,
  openSettings,
  openMobileConnection,
  locale = 'en',
  serviceStatus,
  electronRuntime,
}: {
  desktopRoot: string
  show: () => void
  quit: () => void
  // Navigation callbacks own window activation and renderer readiness.
  openSettings?: () => void
  openMobileConnection?: () => void
  locale?: Locale
  serviceStatus?: TrayState['serviceStatus']
  electronRuntime?: ElectronTrayRuntime
}): Promise<TrayController> {
  const { Menu, Tray, nativeImage } = electronRuntime ?? await import('electron')
  const icon = nativeImage.createFromPath(resolveTrayIconPath(desktopRoot))
  const tray = new Tray(icon)
  let disposed = false

  function render() {
    const labels = LABELS[locale]
    const status = serviceStatus ? labels.status[serviceStatus] : undefined
    const template: MenuItemConstructorOptions[] = [
      { id: 'product', label: PRODUCT_NAME, enabled: false },
    ]
    if (status) template.push({ id: 'service-status', label: status, enabled: false })
    template.push({ type: 'separator' }, { id: 'show', label: labels.show, click: show })
    if (openSettings) template.push({ id: 'settings', label: labels.settings, click: openSettings })
    if (openMobileConnection) template.push({ id: 'mobile-connection', label: labels.mobileConnection, click: openMobileConnection })
    template.push({ type: 'separator' }, { id: 'quit', label: labels.quit, click: quit })
    tray.setToolTip(status ? `${PRODUCT_NAME}\n${status}` : PRODUCT_NAME)
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  render()
  tray.on('click', show)

  return {
    tray,
    update(state) {
      if (disposed) return
      locale = state.locale ?? locale
      serviceStatus = state.serviceStatus ?? serviceStatus
      render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      tray.destroy()
    },
  }
}
