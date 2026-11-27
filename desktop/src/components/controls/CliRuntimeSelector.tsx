import { Dropdown } from '../ui/Dropdown'
import { Button } from '../ui/Button'
import { useTranslation } from '@/i18n'
import type { ClaudeCodeRuntimeId } from '@/lib/desktopHost'

type CliRuntimeStatus = 'pending' | 'applied' | 'failed'

type CliRuntimeSelectorProps = {
  effectiveRuntime: ClaudeCodeRuntimeId | undefined
  requestedRuntime: ClaudeCodeRuntimeId | undefined
  status: CliRuntimeStatus | undefined
  hasInstalledRuntime: boolean
  disabled?: boolean
  onChange: (runtimeId: ClaudeCodeRuntimeId) => void
}

export function CliRuntimeSelector({
  effectiveRuntime,
  requestedRuntime,
  status,
  hasInstalledRuntime,
  disabled,
  onChange,
}: CliRuntimeSelectorProps) {
  const t = useTranslation()
  // The local default and an unacknowledged request do not establish the session runtime.
  const value = (status === 'pending' ? requestedRuntime : undefined) ?? effectiveRuntime ?? ''
  const label = t('settings.runtime.cliLabel')
  const items = [
    { value: 'bundled' as const, label: t('settings.runtime.managed') },
    ...(hasInstalledRuntime ? [{ value: 'installed' as const, label: t('settings.runtime.external') }] : []),
  ]
  const statusLabel = status === 'pending'
    ? t('settings.runtime.applying')
    : status === 'failed'
      ? t('settings.runtime.changeFailed')
      : value === 'installed' ? t('settings.runtime.external') : value === 'bundled' ? t('settings.runtime.managed') : label

  return (
    <div className="flex items-center gap-2">
      <Dropdown<ClaudeCodeRuntimeId | ''>
        items={items}
        value={value}
        onChange={(next) => { if (next) onChange(next) }}
        portal
        trigger={(
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={label}
            disabled={disabled || status === 'pending'}
          >
            {statusLabel}
          </Button>
        )}
      />
      <span aria-live="polite" className="sr-only">{statusLabel === label ? '' : statusLabel}</span>
    </div>
  )
}
