import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  FileText,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { SkillList } from '../components/skills/SkillList'
import { useTranslation } from '../i18n'
import { useSkillMarketStore } from '../stores/skillMarketStore'
import type {
  SkillMarketDetail,
  SkillMarketInstallEligibility,
  SkillMarketItem,
  SkillMarketListSource,
  SkillMarketSort,
  SkillMarketTrustState,
} from '../types/skillMarket'

type SkillCenterTab = 'marketplace' | 'mine'

const SOURCE_OPTIONS: SkillMarketListSource[] = ['auto', 'clawhub', 'skillhub']
const SORT_OPTIONS: SkillMarketSort[] = ['downloads', 'installs', 'stars', 'updated', 'trending']
const TRUST_SAFE: SkillMarketTrustState[] = ['clean', 'benign', 'signed', 'official']

export function SkillCenter() {
  const t = useTranslation()
  const [activeTab, setActiveTab] = useState<SkillCenterTab>('marketplace')
  const {
    items,
    selectedDetail,
    source,
    sort,
    query,
    isLoading,
    isDetailLoading,
    isInstalling,
    error,
    setSource,
    setSort,
    setQuery,
    fetchItems,
    fetchDetail,
    installSelected,
    clearDetail,
  } = useSkillMarketStore()

  useEffect(() => {
    void fetchItems()
  }, [fetchItems, source, sort])

  const installedCount = useMemo(
    () => items.filter((item) => item.installed).length,
    [items],
  )

  const handleSearch = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    void fetchItems()
  }

  const handleClearSearch = () => {
    setQuery('')
    void fetchItems()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      <header className="flex flex-none flex-col gap-4 border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-normal text-[var(--color-text-primary)]">
            {t('skillCenter.title')}
          </h2>
          {activeTab === 'marketplace' ? (
            <button
              type="button"
              onClick={() => void fetchItems()}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
              {t('skillCenter.marketplace.refresh')}
            </button>
          ) : null}
        </div>
        <div
          role="tablist"
          aria-label={t('skillCenter.title')}
          className="inline-flex w-fit rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'marketplace'}
            className={tabClass(activeTab === 'marketplace')}
            onClick={() => setActiveTab('marketplace')}
          >
            {t('skillCenter.tab.marketplace')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mine'}
            className={tabClass(activeTab === 'mine')}
            onClick={() => setActiveTab('mine')}
          >
            {t('skillCenter.tab.mine')}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'marketplace' ? (
          <section
            role="tabpanel"
            data-testid="skill-marketplace-tab"
            className="flex min-h-full min-w-0 flex-col gap-4"
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_160px_160px_auto] lg:items-end">
              <form onSubmit={handleSearch} className="min-w-0">
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="skill-market-search">
                  {t('skillCenter.marketplace.searchLabel')}
                </label>
                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                    aria-hidden="true"
                  />
                  <input
                    id="skill-market-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('skillCenter.marketplace.searchPlaceholder')}
                    className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-20 text-sm text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label={t('skillCenter.marketplace.clearSearch')}
                      onClick={handleClearSearch}
                      className="absolute right-11 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    aria-label={t('skillCenter.marketplace.runSearch')}
                    className="absolute right-1.5 top-1/2 flex h-7 w-8 -translate-y-1/2 items-center justify-center rounded-md bg-[var(--color-brand)] text-white transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                  >
                    <Search size={14} aria-hidden="true" />
                  </button>
                </div>
              </form>

              <SelectField
                label={t('skillCenter.marketplace.sourceLabel')}
                value={source}
                onChange={(value) => setSource(value as SkillMarketListSource)}
                options={SOURCE_OPTIONS.map((value) => ({
                  value,
                  label: t(`skillCenter.marketplace.source.${value}`),
                }))}
              />
              <SelectField
                label={t('skillCenter.marketplace.sortLabel')}
                value={sort}
                onChange={(value) => setSort(value as SkillMarketSort)}
                options={SORT_OPTIONS.map((value) => ({
                  value,
                  label: t(`skillCenter.marketplace.sort.${value}`),
                }))}
              />

              <div className="grid grid-cols-2 gap-2 lg:w-[168px]">
                <Metric label={t('skillCenter.marketplace.total')} value={String(items.length)} />
                <Metric label={t('skillCenter.marketplace.installed')} value={String(installedCount)} />
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-error)]">
                {error}
              </div>
            ) : null}

            <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0">
                {isLoading ? (
                  <LoadingState label={t('skillCenter.marketplace.loading')} />
                ) : items.length === 0 ? (
                  <EmptyState label={t('skillCenter.marketplace.empty')} />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {items.map((item) => (
                      <SkillMarketCard
                        key={`${item.source}-${item.slug}`}
                        item={item}
                        active={selectedDetail?.source === item.source && selectedDetail.slug === item.slug}
                        onSelect={() => void fetchDetail(item.source, item.slug)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <SkillMarketDetailPanel
                detail={selectedDetail}
                loading={isDetailLoading}
                installing={isInstalling}
                onInstall={() => void installSelected()}
                onClose={clearDetail}
              />
            </div>
          </section>
        ) : (
          <div role="tabpanel" data-testid="skill-mine-tab">
            <SkillList />
          </div>
        )}
      </main>
    </div>
  )
}

function SkillMarketCard({
  item,
  active,
  onSelect,
}: {
  item: SkillMarketItem
  active: boolean
  onSelect: () => void
}) {
  const t = useTranslation()
  const stats = formatStats(item, t)

  return (
    <button
      type="button"
      aria-label={item.displayName}
      onClick={onSelect}
      className={[
        'group flex min-h-[168px] flex-col justify-between rounded-lg border bg-[var(--color-surface)] p-4 text-left transition-colors',
        'hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
        active ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-selected)]' : 'border-[var(--color-border)]',
      ].join(' ')}
    >
      <div className="min-w-0">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {item.displayName}
          </h3>
          <TrustBadge state={item.trustState} />
        </div>
        <p className="line-clamp-3 text-sm leading-5 text-[var(--color-text-secondary)]">
          {item.summaryZh || item.summary}
        </p>
      </div>

      <div className="mt-4 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0 text-xs text-[var(--color-text-tertiary)]">
          <div className="truncate">
            {item.owner ? `@${item.owner}` : t(`skillCenter.marketplace.source.${item.source}`)}
          </div>
          {item.license ? <div className="truncate">{item.license}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          {item.installed ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-success-container)] px-1.5 py-1 text-[var(--color-success)]">
              <Check size={12} aria-hidden="true" />
              {t('skillCenter.marketplace.installedBadge')}
            </span>
          ) : null}
          {stats ? <span className="truncate">{stats}</span> : null}
        </div>
      </div>
    </button>
  )
}

