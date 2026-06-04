// desktop/src/components/settings/EchoFlowAPIOfficialLogin.tsx

import { useState } from 'react'
import { Eye, EyeOff, ExternalLink, LogIn, LogOut } from 'lucide-react'
import { useProviderStore } from '../../stores/providerStore'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'

const ECHOFLOW_BASE_URL = 'https://api.echoflow.cn'
const ECHOFLOW_GET_TOKEN_URL = 'https://api.echoflow.cn/register?channel=c_fe4eotyx'
const ECHOFLOW_PROVIDER_NAME = 'EchoFlowAPI'
const ECHOFLOW_PRESET_ID = 'echoflowai'

const ECHOFLOW_MODELS = {
  main: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

export function EchoFlowAPIOfficialLogin() {
  const t = useTranslation()
  const {
    providers,
    activeId,
    createProvider,
    updateProvider,
    activateProvider,
    activateOfficial,
    fetchProviders,
  } = useProviderStore()

  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const echoflowProvider = providers.find(
    (p) => p.presetId === ECHOFLOW_PRESET_ID && p.name === ECHOFLOW_PROVIDER_NAME,
  )
  const isActive = !!echoflowProvider && activeId === echoflowProvider.id

  const handleConnect = async () => {
    const trimmed = token.trim()
    if (!trimmed) return

    setIsConnecting(true)
    setError(null)
    try {
      if (echoflowProvider) {
        await updateProvider(echoflowProvider.id, { apiKey: trimmed })
        await activateProvider(echoflowProvider.id)
      } else {
        const provider = await createProvider({
          presetId: ECHOFLOW_PRESET_ID,
          name: ECHOFLOW_PROVIDER_NAME,
          baseUrl: ECHOFLOW_BASE_URL,
          apiKey: trimmed,
          apiFormat: 'anthropic',
          authStrategy: 'auth_token',
          models: ECHOFLOW_MODELS,
        })
        await activateProvider(provider.id)
      }
      await fetchProviders()
      setToken('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setIsConnecting(true)
    setError(null)
    try {
      await activateOfficial()
      await fetchProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsConnecting(false)
    }
  }

  const handleGetToken = async () => {
    try {
      await getDesktopHost().shell.open(ECHOFLOW_GET_TOKEN_URL)
    } catch {
      window.open(ECHOFLOW_GET_TOKEN_URL, '_blank', 'noopener,noreferrer')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && token.trim()) {
      void handleConnect()
    }
  }

  if (isActive) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-success)]">
            {t('settings.echoflowAPIOfficialLogin.connected')}
          </span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isConnecting}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] px-3 py-1 text-xs transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {isConnecting
              ? '...'
              : t('settings.echoflowAPIOfficialLogin.disconnect')}
          </button>
        </div>
        {error && (
          <div className="text-xs text-[var(--color-error)]">{error}</div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGetToken}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/30"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {t('settings.echoflowAPIOfficialLogin.getToken')}
        </button>
        <div className="relative flex-1">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('settings.echoflowAPIOfficialLogin.tokenPlaceholder')}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pr-9 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {showToken ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={handleConnect}
          disabled={isConnecting || !token.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-opacity hover:brightness-105 disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {isConnecting
            ? '...'
            : t('settings.echoflowAPIOfficialLogin.connect')}
        </button>
      </div>
      {error && (
        <div className="text-xs text-[var(--color-error)]">{error}</div>
      )}
    </div>
  )
}
