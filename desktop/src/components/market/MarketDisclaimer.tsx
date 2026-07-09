import { useState } from 'react'
import { useTranslation } from '../../i18n'

const STORAGE_KEY = 'cc-haha-market-disclaimer-dismissed'

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Top-of-market disclaimer: skills come from third-party sources and are not
 * audited locally — users should review (ideally AI-scan) them before install.
 * Dismissal is persisted so it only shows until acknowledged.
 */
export function MarketDisclaimer() {
  const t = useTranslation()
  const [dismissed, setDismissed] = useState(readDismissed)

  if (dismissed) return null

  return (
    <div
      role="note"
      data-testid="market-disclaimer"
      className="flex items-start gap-3 rounded-xl border border-[var(--color-warning)]/35 bg-[var(--color-warning-container)] px-4 py-3"
    >
      <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[18px] text-[var(--color-warning)]" aria-hidden>
        gpp_maybe
      </span>
      <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--color-text-secondary)]">
        <span className="font-semibold text-[var(--color-text-primary)]">{t('market.disclaimer.title')}</span>{' '}
        {t('market.disclaimer.body')}
      </p>
      <button
        type="button"
        aria-label={t('market.disclaimer.dismiss')}
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem(STORAGE_KEY, '1')
          } catch {
            // Persisting is best-effort; the banner stays dismissed for this session.
          }
        }}
        className="inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-text-primary)]"
      >
        <span className="material-symbols-outlined text-[16px]" aria-hidden>
          close
        </span>
      </button>
    </div>
  )
}
