import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providersApi } from '../../api/providers'
import type { EchoFlowAccount } from '../../api/echoflow'
import { browserHost } from '../../lib/desktopHost/browserHost'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { BUNDLED_PROVIDER_PRESETS } from '../../config/providerPresets'
import { translate } from '../../i18n'
import { DesktopSettings } from '../Settings'
import { ProviderSettings } from './ProviderSettings'

vi.mock('../../components/settings/ClaudeOfficialLogin', () => ({ ClaudeOfficialLogin: () => null }))
vi.mock('../../components/settings/ChatGPTOfficialLogin', () => ({ ChatGPTOfficialLogin: () => null }))
vi.mock('../../components/settings/GrokOfficialLogin', () => ({ GrokOfficialLogin: () => null }))
vi.mock('../../components/settings/DeepSeekAccountLogin', () => ({ DeepSeekAccountLogin: () => null }))
vi.mock('../../components/settings/OfficialProviderModelSettings', () => ({ OfficialProviderModelSettings: () => null }))

// Every EchoFlow API method and every desktop host capability is a controlled
// mock: no real web login, no network, no keychain, no real account or token.
const hostMocks = vi.hoisted(() => ({
  openLogin: vi.fn(),
  setLoginBounds: vi.fn(),
  cancelLogin: vi.fn(),
  signOut: vi.fn(),
  whenAccountRestored: vi.fn(),
  open: vi.fn(),
}))
const apiMocks = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  bindAccount: vi.fn(),
  refreshAccount: vi.fn(),
  updateEndpoint: vi.fn(),
  selectToken: vi.fn(),
  getTokenKey: vi.fn(),
  createToken: vi.fn(),
  createProviderFromToken: vi.fn(),
  testProviderFromToken: vi.fn(),
  fetchModelsFromToken: vi.fn(),
  disconnectAccount: vi.fn(),
}))
vi.mock('../../api/echoflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/echoflow')>()
  return { ...actual, echoflowApi: apiMocks }
})

const L = (key: Parameters<typeof translate>[1]) => translate('en', key)
const endpointTab = (endpoint: 'main' | 'dedicated') =>
  L(endpoint === 'main' ? 'echoflowApiOfficialLogin.endpointMain' : 'echoflowApiOfficialLogin.endpointDedicated')

const mainAccount: EchoFlowAccount = {
  userId: 'main-user',
  username: 'Main User',
  endpoint: 'main',
  tokens: [{ id: 'shared-token-id', name: 'Main key', keyPreview: 'sk-main…1234' }],
}

const accountsResponse = (main: EchoFlowAccount | null = mainAccount, dedicated: EchoFlowAccount | null = null) => ({
  account: main,
  accounts: { main, dedicated },
})

