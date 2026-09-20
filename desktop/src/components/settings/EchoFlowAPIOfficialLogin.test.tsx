import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAccountsMock,
  bindAccountMock,
  refreshAccountMock,
  disconnectAccountMock,
} = vi.hoisted(() => ({
  getAccountsMock: vi.fn(),
  bindAccountMock: vi.fn(),
  refreshAccountMock: vi.fn(),
  disconnectAccountMock: vi.fn(),
}))

vi.mock('../../api/echoflow', () => ({
  ECHOFLOW_BASE_URLS: {
    main: 'https://api.echoflowai.cc',
    dedicated: 'https://expapi.echoflowai.cc',
  },
  echoflowApi: {
    getAccounts: getAccountsMock,
    bindAccount: bindAccountMock,
    refreshAccount: refreshAccountMock,
    disconnectAccount: disconnectAccountMock,
  },
}))

import { EchoFlowAPIOfficialLogin } from './EchoFlowAPIOfficialLogin'

const mainAccount = {
  userId: 'main-user',
  username: 'Main User',
  balance: 12.5,
  endpoint: 'main' as const,
  tokens: [{ id: 'shared-token-id', name: 'Main key', keyPreview: 'sk-main…1234' }],
}

const dedicatedAccount = {
  userId: 'dedicated-user',
  username: 'Dedicated User',
  balance: 8.25,
  endpoint: 'dedicated' as const,
  tokens: [{ id: 'shared-token-id', name: 'Dedicated key', keyPreview: 'sk-dedicated…5678' }],
}

function mockAccounts(main: typeof mainAccount | null = mainAccount, dedicated: typeof dedicatedAccount | null = dedicatedAccount) {
  getAccountsMock.mockResolvedValue({
    account: main,
    accounts: { main, dedicated },
  })
}

describe('EchoFlowAPIOfficialLogin', () => {
  beforeEach(() => {
    getAccountsMock.mockReset()
    bindAccountMock.mockReset()
    refreshAccountMock.mockReset()
    disconnectAccountMock.mockReset()
    mockAccounts()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows one endpoint account at a time and keeps the account data isolated', async () => {
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    expect(await screen.findByText('用户 ID：main-user')).toBeInTheDocument()
    expect(screen.queryByText('用户 ID：dedicated-user')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '专线' }))

    expect(screen.getByText('用户 ID：dedicated-user')).toBeInTheDocument()
    expect(screen.queryByText('用户 ID：main-user')).not.toBeInTheDocument()
    expect(screen.getByText('https://expapi.echoflowai.cc')).toBeInTheDocument()
    expect(screen.queryByText('management-main-secret')).not.toBeInTheDocument()
  })

  it('keeps binding credentials separate for each endpoint', async () => {
    mockAccounts(null, null)
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    const userId = await screen.findByPlaceholderText('用户 ID')
    const managementToken = screen.getByPlaceholderText('系统访问令牌')
    fireEvent.change(userId, { target: { value: 'main-user' } })
    fireEvent.change(managementToken, { target: { value: 'main-management-secret' } })

    fireEvent.click(screen.getByRole('button', { name: '专线' }))
    fireEvent.change(screen.getByPlaceholderText('用户 ID'), { target: { value: 'dedicated-user' } })
    fireEvent.change(screen.getByPlaceholderText('系统访问令牌'), { target: { value: 'dedicated-management-secret' } })

    fireEvent.click(screen.getByRole('button', { name: '主站' }))

    expect(screen.getByPlaceholderText('用户 ID')).toHaveValue('main-user')
    expect(screen.getByPlaceholderText('系统访问令牌')).toHaveValue('main-management-secret')
    fireEvent.click(screen.getByRole('button', { name: '专线' }))
    expect(screen.getByPlaceholderText('用户 ID')).toHaveValue('dedicated-user')
    expect(screen.getByPlaceholderText('系统访问令牌')).toHaveValue('dedicated-management-secret')
  })

  it('emits only endpoint-scoped token metadata when a key is selected', async () => {
    const onAddFromToken = vi.fn()
    render(<EchoFlowAPIOfficialLogin onAddFromToken={onAddFromToken} />)

    await screen.findByText('用户 ID：main-user')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shared-token-id' } })

    expect(onAddFromToken).toHaveBeenCalledWith({
      endpoint: 'main',
      tokenId: 'shared-token-id',
      tokenName: 'Main key',
      keyPreview: 'sk-main…1234',
    })
    expect(onAddFromToken.mock.calls[0]?.[0]).not.toHaveProperty('managementToken')
    expect(onAddFromToken.mock.calls[0]?.[0]).not.toHaveProperty('key')
  })

  it('keeps binding credentials scoped to the selected endpoint', async () => {
    mockAccounts(null, null)
    bindAccountMock.mockImplementation(async (endpoint: 'main' | 'dedicated', userId: string) => ({
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

    const mainUserId = await screen.findByPlaceholderText('用户 ID')
    fireEvent.change(mainUserId, { target: { value: 'main-user' } })
    fireEvent.change(screen.getByPlaceholderText('系统访问令牌'), { target: { value: 'main-management-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定主站账户' }))

    await waitFor(() => expect(bindAccountMock).toHaveBeenCalledWith('main', 'main-user', 'main-management-secret'))
    fireEvent.click(screen.getByRole('button', { name: '专线' }))
    expect(screen.getByPlaceholderText('用户 ID')).toHaveValue('')
    expect(screen.getByPlaceholderText('系统访问令牌')).toHaveValue('')

    fireEvent.change(screen.getByPlaceholderText('用户 ID'), { target: { value: 'dedicated-user' } })
    fireEvent.change(screen.getByPlaceholderText('系统访问令牌'), { target: { value: 'dedicated-management-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定专线账户' }))

    await waitFor(() => expect(bindAccountMock).toHaveBeenCalledWith('dedicated', 'dedicated-user', 'dedicated-management-secret'))
    fireEvent.click(screen.getByRole('button', { name: '主站' }))
    expect(screen.getByText('用户 ID：main-user')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'main key · sk-main…1234' })).toBeInTheDocument()
  })

  it('disconnects only the selected endpoint account', async () => {
    disconnectAccountMock.mockResolvedValue({ ok: true })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    await screen.findByText('用户 ID：main-user')
    fireEvent.click(screen.getByRole('button', { name: '解绑' }))

    await waitFor(() => expect(disconnectAccountMock).toHaveBeenCalledWith('main'))
    expect(screen.queryByText('用户 ID：main-user')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '专线' }))
    expect(screen.getByText('用户 ID：dedicated-user')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Dedicated key · sk-dedicated…5678' })).toBeInTheDocument()
  })

  it('refreshes only the selected endpoint account', async () => {
    refreshAccountMock.mockResolvedValue({
      account: {
        ...dedicatedAccount,
        username: 'Dedicated refreshed',
        balance: 18.5,
      },
    })
    render(<EchoFlowAPIOfficialLogin onAddFromToken={vi.fn()} />)

    await screen.findByText('用户 ID：main-user')
    fireEvent.click(screen.getByRole('button', { name: '专线' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(refreshAccountMock).toHaveBeenCalledWith('dedicated'))
    expect(screen.getByText('Dedicated refreshed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '主站' }))
    expect(screen.getByText('Main User')).toBeInTheDocument()
    expect(screen.queryByText('Dedicated refreshed')).not.toBeInTheDocument()
  })
})
