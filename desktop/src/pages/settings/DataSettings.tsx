import { useEffect, useRef, useState } from 'react'

import { FolderInput, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { TextArea } from '@/components/ui/TextArea'
import { Switch } from '@/components/ui/Switch'
import { SettingsPageHeader } from '@/components/settings/SettingsSection'
import { useTranslation } from '@/i18n'
import { settingsApi } from '@/api/settings'
import { getDesktopHost } from '@/lib/desktopHost'
import { isDesktopRuntime } from '@/lib/desktopRuntime'
import { isTouchH5Document } from '@/lib/touchH5'
import { useSessionStore } from '@/stores/sessionStore'
import { useSettingsStore, DEFAULT_CLEANUP_PERIOD_DAYS, MAX_CLEANUP_PERIOD_DAYS } from '@/stores/settingsStore'
import { normalizeLocalRedactionSettings } from '../../../../src/shared/localRedactionSettings'
import { useUIStore } from '@/stores/uiStore'
import type { AppMode } from '@/types/settings'

/**
 * The Data & Storage settings panel — retention, local request redaction,
 * and the config directory the desktop runtime reads.
 *
 * Moved verbatim out of `GeneralSettings.tsx`: changing the retention period
 * deletes transcripts, and switching the data directory restarts the app.
 * Both are irreversible enough to deserve a page of their own rather than
 * sitting under a long list of preferences.
 */
export function DataSettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const { localRedaction, setLocalRedaction } = useSettingsStore()
  const [localRedactionSaveError, setLocalRedactionSaveError] = useState<string | null>(null)
  const {
    cleanupPeriodDays,
    setCleanupPeriodDays,
    appMode,
    appModeRequiresRestart,
    fetchAppMode,
    setAppMode: setAppModeAction,
  } = useSettingsStore()
  const [modeSwitchConfirmOpen, setModeSwitchConfirmOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null)
  const [pendingPortableDir, setPendingPortableDir] = useState<string | null>(null)
  const [portableDirDraft, setPortableDirDraft] = useState('')
  const [modeActionRunning, setModeActionRunning] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const [retentionInput, setRetentionInput] = useState(String(cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS))
  const [retentionConfirmOpen, setRetentionConfirmOpen] = useState(false)
  const [retentionActionRunning, setRetentionActionRunning] = useState(false)
  const [retentionSaveError, setRetentionSaveError] = useState<string | null>(null)
  const [retentionPreviewFiles, setRetentionPreviewFiles] = useState<number | null>(null)
  const [retentionPreviewLoading, setRetentionPreviewLoading] = useState(false)
  const [retentionPendingDays, setRetentionPendingDays] = useState<number | null>(null)

  /** Guards against a slow dry-run response overwriting a newer one. */
  const retentionPreviewRequestId = useRef(0)

  const activeConfigDir = appMode.activeConfigDir ?? (appMode.mode === 'portable' ? appMode.portableDir : null)
  const configDirSource = appMode.configDirSource ?? (appMode.mode === 'portable' ? 'portable' : 'system')
  const isEnvironmentConfigDir = configDirSource === 'environment'

  useEffect(() => {
    setRetentionInput(String(cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS))
  }, [cleanupPeriodDays])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    void fetchAppMode()
  }, [fetchAppMode])

  useEffect(() => {
    setPortableDirDraft(appMode.portableDir ?? '')
  }, [appMode.portableDir])

  const handleLocalRedactionChange = async (settings: Parameters<typeof setLocalRedaction>[0]) => {
    setLocalRedactionSaveError(null)
    try {
      await setLocalRedaction(normalizeLocalRedactionSettings(settings))
    } catch (error) {
      setLocalRedactionSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const effectiveRetentionDays = cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS
  const parsedRetentionDays = (() => {
    const trimmed = retentionInput.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const days = Number(trimmed)
    if (!Number.isInteger(days) || days < 0 || days > MAX_CLEANUP_PERIOD_DAYS) return null
    return days
  })()
  const retentionInputError =
    retentionInput.trim().length === 0
      ? t('settings.general.sessionRetentionRequired')
      : parsedRetentionDays === null
        ? t('settings.general.sessionRetentionRange', { max: String(MAX_CLEANUP_PERIOD_DAYS) })
        : null
  const retentionDirty =
    parsedRetentionDays !== null && parsedRetentionDays !== effectiveRetentionDays

  /**
   * Changing the retention period deletes transcripts immediately, so the save
   * button never saves directly. It first asks the server for a dry-run count
   * and only then opens the dialog with the blast radius already on screen —
   * the dialog can therefore never be confirmed before the count is known.
   */
  const openRetentionConfirm = async () => {
    if (parsedRetentionDays === null) {
      setRetentionSaveError(
        retentionInputError ??
          t('settings.general.sessionRetentionRange', {
            max: String(MAX_CLEANUP_PERIOD_DAYS),
          }),
      )
      return
    }
    const days = parsedRetentionDays
    const requestId = ++retentionPreviewRequestId.current
    setRetentionSaveError(null)
    setRetentionPreviewFiles(null)
    setRetentionPreviewLoading(true)
    try {
      const preview = await settingsApi.cleanupSessions(days, true)
      if (requestId !== retentionPreviewRequestId.current) return
      setRetentionPreviewFiles(preview.files)
      setRetentionPendingDays(days)
      setRetentionConfirmOpen(true)
    } catch (error) {
      if (requestId !== retentionPreviewRequestId.current) return
      setRetentionSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === retentionPreviewRequestId.current) {
        setRetentionPreviewLoading(false)
      }
    }
  }

  const closeRetentionConfirm = () => {
    if (retentionActionRunning) return
    setRetentionConfirmOpen(false)
    setRetentionPendingDays(null)
    setRetentionSaveError(null)
  }

  const confirmRetentionChange = async () => {
    if (retentionPendingDays === null) return
    setRetentionActionRunning(true)
    setRetentionSaveError(null)
    try {
      await setCleanupPeriodDays(retentionPendingDays)
      const result = await settingsApi.cleanupSessions(retentionPendingDays)
      setRetentionConfirmOpen(false)
      setRetentionPendingDays(null)
      addToast({
        type: 'success',
        message:
          result.errors > 0
            ? t('settings.general.sessionRetentionSavedPartial', {
                count: String(result.files),
                errors: String(result.errors),
              })
            : t('settings.general.sessionRetentionSaved', {
                count: String(result.files),
              }),
      })
      void useSessionStore.getState().fetchSessions()
    } catch (error) {
      // Keep the dialog open: the error is rendered inside it and the target
      // value stays pinned, so confirming again retries the same change even if
      // the failed save already rolled the store back.
      setRetentionSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setRetentionActionRunning(false)
    }
  }

  const openPortableDirPicker = async () => {
    setModeError(null)
    const host = getDesktopHost()
    if (!host.capabilities.dialogs) {
      setModeError(t('settings.general.storagePickerError'))
      return
    }
    try {
      const selected = await host.dialogs.open({
        directory: true,
        multiple: false,
        title: t('settings.general.storageChooseDirTitle'),
      })
      if (typeof selected === 'string') {
        setPortableDirDraft(selected)
      }
    } catch {
      setModeError(t('settings.general.storagePickerError'))
    }
  }

  const openModeSwitchConfirm = (mode: AppMode) => {
    if (isEnvironmentConfigDir) {
      setModeError(t('settings.general.storageEnvironmentSwitchBlocked'))
      return
    }

    const portableDir = portableDirDraft.trim()
    if (mode === 'portable' && !portableDir) {
      setModeError(t('settings.general.storageNoDirError'))
      return
    }

    setModeError(null)
    setPendingMode(mode)
    setPendingPortableDir(mode === 'portable' ? portableDir : null)
    setModeSwitchConfirmOpen(true)
  }

  const closeModeSwitchConfirm = () => {
    if (modeActionRunning) return
    setModeSwitchConfirmOpen(false)
    setPendingMode(null)
    setPendingPortableDir(null)
  }

  const confirmModeSwitch = async () => {
    if (!pendingMode) return

    setModeActionRunning(true)
    setModeError(null)
    try {
      await setAppModeAction(pendingMode, pendingPortableDir)
      const host = getDesktopHost()
      await host.appMode.prepareRestart()
      await host.appMode.restart()
    } catch (error) {
      setModeError(
        error instanceof Error
          ? error.message
          : t('settings.general.storageRestartError'),
      )
      setModeSwitchConfirmOpen(false)
      setPendingMode(null)
      setPendingPortableDir(null)
      setModeActionRunning(false)
    }
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader title={t('settings.tab.data')} />

      {/*
        Retention changes delete transcripts irreversibly and the server only
        accepts them with the desktop process token, so a paired phone browser
        would only ever see a 403 here.
      */}
      {!isTouchH5Document() && (
      <div className="mt-8 border-t border-[var(--color-border)] pt-8">
        <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.sessionRetentionTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.sessionRetentionDescription')}</p>

        <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="session-retention-days" className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.general.sessionRetentionLabel')}
            </label>
            <span className="rounded-[var(--radius-md)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
              {effectiveRetentionDays === 0
                ? t('settings.general.sessionRetentionCurrentOff')
                : t('settings.general.sessionRetentionCurrent', { days: String(effectiveRetentionDays) })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                id="session-retention-days"
                type="number"
                min={0}
                max={MAX_CLEANUP_PERIOD_DAYS}
                step={1}
                inputMode="numeric"
                value={retentionInput}
                aria-invalid={retentionInputError ? true : undefined}
                aria-describedby="session-retention-help"
                onChange={(event) => {
                  const nextValue = event.currentTarget.value
                  if (!/^\d*$/.test(nextValue)) return
                  setRetentionInput(nextValue)
                  setRetentionSaveError(null)
                }}
                className={`h-10 w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3 pr-14 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] ${
                  retentionInputError
                    ? 'border-[var(--color-error)] focus:shadow-[var(--shadow-error-ring)]'
                    : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]'
                }`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.general.sessionRetentionUnit')}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="min-w-[72px] px-4 whitespace-nowrap"
              disabled={
                !retentionDirty ||
                !!retentionInputError ||
                retentionActionRunning ||
                retentionPreviewLoading
              }
              loading={retentionPreviewLoading || retentionActionRunning}
              onClick={() => void openRetentionConfirm()}
            >
              {t('settings.general.sessionRetentionSave')}
            </Button>
          </div>
          <p
            id="session-retention-help"
            className={`mt-2 text-xs leading-5 ${retentionInputError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
          >
            {retentionInputError ?? t('settings.general.sessionRetentionHint')}
          </p>
          {retentionSaveError && (
            <p className="mt-2 text-[11px] leading-4 text-[var(--color-error)]">{retentionSaveError}</p>
          )}
        </Card>
      </div>
      )}

      {isDesktopRuntime() && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-8">
          <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.storageTitle')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.storageDescription')}</p>

          <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isEnvironmentConfigDir) {
                    setModeError(t('settings.general.storageEnvironmentSwitchBlocked'))
                    return
                  }
                  if (appMode.mode !== 'default') {
                    openModeSwitchConfirm('default')
                  }
                }}
                aria-pressed={appMode.mode === 'default' && !isEnvironmentConfigDir}
                className={`flex items-start gap-3 rounded-[var(--radius-lg)] border px-3 py-3 text-left transition-all ${
                  appMode.mode === 'default' && !isEnvironmentConfigDir
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <Settings2 size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.general.storageSystemTitle')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.storageSystemDescription')}</span>
                </span>
              </button>

              <div
                className={`rounded-[var(--radius-lg)] border px-3 py-3 transition-all ${
                  appMode.mode === 'portable' && !isEnvironmentConfigDir
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                }`}
              >
                <div className="mb-3 flex items-start gap-3">
                  <FolderInput size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.general.storagePortableTitle')}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.storagePortableDescription')}</div>
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      id="portable-data-dir"
                      label={t('settings.general.storagePortableDirLabel')}
                      value={portableDirDraft}
                      placeholder={t('settings.general.storagePortableDirPlaceholder')}
                      onChange={(event) => {
                        setPortableDirDraft(event.target.value)
                        setModeError(null)
                      }}
                      className="w-full font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 flex-shrink-0 px-3 whitespace-nowrap"
                    onClick={() => void openPortableDirPicker()}
                  >
                    {t('settings.general.storageChooseDir')}
                  </Button>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={modeActionRunning || (appMode.mode === 'portable' && portableDirDraft.trim() === (appMode.portableDir ?? ''))}
                    onClick={() => openModeSwitchConfirm('portable')}
                  >
                    {t('settings.general.storageApplyPortable')}
                  </Button>
                </div>
              </div>
            </div>

            {activeConfigDir && (
              <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border-separator)] bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{t('settings.general.storageActiveDir')}</div>
                <div className="mt-1 break-all font-mono text-xs text-[var(--color-text-secondary)]">{activeConfigDir}</div>
              </div>
            )}

            {isEnvironmentConfigDir && (
              <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-container)] px-3 py-2 text-xs leading-5 text-[var(--color-on-warning-container)]">
                {t('settings.general.storageEnvironmentHint')}
              </div>
            )}

            {appModeRequiresRestart && (
              <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-container)] px-3 py-2 text-xs leading-5 text-[var(--color-on-warning-container)]">
                {t('settings.general.storageRestartHint')}
              </div>
            )}

            <div className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t('settings.general.storageMoveHint')}
            </div>

            {modeError && (
              <div className="mt-3 text-xs text-[var(--color-error)]">
                {modeError}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Confirm dialog for mode switch */}
      <div className="mt-8 border-t border-[var(--color-border)] pt-8">
        <h2 className="text-[18px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.localRedactionTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.localRedactionDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
          <Switch label={t('settings.general.localRedactionEnabled')} description={t('settings.general.localRedactionEnabledHint')} checked={localRedaction.enabled} onChange={(enabled) => void handleLocalRedactionChange({ ...localRedaction, enabled })} />
          {localRedaction.enabled && (
            <div className="mt-4 space-y-4">
              <Switch label={t('settings.general.localRedactionPersonalInfo')} checked={localRedaction.personalInfo} onChange={(personalInfo) => void handleLocalRedactionChange({ ...localRedaction, personalInfo })} />
              <TextArea label={t('settings.general.localRedactionCustomWords')} rows={3} value={localRedaction.customWords.join('\n')} onChange={(event) => void handleLocalRedactionChange({ ...localRedaction, customWords: event.target.value.split(/\r?\n/) })} hint={t('settings.general.localRedactionCustomWordsHint')} />
            </div>
          )}
          {localRedactionSaveError && (
            <p role="alert" className="mt-3 text-xs text-[var(--color-error)]">{localRedactionSaveError}</p>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={modeSwitchConfirmOpen}
        onClose={closeModeSwitchConfirm}
        onConfirm={() => void confirmModeSwitch()}
        title={t('settings.general.modeSwitchTitle')}
        body={(
          <div className="space-y-3 text-sm leading-6 text-[var(--color-text-secondary)]">
            <p>
              {pendingMode === 'portable'
                ? t('settings.general.storageSwitchPortableBody')
                : t('settings.general.storageSwitchDefaultBody')}
            </p>
            {pendingMode === 'portable' && pendingPortableDir && (
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] px-3 py-2 font-mono text-xs break-all text-[var(--color-text-secondary)]">
                {pendingPortableDir}
              </div>
            )}
            <p>{t('settings.general.storageSwitchRestartBody')}</p>
          </div>
        )}
        confirmLabel={t('settings.general.modeSwitchConfirm')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
        loading={modeActionRunning}
      />

      <ConfirmDialog
        open={retentionConfirmOpen}
        onClose={closeRetentionConfirm}
        onConfirm={() => void confirmRetentionChange()}
        title={t('settings.general.sessionRetentionConfirmTitle')}
        body={(
          <div className="space-y-2 text-sm leading-6">
            <p>
              {retentionPendingDays === 0
                ? t('settings.general.sessionRetentionConfirmDisable')
                : t('settings.general.sessionRetentionConfirmDelete', {
                    days: String(retentionPendingDays ?? effectiveRetentionDays),
                  })}
            </p>
            <p className="text-[var(--color-text-tertiary)]">
              {retentionPreviewFiles === null
                ? t('settings.general.sessionRetentionPreviewUnavailable')
                : t('settings.general.sessionRetentionPreview', {
                    count: String(retentionPreviewFiles),
                  })}
            </p>
            {retentionSaveError && (
              <p className="text-[var(--color-error)]">{retentionSaveError}</p>
            )}
          </div>
        )}
        confirmLabel={t('settings.general.sessionRetentionConfirmAction')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={retentionActionRunning}
      />
    </div>
  )
}
