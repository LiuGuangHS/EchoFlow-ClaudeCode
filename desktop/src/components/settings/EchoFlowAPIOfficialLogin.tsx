import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CirclePlus, ExternalLink, Eye, EyeOff, Plus, RefreshCw, Unlink } from 'lucide-react'
import { SettingsPageHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Spinner } from '@/components/ui/Spinner'
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
import { getDesktopHost } from '@/lib/desktopHost'
import type { PreviewBounds } from '@/lib/desktopHost/types'
import { ApiError } from '../../api/client'


type Props = {
  onAddFromToken: (source: EchoFlowTokenSource) => void
  onBindingChange?: (hasAccount: boolean) => void
  loginPaneHost?: RefObject<HTMLDivElement>
  onLoginActive?: (active: boolean) => void
}

type LoginAttempt = {
  id: string
  endpoint: EchoFlowEndpoint
  run: (bounds: PreviewBounds | null) => Promise<void>
}

const APP_OVERLAYS = [
  '[aria-modal="true"]',
  ...[
    'var(--z-scrim)', 'var(--z-drawer)', 'var(--z-dialog)', 'var(--z-sheet)',
    'var(--z-dropdown)', 'var(--z-popover)', 'var(--z-tooltip)', 'var(--z-toast)',
  ].flatMap((layer) => [`[class*="z-[${layer}]"]`, `[style*="${layer}"]`]),
].join(',')

