import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'
import { echoflowApi } from './echoflow'

vi.mock('./client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

afterEach(() => vi.clearAllMocks())

describe('EchoFlow site-session API client', () => {
  it('reads and refreshes only public account data and never exposes session bootstrap', async () => {
    const account = { userId: '106452', username: 'site-user', balance: 2, refreshedAt: 1234 }
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ account })
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ account })

    await expect(echoflowApi.getSiteSession()).resolves.toEqual({ account })
    await expect(echoflowApi.refreshSiteSession()).resolves.toEqual({ account })
    expect(api.get).toHaveBeenCalledWith('/api/echoflow/site-session')
    expect(api.post).toHaveBeenCalledWith('/api/echoflow/site-session/refresh', {})
    expect(echoflowApi).not.toHaveProperty('bootstrapSiteSession')
  })

})
