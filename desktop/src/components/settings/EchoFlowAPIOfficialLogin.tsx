import { useState } from 'react'
import { Eye, EyeOff, ExternalLink, LogIn, Settings } from 'lucide-react'
import { useProviderStore } from '../../stores/providerStore'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { echoflowApi, type EchoFlowModelOption, type EchoFlowTokenOption } from '../../api/echoflow'

const ECHOFLOW_BASE_URL = 'https://api.echoflow.cn'
const ECHOFLOW_GET_TOKEN_URL = 'https://api.echoflow.cn/console/personal'
const ECHOFLOW_PROVIDER_NAME = '清云（EchoFlow）API'
const ECHOFLOW_PRESET_ID = 'echoflowai'

const DEFAULT_MODELS = {
  main: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

function getDefaultModelSelection(chatModels: EchoFlowModelOption[]) {
  const main = chatModels.find((m) => m.id === DEFAULT_MODELS.main)?.id ?? chatModels[0]?.id ?? DEFAULT_MODELS.main
  const haiku = chatModels.find((m) => m.id.toLowerCase().includes('haiku'))?.id ??
    chatModels.find((m) => m.id === DEFAULT_MODELS.haiku)?.id ??
    main
  const sonnet = chatModels.find((m) => m.id.toLowerCase().includes('sonnet'))?.id ?? main
  const opus = chatModels.find((m) => m.id.toLowerCase().includes('opus'))?.id ?? main
  return { main, haiku, sonnet, opus }
}

type Props = {
  onOpenConfigModal: () => void
}

export function EchoFlowAPIOfficialLogin({ onOpenConfigModal }: Props) {
  const t = useTranslation()
  const { providers, createProvider, updateProvider, activateProvider, fetchProviders } = useProviderStore()

  const echoflowProviders = providers.filter((p) => p.presetId === ECHOFLOW_PRESET_ID)
  const savedManagement = echoflowProviders.find((p) => p.echoflowManagement)?.echoflowManagement

  const [userId, setUserId] = useState(savedManagement?.userId ?? '')
  const [mgmtToken, setMgmtToken] = useState(savedManagement?.managementToken ?? '')
  const [showMgmtToken, setShowMgmtToken] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [validationInfo, setValidationInfo] = useState<{ balance: number; userGroup: string; models: EchoFlowModelOption[]; tokens: EchoFlowTokenOption[] } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [selectedMainModel, setSelectedMainModel] = useState(DEFAULT_MODELS.main)
  const [selectedHaikuModel, setSelectedHaikuModel] = useState(DEFAULT_MODELS.haiku)
  const [selectedSonnetModel, setSelectedSonnetModel] = useState(DEFAULT_MODELS.sonnet)
  const [selectedOpusModel, setSelectedOpusModel] = useState(DEFAULT_MODELS.opus)
  const [selectedTokenKey, setSelectedTokenKey] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleValidate = async () => {
    const trimmedToken = mgmtToken.trim()
    if (!trimmedToken) return
    setIsValidating(true)
    setValidationError(null)
    setValidationInfo(null)
    try {
      const trimmedUserId = userId.trim()
      if (!trimmedUserId) {
        setValidationError(t('settings.echoflowAPIOfficialLogin.userIdPlaceholder'))
        return
      }
      const result = await echoflowApi.validateManagementToken(trimmedUserId, trimmedToken)
      if (!result.valid) {
        setValidationError(result.error === 'token_invalid'
          ? t('settings.echoflowAPIOfficialLogin.tokenInvalid')
          : t('settings.echoflowAPIOfficialLogin.serviceUnavailable'))
        return
      }
      const chatModels = (result.models ?? []).filter((m) => m.type === 'chat')
      const tokens = (result.tokens ?? []).filter((token) => token.key.trim())
      const selection = getDefaultModelSelection(chatModels)
      setSelectedMainModel(selection.main)
      setSelectedHaikuModel(selection.haiku)
      setSelectedSonnetModel(selection.sonnet)
      setSelectedOpusModel(selection.opus)
      setSelectedTokenKey(tokens[0]?.key ?? '')
      setValidationInfo({ balance: result.balance ?? 0, userGroup: result.userGroup ?? 'default', models: chatModels, tokens })
    } catch {
      setValidationError(t('settings.echoflowAPIOfficialLogin.serviceUnavailable'))
    } finally {
      setIsValidating(false)
    }
  }

  const resetValidationState = () => {
    setValidationInfo(null)
    setValidationError(null)
    setSelectedMainModel(DEFAULT_MODELS.main)
    setSelectedHaikuModel(DEFAULT_MODELS.haiku)
    setSelectedSonnetModel(DEFAULT_MODELS.sonnet)
    setSelectedOpusModel(DEFAULT_MODELS.opus)
    setSelectedTokenKey('')
  }

  const handleUserIdChange = (value: string) => {
    setUserId(value)
    resetValidationState()
  }

  const handleManagementTokenChange = (value: string) => {
    setMgmtToken(value)
    resetValidationState()
  }

  const handleCallTokenChange = (value: string) => {
    setSelectedTokenKey(value)
    const existingProvider = echoflowProviders.find((provider) => provider.apiKey === value)
    if (!existingProvider) return
    setSelectedMainModel(existingProvider.models.main)
    setSelectedHaikuModel(existingProvider.models.haiku)
    setSelectedSonnetModel(existingProvider.models.sonnet)
    setSelectedOpusModel(existingProvider.models.opus)
  }

  const handleConnect = async () => {
    const apiKey = selectedTokenKey.trim()
    if (!apiKey) {
      setError(t('settings.echoflowAPIOfficialLogin.callTokenRequired'))
      return
    }
    setIsConnecting(true)
    setError(null)
    try {
      const main = selectedMainModel || DEFAULT_MODELS.main
      const haiku = selectedHaikuModel || main
      const sonnet = selectedSonnetModel || main
      const opus = selectedOpusModel || main
      const models = { main, haiku, sonnet, opus }
      const echoflowManagement = { userId: userId.trim(), managementToken: mgmtToken.trim() }
      const selectedToken = callTokens.find((token) => token.key === apiKey)
      const tokenName = selectedToken?.name || selectedToken?.id || t('settings.echoflowAPIOfficialLogin.callTokenFallbackName')
      const echoflowToken = selectedToken
        ? {
            id: selectedToken.id,
            name: tokenName,
            ...(selectedToken.status ? { status: selectedToken.status } : {}),
            ...(typeof selectedToken.remainQuota === 'number' ? { remainQuota: selectedToken.remainQuota } : {}),
            ...(typeof selectedToken.unlimitedQuota === 'boolean' ? { unlimitedQuota: selectedToken.unlimitedQuota } : {}),
          }
        : undefined
      const existingProvider = echoflowProviders.find((provider) => provider.apiKey === apiKey)
      if (existingProvider) {
        await updateProvider(existingProvider.id, {
          apiKey,
          models,
          apiFormat: 'anthropic',
          echoflowManagement,
          ...(echoflowToken ? { echoflowToken } : {}),
        })
        await activateProvider(existingProvider.id)
      } else {
        const provider = await createProvider({
          presetId: ECHOFLOW_PRESET_ID,
          name: `${ECHOFLOW_PROVIDER_NAME} - ${tokenName}`,
          baseUrl: ECHOFLOW_BASE_URL,
          apiKey,
          apiFormat: 'anthropic',
          authStrategy: 'auth_token',
          models,
          echoflowManagement,
          ...(echoflowToken ? { echoflowToken } : {}),
        })
        await activateProvider(provider.id)
      }
      await fetchProviders()
      setValidationInfo(null)
      setSelectedTokenKey('')
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

  const chatModels = validationInfo?.models ?? []
  const callTokens = validationInfo?.tokens ?? []
  const canConnect = validationInfo !== null && selectedTokenKey.trim() !== '' && selectedMainModel.trim() !== ''

  const inputBase = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none transition-colors'
  const selectBase = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-brand)] focus:outline-none'

  return (
    <div className="flex flex-col gap-3">
      {/* Guide text */}
      <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">
        {t('settings.echoflowAPIOfficialLogin.managementTokenGuide')}
      </p>

      {/* External link buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void openExternalPage(ECHOFLOW_GET_TOKEN_URL)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-105"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {t('settings.echoflowAPIOfficialLogin.goGetToken')}
        </button>
        <button
          type="button"
          onClick={onOpenConfigModal}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-hover)]"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          {t('settings.echoflowAPIOfficialLogin.connectModeManualKey')}
        </button>
      </div>

      {/* User ID + management token row */}
      <div className="grid grid-cols-[160px_1fr] gap-2">
        <input
          type="text"
          value={userId}
          onChange={(e) => handleUserIdChange(e.target.value)}
          placeholder={t('settings.echoflowAPIOfficialLogin.userIdPlaceholder')}
          className={inputBase}
        />
        <div className="relative">
          <input
            type={showMgmtToken ? 'text' : 'password'}
            value={mgmtToken}
            onChange={(e) => handleManagementTokenChange(e.target.value)}
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
      </div>

      <button
        type="button"
        onClick={handleValidate}
        disabled={isValidating || !userId.trim() || !mgmtToken.trim()}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[image:var(--gradient-btn-primary)] px-3 py-2 text-xs text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-opacity hover:brightness-105 disabled:opacity-50"
      >
        {isValidating ? t('settings.echoflowAPIOfficialLogin.validating') : t('settings.echoflowAPIOfficialLogin.validateToken')}
      </button>

      {validationError && <div className="text-xs text-[var(--color-error)]">{validationError}</div>}

      {/* Validation success panel */}
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
          {callTokens.length > 0 ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-secondary)]">
                {t('settings.echoflowAPIOfficialLogin.selectCallToken')}
              </label>
              <select value={selectedTokenKey} onChange={(e) => handleCallTokenChange(e.target.value)} className={selectBase}>
                {callTokens.map((token) => (
                  <option key={`${token.id}-${token.key}`} value={token.key}>
                    {token.name || token.id || token.key}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{t('settings.echoflowAPIOfficialLogin.callTokenHint')}</p>
            </div>
          ) : (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-2.5 py-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
              {t('settings.echoflowAPIOfficialLogin.noCallTokens')}
            </div>
          )}
          <div>
            <label className="mb-2 block text-[11px] font-medium text-[var(--color-text-secondary)]">
              {t('settings.echoflowAPIOfficialLogin.modelMapping')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-text-tertiary)]">
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
                <label className="mb-1 block text-[11px] text-[var(--color-text-tertiary)]">
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
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.echoflowAPIOfficialLogin.selectSonnetModel')}
                </label>
                {chatModels.length > 0 ? (
                  <select value={selectedSonnetModel} onChange={(e) => setSelectedSonnetModel(e.target.value)} className={selectBase}>
                    {chatModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                ) : (
                  <input type="text" value={selectedSonnetModel} onChange={(e) => setSelectedSonnetModel(e.target.value)} placeholder={DEFAULT_MODELS.sonnet} className={`${selectBase} px-3`} />
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.echoflowAPIOfficialLogin.selectOpusModel')}
                </label>
                {chatModels.length > 0 ? (
                  <select value={selectedOpusModel} onChange={(e) => setSelectedOpusModel(e.target.value)} className={selectBase}>
                    {chatModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                ) : (
                  <input type="text" value={selectedOpusModel} onChange={(e) => setSelectedOpusModel(e.target.value)} placeholder={DEFAULT_MODELS.opus} className={`${selectBase} px-3`} />
                )}
              </div>
            </div>
          </div>
          {chatModels.length === 0 && (
            <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('settings.echoflowAPIOfficialLogin.modelFetchFailed')}</p>
          )}
        </div>
      )}

      {/* Connect button */}
      <button
        type="button"
        onClick={handleConnect}
        disabled={isConnecting || !canConnect}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-opacity hover:brightness-105 disabled:opacity-50"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {isConnecting ? '...' : t('settings.echoflowAPIOfficialLogin.saveProvider')}
      </button>

      {error && <div className="text-xs text-[var(--color-error)]">{error}</div>}
    </div>
  )
}
