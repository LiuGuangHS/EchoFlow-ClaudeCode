import { describe, it, expect, vi } from 'vitest'

// Mock isLoopbackHostname so previewLinkRouter classifies localhost properly
vi.mock('./desktopRuntime', () => ({
  isLoopbackHostname: (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '::1',
}))

import { openWithContextForHref, openWithContextForWorkspaceFile } from './openWithContextForHref'
import { localFileUrl, previewFsUrl } from './handlePreviewLink'

const BASE = 'http://127.0.0.1:4321'
const SESSION = 's1'

describe('openWithContextForHref', () => {
  it('localhost href → {kind:"url", url}', () => {
    const result = openWithContextForHref('http://localhost:5173/', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toEqual({ kind: 'url', url: 'http://localhost:5173/' })
  })

  it('remote href → {kind:"url", url}', () => {
    const result = openWithContextForHref('https://example.com/page', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toEqual({ kind: 'url', url: 'https://example.com/page' })
  })

  it('relative previewable path with workDir → absolutePath resolved', () => {
    const result = openWithContextForHref('docs/a.md', { sessionId: SESSION, serverBaseUrl: BASE, workDir: '/w' })
    expect(result).toEqual({ kind: 'file', absolutePath: '/w/docs/a.md', relPath: 'docs/a.md', previewable: true })
  })

  it('absolute path in browser-file → inAppBrowserUrl via localFileUrl ($HOME-sandboxed route)', () => {
    const result = openWithContextForHref('/x/p.html', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toEqual({
      kind: 'file',
      absolutePath: '/x/p.html',
      inAppBrowserUrl: localFileUrl(BASE, '/x/p.html'),
    })
  })

  it('#anchor href → null (ignored)', () => {
    const result = openWithContextForHref('#anchor', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toBeNull()
  })

  it('empty href → null', () => {
    const result = openWithContextForHref('', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toBeNull()
  })

  it('relative path with trailing slash on workDir → correct absolutePath', () => {
    const result = openWithContextForHref('src/index.ts', { sessionId: SESSION, serverBaseUrl: BASE, workDir: '/proj/' })
    expect(result).toEqual({ kind: 'file', absolutePath: '/proj/src/index.ts', relPath: 'src/index.ts', previewable: true })
  })
})

describe('openWithContextForWorkspaceFile', () => {
  it('.md rel path → { kind:"file", absolutePath, relPath, previewable:true } with no inAppBrowserUrl', () => {
    const result = openWithContextForWorkspaceFile('README.md', '/w/proj/README.md', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toEqual({ kind: 'file', absolutePath: '/w/proj/README.md', relPath: 'README.md', previewable: true })
  })

  it('frontend project index.html rel path → no inAppBrowserUrl because it needs a dev server', () => {
    const result = openWithContextForWorkspaceFile('todo-app/index.html', '/w/proj/todo-app/index.html', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toEqual({
      kind: 'file',
      absolutePath: '/w/proj/todo-app/index.html',
      relPath: 'todo-app/index.html',
      previewable: true,
    })
  })

  it('built dist index.html rel path → has inAppBrowserUrl equal to previewFsUrl', () => {
    const result = openWithContextForWorkspaceFile('todo-app/dist/index.html', '/w/proj/todo-app/dist/index.html', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result).toEqual({
      kind: 'file',
      absolutePath: '/w/proj/todo-app/dist/index.html',
      relPath: 'todo-app/dist/index.html',
      previewable: true,
      inAppBrowserUrl: previewFsUrl(BASE, SESSION, 'todo-app/dist/index.html'),
    })
  })

  it('.htm extension → also has inAppBrowserUrl', () => {
    const result = openWithContextForWorkspaceFile('page.htm', '/w/proj/page.htm', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result.kind).toBe('file')
    if (result.kind === 'file') {
      expect(result.inAppBrowserUrl).toBeDefined()
      expect(result.inAppBrowserUrl).toBe(previewFsUrl(BASE, SESSION, 'page.htm'))
    }
  })

  it('.ts rel path → no inAppBrowserUrl', () => {
    const result = openWithContextForWorkspaceFile('src/app.ts', '/w/proj/src/app.ts', { sessionId: SESSION, serverBaseUrl: BASE })
    expect(result.kind).toBe('file')
    if (result.kind === 'file') {
      expect(result.inAppBrowserUrl).toBeUndefined()
      expect(result.previewable).toBe(true)
    }
  })
})
