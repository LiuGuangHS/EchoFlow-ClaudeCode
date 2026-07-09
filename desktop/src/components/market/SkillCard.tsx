import { useTranslation } from '../../i18n'
import type { NormalizedSkill } from '../../types/market'
import { InstallStateBadge } from './InstallStateBadge'
import { SecurityBadge } from './SecurityBadge'
import { SkillAvatar } from './SkillAvatar'

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

const MAX_VISIBLE_TAGS = 3

export function SkillCard({
  skill,
  onOpen,
  onInstall,
  installing,
}: {
  skill: NormalizedSkill
  onOpen: (id: string) => void
  onInstall?: (id: string) => void
  installing?: boolean
}) {
  const t = useTranslation()
  const extraTags = Math.max(0, skill.tags.length - MAX_VISIBLE_TAGS)
  const showInstallButton = Boolean(onInstall) && skill.installState === 'installable'

  return (
    <div
      data-testid={`market-skill-card-${skill.id}`}
      className="group relative flex min-w-0 cursor-pointer flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border-focus)] hover:shadow-[var(--shadow-dropdown)]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '196px' }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(skill.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(skill.id)
        }
      }}
    >
      <div className="flex items-start gap-3">
        <SkillAvatar skill={skill} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{skill.name}</span>
            {skill.version && (
              <span className="flex-shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                v{skill.version}
              </span>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            <span className="flex-shrink-0 rounded-md bg-[var(--color-surface-container)] px-1.5 py-px font-medium text-[var(--color-text-secondary)]">
              {t(`market.source.${skill.source}`)}
            </span>
            {skill.author.handle && (
              <span className="truncate">{t('market.card.by', { author: skill.author.displayName || skill.author.handle })}</span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-[var(--color-text-secondary)] break-words">
        {skill.summary || t('market.detail.noDescription')}
      </p>

      {skill.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {skill.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
            >
              {tag}
            </span>
          ))}
          {extraTags > 0 && (
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              {t('market.card.moreTags', { count: String(extraTags) })}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-[var(--color-border)]/60 pt-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <SecurityBadge status={skill.securityStatus} />
          {/* The quick-install button already communicates "installable" — skip the badge when the button renders. */}
          {!(skill.installState === 'installable' && showInstallButton) && (
            <InstallStateBadge state={skill.installState} />
          )}
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2 text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
          <span className="inline-flex items-center gap-0.5" title={t('market.detail.downloads')}>
            <span className="material-symbols-outlined text-[13px]" aria-hidden>download</span>
            {formatCount(skill.stats.downloads)}
          </span>
          {typeof skill.stats.stars === 'number' && skill.stats.stars > 0 && (
            <span className="inline-flex items-center gap-0.5" title={t('market.detail.stars')}>
              <span className="material-symbols-outlined text-[13px]" aria-hidden>star</span>
              {formatCount(skill.stats.stars)}
            </span>
          )}
          {showInstallButton && (
            <button
              type="button"
              disabled={installing}
              onClick={(e) => {
                e.stopPropagation()
                onInstall?.(skill.id)
              }}
              className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg bg-[var(--color-brand)] px-2.5 text-[11px] font-medium text-[var(--color-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {installing ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden />
              ) : (
                <span className="material-symbols-outlined text-[13px]" aria-hidden>download</span>
              )}
              {installing ? t('market.install.installing') : t('market.install.action')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
