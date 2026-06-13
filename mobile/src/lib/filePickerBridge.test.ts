import { describe, expect, mock, test } from 'bun:test'
import { createFilePickerScript, isFilePickRequest } from './filePickerBridge'

mock.module('expo-document-picker', () => ({
  getDocumentAsync: async () => ({ canceled: true, assets: [] }),
}))

mock.module('expo-file-system/legacy', () => ({
  readAsStringAsync: async () => '',
  EncodingType: { Base64: 'base64' },
}))

describe('isFilePickRequest', () => {
  test('accepts valid file pick request', () => {
    expect(isFilePickRequest({ type: 'codemobile:file:pick' })).toBe(true)
  })

  test('rejects wrong type', () => {
    expect(isFilePickRequest({ type: 'codemobile:ws:status', status: 'connected' })).toBe(false)
  })

  test('rejects non-object', () => {
    expect(isFilePickRequest(null)).toBe(false)
    expect(isFilePickRequest('codemobile:file:pick')).toBe(false)
  })
})

describe('createFilePickerScript', () => {
  test('returns a non-empty string', () => {
    const script = createFilePickerScript()
    expect(typeof script).toBe('string')
    expect(script.length).toBeGreaterThan(50)
  })

  test('includes install guard', () => {
    const script = createFilePickerScript()
    expect(script).toContain('__codemobileFilePickerInstalled')
    expect(script).toContain('if (window.__codemobileFilePickerInstalled) return')
  })

  test('intercepts file input clicks', () => {
    const script = createFilePickerScript()
    expect(script).toContain("type === 'file'")
    expect(script).toContain('preventDefault')
    expect(script).toContain('codemobile:file:pick')
  })
})
