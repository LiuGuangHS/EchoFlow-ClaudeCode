import { useState, type ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import type {
  InstallState,
  NotInstallableReason,
  SecurityReport,
  SecurityStatus,
} from '../../types/market'
import { InstallStateBadge } from './InstallStateBadge'
import { SecurityBadge } from './SecurityBadge'
import { FilePreview, type PreviewFile, type PreviewFileContent } from './FilePreview'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

export type SkillDetailMetaItem = {
  label: string
  value: ReactNode
}

export type SkillDetailViewProps = {
  name: string
  version?: string
  iconUrl?: string
  sourceLabel: string
  summary?: string
  securityStatus?: SecurityStatus
  securityReports?: SecurityReport[]
  installState?: InstallState
  notInstallableReason?: NotInstallableReason
  /** Action buttons rendered in the decision area (install / uninstall / open). */
  actions?: ReactNode
  /** Optional banner below the header (e.g. install errors). */
  banner?: ReactNode
  meta: SkillDetailMetaItem[]
  description: string
  files: PreviewFile[]
  loadFile: (path: string) => Promise<PreviewFileContent>
  onBack: () => void
  backLabel: string
}

/**
 * Shared, data-source-agnostic skill detail layout. Both the online market
 * detail and the locally-installed skill detail render through this view so
 * the reading experience stays identical.
 */
export function SkillDetailView(props: SkillDetailViewProps) {
  const t = useTranslation()
  const [tab, setTab] = useState<'overview' | 'files'>('overview')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="skill-detail-view">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-6">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          {props.backLabel}
        </button>

        {/* Install decision area */}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              {props.iconUrl ? (
                <img
                  src={props.iconUrl}
                  alt=""
                  className="h-12 w-12 flex-shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container)] object-cover"
                />
              ) : (
                <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]">
                  <span className="material-symbols-outlined text-[24px]">auto_awesome</span>
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-all text-xl font-semibold text-[var(--color-text-primary)]">{props.name}</h2>
                  {props.version && (
                    <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
                      v{props.version}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                    {props.sourceLabel}
                  </span>
                  {props.securityStatus && <SecurityBadge status={props.securityStatus} />}
                  {props.installState && <InstallStateBadge state={props.installState} />}
                </div>
                {props.summary && (
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)] break-words">
                    {props.summary}
                  </p>
                )}
              </div>
            </div>
            {props.actions && <div className="flex flex-shrink-0 items-center gap-2">{props.actions}</div>}
          </div>

          {props.installState === 'not-installable' && props.notInstallableReason && (
            <div
              data-testid="market-not-installable-reason"
              className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error-container)]/40 px-3.5 py-2.5 text-sm text-[var(--color-text-primary)]"
            >
              <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-error)]" aria-hidden>
                block
              </span>
              <span>{t(`market.reason.${props.notInstallableReason}`)}</span>
            </div>
          )}

          {props.securityReports && props.securityReports.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="market-security-reports">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                {t('market.detail.securityReport')}
              </span>
              {props.securityReports.map((report) => (
                <span
                  key={report.vendor}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]"
                >
                  <span className="font-medium text-[var(--color-text-primary)]">{report.vendor}</span>
                  {report.statusText}
                  {report.reportUrl && (
                    <a
                      href={report.reportUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-brand)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('market.detail.viewReport')}
                    </a>
                  )}
                </span>
              ))}
            </div>
          )}

          {props.banner}
        </section>

        {/* Meta grid */}
        {props.meta.length > 0 && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {props.meta.map((item) => (
              <div
                key={item.label}
                className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
              >
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{item.label}</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{item.value}</div>
              </div>
            ))}
          </section>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
          {(['overview', 'files'] as const).map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`skill-detail-tab-${key}`}
              onClick={() => setTab(key)}
              className={`relative -mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3.5 text-sm transition-colors ${
                tab === key
                  ? 'border-[var(--color-brand)] font-medium text-[var(--color-text-primary)]'
                  : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden>
                {key === 'overview' ? 'article' : 'folder'}
              </span>
              {t(`market.detail.${key}`)}
              {key === 'files' && (
                <span className="rounded-full bg-[var(--color-surface-container-high)] px-1.5 text-[10px] text-[var(--color-text-tertiary)]">
                  {props.files.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5" data-testid="skill-detail-overview">
            {props.description.trim() ? (
              <MarkdownRenderer content={props.description} variant="document" className="mx-auto max-w-[72ch]" />
            ) : (
              <p className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">{t('market.detail.noDescription')}</p>
            )}
          </section>
        )}

        {tab === 'files' && <FilePreview files={props.files} loadFile={props.loadFile} />}
      </div>
    </div>
  )
}
