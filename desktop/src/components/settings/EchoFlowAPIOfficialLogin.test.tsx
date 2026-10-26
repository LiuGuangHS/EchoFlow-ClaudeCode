import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { translate } from '../../i18n'

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

function mockAccounts(main: typeof mainAccount | null = mainAccount, dedicated: typeof dedicatedAccount | null = dedicatedAccount) {
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
  })
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useProviderStore.setState({ providers: [], activeId: null })
    vi.mocked(echoflowApi.getAccounts).mockReset()
    vi.mocked(echoflowApi.bindAccount).mockReset()
    vi.mocked(echoflowApi.refreshAccount).mockReset()
    vi.mocked(echoflowApi.disconnectAccount).mockReset()
    vi.mocked(echoflowApi.getTokenKey).mockReset()
    vi.mocked(echoflowApi.getTokenKey).mockResolvedValue({ token: { id: 'shared-token-id', name: 'Main key', key: 'sk-main-secret' } })
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

  it('shows one endpoint account at a time and keeps the account data isolated', async () => {
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText(userIdSummary('main-user'))).toBeInTheDocument()
    expect(screen.queryByText(userIdSummary('dedicated-user'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: endpointTab('dedicated') }))

    expect(screen.getByText(userIdSummary('dedicated-user'))).toBeInTheDocument()
    expect(screen.queryByText(userIdSummary('main-user'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: endpointTab('dedicated') })).toBeInTheDocument()
    expect(screen.queryByText('management-main-secret')).not.toBeInTheDocument()
  })

  it('keeps binding credentials separate for each endpoint', async () => {
    mockAccounts(null, null)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    const userId = await screen.findByPlaceholderText(L('echoflowApiOfficialLogin.userId'))
    const managementToken = screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))
    fireEvent.change(userId, { target: { value: 'main-user' } })
    fireEvent.change(managementToken, { target: { value: 'main-management-secret' } })

    fireEvent.click(screen.getByRole('button', { name: endpointTab('dedicated') }))
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'dedicated-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'dedicated-management-secret' } })

    fireEvent.click(screen.getByRole('button', { name: endpointTab('main') }))

    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId'))).toHaveValue('main-user')
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).toHaveValue('main-management-secret')
    fireEvent.click(screen.getByRole('button', { name: endpointTab('dedicated') }))
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
    fireEvent.click(screen.getByRole('button', { name: endpointTab('dedicated') }))
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId'))).toHaveValue('')
    expect(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken'))).toHaveValue('')

    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.userId')), { target: { value: 'dedicated-user' } })
    fireEvent.change(screen.getByPlaceholderText(L('echoflowApiOfficialLogin.managementToken')), { target: { value: 'dedicated-management-secret' } })
    fireEvent.click(screen.getByRole('button', { name: bindLabel('dedicated') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.bindAccount)).toHaveBeenCalledWith('dedicated', 'dedicated-user', 'dedicated-management-secret'))
    fireEvent.click(screen.getByRole('button', { name: endpointTab('main') }))
    expect(screen.getByText(userIdSummary('main-user'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /main key.*sk-main…1234/ })).toBeInTheDocument()
  })

  it('disconnects only the selected endpoint account', async () => {
    vi.mocked(echoflowApi.disconnectAccount).mockResolvedValue({ ok: true })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    await screen.findByText(userIdSummary('main-user'))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.unbind') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.disconnectAccount)).toHaveBeenCalledWith('main'))
    expect(screen.queryByText(userIdSummary('main-user'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: endpointTab('dedicated') }))
    expect(screen.getByText(userIdSummary('dedicated-user'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dedicated key.*sk-dedicated…5678/ })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: endpointTab('dedicated') }))
    fireEvent.click(screen.getByRole('button', { name: L('echoflowApiOfficialLogin.refresh') }))

    await waitFor(() => expect(vi.mocked(echoflowApi.refreshAccount)).toHaveBeenCalledWith('dedicated'))
    expect(screen.getByText(/Dedicated refreshed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: endpointTab('main') }))
    expect(screen.getByText(/Main User/)).toBeInTheDocument()
    expect(screen.queryByText(/Dedicated refreshed/)).not.toBeInTheDocument()
  })
})
