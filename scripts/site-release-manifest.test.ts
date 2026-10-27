import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  generateSiteReleaseManifest,
  type SiteReleaseApi,
  type SiteReleaseAsset,
  type SiteReleaseInfo,
} from './site-release-manifest'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'echoflow-code-site-release-'))
}

// 与 release-desktop.yml 的「Validate complete release asset set」同构：
// deb/rpm 的架构记号（amd64/aarch64）和 AppImage（x86_64/arm64）不一致，
// 所以文件名只能来自资产清单，不能从 artifactName 模板推导。
const RELEASE_FIXTURE: SiteReleaseInfo = {
  tagName: 'v0.7.2',
  assets: [
    'EchoFlow-Code-0.7.2-mac-arm64.dmg',
    'EchoFlow-Code-0.7.2-mac-arm64.dmg.blockmap',
    'EchoFlow-Code-0.7.2-mac-arm64.zip',
    'EchoFlow-Code-0.7.2-mac-arm64.zip.blockmap',
    'EchoFlow-Code-0.7.2-mac-x64.dmg',
    'EchoFlow-Code-0.7.2-mac-x64.dmg.blockmap',
    'EchoFlow-Code-0.7.2-mac-x64.zip',
    'EchoFlow-Code-0.7.2-mac-x64.zip.blockmap',
    'EchoFlow-Code-0.7.2-linux-x86_64.AppImage',
    'EchoFlow-Code-0.7.2-linux-amd64.deb',
    'EchoFlow-Code-0.7.2-linux-x86_64.rpm',
    'EchoFlow-Code-0.7.2-linux-arm64.AppImage',
    'EchoFlow-Code-0.7.2-linux-arm64.deb',
    'EchoFlow-Code-0.7.2-linux-aarch64.rpm',
    'EchoFlow-Code-0.7.2-win-x64.exe',
    'EchoFlow-Code-0.7.2-win-x64.exe.blockmap',
    'EchoFlow-Code-0.7.2-win-arm64.exe',
    'EchoFlow-Code-0.7.2-win-arm64.exe.blockmap',
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
    'latest-linux-arm64.yml',
    'install-macos-unsigned.sh',
  ].map((name, index) => ({ name, id: index + 1 })),
}

// 带尾随空格与不规则缩进：镜像必须逐字节，任何 YAML 重新序列化都会把它洗掉。
const CHANNEL_FIXTURES: Record<string, string> = {
  'latest.yml': 'version: 0.7.2\nfiles:\n  - url: EchoFlow-Code-0.7.2-win-x64.exe\n    sha512: win-sha\n    size: 100\npath: EchoFlow-Code-0.7.2-win-x64.exe\nsha512: win-sha\nreleaseDate: \'2026-10-27T02:00:00.000Z\'\n  \n',
  'latest-mac.yml': 'version: 0.7.2\nfiles:\n  - url: EchoFlow-Code-0.7.2-mac-arm64.zip\n    sha512: mac-sha\npath: EchoFlow-Code-0.7.2-mac-arm64.zip\nsha512: mac-sha\n',
  'latest-linux.yml': 'version: 0.7.2\npath: EchoFlow-Code-0.7.2-linux-x86_64.AppImage\nsha512: linux-sha\n',
  'latest-linux-arm64.yml': 'version: 0.7.2\npath: EchoFlow-Code-0.7.2-linux-arm64.AppImage\nsha512: linux-arm-sha\n',
}

function fixtureApi(overrides: Partial<SiteReleaseApi> = {}): SiteReleaseApi & { fetched: string[] } {
  const fetched: string[] = []
  return {
    fetched,
    async fetchRelease(release) {
      fetched.push(release)
      return RELEASE_FIXTURE
    },
    async downloadAsset(asset: SiteReleaseAsset) {
      const content = CHANNEL_FIXTURES[asset.name]
      if (!content) throw new Error(`unexpected asset download in test: ${asset.name}`)
      return new TextEncoder().encode(content)
    },
    ...overrides,
  }
}

function withReleaseAssets(names: string[]): SiteReleaseInfo {
  return { tagName: 'v0.7.2', assets: names.map((name, index) => ({ name, id: index + 1 })) }
}

