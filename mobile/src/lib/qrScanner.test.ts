import { describe, expect, test } from 'bun:test'
import { parseLaunchUrl } from './qrScanner'

describe('parseLaunchUrl', () => {
  test('parses a valid CodeMobile launch URL with encoded params', () => {
    const result = parseLaunchUrl(
      'http://192.168.1.10:3456/?serverUrl=http%3A%2F%2F192.168.1.10%3A3456&h5Token=h5_abc123',
    )
    expect(result).toEqual({
      serverUrl: 'http://192.168.1.10:3456',
      h5Token: 'h5_abc123',
    })
  })

  test('parses a launch URL with unencoded params', () => {
    const result = parseLaunchUrl(
      'http://192.168.1.10:3456/?serverUrl=http://192.168.1.10:3456&h5Token=h5_abc123',
    )
    expect(result).toEqual({
      serverUrl: 'http://192.168.1.10:3456',
      h5Token: 'h5_abc123',
    })
  })

  test('parses an HTTPS launch URL with a reverse-proxy path', () => {
    const result = parseLaunchUrl(
      'https://h5.example.com/app/?serverUrl=https%3A%2F%2Fh5.example.com%2Fapp&h5Token=h5_xyz',
    )
    expect(result).toEqual({
      serverUrl: 'https://h5.example.com/app',
      h5Token: 'h5_xyz',
    })
  })

  test('returns null for empty input', () => {
    expect(parseLaunchUrl('')).toBeNull()
    expect(parseLaunchUrl('   ')).toBeNull()
  })

  test('returns null for non-HTTP URLs', () => {
    expect(parseLaunchUrl('ftp://example.com/?serverUrl=x&h5Token=y')).toBeNull()
    expect(parseLaunchUrl('ws://example.com/?serverUrl=x&h5Token=y')).toBeNull()
  })

  test('returns null when serverUrl parameter is missing', () => {
    expect(parseLaunchUrl('http://192.168.1.10:3456/?h5Token=h5_abc')).toBeNull()
  })

  test('returns null when h5Token parameter is missing', () => {
    expect(parseLaunchUrl('http://192.168.1.10:3456/?serverUrl=http://x')).toBeNull()
  })

  test('returns null when h5Token is empty', () => {
    expect(parseLaunchUrl('http://192.168.1.10:3456/?serverUrl=http://x&h5Token=  ')).toBeNull()
  })

  test('returns null when serverUrl is not a valid HTTP URL', () => {
    expect(parseLaunchUrl('http://192.168.1.10:3456/?serverUrl=not-a-url&h5Token=h5_abc')).toBeNull()
    expect(parseLaunchUrl('http://192.168.1.10:3456/?serverUrl=ftp://x&h5Token=h5_abc')).toBeNull()
  })

  test('returns null for random text that is not a URL', () => {
    expect(parseLaunchUrl('hello world')).toBeNull()
    expect(parseLaunchUrl('codemobile://connect')).toBeNull()
  })

  test('handles extra query parameters gracefully', () => {
    const result = parseLaunchUrl(
      'http://192.168.1.10:3456/?extra=foo&serverUrl=http%3A%2F%2F192.168.1.10%3A3456&h5Token=h5_abc&other=bar',
    )
    expect(result).toEqual({
      serverUrl: 'http://192.168.1.10:3456',
      h5Token: 'h5_abc',
    })
  })
})
