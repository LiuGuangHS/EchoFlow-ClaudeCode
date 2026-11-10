import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, Paintbrush } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dropdown } from '@/components/ui/Dropdown'
import { PermissionModeSelector } from '@/components/controls/PermissionModeSelector'
import { ReasoningEffortPopover } from '@/components/controls/ReasoningEffortPopover'
import { useTranslation, type TranslationKey } from '@/i18n'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import type { OutputStyleSource, ReasoningEffortLevel } from '../../types/settings'
import { MODEL_REASONING_EFFORTS } from '../../../../src/shared/modelReasoning'
import { SETTINGS_CHECKBOX_INPUT_CLASS, SettingsCheckboxMark } from './shared'

const BUILT_IN_OUTPUT_STYLE_TRANSLATION_KEYS = {
  default: {
    label: 'settings.general.outputStyleBuiltin.default.label',
    description: 'settings.general.outputStyleBuiltin.default.description',
  },
  Explanatory: {
    label: 'settings.general.outputStyleBuiltin.explanatory.label',
    description: 'settings.general.outputStyleBuiltin.explanatory.description',
  },
  Learning: {
    label: 'settings.general.outputStyleBuiltin.learning.label',
    description: 'settings.general.outputStyleBuiltin.learning.description',
  },
} satisfies Record<string, { label: TranslationKey; description: TranslationKey }>

