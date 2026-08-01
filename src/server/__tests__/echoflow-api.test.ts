import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleEchoFlowApi } from '../api/echoflow.js'

let temporaryConfigDir: string
let previousConfigDir: string | undefined

beforeEach(async () => {
  temporaryConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echoflow-api-test-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = temporaryConfigDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await fs.rm(temporaryConfigDir, { recursive: true, force: true })
})

function makeRequest(body: Record<string, unknown>) {
  const req = new Request('http://localhost:3456/api/echoflow/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const url = new URL(req.url)
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

describe('EchoFlow account API', () => {
  test('preserves boolean token quota flags while binding an account', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: { quota: 500_000, group: 'default', username: 'echo' },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'token-1', key: 'sk-test', unlimited_quota: true }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const { req, url, segments } = makeRequest({ userId: '106452', managementToken: 'token' })
      const response = await handleEchoFlowApi(req, url, segments)
      const body = await response.json() as { account: { tokens: Array<{ key?: string; keyPreview?: string; unlimitedQuota?: boolean }> } }

      expect(response.status).toBe(200)
      expect(body.account.tokens).toEqual([expect.objectContaining({ keyPreview: '••••••••', unlimitedQuota: true })])
      expect(body.account.tokens[0]?.key).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('classifies management-token auth failures as token_invalid', async () => {
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
      const response = await handleEchoFlowApi(req, url, segments)
      const body = await response.json() as { error: string }

      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'token_invalid' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
