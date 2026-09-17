import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, ExternalLink, Plus, RefreshCw, Settings, Trash2, Unlink } from 'lucide-react'
import { echoflowApi, type EchoFlowAccount, type EchoFlowEndpoint } from '../../api/echoflow'
import { getDesktopHost } from '../../lib/desktopHost'
import { useProviderStore } from '../../stores/providerStore'
import type { SavedProvider } from '../../types/provider'

const ECHOFLOW_BASE_URLS = {
  main: 'https://api.echoflowai.cc',
  dedicated: 'https://expapi.echoflowai.cc',
}
const ECHOFLOW_CONSOLE_URL = 'https://api.echoflowai.cc/console/personal'
const ECHOFLOW_PRESET_ID = 'echoflowai'
const DEFAULT_MODELS = {
  main: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

type Props = {
  activeId: string | null
  providers: SavedProvider[]
  onEdit: (provider: SavedProvider) => void
}

function formatRefreshedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
}

export function EchoFlowAPIOfficialLogin({ activeId, providers, onEdit }: Props) {
  const { createProvider, updateProvider, deleteProvider, activateProvider, fetchProviders } = useProviderStore()
  const echoflowProviders = useMemo(
    () => providers.filter((provider) => provider.presetId === ECHOFLOW_PRESET_ID),
    [providers],
  )
  const [account, setAccount] = useState<EchoFlowAccount | null>(null)
  const [userId, setUserId] = useState('')
  const [managementToken, setManagementToken] = useState('')
  const [selectedEndpoint, setSelectedEndpoint] = useState<EchoFlowEndpoint>('main')
  const [showManagementToken, setShowManagementToken] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [keyValues, setKeyValues] = useState<Record<string, string>>({})
  const [draftKeys, setDraftKeys] = useState<string[]>(['draft-0'])
  const draftIdRef = useRef(1)
  const [isSavingAccount, setIsSavingAccount] = useState(false)
  const [isUpdatingAccount, setIsUpdatingAccount] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSavingKey, setIsSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void echoflowApi.getAccount()
      .then(({ account }) => {
        setAccount(account)
        setUserId(account?.userId ?? '')
        setSelectedEndpoint(account?.endpoint ?? 'main')
      })
      .catch(() => setError('无法读取 EchoFlow 账户信息。'))
  }, [])

  const setKeyValue = (id: string, value: string) => {
    setKeyValues((current) => ({ ...current, [id]: value }))
  }

  const getKeyValue = (provider: SavedProvider) => keyValues[provider.id] ?? provider.apiKey

  const saveAccount = async () => {
    if (!userId.trim() || !managementToken.trim() || isSavingAccount) return
    setIsSavingAccount(true)
    setError(null)
    try {
      const { account } = await echoflowApi.bindAccount(userId, managementToken, selectedEndpoint)
      setAccount(account)
      setManagementToken('')
    } catch {
      setError('账户绑定失败，请检查用户 ID 和系统访问令牌。')
    } finally {
      setIsSavingAccount(false)
    }
  }

  const updateAccountToken = async () => {
    if (!userId.trim() || !managementToken.trim() || isUpdatingAccount) return
    setIsUpdatingAccount(true)
    setError(null)
    try {
      const { account } = await echoflowApi.bindAccount(userId, managementToken, selectedEndpoint)
      setAccount(account)
      setManagementToken('')
    } catch {
      setError('更新系统访问令牌失败。')
    } finally {
      setIsUpdatingAccount(false)
    }
  }

  const updateEndpoint = async (endpoint: EchoFlowEndpoint) => {
    setError(null)
    try {
      const { account } = await echoflowApi.updateEndpoint(endpoint)
      setAccount(account)
      setSelectedEndpoint(endpoint)
    } catch {
      setError('切换线路失败。')
    }
  }

  const refreshAccount = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setError(null)
    try {
      const { account } = await echoflowApi.refreshAccount()
      setAccount(account)
    } catch {
      setError('刷新失败，请更新系统访问令牌后重试。')
    } finally {
      setIsRefreshing(false)
    }
  }

  const disconnectAccount = async () => {
    try {
      await echoflowApi.disconnectAccount()
      setAccount(null)
      setUserId('')
      setManagementToken('')
    } catch {
      setError('解除账户失败。')
    }
  }

  const activate = async (provider: SavedProvider) => {
    setIsSavingKey(provider.id)
    try {
      await activateProvider(provider.id)
      await fetchProviders()
    } catch {
      setError('启用 EchoFlow API Key 失败。')
    } finally {
      setIsSavingKey(null)
    }
  }

  const saveProviderKey = async (provider: SavedProvider) => {
    const apiKey = getKeyValue(provider).trim()
    if (!apiKey || isSavingKey) return
    setIsSavingKey(provider.id)
    try {
      await updateProvider(provider.id, { apiKey })
      await fetchProviders()
    } catch {
      setError('保存 API Key 失败。')
    } finally {
      setIsSavingKey(null)
    }
  }

  const saveDraft = async (draftId: string, shouldActivate: boolean) => {
    const apiKey = (keyValues[draftId] ?? '').trim()
    if (!apiKey || isSavingKey) return
    setIsSavingKey(draftId)
    try {
      const baseUrl = account?.endpoint ? ECHOFLOW_BASE_URLS[account.endpoint] : ECHOFLOW_BASE_URLS.main
      const provider = await createProvider({
        presetId: ECHOFLOW_PRESET_ID,
        name: `EchoFlow API #${echoflowProviders.length + 1}`,
        baseUrl,
        apiKey,
        apiFormat: 'anthropic',
        authStrategy: 'auth_token',
        models: DEFAULT_MODELS,
      })
      if (shouldActivate) await activateProvider(provider.id)
      setDraftKeys((current) => current.filter((id) => id !== draftId))
      setKeyValues((current) => {
        const { [draftId]: _draft, ...rest } = current
        return rest
      })
      await fetchProviders()
    } catch {
      setError('保存 EchoFlow API Key 失败。')
    } finally {
      setIsSavingKey(null)
    }
  }

  const addDraft = () => {
    const draftId = `draft-${draftIdRef.current}`
    draftIdRef.current += 1
    setDraftKeys((current) => [...current, draftId])
  }

  const removeProvider = async (provider: SavedProvider) => {
    if (provider.id === activeId) {
      setError('请先启用其他服务商，再删除当前 EchoFlow API Key。')
      return
    }
    try {
      await deleteProvider(provider.id)
      await fetchProviders()
    } catch {
      setError('删除 EchoFlow API Key 失败。')
    }
  }

  const selectAccountKey = async (tokenId: string, rowId: string, provider?: SavedProvider) => {
    if (!tokenId || isSavingKey) return
    setIsSavingKey(rowId)
    try {
      const { provider: selectedProvider } = await echoflowApi.selectToken(tokenId, provider?.id)
      if (!provider && echoflowProviders.length === 0) await activateProvider(selectedProvider.id)
      if (!provider) setDraftKeys((current) => current.filter((id) => id !== rowId))
      await fetchProviders()
    } catch {
      setError('选择账户 API Key 失败。')
    } finally {
      setIsSavingKey(null)
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
  const tokenOptions = account?.tokens ?? []
  const currentEndpoint = account?.endpoint ?? 'main'
  const accountSummary = account?.balance === undefined
    ? '尚未同步'
    : `余额：¥${account.balance.toFixed(2)} · ${account.userGroup ?? 'default'} · ${account.refreshedAt ? formatRefreshedAt(account.refreshedAt) : '尚未同步'}`

  const renderKeyRow = (id: string, provider?: SavedProvider) => {
    const key = provider ? getKeyValue(provider) : keyValues[id] ?? ''
    const isActive = provider?.id === activeId
    const isSaving = isSavingKey === id
    return (
      <div key={id} className="flex flex-col gap-2 rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="font-medium text-[var(--color-text-primary)]">{provider?.name ?? '新的 EchoFlow API 配置'}</span>
          {isActive && <span className="text-[var(--color-success)]">● 当前使用</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex min-w-[220px] flex-1">
            <input
              type={showKeys[id] ? 'text' : 'password'}
              value={key}
              onChange={(event) => setKeyValue(id, event.target.value)}
              placeholder="粘贴 API Key"
              className={`${inputBase} pr-9`}
            />
            <button
              type="button"
              onClick={() => setShowKeys((current) => ({ ...current, [id]: !current[id] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              aria-label={showKeys[id] ? '隐藏 API Key' : '显示 API Key'}
            >
              {showKeys[id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {account && (
            <select
              value=""
              onChange={(event) => {
                if (event.target.value) void selectAccountKey(event.target.value, id, provider)
              }}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">选择账户 API Key</option>
              {tokenOptions.map((token) => (
                <option key={token.id} value={token.id}>
                  {token.name} · {token.keyPreview}
                </option>
              ))}
            </select>
          )}
          {provider ? (
            <>
              <button type="button" onClick={() => void saveProviderKey(provider)} disabled={isSaving || !key.trim()} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] disabled:opacity-50">保存</button>
              <button type="button" onClick={() => void activate(provider)} disabled={isSaving || isActive} className="rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{isActive ? '已启用' : '启用'}</button>
              <button type="button" onClick={() => onEdit(provider)} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><Settings className="h-4 w-4" />详细配置</button>
              {!isActive && <button type="button" onClick={() => void removeProvider(provider)} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[var(--color-error)]"><Trash2 className="h-4 w-4" /></button>}
            </>
          ) : (
            <button type="button" onClick={() => void saveDraft(id, echoflowProviders.length === 0)} disabled={isSaving || !key.trim()} className="rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{echoflowProviders.length === 0 ? '保存并启用' : '保存'}</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-secondary)]">在控制台生成并输入 API Key 后即可使用 EchoFlow 模型。</p>
        <button type="button" onClick={() => void openConsole()} className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"><ExternalLink className="h-3.5 w-3.5" />前往 EchoFlow API</button>
      </div>

      <div className="flex flex-col gap-2">
        {echoflowProviders.map((provider) => renderKeyRow(provider.id, provider))}
        {draftKeys.map((id) => renderKeyRow(id))}
        <button type="button" onClick={addDraft} className="inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><Plus className="h-4 w-4" />添加 API Key</button>
      </div>

      <div className="border-t border-[var(--color-border-separator)] pt-4">
        <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">绑定 EchoFlow 账户，直接选择 API Key</div>
        <p className="mb-3 text-xs text-[var(--color-text-secondary)]">绑定后可同步余额和已有 API Key；也可以继续手动粘贴 API Key。</p>
        {!account ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="用户 ID" className={inputBase} />
              <div className="relative">
                <input type={showManagementToken ? 'text' : 'password'} value={managementToken} onChange={(event) => setManagementToken(event.target.value)} placeholder="系统访问令牌" className={`${inputBase} pr-9`} />
                <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">{showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-text-secondary)]">接入线路：</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEndpoint('main')}
                  className={`rounded-md px-3 py-1.5 text-sm ${selectedEndpoint === 'main' ? 'bg-[var(--color-brand)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                >
                  主站
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEndpoint('dedicated')}
                  className={`rounded-md px-3 py-1.5 text-sm ${selectedEndpoint === 'dedicated' ? 'bg-[var(--color-brand)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                >
                  专线
                </button>
              </div>
            </div>
            <button type="button" onClick={() => void saveAccount()} disabled={isSavingAccount || !userId.trim() || !managementToken.trim()} className="w-fit rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{isSavingAccount ? '绑定中...' : '绑定账户'}</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-[var(--color-surface-container-low)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>账户：{account.userId}</span><span>{accountSummary}</span></div>
            <div className="flex items-center gap-2 border-b border-[var(--color-border-separator)] pb-2">
              <span className="text-[var(--color-text-secondary)]">接入线路：</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void updateEndpoint('main')}
                  className={`rounded-md px-3 py-1.5 text-sm ${currentEndpoint === 'main' ? 'bg-[var(--color-brand)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                >
                  主站
                </button>
                <button
                  type="button"
                  onClick={() => void updateEndpoint('dedicated')}
                  className={`rounded-md px-3 py-1.5 text-sm ${currentEndpoint === 'dedicated' ? 'bg-[var(--color-brand)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                >
                  专线
                </button>
              </div>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {currentEndpoint === 'main' ? ECHOFLOW_BASE_URLS.main : ECHOFLOW_BASE_URLS.dedicated}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <input type={showManagementToken ? 'text' : 'password'} value={managementToken} onChange={(event) => setManagementToken(event.target.value)} placeholder="更新系统访问令牌" className={`${inputBase} pr-9`} />
                <button type="button" onClick={() => setShowManagementToken((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">{showManagementToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <button type="button" onClick={() => void updateAccountToken()} disabled={isUpdatingAccount || !managementToken.trim()} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] disabled:opacity-50">{isUpdatingAccount ? '更新中...' : '更新令牌'}</button>
              <button type="button" onClick={() => void refreshAccount()} disabled={isRefreshing} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />刷新账户与 API Key</button>
              <button type="button" onClick={() => void disconnectAccount()} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"><Unlink className="h-4 w-4" />解除绑定</button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
