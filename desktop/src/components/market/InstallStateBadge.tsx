import { useTranslation } from '../../i18n'
import type { InstallState } from '../../types/market'

const STYLES: Record<InstallState, { icon: string; className: string }> = {
  installed: {
    icon: 'check_circle',
    className: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  },
  installable: {
    icon: 'download',
    // brand-on-neutral keeps AA contrast in all three themes (brand-on-primary-fixed is 1.3:1 in dark).
    className: 'bg-[var(--color-surface-container)] text-[var(--color-brand)]',
  },
  'not-installable': {
    icon: 'block',
    className: 'bg-[var(--color-error-container)] text-[var(--color-error)]',
  },
}

const LABEL_KEYS: Record<InstallState, 'market.install.state.installed' | 'market.install.state.installable' | 'market.install.state.notInstallable'> = {
  installed: 'market.install.state.installed',
  installable: 'market.install.state.installable',
  'not-installable': 'market.install.state.notInstallable',
}

export function InstallStateBadge({ state, className = '' }: { state: InstallState; className?: string }) {
  const t = useTranslation()
  const style = STYLES[state]
  return (
    <span
      data-testid={`install-badge-${state}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${style.className} ${className}`}
    >
      <span className="material-symbols-outlined text-[12px]" aria-hidden>
        {style.icon}
      </span>
      {t(LABEL_KEYS[state])}
    </span>
  )
}
