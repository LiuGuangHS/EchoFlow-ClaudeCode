import type { BrowserWindow, WebContentsView } from 'electron'
import type { PreviewBounds } from '../../src/lib/desktopHost/types'
import type { EchoFlowLoginEndpoint, EchoFlowLoginResult, EchoFlowLoginWindow } from './echoFlowLogin'

export function loginViewBounds(bounds: PreviewBounds, zoom: number, [width = 0, height = 0]: number[]): PreviewBounds {
  const edge = (value: number, limit: number) => Math.max(0, Math.min(limit, Math.round(value * zoom)))
  const x = edge(bounds.x, width)
  const y = edge(bounds.y, height)
  return {
    x, y,
    width: edge(bounds.x + bounds.width, width) - x,
    height: edge(bounds.y + bounds.height, height) - y,
  }
}

export class EchoFlowLoginViewHost {
  private active: {
    owner: BrowserWindow
    id: string
    endpoint: EchoFlowLoginEndpoint
    bounds: PreviewBounds | null
    abort: AbortController
    result?: Promise<EchoFlowLoginResult>
    view?: WebContentsView
    closeView?: () => void
  } | null = null

  constructor(private readonly makeView: (partition: string) => WebContentsView) {}

  async open(
    owner: BrowserWindow, id: string, bounds: PreviewBounds | null,
    signIn: (signal: AbortSignal) => Promise<EchoFlowLoginResult>,
    endpoint: EchoFlowLoginEndpoint = 'main',
  ): Promise<EchoFlowLoginResult> {
    if (this.active) return 'cancelled'
    const abort = new AbortController()
    const attempt: NonNullable<EchoFlowLoginViewHost['active']> = { owner, id, endpoint, bounds, abort }
    this.active = attempt
    const cancel = () => this.cancel(id)
    const navigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) cancel()
    }
    const resize = () => this.refreshBounds()
    const contents = owner.webContents
    owner.on('hide', cancel)
    owner.on('closed', cancel)
    owner.on('resize', resize)
    contents.on('did-start-navigation', navigate)
    contents.on('render-process-gone', cancel)
    contents.on('destroyed', cancel)
    try {
      attempt.result = signIn(abort.signal)
      return await attempt.result
    } finally {
      if (this.active === attempt) this.active = null
      owner.off('hide', cancel)
      owner.off('closed', cancel)
      owner.off('resize', resize)
      contents.off('did-start-navigation', navigate)
      contents.off('render-process-gone', cancel)
      contents.off('destroyed', cancel)
      attempt.closeView?.()
    }
  }

  async whenAccountSettled(endpoint?: EchoFlowLoginEndpoint): Promise<boolean> {
    const attempt = this.active
    if (endpoint && attempt?.endpoint !== endpoint) return false
    const outcome = await attempt?.result
    return outcome !== undefined && outcome !== 'cancelled'
  }

  setBounds(id: string, bounds: PreviewBounds | null) {
    if (this.active?.id !== id || this.active.abort.signal.aborted) return
    this.active.bounds = bounds
    this.refreshBounds()
  }

  cancel(id: string) {
    if (this.active?.id !== id) return
    this.active.abort.abort()
  }

  refreshBounds() {
    const attempt = this.active
    if (!attempt?.view || attempt.owner.isDestroyed()) return
    const { owner, view, bounds } = attempt
    const rect = bounds && loginViewBounds(bounds, owner.webContents.getZoomFactor(), owner.getContentSize())
    if (rect && rect.width > 0 && rect.height > 0) view.setBounds(rect)
    view.setVisible(Boolean(rect && rect.width > 0 && rect.height > 0))
  }

  createWindow(partition: string): EchoFlowLoginWindow {
    const attempt = this.active
    if (!attempt || attempt.abort.signal.aborted || attempt.owner.isDestroyed()) {
      throw new Error('EchoFlow login has no settings view')
    }
    const { owner } = attempt
    const view = this.makeView(partition)
    const contents = view.webContents
    let popup: BrowserWindow | null = null
    const close = () => {
      if (attempt.view !== view) return
      attempt.view = undefined
      attempt.closeView = undefined
      try {
        if (popup && !popup.isDestroyed()) popup.destroy()
      } finally {
        try {
          if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
        } finally {
          if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
        }
      }
    }
    attempt.view = view
    attempt.closeView = close
    contents.once('destroyed', close)
    contents.once('render-process-gone', close)
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      event.preventDefault()
      this.cancel(attempt.id)
    })
    contents.on('did-create-window', child => {
      if (attempt.view !== view || popup || owner.isDestroyed()) {
        child.destroy()
        return
      }
      popup = child
      child.once('closed', () => { popup = null })
      try {
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        child.setParentWindow(owner)
      } catch {
        popup = null
        if (!child.isDestroyed()) child.destroy()
      }
    })
    try {
      view.setVisible(false)
      owner.contentView.addChildView(view)
      this.refreshBounds()
    } catch (error) {
      close()
      throw error
    }
    return {
      webContents: contents,
      on: (_event, listener) => { contents.once('destroyed', listener) },
      loadURL: url => contents.loadURL(url),
      focus: () => (popup?.webContents ?? contents).focus(),
      close,
    }
  }
}
