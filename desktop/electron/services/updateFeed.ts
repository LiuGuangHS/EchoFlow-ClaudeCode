const DIRECT_GITHUB_RELEASE_FEED_URL = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/'
const DEFAULT_PROXY_FEED_URL = `https://gh-proxy.org/${DIRECT_GITHUB_RELEASE_FEED_URL}`

export type UpdateFeedConfig = {
  metadataUrl: string
  downloadFeedUrls: string[]
}

export function normalizeUpdateFeedBaseUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    return url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`
  } catch {
    return null
  }
}

export function dedupeUpdateFeedUrls(feedUrls: string[]): string[] {
  return Array.from(new Set(feedUrls))
}

export function resolveUpdateFeedConfig(env: NodeJS.ProcessEnv): UpdateFeedConfig {
  const explicitFeedUrl = normalizeUpdateFeedBaseUrl(env.ECHOFLOW_UPDATE_FEED_URL ?? '')
  if (explicitFeedUrl) {
    return {
      metadataUrl: explicitFeedUrl,
      downloadFeedUrls: [explicitFeedUrl],
    }
  }

  const githubProxyBase = normalizeUpdateFeedBaseUrl(env.ECHOFLOW_UPDATE_GITHUB_PROXY_BASE ?? '')
  const proxyFeedUrl = githubProxyBase
    ? `${githubProxyBase}${DIRECT_GITHUB_RELEASE_FEED_URL}`
    : DEFAULT_PROXY_FEED_URL

  return {
    metadataUrl: DIRECT_GITHUB_RELEASE_FEED_URL,
    downloadFeedUrls: dedupeUpdateFeedUrls([proxyFeedUrl, DIRECT_GITHUB_RELEASE_FEED_URL]),
  }
}

export function resolveUpdateFeedUrls(env: NodeJS.ProcessEnv): string[] {
  const config = resolveUpdateFeedConfig(env)
  return dedupeUpdateFeedUrls([
    config.metadataUrl,
    ...config.downloadFeedUrls,
  ])
}
