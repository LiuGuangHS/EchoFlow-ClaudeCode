import { afterEach, describe, expect, test } from 'bun:test'
import { getAnthropicApiKeyWithSource } from './auth.js'

describe('getAnthropicApiKeyWithSource', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  })

  test('accepts ANTHROPIC_AUTH_TOKEN as CI/test authentication without throwing', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
    process.env.ANTHROPIC_AUTH_TOKEN = 'fake-provider-bearer-token'

    expect(getAnthropicApiKeyWithSource()).toEqual({ key: null, source: 'none' })
  })
})
