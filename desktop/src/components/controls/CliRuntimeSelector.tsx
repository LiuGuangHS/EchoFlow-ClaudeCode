import { Dropdown } from '../ui/Dropdown'
import { Button } from '../ui/Button'
import { useTranslation } from '@/i18n'

type ClaudeCodeRuntimeId = 'bundled' | 'installed'
type CliRuntimeStatus = 'pending' | 'applied' | 'failed'

type CliRuntimeSelectorProps = {
  effectiveRuntime: ClaudeCodeRuntimeId | undefined
  requestedRuntime: ClaudeCodeRuntimeId | undefined
  status: CliRuntimeStatus | undefined
  hasInstalledRuntime: boolean
  onChange: (runtimeId: ClaudeCodeRuntimeId) => void
}

export function CliRuntimeSelector({
  effectiveRuntime,
  requestedRuntime,
  status,
  hasInstalledRuntime,
  onChange,
}: CliRuntimeSelectorProps) {
  const t = useTranslation()
  const value = requestedRuntime ?? effectiveRuntime ?? 'bundled'
  const items = [
    { value: 'bundled' as const, label: t('settings.runtime.managed') },
    ...(hasInstalledRuntime ? [{ value: 'installed' as const, label: t('settings.runtime.external') }] : []),
  ]
  const statusLabel = status === 'pending'
    ? t('settings.runtime.applying')
    : status === 'failed'
      ? t('settings.runtime.changeFailed')
      : value === 'installed' ? t('settings.runtime.external') : t('settings.runtime.managed')

  return (
    <div className="flex items-center gap-2">
      <Dropdown<ClaudeCodeRuntimeId>
        items={items}
        value={value}
        onChange={onChange}
        trigger={(
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={t('settings.runtime.cliLabel')}
            disabled={status === 'pending'}
          >
            {statusLabel}
          </Button>
        )}
      />
    </div>
  )
}
