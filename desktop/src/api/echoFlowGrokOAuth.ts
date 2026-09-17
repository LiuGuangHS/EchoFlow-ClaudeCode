import { api, getBaseUrl } from './client'

export type EchoFlowGrokOAuthStatus =
  | { loggedIn: false }
  | {
      loggedIn: true
      expiresAt: number | null
      email: string | null
    }

function currentServerPort(): number {
  const port = new URL(getBaseUrl()).port
  const parsed = Number.parseInt(port, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Cannot determine server port from baseUrl: ${getBaseUrl()}`)
  }
  return parsed
}

export const echoFlowGrokOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string; state: string }>(
      '/api/echoflow-grok-oauth/start',
      { serverPort: currentServerPort() },
    )
  },

  status() {
    return api.get<EchoFlowGrokOAuthStatus>('/api/echoflow-grok-oauth')
  },

  successUrl() {
    return `${getBaseUrl()}/api/echoflow-grok-oauth/success`
  },

  logout() {
    return api.delete<{ ok: true }>('/api/echoflow-grok-oauth')
  },
}
