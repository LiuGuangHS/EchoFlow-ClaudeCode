import { useEffect, useState } from 'react'
import { Eye, EyeOff, RefreshCw, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
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

  const accountSummary = account
    ? `${t('echoflowApiOfficialLogin.userId')}：${account.userId}${account.username ? ` · ${account.username}` : ''}${account.balance !== undefined ? ` · ${t('echoflowApiOfficialLogin.balance')} ${formatQuota(account.balance)}` : ''} · ${account.refreshedAt ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(account.refreshedAt) : t('echoflowApiOfficialLogin.neverSynced')}`
    : t('echoflowApiOfficialLogin.neverSynced')

  const endpointSegments = (['main', 'dedicated'] as const).map((endpoint) => ({
    value: endpoint,
    label: (
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${accounts[endpoint] ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`}
          aria-hidden="true"
        />
        {endpointLabels[endpoint]}
      </span>
    ),
  }))

  return (
    <div className="flex flex-col gap-3">
      {/* `tablist`, not the default `radiogroup`: switching endpoints swaps the
          whole panel below it — summary, credential fields, and token list are
          per-endpoint — so a screen reader should announce a tab with a
          panel, not a selected value in a set. */}
      <SegmentedControl
        items={endpointSegments}
        value={selectedEndpoint}
        onChange={(endpoint) => {
          setSelectedEndpoint(endpoint)
          setError(null)
        }}
        label={t('echoflowApiOfficialLogin.endpointSwitch')}
        as="tablist"
        appearance="raised"
        size="sm"
        layout="fill"
      />
      <p className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.endpointHint')}</p>

      {!account || showCredentialEditor ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={currentCredentials.userId} onChange={(event) => updateCredentials({ userId: event.target.value })} placeholder={t('echoflowApiOfficialLogin.userId')} aria-label={t('echoflowApiOfficialLogin.userId')} className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none" />
          <div className="relative min-w-0 flex-1">
            <input type={showManagementToken ? 'text' : 'password'} value={currentCredentials.managementToken} onChange={(event) => updateCredentials({ managementToken: event.target.value })} placeholder={t('echoflowApiOfficialLogin.managementToken')} aria-label={t('echoflowApiOfficialLogin.managementToken')} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pr-10 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none" />
            <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]" aria-label={showManagementToken ? t('echoflowApiOfficialLogin.hideManagementToken') : t('echoflowApiOfficialLogin.showManagementToken')}>
              {showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {/* The primitive's DISABLED_FILL keeps the label legible on a solid
              ink button; `disabled:opacity-50` washed both out to 2.34:1. */}
          <Button
            variant="primary"
            size="md"
            className="shrink-0"
            onClick={() => void saveAccount()}
            loading={isSavingAccount}
            disabled={isSavingAccount || !currentCredentials.userId.trim() || !currentCredentials.managementToken.trim()}
          >
            {account ? t('echoflowApiOfficialLogin.updateToken') : t('echoflowApiOfficialLogin.bindAccount', { endpoint: endpointLabels[selectedEndpoint] })}
          </Button>
          {account && (
            <Button variant="secondary" size="md" className="shrink-0" onClick={() => setShowCredentialEditor(false)}>
              {t('echoflowApiOfficialLogin.cancel')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 text-sm text-[var(--color-text-secondary)]">{accountSummary}</div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowCredentialEditor(true)}>
              {t('echoflowApiOfficialLogin.updateToken')}
            </Button>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refreshAccount()} loading={isRefreshing}>
              {t('echoflowApiOfficialLogin.refresh')}
            </Button>
            <Button variant="secondary" size="sm" icon={<Unlink className="h-4 w-4" />} onClick={() => void disconnectAccount()} loading={isDisconnecting}>
              {t('echoflowApiOfficialLogin.unbind')}
            </Button>
          </div>
        </div>
      )}

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
                    className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
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

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[13px] text-[var(--color-on-error-container)]"
        >
          {error}
        </p>
      )}
    </div>
  )
}