function SkillMarketDetailPanel({
  detail,
  loading,
  installing,
  onInstall,
  onClose,
}: {
  detail: SkillMarketDetail | null
  loading: boolean
  installing: boolean
  onInstall: () => void
  onClose: () => void
}) {
  const t = useTranslation()

  if (loading && !detail) {
    return (
      <aside className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <LoadingState label={t('skillCenter.marketplace.detailLoading')} />
      </aside>
    )
  }

  if (!detail) {
    return (
      <aside className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6 text-center text-sm text-[var(--color-text-tertiary)]">
        {t('skillCenter.marketplace.noSelection')}
      </aside>
    )
  }

  const eligibility = detail.installEligibility
  const installable = eligibility.status === 'installable'

  return (
    <aside className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            {detail.displayName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <span>{t(`skillCenter.marketplace.source.${detail.source}`)}</span>
            {detail.owner ? <span>@{detail.owner}</span> : null}
            {detail.version ? <span>{detail.version}</span> : null}
          </div>
        </div>
        <button
          type="button"
          aria-label={t('skillCenter.marketplace.closeDetail')}
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
          {detail.summaryZh || detail.summary}
        </p>

        <div className="flex flex-wrap gap-2">
          <TrustBadge state={detail.trustState} />
          <EligibilityBadge eligibility={eligibility} />
          {detail.requiresApiKey ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
              <Lock size={12} aria-hidden="true" />
              {t('skillCenter.marketplace.requiresApiKey')}
            </span>
          ) : null}
        </div>

        {detail.trustSummary ? (
          <div className="rounded-md bg-[var(--color-surface-container-low)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            {detail.trustSummary}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <MetaItem label={t('skillCenter.marketplace.license')} value={detail.license || '-'} />
          <MetaItem label={t('skillCenter.marketplace.files')} value={String(detail.files.length)} />
          <MetaItem label={t('skillCenter.marketplace.downloads')} value={formatNumber(detail.downloads)} />
          <MetaItem label={t('skillCenter.marketplace.stars')} value={formatNumber(detail.stars)} />
        </dl>

        {detail.riskLabels.length > 0 ? (
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
              {t('skillCenter.marketplace.riskLabels')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detail.riskLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-md bg-[var(--color-warning-container)] px-2 py-1 text-xs text-[var(--color-warning)]"
                >
                  {t(`skillCenter.marketplace.risk.${label}`)}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {detail.entryPreview ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
              <FileText size={13} aria-hidden="true" />
              {t('skillCenter.marketplace.entryPreview')}
            </div>
            <pre className="max-h-40 overflow-auto rounded-md bg-[var(--color-surface-container-low)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
              {detail.entryPreview}
            </pre>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
          <button
            type="button"
            onClick={onInstall}
            disabled={!installable || installing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-container-high)] disabled:text-[var(--color-text-tertiary)]"
          >
            <Download size={15} aria-hidden="true" />
            {installing ? t('skillCenter.marketplace.installing') : installLabel(t, eligibility)}
          </button>
          <div className="flex flex-wrap gap-3 text-xs">
            <a
              href={detail.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[var(--color-brand)] hover:underline"
            >
              {t('skillCenter.marketplace.openSource')}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            {detail.upstreamUrl ? (
              <a
                href={detail.upstreamUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--color-brand)] hover:underline"
              >
                {t('skillCenter.marketplace.openUpstream')}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2">
      <div className="text-[11px] text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}

function TrustBadge({ state }: { state: SkillMarketTrustState }) {
  const t = useTranslation()
  const safe = TRUST_SAFE.includes(state)
  const blocked = state === 'blocked' || state === 'unknown'
  const className = safe
    ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    : blocked
      ? 'bg-[var(--color-error-container)] text-[var(--color-error)]'
      : 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
  const Icon = safe ? ShieldCheck : blocked ? AlertTriangle : AlertTriangle

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${className}`}>
      <Icon size={12} aria-hidden="true" />
      {t(`skillCenter.marketplace.trust.${state}`)}
    </span>
  )
}

function EligibilityBadge({ eligibility }: { eligibility: SkillMarketInstallEligibility }) {
  const t = useTranslation()
  const status = eligibility.status
  const className = status === 'installable'
    ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    : status === 'installed'
      ? 'bg-[var(--color-info-container)] text-[var(--color-info)]'
      : 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${className}`}>
      {status === 'installable' ? <Download size={12} aria-hidden="true" /> : <Lock size={12} aria-hidden="true" />}
      {installLabel(t, eligibility)}
    </span>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--color-surface-container-low)] px-3 py-2">
      <dt className="text-[11px] text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="mt-0.5 truncate text-[var(--color-text-primary)]">{value}</dd>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
      {label}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6 text-sm text-[var(--color-text-tertiary)]">
      {label}
    </div>
  )
}

function tabClass(active: boolean) {
  return [
    'min-w-[6rem] rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
    active
      ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
  ].join(' ')
}

function formatStats(item: SkillMarketItem, t: ReturnType<typeof useTranslation>): string {
  if (typeof item.downloads === 'number') {
    return `${formatNumber(item.downloads)} ${t('skillCenter.marketplace.downloads')}`
  }
  if (typeof item.installs === 'number') {
    return `${formatNumber(item.installs)} ${t('skillCenter.marketplace.sort.installs')}`
  }
  if (typeof item.stars === 'number') {
    return `${formatNumber(item.stars)} ${t('skillCenter.marketplace.stars')}`
  }
  return ''
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat().format(value)
}

function installLabel(
  t: ReturnType<typeof useTranslation>,
  eligibility: SkillMarketInstallEligibility,
): string {
  if (eligibility.status === 'installable') return t('skillCenter.marketplace.install')
  if (eligibility.status === 'installed') return t('skillCenter.marketplace.installedAction')
  if (eligibility.status === 'conflict') return t('skillCenter.marketplace.conflictAction')
  return t('skillCenter.marketplace.blockedAction')
}
