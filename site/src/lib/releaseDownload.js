/**
 * 下载页的安装包解析与多源下载。
 *
 * 版本号在文件名里，页面没法硬编码「最新」，所以最新版本来自发版时生成的
 * manifest（/download/manifest.json）。manifest 里的文件名一律以发布资产清单为准，
 * 不能从 artifactName 模板推导 —— Linux 各格式的架构记号不一样。
 *
 * 多源：并发探测支持 CORS 的加速源，GitHub 具体文件直连兜底。
 * 这里只探测响应头，不代表完整文件下载测速或下载中断后的自动切换。
 */

export const DOWNLOAD_MANIFEST_PATH = '/download/manifest.json'
export const DOWNLOAD_PAGE_PATH = '/download'
export const GITHUB_REPOSITORY = 'LiuGuangHS/EchoFlow-ClaudeCode'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases/latest`
// 下载页专用公共代理；桌面端自动更新仍维护自己的源列表。
export const DOWNLOAD_PROXY_PREFIXES = [
  'https://gh-proxy.org/',
  'https://gh-proxy.com/',
]

const [GITHUB_OWNER, GITHUB_REPOSITORY_NAME] = GITHUB_REPOSITORY.split('/')
const GITHUB_PAGES_ORIGIN = `https://${GITHUB_OWNER.toLowerCase()}.github.io/${GITHUB_REPOSITORY_NAME}`
// 自定义域名由 EdgeOne 独立构建，可能缺少 CI 写进 dist 的机器端点。Pages 始终是
// deploy-docs.yml 上传的完整产物，作为同源 manifest 缺失时的只读副本。
export const DOWNLOAD_MANIFEST_FALLBACK_URL = `${GITHUB_PAGES_ORIGIN}${DOWNLOAD_MANIFEST_PATH}`

const PLATFORM_LABELS = { mac: 'macOS', win: 'Windows', linux: 'Linux' }
const PLATFORM_ALIASES = {
  mac: 'mac',
  macos: 'mac',
  win: 'win',
  windows: 'win',
  linux: 'linux',
}
const SAFE_PATH_SEGMENT = /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/

export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] ?? platform
}

/** 接受下载页的短名与落地页显示的系统名；未知值返回 null，交给 UA 或默认值。 */
export function normalizeDownloadPlatform(value) {
  if (typeof value !== 'string') return null
  return PLATFORM_ALIASES[value.trim().toLowerCase()] ?? null
}

/** 落地页底部的系统选择带进下载页；未知系统不拼参数。 */
export function downloadPagePath(locale, platform) {
  const route = locale === 'en' ? '/en/download' : '/download'
  const normalized = normalizeDownloadPlatform(platform)
  return normalized ? `${route}?platform=${normalized}` : route
}

/** 合法显式选择优先；没有或非法时沿用 UA 推断。 */
export function resolveInitialPlatform(search, userAgent = '') {
  let requested = null
  try {
    requested = normalizeDownloadPlatform(new URLSearchParams(search || '').get('platform'))
  } catch {
    requested = null
  }
  return requested ?? pickPlatformArch(userAgent).platform
}

/**
 * 浏览器 UA 分不出 Apple Silicon 和 Intel（Chrome/Firefox 在 Intel Mac 上也报 MacIntel），
 * 所以 macOS 默认给 arm64 —— 新机器的主流架构。其余平台按 UA 里的架构记号走。
 */
export function pickPlatformArch(userAgent = '') {
  const ua = String(userAgent || '')

  if (/windows/i.test(ua)) {
    return { platform: 'win', arch: /arm64|aarch64/i.test(ua) ? 'arm64' : 'x64' }
  }
  if (/mac os x|macintosh/i.test(ua)) {
    return { platform: 'mac', arch: 'arm64' }
  }
  if (/linux|x11/i.test(ua)) {
    return { platform: 'linux', arch: /aarch64|arm64/i.test(ua) ? 'arm64' : 'x86_64' }
  }
  return { platform: 'win', arch: 'x64' }
}

