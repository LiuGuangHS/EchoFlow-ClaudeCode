import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  GITHUB_ACCELERATOR_PREFIX,
  buildDownloadCandidates,
  loadDownloadManifest,
  pickPlatformArch,
  resolveDownloadTarget,
  resolveExtraDownloads,
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
  // Vite 的 BASE_URL 是 '/'。和 '/download/manifest.json' 直接拼会得到协议相对地址
  // '//download/manifest.json'，请求打到名叫 download 的主机上，manifest 永远取不到。
  test('joins the Vite base "/" without producing a protocol-relative URL', async () => {
    const calls = []
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
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
      fetchImpl: async (url) => {
        calls.push(url)
        return { ok: true, json: async () => MANIFEST }
      },
    })

    assert.deepEqual(calls, ['/preview/download/manifest.json'])
  })

  test('returns null on a missing manifest instead of throwing', async () => {
    const manifest = await loadDownloadManifest({
      baseUrl: '/',
      fetchImpl: async () => ({ ok: false, status: 404 }),
    })

    assert.equal(manifest, null)
  })
})