export function RuntimeBehaviorSettings() {
  const {
    currentModel,
    effortLevel,
    setEffort,
    thinkingEnabled,
    setThinkingEnabled,
    permissionMode,
    setPermissionMode,
    outputStyle,
    outputStyles,
    outputStyleScope,
    outputStylesLoading,
    outputStyleError,
    fetchOutputStyles,
    setOutputStyle,
  } = useSettingsStore()
  const sessions = useSessionStore((state) => state.sessions)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  const [effortOpen, setEffortOpen] = useState(false)
  const effortButtonRef = useRef<HTMLButtonElement>(null)
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  )
  const outputStyleWorkDir = activeSession?.workDirExists === false
    ? null
    : activeSession?.workDir ?? activeSession?.projectRoot ?? null

  useEffect(() => {
    void fetchOutputStyles(outputStyleWorkDir)
  }, [fetchOutputStyles, outputStyleWorkDir])

  const outputStyleItems = outputStyles.map((style) => ({
    value: style.value,
    label: getOutputStyleLabel(style, t),
    description: `${getOutputStyleDescription(style, t)} · ${getOutputStyleSourceLabel(style.source, t)}`,
  }))
  const selectedOutputStyle = outputStyles.find((style) => style.value === outputStyle) ?? outputStyles[0]
  const selectedOutputStyleLabel = selectedOutputStyle
    ? getOutputStyleLabel(selectedOutputStyle, t)
    : outputStyle
  const selectedOutputStyleDescription = selectedOutputStyle
    ? getOutputStyleDescription(selectedOutputStyle, t)
    : ''
  const outputStyleScopeLabel = outputStyleScope === 'localSettings'
    ? t('settings.general.outputStyleScopeLocal')
    : t('settings.general.outputStyleScopeUser')
  const outputStyleScopeHint = outputStyleScope === 'localSettings'
    ? t('settings.general.outputStyleScopeLocalHint')
    : t('settings.general.outputStyleScopeUserHint')
  const effortLabels: Record<ReasoningEffortLevel, string> = {
    low: t('settings.general.effort.low'),
    medium: t('settings.general.effort.medium'),
    high: t('settings.general.effort.high'),
    xhigh: t('settings.general.effort.xhigh'),
    max: t('settings.general.effort.max'),
  }
  const supportedReasoningEfforts = currentModel?.supportedReasoningEfforts
  const effortOptions = !currentModel
    ? []
    : supportedReasoningEfforts === undefined
      ? MODEL_REASONING_EFFORTS.filter((level) => level !== 'xhigh')
      : MODEL_REASONING_EFFORTS.filter((level) => supportedReasoningEfforts.includes(level))
  const modelDefaultEffort = currentModel?.defaultReasoningEffort
  const selectedEffort = effortOptions.includes(effortLevel)
    ? effortLevel
    : modelDefaultEffort && effortOptions.includes(modelDefaultEffort)
      ? modelDefaultEffort
      : effortOptions[0]

  const handleOutputStyleChange = async (value: string) => {
    try {
      await setOutputStyle(value, outputStyleWorkDir)
      addToast({
        type: 'success',
        message: t('settings.general.outputStyleSaved'),
      })
    } catch {
      // The store exposes outputStyleError below; keep the interaction local.
    }
  }

  return (
    <>
      <div>
        <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.outputStyleTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.outputStyleDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="mb-8 px-4 py-4">
          <Dropdown<string>
            items={outputStyleItems}
            value={outputStyle}
            onChange={(value) => void handleOutputStyleChange(value)}
            width="100%"
            maxHeight={360}
            className="block w-full"
            trigger={(
              <Button
                variant="secondary"
                size="md"
                block
                className="h-auto min-h-10 gap-3 py-2"
                aria-label={t('settings.general.outputStyleSelectLabel')}
                disabled={outputStylesLoading}
                icon={<Paintbrush size={18} strokeWidth={1.75} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />}
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">
                    {outputStylesLoading ? t('settings.general.outputStyleLoading') : selectedOutputStyleLabel}
                  </span>
                  {selectedOutputStyleDescription && (
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                      {selectedOutputStyleDescription}
                    </span>
                  )}
                </span>
                <ChevronDown size={18} strokeWidth={1.75} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
              </Button>
            )}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <span className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-medium text-[var(--color-text-secondary)]">
              {outputStyleScopeLabel}
            </span>
            {selectedOutputStyle && (
              <span className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
                {getOutputStyleSourceLabel(selectedOutputStyle.source, t)}
              </span>
            )}
            <span className="min-w-0 flex-1 leading-5">{outputStyleScopeHint}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.outputStyleRestartHint')}</p>
          {outputStyleError && <p className="mt-2 text-xs leading-5 text-[var(--color-error)]">{outputStyleError}</p>}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.defaultPermissionTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.defaultPermissionDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.general.defaultPermissionLabel')}</div>
              <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.defaultPermissionHint')}</div>
            </div>
            <PermissionModeSelector
              value={permissionMode}
              onChange={(mode) => void setPermissionMode(mode)}
              workDir={t('settings.general.defaultPermissionScope')}
              menuPlacement="bottom"
            />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.effortTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.effortDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.general.effortDefaultLabel')}</div>
              <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                {currentModel ? t('settings.general.effortModelHint', { model: currentModel.name || currentModel.id }) : t('settings.general.effortNoModelHint')}
              </div>
            </div>
            <Button
              ref={effortButtonRef}
              variant="secondary"
              size="base"
              disabled={!selectedEffort}
              aria-label={selectedEffort ? t('settings.general.effortSelectLabel', { level: effortLabels[selectedEffort] }) : t('settings.general.effortUnavailable')}
              aria-expanded={selectedEffort ? effortOpen : undefined}
              onClick={() => setEffortOpen((open) => !open)}
              icon={<Brain size={16} strokeWidth={1.75} aria-hidden="true" />}
              iconPosition="start"
            >
              {selectedEffort ? effortLabels[selectedEffort] : t('settings.general.effortUnavailable')}
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        </Card>
        {selectedEffort && (
          <ReasoningEffortPopover
            open={effortOpen}
            anchorRef={effortButtonRef}
            options={effortOptions}
            value={selectedEffort}
            labels={effortLabels}
            ariaLabel={t('settings.general.effortDefaultLabel')}
            onChange={(level) => void setEffort(level)}
            onClose={() => setEffortOpen(false)}
          />
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.thinkingTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.thinkingDescription')}</p>
        <label className="relative flex items-start gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 cursor-pointer hover:border-[var(--color-border-focus)] transition-colors">
          <input
            type="checkbox"
            aria-label={t('settings.general.thinkingEnabled')}
            checked={thinkingEnabled}
            onChange={(event) => void setThinkingEnabled(event.target.checked)}
            className={SETTINGS_CHECKBOX_INPUT_CLASS}
          />
          <SettingsCheckboxMark checked={thinkingEnabled} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.general.thinkingEnabled')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">{t('settings.general.thinkingHint')}</div>
          </div>
        </label>
      </div>
    </>
  )
}

function getBuiltInOutputStyleTranslationKeys(style: { value: string; source: OutputStyleSource }) {
  if (style.source !== 'built-in') return null
  return BUILT_IN_OUTPUT_STYLE_TRANSLATION_KEYS[style.value as keyof typeof BUILT_IN_OUTPUT_STYLE_TRANSLATION_KEYS] ?? null
}

function getOutputStyleLabel(style: { value: string; label: string; source: OutputStyleSource }, t: (key: TranslationKey) => string) {
  const keys = getBuiltInOutputStyleTranslationKeys(style)
  return keys ? t(keys.label) : style.label
}

function getOutputStyleDescription(style: { value: string; description: string; source: OutputStyleSource }, t: (key: TranslationKey) => string) {
  const keys = getBuiltInOutputStyleTranslationKeys(style)
  return keys ? t(keys.description) : style.description
}

function getOutputStyleSourceLabel(source: OutputStyleSource, t: (key: TranslationKey) => string) {
  switch (source) {
    case 'built-in': return t('settings.general.outputStyleSourceBuiltIn')
    case 'userSettings': return t('settings.general.outputStyleSourceUser')
    case 'projectSettings': return t('settings.general.outputStyleSourceProject')
    case 'localSettings': return t('settings.general.outputStyleSourceLocal')
    case 'policySettings': return t('settings.general.outputStyleSourcePolicy')
    case 'plugin': return t('settings.general.outputStyleSourcePlugin')
  }
}
