import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { translate } from '../../i18n'
import type { EchoFlowAccount } from '../../api/echoflow'
import { ApiError } from '../../api/client'

// The component routes every label through t(). Deriving the expected strings from
// translate() (and pinning a non-default locale) is what keeps these assertions
// load-bearing: hardcoding the label again would render the wrong locale and fail.
const L = (key: Parameters<typeof translate>[1]) => translate('en', key)
const userIdSummary = (id: string) => new RegExp(`${L('echoflowApiOfficialLogin.userId')}：${id}`)
const endpointTab = (endpoint: 'main' | 'dedicated') =>
  L(endpoint === 'main' ? 'echoflowApiOfficialLogin.endpointMain' : 'echoflowApiOfficialLogin.endpointDedicated')
const bindLabel = (endpoint: 'main' | 'dedicated') =>
  translate('en', 'echoflowApiOfficialLogin.bindAccount', { endpoint: endpointTab(endpoint) })

vi.mock('../../api/echoflow')
const hostMocks = vi.hoisted(() => ({
  openLogin: vi.fn(),
  setLoginBounds: vi.fn(),
  cancelLogin: vi.fn(),
  signOut: vi.fn(),
  whenAccountRestored: vi.fn(),
  open: vi.fn(),
  echoFlowAccount: true,
}))
vi.mock('@/lib/desktopHost', () => ({
  getDesktopHost: () => ({
    capabilities: { echoFlowAccount: hostMocks.echoFlowAccount },
    echoFlow: hostMocks,
    shell: { open: hostMocks.open },
  }),
}))
let EchoFlowAPIOfficialLogin: typeof import('./EchoFlowAPIOfficialLogin').EchoFlowAPIOfficialLogin
let echoflowApi: typeof import('../../api/echoflow').echoflowApi

const mainAccount = {
  userId: 'main-user',
  username: 'Main User',
  balance: 12.5,
  endpoint: 'main' as const,
  tokens: [{ id: 'shared-token-id', name: 'Main key', keyPreview: 'sk-main…1234' }],
}

const dedicatedAccount = {
  userId: 'dedicated-user',
  username: 'Dedicated refreshed',
  balance: 18.5,
  endpoint: 'dedicated' as const,
  tokens: [{ id: 'shared-token-id', name: 'Dedicated key', keyPreview: 'sk-dedicated…5678' }],
}

function mockAccounts(main: EchoFlowAccount | null = mainAccount, dedicated: EchoFlowAccount | null = dedicatedAccount) {
  vi.mocked(echoflowApi.getAccounts).mockResolvedValue({
    account: main,
    accounts: { main, dedicated },
  })
}

