import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStoredSiteCredentialWith, type SiteRestoreDeps } from './echoFlowSiteRestore'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function makeDeps(overrides: Partial<SiteRestoreDeps> = {}): SiteRestoreDeps {
  return {
    readCookies: async () => [{ name: 'session', value: 'session=abc' }],
    identity: { userId: '5', username: 'site-user' },
    userAgent: 'EchoFlowTest/1.0',
    acceptLanguage: 'zh-CN',
    ...overrides,
  }
}

describe('site credential restoration', () => {
  it('replays the stored cookie under the sign-in identity without any network round trip', async () => {
    // The gateway account endpoint needs New-Api-User, i.e. the very identity
    // being restored; the restore itself must stay local and let the later
    // verification confirm the cookie under that identity.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('the restore must not reach the network')
    }) as unknown as typeof fetch

    await expect(readStoredSiteCredentialWith(makeDeps())).resolves.toEqual({
      kind: 'session',
      userId: '5',
      username: 'site-user',
      cookie: 'session=session=abc',
      userAgent: 'EchoFlowTest/1.0',
      acceptLanguage: 'zh-CN',
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns no credential when the partition holds no site cookie', async () => {
    await expect(readStoredSiteCredentialWith(makeDeps({ readCookies: async () => [] }))).resolves.toBeNull()
  })

  it('returns no credential when no sign-in identity is stored', async () => {
    await expect(readStoredSiteCredentialWith(makeDeps({ identity: null }))).resolves.toBeNull()
  })
})
