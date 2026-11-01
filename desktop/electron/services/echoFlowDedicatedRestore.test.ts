import { describe, expect, it, vi } from 'vitest'
import { readStoredDedicatedCredentialWith, type DedicatedContents } from './echoFlowDedicatedRestore'

const ORIGIN = 'https://expapi.echoflowai.cc'

function makeContents(storage: Record<string, string | null>) {
  // Mirrors a real WebContents: navigating resolves before the page's own
  // scripts have run, so storage is only readable after 'did-finish-load'.
  let ready = false
  const listeners: Array<() => void> = []
  const contents = {
    loadURL: vi.fn(async () => {
      // The page arrives later, like a real network round trip.
      setTimeout(() => {
        ready = true
        for (const listener of listeners.splice(0)) listener()
      }, 0)
    }),
    getURL: () => (ready ? `${ORIGIN}/` : 'about:blank'),
    executeJavaScript: vi.fn(async () => {
      if (!ready) throw new Error('No document to evaluate in')
      return {
        token: storage.auth_token,
        user: storage.auth_user,
        expiresAt: storage.token_expires_at,
      }
    }),
    once: (event: 'did-finish-load' | 'did-fail-load', listener: () => void) => {
      if (event === 'did-finish-load' && !ready) listeners.push(listener)
    },
    close: vi.fn(),
  }
  return contents satisfies DedicatedContents
}

describe('dedicated credential restoration', () => {
  it('reads the persisted browser storage after the login window is gone', async () => {
    const contents = makeContents({
      auth_token: 'dedicated-access-token',
      auth_user: JSON.stringify({ id: 7, username: 'gateway-user' }),
      token_expires_at: null,
    })

    await expect(readStoredDedicatedCredentialWith(contents, 'https://expapi.echoflowai.cc')).resolves.toEqual({
      kind: 'bearer',
      userId: '7',
      username: 'gateway-user',
      accessToken: 'dedicated-access-token',
    })
    expect(contents.loadURL).toHaveBeenCalledWith('https://expapi.echoflowai.cc')
    expect(contents.close).toHaveBeenCalledOnce()
  })

  it('returns no credential when the partition is signed out', async () => {
    const contents = makeContents({ auth_token: null, auth_user: null, token_expires_at: null })

    await expect(readStoredDedicatedCredentialWith(contents, 'https://expapi.echoflowai.cc')).resolves.toBeNull()
    expect(contents.close).toHaveBeenCalledOnce()
  })
})
