import { useEffect, useState } from 'react'
import { Eye, EyeOff, RefreshCw, Unlink } from 'lucide-react'
import {
  ECHOFLOW_BASE_URLS,
  echoflowApi,
  type EchoFlowAccount,
  type EchoFlowEndpoint,
  type EchoFlowTokenSource,
} from '../../api/echoflow'
import { useProviderStore } from '../../stores/providerStore'
import { normalizeProviderBaseUrl } from '../../config/providerPresets'
import { useTranslation } from '../../i18n'


type Props = {
  onAddFromToken: (source: EchoFlowTokenSource) => void
  onBindingChange?: (hasAccount: boolean) => void
}

type Credentials = {
  userId: string
  managementToken: string
}

type Accounts = Record<EchoFlowEndpoint, EchoFlowAccount | null>

const EMPTY_ACCOUNTS: Accounts = { main: null, dedicated: null }

function formatQuota(remainQuota?: number, unlimitedQuota?: boolean, unlimitedLabel = ''): string {
  if (unlimitedQuota) return unlimitedLabel
  if (remainQuota !== undefined) {
    return `¥${remainQuota.toFixed(2)}`
  }
  return ''
}

export function EchoFlowAPIOfficialLogin({ onAddFromToken, onBindingChange }: Props) {
  const t = useTranslation()
  const { providers } = useProviderStore()
  const [accounts, setAccounts] = useState<Accounts>(EMPTY_ACCOUNTS)
  const [selectedEndpoint, setSelectedEndpoint] = useState<EchoFlowEndpoint>('main')
  const [credentials, setCredentials] = useState<Record<EchoFlowEndpoint, Credentials>>({
    main: { userId: '', managementToken: '' },
    dedicated: { userId: '', managementToken: '' },
  })
  const [showManagementToken, setShowManagementToken] = useState(false)
  const [isSavingAccount, setIsSavingAccount] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [showCredentialEditor, setShowCredentialEditor] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const account = accounts[selectedEndpoint]
  const currentCredentials = credentials[selectedEndpoint]
  const tokenOptions = account?.tokens ?? []

  const endpointLabels: Record<EchoFlowEndpoint, string> = {
    main: t('echoflowApiOfficialLogin.endpointMain'),
    dedicated: t('echoflowApiOfficialLogin.endpointDedicated'),
  }

  // Filter providers by current endpoint
  const endpointBaseUrl = normalizeProviderBaseUrl(ECHOFLOW_BASE_URLS[selectedEndpoint])
  const endpointProviders = providers.filter((provider) =>
    normalizeProviderBaseUrl(provider.baseUrl) === endpointBaseUrl
  )

  useEffect(() => {
    void echoflowApi.getAccounts()
      .then(({ account: legacyAccount, accounts: loadedAccounts }) => {
        const nextAccounts = loadedAccounts ?? {
          main: legacyAccount,
          dedicated: null,
        }
        setAccounts(nextAccounts)
        onBindingChange?.(Boolean(nextAccounts.main || nextAccounts.dedicated))
        setCredentials((current) => ({
          main: {
            userId: nextAccounts.main?.userId ?? current.main.userId,
            managementToken: current.main.managementToken,
          },
          dedicated: {
            userId: nextAccounts.dedicated?.userId ?? current.dedicated.userId,
            managementToken: current.dedicated.managementToken,
          },
        }))
      })
      .catch(() => setError(t('echoflowApiOfficialLogin.loadFailed')))
  }, [onBindingChange])

  const updateCredentials = (patch: Partial<Credentials>) => {
    setCredentials((current) => ({
      ...current,
      [selectedEndpoint]: { ...current[selectedEndpoint], ...patch },
    }))
  }

  const saveAccount = async () => {
    if (!currentCredentials.userId.trim() || !currentCredentials.managementToken.trim() || isSavingAccount) return
    setIsSavingAccount(true)
    setError(null)
    try {
      const { account: savedAccount } = await echoflowApi.bindAccount(
        selectedEndpoint,
        currentCredentials.userId,
        currentCredentials.managementToken,
      )
      setAccounts((current) => ({ ...current, [selectedEndpoint]: savedAccount }))
      onBindingChange?.(true)
      setCredentials((current) => ({
        ...current,
        [selectedEndpoint]: { userId: savedAccount.userId, managementToken: '' },
      }))
      setShowCredentialEditor(false)
    } catch {
      setError(t('echoflowApiOfficialLogin.bindFailed'))
    } finally {
      setIsSavingAccount(false)
    }
  }

  const refreshAccount = async () => {
    if (isRefreshing || !account) return
    setIsRefreshing(true)
    setError(null)
    try {
      const { account: refreshedAccount } = await echoflowApi.refreshAccount(selectedEndpoint)
      setAccounts((current) => ({ ...current, [selectedEndpoint]: refreshedAccount }))
    } catch {
      setError(t('echoflowApiOfficialLogin.refreshFailed'))
    } finally {
      setIsRefreshing(false)
    }
  }

  const disconnectAccount = async () => {
    if (isDisconnecting || !account) return
    setIsDisconnecting(true)
    setError(null)
    try {
      await echoflowApi.disconnectAccount(selectedEndpoint)
      setAccounts((current) => {
        const next = { ...current, [selectedEndpoint]: null }
        onBindingChange?.(Boolean(next.main || next.dedicated))
        return next
      })
      setCredentials((current) => ({
        ...current,
        [selectedEndpoint]: { userId: '', managementToken: '' },
      }))
    } catch {
      setError(t('echoflowApiOfficialLogin.disconnectFailed'))
    } finally {
      setIsDisconnecting(false)
    }
  }

  const inputBase = 'min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none'
  const accountSummary = account
    ? `${t('echoflowApiOfficialLogin.userId')}：${account.userId}${account.username ? ` · ${account.username}` : ''}${account.balance !== undefined ? ` · ${t('echoflowApiOfficialLogin.balance')} ${formatQuota(account.balance)}` : ''} · ${account.refreshedAt ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(account.refreshedAt) : t('echoflowApiOfficialLogin.neverSynced')}`
    : t('echoflowApiOfficialLogin.neverSynced')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-lg bg-[var(--color-surface-container-low)] p-1">
        {(['main', 'dedicated'] as const).map((endpoint) => {
          const endpointAccount = accounts[endpoint]
          return (
            <button
              key={endpoint}
              type="button"
              onClick={() => {
                setSelectedEndpoint(endpoint)
                setError(null)
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs ${selectedEndpoint === endpoint ? 'bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)]'}`}
            >
              <span className={`h-2 w-2 rounded-full ${endpointAccount ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
              {endpointLabels[endpoint]}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.endpointHint')}</p>

      <div className="rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-3">
        {!account || showCredentialEditor ? (
          <div className="flex items-center gap-2">
            <input value={currentCredentials.userId} onChange={(event) => updateCredentials({ userId: event.target.value })} placeholder={t('echoflowApiOfficialLogin.userId')} className={`${inputBase} text-center`} />
            <div className="relative flex-1">
              <input type={showManagementToken ? 'text' : 'password'} value={currentCredentials.managementToken} onChange={(event) => updateCredentials({ managementToken: event.target.value })} placeholder={t('echoflowApiOfficialLogin.managementToken')} className={`${inputBase} pr-9 text-center`} />
              <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-label={showManagementToken ? t('echoflowApiOfficialLogin.hideManagementToken') : t('echoflowApiOfficialLogin.showManagementToken')}>
                {showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button type="button" onClick={() => void saveAccount()} disabled={isSavingAccount || !currentCredentials.userId.trim() || !currentCredentials.managementToken.trim()} className="shrink-0 rounded-md bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {isSavingAccount
                ? t('echoflowApiOfficialLogin.saving')
                : account
                  ? t('echoflowApiOfficialLogin.updateToken')
                  : t('echoflowApiOfficialLogin.bindAccount', { endpoint: endpointLabels[selectedEndpoint] })}
            </button>
            {account && <button type="button" onClick={() => setShowCredentialEditor(false)} className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{t('echoflowApiOfficialLogin.cancel')}</button>}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm text-[var(--color-text-secondary)]">{accountSummary}</div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setShowCredentialEditor(true)} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{t('echoflowApiOfficialLogin.updateToken')}</button>
              <button type="button" onClick={() => void refreshAccount()} disabled={isRefreshing} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />{t('echoflowApiOfficialLogin.refresh')}</button>
              <button type="button" onClick={() => void disconnectAccount()} disabled={isDisconnecting} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><Unlink className="h-4 w-4" />{t('echoflowApiOfficialLogin.unbind')}</button>
            </div>
          </div>
        )}
      </div>

      {account && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('echoflowApiOfficialLogin.callTokens')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.callTokensHint')}</div>
          </div>

          {tokenOptions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {tokenOptions.map((token) => {
                const alreadyAdded = endpointProviders.some((p) =>
                  p.credentialSource?.kind === 'echoflow-token' &&
                  p.credentialSource.endpoint === selectedEndpoint &&
                  p.credentialSource.tokenId === token.id,
                )
                return (
                  <button
                    key={token.id}
                    type="button"
                    onClick={() => {
                      if (alreadyAdded) return
                      onAddFromToken({
                        endpoint: selectedEndpoint,
                        tokenId: token.id,
                        tokenName: token.name,
                        keyPreview: token.keyPreview,
                        remainQuota: token.remainQuota,
                        unlimitedQuota: token.unlimitedQuota,
                      })
                    }}
                    disabled={alreadyAdded}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      alreadyAdded
                        ? 'cursor-not-allowed border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] opacity-50'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-sm text-[var(--color-text-primary)]">{token.name}</span>
                      <span className="shrink-0 font-mono text-xs text-[var(--color-text-tertiary)]">{token.keyPreview}</span>
                      {token.status && <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{token.status}</span>}
                      {(token.unlimitedQuota || token.remainQuota !== undefined) && <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{formatQuota(token.remainQuota, token.unlimitedQuota, t('echoflowApiOfficialLogin.unlimitedQuota'))}</span>}
                    </span>
                    {alreadyAdded ? (
                      <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.added')}</span>
                    ) : (
                      <span className="material-symbols-outlined shrink-0 text-[18px] text-[var(--color-brand)]">add_circle</span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.noTokens')}</p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
