import { useTranslation } from '../../i18n'
import type { SecurityStatus } from '../../types/market'

const STYLES: Record<SecurityStatus, { icon: string; className: string }> = {
  verified: {
    icon: 'verified',
    className: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  },
  benign: {
    icon: 'gpp_good',
    className: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  },
  unknown: {
    icon: 'shield_question',
    // text-secondary: tertiary lands at ~3.3-3.9:1 on this container across themes — below AA for 10px text.
    className: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
  },
  flagged: {
    icon: 'gpp_maybe',
    className: 'bg-[var(--color-error-container)] text-[var(--color-error)]',
  },
}

export function SecurityBadge({ status, className = '' }: { status: SecurityStatus; className?: string }) {
  const t = useTranslation()
  const style = STYLES[status]
  return (
    <span
      data-testid={`security-badge-${status}`}
      title={t(`market.securityHint.${status}`)}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${style.className} ${className}`}
    >
      <span className="material-symbols-outlined text-[12px]" aria-hidden>
        {style.icon}
      </span>
      {t(`market.security.${status}`)}
    </span>
  )
}
