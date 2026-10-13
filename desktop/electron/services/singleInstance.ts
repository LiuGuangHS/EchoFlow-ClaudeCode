import type { App, BrowserWindow } from 'electron'
import { extractDeepLinkFromArgs } from './deepLinkHandler'
import { showMainWindow } from './windows'

export function acquireSingleInstanceLock(
  app: App,
  getMainWindow: () => BrowserWindow | null,
  onDeepLink: (url: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ECHOFLOW_ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK === '1') {
    return true
  }

  const hasLock = app.requestSingleInstanceLock()
  if (!hasLock) {
    app.quit()
    return false
  }

  app.on('second-instance', (_event, commandLine) => {
    const deepLinkUrl = extractDeepLinkFromArgs(commandLine)
    if (deepLinkUrl) onDeepLink(deepLinkUrl)
    showMainWindow(getMainWindow(), app)
  })

  return true
}
