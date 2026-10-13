import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EchoFlowAccountDock } from './EchoFlowAccountDock'
import { echoflowApi } from '../../api/echoflow'
import { getDesktopHost } from '../../lib/desktopHost'

const hostMock = {
  isDesktop: true,
  capabilities: { echoFlowAccount: true },
  echoFlow: { openLogin: vi.fn(), signOut: vi.fn() },
}

vi.mock('../../api/echoflow', () => ({
  echoflowApi: {
    getSiteSession: vi.fn(),
    refreshSiteSession: vi.fn(),
  },
}))
vi.mock('../../lib/desktopHost', () => ({
  getDesktopHost: vi.fn(() => hostMock),
}))
vi.mock('../../i18n', () => ({ useTranslation: () => (key: string) => key }))

const account = { userId: '106452', username: 'zhijun2003', balance: 2, refreshedAt: 1234 }

describe('EchoFlowAccountDock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the signed-out action and opens the site login', async () => {
    vi.mocked(echoflowApi.getSiteSession).mockResolvedValue({ account: null })
    vi.mocked(hostMock.echoFlow.openLogin).mockResolvedValue('authenticated')
    vi.mocked(echoflowApi.getSiteSession).mockResolvedValueOnce({ account: null }).mockResolvedValueOnce({ account })

    render(<EchoFlowAccountDock />)
    const button = await screen.findByRole('button', { name: 'echoflowAccount.signIn' })
    fireEvent.click(button)

    await waitFor(() => expect(hostMock.echoFlow.openLogin).toHaveBeenCalledOnce())
    expect(await screen.findByText('zhijun2003')).toBeInTheDocument()
  })

  it('shows username and balance and signs out without exposing cookie data', async () => {
    vi.mocked(echoflowApi.getSiteSession).mockResolvedValue({ account })
    render(<EchoFlowAccountDock />)

    expect(await screen.findByText('zhijun2003')).toBeInTheDocument()
    expect(screen.getByText('¥2.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'echoflowAccount.signOut' }))
    await waitFor(() => expect(hostMock.echoFlow.signOut).toHaveBeenCalledOnce())
    expect(await screen.findByRole('button', { name: 'echoflowAccount.signIn' })).toBeInTheDocument()
  })
})