function readLoginBounds(placeholder: HTMLElement): PreviewBounds | null {
  const rect = placeholder.getBoundingClientRect()
  if (document.hidden || !rect.width || !rect.height || placeholder.closest('[hidden], [inert]')) return null

  // The native view always paints above the renderer, even above DOM overlays.
  for (const overlay of document.querySelectorAll(APP_OVERLAYS)) {
    if (overlay.contains(placeholder) || window.getComputedStyle(overlay).visibility === 'hidden') continue
    const other = overlay.getBoundingClientRect()
    if (other.width && other.height && other.left < rect.right && other.right > rect.left &&
        other.top < rect.bottom && other.bottom > rect.top) return null
  }

  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

type Credentials = {
  userId: string
  managementToken: string
}

type Accounts = Record<EchoFlowEndpoint, EchoFlowAccount | null>

const EMPTY_ACCOUNTS: Accounts = { main: null, dedicated: null }

// The gateway says why it refused; a bare "failed" leaves the user guessing.
function withReason(message: string, caught: unknown): string {
  if (!(caught instanceof ApiError) || !caught.message || /^API error \d+$/.test(caught.message)) return message
  return `${message} — ${caught.message}`
}

function formatQuota(remainQuota?: number, unlimitedQuota?: boolean, unlimitedLabel = ''): string {
  if (unlimitedQuota) return unlimitedLabel
  if (remainQuota !== undefined) {
    return `¥${remainQuota.toFixed(2)}`
  }
  return ''
}

export function EchoFlowAPIOfficialLogin({ onAddFromToken, onBindingChange, loginPaneHost, onLoginActive }: Props) {
  const t = useTranslation()
  const loginTitleId = useId()
  const [login, setLogin] = useState<LoginAttempt | null>(null)
  const activeLoginId = useRef<string | null>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const signInButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const restoreSignInFocus = useRef(false)
  const { providers } = useProviderStore()
  const [accounts, setAccounts] = useState<Accounts>(EMPTY_ACCOUNTS)
  const accountVersions = useRef<Record<EchoFlowEndpoint, number>>({ main: 0, dedicated: 0 })
  const loadAccounts = useRef<(() => Promise<void>) | null>(null)
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
  const [notice, setNotice] = useState<string | null>(null)
  const [isCreatingToken, setIsCreatingToken] = useState(false)

  const account = accounts[selectedEndpoint]
  const currentCredentials = credentials[selectedEndpoint]
  const tokenOptions = account?.tokens ?? []
  const canSignIn = getDesktopHost().capabilities.echoFlowAccount

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
    let active = true
    let loadSeq = 0
    const load = () => {
      // The restore refetch can overlap the initial read; only the newest read
      // may write state or a late first response would undo the signed-in card.
      const seq = ++loadSeq
      const versions = { ...accountVersions.current }
      return echoflowApi.getAccounts()
        .then(({ account: legacyAccount, accounts: loadedAccounts }) => {
          if (!active || seq !== loadSeq) return
          const nextAccounts = loadedAccounts ?? {
            main: legacyAccount,
            dedicated: null,
          }
          const mainUnchanged = versions.main === accountVersions.current.main
          const dedicatedUnchanged = versions.dedicated === accountVersions.current.dedicated
          setAccounts((current) => ({
            main: mainUnchanged ? nextAccounts.main : current.main,
            dedicated: dedicatedUnchanged ? nextAccounts.dedicated : current.dedicated,
          }))
          setCredentials((current) => ({
            main: {
              userId: (mainUnchanged && nextAccounts.main?.userId) || current.main.userId,
              managementToken: current.main.managementToken,
            },
            dedicated: {
              userId: (dedicatedUnchanged && nextAccounts.dedicated?.userId) || current.dedicated.userId,
              managementToken: current.dedicated.managementToken,
            },
          }))
        })
        .catch(() => {
          if (active && seq === loadSeq) setError(t('echoflowApiOfficialLogin.loadFailed'))
        })
    }
    loadAccounts.current = load
    void load()
    // A restore or a login from the previous mount can still be committing.
    void getDesktopHost().echoFlow.whenAccountRestored()
      .then((changed) => {
        if (active && changed) void load()
      })
      .catch(() => {})
    return () => {
      active = false
      loadAccounts.current = null
    }
  }, [])

  useEffect(() => {
    onBindingChange?.(Boolean(accounts.main || accounts.dedicated))
  }, [accounts, onBindingChange])

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
      accountVersions.current[selectedEndpoint]++
      setAccounts((current) => ({ ...current, [selectedEndpoint]: savedAccount }))
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

  const signIn = () => {
    if (activeLoginId.current) return
    const endpoint = selectedEndpoint
    const id = crypto.randomUUID()
    activeLoginId.current = id
    restoreSignInFocus.current = true
    setError(null)
    onLoginActive?.(true)
    setLogin({ id, endpoint, run: async (bounds) => {
      try {
        const outcome = await getDesktopHost().echoFlow.openLogin(endpoint, id, bounds)
        if (outcome === 'cancelled') return
        if (activeLoginId.current !== id) {
          void loadAccounts.current?.()
        } else if (outcome === 'authenticated') {
          const { account: signedIn } = await echoflowApi.refreshAccount(endpoint)
          if (activeLoginId.current !== id) {
            void loadAccounts.current?.()
            return
          }
          accountVersions.current[endpoint]++
          setAccounts((current) => ({ ...current, [endpoint]: signedIn }))
        } else {
          void loadAccounts.current?.()
          setError(t('echoflowApiOfficialLogin.signInFailed'))
        }
      } catch {
        void loadAccounts.current?.()
        if (activeLoginId.current === id) setError(t('echoflowApiOfficialLogin.signInFailed'))
      } finally {
        if (activeLoginId.current === id) {
          activeLoginId.current = null
          onLoginActive?.(false)
          setLogin(null)
        }
      }
    } })
  }

  const cancelLogin = () => {
    const id = activeLoginId.current
    if (!id) return
    activeLoginId.current = null
    void getDesktopHost().echoFlow.cancelLogin(id).catch(() => {})
    onLoginActive?.(false)
    setLogin(null)
  }

  useLayoutEffect(() => {
    const placeholder = placeholderRef.current
    if (!login || !placeholder) {
      if (restoreSignInFocus.current) signInButtonRef.current?.focus({ preventScroll: true })
      restoreSignInFocus.current = false
      return
    }

    cancelButtonRef.current?.focus({ preventScroll: true })
    const host = getDesktopHost().echoFlow
    let bounds = readLoginBounds(placeholder)
    void login.run(bounds)

    const update = () => {
      if (activeLoginId.current !== login.id) return
      const next = readLoginBounds(placeholder)
      if (next?.x === bounds?.x && next?.y === bounds?.y && next?.width === bounds?.width && next?.height === bounds?.height) return
      bounds = next
      void host.setLoginBounds(login.id, next).catch(() => {})
    }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(placeholder)
    const overlays = new MutationObserver(update)
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-modal'] })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('visibilitychange', update)
    document.addEventListener('transitionend', update)
    return () => {
      resize?.disconnect()
      overlays.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('visibilitychange', update)
      document.removeEventListener('transitionend', update)
      if (activeLoginId.current === login.id) {
        activeLoginId.current = null
        void host.cancelLogin(login.id).catch(() => {})
        onLoginActive?.(false)
      }
    }
  }, [login, onLoginActive])

  const refreshAccount = async () => {
    if (isRefreshing || !account) return
    setIsRefreshing(true)
    setError(null)
    try {
      const { account: refreshedAccount } = await echoflowApi.refreshAccount(selectedEndpoint)
      accountVersions.current[selectedEndpoint]++
      setAccounts((current) => ({ ...current, [selectedEndpoint]: refreshedAccount }))
    } catch (caught) {
      setError(withReason(t('echoflowApiOfficialLogin.refreshFailed'), caught))
      // The server drops a credential the site rejected, so re-read the list:
      // a now-dead account stops looking live and the sign-in button returns.
      await echoflowApi.getAccounts()
        .then(({ account: legacyAccount, accounts: loaded }) => {
          setAccounts(loaded ?? { main: legacyAccount, dedicated: null })
        })
        .catch(() => {})
    } finally {
      setIsRefreshing(false)
    }
  }

  const disconnectAccount = async () => {
    if (isDisconnecting || !account) return
    setIsDisconnecting(true)
    setError(null)
    try {
      // In Electron only the host can drop the partition cookies; without that
      // the next rehydrate would silently sign the user back in.
      if (canSignIn) {
        await getDesktopHost().echoFlow.signOut(selectedEndpoint)
      } else {
        await echoflowApi.disconnectAccount(selectedEndpoint)
      }
      accountVersions.current[selectedEndpoint]++
      setAccounts((current) => ({ ...current, [selectedEndpoint]: null }))
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

  // The site console creates tokens with unlimited quota and no expiry, so a
  // user who never opened the console still gets a usable key here.
  const createToken = async () => {
    if (isCreatingToken || !account) return
    setIsCreatingToken(true)
    setError(null)
    setNotice(null)
    try {
      const { account: refreshed } = await echoflowApi.createToken(selectedEndpoint)
      accountVersions.current[selectedEndpoint]++
      setAccounts((current) => ({ ...current, [selectedEndpoint]: refreshed }))
      setNotice(t('echoflowApiOfficialLogin.tokenCreated'))
    } catch (caught) {
      setError(withReason(t('echoflowApiOfficialLogin.createTokenFailed'), caught))
    } finally {
      setIsCreatingToken(false)
    }
  }

  const openConsole = () => {
    void getDesktopHost().shell.open(`${ECHOFLOW_BASE_URLS[selectedEndpoint]}/console/token`).catch(() => {})
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

  const credentialForm = (
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
  )

  const loginHost = loginPaneHost?.current
  const loginPane = login && (
    <section
      aria-labelledby={loginTitleId}
      className={loginHost ? 'absolute inset-0 flex overflow-hidden bg-[var(--color-surface)]' : 'flex min-h-0 flex-1'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        cancelLogin()
      }}
    >
      <div className="mx-auto flex min-w-0 w-full max-w-[1120px] flex-col gap-4 px-10 pt-9 pb-4">
        <SettingsPageHeader
          titleId={loginTitleId}
          title={t('echoflowApiOfficialLogin.signIn')}
          description={endpointLabels[login.endpoint]}
          action={<Button ref={cancelButtonRef} variant="secondary" size="base" onClick={cancelLogin}>{t('echoflowApiOfficialLogin.cancel')}</Button>}
        />
        <div ref={placeholderRef} data-testid="echoflow-login-placeholder" className="flex min-h-0 flex-1 items-center justify-center bg-[var(--color-surface-container-low)]">
          <Spinner label={t('common.loading')} />
        </div>
      </div>
    </section>
  )

  return (<>
    <div className={login && !loginHost ? 'hidden' : 'flex flex-col gap-3'} aria-hidden={login && !loginHost ? true : undefined}>
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
          setNotice(null)
        }}
        label={t('echoflowApiOfficialLogin.endpointSwitch')}
        as="tablist"
        appearance="raised"
        size="sm"
        layout="fill"
      />
      <p className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.endpointHint')}</p>

      {showCredentialEditor ? (
        credentialForm
      ) : account ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm text-[var(--color-text-secondary)]">{accountSummary}</div>
            <div className="flex shrink-0 items-center gap-2">
              {canSignIn && (
                <Button ref={signInButtonRef} variant="primary" size="sm" onClick={signIn}>
                  {t('echoflowApiOfficialLogin.signIn')}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowCredentialEditor(true)}>
                {t('echoflowApiOfficialLogin.updateToken')}
              </Button>
              {account.live !== false && (
                <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refreshAccount()} loading={isRefreshing}>
                  {t('echoflowApiOfficialLogin.refresh')}
                </Button>
              )}
              <Button variant="secondary" size="sm" icon={<Unlink className="h-4 w-4" />} onClick={() => void disconnectAccount()} loading={isDisconnecting}>
                {t('echoflowApiOfficialLogin.unbind')}
              </Button>
            </div>
          </div>
          {account.live === false && (
            <p className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.needsRelogin')}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {canSignIn && (
              <Button ref={signInButtonRef} variant="primary" size="md" onClick={signIn}>
                {t('echoflowApiOfficialLogin.signIn')}
              </Button>
            )}
            {/* Reachable before sign-in too: this is where a new account is
                registered, so the link cannot wait for an account to exist. */}
            <Button variant="secondary" size="md" icon={<ExternalLink className="h-4 w-4" />} onClick={openConsole}>
              {t('echoflowApiOfficialLogin.openConsole')}
            </Button>
          </div>
          <details>
            <summary className="w-fit cursor-pointer text-xs text-[var(--color-text-secondary)]">
              {t('echoflowApiOfficialLogin.manualBind')}
            </summary>
            <div className="mt-2">{credentialForm}</div>
          </details>
        </div>
      )}

      {/* Feedback sits between the action that produced it and the token list,
          not at the bottom of the card where the failing button is off-screen. */}
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3 py-2 text-[13px] text-[var(--color-on-error-container)]"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-container-high)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          {notice}
        </p>
      )}

      {account && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('echoflowApiOfficialLogin.callTokens')}</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">{t('echoflowApiOfficialLogin.callTokensHint')}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {account.live !== false && (
                <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => void createToken()} loading={isCreatingToken}>
                  {t('echoflowApiOfficialLogin.createToken')}
                </Button>
              )}
              <Button variant="secondary" size="sm" icon={<ExternalLink className="h-4 w-4" />} onClick={openConsole}>
                {t('echoflowApiOfficialLogin.openConsole')}
              </Button>
            </div>
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
                      <CirclePlus size={18} strokeWidth={1.75} className="shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
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
    </div>
    {loginPane && (loginHost ? createPortal(loginPane, loginHost) : loginPane)}
  </>)
}
