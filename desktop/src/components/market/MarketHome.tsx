import { useEffect } from 'react'
import { useTranslation } from '../../i18n'
import { useMarketStore } from '../../stores/marketStore'
import { FilterBar } from './FilterBar'
import { MarketDisclaimer } from './MarketDisclaimer'
import { SkillCard } from './SkillCard'
import { SourceStatusBar } from './SourceStatusBar'

export function MarketHome({ onRequestInstall }: { onRequestInstall: (id: string) => void }) {
  const t = useTranslation()
  const {
    items,
    nextCursor,
    sources,
    query,
    filters,
    isLoading,
    isLoadingMore,
    error,
    fetchList,
    loadMore,
    setQuery,
    installingIds,
  } = useMarketStore()

  useEffect(() => {
    if (items.length === 0 && !isLoading && !error) {
      void fetchList({ reset: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasActiveFilters =
    filters.source !== 'all' || filters.security !== 'all' || filters.installed !== 'all'
  const hasQuery = query.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
        <MarketDisclaimer />
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">storefront</span>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('market.title')}</h2>
              </div>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{t('market.subtitle')}</p>
            </div>
            <SourceStatusBar sources={sources} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex min-h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 transition-colors focus-within:border-[var(--color-border-focus)] focus-within:ring-2 focus-within:ring-[var(--color-brand)]/20">
              <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">search</span>
              <input
                data-testid="market-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('market.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              />
              {query && (
                <button
                  type="button"
                  aria-label={t('market.clearSearch')}
                  onClick={() => setQuery('')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
            <FilterBar />
          </div>

          {!isLoading && items.length > 0 && (
            <p className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">
              {t('market.resultCount', { count: String(items.length) })}
            </p>
          )}
        </section>

        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-16" data-testid="market-loading">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
            <p className="text-sm text-[var(--color-text-tertiary)]">{t('market.loading')}</p>
          </div>
        )}

        {!isLoading && error && (
          <div
            data-testid="market-error"
            className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--color-error)]/40 bg-[var(--color-error-container)]/30 px-6 py-12 text-center"
          >
            <span className="material-symbols-outlined text-[36px] text-[var(--color-error)]">cloud_off</span>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('market.error.list')}</p>
            <p className="max-w-md break-words text-xs text-[var(--color-text-tertiary)]">{error}</p>
            <button
              type="button"
              onClick={() => void fetchList({ reset: true })}
              className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-focus)]"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              {t('market.retry')}
            </button>
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div
            data-testid="market-empty"
            className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6 py-16 text-center"
          >
            <span className="material-symbols-outlined mb-2 block text-[40px] text-[var(--color-text-tertiary)]">
              {hasQuery || hasActiveFilters ? 'search_off' : 'storefront'}
            </span>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {hasQuery || hasActiveFilters ? t('market.emptySearch') : t('market.empty')}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {hasQuery || hasActiveFilters ? t('market.emptySearchHint') : t('market.emptyHint')}
            </p>
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="market-grid">
              {items.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onOpen={(id) => void useMarketStore.getState().openDetail(id)}
                  onInstall={onRequestInstall}
                  installing={installingIds.has(skill.id)}
                />
              ))}
            </div>

            {nextCursor && (
              <div className="flex justify-center pb-4">
                <button
                  type="button"
                  data-testid="market-load-more"
                  disabled={isLoadingMore}
                  onClick={() => void loadMore()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-focus)] disabled:opacity-60"
                >
                  {isLoadingMore && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
                  )}
                  {isLoadingMore ? t('market.loadingMore') : t('market.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