describe('EchoFlowAPIOfficialLogin', () => {
  beforeAll(async () => {
    ;({ EchoFlowAPIOfficialLogin } = await import('./EchoFlowAPIOfficialLogin'))
    ;({ echoflowApi } = await import('../../api/echoflow'))
    echoflowApi.getAccounts = vi.fn()
    echoflowApi.bindAccount = vi.fn()
    echoflowApi.refreshAccount = vi.fn()
    echoflowApi.disconnectAccount = vi.fn()
    echoflowApi.getTokenKey = vi.fn()
    echoflowApi.createToken = vi.fn()
  })
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useProviderStore.setState({ providers: [], activeId: null })
    vi.mocked(echoflowApi.getAccounts).mockReset()
    vi.mocked(echoflowApi.bindAccount).mockReset()
    vi.mocked(echoflowApi.refreshAccount).mockReset()
    vi.mocked(echoflowApi.disconnectAccount).mockReset()
    vi.mocked(echoflowApi.getTokenKey).mockReset()
    vi.mocked(echoflowApi.createToken).mockReset()
    hostMocks.open.mockReset()
    hostMocks.open.mockResolvedValue(undefined)
    vi.mocked(echoflowApi.getTokenKey).mockResolvedValue({ token: { id: 'shared-token-id', name: 'Main key', key: 'sk-main-secret' } })
    hostMocks.openLogin.mockReset()
    hostMocks.setLoginBounds.mockReset().mockResolvedValue(undefined)
    hostMocks.cancelLogin.mockReset().mockResolvedValue(undefined)
    hostMocks.signOut.mockReset()
    hostMocks.whenAccountRestored.mockReset()
    hostMocks.whenAccountRestored.mockResolvedValue(false)
    hostMocks.echoFlowAccount = true
    mockAccounts()
  })

  afterEach(() => {
    cleanup()
    useProviderStore.setState({ providers: [], activeId: null })
    vi.restoreAllMocks()
  })

  it('keeps account management focused on accounts instead of repeating the active token provider', async () => {
    const activeProvider = {
      id: 'echoflow-dedicated',
      presetId: 'echoflowai',
      name: '专线 · Code',
      apiKey: '',
      keyPreview: 'sk-mc****Dbj8',
      baseUrl: 'https://expapi.echoflowai.cc',
      apiFormat: 'anthropic' as const,
      models: { main: 'code', haiku: 'code', sonnet: 'code', opus: 'code' },
    }
    useProviderStore.setState({ providers: [activeProvider], activeId: activeProvider.id })

    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Main key.*sk-main…1234/ })).toBeInTheDocument()
    expect(screen.queryByText('专线 · Code')).not.toBeInTheDocument()
    expect(screen.queryByText('sk-mc****Dbj8')).not.toBeInTheDocument()
    expect(useProviderStore.getState().providers).toContainEqual(activeProvider)
  })

  it.each(['main', 'dedicated'] as const)('embeds sign-in for %s and only refreshes that account', async (endpoint) => {
    mockAccounts(null, null)
    let resolveLogin!: (result: 'authenticated') => void
    hostMocks.openLogin.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve }))
    const signedIn = endpoint === 'main' ? mainAccount : dedicatedAccount
    vi.mocked(echoflowApi.refreshAccount).mockResolvedValue({ account: signedIn })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: endpointTab(endpoint) }))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    expect(screen.getByRole('region', { name: L('echoflowApiOfficialLogin.signIn') })).toBeInTheDocument()
    expect(screen.getByText(endpointTab(endpoint), { selector: 'header p' })).toBeVisible()
    expect(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.cancel') })).toHaveFocus()
    expect(hostMocks.openLogin).toHaveBeenCalledExactlyOnceWith(endpoint, expect.any(String), null)
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()

    let resolveAccounts!: (accounts: Awaited<ReturnType<typeof echoflowApi.getAccounts>>) => void
    let rejectRefresh!: (error: Error) => void
    vi.mocked(echoflowApi.getAccounts).mockReturnValueOnce(new Promise(resolve => { resolveAccounts = resolve }))
    vi.mocked(echoflowApi.refreshAccount).mockReturnValueOnce(new Promise((_, reject) => { rejectRefresh = reject }))
    await act(async () => { resolveLogin('authenticated') })
    expect(screen.queryByRole('region', { name: L('echoflowApiOfficialLogin.signIn') })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })).toHaveFocus()
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()

    const accounts = endpoint === 'main' ? { main: signedIn, dedicated: null } : { main: null, dedicated: signedIn }
    mockAccounts(accounts.main, accounts.dedicated)
    await act(async () => { resolveAccounts({ account: accounts.main, accounts }) })
    expect(screen.getByText(userIdSummary(signedIn.userId))).toBeVisible()
    expect(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })).toHaveFocus()
    expect(echoflowApi.refreshAccount).toHaveBeenCalledExactlyOnceWith(endpoint)
    expect(hostMocks.cancelLogin).not.toHaveBeenCalled()

    await act(async () => { rejectRefresh(new Error('offline')) })
    expect(screen.getByRole('alert')).toHaveTextContent(L('echoflowApiOfficialLogin.refreshFailed'))
    expect(screen.getByText(userIdSummary(signedIn.userId))).toBeVisible()
  })

  it('reports local account-read and remote refresh failures separately after confirmed sign-in', async () => {
    mockAccounts(null, null)
    hostMocks.openLogin.mockResolvedValue('authenticated')
    vi.mocked(echoflowApi.refreshAccount).mockRejectedValue(new Error('remote offline'))
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    await act(async () => {})
    vi.mocked(echoflowApi.getAccounts).mockRejectedValue(new Error('local unavailable'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
      L('echoflowApiOfficialLogin.loadFailed'),
      L('echoflowApiOfficialLogin.refreshFailed'),
    ]))
  })

  it('does not apply a superseded login refresh after disconnecting the same line', async () => {
    mockAccounts(mainAccount, dedicatedAccount)
    hostMocks.openLogin.mockResolvedValue('authenticated')
    hostMocks.signOut.mockResolvedValue(undefined)
    let resolveRefresh!: (result: { account: EchoFlowAccount }) => void
    vi.mocked(echoflowApi.refreshAccount).mockReturnValue(new Promise(resolve => { resolveRefresh = resolve }))
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    await screen.findByText(userIdSummary(mainAccount.userId))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(echoflowApi.refreshAccount).toHaveBeenCalledExactlyOnceWith('main'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.unbind') }))
    await waitFor(() => expect(screen.queryByText(userIdSummary(mainAccount.userId))).not.toBeInTheDocument())
    await act(async () => { resolveRefresh({ account: mainAccount }) })
    expect(screen.queryByText(userIdSummary(mainAccount.userId))).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByText(userIdSummary(dedicatedAccount.userId))).toBeVisible()
  })

  it('checks an unknown outcome locally, without resubmitting or borrowing the other line’s account', async () => {
    mockAccounts(null, dedicatedAccount)
    hostMocks.openLogin.mockResolvedValue('unknown')
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    const status = await screen.findByText(L('echoflowApiOfficialLogin.signInUnknown'))
    expect(status).toHaveRole('status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: L('echoflowApiOfficialLogin.signIn') })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByText(userIdSummary(dedicatedAccount.userId))).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    mockAccounts(mainAccount, null)
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('main') }))
    expect(await screen.findByText(userIdSummary(mainAccount.userId))).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(hostMocks.openLogin).toHaveBeenCalledTimes(1)
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()
    expect(echoflowApi.bindAccount).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByText(userIdSummary(dedicatedAccount.userId))).toBeVisible()
  })

  it('keeps checking an unknown result when the initial account read has not settled', async () => {
    mockAccounts(mainAccount, null)
    vi.mocked(echoflowApi.getAccounts).mockReturnValueOnce(new Promise(() => {}))
    hostMocks.openLogin.mockResolvedValue('unknown')
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    expect(await screen.findByText(userIdSummary(mainAccount.userId))).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(L('echoflowApiOfficialLogin.signInUnknown'))
    mockAccounts({ ...mainAccount, userId: 'late-web-user' }, null)
    expect(await screen.findByText(userIdSummary('late-web-user'))).toBeVisible()
  })

  it.each(['pending', 'settled'] as const)('reconciles an earlier %s binding when an immediate retry is cancelled', async (phase) => {
    mockAccounts(null, null)
    let resolveLogin!: (result: 'authenticated' | 'unknown') => void
    const opening = new Promise<'authenticated' | 'unknown'>(resolve => { resolveLogin = resolve })
    hostMocks.openLogin.mockReturnValueOnce(opening).mockImplementationOnce(async () => {
      if (phase === 'settled') resolveLogin('unknown')
      return 'cancelled'
    })
    if (phase === 'pending') {
      hostMocks.whenAccountRestored.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
        .mockImplementation(endpoint => endpoint === 'main' ? opening.then(() => true) : Promise.resolve(false))
    }
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    const signIn = () => fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    signIn()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.cancel') }))
    await act(async () => { signIn() })
    expect(hostMocks.openLogin).toHaveBeenCalledTimes(2)

    mockAccounts(mainAccount, null)
    if (phase === 'pending') await act(async () => { resolveLogin('authenticated') })
    expect(await screen.findByText(userIdSummary(mainAccount.userId))).toBeVisible()
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()
  })

  it('releases a failed bind while rereading the existing account', async () => {
    mockAccounts(mainAccount, null)
    type AccountSnapshot = Awaited<ReturnType<typeof echoflowApi.getAccounts>>
    let resolveInitial!: (value: AccountSnapshot) => void
    let resolveReread!: (value: AccountSnapshot) => void
    vi.mocked(echoflowApi.getAccounts)
      .mockReturnValueOnce(new Promise(resolve => { resolveInitial = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveReread = resolve }))
    vi.mocked(echoflowApi.bindAccount).mockRejectedValue(new Error('invalid token'))
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'manual-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'invalid-token' } })
    fireEvent.click(screen.getByRole('button', { name: bindLabel('main') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(L('echoflowApiOfficialLogin.bindFailed'))
    expect(screen.getByRole('button', { name: bindLabel('main') })).toBeEnabled()
    const snapshot = { account: mainAccount, accounts: { main: mainAccount, dedicated: null } }
    await act(async () => { resolveInitial(snapshot) })
    expect(screen.queryByText(userIdSummary(mainAccount.userId))).not.toBeInTheDocument()
    await act(async () => { resolveReread(snapshot) })
    expect(screen.getByText(userIdSummary(mainAccount.userId))).toBeVisible()
  })

  it('preserves a manually entered user ID during an unknown-result reread', async () => {
    mockAccounts(mainAccount, null)
    hostMocks.openLogin.mockResolvedValue('unknown')
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    await screen.findByText(userIdSummary(mainAccount.userId))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await screen.findByText(L('echoflowApiOfficialLogin.signInUnknown'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.updateToken') }))
    const userId = screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId'))
    fireEvent.change(userId, { target: { value: 'manually-entered' } })
    mockAccounts({ ...mainAccount, userId: 'new-web-user' }, null)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(userId).toHaveValue('manually-entered')
  })

  it('bounds account reads when the outcome remains unknown', async () => {
    mockAccounts(mainAccount, null)
    hostMocks.openLogin.mockResolvedValue('unknown')
    await act(async () => { render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />) })
    vi.useFakeTimers()
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(echoflowApi.getAccounts).toHaveBeenCalledTimes(4)
      expect(screen.getByRole('status')).toHaveTextContent(L('echoflowApiOfficialLogin.signInUnknown'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(hostMocks.openLogin).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends raw CSS bounds, hides under overlapping UI, and reconciles an unknown result after Escape', async () => {
    mockAccounts(null, null)
    let resolveLogin!: (result: 'unknown') => void
    hostMocks.openLogin.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve }))
    let rect = new DOMRect(245.5, 120, 403.25, 270)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'echoflow-login-placeholder' ? rect : new DOMRect()
    })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    const signIn = screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })
    fireEvent.click(signIn)
    const [, id] = hostMocks.openLogin.mock.calls[0]!
    expect(hostMocks.openLogin).toHaveBeenCalledWith('main', id, { x: 245.5, y: 120, width: 403.25, height: 270 })
    rect = new DOMRect(230, 120, 360, 270)
    fireEvent.resize(window)
    expect(hostMocks.setLoginBounds).toHaveBeenLastCalledWith(id, { x: 230, y: 120, width: 360, height: 270 })

    const overlay = document.createElement('div')
    overlay.className = 'z-[var(--z-dropdown)]'
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(570, 128, 70, 32))
    document.body.append(overlay)
    await waitFor(() => expect(hostMocks.setLoginBounds).toHaveBeenLastCalledWith(id, null))
    overlay.remove()
    await waitFor(() => expect(hostMocks.setLoginBounds).toHaveBeenLastCalledWith(id, { x: 230, y: 120, width: 360, height: 270 }))

    fireEvent.keyDown(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.cancel') }), { key: 'Escape' })
    expect(hostMocks.cancelLogin).toHaveBeenCalledExactlyOnceWith(id)
    expect(signIn).toHaveFocus()
    mockAccounts(mainAccount, null)
    await act(async () => { resolveLogin('unknown') })
    expect(screen.getByText(userIdSummary(mainAccount.userId))).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()
  })

  it.each(['authenticated', 'unknown'] as const)('rereads the account when a %s result settles from a previous mount', async (outcome) => {
    const previous = { ...mainAccount, userId: 'previous-user' }
    mockAccounts(outcome === 'unknown' ? previous : null, null)
    let resolveLogin!: (result: typeof outcome) => void
    const opening = new Promise<typeof outcome>(resolve => { resolveLogin = resolve })
    hostMocks.openLogin.mockReturnValue(opening)
    const first = render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    const [, id] = hostMocks.openLogin.mock.calls[0]!
    first.unmount()
    expect(hostMocks.cancelLogin).toHaveBeenCalledExactlyOnceWith(id)

    hostMocks.whenAccountRestored.mockImplementation(endpoint => endpoint === 'main' ? opening.then(() => true) : Promise.resolve(false))
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    if (outcome === 'authenticated') mockAccounts(mainAccount, null)
    await act(async () => { resolveLogin(outcome) })
    if (outcome === 'unknown') {
      expect(screen.getByText(userIdSummary(previous.userId))).toBeVisible()
      mockAccounts(mainAccount, null)
    }
    expect(await screen.findByText(userIdSummary(mainAccount.userId))).toBeVisible()
    expect(hostMocks.openLogin).toHaveBeenCalledTimes(1)
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each(['main', 'dedicated'] as const)('keeps web authorization available for a bound %s account without disconnecting it', async (endpoint) => {
    mockAccounts({ ...mainAccount, live: true }, { ...dedicatedAccount, live: true })
    hostMocks.openLogin.mockResolvedValue('cancelled')
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    await screen.findByText(userIdSummary('main-user'))

    fireEvent.click(screen.getByRole('tab', { name: endpointTab(endpoint) }))
    expect(hostMocks.openLogin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(hostMocks.openLogin).toHaveBeenCalledExactlyOnceWith(endpoint, expect.any(String), null))
    expect(echoflowApi.disconnectAccount).not.toHaveBeenCalled()
    expect(hostMocks.signOut).not.toHaveBeenCalled()
    expect(echoflowApi.refreshAccount).not.toHaveBeenCalled()
    expect(screen.getByText(userIdSummary(endpoint === 'main' ? 'main-user' : 'dedicated-user'))).toBeInTheDocument()
  })

  it('does not let a late initial account read undo a completed login', async () => {
    let resolveInitial: (value: Awaited<ReturnType<typeof echoflowApi.getAccounts>>) => void = () => {}
    vi.mocked(echoflowApi.getAccounts).mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve }))
    hostMocks.openLogin.mockResolvedValue('authenticated')
    vi.mocked(echoflowApi.refreshAccount).mockResolvedValue({ account: mainAccount })

    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()

    await act(async () => { resolveInitial({ account: null, accounts: { main: null, dedicated: dedicatedAccount } }) })
    expect(screen.getByText(userIdSummary('main-user'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByText(userIdSummary('dedicated-user'))).toBeInTheDocument()
  })

  it.each(['desktop', 'browser', 'unmounted'] as const)('uses the manual token form with %s settlement behavior', async (mode) => {
    mockAccounts(null, null)
    hostMocks.echoFlowAccount = mode !== 'browser'
    vi.mocked(echoflowApi.bindAccount).mockResolvedValue({ account: dedicatedAccount })
    const view = render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(L('echoflowApiOfficialLogin.manualBind'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'manual-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'manual-token' } })
    let resolveSettlement!: (changed: boolean) => void
    hostMocks.whenAccountRestored.mockClear().mockReturnValueOnce(new Promise(resolve => { resolveSettlement = resolve }))
    fireEvent.click(screen.getByRole('button', { name: bindLabel('dedicated') }))

    if (mode === 'browser') {
      expect(hostMocks.whenAccountRestored).not.toHaveBeenCalled()
    } else {
      expect(hostMocks.whenAccountRestored).toHaveBeenCalledExactlyOnceWith('dedicated')
      expect(echoflowApi.bindAccount).not.toHaveBeenCalled()
    }
    if (mode === 'unmounted') view.unmount()
    await act(async () => { resolveSettlement(true) })
    if (mode === 'unmounted') expect(echoflowApi.bindAccount).not.toHaveBeenCalled()
    else expect(echoflowApi.bindAccount).toHaveBeenCalledExactlyOnceWith('dedicated', 'manual-user', 'manual-token')
  })

  it('asks for a new sign-in when the stored session is no longer live', async () => {
    mockAccounts({ ...mainAccount, live: false }, null)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(L('echoflowApiOfficialLogin.needsRelogin'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })).toBeInTheDocument()
  })

  // The desktop restores the stored session in the background after a restart,
  // so the first read can land before the account has a live credential. The
  // card has to read again once the restore settles, or a signed-in account
  // keeps showing "sign in again" until the user reopens settings.
  it('re-reads the accounts when the startup restore finishes', async () => {
    let resolveRestore: (restored: boolean) => void = () => {}
    hostMocks.whenAccountRestored.mockReturnValue(new Promise<boolean>((resolve) => { resolveRestore = resolve }))
    const stored = { ...mainAccount, live: false }
    vi.mocked(echoflowApi.getAccounts)
      .mockResolvedValueOnce({ account: stored, accounts: { main: stored, dedicated: null } })
      .mockResolvedValue({ account: mainAccount, accounts: { main: mainAccount, dedicated: null } })

    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    expect(await screen.findByText(L('echoflowApiOfficialLogin.needsRelogin'))).toBeInTheDocument()

    resolveRestore(true)

    await waitFor(() => expect(screen.queryByText(L('echoflowApiOfficialLogin.needsRelogin'))).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Main key.*sk-main…1234/ })).toBeInTheDocument()
  })

  it('ignores an earlier accounts read that lands after the restore refetch', async () => {
    let resolveFirst: (value: Awaited<ReturnType<typeof echoflowApi.getAccounts>>) => void = () => {}
    const stored = { ...mainAccount, live: false }
    vi.mocked(echoflowApi.getAccounts)
      .mockReturnValueOnce(new Promise<Awaited<ReturnType<typeof echoflowApi.getAccounts>>>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValue({ account: mainAccount, accounts: { main: mainAccount, dedicated: null } })
    hostMocks.whenAccountRestored.mockResolvedValue(true)

    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /Main key.*sk-main…1234/ })).toBeInTheDocument()

    await act(async () => {
      resolveFirst({ account: stored, accounts: { main: stored, dedicated: null } })
    })

    expect(screen.queryByText(L('echoflowApiOfficialLogin.needsRelogin'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Main key.*sk-main…1234/ })).toBeInTheDocument()
  })

  it('offers sign-in again when a refresh discovers the credential was rejected', async () => {
    vi.mocked(echoflowApi.getAccounts)
      .mockResolvedValueOnce({ account: mainAccount, accounts: { main: mainAccount, dedicated: null } })
      .mockResolvedValue({ account: null, accounts: { main: { ...mainAccount, live: false }, dedicated: null } })
    vi.mocked(echoflowApi.refreshAccount).mockRejectedValue(new Error('token_invalid'))

    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)
    await screen.findByText(userIdSummary('main-user'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.refresh') }))

    expect(await screen.findByRole('button', { name: L('echoflowApiOfficialLogin.signIn') })).toBeInTheDocument()
    expect(screen.getByText(L('echoflowApiOfficialLogin.refreshFailed'))).toBeInTheDocument()
  })

  it('shows one endpoint account at a time and keeps the account data isolated', async () => {
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    expect(screen.queryByText(userIdSummary('dedicated-user'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))

    expect(screen.getByText(userIdSummary('dedicated-user'))).toBeInTheDocument()
    expect(screen.queryByText(userIdSummary('main-user'))).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: endpointTab('dedicated') })).toBeInTheDocument()
    expect(screen.queryByText('management-main-secret')).not.toBeInTheDocument()
  })

  it('keeps binding credentials separate for each endpoint', async () => {
    mockAccounts(null, null)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    const userId = await screen.findByPlaceholderText(L('echoflowApiOfficialLogin.userId'))
    const managementToken = screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))
    fireEvent.change(userId, { target: { value: 'main-user' } })
    fireEvent.change(managementToken, { target: { value: 'main-management-secret' } })

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'dedicated-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'dedicated-management-secret' } })

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('main') }))

    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId'))).toHaveValue('main-user')
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).toHaveValue('main-management-secret')
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId'))).toHaveValue('dedicated-user')
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).toHaveValue('dedicated-management-secret')
  })

  it('emits only endpoint-scoped token metadata when a key is selected', async () => {
    const onAddFromToken = vi.fn()
    render(<EchoFlowAPIOfficialLogin onAddFromToken={onAddFromToken} />)

    await screen.findByText(userIdSummary('main-user'))
    const tokenButton = screen.getByRole('button', { name: /Main key.*sk-main…1234/ })
    fireEvent.click(tokenButton)

    expect(onAddFromToken).toHaveBeenCalledWith({
      endpoint: 'main',
      tokenId: 'shared-token-id',
      tokenName: 'Main key',
      keyPreview: 'sk-main…1234',
    })
    expect(echoflowApi.getTokenKey).not.toHaveBeenCalled()
    expect(onAddFromToken.mock.calls[0]?.[0]).not.toHaveProperty('key')
    expect(onAddFromToken.mock.calls[0]?.[0]).not.toHaveProperty('managementToken')
  })

  it('keeps binding credentials scoped to the selected endpoint', async () => {
    mockAccounts(null, null)
    vi.mocked(echoflowApi.bindAccount).mockImplementation(async (endpoint: 'main' | 'dedicated', userId: string) => ({
      account: {
        userId,
        username: endpoint === 'main' ? 'Main bound' : 'Dedicated bound',
        endpoint,
        tokens: [{
          id: `${endpoint}-token-id`,
          name: `${endpoint} key`,
          keyPreview: `sk-${endpoint}…1234`,
        }],
      },
    }))
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    const mainUserId = await screen.findByPlaceholderText(L('echoflowApiOfficialLogin.userId'))
    fireEvent.change(mainUserId, { target: { value: 'main-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'main-management-secret' } })
    fireEvent.click(screen.getByRole('button', { name: bindLabel('main') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.bindAccount)).toHaveBeenCalledWith('main', 'main-user', 'main-management-secret'))
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId'))).toHaveValue('')
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).toHaveValue('')

    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'dedicated-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'dedicated-management-secret' } })
    fireEvent.click(screen.getByRole('button', { name: bindLabel('dedicated') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.bindAccount)).toHaveBeenCalledWith('dedicated', 'dedicated-user', 'dedicated-management-secret'))
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('main') }))
    expect(screen.getByText(userIdSummary('main-user'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /main key.*sk-main…1234/ })).toBeInTheDocument()
  })

  it('disconnects only the selected endpoint account', async () => {
    hostMocks.signOut.mockResolvedValue(undefined)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    await screen.findByText(userIdSummary('main-user'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.unbind') }))

    await waitFor(() => expect(hostMocks.signOut).toHaveBeenCalledWith('main'))
    expect(screen.queryByText(userIdSummary('main-user'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    expect(screen.getByText(userIdSummary('dedicated-user'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dedicated key.*sk-dedicated…5678/ })).toBeInTheDocument()
  })

  it('still disconnects in a browser host that cannot clear the sign-in cookies', async () => {
    hostMocks.echoFlowAccount = false
    vi.mocked(echoflowApi.disconnectAccount).mockResolvedValue({ ok: true })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    await screen.findByText(userIdSummary('main-user'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.unbind') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.disconnectAccount)).toHaveBeenCalledWith('main'))
    expect(hostMocks.signOut).not.toHaveBeenCalled()
    expect(screen.queryByText(userIdSummary('main-user'))).not.toBeInTheDocument()
  })

  it('refreshes only the selected endpoint account', async () => {
    vi.mocked(echoflowApi.refreshAccount).mockResolvedValue({
      account: {
        ...dedicatedAccount,
        username: 'Dedicated refreshed',
        balance: 18.5,
      },
    })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    await screen.findByText(userIdSummary('main-user'))
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.refresh') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.refreshAccount)).toHaveBeenCalledWith('dedicated'))
    expect(screen.getByText(/Dedicated refreshed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: endpointTab('main') }))
    expect(screen.getByText(/Main User/)).toBeInTheDocument()
    expect(screen.queryByText(/Dedicated refreshed/)).not.toBeInTheDocument()
  })

  // Regression anchor. The bind button used to be a raw <button> carrying
  // `bg-brand text-white disabled:opacity-50`. Because the button starts
  // disabled — both credential fields are empty — the 50% opacity composited
  // the ink fill and its label down to 2.34:1 against the paper card, below
  // AA's 4.5. Routing it through the `Button` primitive replaces that with an
  // opaque `DISABLED_FILL`, so the label stays legible. Asserting the class
  // is gone is the only thing that stops it being reintroduced: nothing else
  // in the suite looks at this button while it is disabled.
  it('keeps the bind button legible while disabled instead of fading the whole control', async () => {
    mockAccounts(null, null)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    const bind = await screen.findByRole('button', { name: bindLabel('main') })

    expect(bind).toBeDisabled()
    expect(bind.className).not.toMatch(/disabled:opacity/)
    expect(bind.className).not.toMatch(/text-white/)
    // The primitive pins an opaque disabled fill from the theme rather than
    // dropping alpha; that token pair is what carries the label contrast.
    expect(bind.className).toMatch(/disabled:bg-\[var\(--color-surface-hover\)\]/)
    expect(bind.className).toMatch(/disabled:text-\[var\(--color-text-tertiary\)\]/)
  })

  it('abandons the credential editor and restores the account summary on cancel', async () => {
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.updateToken') }))
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.cancel') }))

    // The invariant: cancel abandons the edit and returns to the summary view —
    // no editor fields linger, and the bound account is still presented.
    expect(screen.queryByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).not.toBeInTheDocument()
    expect(screen.getByText(userIdSummary('main-user'))).toBeInTheDocument()
  })

  it('creates a call token from the card and lists it without a reload', async () => {
    vi.mocked(echoflowApi.createToken).mockResolvedValue({
      account: {
        ...mainAccount,
        tokens: [...mainAccount.tokens, { id: 'new-token-id', name: 'echoflow-code', keyPreview: 'sk-new…dcba' }],
      },
    })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.createToken') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.createToken)).toHaveBeenCalledWith('main'))
    // The invariant: the new key is in the same list the add-to-providers click
    // reads from, so creating it is the whole job — no page reload, no console.
    expect(await screen.findByRole('button', { name: /echoflow-code/ })).toBeInTheDocument()
    expect(screen.getByText(L('echoflowApiOfficialLogin.tokenCreated'))).toBeInTheDocument()
  })

  it('reports a failed token creation next to the button that failed', async () => {
    vi.mocked(echoflowApi.createToken).mockRejectedValue(new Error('token_invalid'))
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.createToken') }))

    expect(await screen.findByRole('alert')).toHaveTextContent(L('echoflowApiOfficialLogin.createTokenFailed'))
    expect(screen.getByText(userIdSummary('main-user'))).toBeInTheDocument()
  })

  it('carries the gateway reason into the failure line', async () => {
    vi.mocked(echoflowApi.createToken).mockRejectedValue(
      new ApiError(400, { error: 'token_invalid', detail: 'Session network fingerprint changed' }),
    )
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.createToken') }))

    // The invariant: a refusal states why, so the user can act instead of guessing.
    expect(await screen.findByRole('alert')).toHaveTextContent('Session network fingerprint changed')
  })

  it('opens the site console for the endpoint being viewed', async () => {
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.openConsole') }))
    expect(hostMocks.open).toHaveBeenLastCalledWith('https://api.echoflowai.cc/console/token')

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.openConsole') }))
    expect(hostMocks.open).toHaveBeenLastCalledWith('https://expapi.echoflowai.cc/console/token')
  })
})
