import { describe, expect, it } from 'vitest'
import { dedupeUpdateFeedUrls, normalizeUpdateFeedBaseUrl, resolveUpdateFeedConfig, resolveUpdateFeedUrls } from './updateFeed'

const DIRECT_FEED = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/'
const DEFAULT_PROXY_FEED = `https://gh-proxy.org/${DIRECT_FEED}`

describe('update feed resolution', () => {
  it('normalizes HTTPS feed base URLs with trailing slashes', () => {
    expect(normalizeUpdateFeedBaseUrl(' https://updates.example.com/feed ')).toBe('https://updates.example.com/feed/')
    expect(normalizeUpdateFeedBaseUrl('http://updates.example.com/feed/')).toBeNull()
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

  it('ignores an invalid explicit feed URL and uses GitHub metadata with proxy download fallback', () => {
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_FEED_URL: 'file:///tmp/releases',
    })).toEqual([DIRECT_FEED, DEFAULT_PROXY_FEED])
  })

  it('uses a custom GitHub proxy base for download fallback after GitHub metadata', () => {
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_GITHUB_PROXY_BASE: 'https://proxy.example.com',
    })).toEqual([
      DIRECT_FEED,
      `https://proxy.example.com/${DIRECT_FEED}`,
    ])
  })

  it('uses GitHub metadata with the built-in proxy as the download fallback by default', () => {
    expect(resolveUpdateFeedConfig({})).toEqual({
      metadataUrl: DIRECT_FEED,
      downloadFeedUrls: [DEFAULT_PROXY_FEED, DIRECT_FEED],
    })
    expect(resolveUpdateFeedUrls({})).toEqual([DIRECT_FEED, DEFAULT_PROXY_FEED])
  })
})
