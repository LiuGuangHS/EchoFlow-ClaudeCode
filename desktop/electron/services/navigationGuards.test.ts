import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  installMainWindowNavigationGuards,
  installPreviewNavigationGuards,
  isHttpUrl,
} from './navigationGuards'

const DEV_ENTRY = 'http://localhost:5173'
const PACKAGED_ENTRY = '/Applications/cc-haha/index.html'
const PACKAGED_URL = 'file:///Applications/cc-haha/index.html'

function fakeWebContents() {
  let windowOpenHandler: ((details: { url: string }) => { action: 'deny' } | { action: 'allow' }) | null = null
  const contents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' } | { action: 'allow' }) {
      windowOpenHandler = handler
    },
  })
  return {
    contents,
    openWindow(url: string) {
      if (!windowOpenHandler) throw new Error('window open handler not installed')
      return windowOpenHandler({ url })
    },
    navigate(url: string) {
      const event = { preventDefault: vi.fn() }
      contents.emit('will-navigate', event, url)
      return event.preventDefault
    },
    redirect(url: string, isMainFrame = true) {
      const event = { preventDefault: vi.fn(), url, isMainFrame }
      contents.emit('will-redirect', event, url, false, isMainFrame)
      return event.preventDefault
    },
  }
}

describe('isHttpUrl', () => {
  it('accepts only http(s) URLs', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })
})

describe('installMainWindowNavigationGuards', () => {
  it('denies popups and routes http(s) ones to the system browser', () => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry: DEV_ENTRY })

    expect(wc.openWindow('https://example.com')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('denies non-http popups without opening anything', () => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry: DEV_ENTRY })

    expect(wc.openWindow('file:///etc/passwd')).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.example/page',
    'http://localhost:5174/',
    'http://127.0.0.1:5173/',
    'http://127.0.0.2:5173/',
    'http://[::1]:5173/',
    'https://localhost:5173/',
    'http://localhost.evil.example:5173/',
    'http://localhost@evil.example/',
  ])('blocks a document outside the configured dev origin: %s', url => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry: DEV_ENTRY })

    expect(wc.navigate(url)).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it.each([
    ['development', DEV_ENTRY, PACKAGED_URL],
    ['packaged', PACKAGED_ENTRY, 'file:///tmp/other.html'],
    ['packaged', PACKAGED_ENTRY, `${PACKAGED_URL}.bak`],
    ['packaged', PACKAGED_ENTRY, 'file://foreign-host/Applications/cc-haha/index.html'],
    ['packaged', PACKAGED_ENTRY, 'javascript:alert(1)'],
    ['packaged', PACKAGED_ENTRY, 'data:text/html,untrusted'],
    ['packaged', PACKAGED_ENTRY, 'not a url'],
  ])('blocks untrusted non-http documents in %s mode: %s -> %s', (_mode, rendererEntry, url) => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry })

    expect(wc.navigate(url)).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('does not allow any dev server when using the packaged entry', () => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry: PACKAGED_ENTRY })

    expect(wc.navigate(DEV_ENTRY)).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(DEV_ENTRY)
  })

  it.each([
    [DEV_ENTRY, DEV_ENTRY],
    [DEV_ENTRY, `${DEV_ENTRY}/?petWindow=1#/chat`],
    [DEV_ENTRY, `${DEV_ENTRY}/settings?theme=dark#/general`],
    [PACKAGED_ENTRY, PACKAGED_URL],
    [PACKAGED_ENTRY, `${PACKAGED_URL}?petWindow=1#/chat`],
  ])('keeps renderer query/hash routes working: %s -> %s', (rendererEntry, url) => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry })

    expect(wc.contents.listenerCount('will-navigate')).toBe(1)
    expect(wc.navigate(url)).not.toHaveBeenCalled()
    expect(wc.redirect(url)).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('blocks a server redirect from the trusted dev origin to an untrusted document', () => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry: DEV_ENTRY })

    expect(wc.navigate(`${DEV_ENTRY}/redirect`)).not.toHaveBeenCalled()
    expect(wc.redirect('http://localhost:9999/untrusted')).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('http://localhost:9999/untrusted')
    expect(wc.redirect('file:///tmp/untrusted.html')).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('leaves subframe navigation and redirects alone', () => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installMainWindowNavigationGuards(wc.contents, { openExternal, rendererEntry: DEV_ENTRY })
    const preventDefault = vi.fn()

    // Electron's will-navigate is main-frame only; iframe events must not be guarded.
    wc.contents.emit('will-frame-navigate', { preventDefault, url: 'https://example.com', isMainFrame: false })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(wc.redirect('https://example.com', false)).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('installPreviewNavigationGuards', () => {
  it('allows in-page http(s) navigation so the preview keeps working as a browser', () => {
    const wc = fakeWebContents()
    installPreviewNavigationGuards(wc.contents, { openExternal: vi.fn() })

    expect(wc.navigate('https://example.com/page')).not.toHaveBeenCalled()
    expect(wc.navigate('http://localhost:8080/page')).not.toHaveBeenCalled()
    expect(wc.redirect('https://example.com/next')).not.toHaveBeenCalled()
  })

  it('blocks navigation to non-http(s) schemes', () => {
    const wc = fakeWebContents()
    installPreviewNavigationGuards(wc.contents, { openExternal: vi.fn() })

    const preventDefault = wc.navigate('file:///etc/passwd')
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('denies popups and routes http(s) ones to the system browser', () => {
    const openExternal = vi.fn()
    const wc = fakeWebContents()
    installPreviewNavigationGuards(wc.contents, { openExternal })

    expect(wc.openWindow('https://example.com')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })
})
