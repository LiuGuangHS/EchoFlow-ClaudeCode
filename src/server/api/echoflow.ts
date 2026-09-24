import { z } from 'zod'
import { EchoFlowApiError, EchoFlowApiService } from '../services/echoflowApiService.js'
import { LegacyMigrationService } from '../services/legacyMigrationService.js'
import { isLocalAccessAuthorized } from '../localAccessAuth.js'
import { ProviderService, toPublicProvider } from '../services/providerService.js'
import { fetchProviderModels } from '../services/providerModelCatalog.js'
import { errorResponse } from '../middleware/errorHandler.js'
import { CreateProviderSchema, TestProviderSchema } from '../types/provider.js'

const service = new EchoFlowApiService()
const providerService = new ProviderService()
const ECHOFLOW_PRESET_ID = 'echoflowai'
const ECHOFLOW_BASE_URLS = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
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
  endpoint: z.enum(['main', 'dedicated']).default('main'),
  tokenId: z.string().trim().min(1),
  providerId: z.string().trim().min(1).optional(),
})

const EchoFlowProviderSchema = CreateProviderSchema.omit({ presetId: true, apiKey: true }).extend({
  endpoint: z.enum(['main', 'dedicated']),
  tokenId: z.string().trim().min(1),
})

const EchoFlowTestSchema = TestProviderSchema.omit({ apiKey: true }).extend({
  endpoint: z.enum(['main', 'dedicated']),
  tokenId: z.string().trim().min(1),
})

const EchoFlowModelsSchema = z.object({
  endpoint: z.enum(['main', 'dedicated']),
  tokenId: z.string().trim().min(1),
})

const LegacyMigrationConfirmationSchema = z.object({
  confirmed: z.literal(true),
})

export async function handleEchoFlowApi(req: Request, _url: URL, segments: string[]): Promise<Response> {
  try {
    const action = segments[2]

    if (!action && req.method === 'GET') {
      const accounts = await service.getAccounts()
      return Response.json({ account: accounts.main, accounts })
    }

    if (action === 'account') {
      if (req.method === 'POST') {
        const input = BindAccountSchema.parse(await req.json())
        return Response.json({ account: await service.bindAccount(input.userId, input.managementToken, input.endpoint) })
      }
      if (req.method === 'PUT') {
        const input = z.object({ endpoint: z.enum(['main', 'dedicated']).default('main') }).parse(await req.json())
        return Response.json({ account: await service.refreshAccount(input.endpoint) })
      }
      if (req.method === 'DELETE') {
        const input = z.object({ endpoint: z.enum(['main', 'dedicated']).default('main') }).parse(await req.json().catch(() => ({})))
        await service.disconnectAccount(input.endpoint)
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

    if (action === 'provider' && req.method === 'POST') {
      const input = EchoFlowProviderSchema.parse(await req.json())
      const token = await service.selectAccountToken(input.endpoint, input.tokenId)
      const { endpoint, tokenId: _tokenId, ...providerInput } = input
      const provider = await providerService.addProvider({
        ...providerInput,
        presetId: ECHOFLOW_PRESET_ID,
        apiKey: token.key,
        credentialSource: {
          kind: 'echoflow-token',
          endpoint,
          tokenId: token.id,
          tokenName: token.name,
        },
        // The endpoint is part of the credential namespace. Never allow a
        // client to combine a token with the other endpoint's base URL.
        baseUrl: ECHOFLOW_BASE_URLS[endpoint],
      })
      return Response.json({ provider: toPublicProvider(provider) }, { status: 201 })
    }

    if (action === 'models' && req.method === 'POST') {
      const input = EchoFlowModelsSchema.parse(await req.json())
      const token = await service.selectAccountToken(input.endpoint, input.tokenId)
      return Response.json(await fetchProviderModels({
        baseUrl: ECHOFLOW_BASE_URLS[input.endpoint],
        apiKey: token.key,
      }))
    }

    if (action === 'test-provider' && req.method === 'POST') {
      const input = EchoFlowTestSchema.parse(await req.json())
      const token = await service.selectAccountToken(input.endpoint, input.tokenId)
      const { endpoint: _endpoint, tokenId: _tokenId, ...testInput } = input
      return Response.json({
        result: await providerService.testProviderConfig({
          ...testInput,
          apiKey: token.key,
          baseUrl: ECHOFLOW_BASE_URLS[input.endpoint],
        }),
      })
    }

    if (action === 'select-token' && req.method === 'POST') {
      const input = SelectTokenSchema.parse(await req.json())
      const token = await service.selectAccountToken(input.endpoint, input.tokenId)
      if (!input.providerId) {
        const keyPreview = token.key.length <= 8
          ? '••••••••'
          : token.key.startsWith('sk-')
            ? `sk-${token.key.slice(3, 6)}****${token.key.slice(-4)}`
            : `${token.key.slice(0, 6)}****${token.key.slice(-4)}`
        return Response.json({
          token: {
            id: token.id,
            name: token.name,
            keyPreview,
          },
        })
      }
      const provider = await providerService.getProvider(input.providerId)
      if (provider.presetId !== ECHOFLOW_PRESET_ID) return Response.json({ error: 'invalid_provider' }, { status: 400 })
      const updated = await providerService.updateProvider(input.providerId, {
        apiKey: token.key,
        baseUrl: ECHOFLOW_BASE_URLS[input.endpoint],
        credentialSource: {
          kind: 'echoflow-token',
          endpoint: input.endpoint,
          tokenId: token.id,
          tokenName: token.name,
        },
      })
      return Response.json({ provider: { id: updated.id } })
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
