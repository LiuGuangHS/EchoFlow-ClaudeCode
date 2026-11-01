import type { EchoFlowLoginCredential, SiteCookie } from './echoFlowLogin'
import { siteCookieHeader } from './echoFlowLogin'
import type { EchoFlowLoginIdentity } from './echoFlowSiteIdentity'

export type SiteRestoreDeps = {
  readCookies: () => Promise<SiteCookie[]>
  /** The identity stored at sign-in; the gateway account call needs it as New-Api-User. */
  identity: EchoFlowLoginIdentity | null
  userAgent: string
  acceptLanguage: string
}

/**
 * Reads the main site's persisted session after its login window is gone.
 * The restore stays local — partition cookie plus the stored identity — and the
 * verification that follows confirms the pair against the gateway, which
 * rejects any other client of the session anyway.
 */
export async function readStoredSiteCredentialWith(
  deps: SiteRestoreDeps,
): Promise<EchoFlowLoginCredential | null> {
  const cookie = siteCookieHeader(await deps.readCookies())
  console.info('[echoFlowLogin] credential-read:', JSON.stringify({
    endpoint: 'main',
    present: Boolean(cookie && deps.identity),
    cookiePresent: Boolean(cookie),
    identityPresent: Boolean(deps.identity),
  }))
  if (!cookie || !deps.identity) return null
  return {
    kind: 'session',
    userId: deps.identity.userId,
    username: deps.identity.username,
    cookie,
    userAgent: deps.userAgent,
    acceptLanguage: deps.acceptLanguage,
  }
}

export async function readStoredSiteCredential(
  partition: string,
  origin: string,
  acceptLanguage: string,
  identity: EchoFlowLoginIdentity | null,
): Promise<EchoFlowLoginCredential | null> {
  const { session } = await import('electron')
  const partitionSession = session.fromPartition(partition)
  return await readStoredSiteCredentialWith({
    readCookies: async () => await partitionSession.cookies.get({ url: origin }),
    identity,
    userAgent: partitionSession.getUserAgent(),
    acceptLanguage,
  })
}
