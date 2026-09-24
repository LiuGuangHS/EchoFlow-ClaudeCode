import { Dropdown } from '../ui/Dropdown'
import { Button } from '../ui/Button'

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
  const value = requestedRuntime ?? effectiveRuntime ?? 'bundled'
  const items = [
    { value: 'bundled' as const, label: 'Bundled' },
    ...(hasInstalledRuntime ? [{ value: 'installed' as const, label: 'Installed' }] : []),
  ]
  const statusLabel = status === 'pending'
    ? 'Applying…'
    : status === 'failed'
      ? 'Runtime change failed'
      : value === 'installed' ? 'Installed' : 'Bundled'

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
            aria-label="CLI runtime"
            disabled={status === 'pending'}
          >
            {statusLabel}
          </Button>
        )}
      />
    </div>
  )
}
