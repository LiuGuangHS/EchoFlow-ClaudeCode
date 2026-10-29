import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  GITHUB_ACCELERATOR_PREFIX,
  buildDownloadCandidates,
  downloadPagePath,
  loadDownloadManifest,
  pickPlatformArch,
  resolveDownloadTarget,
  resolveExtraDownloads,
  resolveInitialPlatform,
  startDirectDownload,
} from './releaseDownload.js'

const MANIFEST = {
  version: '0.7.1',
  tag: 'v0.7.1',
  assets: {
    'win-x64': 'EchoFlow-Code-0.7.1-win-x64.exe',
    'win-arm64': 'EchoFlow-Code-0.7.1-win-arm64.exe',
    'mac-arm64': 'EchoFlow-Code-0.7.1-mac-arm64.dmg',
    'mac-x64': 'EchoFlow-Code-0.7.1-mac-x64.dmg',
    'linux-x86_64': 'EchoFlow-Code-0.7.1-linux-x86_64.AppImage',
    'linux-arm64': 'EchoFlow-Code-0.7.1-linux-arm64.AppImage',
  },
  extras: {
    'linux-x86_64.deb': 'EchoFlow-Code-0.7.1-linux-amd64.deb',
  },
}

const DIRECT_BASE = 'https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/releases/download/v0.7.1/'

