import { describe, expect, test } from 'bun:test'
import { createWsMonitorScript, isWsBridgeMessage } from './webViewBridge'

describe('isWsBridgeMessage', () => {
  test('accepts valid connected message', () => {
    expect(isWsBridgeMessage({ type: 'codemobile:ws:status', status: 'connected' })).toBe(true)
  })

  test('accepts valid disconnected message', () => {
    expect(isWsBridgeMessage({ type: 'codemobile:ws:status', status: 'disconnected' })).toBe(true)
  })

  test('accepts valid reconnecting message', () => {
    expect(isWsBridgeMessage({ type: 'codemobile:ws:status', status: 'reconnecting', sessionId: 's1' })).toBe(true)
  })

  test('rejects unknown status values', () => {
    expect(isWsBridgeMessage({ type: 'codemobile:ws:status', status: 'unknown' })).toBe(false)
  })

  test('rejects missing status', () => {
    expect(isWsBridgeMessage({ type: 'codemobile:ws:status' })).toBe(false)
  })

  test('rejects wrong type', () => {
    expect(isWsBridgeMessage({ type: 'other', status: 'connected' })).toBe(false)
  })

  test('rejects non-object input', () => {
    expect(isWsBridgeMessage(null)).toBe(false)
    expect(isWsBridgeMessage('codemobile:ws:status')).toBe(false)
    expect(isWsBridgeMessage(42)).toBe(false)
  })
})

describe('createWsMonitorScript', () => {
  test('returns a non-empty string', () => {
    const script = createWsMonitorScript()
    expect(typeof script).toBe('string')
    expect(script.length).toBeGreaterThan(100)
  })

  test('is an IIFE that checks install guard', () => {
    const script = createWsMonitorScript()
    expect(script).toContain('(function()')
    expect(script).toContain('__codemobileWsMonitorInstalled')
  })

  test('references OriginalWebSocket pattern', () => {
    const script = createWsMonitorScript()
    expect(script).toContain('OriginalWebSocket')
  })

  test('posts expected message shape', () => {
    const script = createWsMonitorScript()
    expect(script).toContain('codemobile:ws:status')
    expect(script).toContain('ReactNativeWebView')
  })

  test('produces idempotent install (guard flag check)', () => {
    const script = createWsMonitorScript()
    expect(script).toContain('if (window.__codemobileWsMonitorInstalled) return')
  })
})
