import { handleDeepLinkUrl } from '../../src/lib/deepLink'
import type { DesktopConfigImport } from '../../src/lib/desktopHost/types'

/**
 * Holds the latest import link until the main window's renderer takes it.
 *
 * The link can arrive before the window exists (cold start from argv or
 * `open-url`) or before React has mounted, so pushing it at arrival time would
 * lose it. The renderer pulls on mount and again on every `notify`.
 */
export class DeepLinkHandler {
  private pending: DesktopConfigImport | null = null

  constructor(private readonly notify: () => void) {}

  handle(url: string): void {
    const action = handleDeepLinkUrl(url)
    this.pending = action?.type === 'config/import'
      ? { config: action.payload, ...(action.apiKey ? { apiKey: action.apiKey } : {}) }
      : { invalid: true }
    // Never log the URL: the provider/add form can carry an API key.
    if ('invalid' in this.pending) console.warn('[DeepLink] Invalid, expired, or unknown link')
    this.notify()
  }

  take(): DesktopConfigImport | null {
    return this.pending
  }

  ack(): void {
    this.pending = null
  }
}

/**
 * Extract deep link from command line args (Windows/Linux)
 */
export function extractDeepLinkFromArgs(args: string[]): string | null {
  const deepLinkArg = args.find(arg => arg.startsWith('echoflowcode://'))
  return deepLinkArg || null
}
