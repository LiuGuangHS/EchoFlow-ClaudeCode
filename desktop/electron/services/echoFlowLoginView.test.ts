import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContentsView } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { EchoFlowLoginViewHost, loginViewBounds } from './echoFlowLoginView'

describe('embedded EchoFlow login', () => {
  it('fits the zoomed settings area inside the window', () => {
    expect(loginViewBounds({ x: 100, y: 20, width: 800, height: 650 }, 1.25, [900, 600]))
      .toEqual({ x: 125, y: 25, width: 775, height: 575 })
    expect(loginViewBounds({ x: -100, y: 20, width: 90, height: 100 }, 1, [900, 600]).width).toBe(0)
  })

  it.each(['authenticated', 'unknown'] as const)('exposes a cancelled view’s %s account result to a remounted renderer', async outcome => {
    const owner = Object.assign(new EventEmitter(), { webContents: new EventEmitter() }) as unknown as BrowserWindow
    const host = new EchoFlowLoginViewHost(vi.fn())
    let complete!: (result: typeof outcome) => void
    const stop = vi.fn()
    const opening = host.open(owner, 'first', null, signal => {
      signal.addEventListener('abort', stop)
      return new Promise(resolve => { complete = resolve })
    }, 'dedicated')
    host.cancel('first')
    expect(stop).toHaveBeenCalledOnce()
    await expect(host.whenAccountSettled('main')).resolves.toBe(false)
    const settled = host.whenAccountSettled('dedicated')
    const settledWithoutEndpoint = host.whenAccountSettled()
    const signInAgain = vi.fn(async () => 'cancelled' as const)
    await expect(host.open(owner, 'second', null, signInAgain)).resolves.toBe('cancelled')
    expect(signInAgain).not.toHaveBeenCalled()
    complete(outcome)
    await expect(opening).resolves.toBe(outcome)
    await expect(settled).resolves.toBe(true)
    await expect(settledWithoutEndpoint).resolves.toBe(true)
    await expect(host.open(owner, 'second', null, signInAgain)).resolves.toBe('cancelled')
    expect(signInAgain).toHaveBeenCalledOnce()
  })

  it('ignores stale controls and releases the view and OAuth popup on host navigation', async () => {
    const renderer = Object.assign(new EventEmitter(), { getZoomFactor: () => 1.25 })
    const owner = Object.assign(new EventEmitter(), {
      webContents: renderer, getContentSize: () => [1000, 720], isDestroyed: () => false,
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    })
    const contents = Object.assign(new EventEmitter(), { close: vi.fn(), isDestroyed: () => false })
    const view = { webContents: contents, setBounds: vi.fn(), setVisible: vi.fn() }
    const makeView = vi.fn(() => view as unknown as WebContentsView)
    const host = new EchoFlowLoginViewHost(makeView)
    const bounds = { x: 200, y: 80, width: 600, height: 400 }
    const result = host.open(owner as unknown as BrowserWindow, 'active', bounds, signal => {
      const login = host.createWindow('persist:echoflow-dedicated-login')
      return new Promise(resolve => signal.addEventListener('abort', () => {
        login.close()
        resolve('cancelled')
      }))
    })
    const popup = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, destroy: vi.fn(), setParentWindow: vi.fn(),
      webContents: { setWindowOpenHandler: vi.fn() },
    })
    contents.emit('did-create-window', popup)
    expect(popup.setParentWindow).toHaveBeenCalledWith(owner)
    expect(makeView).toHaveBeenCalledWith('persist:echoflow-dedicated-login')
    expect(owner.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 250, y: 100, width: 750, height: 500 })
    host.setBounds('stale', null)
    host.cancel('stale')
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(contents.close).not.toHaveBeenCalled()
    host.setBounds('active', null)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    renderer.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    await expect(result).resolves.toBe('cancelled')
    expect(owner.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(contents.close).toHaveBeenCalledOnce()
    expect(popup.destroy).toHaveBeenCalledOnce()
    expect(renderer.listenerCount('did-start-navigation')).toBe(0)
  })
})
