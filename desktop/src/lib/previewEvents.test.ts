import { describe, expect, it, vi } from 'vitest'

const listeners: Record<string, (e: { payload: string }) => void> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, cb: (e: { payload: string }) => void) => { listeners[name] = cb; return Promise.resolve(() => {}) },
}))

const prefill = vi.hoisted(() => vi.fn())
vi.mock('../stores/chatStore', () => ({ useChatStore: { getState: () => ({ queueComposerPrefill: prefill }) } }))

import { subscribePreviewEvents } from './previewEvents'
import { useBrowserPanelStore } from '../stores/browserPanelStore'

describe('subscribePreviewEvents', () => {
  it('routes navigated event to the store', async () => {
    useBrowserPanelStore.getState().open('s1', 'http://x/a')
    await subscribePreviewEvents('s1')
    listeners['preview://event']!({ payload: JSON.stringify({ v: 1, type: 'navigated', url: 'http://x/c', title: 'C' }) })
    expect(useBrowserPanelStore.getState().bySession['s1']!.url).toBe('http://x/c')
  })

  it('screenshot event prefills composer with an image attachment', async () => {
    await subscribePreviewEvents('s1')
    listeners['preview://event']!({ payload: JSON.stringify({ v: 1, type: 'screenshot', dataUrl: 'data:image/png;base64,AAAA', kind: 'full' }) })
    expect(prefill).toHaveBeenCalledWith('s1', expect.objectContaining({
      attachments: [expect.objectContaining({ type: 'image', data: 'data:image/png;base64,AAAA' })],
    }))
  })

  it('selection event prefills composer with text + annotated screenshot', async () => {
    await subscribePreviewEvents('s1')
    const payload = { pageUrl: 'http://x/', element: { selector: '#t', tag: 'h1', classes: [] }, change: { description: '改一下' }, screenshot: { dataUrl: 'data:image/png;base64,AAAA', kind: 'element' } }
    listeners['preview://event']!({ payload: JSON.stringify({ v: 1, type: 'selection', payload }) })
    expect(prefill).toHaveBeenCalledWith('s1', expect.objectContaining({
      text: expect.stringContaining('改一下'),
      attachments: [expect.objectContaining({ type: 'image', data: 'data:image/png;base64,AAAA' })],
    }))
  })

  it('selection event resets pickerActive on the session', async () => {
    useBrowserPanelStore.getState().open('s1', 'http://x/a')
    useBrowserPanelStore.getState().setPicker('s1', true)
    await subscribePreviewEvents('s1')
    listeners['preview://event']!({ payload: JSON.stringify({ v: 1, type: 'selection', payload: { pageUrl: 'http://x/', element: { selector: '#t', tag: 'h1', classes: [] }, screenshot: { dataUrl: 'data:image/png;base64,AAAA', kind: 'element' } } }) })
    expect(useBrowserPanelStore.getState().bySession['s1']!.pickerActive).toBe(false)
  })

  it('ignores a malformed selection payload without throwing but still resets picker', async () => {
    useBrowserPanelStore.getState().open('s1', 'http://x/a')
    useBrowserPanelStore.getState().setPicker('s1', true)
    await subscribePreviewEvents('s1')
    expect(() => listeners['preview://event']!({ payload: JSON.stringify({ v: 1, type: 'selection', payload: { pageUrl: 'http://x/' } }) })).not.toThrow()
    expect(useBrowserPanelStore.getState().bySession['s1']!.pickerActive).toBe(false)
  })

  it('picker-exited event resets pickerActive', async () => {
    useBrowserPanelStore.getState().open('s1', 'http://x/a')
    useBrowserPanelStore.getState().setPicker('s1', true)
    await subscribePreviewEvents('s1')
    listeners['preview://event']!({ payload: JSON.stringify({ v: 1, type: 'picker-exited' }) })
    expect(useBrowserPanelStore.getState().bySession['s1']!.pickerActive).toBe(false)
  })
})
