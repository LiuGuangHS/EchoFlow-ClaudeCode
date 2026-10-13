import { useCallback, useEffect, useState } from 'react'
import { LogIn, LogOut, RefreshCw, UserRound } from 'lucide-react'
import { echoflowApi, type EchoFlowSiteAccount } from '../../api/echoflow'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'

export function EchoFlowAccountDock() {
  const t = useTranslation()
  const host = getDesktopHost()
  const [account, setAccount] = useState<EchoFlowSiteAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await echoflowApi.getSiteSession()
      setAccount(result.account)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    if (host.capabilities.echoFlowAccount) void refresh()
  }, [host.capabilities.echoFlowAccount, refresh])

  const signIn = async () => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      if (await host.echoFlow.openLogin() === 'authenticated') await refresh()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await host.echoFlow.signOut()
      setAccount(null)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  if (!host.capabilities.echoFlowAccount) return null

  return <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--color-text-primary)]">
    <UserRound className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
    {account ? <>
      <span className="min-w-0 flex-1 truncate" title={account.username}>{account.username}</span>
      <span className="shrink-0 text-xs text-[var(--color-brand)]">¥{account.balance.toFixed(2)}</span>
      <button type="button" onClick={() => void refresh()} disabled={busy} className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50" aria-label={t('echoflowAccount.refresh')} title={t('echoflowAccount.refresh')}>
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
      </button>
      <button type="button" onClick={() => void signOut()} disabled={busy} className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50" aria-label={t('echoflowAccount.signOut')} title={t('echoflowAccount.signOut')}>
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </> : <button type="button" onClick={() => void signIn()} disabled={busy} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[var(--color-brand)] disabled:opacity-50">
      <span className="min-w-0 flex-1 truncate">{error ? t('echoflowAccount.loadFailed') : t('echoflowAccount.signIn')}</span>
      <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>}
  </div>
}
