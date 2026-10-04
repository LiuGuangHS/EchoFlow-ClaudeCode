import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startMock, statusMock, logoutMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  statusMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/echoFlowGrokOAuth', () => ({
  echoFlowGrokOAuthApi: {
    start: startMock,
    status: statusMock,
    logout: logoutMock,
  },
}))

import { useEchoFlowGrokOAuthStore } from './echoFlowGrokOAuthStore'

const initialState = useEchoFlowGrokOAuthStore.getState()

describe('echoFlowGrokOAuthStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    startMock.mockReset()
    statusMock.mockReset()
    logoutMock.mockReset()
    useEchoFlowGrokOAuthStore.setState({
      ...initialState,
      status: null,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    useEchoFlowGrokOAuthStore.getState().stopPolling()
    useEchoFlowGrokOAuthStore.setState(initialState)
    vi.useRealTimers()
  })

  it('returns the authorization URL without polling before the browser opens', async () => {
    startMock.mockResolvedValue({
      authorizeUrl: 'https://accounts.x.ai/oauth/authorize?state=grok-state',
      state: 'grok-state',
    })

    const result = await useEchoFlowGrokOAuthStore.getState().login()

    expect(result.authorizeUrl).toContain('state=grok-state')
    expect(useEchoFlowGrokOAuthStore.getState().isPolling).toBe(false)
  })

  it('stops polling after Grok OAuth becomes logged in', async () => {
    statusMock
      .mockResolvedValueOnce({ loggedIn: false })
      .mockResolvedValueOnce({
        loggedIn: true,
        expiresAt: Date.now() + 60_000,
        email: 'grok@example.com',
      })

    useEchoFlowGrokOAuthStore.getState().startPolling()
    await vi.advanceTimersByTimeAsync(4_000)

    expect(useEchoFlowGrokOAuthStore.getState().status).toMatchObject({
      loggedIn: true,
      email: 'grok@example.com',
    })
    expect(useEchoFlowGrokOAuthStore.getState().isPolling).toBe(false)
  })
})
