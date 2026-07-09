import { ListChecks } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useActivityPanelStore } from '../../stores/activityPanelStore'

type SessionActivityButtonProps = {
  sessionId: string
  badgeCount: number
  label?: string
}

export function SessionActivityButton({
  sessionId,
  badgeCount,
  label,
}: SessionActivityButtonProps) {
  const t = useTranslation()
  const resolvedLabel = label ?? t('session.activity.title')
  const isOpen = useActivityPanelStore((state) => state.isOpen(sessionId))
  const toggle = useActivityPanelStore((state) => state.toggle)
  const visibleBadgeCount = Math.max(0, badgeCount)

  return (
    <button
      type="button"
      aria-label={resolvedLabel}
      aria-expanded={isOpen}
      aria-pressed={isOpen}
      title={resolvedLabel}
      onClick={() => toggle(sessionId)}
      data-active={isOpen ? 'true' : 'false'}
      data-session-activity-trigger="true"
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
        isOpen
          ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <ListChecks size={17} strokeWidth={1.9} />
      {visibleBadgeCount > 0 && (
        <span
          data-testid="session-activity-badge"
          className="absolute -right-1 -top-1 inline-flex min-w-4 h-4 items-center justify-center rounded-full bg-[var(--color-error)] px-1 text-[10px] font-semibold leading-none text-white"
        >
          {visibleBadgeCount > 9 ? '9+' : visibleBadgeCount}
        </span>
      )}
    </button>
  )
}
