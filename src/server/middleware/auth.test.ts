import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { validateAuth } from './auth'

let previousApiKey: string | undefined

beforeEach(() => {
  previousApiKey = process.env.ANTHROPIC_API_KEY
})

afterEach(() => {
  if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = previousApiKey
})

function requestWith(token: string): Request {
  return new Request('http://localhost:3456/api/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

describe('validateAuth', () => {
  it('accepts the configured API key', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    expect(validateAuth(requestWith('fixture-key'))).toEqual({ valid: true })
  })

  it('rejects a key that differs only in the final byte', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    expect(validateAuth(requestWith('fixture-kez'))).toEqual({
      valid: false,
      error: 'Invalid API key',
    })
  })

  it('rejects a shorter key that is a prefix of the configured one', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    expect(validateAuth(requestWith('fixture'))).toEqual({
      valid: false,
      error: 'Invalid API key',
    })
  })

  it('rejects a longer key that extends the configured one', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    const extended = 'fixture-key-extra'
    expect(validateAuth(requestWith(extended))).toEqual({
      valid: false,
      error: 'Invalid API key',
    })
  })

  it('rejects everything when no API key is configured', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(validateAuth(requestWith('anything'))).toEqual({
      valid: false,
      error: 'Server ANTHROPIC_API_KEY not configured',
    })
  })

  it('rejects a malformed Authorization header', () => {
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    const req = new Request('http://localhost:3456/api/status', {
      headers: { Authorization: 'fixture-key' },
    })
    expect(validateAuth(req)).toEqual({
      valid: false,
      error: 'Invalid Authorization format. Use: Bearer <token>',
    })
  })
})