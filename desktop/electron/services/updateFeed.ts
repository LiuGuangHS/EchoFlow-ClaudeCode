const DIRECT_GITHUB_RELEASE_FEED_URL = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/'
// 加速前缀与 site/src/lib/releaseDownload.js 的 GITHUB_ACCELERATOR_PREFIX 必须一致，换镜像两处同改。
const DEFAULT_PROXY_FEED_URL = `https://gh-proxy.org/${DIRECT_GITHUB_RELEASE_FEED_URL}`
// 自有域名上的更新元数据镜像（/update/*.yml），发版时从 GitHub 发布资产逐字节镜像。
// 元数据先走这里，GitHub 直连是兜底；安装包字节仍走下方 downloadFeedUrls。
const SELF_UPDATE_METADATA_URL = 'https://code.echoflow.cn/update/'

export type UpdateFeedConfig = {
  metadataUrl: string
  metadataFallbackUrls: string[]
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
    // 显式覆盖 = 运维/高级用户自己选的源：纯单源，不加任何兜底。
    return {
      metadataUrl: explicitFeedUrl,
      metadataFallbackUrls: [],
      downloadFeedUrls: [explicitFeedUrl],
    }
  }

  const githubProxyBase = normalizeUpdateFeedBaseUrl(env.ECHOFLOW_UPDATE_GITHUB_PROXY_BASE ?? '')
  const proxyFeedUrl = githubProxyBase
    ? `${githubProxyBase}${DIRECT_GITHUB_RELEASE_FEED_URL}`
    : DEFAULT_PROXY_FEED_URL

  return {
    metadataUrl: SELF_UPDATE_METADATA_URL,
    metadataFallbackUrls: [DIRECT_GITHUB_RELEASE_FEED_URL],
    downloadFeedUrls: dedupeUpdateFeedUrls([proxyFeedUrl, DIRECT_GITHUB_RELEASE_FEED_URL]),
  }
}

export function resolveUpdateFeedUrls(env: NodeJS.ProcessEnv): string[] {
  const config = resolveUpdateFeedConfig(env)
  return dedupeUpdateFeedUrls([
    config.metadataUrl,
    ...config.metadataFallbackUrls,
    ...config.downloadFeedUrls,
  ])
}