function assetFileName(manifest, platform, arch) {
  const key = `${platform}-${arch}`
  const value = manifest?.assets?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function directDownloadUrl(tag, fileName) {
  return `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${fileName}`
}

function proxyDownloadUrls(directUrl) {
  return DOWNLOAD_PROXY_PREFIXES.map((prefix) => `${prefix}${directUrl}`)
}

/** 返回待并发探测的代理；GitHub 直链由调用方作为最终兜底。 */
export function buildDownloadCandidates(manifest, platform, arch) {
  const fileName = assetFileName(manifest, platform, arch)
  const tag = manifest?.tag
  if (!fileName || !tag) return []

  return proxyDownloadUrls(directDownloadUrl(tag, fileName))
}

export function resolveDownloadTarget(manifest, platform, arch) {
  const fileName = assetFileName(manifest, platform, arch)
  const tag = manifest?.tag
  if (!fileName || !tag) return null

  const directUrl = directDownloadUrl(tag, fileName)
  return { fileName, url: proxyDownloadUrls(directUrl)[0] ?? directUrl, fallbackUrl: directUrl }
}

/** 页面上「其他格式」一栏：deb / rpm 这类不主推但有人要的包。 */
export function resolveExtraDownloads(manifest) {
  const tag = manifest?.tag
  const extras = manifest?.extras
  if (!tag || !extras || typeof extras !== 'object') return []

  return Object.entries(extras)
    .filter(([, fileName]) => typeof fileName === 'string' && fileName.trim())
    .map(([key, fileName]) => {
      const directUrl = directDownloadUrl(tag, fileName.trim())
      return {
        fileName: fileName.trim(),
        key,
        candidates: proxyDownloadUrls(directUrl),
        url: proxyDownloadUrls(directUrl)[0] ?? directUrl,
        fallbackUrl: directUrl,
      }
    })
}

const PROBE_TIMEOUT_MS = 2500

async function isReachable(url, fetchImpl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
    const contentType = response.headers?.get?.('content-type') ?? ''
    return response.ok && !/text\/html/i.test(contentType)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/** Probe proxies concurrently, then use the fastest valid one or the direct GitHub URL. */
export async function startDirectDownload(candidates, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const locationImpl = options.locationImpl ?? globalThis.location
  if (!fetchImpl || !locationImpl) return 'fallback'

  const reachable = await Promise.any(
    (candidates ?? []).map(async (url) => {
      if (await isReachable(url, fetchImpl)) return url
      throw new Error('Download source is unreachable')
    }),
  ).catch(() => null)
  const selectedUrl = reachable ?? options.fallbackUrl
  if (!selectedUrl) return 'fallback'

  locationImpl.assign(selectedUrl)
  return 'started'
}

function isSafePathSegment(value) {
  return typeof value === 'string'
    && SAFE_PATH_SEGMENT.test(value)
    && !value.includes('..')
}

function isSafeFileName(value) {
  return typeof value === 'string'
    && value === value.trim()
    && /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value)
    && !value.includes('..')
}

function isFileMap(value, { allowEmpty }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (!allowEmpty && entries.length === 0) return false
  return entries.every(([key, fileName]) => (
    typeof key === 'string'
    && key.length > 0
    && isSafeFileName(fileName)
  ))
}

/**
 * manifest 决定安装包 URL，必须只接受发布脚本实际生成的形状。
 * 路径段与文件名同时校验，避免一个被篡改的 manifest 把下载带到别的 tag 或目录。
 */
export function isValidDownloadManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  if (!isSafePathSegment(manifest.tag)) return false
  if (typeof manifest.version !== 'string' || !SAFE_PATH_SEGMENT.test(manifest.version)) return false
  if (!isFileMap(manifest.assets, { allowEmpty: false })) return false
  if (manifest.extras !== undefined && !isFileMap(manifest.extras, { allowEmpty: true })) return false
  return true
}

async function readDownloadManifest(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { cache: 'no-store' })
    if (!response?.ok) return null

    // SPA 的 404 也返回 200 的 index.html；仅看 status 会把 HTML 当 manifest。
    const contentType = response.headers?.get?.('content-type')
    if (typeof contentType === 'string' && /text\/html/i.test(contentType)) return null

    const manifest = await response.json()
    return isValidDownloadManifest(manifest) ? manifest : null
  } catch {
    return null
  }
}

export async function loadDownloadManifest(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) return null

  // BASE_URL 以 / 结尾（Vite 默认就是 '/'），直接拼会得到 '//download/manifest.json'，
  // 那是协议相对地址，请求会打到名叫 download 的主机上 —— 先把尾斜杠去掉再拼。
  const base = String(options.baseUrl ?? '').replace(/\/+$/, '')
  const sameOriginUrl = `${base}${DOWNLOAD_MANIFEST_PATH}`
  const sameOrigin = await readDownloadManifest(sameOriginUrl, fetchImpl)
  if (sameOrigin) return sameOrigin

  const fallbackUrl = String(
    options.fallbackManifestUrl ?? DOWNLOAD_MANIFEST_FALLBACK_URL,
  ).trim()
  if (!fallbackUrl || fallbackUrl === sameOriginUrl) return null
  return readDownloadManifest(fallbackUrl, fetchImpl)
}
