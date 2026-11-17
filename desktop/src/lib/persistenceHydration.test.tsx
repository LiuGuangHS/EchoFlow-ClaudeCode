import React from 'react'
import ReactDOM, { type Root } from 'react-dom/client'
import { act, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  renderedEditors: [] as (string | null)[],
  list: vi.fn(),
  listForPath: vi.fn(),
  open: vi.fn(),
}))

vi.mock('../api/openTargets', () => ({ openTargetsApi: mocks }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('../theme/globals.css', () => ({}))
vi.mock('./workspace/persistenceBridge', () => ({ initWorkspacePersistence: vi.fn() }))
vi.mock('../stores/chatAppearanceStore', () => ({ initializeChatAppearance: vi.fn() }))
vi.mock('./touchH5', () => ({ initializeTouchH5: vi.fn() }))
vi.mock('./appZoom', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appZoom')>(),
  initializeAppZoom: vi.fn().mockResolvedValue(1),
}))
vi.mock('../i18n/locale', async (importOriginal) => ({
  ...await importOriginal<typeof import('../i18n/locale')>(),
  initializeLocale: vi.fn().mockResolvedValue('en'),
}))
vi.mock('../lib/diagnosticsCapture', () => ({ installClientDiagnosticsCapture: vi.fn() }))
vi.mock('../stores/uiStore', () => ({ initializeTheme: vi.fn() }))
vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../App', async () => {
  const { useOpenTargetStore } = await import('../stores/openTargetStore')
  return {
    App: () => {
      const editor = useOpenTargetStore((state) => state.editorTargetId)
      mocks.renderedEditors.push(editor)
      return <output aria-label="preferred editor">{editor ?? 'automatic'}</output>
    },
  }
})

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  delete window.__CC_HAHA_BOOTSTRAPPED__
  delete window.__CC_HAHA_SHOW_STARTUP_ERROR__
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('shows the migrated editor on the first render even when its store was imported before main', async () => {
  localStorage.clear()
  localStorage.setItem('cc-haha.persistence.schemaVersion', '9')
  localStorage.setItem('echoflow-code-open-target-preferences', '{"version":1,"editorTargetId":"sublime"}')
  const fetch = vi.fn().mockRejectedValue(new Error('network is forbidden'))
  vi.stubGlobal('fetch', fetch)

  // Static imports may hydrate this store before main runs its migration body.
  const { readOpenTargetPreferences } = await import('../stores/openTargetStore')
  document.body.innerHTML = '<div id="root"></div>'
  const createRoot = ReactDOM.createRoot
  vi.spyOn(ReactDOM, 'createRoot').mockImplementation((...args) => {
    root = createRoot(...args)
    return root
  })

  await act(async () => {
    await import('../main')
  })

  // A copied key alone is insufficient: the already-loaded store must refresh.
  expect(readOpenTargetPreferences().editorTargetId).toBe('sublime')
  expect((await screen.findByLabelText('preferred editor')).textContent).toBe('sublime')
  expect(mocks.renderedEditors.length).toBeGreaterThan(0)
  expect(new Set(mocks.renderedEditors)).toEqual(new Set(['sublime']))
  expect(fetch).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.open).not.toHaveBeenCalled()
})
