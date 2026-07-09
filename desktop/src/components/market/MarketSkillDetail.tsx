import { useCallback, useMemo } from 'react'
import { useTranslation } from '../../i18n'
import { useMarketStore } from '../../stores/marketStore'
import { SkillDetailView, type SkillDetailMetaItem } from './SkillDetailView'

function formatCount(value?: number): string {
  if (value === undefined) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatDate(ts?: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString()
  } catch {
    return '—'
  }
}

export function MarketSkillDetail({
  onRequestInstall,
  onRequestUninstall,
}: {
  onRequestInstall: (id: string) => void
  onRequestUninstall: (id: string) => void
}) {
  const t = useTranslation()
  const selectedId = useMarketStore((s) => s.selectedId)
  const detail = useMarketStore((s) => s.detail)
  const isDetailLoading = useMarketStore((s) => s.isDetailLoading)
  const detailError = useMarketStore((s) => s.detailError)
  const installingIds = useMarketStore((s) => s.installingIds)
  const installError = useMarketStore((s) => s.installError)
  const backToList = useMarketStore((s) => s.backToList)
  const refreshDetail = useMarketStore((s) => s.refreshDetail)
  const fetchFileContent = useMarketStore((s) => s.fetchFileContent)

  const loadFile = useCallback(
    (path: string) => {
      if (!selectedId) return Promise.reject(new Error('No skill selected'))
      return fetchFileContent(selectedId, path)
    },
    [selectedId, fetchFileContent],
  )

  const meta = useMemo<SkillDetailMetaItem[]>(() => {
    if (!detail) return []
    const items: SkillDetailMetaItem[] = [
      {
        label: t('market.detail.author'),
        value: detail.author.displayName || detail.author.handle || '—',
      },
      { label: t('market.detail.downloads'), value: formatCount(detail.stats.downloads) },
    ]
    if (detail.stats.installs !== undefined) {
      items.push({ label: t('market.detail.installs'), value: formatCount(detail.stats.installs) })
    }
    if (detail.stats.stars !== undefined) {
      items.push({ label: t('market.detail.stars'), value: formatCount(detail.stats.stars) })
    }
    items.push({ label: t('market.detail.updated'), value: formatDate(detail.updatedAt) })
    if (detail.category) items.push({ label: t('market.detail.category'), value: detail.category })
    if (detail.license) items.push({ label: t('market.detail.license'), value: detail.license })
    if (detail.requiresApiKey) {
      items.push({
        label: t('market.detail.requiresApiKey'),
        value: <span className="material-symbols-outlined text-[16px] text-[var(--color-warning)]">key</span>,
      })
    }
    return items
  }, [detail, t])

  if (!selectedId) return null

  if (isDetailLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20" data-testid="market-detail-loading">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
        <p className="text-sm text-[var(--color-text-tertiary)]">{t('market.loading')}</p>
      </div>
    )
  }

  if (detailError || !detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center" data-testid="market-detail-error">
        <span className="material-symbols-outlined text-[36px] text-[var(--color-error)]">error</span>
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('market.detail.loadError')}</p>
        {detailError && <p className="max-w-md break-words text-xs text-[var(--color-text-tertiary)]">{detailError}</p>}
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshDetail(selectedId)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-focus)]"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            {t('market.retry')}
          </button>
          <button
            type="button"
            onClick={backToList}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-4 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            {t('market.detail.back')}
          </button>
        </div>
      </div>
    )
  }

  const installing = installingIds.has(detail.id)
  const mirrorSource = detail.mirrors?.length
    ? detail.mirrors[0]!.split(':')[0]
    : detail.upstream
      ? detail.upstream.source
      : null

  const actions = (
    <>
      {detail.installState === 'installable' && (
        <button
          type="button"
          data-testid="market-install-button"
          disabled={installing}
          onClick={() => onRequestInstall(detail.id)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--color-brand)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {installing ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
          ) : (
            <span className="material-symbols-outlined text-[18px]" aria-hidden>download</span>
          )}
          {installing ? t('market.install.installing') : t('market.install.action')}
        </button>
      )}
      {detail.installState === 'installed' && (
        <button
          type="button"
          data-testid="market-uninstall-button"
          disabled={installing}
          onClick={() => onRequestUninstall(detail.id)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 text-sm text-[var(--color-error)] transition-colors hover:border-[var(--color-error)]/50 disabled:opacity-50"
        >
          {installing ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
          ) : (
            <span className="material-symbols-outlined text-[18px]" aria-hidden>delete</span>
          )}
          {installing ? t('market.uninstall.uninstalling') : t('market.uninstall.action')}
        </button>
      )}
    </>
  )

  const banner = (
    <>
      {mirrorSource && (
        <p className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">
          {t('market.detail.mirror', { source: t(`market.source.${mirrorSource as 'clawhub' | 'skillhub'}`) })}
        </p>
      )}
      {installError && installError.id === detail.id && (
        <div
          data-testid="market-install-error"
          className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-container)]/40 px-3.5 py-2.5 text-sm text-[var(--color-text-primary)]"
        >
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-error)]" aria-hidden>error</span>
          <span className="break-words">
            {installError.kind === 'generic'
              ? t('market.installError.generic', { message: installError.message })
              : t(`market.installError.${installError.kind}`)}
          </span>
        </div>
      )}
    </>
  )

  return (
    <SkillDetailView
      name={detail.name}
      version={detail.version}
      iconUrl={detail.iconUrl}
      sourceLabel={t(`market.source.${detail.source}`)}
      summary={detail.summary}
      securityStatus={detail.securityStatus}
      securityReports={detail.securityReports}
      installState={detail.installState}
      notInstallableReason={detail.notInstallableReason}
      actions={actions}
      banner={banner}
      meta={meta}
      description={detail.description}
      files={detail.files.map((f) => ({ path: f.path, size: f.size, language: f.language, tooBig: f.tooBig }))}
      loadFile={loadFile}
      onBack={backToList}
      backLabel={t('market.detail.back')}
    />
  )
}
