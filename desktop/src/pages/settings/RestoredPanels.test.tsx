import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NetworkSettings } from './NetworkSettings'
import { GeneralSettings } from './GeneralSettings'
import { RuntimeSettings } from './RuntimeSettings'
import { useSettingsStore } from '../../stores/settingsStore'
import { WEB_SEARCH_MODE_VALUES, WEB_SEARCH_MODE_LABEL_KEYS, isValidHttpProxyUrl } from './shared'
import { getDesktopHost } from '@/lib/desktopHost'
import { useSessionStore } from '@/stores/sessionStore'
import { useOpenTargetStore } from '@/stores/openTargetStore'

vi.mock('@/lib/desktopRuntime', () => ({ isDesktopRuntime: () => true }))

// The Runtime cards poll host status on mount. browserHost's implementation
// reaches fetch() with an AbortSignal jsdom rejects, so stub those two calls
// while keeping every other host method from the real browser fallback.
vi.mock('@/lib/desktopHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/desktopHost')>()
  const base = actual.getDesktopHost()
  // A stable host object: RuntimeSettings' refresh callbacks depend on [host],
  // so returning a fresh object on every call would loop its mount effects.
  const stableHost = {
    ...base,
    runtime: {
      ...base.runtime,
      getClaudeCode: vi.fn().mockResolvedValue({ defaultRuntimeId: 'bundled', hasInstalledRuntime: true }),
      setClaudeCode: vi.fn().mockResolvedValue({ defaultRuntimeId: 'installed', hasInstalledRuntime: true }),
    },
    runtimeDiscovery: {
      ...base.runtimeDiscovery,
      list: vi.fn().mockResolvedValue({ installations: [] }),
    },
    deepSeekHarness: {
      ...base.deepSeekHarness,
      getStatus: vi.fn().mockResolvedValue({
        state: 'unavailable', version: null, url: null, error: null, nodeVersion: null, nodeSource: null,
      }),
    },
  }
  return {
    ...actual,
    getDesktopHost: () => stableHost,
  }
})

beforeEach(() => {
  // RuntimeBehaviorSettings loads output styles on mount via this store
  // action. Stub it so the mount effect never reaches fetch() in jsdom,
  // whose undici rejects the helper's AbortSignal.
  useSettingsStore.setState({
    locale: 'en',
    fetchOutputStyles: vi.fn().mockResolvedValue(undefined),
  })
})

afterEach(() => {
  cleanup()
})

describe('shared WebSearch / proxy logic', () => {
  it('offers all six modes including DeepSeek from one shared list', () => {
    expect(WEB_SEARCH_MODE_VALUES).toEqual([
      'auto', 'tavily', 'brave', 'deepseek', 'anthropic', 'disabled',
    ])
    expect(WEB_SEARCH_MODE_LABEL_KEYS.deepseek).toBe('settings.general.webSearch.mode.deepseek')
  })

  it('accepts an authenticated proxy only when credentials are allowed', () => {
    const authenticated = 'http://user:password@127.0.0.1:7890'
    expect(isValidHttpProxyUrl(authenticated, true)).toBe(true)
    expect(isValidHttpProxyUrl(authenticated)).toBe(false)
  })
})

describe('restored Network panel', () => {
  it('renders the DeepSeek search mode and its API key field', () => {
    render(<NetworkSettings />)

    expect(screen.getByRole('button', { name: 'DeepSeek' })).toBeInTheDocument()
    expect(document.querySelector('#web-search-deepseek-key')).toBeInTheDocument()
  })

  it('lets an authenticated proxy URL pass validation (credentials allowed)', async () => {
    useSettingsStore.setState((state) => ({
      network: {
        ...state.network,
        proxy: { ...state.network.proxy, mode: 'manual', url: '' },
      },
    }))
    render(<NetworkSettings />)

    const proxyInput = document.querySelector('#network-proxy-url') as HTMLInputElement
    expect(proxyInput).toBeTruthy()
    fireEvent.change(proxyInput, { target: { value: 'http://user:password@127.0.0.1:7890' } })

    // The invalid-URL message only disappears when the credentials-aware
    // validator (allowCredentials = true) accepts the URL.
    await waitFor(() => {
      expect(screen.queryByText('Enter an HTTP or HTTPS proxy URL.')).not.toBeInTheDocument()
    })
  })
})

