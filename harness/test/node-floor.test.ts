import { describe, expect, test } from 'vitest'
import { checkNodeFloor } from '../src/nodeFloor.js'

const FLOOR: [number, number, number] = [24, 9, 0]

describe('checkNodeFloor', () => {
  test('accepts the floor itself', () => {
    expect(checkNodeFloor('24.9.0', FLOOR)).toEqual({ ok: true, reason: null })
  })

  test('compares numerically, not as text', () => {
    // '24.19.0' < '24.9.0' as strings, and that would be the wrong answer.
    expect(checkNodeFloor('24.19.0', FLOOR).ok).toBe(true)
    expect(checkNodeFloor('24.8.9', FLOOR).ok).toBe(false)
  })

  test('rejects a version below the floor with the product-facing reason', () => {
    const result = checkNodeFloor('22.19.0', FLOOR)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Node.js 24.9.0 or later is required for the dsh runtime')
  })

  test('accepts a newer major version', () => {
    expect(checkNodeFloor('25.0.0', FLOOR).ok).toBe(true)
  })

  test('accepts a leading v because process.version carries one', () => {
    expect(checkNodeFloor('v24.9.0', FLOOR).ok).toBe(true)
  })

  test('rejects anything it cannot parse, including a missing segment', () => {
    for (const value of ['bun', '', '24', '24.9', '24.9.0-rc.1']) {
      const result = checkNodeFloor(value, FLOOR)
      expect(result.ok, value).toBe(false)
      expect(result.reason, value).toBeTruthy()
    }
  })
})
