import { handleDeepLinkUrl } from '../../src/lib/deepLink'
import { ELECTRON_EVENT_CHANNELS } from '../ipc/channels'
import type { ShareableConfig } from '../../src/types/configShare'

interface DeepLinkHandlerOptions {
  sendToRenderer: (channel: string, data: any) => void
}

export interface DeepLinkPayload {
  type: 'config-import'
  data: ShareableConfig
}

export class DeepLinkHandler {
  private sendToRenderer: (channel: string, data: any) => void
  private pendingUrl: string | null = null

  constructor(options: DeepLinkHandlerOptions) {
    this.sendToRenderer = options.sendToRenderer
  }

  handle(url: string): void {
    console.log('[DeepLink] Processing:', url)

    const action = handleDeepLinkUrl(url)
    if (!action) {
      console.warn('[DeepLink] Invalid or expired link')
      return
    }

    if (action.type === 'config/import') {
      this.sendToRenderer(ELECTRON_EVENT_CHANNELS.deepLink, {
        type: 'config-import',
        data: action.payload
      })
    } else {
      console.warn('[DeepLink] Unknown action:', action.type)
    }
  }

  setPending(url: string): void {
    this.pendingUrl = url
  }

  updateSender(sender: (channel: string, data: any) => void): void {
    this.sendToRenderer = sender
  }

  flushPending(): void {
    if (this.pendingUrl) {
      this.handle(this.pendingUrl)
      this.pendingUrl = null
    }
  }
}

/**
 * Extract deep link from command line args (Windows/Linux)
 */
export function extractDeepLinkFromArgs(args: string[]): string | null {
  const deepLinkArg = args.find(arg => arg.startsWith('echoflowcode://'))
  return deepLinkArg || null
}
