#!/usr/bin/env bun

/**
 * 发版同步：把 GitHub 发布资产里的更新元数据镜像进站点产物，再为下载页生成清单。
 *
 * - `<out>/update/latest*.yml` 与源资产字节完全一致。electron-builder 的 Ed25519
 *   签名覆盖 yml 内容，任何重新序列化都会让客户端更新校验失败。
 * - `<out>/download/manifest.json` 的文件名一律取自资产清单：deb/rpm 的架构记号
 *   （amd64/aarch64）与 AppImage（x86_64/arm64）不一致，不能从 artifactName 模板推导。
 *
 * 路径与 site/src/lib/releaseDownload.js 的 DOWNLOAD_MANIFEST_PATH 对应；换路径两处同改。
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type SiteReleaseAsset = {
  name: string
  id: number
}

export type SiteReleaseInfo = {
  tagName: string
  assets: SiteReleaseAsset[]
}

export type SiteReleaseApi = {
  fetchRelease(release: string): Promise<SiteReleaseInfo>
  downloadAsset(asset: SiteReleaseAsset): Promise<Uint8Array>
}

export type GenerateSiteReleaseManifestOptions = {
  release: string
  outDir: string
  repo: string
  githubToken?: string | null
  api?: SiteReleaseApi
}

export type GenerateSiteReleaseManifestResult = {
  manifestPath: string
  updateFiles: string[]
}

type DownloadManifest = {
  version: string
  tag: string
  assets: Record<string, string>
  extras: Record<string, string>
}

// latest.yml 是 Windows 更新通道的硬依赖，缺了就该红；其余平台 yml 尽量镜像，
// 老发布缺哪份就少哪份，客户端会按兜底链回退 GitHub。
const REQUIRED_CHANNEL_FILES = ['latest.yml']
const OPTIONAL_CHANNEL_FILES = ['latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']
const REQUIRED_ASSET_KEYS = ['win-x64', 'win-arm64', 'mac-arm64', 'mac-x64', 'linux-x86_64', 'linux-arm64']

function usage() {
  return 'Usage: bun run scripts/site-release-manifest.ts --release <tag|latest> --out <dir> --repo <owner/repo>'
}

function readArgValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}\n${usage()}`)
  }
  return value
}

function parseArgs(argv: string[]): GenerateSiteReleaseManifestOptions {
  let release: string | undefined
  let outDir: string | undefined
  let repo: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--release') {
      release = readArgValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--out') {
      outDir = readArgValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--repo') {
      repo = readArgValue(argv, index, arg)
      index += 1
      continue
    }
  }

  if (!release || !outDir || !repo) {
    throw new Error(usage())
  }

  return { release, outDir, repo }
}

/** 发版流水线传的是 package.json 的裸版本号，GitHub 的 tag 带 v 前缀。 */
function normalizeReleaseRef(release: string): string {
  const trimmed = release.trim()
  if (trimmed === 'latest' || trimmed.startsWith('v') || !/^\d/.test(trimmed)) return trimmed
  return `v${trimmed}`
}

function normalizeArch(arch: string): string {
  return arch === 'amd64' || arch === 'x86_64' ? 'x64' : 'arm64'
}

function installerKey(name: string): { key: string, kind: 'main' | 'extra' } | null {
  const win = name.match(/-win-(x64|arm64)\.exe$/)
  if (win) return { key: `win-${win[1]}`, kind: 'main' }
  const mac = name.match(/-mac-(arm64|x64)\.dmg$/)
  if (mac) return { key: `mac-${mac[1]}`, kind: 'main' }
  const linux = name.match(/-linux-(x86_64|arm64)\.AppImage$/)
  if (linux) return { key: `linux-${linux[1]}`, kind: 'main' }
  const package_ = name.match(/-linux-(amd64|x86_64|arm64|aarch64)\.(deb|rpm)$/)
  if (package_) return { key: `${package_[2]}-${normalizeArch(package_[1])}`, kind: 'extra' }
  return null
}

