import { createRendererUrlMatcher } from './microphonePermissions'

export type WindowOpenHandlerResult = { action: 'deny' } | { action: 'allow' }

export type NavigationGuardWebContents = {
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenHandlerResult): void
  on(
    event: 'will-navigate',
    handler: (event: { preventDefault: () => void }, url: string) => void,
  ): unknown
  on(
    event: 'will-redirect',
    handler: (event: { preventDefault: () => void, url: string, isMainFrame: boolean }) => void,
  ): unknown
}

export type NavigationGuardOptions = {
  openExternal: (url: string) => void
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Main app window guard. The renderer is a single-page app loaded from a fixed
 * entry; it should never spawn an uncontrolled child window. Any window.open /
 * target=_blank with an http(s) URL is routed to the system browser and the
 * Electron popup is denied. Top-level navigation stays on the configured dev
 * origin or packaged renderer file so other pages cannot inherit the preload.
 */
export function installMainWindowNavigationGuards(
  webContents: NavigationGuardWebContents,
  { openExternal, rendererEntry }: NavigationGuardOptions & { rendererEntry: string },
): void {
  const isRendererUrl = createRendererUrlMatcher(rendererEntry)
  const guardNavigation = (event: { preventDefault: () => void }, url: string) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    if (isHttpUrl(url)) openExternal(url)
  }
  webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  webContents.on('will-navigate', guardNavigation)
  // Redirects also fire for subframes, unlike will-navigate.
  webContents.on('will-redirect', event => {
    if (event.isMainFrame) guardNavigation(event, event.url)
  })
}

/**
 * Preview (WebContentsView) guard. The preview renders untrusted remote pages,
 * so it must keep working as a browser: in-page http(s) navigation is allowed.
 * Popups are denied (http(s) ones handed to the system browser), and navigation
 * to any non-http(s) scheme (file:, custom schemes) is blocked outright.
 */
export function installPreviewNavigationGuards(
  webContents: NavigationGuardWebContents,
  { openExternal }: NavigationGuardOptions,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (event, url) => {
    if (!isHttpUrl(url)) event.preventDefault()
  })
}
