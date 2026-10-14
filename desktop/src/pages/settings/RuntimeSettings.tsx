import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SettingsPageHeader, SettingsPill, SettingsSection } from '@/components/settings/SettingsSection'
import { getDesktopHost } from '@/lib/desktopHost'
import type { DeepSeekHarnessStatus, RuntimeDiscoveryResult, RuntimeInstallation } from '@/lib/desktopHost/types'
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
      <RuntimeDiscoveryCard />
      <ClaudeCodeRuntimeCard />
      <DeepSeekHarnessCard />
    </div>
  )
}

function RuntimeDiscoveryCard() {
  const t = useTranslation()
  const host = getDesktopHost()
  const [result, setResult] = useState<RuntimeDiscoveryResult>({ installations: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathResult, setPathResult] = useState<RuntimeInstallation | null>(null)

  const refresh = useCallback(async (includeWsl = false) => {
    setLoading(true)
    setError(null)
    try {
      setResult(await host.runtimeDiscovery.list(includeWsl ? { includeWsl: true } : undefined))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [host])

  useEffect(() => { void refresh() }, [refresh])

  const choosePath = async () => {
    setPathError(null)
    try {
      const selected = await host.dialogs.open({ title: t('settings.runtime.discovery.choosePath'), multiple: false })
      if (typeof selected !== 'string') return
      setPathResult(await host.runtimeDiscovery.probePath(selected))
    } catch (cause) {
      setPathError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const productName = (installation: RuntimeInstallation) => installation.productId === 'echoflow-agent'
    ? t('settings.runtime.discovery.echoflow')
    : installation.productId === 'claude-code'
      ? 'Claude Code'
      : installation.productId === 'codex'
        ? 'Codex'
        : 'WSL'
  const sourceName = (installation: RuntimeInstallation) => installation.source === 'bundled'
    ? t('settings.runtime.discovery.sourceBundled')
    : installation.source === 'current-system'
      ? t('settings.runtime.discovery.sourceSystem')
      : installation.source === 'custom-path'
        ? t('settings.runtime.discovery.sourceCustom')
        : `${t('settings.runtime.discovery.sourceWsl')}${installation.distribution ? ` · ${installation.distribution}` : ''}`
  const statusName = (installation: RuntimeInstallation) => installation.status === 'available'
    ? t('settings.runtime.discovery.available')
    : installation.status === 'not-applicable'
      ? t('settings.runtime.discovery.notApplicable')
      : installation.status === 'not-found'
        ? t('settings.runtime.discovery.notFound')
        : installation.error === 'probe-timeout'
          ? t('settings.runtime.discovery.timeout')
          : t('settings.runtime.discovery.probeFailed')

  const installations = pathResult ? [...result.installations, pathResult] : result.installations

  const probedLabel = (installation: RuntimeInstallation) => {
    if (!installation.probedAt) return t('settings.runtime.discovery.neverChecked')
    const minutes = Math.floor((Date.now() - installation.probedAt) / 60_000)
    return minutes < 1
      ? t('settings.runtime.discovery.checkedJustNow')
      : t('settings.runtime.discovery.checkedAgo', { minutes: String(minutes) })
  }

  const revealPath = async (installation: RuntimeInstallation) => {
    if (!installation.path) return
    setPathError(null)
    try {
      await host.shell.showItemInFolder(installation.path)
    } catch (cause) {
      setPathError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <SettingsSection title={t('settings.runtime.discovery.title')} description={t('settings.runtime.discovery.description')}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={loading} onClick={() => void refresh()}>{t('settings.runtime.discovery.refresh')}</Button>
        {host.isDesktop && <Button size="sm" variant="secondary" disabled={loading} onClick={() => void refresh(true)}>{t('settings.runtime.discovery.checkWsl')}</Button>}
        {host.capabilities.dialogs && <Button size="sm" variant="secondary" disabled={loading} onClick={() => void choosePath()}>{t('settings.runtime.discovery.addPath')}</Button>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{error}</p>}
      {pathError && <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{pathError}</p>}
      {loading && <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{t('settings.runtime.discovery.checking')}</p>}
      {!loading && installations.length === 0 && <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{t('settings.runtime.discovery.empty')}</p>}
      <ul className="mt-3 grid gap-2">
        {installations.map((installation, index) => <li key={`${installation.productId}:${installation.source}:${installation.distribution ?? installation.path ?? index}`} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{productName(installation)}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">{sourceName(installation)} · {statusName(installation)}{installation.version ? ` · ${installation.version}` : ''}</span>
          </div>
          {installation.path && <p className="mt-1 break-all text-xs text-[var(--color-text-tertiary)]">{installation.path}</p>}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--color-text-tertiary)]">{probedLabel(installation)}</span>
            {/* Only a local, current-system path can be revealed on this OS; a
                WSL path is inside another filesystem and must not be passed to
                the native file manager. */}
            {installation.path && installation.source !== 'wsl' && (
              <Button size="sm" variant="ghost" onClick={() => void revealPath(installation)}>
                {t('settings.runtime.discovery.showInFolder')}
              </Button>
            )}
          </div>
        </li>)}
      </ul>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.runtime.discovery.notExecution')}</p>
    </SettingsSection>
  )
}

function ClaudeCodeRuntimeCard() {
  const t = useTranslation()
  const [runtime, setRuntime] = useState<ClaudeCodeRuntimeId>('bundled')
  const [hasInstalledRuntime, setHasInstalledRuntime] = useState(false)
  const [installedPath, setInstalledPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const applyStatus = (status: { defaultRuntimeId: ClaudeCodeRuntimeId, hasInstalledRuntime: boolean, installedPath?: string | null }) => {
    setRuntime(status.defaultRuntimeId)
    setHasInstalledRuntime(status.hasInstalledRuntime)
    setInstalledPath(status.installedPath ?? null)
  }

  useEffect(() => {
    if (!isDesktopRuntime()) return
    void getDesktopHost().runtime.getClaudeCode()
      .then(applyStatus)
      .catch(error => setError(error instanceof Error ? error.message : String(error)))
  }, [])

  const chooseInstalled = async () => {
    setSaving(true)
    setError(null)
    try {
      const status = await getDesktopHost().runtime.chooseClaudeCode()
      if (status) applyStatus(status)
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
      applyStatus(await getDesktopHost().runtime.setClaudeCode(next))
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
      {/* Names the file the installed choice runs, so a wrong or stale pick is
          visible from this page instead of only when a session fails. */}
      {runtime === 'installed' && installedPath && (
        <p className="mt-2 break-all text-xs text-[var(--color-text-tertiary)]">{installedPath}</p>
      )}
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
        <div>{t('settings.runtime.deepseek.node')}: {status.nodeVersion ?? (unavailable ? t('settings.runtime.deepseek.nodeUnavailable') : t('settings.runtime.deepseek.nodeChecking'))}{status.nodeSource === 'managed' ? `（${t('settings.runtime.nodeManaged')}）` : status.nodeSource === 'system' ? `（${t('settings.runtime.deepseek.system')}）` : ''}</div>
      </dl>
      {(running || status.state === 'stopped') && <Button className="mt-4" variant="secondary" loading={loading} onClick={() => void run(() => host.deepSeekHarness.update())}>{running ? t('settings.runtime.deepseek.updateRestart') : t('settings.runtime.deepseek.updateStart')}</Button>}
      {status.error && <p role="alert" className="mt-4 text-sm text-[var(--color-error)]">{status.error}</p>}
      <p className="mt-4 text-sm leading-6 text-[var(--color-text-secondary)]">{t('settings.runtime.deepseek.isolated')}</p>
    </SettingsSection>
  )
}
