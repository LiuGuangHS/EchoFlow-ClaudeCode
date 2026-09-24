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
import type { SavedProvider } from '../../types/provider'
import { normalizeProviderBaseUrl } from '../../config/providerPresets'


type Props = {
  onAddFromToken: (source: EchoFlowTokenSource) => void
  onBindingChange?: (hasAccount: boolean) => void
  onEditProvider?: (provider: SavedProvider) => void
}

type Credentials = {
  userId: string
  managementToken: string
}

type Accounts = Record<EchoFlowEndpoint, EchoFlowAccount | null>

const EMPTY_ACCOUNTS: Accounts = { main: null, dedicated: null }
const ENDPOINT_LABELS: Record<EchoFlowEndpoint, string> = {
  main: '主站',
  dedicated: '专线',
}
const ENDPOINT_SHORT_LABELS: Record<EchoFlowEndpoint, string> = {
  main: '主站',
  dedicated: '专线'
}

function formatRefreshedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
}

function formatQuota(remainQuota?: number, unlimitedQuota?: boolean): string {
  if (unlimitedQuota) return '无限额度'
  if (remainQuota !== undefined) {
    return `¥${remainQuota.toFixed(2)}`
  }
  return ''
}

export function EchoFlowAPIOfficialLogin({ onAddFromToken, onBindingChange, onEditProvider }: Props) {
  const { providers, activeId } = useProviderStore()
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

  // Filter providers by current endpoint
  const endpointBaseUrl = normalizeProviderBaseUrl(ECHOFLOW_BASE_URLS[selectedEndpoint])
  const endpointProviders = providers.filter((provider) =>
    normalizeProviderBaseUrl(provider.baseUrl) === endpointBaseUrl
  )

  // Get all EchoFlow providers (for showing default across endpoints)
  const allEchoFlowProviders = providers.filter((provider) => {
    const normalized = normalizeProviderBaseUrl(provider.baseUrl)
    return Object.values(ECHOFLOW_BASE_URLS).some(url => normalizeProviderBaseUrl(url) === normalized)
  })

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
      .catch(() => setError('无法读取 EchoFlow 账户信息。'))
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
      setError('账户绑定失败，请检查当前线路的用户 ID 和系统访问令牌。')
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
      setError('刷新失败，请更新当前线路的系统访问令牌后重试。')
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
      setError('解除当前线路账户失败。')
    } finally {
      setIsDisconnecting(false)
    }
  }

  const inputBase = 'min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none'
  const accountSummary = account
    ? `用户 ID：${account.userId}${account.username ? ` · ${account.username}` : ''}${account.balance !== undefined ? ` · 余额 ${formatQuota(account.balance)}` : ''} · ${account.refreshedAt ? formatRefreshedAt(account.refreshedAt) : '尚未同步'}`
    : '尚未同步'

  // Find active provider across all EchoFlow endpoints
  const activeProvider = allEchoFlowProviders.find((p) => p.id === activeId)
  const hasActiveProvider = Boolean(activeProvider)

  return (
    <div className="flex flex-col gap-3">
      {hasActiveProvider && activeProvider && (
        <div className="rounded-lg border border-[var(--color-primary-fixed-dim)] bg-[var(--color-surface-container-low)] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-success)]" />
              <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{activeProvider.name}</span>
              {(activeProvider.keyPreview || activeProvider.apiKey) && (
                <span className="shrink-0 font-mono text-xs text-[var(--color-text-tertiary)]">
                  {activeProvider.keyPreview || activeProvider.apiKey}
                </span>
              )}
              <span className="shrink-0 rounded border border-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand)]">默认</span>
              <span className="shrink-0 rounded bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">官方</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onEditProvider?.(activeProvider)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-secondary)]"
                aria-label="配置"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
              {ENDPOINT_LABELS[endpoint]}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">主站和专线可以同时绑定；这里切换的是查看和管理的线路，不会断开另一条线路。</p>

      <div className="rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-3">
        {!account || showCredentialEditor ? (
          <div className="flex items-center gap-2">
            <input value={currentCredentials.userId} onChange={(event) => updateCredentials({ userId: event.target.value })} placeholder="用户 ID" className={`${inputBase} text-center`} />
            <div className="relative flex-1">
              <input type={showManagementToken ? 'text' : 'password'} value={currentCredentials.managementToken} onChange={(event) => updateCredentials({ managementToken: event.target.value })} placeholder="系统访问令牌" className={`${inputBase} pr-9 text-center`} />
              <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-label={showManagementToken ? '隐藏系统访问令牌' : '显示系统访问令牌'}>
                {showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button type="button" onClick={() => void saveAccount()} disabled={isSavingAccount || !currentCredentials.userId.trim() || !currentCredentials.managementToken.trim()} className="shrink-0 rounded-md bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {isSavingAccount ? '保存中...' : account ? '更新令牌' : `绑定${ENDPOINT_SHORT_LABELS[selectedEndpoint]}账户`}
            </button>
            {account && <button type="button" onClick={() => setShowCredentialEditor(false)} className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">取消</button>}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm text-[var(--color-text-secondary)]">{accountSummary}</div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setShowCredentialEditor(true)} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">更新令牌</button>
              <button type="button" onClick={() => void refreshAccount()} disabled={isRefreshing} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />刷新</button>
              <button type="button" onClick={() => void disconnectAccount()} disabled={isDisconnecting} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><Unlink className="h-4 w-4" />解绑</button>
            </div>
          </div>
        )}
      </div>

      {account && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">调用令牌</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">选择令牌后即可添加到模型配置，真实密钥不会显示在界面</div>
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
                      {(token.unlimitedQuota || token.remainQuota !== undefined) && <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{formatQuota(token.remainQuota, token.unlimitedQuota)}</span>}
                    </span>
                    {alreadyAdded ? (
                      <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">已添加</span>
                    ) : (
                      <span className="material-symbols-outlined shrink-0 text-[18px] text-[var(--color-brand)]">add_circle</span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)]">当前账户没有可用的 API Key，请先在 EchoFlow 控制台创建。</p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