function isInstallerName(name: string): boolean {
  return /\.(?:exe|dmg|AppImage|deb|rpm)$/.test(name)
}

function buildDownloadManifest(release: SiteReleaseInfo): DownloadManifest {
  const assets: Record<string, string> = {}
  const extras: Record<string, string> = {}

  for (const asset of release.assets) {
    if (!isInstallerName(asset.name)) continue
    const mapped = installerKey(asset.name)
    if (!mapped) {
      // 宁可红也不静默漏：新平台/新架构的安装包必须先补映射再发版。
      throw new Error(`Unrecognized installer asset name: ${asset.name}`)
    }
    const target = mapped.kind === 'main' ? assets : extras
    if (target[mapped.key]) {
      throw new Error(`Duplicate installer for ${mapped.key}: ${target[mapped.key]} and ${asset.name}`)
    }
    target[mapped.key] = asset.name
  }

  for (const key of REQUIRED_ASSET_KEYS) {
    if (!assets[key]) {
      throw new Error(`Release assets are missing a required installer for ${key}`)
    }
  }

  return {
    version: release.tagName.replace(/^v/, ''),
    tag: release.tagName,
    assets: Object.fromEntries(REQUIRED_ASSET_KEYS.map(key => [key, assets[key]])),
    extras: Object.fromEntries(Object.entries(extras).sort(([left], [right]) => left.localeCompare(right))),
  }
}

function createGhApi(repo: string, token: string | null): SiteReleaseApi {
  return {
    async fetchRelease(release) {
      const ref = release === 'latest' ? 'releases/latest' : `releases/tags/${release}`
      const payload = runGh(['api', `repos/${repo}/${ref}`], token)
      const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
        tag_name: string
        assets: Array<{ name: string, id: number }>
      }
      return {
        tagName: parsed.tag_name,
        assets: parsed.assets.map(asset => ({ name: asset.name, id: asset.id })),
      }
    },
    async downloadAsset(asset) {
      return runGh(['api', `repos/${repo}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], token)
    },
  }
}

function runGh(args: string[], token: string | null): Uint8Array {
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required to read release assets from the GitHub API')
  }
  const proc = spawnSync('gh', args, {
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (proc.status !== 0) {
    throw new Error(`gh ${args[0]} failed (${proc.status}): ${proc.stderr?.toString() ?? ''}`)
  }
  return proc.stdout
}

export async function generateSiteReleaseManifest(
  options: GenerateSiteReleaseManifestOptions,
): Promise<GenerateSiteReleaseManifestResult> {
  const token = options.githubToken ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null
  const api = options.api ?? createGhApi(options.repo, token)
  const release = await api.fetchRelease(normalizeReleaseRef(options.release))

  const channelFiles = [...REQUIRED_CHANNEL_FILES, ...OPTIONAL_CHANNEL_FILES]
  const channelAssets = new Map(
    release.assets.filter(asset => channelFiles.includes(asset.name)).map(asset => [asset.name, asset]),
  )
  for (const required of REQUIRED_CHANNEL_FILES) {
    if (!channelAssets.has(required)) {
      throw new Error(`Release assets are missing ${required}`)
    }
  }

  const manifest = buildDownloadManifest(release)

  mkdirSync(join(options.outDir, 'update'), { recursive: true })
  mkdirSync(join(options.outDir, 'download'), { recursive: true })

  const updateFiles: string[] = []
  for (const name of [...channelAssets.keys()].sort()) {
    const bytes = await api.downloadAsset(channelAssets.get(name)!)
    writeFileSync(join(options.outDir, 'update', name), bytes)
    updateFiles.push(name)
  }

  const manifestPath = join(options.outDir, 'download', 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return { manifestPath, updateFiles }
}

if (import.meta.main) {
  try {
    const result = await generateSiteReleaseManifest(parseArgs(process.argv.slice(2)))
    for (const file of result.updateFiles) {
      console.log(`[site-release-manifest] wrote update/${file}`)
    }
    console.log(`[site-release-manifest] wrote ${result.manifestPath}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}