describe('pickPlatformArch', () => {
  test('detects Windows x64', () => {
    assert.deepEqual(
      pickPlatformArch('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
      { platform: 'win', arch: 'x64' },
    )
  })

  test('detects Windows on ARM', () => {
    assert.deepEqual(
      pickPlatformArch('Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36'),
      { platform: 'win', arch: 'arm64' },
    )
  })

  test('defaults macOS to arm64 because the UA cannot tell Apple Silicon from Intel', () => {
    assert.deepEqual(
      pickPlatformArch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'),
      { platform: 'mac', arch: 'arm64' },
    )
  })

  test('detects Linux x86_64', () => {
    assert.deepEqual(
      pickPlatformArch('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'),
      { platform: 'linux', arch: 'x86_64' },
    )
  })

  test('falls back to Windows x64 for an unknown UA', () => {
    assert.deepEqual(pickPlatformArch(''), { platform: 'win', arch: 'x64' })
  })
})

describe('downloadPagePath', () => {
  test('carries the landing-page operating system into the download route', () => {
    assert.equal(downloadPagePath('zh', 'Windows'), '/download?platform=win')
    assert.equal(downloadPagePath('en', 'macOS'), '/en/download?platform=mac')
    assert.equal(downloadPagePath('zh', 'Linux'), '/download?platform=linux')
  })

  test('omits the query when the platform is unknown', () => {
    assert.equal(downloadPagePath('zh', 'BeOS'), '/download')
  })
})

describe('resolveInitialPlatform', () => {
  test('prefers a valid platform query over user-agent detection', () => {
    assert.equal(
      resolveInitialPlatform('?platform=win', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
      'win',
    )
  })

  test('accepts the labels used by the landing page', () => {
    assert.equal(resolveInitialPlatform('?platform=macOS', ''), 'mac')
    assert.equal(resolveInitialPlatform('?platform=Windows', ''), 'win')
    assert.equal(resolveInitialPlatform('?platform=Linux', ''), 'linux')
  })

  test('ignores an unknown platform and falls back to the user agent', () => {
    assert.equal(
      resolveInitialPlatform('?platform=beos', 'Mozilla/5.0 (X11; Linux x86_64)'),
      'linux',
    )
  })

  test('falls back to the user agent when the query is malformed', () => {
    assert.equal(resolveInitialPlatform('%', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win')
  })
})

describe('buildDownloadCandidates', () => {
  test('puts the accelerator first and GitHub direct second', () => {
    const candidates = buildDownloadCandidates(MANIFEST, 'win', 'x64')
    assert.equal(candidates.length, 2)
    assert.equal(candidates[0], `${GITHUB_ACCELERATOR_PREFIX}${DIRECT_BASE}EchoFlow-Code-0.7.1-win-x64.exe`)
    assert.equal(candidates[1], `${DIRECT_BASE}EchoFlow-Code-0.7.1-win-x64.exe`)
  })

  test('returns nothing when the platform/arch key is missing', () => {
    assert.deepEqual(buildDownloadCandidates(MANIFEST, 'win', 'ia32'), [])
  })

  test('returns nothing without a tag', () => {
    assert.deepEqual(buildDownloadCandidates({ ...MANIFEST, tag: undefined }, 'win', 'x64'), [])
  })
})

describe('resolveDownloadTarget', () => {
  test('returns the direct URL and file name for a known platform', () => {
    assert.deepEqual(resolveDownloadTarget(MANIFEST, 'mac', 'arm64'), {
      fileName: 'EchoFlow-Code-0.7.1-mac-arm64.dmg',
      url: `${DIRECT_BASE}EchoFlow-Code-0.7.1-mac-arm64.dmg`,
    })
  })

  test('returns null for an unknown platform', () => {
    assert.equal(resolveDownloadTarget(MANIFEST, 'beos', 'x64'), null)
  })
})

describe('resolveExtraDownloads', () => {
  test('lists deb/rpm style extras with direct URLs', () => {
    assert.deepEqual(resolveExtraDownloads(MANIFEST), [{
      fileName: 'EchoFlow-Code-0.7.1-linux-amd64.deb',
      key: 'linux-x86_64.deb',
      url: `${DIRECT_BASE}EchoFlow-Code-0.7.1-linux-amd64.deb`,
    }])
  })

  test('returns an empty list when there are no extras', () => {
    assert.deepEqual(resolveExtraDownloads({ tag: 'v0.7.1' }), [])
  })
})

describe('startDirectDownload', () => {
  test('assigns the first reachable candidate', async () => {
    const assigned = []
    const result = await startDirectDownload(['https://a.test/x', 'https://b.test/x'], {
      fetchImpl: async () => ({ ok: true }),
      locationImpl: { assign: (url) => assigned.push(url) },
    })

    assert.equal(result, 'started')
    assert.deepEqual(assigned, ['https://a.test/x'])
  })

  test('falls through to the second candidate when the first rejects', async () => {
    const assigned = []
    const calls = []
    const result = await startDirectDownload(['https://a.test/x', 'https://b.test/x'], {
      fetchImpl: async (url) => {
        calls.push(url)
        if (url === 'https://a.test/x') throw new TypeError('network error')
        return { ok: true }
      },
      locationImpl: { assign: (url) => assigned.push(url) },
    })

    assert.equal(result, 'started')
    assert.deepEqual(calls, ['https://a.test/x', 'https://b.test/x'])
    assert.deepEqual(assigned, ['https://b.test/x'])
  })

  test('reports fallback when every candidate is unreachable', async () => {
    const assigned = []
    const result = await startDirectDownload(['https://a.test/x'], {
      fetchImpl: async () => { throw new TypeError('network error') },
      locationImpl: { assign: (url) => assigned.push(url) },
    })

    assert.equal(result, 'fallback')
    assert.deepEqual(assigned, [])
  })
})

describe('loadDownloadManifest', () => {
  const PAGES_MANIFEST_URL = 'https://pages.test/EchoFlow-ClaudeCode/download/manifest.json'

  // Vite 的 BASE_URL 是 '/'。和 '/download/manifest.json' 直接拼会得到协议相对地址
  // '//download/manifest.json'，请求打到名叫 download 的主机上，manifest 永远取不到。
  test('joins the Vite base "/" without producing a protocol-relative URL', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        return { ok: true, json: async () => MANIFEST }
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json'])
    assert.equal(manifest, MANIFEST)
  })

  test('joins a sub-path base with one slash', async () => {
    const calls = []
    await loadDownloadManifest({
      baseUrl: '/preview/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        return { ok: true, json: async () => MANIFEST }
      },
    })

    assert.deepEqual(calls, ['/preview/download/manifest.json'])
  })

  test('reads the official Pages copy when the same-origin manifest is missing', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        if (url === PAGES_MANIFEST_URL) return { ok: true, json: async () => MANIFEST }
        return { ok: false, status: 404 }
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
    assert.equal(manifest, MANIFEST)
  })

  test('skips an HTML response from the same origin and reads the Pages copy', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        if (url === PAGES_MANIFEST_URL) return { ok: true, json: async () => MANIFEST }
        return {
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
          json: async () => { throw new SyntaxError('Unexpected token <') },
        }
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
    assert.equal(manifest, MANIFEST)
  })

  test('falls back when a JSON response cannot be parsed', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        if (url === PAGES_MANIFEST_URL) return { ok: true, json: async () => MANIFEST }
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => { throw new SyntaxError('Unexpected end of JSON input') },
        }
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
    assert.equal(manifest, MANIFEST)
  })

  test('rejects an invalid manifest shape and reads the Pages copy', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        if (url === PAGES_MANIFEST_URL) return { ok: true, json: async () => MANIFEST }
        return { ok: true, json: async () => ({ version: '0.7.1', assets: {} }) }
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
    assert.equal(manifest, MANIFEST)
  })

  test('reads the Pages copy when the same-origin request fails', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        if (url === PAGES_MANIFEST_URL) return { ok: true, json: async () => MANIFEST }
        throw new TypeError('network error')
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
    assert.equal(manifest, MANIFEST)
  })

  test('rejects a manifest whose release tag or asset name is not a path segment', async () => {
    for (const invalid of [
      { ...MANIFEST, tag: '../other-release' },
      { ...MANIFEST, assets: { ...MANIFEST.assets, 'win-x64': '../EchoFlow-Code.exe' } },
    ]) {
      const calls = []
      const manifest = await loadDownloadManifest({
        baseUrl: '/',
        fallbackManifestUrl: PAGES_MANIFEST_URL,
        fetchImpl: async (url) => {
          calls.push(url)
          if (url === PAGES_MANIFEST_URL) return { ok: true, json: async () => MANIFEST }
          return { ok: true, json: async () => invalid }
        },
      })

      assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
      assert.equal(manifest, MANIFEST)
    }
  })

  test('returns null only after both sources fail', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fallbackManifestUrl: PAGES_MANIFEST_URL,
      fetchImpl: async (url) => {
        calls.push(url)
        return { ok: false, status: 404 }
      },
    })

    assert.deepEqual(calls, ['/download/manifest.json', PAGES_MANIFEST_URL])
    assert.equal(manifest, null)
  })
})
