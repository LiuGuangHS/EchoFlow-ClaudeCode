import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { SettingsPageHeader } from '@/components/settings/SettingsSection'
import { useTranslation } from '@/i18n'
import { NETWORK_TIMEOUT_MAX_SECONDS, useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { NetworkProxyMode, WebSearchMode } from '@/types/settings'
import { SETTINGS_CHECKBOX_INPUT_CLASS, SettingsCheckboxMark, isValidHttpProxyUrl } from './shared'

const NETWORK_TIMEOUT_MIN_SECONDS = 30
const NETWORK_TIMEOUT_STEP_SECONDS = 30

/**
 * The Network settings panel — outbound access for the desktop runtime.
 *
 * Moved verbatim out of `GeneralSettings.tsx`: the proxy mode, the AI request
 * timeout, the WebFetch preflight toggle and the WebSearch provider keys. It
 * was split out because the voice page links straight here to change the
 * proxy, and because a proxy mistake is worth isolating from the settings a
 * user edits once.
 */
export function NetworkSettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const {
    skipWebFetchPreflight,
    setSkipWebFetchPreflight,
    webSearch,
    setWebSearch,
    network,
    setNetwork,
  } = useSettingsStore()
  const [webSearchDraft, setWebSearchDraft] = useState(webSearch)
  const [networkDraft, setNetworkDraft] = useState(network)
  const [networkTimeoutInput, setNetworkTimeoutInput] = useState(String(Math.round(network.aiRequestTimeoutMs / 1000)))
  const [networkSaveError, setNetworkSaveError] = useState<string | null>(null)
  const [isSavingNetwork, setIsSavingNetwork] = useState(false)

  useEffect(() => {
    setWebSearchDraft(webSearch)
  }, [webSearch])

  useEffect(() => {
    setNetworkDraft(network)
    setNetworkTimeoutInput(String(Math.round(network.aiRequestTimeoutMs / 1000)))
    setNetworkSaveError(null)
  }, [network])

  const webSearchDirty = JSON.stringify(webSearchDraft) !== JSON.stringify(webSearch)

  const WEB_SEARCH_MODES: Array<{ value: WebSearchMode; label: string }> = [
    { value: 'auto', label: t('settings.general.webSearch.mode.auto') },
    { value: 'tavily', label: t('settings.general.webSearch.mode.tavily') },
    { value: 'brave', label: t('settings.general.webSearch.mode.brave') },
    { value: 'anthropic', label: t('settings.general.webSearch.mode.anthropic') },
    { value: 'disabled', label: t('settings.general.webSearch.mode.disabled') },
  ]

  const NETWORK_PROXY_MODES: Array<{ value: NetworkProxyMode; label: string; description: string }> = [
    {
      value: 'direct',
      label: t('settings.general.networkProxyModeDirect'),
      description: t('settings.general.networkProxyModeDirectDescription'),
    },
    {
      value: 'system',
      label: t('settings.general.networkProxyModeSystem'),
      description: t('settings.general.networkProxyModeSystemDescription'),
    },
    {
      value: 'manual',
      label: t('settings.general.networkProxyModeManual'),
      description: t('settings.general.networkProxyModeManualDescription'),
    },
  ]

  const networkProxyUrl = networkDraft.proxy.url.trim()
  const networkProxyError =
    networkDraft.proxy.mode === 'manual' && !networkProxyUrl
      ? t('settings.general.networkProxyUrlRequired')
      : networkDraft.proxy.mode === 'manual' && !isValidHttpProxyUrl(networkProxyUrl, true)
        ? t('settings.general.networkProxyUrlInvalid')
        : null
  const timeoutSeconds = Math.round(networkDraft.aiRequestTimeoutMs / 1000)
  const parsedNetworkTimeoutSeconds = (() => {
    const trimmed = networkTimeoutInput.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < NETWORK_TIMEOUT_MIN_SECONDS || seconds > NETWORK_TIMEOUT_MAX_SECONDS) return null
    return seconds
  })()
  const networkTimeoutError =
    networkTimeoutInput.trim().length === 0
      ? t('settings.general.networkTimeoutRequired')
      : parsedNetworkTimeoutSeconds === null
        ? t('settings.general.networkTimeoutRange', {
            min: String(NETWORK_TIMEOUT_MIN_SECONDS),
            max: String(NETWORK_TIMEOUT_MAX_SECONDS),
          })
        : null
  const networkDirty =
    networkDraft.aiRequestTimeoutMs !== network.aiRequestTimeoutMs ||
    networkDraft.proxy.mode !== network.proxy.mode ||
    networkDraft.proxy.url.trim() !== network.proxy.url.trim()

  const setNetworkTimeoutSeconds = (seconds: number) => {
    const nextSeconds = Math.min(Math.max(Math.round(seconds), NETWORK_TIMEOUT_MIN_SECONDS), NETWORK_TIMEOUT_MAX_SECONDS)
    setNetworkTimeoutInput(String(nextSeconds))
    setNetworkDraft((current) => ({
      ...current,
      aiRequestTimeoutMs: nextSeconds * 1000,
    }))
    setNetworkSaveError(null)
  }

  const saveNetworkSettings = async () => {
    if (networkProxyError) {
      setNetworkSaveError(networkProxyError)
      return
    }
    if (networkTimeoutError || parsedNetworkTimeoutSeconds === null) {
      setNetworkSaveError(networkTimeoutError ?? t('settings.general.networkTimeoutRange', {
        min: String(NETWORK_TIMEOUT_MIN_SECONDS),
        max: String(NETWORK_TIMEOUT_MAX_SECONDS),
      }))
      return
    }

    setIsSavingNetwork(true)
    setNetworkSaveError(null)
    try {
      await setNetwork({
        aiRequestTimeoutMs: parsedNetworkTimeoutSeconds * 1000,
        proxy: {
          mode: networkDraft.proxy.mode,
          url: networkDraft.proxy.mode === 'manual' ? networkProxyUrl : '',
        },
      })
      addToast({
        type: 'success',
        message: t('settings.general.networkSaved'),
      })
    } catch (error) {
      setNetworkSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingNetwork(false)
    }
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader title={t('settings.tab.network')} />

      <div>
        <h2 className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.networkTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.networkDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            {NETWORK_PROXY_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => {
                  setNetworkDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, mode: mode.value },
                  }))
                  setNetworkSaveError(null)
                }}
                aria-pressed={networkDraft.proxy.mode === mode.value}
                className={`rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors ${
                  networkDraft.proxy.mode === mode.value
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="text-xs font-semibold">{mode.label}</div>
                <div className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
                  {mode.description}
                </div>
              </button>
            ))}
          </div>

          {networkDraft.proxy.mode === 'manual' && (
            <div className="mt-4">
              <Input
                id="network-proxy-url"
                label={t('settings.general.networkProxyUrl')}
                value={networkDraft.proxy.url}
                placeholder="http://127.0.0.1:7890"
                autoComplete="off"
                onChange={(event) => {
                  setNetworkDraft((current) => ({
                    ...current,
                    proxy: { ...current.proxy, url: event.target.value },
                  }))
                  setNetworkSaveError(null)
                }}
              />
              <p className={`mt-1 text-[11px] leading-4 ${networkProxyError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}>
                {networkProxyError ?? t('settings.general.networkProxyUrlHint')}
              </p>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="network-timeout-seconds" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.general.networkTimeout')}
              </label>
              <span className="rounded-[var(--radius-md)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                {t('settings.general.networkTimeoutValue', { seconds: String(timeoutSeconds) })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10 w-10 px-0"
                aria-label={t('settings.general.networkTimeoutDecrease')}
                onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) - NETWORK_TIMEOUT_STEP_SECONDS)}
              >
                -30
              </Button>
              <div className="relative min-w-0 flex-1">
                <input
                  id="network-timeout-seconds"
                  type="number"
                  min={NETWORK_TIMEOUT_MIN_SECONDS}
                  max={NETWORK_TIMEOUT_MAX_SECONDS}
                  step={1}
                  inputMode="numeric"
                  value={networkTimeoutInput}
                  aria-invalid={networkTimeoutError ? true : undefined}
                  aria-describedby="network-timeout-help"
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value
                    if (!/^\d*$/.test(nextValue)) return
                    setNetworkTimeoutInput(nextValue)
                    const seconds = Number(nextValue)
                    if (nextValue.length > 0 && seconds >= NETWORK_TIMEOUT_MIN_SECONDS && seconds <= NETWORK_TIMEOUT_MAX_SECONDS) {
                      setNetworkDraft((current) => ({
                        ...current,
                        aiRequestTimeoutMs: seconds * 1000,
                      }))
                    }
                    setNetworkSaveError(null)
                  }}
                  className={`h-10 w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3 pr-12 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] ${
                    networkTimeoutError
                      ? 'border-[var(--color-error)] focus:shadow-[var(--shadow-error-ring)]'
                      : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]'
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.general.networkTimeoutUnit')}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10 w-10 px-0"
                aria-label={t('settings.general.networkTimeoutIncrease')}
                onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) + NETWORK_TIMEOUT_STEP_SECONDS)}
              >
                +30
              </Button>
            </div>
            <p
              id="network-timeout-help"
              className={`mt-2 text-xs leading-5 ${networkTimeoutError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
            >
              {networkTimeoutError ?? t('settings.general.networkTimeoutHint')}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
              {t('settings.general.networkScopeHint')}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="min-w-[72px] px-4 whitespace-nowrap"
              disabled={!networkDirty || !!networkProxyError || !!networkTimeoutError || isSavingNetwork}
              loading={isSavingNetwork}
              onClick={() => void saveNetworkSettings()}
            >
              {t('settings.general.networkSave')}
            </Button>
          </div>

          {networkSaveError && (
            <p className="mt-2 text-[11px] leading-4 text-[var(--color-error)]">
              {networkSaveError}
            </p>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.webFetchPreflightTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webFetchPreflightDescription')}</p>
        <label className="relative flex items-start gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 cursor-pointer hover:border-[var(--color-border-focus)] transition-colors">
          <input
            type="checkbox"
            aria-label={t('settings.general.webFetchPreflightEnabled')}
            checked={skipWebFetchPreflight}
            onChange={(e) => void setSkipWebFetchPreflight(e.target.checked)}
            className={SETTINGS_CHECKBOX_INPUT_CLASS}
          />
          <SettingsCheckboxMark checked={skipWebFetchPreflight} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.general.webFetchPreflightEnabled')}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">
              {t('settings.general.webFetchPreflightHint')}
            </div>
          </div>
        </label>
      </div>

      <div className="mt-8">
        <h2 className="text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-headline)' }}>{t('settings.general.webSearchTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webSearchDescription')}</p>
        <Card radius="xl" surface="low" padding="none" className="px-4 py-4">
          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {WEB_SEARCH_MODES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setWebSearchDraft({ ...webSearchDraft, mode: value })}
                className={`h-9 px-2 text-xs font-semibold rounded-[var(--radius-lg)] border transition-all truncate ${
                  (webSearchDraft.mode ?? 'auto') === value
                    ? 'bg-[var(--color-brand)] text-[var(--color-on-primary)] border-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
                title={label}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <Input
              id="web-search-tavily-key"
              type="password"
              label={t('settings.general.webSearchTavilyKey')}
              value={webSearchDraft.tavilyApiKey ?? ''}
              placeholder="tvly-..."
              autoComplete="off"
              onChange={(event) =>
                setWebSearchDraft({
                  ...webSearchDraft,
                  tavilyApiKey: event.target.value,
                })
              }
            />
            <div className="-mt-1 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
              <span>{t('settings.general.webSearchTavilyFreeHint')}</span>
              <a
                href="https://app.tavily.com/home"
                target="_blank"
                rel="noreferrer"
                aria-label={t('settings.general.webSearchTavilyApiKeyLink')}
                className="font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap"
              >
                {t('settings.general.webSearchGetApiKey')}
              </a>
            </div>
            <Input
              id="web-search-brave-key"
              type="password"
              label={t('settings.general.webSearchBraveKey')}
              value={webSearchDraft.braveApiKey ?? ''}
              placeholder={t('settings.general.webSearchBravePlaceholder')}
              autoComplete="off"
              onChange={(event) =>
                setWebSearchDraft({
                  ...webSearchDraft,
                  braveApiKey: event.target.value,
                })
              }
            />
            <div className="-mt-1 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
              <span>{t('settings.general.webSearchBraveFreeHint')}</span>
              <a
                href="https://api-dashboard.search.brave.com/app/keys"
                target="_blank"
                rel="noreferrer"
                aria-label={t('settings.general.webSearchBraveApiKeyLink')}
                className="font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap"
              >
                {t('settings.general.webSearchGetApiKey')}
              </a>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-tertiary)] leading-5">
              {t('settings.general.webSearchHint')}
            </p>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                className="min-w-[72px] px-4 whitespace-nowrap"
                disabled={!webSearchDirty}
                onClick={() => void setWebSearch(webSearchDraft)}
              >
                {t('settings.general.webSearchSave')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