describe('shared General and Network settings', () => {
  it('reads settings saved from Network in General and vice versa', async () => {
    const initial = useSettingsStore.getState()
    const initialTargets = useOpenTargetStore.getState()
    const setNetwork = vi.fn(async (network: Parameters<typeof initial.setNetwork>[0]) => { useSettingsStore.setState({ network }) })
    const setWebSearch = vi.fn(async (webSearch: Parameters<typeof initial.setWebSearch>[0]) => { useSettingsStore.setState({ webSearch }) })
    useSettingsStore.setState({
      network: { aiRequestTimeoutMs: 120000, proxy: { mode: 'manual', url: 'http://127.0.0.1:8000' } },
      webSearch: { mode: 'auto', tavilyApiKey: '', braveApiKey: '', deepseekApiKey: '' },
      setNetwork,
      setWebSearch,
      fetchAppMode: vi.fn().mockResolvedValue(undefined),
    })
    useOpenTargetStore.setState({ ensureTargets: vi.fn().mockResolvedValue(undefined) })
    try {
      const view = render(<NetworkSettings />)
      fireEvent.change(document.querySelector('#network-proxy-url')!, { target: { value: 'http://127.0.0.1:9000' } })
      fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
      await waitFor(() => expect(setNetwork).toHaveBeenCalled())
      fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }))
      fireEvent.change(document.querySelector('#web-search-deepseek-key')!, { target: { value: 'fake-network-key' } })
      fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!)
      await waitFor(() => expect(setWebSearch).toHaveBeenCalled())
      view.unmount()

      const general = render(<GeneralSettings />)
      expect(document.querySelector('#network-proxy-url')).toHaveValue('http://127.0.0.1:9000')
      expect(document.querySelector('#web-search-deepseek-key')).toHaveValue('fake-network-key')
      expect(screen.getByRole('radio', { name: 'DeepSeek' })).toBeChecked()
      fireEvent.change(document.querySelector('#network-proxy-url')!, { target: { value: 'http://127.0.0.1:9100' } })
      const networkSection = screen.getByRole('heading', { name: 'Network' }).closest('section')!
      fireEvent.click(within(networkSection).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(useSettingsStore.getState().network.proxy.url).toBe('http://127.0.0.1:9100'))
      fireEvent.change(document.querySelector('#web-search-deepseek-key')!, { target: { value: 'fake-general-key' } })
      const searchSection = document.querySelector('#web-search-deepseek-key')!.closest('section')!
      fireEvent.click(within(searchSection).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(useSettingsStore.getState().webSearch.deepseekApiKey).toBe('fake-general-key'))
      general.unmount()
      render(<NetworkSettings />)
      expect(document.querySelector('#network-proxy-url')).toHaveValue('http://127.0.0.1:9100')
      expect(document.querySelector('#web-search-deepseek-key')).toHaveValue('fake-general-key')
    } finally {
      cleanup()
      useSettingsStore.setState(initial)
      useOpenTargetStore.setState(initialTargets)
    }
  })
})

describe('restored Runtime panel', () => {
  it('changes only the default runtime without replaying or replacing the active session', async () => {
    const sessionsBefore = useSessionStore.getState()
    const fetch = vi.spyOn(globalThis, 'fetch')
    try {
      render(<RuntimeSettings />)
      await waitFor(() => expect(getDesktopHost().runtime.getClaudeCode).toHaveBeenCalled())
      fireEvent.click(screen.getByRole('button', { name: 'CLI runtime' }))
      fireEvent.click(screen.getByRole('option', { name: 'Claude Code on this computer' }))
      await waitFor(() => expect(getDesktopHost().runtime.setClaudeCode).toHaveBeenCalledWith('installed'))
      expect(useSessionStore.getState().activeSessionId).toBe(sessionsBefore.activeSessionId)
      expect(useSessionStore.getState().sessions).toBe(sessionsBefore.sessions)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })

  it('mounts the behaviour, discovery, Claude Code and DeepSeek harness cards', async () => {
    render(<RuntimeSettings />)

    await waitFor(() => {
      expect(screen.getAllByText('Runtime management').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Output Style').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Installed runtimes').length).toBeGreaterThan(0)
      expect(screen.getAllByText('EchoFlow Agent runtime').length).toBeGreaterThan(0)
      expect(screen.getAllByText('DeepSeek Harness').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'CLI runtime' })).toBeInTheDocument()
      for (const title of ['Ultracode', 'Agent Teams', 'Automatic question answers', 'Auto-dream']) {
        expect(screen.getByText(title)).toBeInTheDocument()
      }
    })
  })
})
