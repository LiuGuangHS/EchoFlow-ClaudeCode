import { EchoFlowApiError, EchoFlowApiService } from '../services/echoflowApiService.js'
import { errorResponse } from '../middleware/errorHandler.js'

const service = new EchoFlowApiService()

export async function handleEchoFlowApi(req: Request, _url: URL, segments: string[]): Promise<Response> {
  try {
    const action = segments[2]

    if (action === 'validate-management-token' && req.method === 'POST') {
      const body = await req.json() as { managementToken?: string }
      const token = body.managementToken?.trim()
      if (!token) return Response.json({ valid: false, error: 'missing_token' }, { status: 400 })

      try {
        const userInfo = await service.validateManagementToken(token)
        const models = await service.listModels(token).catch(() => [])
        return Response.json({ valid: true, ...userInfo, models })
      } catch (error) {
        if (error instanceof EchoFlowApiError) {
          const status = error.code === 'token_invalid' ? 200 : 502
          return Response.json({ valid: false, error: error.code }, { status })
        }
        return Response.json({ valid: false, error: 'service_unavailable' }, { status: 502 })
      }
    }

    if (action === 'models' && req.method === 'GET') {
      const token = _url.searchParams.get('managementToken')?.trim()
      if (!token) return Response.json({ models: [] }, { status: 400 })
      const models = await service.listModels(token).catch(() => [])
      return Response.json({ models })
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}
