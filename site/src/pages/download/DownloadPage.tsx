import { useEffect, useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'

import SiteHeader from '../../components/SiteHeader'
import { setPageMeta } from '../../lib/meta'
import {
  GITHUB_RELEASES_URL,
  buildDownloadCandidates,
  loadDownloadManifest,
  pickPlatformArch,
  platformLabel,
  resolveExtraDownloads,
  startDirectDownload,
} from '../../lib/releaseDownload'
import './download.css'

type Locale = 'zh' | 'en'
type Platform = 'mac' | 'win' | 'linux'
type Arch = 'arm64' | 'x64' | 'x86_64'

const PLATFORMS: Array<{ id: Platform; arch: Arch }> = [
  { id: 'mac', arch: 'arm64' },
  { id: 'win', arch: 'x64' },
  { id: 'linux', arch: 'x86_64' },
]

const ARCHES: Record<Platform, Arch[]> = {
  mac: ['arm64', 'x64'],
  win: ['x64', 'arm64'],
  linux: ['x86_64', 'arm64'],
}

const ARCH_LABEL: Record<Arch, string> = {
  arm64: 'ARM64',
  x64: 'x64',
  x86_64: 'x86_64',
}

const copy = {
  zh: {
    title: '下载 EchoFlow Code',
    lede: '选好系统和架构，直接下载安装包。国内网络会自动走加速线路，不通时回落到 GitHub。',
    platform: '你的系统',
    arch: '架构',
    download: '下载安装包',
    downloading: '正在准备下载…',
    version: '最新版本',
    otherFormats: '其他格式',
    fallback: '下载没有开始？前往 GitHub Releases 手动选择。',
    updating: '已经装过？打开应用里的「设置 → 关于 → 检查更新」。',
    archHint: '不确定架构？Apple Silicon 选 ARM64，Intel 机器选 x64。',
  },
  en: {
    title: 'Download EchoFlow Code',
    lede: 'Pick your system and architecture, then download the installer directly. Networks in mainland China try an accelerated mirror first and fall back to GitHub.',
    platform: 'Your system',
    arch: 'Architecture',
    download: 'Download installer',
    downloading: 'Preparing download…',
    version: 'Latest version',
    otherFormats: 'Other formats',
    fallback: 'Download did not start? Pick the file manually on GitHub Releases.',
    updating: 'Already installed? Use Settings → About → Check for updates in the app.',
    archHint: 'Not sure which architecture? Pick ARM64 for Apple Silicon, x64 for Intel machines.',
  },
} as const

function initialSelection(): { platform: Platform; arch: Arch } {
  const detected = pickPlatformArch(typeof navigator === 'undefined' ? '' : navigator.userAgent)
  return { platform: detected.platform as Platform, arch: detected.arch as Arch }
}

export default function DownloadPage({ locale = 'en' }: { locale?: Locale }) {
  const en = locale === 'en'
  const c = copy[locale]
  const [manifest, setManifest] = useState<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [selection, setSelection] = useState(initialSelection)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPageMeta({
      alternate: en ? '/download' : '/en/download',
      canonical: en ? '/en/download' : '/download',
      description: en
        ? 'Download EchoFlow Code for macOS, Windows and Linux.'
        : '下载 EchoFlow Code 的 macOS、Windows 与 Linux 安装包。',
      lang: en ? 'en' : 'zh-CN',
      title: en ? 'Download · EchoFlow Code' : '下载 · EchoFlow Code',
    })
  }, [en])

  useEffect(() => {
    let cancelled = false
    loadDownloadManifest({ baseUrl: import.meta.env.BASE_URL })
      .then((result: any) => {
        if (cancelled) return
        setManifest(result)
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const candidates = manifest ? buildDownloadCandidates(manifest, selection.platform, selection.arch) : []
  const extras = manifest ? resolveExtraDownloads(manifest) : []
  const hasTarget = candidates.length > 0

  async function handleDownload() {
    if (busy) return
    setBusy(true)
    try {
      const result = await startDirectDownload(candidates)
      if (result === 'fallback') window.location.assign(GITHUB_RELEASES_URL)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SiteHeader locale={locale} localeHref={en ? '/download' : '/en/download'} />
      <main className="dl-page">
        <div className="dl-page__inner">
          <header className="dl-page__head">
            <h1>{c.title}</h1>
            <p>{c.lede}</p>
            {manifest?.version ? (
              <span className="dl-version">{c.version} · v{manifest.version}</span>
            ) : null}
          </header>

          {loaded && !manifest ? (
            <div className="dl-empty">
              <p>{c.fallback}</p>
              <a className="btn btn--primary" href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
                {en ? 'Open GitHub Releases' : '前往 GitHub Releases'}
                <ExternalLink size={15} />
              </a>
            </div>
          ) : (
            <section className="dl-picker" aria-label={c.platform}>
              <div className="dl-field">
                <span className="dl-field__label">{c.platform}</span>
                <div className="dl-segmented" role="group">
                  {PLATFORMS.map(({ id }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selection.platform === id}
                      onClick={() => setSelection({ platform: id, arch: ARCHES[id][0] })}
                    >
                      {platformLabel(id)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dl-field">
                <span className="dl-field__label">{c.arch}</span>
                <div className="dl-segmented" role="group">
                  {ARCHES[selection.platform].map((arch) => (
                    <button
                      key={arch}
                      type="button"
                      aria-pressed={selection.arch === arch}
                      onClick={() => setSelection({ platform: selection.platform, arch })}
                    >
                      {ARCH_LABEL[arch]}
                    </button>
                  ))}
                </div>
                <p className="dl-field__hint">{c.archHint}</p>
              </div>

              <button
                type="button"
                className="dl-action"
                onClick={handleDownload}
                disabled={busy || !hasTarget}
                aria-busy={busy}
              >
                <Download size={18} />
                {busy ? c.downloading : c.download}
              </button>

              {!hasTarget ? (
                <p className="dl-field__hint">
                  <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">{c.fallback}</a>
                </p>
              ) : null}

              {extras.length > 0 ? (
                <div className="dl-extras">
                  <span className="dl-field__label">{c.otherFormats}</span>
                  <ul>
                    {extras.map((extra: any) => (
                      <li key={extra.key}>
                        <a href={extra.url} target="_blank" rel="noreferrer">{extra.fileName}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          )}

          <p className="dl-page__foot">{c.updating}</p>
        </div>
      </main>
    </>
  )
}