describe('ProviderSettings EchoFlow official account entry', () => {
  beforeEach(() => {
    window.desktopHost = {
      ...browserHost,
      capabilities: { ...browserHost.capabilities, echoFlowAccount: true },
      echoFlow: {
        openLogin: hostMocks.openLogin,
        setLoginBounds: hostMocks.setLoginBounds,
        cancelLogin: hostMocks.cancelLogin,
        signOut: hostMocks.signOut,
        whenAccountRestored: hostMocks.whenAccountRestored,
      },
      shell: { ...browserHost.shell, open: hostMocks.open },
    } as unknown as typeof browserHost

    for (const fn of Object.values(hostMocks)) fn.mockReset()
    for (const fn of Object.values(apiMocks)) fn.mockReset()
    hostMocks.whenAccountRestored.mockResolvedValue(false)
    hostMocks.setLoginBounds.mockResolvedValue(undefined)
    hostMocks.cancelLogin.mockResolvedValue(undefined)
    hostMocks.open.mockResolvedValue(undefined)
    hostMocks.signOut.mockResolvedValue(undefined)

    apiMocks.getAccounts.mockResolvedValue(accountsResponse())
    apiMocks.refreshAccount.mockResolvedValue({ account: mainAccount })
    apiMocks.bindAccount.mockResolvedValue({ account: mainAccount })
    apiMocks.updateEndpoint.mockResolvedValue({ account: mainAccount })
    apiMocks.selectToken.mockResolvedValue({ token: { id: 'shared-token-id', name: 'Main key', keyPreview: 'sk-main…1234' } })
    apiMocks.getTokenKey.mockResolvedValue({ token: { id: 'shared-token-id', name: 'Main key', key: 'fake-key' } })
    apiMocks.createToken.mockResolvedValue({ account: mainAccount })
    apiMocks.disconnectAccount.mockResolvedValue({ ok: true })
    apiMocks.createProviderFromToken.mockResolvedValue({ provider: { id: 'new-echoflow' } } as never)
    apiMocks.testProviderFromToken.mockResolvedValue({ result: { ok: true } })
    apiMocks.fetchModelsFromToken.mockResolvedValue({ ok: true, models: [] })

    vi.spyOn(providersApi, 'list').mockResolvedValue({ providers: [], activeId: null })
    vi.spyOn(providersApi, 'getSettings').mockResolvedValue({})
    vi.spyOn(providersApi, 'create').mockResolvedValue({ provider: { id: 'unexpected' } } as never)
    vi.spyOn(useSettingsStore.getState(), 'fetchAll').mockResolvedValue()
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ activeSettingsTab: 'providers', pendingSettingsTab: null })
    useProviderStore.setState({ presets: BUNDLED_PROVIDER_PRESETS })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as { desktopHost?: unknown }).desktopHost
  })

  it('renders the EchoFlow official account entry after the provider panel mounts', async () => {
    render(<ProviderSettings />)
    expect(await screen.findByText(/main-user/)).toBeInTheDocument()
    expect(screen.getByTestId('echoflow-api-official-provider')).toBeInTheDocument()
  })

  it('exposes both main and dedicated endpoint entries inside the card', async () => {
    render(<ProviderSettings />)
    await screen.findByText(/main-user/)
    const card = within(screen.getByTestId('echoflow-api-official-provider'))
    expect(card.getByRole('tab', { name: endpointTab('main') })).toBeInTheDocument()
    expect(card.getByRole('tab', { name: endpointTab('dedicated') })).toBeInTheDocument()
  })

  it('signs in with the selected endpoint and refreshes that account', async () => {
    apiMocks.getAccounts.mockResolvedValueOnce(accountsResponse(null, null))
    apiMocks.refreshAccount.mockReturnValue(new Promise(() => {}))
    hostMocks.openLogin.mockResolvedValue('authenticated')
    render(<ProviderSettings />)

    await waitFor(() => expect(apiMocks.getAccounts).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(hostMocks.openLogin).toHaveBeenCalledWith('main', expect.any(String), null))
    expect(await screen.findByText(/main-user/)).toBeInTheDocument()
    expect(screen.getByTestId('echoflow-account-status').className).toContain('bg-[var(--color-success)]')
    await waitFor(() => expect(apiMocks.refreshAccount).toHaveBeenCalledWith('main'))
  })

  it('keeps the settings rail usable and preserves the account page on cancel', async () => {
    hostMocks.openLogin.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<DesktopSettings />)
    await screen.findByText(/main-user/)
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    const scroller = screen.getByTestId('settings-page-frame').parentElement!
    scroller.scrollTop = 90
    const signIn = screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })
    fireEvent.click(signIn)
    const [, firstId] = hostMocks.openLogin.mock.calls[0]!
    const login = screen.getByRole('region', { name: L('echoflowApiOfficialLogin.signIn') })
    expect(login.parentElement).toBe(scroller.parentElement)
    expect(scroller).toHaveAttribute('inert')
    expect(screen.getByRole('navigation', { name: L('settings.title') })).toBeVisible()
    fireEvent.click(within(login).getByRole('button', { name: L('echoflowApiOfficialLogin.cancel') }))
    expect(hostMocks.cancelLogin).toHaveBeenCalledExactlyOnceWith(firstId)
    expect(scroller).not.toHaveAttribute('inert')
    expect(scroller.scrollTop).toBe(90)
    expect(screen.getByRole('tab', { name: endpointTab('dedicated'), selected: true })).toBeVisible()
    expect(signIn).toHaveFocus()

    fireEvent.click(signIn)
    const [, secondId] = hostMocks.openLogin.mock.calls[1]!
    expect(secondId).not.toEqual(firstId)
    fireEvent.click(screen.getByRole('button', { name: L('settings.tab.about') }))
    expect(hostMocks.cancelLogin).toHaveBeenLastCalledWith(secondId)
    expect(screen.queryByRole('region', { name: L('echoflowApiOfficialLogin.signIn') })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: L('settings.tab.providers') }))
    await screen.findByText(/main-user/)
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    expect(hostMocks.openLogin).toHaveBeenCalledTimes(3)
    const [, thirdId] = hostMocks.openLogin.mock.calls[2]!
    unmount()
    expect(hostMocks.cancelLogin).toHaveBeenLastCalledWith(thirdId)
    expect(hostMocks.cancelLogin).toHaveBeenCalledTimes(3)
  })

  it('does not refresh the account when the desktop login is cancelled or fails', async () => {
    apiMocks.getAccounts.mockResolvedValue(accountsResponse(null, null))
    hostMocks.openLogin
      .mockResolvedValueOnce('cancelled')
      .mockRejectedValueOnce(new Error('embedded login failed'))
    render(<ProviderSettings />)

    fireEvent.click(await screen.findByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(hostMocks.openLogin).toHaveBeenCalledTimes(1))
    expect(apiMocks.refreshAccount).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(screen.getByText(L('echoflowApiOfficialLogin.signInFailed'))).toBeInTheDocument())
    expect(apiMocks.refreshAccount).not.toHaveBeenCalled()
  })

  it('re-reads the accounts when the startup restore finishes', async () => {
    let resolveRestore: (restored: boolean) => void = () => {}
    const mainRestore = new Promise<boolean>((resolve) => { resolveRestore = resolve })
    hostMocks.whenAccountRestored.mockImplementation(endpoint => endpoint === 'main' ? mainRestore : Promise.resolve(false))
    const stored = { ...mainAccount, live: false }
    apiMocks.getAccounts
      .mockResolvedValueOnce(accountsResponse(stored, null))
      .mockResolvedValue(accountsResponse(mainAccount, null))
    render(<ProviderSettings />)

    expect(await screen.findByText(L('echoflowApiOfficialLogin.needsRelogin'))).toBeInTheDocument()
    expect(screen.getByTestId('echoflow-account-status')).not.toHaveClass('bg-[var(--color-success)]')
    expect(screen.getByRole('tab', { name: endpointTab('main') }).querySelector('[aria-hidden="true"]')).not.toHaveClass('bg-[var(--color-success)]')
    expect(apiMocks.getAccounts).toHaveBeenCalledTimes(1)

    await act(async () => { resolveRestore(true) })

    await waitFor(() => expect(screen.queryByText(L('echoflowApiOfficialLogin.needsRelogin'))).not.toBeInTheDocument())
    expect(apiMocks.getAccounts).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /Main key.*sk-main…1234/ })).toBeInTheDocument()
  })

  it('signs out and clears the bound account status', async () => {
    const consoleError = vi.spyOn(console, 'error')
    render(<ProviderSettings />)
    await screen.findByText(/main-user/)
    expect(screen.getByTestId('echoflow-account-status').className).toContain('bg-[var(--color-success)]')

    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.unbind') }))

    await waitFor(() => expect(hostMocks.signOut).toHaveBeenCalledWith('main'))
    await waitFor(() => expect(screen.getByTestId('echoflow-account-status').className).toContain('bg-[var(--color-text-tertiary)]'))
    expect(consoleError.mock.calls.filter(([message]) => String(message).includes('Cannot update a component'))).toEqual([])
  })

  it('keeps the account status bound when the other endpoint remains connected', async () => {
    apiMocks.getAccounts.mockResolvedValue(accountsResponse(mainAccount, { ...mainAccount, endpoint: 'dedicated', userId: 'dedicated-user' }))
    render(<ProviderSettings />)
    await screen.findByText(/main-user/)

    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.unbind') }))

    await waitFor(() => expect(hostMocks.signOut).toHaveBeenCalledWith('main'))
    await waitFor(() => expect(screen.queryByText(/main-user/)).not.toBeInTheDocument())
    expect(screen.getByTestId('echoflow-account-status').className).toContain('bg-[var(--color-success)]')
  })

  it('keeps the entry unbound when no account is stored', async () => {
    apiMocks.getAccounts.mockResolvedValue(accountsResponse(null, null))
    render(<ProviderSettings />)
    await waitFor(() => expect(screen.getByTestId('echoflow-account-status').className).toContain('bg-[var(--color-text-tertiary)]'))
    expect(await screen.findByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })).toBeInTheDocument()
  })

  it('creates a provider from the account token through the real add-from-token callback', async () => {
    render(<ProviderSettings />)

    const tokenButton = await screen.findByRole('button', { name: /Main key.*sk-main…1234/ })
    fireEvent.click(tokenButton)

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByDisplayValue('Main · Main key')).toBeInTheDocument()
    expect(dialog.getByDisplayValue('https://api.echoflowai.cc')).toBeInTheDocument()
    expect(dialog.getByText('sk-main…1234')).toBeInTheDocument()
    expect(dialog.getByText(L('settings.providers.tokenKeyManaged'))).toBeInTheDocument()
    expect(dialog.queryByPlaceholderText('sk-...')).not.toBeInTheDocument()

    fireEvent.change(dialog.getByPlaceholderText(L('settings.providers.modelIdPlaceholder')), {
      target: { value: 'claude-sonnet-4' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(apiMocks.createProviderFromToken).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'main',
      tokenId: 'shared-token-id',
      tokenName: 'Main key',
      keyPreview: 'sk-main…1234',
      baseUrl: 'https://api.echoflowai.cc',
      models: expect.objectContaining({ main: 'claude-sonnet-4' }),
    })))
    expect(providersApi.create).not.toHaveBeenCalled()
  })
})
