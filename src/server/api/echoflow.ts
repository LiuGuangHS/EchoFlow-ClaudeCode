import { z } from 'zod'
import { EchoFlowApiError, EchoFlowApiService } from '../services/echoflowApiService.js'
import { LegacyMigrationService } from '../services/legacyMigrationService.js'
import { isLocalAccessAuthorized } from '../localAccessAuth.js'
import { ProviderService } from '../services/providerService.js'
import { errorResponse } from '../middleware/errorHandler.js'

const service = new EchoFlowApiService()
const providerService = new ProviderService()
const ECHOFLOW_PRESET_ID = 'echoflowai'
const ECHOFLOW_BASE_URLS = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
}
const ECHOFLOW_DEFAULT_MODELS = {
  main: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

const BindAccountSchema = z.object({
  userId: z.string().trim().min(1),
  managementToken: z.string().trim().min(1),
  endpoint: z.enum(['main', 'dedicated']).optional(),
})

const UpdateEndpointSchema = z.object({
  endpoint: z.enum(['main', 'dedicated']),
})

const SelectTokenSchema = z.object({
  tokenId: z.string().trim().min(1),
  providerId: z.string().trim().min(1).optional(),
})

const LegacyMigrationConfirmationSchema = z.object({
  confirmed: z.literal(true),
})

export async function handleEchoFlowApi(req: Request, _url: URL, segments: string[]): Promise<Response> {
  try {
    const action = segments[2]

    if (!action && req.method === 'GET') {
      return Response.json({ account: await service.getAccount() })
    }

    if (action === 'account') {
      if (req.method === 'POST') {
        const input = BindAccountSchema.parse(await req.json())
        return Response.json({ account: await service.bindAccount(input.userId, input.managementToken, input.endpoint) })
      }
      if (req.method === 'PUT') {
        return Response.json({ account: await service.refreshAccount() })
      }
      if (req.method === 'DELETE') {
        await service.disconnectAccount()
        return Response.json({ ok: true })
      }
      if (req.method === 'PATCH') {
        const input = UpdateEndpointSchema.parse(await req.json())
        return Response.json({ account: await service.updateEndpoint(input.endpoint) })
      }
    }

    if (action === 'migration') {
      if (!isLocalAccessAuthorized(req)) {
        return Response.json({ error: 'local_access_required' }, { status: 403 })
      }
      const migrationService = new LegacyMigrationService()
      if (req.method === 'GET') {
        return Response.json(await migrationService.getStatus())
      }
      if (req.method === 'POST') {
        LegacyMigrationConfirmationSchema.parse(await req.json())
        return Response.json(await migrationService.run())
      }
    }

    if (action === 'select-token' && req.method === 'POST') {
      const input = SelectTokenSchema.parse(await req.json())
      const token = await service.selectAccountToken(input.tokenId)
      const account = await service.getAccount()
      const baseUrl = account?.endpoint ? ECHOFLOW_BASE_URLS[account.endpoint] : ECHOFLOW_BASE_URLS.main
      if (input.providerId) {
        const provider = await providerService.getProvider(input.providerId)
        if (provider.presetId !== ECHOFLOW_PRESET_ID) return Response.json({ error: 'invalid_provider' }, { status: 400 })
        const updated = await providerService.updateProvider(input.providerId, { apiKey: token.key })
        return Response.json({ provider: { id: updated.id } })
      }
      const { providers } = await providerService.listProviders()
      const existing = providers.find((provider) => provider.presetId === ECHOFLOW_PRESET_ID && provider.apiKey === token.key)
      if (existing) return Response.json({ provider: { id: existing.id } })
      const provider = await providerService.addProvider({
        presetId: ECHOFLOW_PRESET_ID,
        name: `EchoFlow API #${providers.filter((item) => item.presetId === ECHOFLOW_PRESET_ID).length + 1}`,
        baseUrl,
        apiKey: token.key,
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
        models: ECHOFLOW_DEFAULT_MODELS,
      })
      return Response.json({ provider: { id: provider.id } }, { status: 201 })
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'invalid_request' }, { status: 400 })
    }
    if (error instanceof EchoFlowApiError) {
      return Response.json({ error: error.code }, { status: error.code === 'token_invalid' ? 400 : 502 })
    }
    return errorResponse(error)
  }
}
