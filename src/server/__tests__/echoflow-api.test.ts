import { describe, expect, mock, test } from 'bun:test'
import { handleEchoFlowApi } from '../api/echoflow.js'

function makeRequest(body: Record<string, unknown>) {
  const req = new Request('http://localhost:3456/api/echoflow/validate-management-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const url = new URL(req.url)
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

describe('EchoFlow API', () => {
  test('classifies Chinese management-token auth failures as token_invalid', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      success: false,
      message: '无权进行此操作',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

    try {
      const { req, url, segments } = makeRequest({
        userId: '106452',
        managementToken: 'bad-management-token',
      })
      const res = await handleEchoFlowApi(req, url, segments)
      const body = await res.json() as { valid: boolean; error: string }

      expect(res.status).toBe(200)
      expect(body).toEqual({ valid: false, error: 'token_invalid' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
