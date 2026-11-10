import { Check } from 'lucide-react'
import type { TranslationKey } from '@/i18n'
import type { WebSearchMode } from '@/types/settings'

/** The WebSearch providers every settings panel offers. Shared so a provider
 *  added to one panel (DeepSeek) is never silently missing from the other. */
export const WEB_SEARCH_MODE_VALUES: readonly WebSearchMode[] = [
  'auto', 'tavily', 'brave', 'deepseek', 'anthropic', 'disabled',
]

/** Literal label keys keep the five-locale i18n key scan honest. */
export const WEB_SEARCH_MODE_LABEL_KEYS: Record<WebSearchMode, TranslationKey> = {
  auto: 'settings.general.webSearch.mode.auto',
  tavily: 'settings.general.webSearch.mode.tavily',
  brave: 'settings.general.webSearch.mode.brave',
  deepseek: 'settings.general.webSearch.mode.deepseek',
  anthropic: 'settings.general.webSearch.mode.anthropic',
  disabled: 'settings.general.webSearch.mode.disabled',
}

/**
 * The few things more than one Settings panel needs.
 *
 * Extracted while splitting `Settings.tsx` into one module per panel, so a
 * panel never imports from the file that imports it. The hand-rolled checkbox
 * mark that used to live here is gone: settings toggles are `Switch` rows of
 * the shared skeleton (`components/settings/SettingsSection`), and dialog
 * checkboxes use `ui/Checkbox`.
 */

/**
 * Legacy checkbox row used by the Network and Runtime behaviour panels. New
 * pages should use `ui/Checkbox` or a `Switch` row; these two exports stay so
 * the existing panels keep rendering their inline hint text next to the mark.
 */
export const SETTINGS_CHECKBOX_INPUT_CLASS = 'settings-checkbox-input peer'

export function SettingsCheckboxMark({ checked, disabled = false }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-border-focus)] ${
        checked
          ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-on-primary)] shadow-[var(--shadow-button-primary)]'
          : 'border-[var(--color-border-focus)] bg-[var(--color-surface)] text-transparent'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Check size={16} strokeWidth={1.75} />
    </span>
  )
}

const MAX_PROXY_URL_LENGTH = 2_048

export function isValidHttpProxyUrl(value: string, allowCredentials = false): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_PROXY_URL_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
    return false
  }

  try {
    const url = new URL(trimmed)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !!url.hostname
      && (allowCredentials || (!url.username && !url.password))
      && (url.port === '' || (Number(url.port) >= 1 && Number(url.port) <= 65_535))
  } catch {
    return false
  }
}
