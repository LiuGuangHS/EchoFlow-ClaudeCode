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

  it('signs in with the selected endpoint and refreshes that account', async () => {
    mockAccounts(null, null)
    hostMocks.openLogin.mockResolvedValue('authenticated')
    vi.mocked(echoflowApi.refreshAccount).mockResolvedValue({ account: mainAccount })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(hostMocks.openLogin).toHaveBeenCalledWith('main'))
    await waitFor(() => expect(echoflowApi.refreshAccount).toHaveBeenCalledWith('main'))

    fireEvent.click(screen.getByRole('tab', { name: endpointTab('dedicated') }))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.signIn') }))
    await waitFor(() => expect(hostMocks.openLogin).toHaveBeenLastCalledWith('dedicated'))
  })

  it('keeps the manual token form available under the advanced section', async () => {
    mockAccounts(null, null)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(L('echoflowApiOfficialLogin.manualBind'))).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'manual-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'manual-token' } })
    fireEvent.click(screen.getByRole('button', { name: bindLabel('main') }))

    await waitFor(() => expect(echoflowApi.bindAccount).toHaveBeenCalledWith('main', 'manual-user', 'manual-token'))
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
