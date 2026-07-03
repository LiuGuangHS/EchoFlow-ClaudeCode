import {
  createSkillMarketService,
  type SkillMarketListParams,
  type SkillMarketService,
  type SkillMarketServiceOptions,
} from '../services/skillMarket/service.js'
import type { SkillMarketSource } from '../services/skillMarket/types.js'
import { collectUserSkillNames } from './skills.js'

type SkillMarketServiceFactory = (options: SkillMarketServiceOptions) => SkillMarketService

const SUPPORTED_SOURCES = new Set(['auto', 'clawhub', 'skillhub'])
const SUPPORTED_DETAIL_SOURCES = new Set(['clawhub', 'skillhub'])
const SUPPORTED_SORTS = new Set(['downloads', 'installs', 'stars', 'updated', 'trending'])
const MAX_LIMIT = 100

let skillMarketServiceFactory: SkillMarketServiceFactory = createSkillMarketService

export function setSkillMarketServiceFactoryForTests(factory: SkillMarketServiceFactory): void {
  skillMarketServiceFactory = factory
}

export function resetSkillMarketServiceFactoryForTests(): void {
  skillMarketServiceFactory = createSkillMarketService
}

export async function handleSkillMarketApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const action = segments[2]

  if (req.method === 'GET' && action === undefined) {
    const params = parseListParams(url)
    if (params instanceof Response) {
      return params
    }

    const service = skillMarketServiceFactory({
      installedSkillNames: collectUserSkillNames,
    })
    const result = await service.list(params)
    return Response.json(result)
  }

  if (action === 'install') {
    if (req.method !== 'POST') {
      return jsonError('method_not_allowed', 'Method not allowed for skill market install.', 405)
    }
    return handleInstallSkeleton(req)
  }

  if (action !== undefined) {
    return handleDetail(req, segments, action)
  }

  return jsonError('method_not_allowed', 'Method not allowed for skill market.', 405)
}

async function handleDetail(req: Request, segments: string[], sourceSegment: string): Promise<Response> {
  if (!SUPPORTED_DETAIL_SOURCES.has(sourceSegment)) {
    return jsonError('unsupported_source', `Unsupported skill market source: ${sourceSegment}`, 400)
  }

  if (req.method !== 'GET') {
    return jsonError('method_not_allowed', 'Method not allowed for skill market detail.', 405)
  }

  const slug = decodeSkillSlug(segments[3])
  if (!slug || segments.length !== 4) {
    return jsonError('not_found', 'Skill market skill not found.', 404)
  }

  const service = skillMarketServiceFactory({
    installedSkillNames: collectUserSkillNames,
  })
  const detail = await service.getDetail({
    source: sourceSegment as SkillMarketSource,
    slug,
  })

  if (!detail) {
    return jsonError('not_found', 'Skill market skill not found.', 404)
  }

  return Response.json({ detail })
}

function parseListParams(url: URL): SkillMarketListParams | Response {
  const params: SkillMarketListParams = {}
  const source = url.searchParams.get('source')
  const sort = url.searchParams.get('sort')
  const limit = url.searchParams.get('limit')
  const query = url.searchParams.get('query') ?? url.searchParams.get('q')
  const cursor = url.searchParams.get('cursor')

  if (source !== null) {
    if (!SUPPORTED_SOURCES.has(source)) {
      return jsonError('unsupported_source', `Unsupported skill market source: ${source}`, 400)
    }
    params.source = source as SkillMarketListParams['source']
  }

  if (sort !== null) {
    if (!SUPPORTED_SORTS.has(sort)) {
      return jsonError('unsupported_sort', `Unsupported skill market sort: ${sort}`, 400)
    }
    params.sort = sort as SkillMarketListParams['sort']
  }

  if (limit !== null) {
    const parsedLimit = Number(limit)
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return jsonError('invalid_limit', 'Skill market limit must be an integer from 1 to 100.', 400)
    }
    params.limit = parsedLimit
  }

  if (query !== null) {
    params.query = query
  }

  if (cursor !== null) {
    params.cursor = cursor
  }

  return params
}

function decodeSkillSlug(segment: string | undefined): string | null {
  if (segment === undefined) {
    return null
  }

  try {
    const decoded = decodeURIComponent(segment).trim()
    return decoded || null
  } catch {
    return null
  }
}

async function handleInstallSkeleton(req: Request): Promise<Response> {
  const body = await parseJsonObject(req)
  if (!body) {
    return jsonError('invalid_json', 'Request body must be a JSON object.', 400)
  }

  if ('targetPath' in body || 'target' in body || 'path' in body) {
    return jsonError('target_path_not_allowed', 'Install target is computed by the server.', 400)
  }

  return jsonError('install_not_wired', 'Skill market install is not wired yet.', 501)
}

async function parseJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null
    }
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

function jsonError(error: string, message: string, status: number): Response {
  return Response.json({ error, message }, { status })
}
