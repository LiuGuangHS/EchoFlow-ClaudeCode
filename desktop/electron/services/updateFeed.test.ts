import { describe, expect, it } from 'vitest'
import { dedupeUpdateFeedUrls, normalizeUpdateFeedBaseUrl, resolveUpdateFeedConfig, resolveUpdateFeedUrls } from './updateFeed'

const DIRECT_FEED = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/'
const DEFAULT_PROXY_FEED = `https://gh-proxy.org/${DIRECT_FEED}`
const SELF_UPDATE_METADATA = 'https://code.echoflow.cn/update/'

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

  it('uses an explicit update feed URL as a single source without fallbacks', () => {
    expect(resolveUpdateFeedConfig({
      ECHOFLOW_UPDATE_FEED_URL: ' https://updates.example.com/releases ',
    })).toEqual({
      metadataUrl: 'https://updates.example.com/releases/',
      metadataFallbackUrls: [],
      downloadFeedUrls: ['https://updates.example.com/releases/'],
    })
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_FEED_URL: ' https://updates.example.com/releases ',
    })).toEqual(['https://updates.example.com/releases/'])
  })

  it('ignores an invalid explicit feed URL and uses the default metadata chain', () => {
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_FEED_URL: 'file:///tmp/releases',
    })).toEqual([SELF_UPDATE_METADATA, DIRECT_FEED, DEFAULT_PROXY_FEED])
  })

  it('uses a custom GitHub proxy base for download fallback after GitHub metadata', () => {
    expect(resolveUpdateFeedConfig({
      ECHOFLOW_UPDATE_GITHUB_PROXY_BASE: 'https://proxy.example.com',
    })).toEqual({
      metadataUrl: SELF_UPDATE_METADATA,
      metadataFallbackUrls: [DIRECT_FEED],
      downloadFeedUrls: [`https://proxy.example.com/${DIRECT_FEED}`, DIRECT_FEED],
    })
    expect(resolveUpdateFeedUrls({
      ECHOFLOW_UPDATE_GITHUB_PROXY_BASE: 'https://proxy.example.com',
    })).toEqual([SELF_UPDATE_METADATA, DIRECT_FEED, `https://proxy.example.com/${DIRECT_FEED}`])
  })

  it('defaults metadata to the own-domain mirror with GitHub as fallback', () => {
    expect(resolveUpdateFeedConfig({})).toEqual({
      metadataUrl: SELF_UPDATE_METADATA,
      metadataFallbackUrls: [DIRECT_FEED],
      downloadFeedUrls: [DEFAULT_PROXY_FEED, DIRECT_FEED],
    })
    expect(resolveUpdateFeedUrls({})).toEqual([SELF_UPDATE_METADATA, DIRECT_FEED, DEFAULT_PROXY_FEED])
  })
})
