import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { LegacyMigrationService } from '../services/legacyMigrationService.js'

export async function handleLegacyMigrationApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]
    const legacyMigrationService = new LegacyMigrationService()

    if (req.method === 'GET' && action === 'status') {
      return Response.json(await legacyMigrationService.getStatus())
    }

    if (req.method === 'POST' && action === 'run') {
      await discardJsonBody(req)
      return Response.json(await legacyMigrationService.run())
    }

    if (!action) {
      throw methodNotAllowed(req.method, '/api/legacy-migration')
    }

    throw ApiError.notFound(`Unknown legacy migration endpoint: ${action}`)
  } catch (error) {
    return errorResponse(error)
  }
}

async function discardJsonBody(req: Request): Promise<void> {
  if (
    !req.headers.get('content-length') &&
    !req.headers.get('transfer-encoding') &&
    !req.headers.get('content-type')
  ) {
    return
  }

  try {
    await req.json()
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string, route: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed on ${route}`, 'METHOD_NOT_ALLOWED')
}
