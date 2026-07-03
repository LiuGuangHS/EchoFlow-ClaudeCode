import { normalizeClawHubList } from './clawhubAdapter.js'
import { normalizeSkillHubList } from './skillhubAdapter.js'
import type {
  SkillMarketDetail,
  SkillMarketItem,
  SkillMarketListResult,
  SkillMarketSource,
  SkillMarketTrustState,
} from './types.js'

export type SkillMarketListSource = 'auto' | 'clawhub' | 'skillhub'

export type SkillMarketListParams = {
  source?: SkillMarketListSource
  limit?: number
  query?: string
  cursor?: string
  sort?: 'downloads' | 'installs' | 'stars' | 'updated' | 'trending'
}

export type SkillMarketDetailParams = {
  source: SkillMarketSource
  slug: string
}

type FetchImpl = typeof fetch
type InstalledSkillNamesProvider = Set<string> | (() => Set<string> | Promise<Set<string>>)

export type SkillMarketServiceOptions = {
  fetchImpl?: FetchImpl
  installedSkillNames?: InstalledSkillNamesProvider
  now?: () => number
}

export type SkillMarketService = {
  listSkills: (params?: SkillMarketListParams) => Promise<SkillMarketListResult>
  list: (params?: SkillMarketListParams) => Promise<SkillMarketListResult>
  getDetail: (params: SkillMarketDetailParams) => Promise<SkillMarketDetail | null>
}

const CLAWHUB_SKILLS_URL = 'https://clawhub.ai/api/v1/skills'
const SKILLHUB_SKILLS_URL = 'https://api.skillhub.cn/api/skills'
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000
const FAILURE_CACHE_TTL_MS = 60 * 1_000
const DETAIL_INSTALLABLE_TRUST_STATES = new Set<SkillMarketTrustState>([
  'clean',
  'benign',
  'signed',
  'official',
])

type CatalogCacheEntry = {
  expiresAt: number
  result: SkillMarketListResult
}

type FailureCacheEntry = {
  expiresAt: number
  message: string
}

class SkillMarketRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SkillMarketRequestError'
    this.cause = options?.cause
  }
}

export function createSkillMarketService(options: SkillMarketServiceOptions = {}): SkillMarketService {
  const fetchImpl = options.fetchImpl ?? fetch
  const installedSkillNames = options.installedSkillNames
  const now = options.now ?? Date.now
  const catalogCache = new Map<string, CatalogCacheEntry>()
  const failureCache = new Map<string, FailureCacheEntry>()

  async function listSkills(params: SkillMarketListParams = {}): Promise<SkillMarketListResult> {
    const source = params.source ?? 'auto'

    if (source === 'clawhub') {
      return withInstalled(await listClawHub(params))
    }

    if (source === 'skillhub') {
      return withInstalled(await listSkillHub(params))
    }

    if (source !== 'auto') {
      throw new Error(`Unsupported skill market source: ${source}`)
    }

    const clawHubFailure = recentFailure(clawHubCatalogCacheKey(params))
    if (clawHubFailure) {
      const fallback = await listSkillHub(params)
      return withInstalled({
        ...fallback,
        sourceStatus: 'fallback',
        message: `ClawHub unavailable: recent request failure (${clawHubFailure.message})`,
      })
    }

    let clawHub: SkillMarketListResult
    try {
      clawHub = await listClawHub(params)
    } catch (error) {
      if (!(error instanceof SkillMarketRequestError)) {
        throw error
      }
      const fallback = await listSkillHub(params)
      return withInstalled({
        ...fallback,
        sourceStatus: 'fallback',
        message: `ClawHub unavailable: ${errorMessage(error)}`,
      })
    }
    return withInstalled(clawHub)
  }

  async function listClawHub(params: SkillMarketListParams): Promise<SkillMarketListResult> {
    const url = clawHubUrlFor(params)
    const cacheKey = catalogCacheKey('clawhub', url)
    try {
      const result = await cachedCatalog(cacheKey, async () => {
        const payload = await requestJson(fetchImpl, url, 'ClawHub')
        return normalizeClawHubList(payload)
      })
      failureCache.delete(cacheKey)
      return result
    } catch (error) {
      if (error instanceof SkillMarketRequestError) {
        failureCache.set(cacheKey, {
          expiresAt: now() + FAILURE_CACHE_TTL_MS,
          message: errorMessage(error),
        })
      }
      throw error
    }
  }

  async function listSkillHub(params: SkillMarketListParams): Promise<SkillMarketListResult> {
    const url = skillHubUrlFor(params)
    return cachedCatalog(catalogCacheKey('skillhub', url), async () => {
      const payload = await requestJson(fetchImpl, url, 'SkillHub')
      return {
        ...normalizeSkillHubList(payload),
        sourceStatus: 'ok',
      }
    })
  }

  async function cachedCatalog(
    cacheKey: string,
    loader: () => Promise<SkillMarketListResult>,
  ): Promise<SkillMarketListResult> {
    const cached = catalogCache.get(cacheKey)
    const currentTime = now()
    if (cached && cached.expiresAt > currentTime) {
      return {
        ...cached.result,
        sourceStatus: 'cached',
      }
    }
    if (cached) {
      catalogCache.delete(cacheKey)
    }

    const result = await loader()
    catalogCache.set(cacheKey, {
      expiresAt: now() + CATALOG_CACHE_TTL_MS,
      result,
    })
    return result
  }

  function recentFailure(cacheKey: string): FailureCacheEntry | undefined {
    const cached = failureCache.get(cacheKey)
    if (!cached) {
      return undefined
    }
    if (cached.expiresAt > now()) {
      return cached
    }
    failureCache.delete(cacheKey)
    return undefined
  }

  async function withInstalled(result: SkillMarketListResult): Promise<SkillMarketListResult> {
    const installed = await resolveInstalledSkillNames(installedSkillNames)
    return {
      ...result,
      items: result.items.map((item): SkillMarketItem => ({
        ...item,
        installed: installed.has(item.slug),
      })),
    }
  }

  async function getDetail(params: SkillMarketDetailParams): Promise<SkillMarketDetail | null> {
    if (params.source !== 'clawhub' && params.source !== 'skillhub') {
      throw new Error(`Unsupported skill market source: ${params.source}`)
    }

    const slug = params.slug.trim()
    if (!slug) {
      return null
    }

    const list = await listSkills({
      source: params.source,
      query: slug,
      limit: MAX_LIMIT,
    })
    const item = list.items.find((candidate) => candidate.source === params.source && candidate.slug === slug)
    if (!item) {
      return null
    }
    return detailFromListItem(item)
  }

  return {
    listSkills,
    list: listSkills,
    getDetail,
  }
}

