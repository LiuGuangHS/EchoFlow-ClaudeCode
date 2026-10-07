import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SettingsPageHeader, SettingsPill, SettingsSection } from '@/components/settings/SettingsSection'
import { getDesktopHost } from '@/lib/desktopHost'
import type { DeepSeekHarnessStatus } from '@/lib/desktopHost/types'
import { useTranslation } from '@/i18n'
import { isDesktopRuntime } from '@/lib/desktopRuntime'

type ClaudeCodeRuntimeId = 'bundled' | 'installed'

const initialDeepSeekStatus: DeepSeekHarnessStatus = {
  state: 'unavailable',
  version: null,
  url: null,
  error: null,
  nodeVersion: null,
  nodeSource: null,
}

export function RuntimeSettings() {
  const t = useTranslation()
  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader title={t('settings.runtime.title')} description={t('settings.runtime.description')} />
      <ClaudeCodeRuntimeCard />
      <DeepSeekHarnessCard />
    </div>
  )
}

function ClaudeCodeRuntimeCard() {
  const t = useTranslation()
  const [runtime, setRuntime] = useState<ClaudeCodeRuntimeId>('bundled')
  const [hasInstalledRuntime, setHasInstalledRuntime] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isDesktopRuntime()) return
    void getDesktopHost().runtime.getClaudeCode()
      .then(status => {
        setRuntime(status.defaultRuntimeId)
        setHasInstalledRuntime(status.hasInstalledRuntime)
      })
      .catch(error => setError(error instanceof Error ? error.message : String(error)))
  }, [])

  const chooseInstalled = async () => {
    setSaving(true)
    setError(null)
    try {
      const status = await getDesktopHost().runtime.chooseClaudeCode()
      if (status) {
        setRuntime(status.defaultRuntimeId)
        setHasInstalledRuntime(status.hasInstalledRuntime)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const setChoice = async (next: ClaudeCodeRuntimeId) => {
    if (next === 'installed' && !hasInstalledRuntime) {
      await chooseInstalled()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const status = await getDesktopHost().runtime.setClaudeCode(next)
      setRuntime(status.defaultRuntimeId)
      setHasInstalledRuntime(status.hasInstalledRuntime)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection title={t('settings.runtime.claude.title')} description={t('settings.runtime.claude.description')}>
      <div className="flex flex-wrap gap-2">
        <SettingsPill selected={runtime === 'bundled'} disabled={saving} onClick={() => void setChoice('bundled')}>
          {t('settings.runtime.managed')}
        </SettingsPill>
        <SettingsPill selected={runtime === 'installed'} disabled={saving || !hasInstalledRuntime} onClick={() => void setChoice('installed')}>
          {t('settings.runtime.external')}
        </SettingsPill>
        <Button size="sm" variant="secondary" disabled={saving} loading={saving} onClick={() => void chooseInstalled()}>
          {t('settings.runtime.chooseExternal')}
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-[var(--color-error)]">{error}</p>}
    </SettingsSection>
  )
}

function DeepSeekHarnessCard() {
  const t = useTranslation()
  const host = getDesktopHost()
  const [status, setStatus] = useState<DeepSeekHarnessStatus>(initialDeepSeekStatus)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setStatus(await host.deepSeekHarness.getStatus())
  }, [host])

  useEffect(() => {
    void refresh().catch(error => setStatus(current => ({
      ...current,
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
    })))
  }, [refresh])

  const run = useCallback(async (action: () => Promise<DeepSeekHarnessStatus | void>) => {
    setLoading(true)
    try {
      const next = await action()
      if (next) setStatus(next)
      else await refresh()
    } catch (error) {
      setStatus(current => ({
        ...current,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const running = status.state === 'running'
  const installing = status.state === 'installing' || status.state === 'starting'
  const unavailable = status.state === 'unavailable'
  const stateLabel = running
    ? t('settings.runtime.deepseek.running')
    : installing
      ? t('settings.runtime.deepseek.starting')
      : unavailable
        ? t('settings.runtime.deepseek.unavailable')
        : status.state === 'error' ? t('settings.runtime.deepseek.error') : t('settings.runtime.deepseek.stopped')

  return (
    <SettingsSection title={t('settings.runtime.deepseek.title')} description={t('settings.runtime.deepseek.description')}>
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${running
          ? 'bg-[var(--color-success-container)] text-[var(--color-on-success-container)]'
          : 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'}`}
        >{stateLabel}</span>
        <div className="flex flex-wrap justify-end gap-2">
          {!running && !installing && <Button loading={loading} onClick={() => void run(() => host.deepSeekHarness.start())}>{unavailable ? t('settings.runtime.deepseek.prepareStart') : t('settings.runtime.deepseek.start')}</Button>}
          {running && <Button loading={loading} onClick={() => void run(() => host.deepSeekHarness.open())}>{t('settings.runtime.deepseek.open')}</Button>}
          {running && <Button variant="secondary" disabled={loading} onClick={() => void run(() => host.deepSeekHarness.restart())}>{t('settings.runtime.deepseek.restart')}</Button>}
          {running && <Button variant="secondary" disabled={loading} onClick={() => void run(() => host.deepSeekHarness.stop())}>{t('settings.runtime.deepseek.stop')}</Button>}
        </div>
      </div>
      <dl className="mt-4 grid gap-1 text-sm text-[var(--color-text-secondary)] sm:grid-cols-2">
        <div>{t('settings.runtime.deepseek.version')}: {status.version ?? t('settings.runtime.deepseek.versionPending')}</div>
        <div>{t('settings.runtime.deepseek.node')}: {status.nodeVersion ?? (unavailable ? t('settings.runtime.deepseek.nodeUnavailable') : t('settings.runtime.deepseek.nodeChecking'))}{status.nodeSource === 'managed' ? `（${t('settings.runtime.managed')}）` : status.nodeSource === 'system' ? `（${t('settings.runtime.deepseek.system')}）` : ''}</div>
      </dl>
      {(running || status.state === 'stopped') && <Button className="mt-4" variant="secondary" loading={loading} onClick={() => void run(() => host.deepSeekHarness.update())}>{running ? t('settings.runtime.deepseek.updateRestart') : t('settings.runtime.deepseek.updateStart')}</Button>}
      {status.error && <p role="alert" className="mt-4 text-sm text-[var(--color-error)]">{status.error}</p>}
      <p className="mt-4 text-sm leading-6 text-[var(--color-text-secondary)]">{t('settings.runtime.deepseek.isolated')}</p>
    </SettingsSection>
  )
}
