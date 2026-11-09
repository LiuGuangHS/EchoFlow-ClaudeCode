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
  it('compares UTF-8 bytes through the crypto boundary in an isolated process', async () => {
    // Keep crypto instrumentation out of the shared Bun test module cache.
    const child = Bun.spawn([process.execPath, '--eval', `
      import assert from 'node:assert/strict'
      import * as crypto from 'node:crypto'
      import { mock } from 'bun:test'
      const nativeEqual = crypto.timingSafeEqual
      const calls = []
      let rejectComparison = false
      mock.module('node:crypto', () => ({
        ...crypto,
        timingSafeEqual(supplied, expected) {
          assert(Buffer.isBuffer(supplied))
          assert(Buffer.isBuffer(expected))
          calls.push([supplied.toString('hex'), expected.toString('hex')])
          return nativeEqual(supplied, expected) && !rejectComparison
        },
      }))
      const { validateAuth } = await import(${JSON.stringify(new URL('./auth.ts', import.meta.url).href)})
      const request = token => new Request('http://localhost/api/status', {
        headers: { Authorization: 'Bearer ' + token },
      })
      for (const [expected, supplied, valid, compared] of [
        ['fixture-key', 'fixture-key', true, true],
        ['fixture-key', 'fixture-kez', false, true],
        ['fixture-key', 'fixture', false, false],
        ['fixture-key', 'fixture-key-extra', false, false],
        ['éé', 'éé', true, true],
        ['éé', 'èé', false, true],
        ['éé', 'eé', false, false],
        ['éé', 'aaaa', false, true],
      ]) {
        calls.length = 0
        process.env.ANTHROPIC_API_KEY = expected
        assert.deepEqual(validateAuth(request(supplied)), valid
          ? { valid: true }
          : { valid: false, error: 'Invalid API key' })
        assert.deepEqual(calls, compared
          ? [[Buffer.from(supplied).toString('hex'), Buffer.from(expected).toString('hex')]]
          : [], 'crypto boundary for ' + JSON.stringify({ expected, supplied }))
      }
      rejectComparison = true
      assert.deepEqual(validateAuth(request('éé')), { valid: false, error: 'Invalid API key' })
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
  })

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