function detailFromListItem(item: SkillMarketItem): SkillMarketDetail {
  return {
    ...item,
    files: [],
    riskLabels: [],
    installEligibility: installEligibilityFromListItem(item),
  }
}

function installEligibilityFromListItem(item: SkillMarketItem): SkillMarketDetail['installEligibility'] {
  if (item.installed) {
    return {
      status: 'installed',
      installedSkillName: item.slug,
    }
  }
  if (DETAIL_INSTALLABLE_TRUST_STATES.has(item.trustState)) {
    return { status: 'installable' }
  }
  if (item.trustState === 'warning') {
    return { status: 'blocked', reason: 'Skill market trust metadata contains warnings.' }
  }
  if (item.trustState === 'unknown') {
    return { status: 'blocked', reason: 'Skill market trust metadata is missing or inconclusive.' }
  }
  return { status: 'blocked', reason: 'Skill market trust metadata blocked this skill.' }
}

function clawHubUrlFor(params: SkillMarketListParams): URL {
  const url = new URL(CLAWHUB_SKILLS_URL)
  url.searchParams.set('sort', clawHubSort(params.sort))
  url.searchParams.set('nonSuspiciousOnly', 'true')
  url.searchParams.set('limit', String(limitFor(params.limit)))
  addOptionalParam(url, 'query', params.query)
  addOptionalParam(url, 'cursor', params.cursor)
  return url
}

function skillHubUrlFor(params: SkillMarketListParams): URL {
  const url = new URL(SKILLHUB_SKILLS_URL)
  url.searchParams.set('sortBy', skillHubSort(params.sort))
  url.searchParams.set('order', 'desc')
  url.searchParams.set('limit', String(limitFor(params.limit)))
  addOptionalParam(url, 'query', params.query)
  addOptionalParam(url, 'cursor', params.cursor)
  return url
}

function clawHubCatalogCacheKey(params: SkillMarketListParams): string {
  return catalogCacheKey('clawhub', clawHubUrlFor(params))
}

function catalogCacheKey(source: 'clawhub' | 'skillhub', url: URL): string {
  return `${source}:${url.toString()}`
}

async function requestJson(fetchImpl: FetchImpl, url: URL, sourceName: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new SkillMarketRequestError(`${sourceName} request failed: ${errorMessage(error)}`, { cause: error })
  }

  if (!response.ok) {
    throw new SkillMarketRequestError(`${sourceName} request failed with status ${response.status}`)
  }

  return response.json()
}

async function resolveInstalledSkillNames(provider?: InstalledSkillNamesProvider): Promise<Set<string>> {
  if (!provider) {
    return new Set()
  }
  if (provider instanceof Set) {
    return provider
  }
  return provider()
}

function limitFor(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined || limit < 1) {
    return DEFAULT_LIMIT
  }
  return Math.min(limit, MAX_LIMIT)
}

function clawHubSort(sort: SkillMarketListParams['sort']): string {
  if (sort === 'updated') {
    return 'updated'
  }
  if (sort === 'installs' || sort === 'stars' || sort === 'trending') {
    return sort
  }
  return 'downloads'
}

function skillHubSort(sort: SkillMarketListParams['sort']): string {
  if (sort === 'updated') {
    return 'updated_at'
  }
  if (sort === 'installs' || sort === 'stars') {
    return sort
  }
  return 'downloads'
}

function addOptionalParam(url: URL, name: string, value: string | undefined) {
  const trimmed = value?.trim()
  if (trimmed) {
    url.searchParams.set(name, trimmed)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
