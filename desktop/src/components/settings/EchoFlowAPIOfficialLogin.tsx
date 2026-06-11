import { useState } from 'react'
import { Eye, EyeOff, ExternalLink, LogIn, LogOut } from 'lucide-react'
import { useProviderStore } from '../../stores/providerStore'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { echoflowApi, type EchoFlowModelOption } from '../../api/echoflow'

const ECHOFLOW_BASE_URL = 'https://api.echoflow.cn'
const ECHOFLOW_REGISTER_URL = 'https://api.echoflow.cn/register?channel=c_fe4eotyx'
const ECHOFLOW_GET_TOKEN_URL = 'https://api.echoflow.cn/panel/user/tokens'
const ECHOFLOW_PROVIDER_NAME = 'EchoFlowAPI'
const ECHOFLOW_PRESET_ID = 'echoflowai'

const DEFAULT_MODELS = {
  main: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

type ConnectMode = 'management_token' | 'manual_key'

export function EchoFlowAPIOfficialLogin() {
  const t = useTranslation()
  const { providers, activeId, createProvider, updateProvider, activateProvider, activateOfficial, fetchProviders } = useProviderStore()

  const [connectMode, setConnectMode] = useState<ConnectMode>('management_token')

  // Management token mode
  const [mgmtToken, setMgmtToken] = useState('')
  const [showMgmtToken, setShowMgmtToken] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [validationInfo, setValidationInfo] = useState<{ balance: number; userGroup: string; models: EchoFlowModelOption[] } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [selectedMainModel, setSelectedMainModel] = useState(DEFAULT_MODELS.main)
  const [selectedHaikuModel, setSelectedHaikuModel] = useState(DEFAULT_MODELS.haiku)

  // Manual key mode
  const [manualKey, setManualKey] = useState('')
  const [showManualKey, setShowManualKey] = useState(false)
  const [manualMainModel, setManualMainModel] = useState('')
  const [manualHaikuModel, setManualHaikuModel] = useState('')

  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const echoflowProvider = providers.find(
    (p) => p.presetId === ECHOFLOW_PRESET_ID && p.name === ECHOFLOW_PROVIDER_NAME,
  )
  const isActive = !!echoflowProvider && activeId === echoflowProvider.id

  const handleValidate = async () => {
    const trimmed = mgmtToken.trim()
    if (!trimmed) return
    setIsValidating(true)
    setValidationError(null)
    setValidationInfo(null)
    try {
      const result = await echoflowApi.validateManagementToken(trimmed)
      if (!result.valid) {
        setValidationError(t('settings.echoflowAPIOfficialLogin.tokenInvalid'))
        return
      }
      const chatModels = (result.models ?? []).filter((m) => m.type === 'chat')
      setValidationInfo({ balance: result.balance ?? 0, userGroup: result.userGroup ?? 'default', models: chatModels })
      const haikuMatch = chatModels.find((m) => m.id.toLowerCase().includes('haiku'))
      if (haikuMatch) setSelectedHaikuModel(haikuMatch.id)
      const defaultMain = chatModels.find((m) => m.id === DEFAULT_MODELS.main)
      if (!defaultMain && chatModels[0]) setSelectedMainModel(chatModels[0].id)
    } catch {
      setValidationError(t('settings.echoflowAPIOfficialLogin.tokenInvalid'))
    } finally {
      setIsValidating(false)
    }
  }

  const handleConnect = async () => {
    setIsConnecting(true)
    setError(null)
    try {
      let apiKey: string
      let models: typeof DEFAULT_MODELS
      if (connectMode === 'management_token') {
        apiKey = mgmtToken.trim()
        const main = selectedMainModel || DEFAULT_MODELS.main
        const haiku = selectedHaikuModel || main
        models = { main, haiku, sonnet: main, opus: main }
      } else {
        apiKey = manualKey.trim()
        const main = manualMainModel.trim() || DEFAULT_MODELS.main
        const haiku = manualHaikuModel.trim() || main
        models = { main, haiku, sonnet: main, opus: main }
      }
      if (echoflowProvider) {
        await updateProvider(echoflowProvider.id, { apiKey, models })
        await activateProvider(echoflowProvider.id)
      } else {
        const provider = await createProvider({
          presetId: ECHOFLOW_PRESET_ID,
          name: ECHOFLOW_PROVIDER_NAME,
          baseUrl: ECHOFLOW_BASE_URL,
          apiKey,
          apiFormat: 'anthropic',
          authStrategy: 'auth_token',
          models,
        })
        await activateProvider(provider.id)
      }
      await fetchProviders()
      setMgmtToken('')
      setManualKey('')
      setValidationInfo(null)
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

  const openExternalPage = async (url: string) => {
    try {
      await getDesktopHost().shell.open(url)
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  if (isActive) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-success)]">{t('settings.echoflowAPIOfficialLogin.connected')}</span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isConnecting}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] px-3 py-1 text-xs transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {isConnecting ? '...' : t('settings.echoflowAPIOfficialLogin.disconnect')}
          </button>
        </div>
        {error && <div className="text-xs text-[var(--color-error)]">{error}</div>}
      </div>
    )
  }

  const chatModels = validationInfo?.models ?? []
  const canConnect = connectMode === 'management_token'
    ? (validationInfo !== null && selectedMainModel.trim() !== '')
    : (manualKey.trim() !== '' && manualMainModel.trim() !== '')

  const inputBase = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none transition-colors'
  const selectBase = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-brand)] focus:outline-none'

  return (
    <div className="flex flex-col gap-3">
      {/* Mode toggle */}
      <div className="flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] text-xs">
        <button
          type="button"
          onClick={() => setConnectMode('management_token')}
          className={`flex-1 px-3 py-1.5 font-medium transition-colors ${
            connectMode === 'management_token'
              ? 'bg-[var(--color-brand)] text-white'
              : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          {t('settings.echoflowAPIOfficialLogin.connectModeManagementToken')}
        </button>
        <button
          type="button"
          onClick={() => setConnectMode('manual_key')}
          className={`flex-1 border-l border-[var(--color-border)] px-3 py-1.5 font-medium transition-colors ${
            connectMode === 'manual_key'
              ? 'bg-[var(--color-brand)] text-white'
              : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          {t('settings.echoflowAPIOfficialLogin.connectModeManualKey')}
        </button>
      </div>

      {connectMode === 'management_token' ? (
        <>
          <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">
            {t('settings.echoflowAPIOfficialLogin.managementTokenGuide')}
          </p>

          <div className="flex items-center gap-2">
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void openExternalPage(ECHOFLOW_REGISTER_URL)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-medium text-white transition hover:brightness-105"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {t('settings.echoflowAPIOfficialLogin.goRegister')}
              </button>
              <button
                type="button"
                onClick={() => void openExternalPage(ECHOFLOW_GET_TOKEN_URL)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface-hover)]"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {t('settings.echoflowAPIOfficialLogin.goGetToken')}
              </button>
            </div>
            <div className="relative flex-1">
              <input
                type={showMgmtToken ? 'text' : 'password'}
                value={mgmtToken}
                onChange={(e) => { setMgmtToken(e.target.value); setValidationInfo(null); setValidationError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && mgmtToken.trim()) void handleValidate() }}
                placeholder={t('settings.echoflowAPIOfficialLogin.managementTokenPlaceholder')}
                className={`${inputBase} pr-9`}
              />
              <button
                type="button"
                onClick={() => setShowMgmtToken(!showMgmtToken)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                {showMgmtToken ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleValidate}
              disabled={isValidating || !mgmtToken.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[image:var(--gradient-btn-primary)] px-3 py-2 text-xs text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-opacity hover:brightness-105 disabled:opacity-50"
            >
              {isValidating ? t('settings.echoflowAPIOfficialLogin.validating') : t('settings.echoflowAPIOfficialLogin.validateToken')}
            </button>
          </div>

          {validationError && <div className="text-xs text-[var(--color-error)]">{validationError}</div>}

          {validationInfo && (
            <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/6 px-3 py-2.5">
              <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
                <span>
                  {t('settings.echoflowAPIOfficialLogin.balance')}:{' '}
                  <span className="font-medium text-[var(--color-text-primary)]">¥{validationInfo.balance.toFixed(2)}</span>
                </span>
                <span>
                  {t('settings.echoflowAPIOfficialLogin.userGroup')}:{' '}
                  <span className="font-medium text-[var(--color-text-primary)]">{validationInfo.userGroup}</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-secondary)]">
                    {t('settings.echoflowAPIOfficialLogin.selectMainModel')}
                  </label>
                  {chatModels.length > 0 ? (
                    <select value={selectedMainModel} onChange={(e) => setSelectedMainModel(e.target.value)} className={selectBase}>
                      {chatModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={selectedMainModel} onChange={(e) => setSelectedMainModel(e.target.value)} placeholder={DEFAULT_MODELS.main} className={`${selectBase} px-3`} />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-secondary)]">
                    {t('settings.echoflowAPIOfficialLogin.selectHaikuModel')}
                  </label>
                  {chatModels.length > 0 ? (
                    <select value={selectedHaikuModel} onChange={(e) => setSelectedHaikuModel(e.target.value)} className={selectBase}>
                      {chatModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={selectedHaikuModel} onChange={(e) => setSelectedHaikuModel(e.target.value)} placeholder={DEFAULT_MODELS.haiku} className={`${selectBase} px-3`} />
                  )}
                </div>
              </div>
              {chatModels.length === 0 && (
                <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('settings.echoflowAPIOfficialLogin.modelFetchFailed')}</p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">
            {t('settings.echoflowAPIOfficialLogin.manualKeyDesc')}
          </p>
          <div className="relative">
            <input
              type={showManualKey ? 'text' : 'password'}
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              placeholder={t('settings.echoflowAPIOfficialLogin.manualKeyPlaceholder')}
              className={`${inputBase} pr-9`}
            />
            <button
              type="button"
              onClick={() => setShowManualKey(!showManualKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              {showManualKey ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={manualMainModel}
              onChange={(e) => setManualMainModel(e.target.value)}
              placeholder={t('settings.echoflowAPIOfficialLogin.mainModelPlaceholder')}
              className={inputBase}
            />
            <input
              type="text"
              value={manualHaikuModel}
              onChange={(e) => setManualHaikuModel(e.target.value)}
              placeholder={t('settings.echoflowAPIOfficialLogin.haikuModelPlaceholder')}
              className={inputBase}
            />
          </div>
        </>
      )}

      <button
        type="button"
        onClick={handleConnect}
        disabled={isConnecting || !canConnect}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-opacity hover:brightness-105 disabled:opacity-50"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {isConnecting ? '...' : t('settings.echoflowAPIOfficialLogin.connect')}
      </button>

      {error && <div className="text-xs text-[var(--color-error)]">{error}</div>}
    </div>
  )
}
