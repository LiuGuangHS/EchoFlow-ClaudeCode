/**
 * 下载页的安装包解析与多源下载。
 *
 * 版本号在文件名里，页面没法硬编码「最新」，所以最新版本来自发版时生成的
 * manifest（/download/manifest.json）。manifest 里的文件名一律以发布资产清单为准，
 * 不能从 artifactName 模板推导 —— Linux 各格式的架构记号不一样。
 *
 * 多源：加速前缀优先、GitHub 直连兜底。探测不能用带 Range 的 CORS 请求：
 * GitHub 的直连主机不返回 Access-Control-* 头，预检直接失败，那条回退会变成死代码。
 * 这里用 no-cors 的 GET 探活（响应不可读，但能区分「连上了」和「连不上」）。
 */

export const DOWNLOAD_MANIFEST_PATH = '/download/manifest.json'
export const DOWNLOAD_PAGE_PATH = '/download'
export const GITHUB_REPOSITORY = 'LiuGuangHS/EchoFlow-ClaudeCode'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases/latest`
// 与 desktop/electron/services/updateFeed.ts 的 DEFAULT_PROXY_FEED_URL 同源，换镜像两处一起改。
export const GITHUB_ACCELERATOR_PREFIX = 'https://gh-proxy.org/'

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

/** 加速前缀在前、GitHub 直连在后；任一层缺失就少一条，不编造。 */
export function buildDownloadCandidates(manifest, platform, arch) {
  const fileName = assetFileName(manifest, platform, arch)
  const tag = manifest?.tag
  if (!fileName || !tag) return []

  const direct = `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${fileName}`
  return [`${GITHUB_ACCELERATOR_PREFIX}${direct}`, direct]
}

export function resolveDownloadTarget(manifest, platform, arch) {
  const fileName = assetFileName(manifest, platform, arch)
  const tag = manifest?.tag
  if (!fileName || !tag) return null

  return {
    fileName,
    url: `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${fileName}`,
  }
}

/** 页面上「其他格式」一栏：deb / rpm 这类不主推但有人要的包。 */
export function resolveExtraDownloads(manifest) {
  const tag = manifest?.tag
  const extras = manifest?.extras
  if (!tag || !extras || typeof extras !== 'object') return []

  return Object.entries(extras)
    .filter(([, fileName]) => typeof fileName === 'string' && fileName.trim())
    .map(([key, fileName]) => ({
      fileName: fileName.trim(),
      key,
      url: `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${fileName.trim()}`,
    }))
}

/**
 * 探活：no-cors 下响应不可读，但请求成功即说明主机可达（DNS 通、有响应）。
 * 被防火墙吞掉或主机不存在时 fetch 会 reject。
 */
async function isReachable(url, fetchImpl) {
  try {
    await fetchImpl(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
    return true
  } catch {
    return false
  }
}

/**
 * 依次探活候选源，第一个可达的交给 location.assign 触发浏览器流式下载。
 * 全不可达返回 'fallback'，由调用方把用户送去 GitHub Releases 页面。
 */
export async function startDirectDownload(candidates, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const locationImpl = options.locationImpl ?? globalThis.location
  if (!candidates?.length || !fetchImpl || !locationImpl) return 'fallback'

  for (const url of candidates) {
    if (await isReachable(url, fetchImpl)) {
      locationImpl.assign(url)
      return 'started'
    }
  }
  return 'fallback'
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
