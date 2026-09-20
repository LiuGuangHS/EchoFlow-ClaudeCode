import { useEffect, useState } from 'react'
import { Eye, EyeOff, ExternalLink, Plus, RefreshCw, Unlink } from 'lucide-react'
import {
  ECHOFLOW_BASE_URLS,
  echoflowApi,
  type EchoFlowAccount,
  type EchoFlowEndpoint,
  type EchoFlowTokenSource,
} from '../../api/echoflow'
import { getDesktopHost } from '../../lib/desktopHost'

const ECHOFLOW_CONSOLE_URL = 'https://api.echoflowai.cc/console/personal'

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
const ENDPOINT_LABELS: Record<EchoFlowEndpoint, string> = { main: '主站', dedicated: '专线' }

function formatRefreshedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
}

export function EchoFlowAPIOfficialLogin({ onAddFromToken, onBindingChange }: Props) {
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
  const [error, setError] = useState<string | null>(null)

  const account = accounts[selectedEndpoint]
  const currentCredentials = credentials[selectedEndpoint]
  const tokenOptions = account?.tokens ?? []

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
      setAccounts((current) => ({ ...current, [selectedEndpoint]: null }))
      onBindingChange?.(Boolean(accounts[selectedEndpoint === 'main' ? 'dedicated' : 'main']))
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

  const openConsole = async () => {
    try {
      await getDesktopHost().shell.open(ECHOFLOW_CONSOLE_URL)
    } catch {
      window.open(ECHOFLOW_CONSOLE_URL, '_blank', 'noopener,noreferrer')
    }
  }

  const inputBase = 'min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none'
  const accountSummary = account?.balance === undefined
    ? '尚未同步'
    : `余额：¥${account.balance.toFixed(2)} · ${account.userGroup ?? 'default'} · ${account.refreshedAt ? formatRefreshedAt(account.refreshedAt) : '尚未同步'}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-secondary)]">分别绑定主站和专线账户，选择 API Key 后配置为下方独立渠道。</p>
        <button type="button" onClick={() => void openConsole()} className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />前往 EchoFlow 控制台
        </button>
      </div>

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
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${selectedEndpoint === endpoint ? 'bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)]'}`}
            >
              <span className={`h-2 w-2 rounded-full ${endpointAccount ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
              {ENDPOINT_LABELS[endpoint]}
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{ENDPOINT_LABELS[selectedEndpoint]}账户</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{ECHOFLOW_BASE_URLS[selectedEndpoint]}</div>
          </div>
          {account && <div className="text-xs text-[var(--color-text-secondary)]">{accountSummary}</div>}
        </div>

        {!account ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <input value={currentCredentials.userId} onChange={(event) => updateCredentials({ userId: event.target.value })} placeholder="用户 ID" className={inputBase} />
              <div className="relative">
                <input type={showManagementToken ? 'text' : 'password'} value={currentCredentials.managementToken} onChange={(event) => updateCredentials({ managementToken: event.target.value })} placeholder="系统访问令牌" className={`${inputBase} pr-9`} />
                <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-label={showManagementToken ? '隐藏系统访问令牌' : '显示系统访问令牌'}>
                  {showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button type="button" onClick={() => void saveAccount()} disabled={isSavingAccount || !currentCredentials.userId.trim() || !currentCredentials.managementToken.trim()} className="w-fit rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {isSavingAccount ? '绑定中...' : `绑定${ENDPOINT_LABELS[selectedEndpoint]}账户`}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-text-secondary)]">
              <span>用户 ID：{account.userId}</span>
              <span>{account.username || '已绑定'}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <input type={showManagementToken ? 'text' : 'password'} value={currentCredentials.managementToken} onChange={(event) => updateCredentials({ managementToken: event.target.value })} placeholder="更新系统访问令牌" className={`${inputBase} pr-9`} />
                <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-label={showManagementToken ? '隐藏系统访问令牌' : '显示系统访问令牌'}>
                  {showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button type="button" onClick={() => void saveAccount()} disabled={isSavingAccount || !currentCredentials.managementToken.trim()} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] disabled:opacity-50">{isSavingAccount ? '更新中...' : '更新令牌'}</button>
              <button type="button" onClick={() => void refreshAccount()} disabled={isRefreshing} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />刷新</button>
              <button type="button" onClick={() => void disconnectAccount()} disabled={isDisconnecting} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><Unlink className="h-4 w-4" />解绑</button>
            </div>
          </div>
        )}
      </div>

      {account && (
        <div className="rounded-lg border border-[var(--color-border-separator)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-[var(--color-text-primary)]">选择 API Key 并配置渠道</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">选择后打开统一详细配置面板，保存时才会新增下方渠道。</div>
            </div>
            <Plus className="h-4 w-4 text-[var(--color-text-tertiary)]" />
          </div>
          <select
            value=""
            onChange={(event) => {
              const token = tokenOptions.find((candidate) => candidate.id === event.target.value)
              if (!token) return
              onAddFromToken({
                endpoint: selectedEndpoint,
                tokenId: token.id,
                tokenName: token.name,
                keyPreview: token.keyPreview,
              })
            }}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">选择 {ENDPOINT_LABELS[selectedEndpoint]} API Key…</option>
            {tokenOptions.map((token) => <option key={token.id} value={token.id}>{token.name} · {token.keyPreview}</option>)}
          </select>
          {tokenOptions.length === 0 && <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">当前账户没有可用的 API Key，请先在 EchoFlow 控制台创建。</p>}
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
