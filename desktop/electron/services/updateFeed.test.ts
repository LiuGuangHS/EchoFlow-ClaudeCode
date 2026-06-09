import { describe, expect, it } from 'vitest'
import { dedupeUpdateFeedUrls, normalizeUpdateFeedBaseUrl, resolveUpdateFeedUrls } from './updateFeed'

const DIRECT_FEED = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/'
const DEFAULT_PROXY_FEED = `https://gh-proxy.org/${DIRECT_FEED}`

describe('update feed resolution', () => {
  it('normalizes http and https feed base URLs with trailing slashes', () => {
    expect(normalizeUpdateFeedBaseUrl(' https://updates.example.com/feed ')).toBe('https://updates.example.com/feed/')
    expect(normalizeUpdateFeedBaseUrl('http://updates.example.com/feed/')).toBe('http://updates.example.com/feed/')
  })

  it('rejects empty, invalid, and non-http URLs', () => {
    expect(normalizeUpdateFeedBaseUrl('')).toBeNull()
    expect(normalizeUpdateFeedBaseUrl('not a url')).toBeNull()
    expect(normalizeUpdateFeedBaseUrl('file:///tmp/releases')).toBeNull()
  })

  it('deduplicates feed URLs while preserving order', () => {
    expect(dedupeUpdateFeedUrls(['https://a.test/', 'https://b.test/', 'https://a.test/'])).toEqual([
      'https://a.test/',
      'https://b.test/',
    ])
  })

  it('uses an explicit update feed URL when configured', () => {
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_FEED_URL: ' https://updates.example.com/releases ',
    })).toEqual(['https://updates.example.com/releases/'])
  })

  it('ignores an invalid explicit feed URL and uses defaults', () => {
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_FEED_URL: 'file:///tmp/releases',
    })).toEqual([DEFAULT_PROXY_FEED, DIRECT_FEED])
  })

  it('uses a custom GitHub proxy base before the direct GitHub feed', () => {
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_GITHUB_PROXY_BASE: 'https://proxy.example.com',
    })).toEqual([
      `https://proxy.example.com/${DIRECT_FEED}`,
      DIRECT_FEED,
    ])
  })

  it('falls back to the built-in proxy and direct GitHub feed by default', () => {
    expect(resolveUpdateFeedUrls({})).toEqual([DEFAULT_PROXY_FEED, DIRECT_FEED])
  })
})
