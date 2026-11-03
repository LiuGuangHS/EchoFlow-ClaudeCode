import { describe, expect, it } from 'vitest'
import {
  dedupeUpdateFeedUrls,
  isVerifiedDifferentialDownloadFeed,
  normalizeUpdateFeedBaseUrl,
  resolveDifferentialDownloadRequest,
  resolveDownloadFeedUrls,
  resolveUpdateFeedConfig,
  resolveUpdateFeedUrls,
} from './updateFeed'

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

  it('only verifies the canonical direct GitHub feed for differential downloads', () => {
    const config = resolveUpdateFeedConfig({})

    expect(config.differentialDownloadFeedUrls).toEqual([DIRECT_FEED])
    expect(isVerifiedDifferentialDownloadFeed(DIRECT_FEED, config)).toBe(true)
    expect(isVerifiedDifferentialDownloadFeed(`${DIRECT_FEED}?mirror=1`, config)).toBe(false)
    expect(isVerifiedDifferentialDownloadFeed(DEFAULT_PROXY_FEED, config)).toBe(false)
    expect(isVerifiedDifferentialDownloadFeed('https://updates.example.com/releases/', config)).toBe(false)
  })

  it('resolves fail-closed differential download requests', () => {
    const config = resolveUpdateFeedConfig({})

    expect(resolveDifferentialDownloadRequest({}, config)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '1' }, config)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '0' }, config)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_DISABLE_DIFFERENTIAL_DOWNLOAD: '1', ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '1' }, config)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: 'true' }, config)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: 'yes' }, config)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '1' }, config, 'linux')).toBe(false)
  })

  it('requires an exact verified feed when resolving a differential request', () => {
    const config = resolveUpdateFeedConfig({})

    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '1' }, config, 'win32', DIRECT_FEED)).toBe(true)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '1' }, config, 'darwin', DEFAULT_PROXY_FEED)).toBe(false)
    expect(resolveDifferentialDownloadRequest({ ECHOFLOW_ENABLE_DIFFERENTIAL_DOWNLOAD: '1' }, config, 'darwin', 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/latest/download/?x=1')).toBe(false)
  })

  it('limits download feeds to verified sources when differential download is requested', () => {
    const config = resolveUpdateFeedConfig({})

    expect(resolveDownloadFeedUrls(config, true)).toEqual([DIRECT_FEED])
    expect(resolveDownloadFeedUrls(config, false)).toEqual([DEFAULT_PROXY_FEED, DIRECT_FEED])
  })

  it('uses an explicit update feed URL as a single source without fallbacks', () => {
    expect(resolveUpdateFeedConfig({
      ECHOFLOW_UPDATE_FEED_URL: ' https://updates.example.com/releases ',
    })).toEqual({
      metadataUrl: 'https://updates.example.com/releases/',
      metadataFallbackUrls: [],
      downloadFeedUrls: ['https://updates.example.com/releases/'],
      differentialDownloadFeedUrls: [],
      differentialDownloadContracts: {},
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
      differentialDownloadFeedUrls: [DIRECT_FEED],
      differentialDownloadContracts: { [DIRECT_FEED]: { version: 'range-v1', fingerprint: '06c65fc3422243ebb7f83089cc304009c4cfcb43407c4877e2c07f2521b5b379' } },
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
      differentialDownloadFeedUrls: [DIRECT_FEED],
      differentialDownloadContracts: { [DIRECT_FEED]: { version: 'range-v1', fingerprint: '06c65fc3422243ebb7f83089cc304009c4cfcb43407c4877e2c07f2521b5b379' } },
    })
    expect(resolveUpdateFeedUrls({})).toEqual([SELF_UPDATE_METADATA, DIRECT_FEED, DEFAULT_PROXY_FEED])
  })
})
