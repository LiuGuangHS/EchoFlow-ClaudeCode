import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAnthropicApiKeyWithSource } from './auth.js'

describe('getAnthropicApiKeyWithSource', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
    delete process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, originalEnv)
  })

  test('accepts ANTHROPIC_AUTH_TOKEN as CI/test authentication without throwing', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'fake-provider-bearer-token'

    expect(getAnthropicApiKeyWithSource()).toEqual({ key: null, source: 'none' })
  })

  test('still rejects CI/test calls with no authentication', () => {
    expect(() => getAnthropicApiKeyWithSource()).toThrow('env var is required')
  })

  test('returns an API key rather than the bearer token when both are configured', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'fake-provider-bearer-token'
    process.env.ANTHROPIC_API_KEY = 'fake-api-key'

    expect(getAnthropicApiKeyWithSource()).toEqual({
      key: 'fake-api-key', source: 'ANTHROPIC_API_KEY',
    })
  })
})
