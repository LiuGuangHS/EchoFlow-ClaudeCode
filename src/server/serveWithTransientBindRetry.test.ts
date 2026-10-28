import { describe, expect, test } from 'bun:test'
import { isTransientBindFailure, serveWithTransientBindRetry } from './serveWithTransientBindRetry.js'

/** The exact shape Bun 1.3.14 reports for any bind failure — including the
 * spurious one seen under CPU load, where kernel resources were healthy and an
 * immediate retry succeeded (probe: artifacts/local-rerun/bind-churn-probe.ts). */
function maskedBindFailure(): Error {
  return Object.assign(new Error('Failed to start server. Is port 0 in use?'), {
    code: 'EADDRINUSE',
    errno: 0,
    syscall: 'listen',
  })
}

describe('serveWithTransientBindRetry', () => {
  test('recovers the masked transient bind failure with exactly one retry', () => {
    let calls = 0
    const server = serveWithTransientBindRetry(() => {
      calls++
      if (calls === 1) throw maskedBindFailure()
      return 'server' as const
    })
    expect(server).toBe('server')
    expect(calls).toBe(2)
  })

  test('lets a non-bind failure through without a retry', () => {
    let calls = 0
    expect(() => serveWithTransientBindRetry(() => {
      calls++
      throw new TypeError('x is not a function')
    })).toThrow('x is not a function')
    expect(calls).toBe(1)
  })

  test('propagates the failure when the retry fails too', () => {
    let calls = 0
    expect(() => serveWithTransientBindRetry(() => {
      calls++
      throw maskedBindFailure()
    })).toThrow('Is port 0 in use')
    expect(calls).toBe(2)
  })

  test('does not disturb a successful bind', () => {
    let calls = 0
    expect(serveWithTransientBindRetry(() => { calls++; return 'server' as const })).toBe('server')
    expect(calls).toBe(1)
  })

  test('only the exact masked bind shape qualifies as transient', () => {
    expect(isTransientBindFailure(maskedBindFailure())).toBe(true)
    expect(isTransientBindFailure(Object.assign(new Error('nope'), { code: 'EADDRINUSE', errno: 98, syscall: 'listen' }))).toBe(false)
    expect(isTransientBindFailure(Object.assign(new Error('nope'), { code: 'EACCES', errno: 0, syscall: 'listen' }))).toBe(false)
    expect(isTransientBindFailure(new Error('Failed to start server. Is port 0 in use?'))).toBe(false)
    expect(isTransientBindFailure(undefined)).toBe(false)
  })
})