describe('site release manifest', () => {
  test('mirrors channel files byte-for-byte and writes the download manifest from the release inventory', async () => {
    const outDir = tempDir()
    const api = fixtureApi()

    const result = await generateSiteReleaseManifest({
      release: 'latest',
      outDir,
      repo: 'LiuGuangHS/EchoFlow-ClaudeCode',
      api,
    })

    expect(result.updateFiles).toEqual([
      'latest-linux-arm64.yml',
      'latest-linux.yml',
      'latest-mac.yml',
      'latest.yml',
    ])
    for (const [name, content] of Object.entries(CHANNEL_FIXTURES)) {
      expect(readFileSync(join(outDir, 'update', name), 'utf8')).toBe(content)
    }

    const manifest = JSON.parse(readFileSync(join(outDir, 'download', 'manifest.json'), 'utf8'))
    expect(manifest).toEqual({
      version: '0.7.2',
      tag: 'v0.7.2',
      assets: {
        'win-x64': 'EchoFlow-Code-0.7.2-win-x64.exe',
        'win-arm64': 'EchoFlow-Code-0.7.2-win-arm64.exe',
        'mac-arm64': 'EchoFlow-Code-0.7.2-mac-arm64.dmg',
        'mac-x64': 'EchoFlow-Code-0.7.2-mac-x64.dmg',
        'linux-x86_64': 'EchoFlow-Code-0.7.2-linux-x86_64.AppImage',
        'linux-arm64': 'EchoFlow-Code-0.7.2-linux-arm64.AppImage',
      },
      extras: {
        'deb-x64': 'EchoFlow-Code-0.7.2-linux-amd64.deb',
        'rpm-x64': 'EchoFlow-Code-0.7.2-linux-x86_64.rpm',
        'deb-arm64': 'EchoFlow-Code-0.7.2-linux-arm64.deb',
        'rpm-arm64': 'EchoFlow-Code-0.7.2-linux-aarch64.rpm',
      },
    })
    expect(result.manifestPath).toBe(join(outDir, 'download', 'manifest.json'))
  })

  test('normalizes a bare version into the v-prefixed release tag', async () => {
    const api = fixtureApi()

    await generateSiteReleaseManifest({
      release: '0.7.2',
      outDir: tempDir(),
      repo: 'LiuGuangHS/EchoFlow-ClaudeCode',
      api,
    })

    expect(api.fetched).toEqual(['v0.7.2'])
  })

  test('fails loudly when latest.yml is missing from the release assets', async () => {
    const names = RELEASE_FIXTURE.assets.map(asset => asset.name).filter(name => name !== 'latest.yml')
    const api = fixtureApi({ fetchRelease: async () => withReleaseAssets(names) })

    await expect(generateSiteReleaseManifest({
      release: 'latest',
      outDir: tempDir(),
      repo: 'LiuGuangHS/EchoFlow-ClaudeCode',
      api,
    })).rejects.toThrow(/latest\.yml/)
  })

  test('fails loudly when an installer name carries no recognizable platform-arch mark', async () => {
    const api = fixtureApi({
      fetchRelease: async () => withReleaseAssets([
        ...RELEASE_FIXTURE.assets.map(asset => asset.name),
        'EchoFlow-Code-0.7.2-linux-loong64.AppImage',
      ]),
    })

    await expect(generateSiteReleaseManifest({
      release: 'latest',
      outDir: tempDir(),
      repo: 'LiuGuangHS/EchoFlow-ClaudeCode',
      api,
    })).rejects.toThrow(/linux-loong64/)
  })

  test('fails loudly when a required platform-arch installer is missing', async () => {
    const names = RELEASE_FIXTURE.assets
      .map(asset => asset.name)
      .filter(name => name !== 'EchoFlow-Code-0.7.2-win-arm64.exe')
    const api = fixtureApi({ fetchRelease: async () => withReleaseAssets(names) })

    await expect(generateSiteReleaseManifest({
      release: 'latest',
      outDir: tempDir(),
      repo: 'LiuGuangHS/EchoFlow-ClaudeCode',
      api,
    })).rejects.toThrow(/win-arm64/)
  })

  test('writes identical output when run twice', async () => {
    const outDir = tempDir()
    const options = {
      release: 'latest',
      outDir,
      repo: 'LiuGuangHS/EchoFlow-ClaudeCode',
      api: fixtureApi(),
    }

    const first = await generateSiteReleaseManifest(options)
    const firstManifest = readFileSync(first.manifestPath, 'utf8')
    const second = await generateSiteReleaseManifest(options)

    expect(readFileSync(second.manifestPath, 'utf8')).toBe(firstManifest)
    expect(second.updateFiles).toEqual(first.updateFiles)
    for (const name of first.updateFiles) {
      expect(readFileSync(join(outDir, 'update', name), 'utf8')).toBe(CHANNEL_FIXTURES[name])
    }
  })
})
