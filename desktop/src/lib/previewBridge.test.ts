import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebviewBounds } from '../components/browser/computeWebviewBounds'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('./desktopRuntime', () => ({ isTauriRuntime: () => true }))

afterEach(() => { invoke.mockReset() })

describe('previewBridge', () => {
  it('openPreview forwards url + bounds to preview_open', async () => {
    const { previewBridge } = await import('./previewBridge')
    const bounds: WebviewBounds = { x: 1, y: 2, width: 3, height: 4 }
    await previewBridge.open('http://localhost/a', bounds)
    expect(invoke).toHaveBeenCalledWith('preview_open', { url: 'http://localhost/a', bounds })
  })

  it('setBounds forwards to preview_set_bounds', async () => {
    const { previewBridge } = await import('./previewBridge')
    await previewBridge.setBounds({ x: 0, y: 0, width: 10, height: 10 })
    expect(invoke).toHaveBeenCalledWith('preview_set_bounds', { bounds: { x: 0, y: 0, width: 10, height: 10 } })
  })

  it('eval forwards js to preview_eval', async () => {
    const { previewBridge } = await import('./previewBridge')
    await previewBridge.eval('window.x=1')
    expect(invoke).toHaveBeenCalledWith('preview_eval', { js: 'window.x=1' })
  })

  it('is a no-op outside the Tauri runtime', async () => {
    vi.resetModules()
    vi.doMock('./desktopRuntime', () => ({ isTauriRuntime: () => false }))
    const { previewBridge } = await import('./previewBridge')
    await previewBridge.open('http://localhost/a', { x: 0, y: 0, width: 1, height: 1 })
    expect(invoke).not.toHaveBeenCalled()
  })
})
