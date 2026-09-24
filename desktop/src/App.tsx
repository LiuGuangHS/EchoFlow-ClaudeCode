import { AppShell } from './components/layout/AppShell'
import { useScheduledTaskDesktopNotifications } from './hooks/useScheduledTaskDesktopNotifications'
import { installDesktopNotificationNavigation } from './lib/desktopNotificationNavigation'
import { useEffect, useState } from 'react'
import { RemoteAccessGate } from './pages/RemoteAccess'
import { isPublicAccessRuntime } from './lib/publicAccessRuntime'
import { ConfigImportModal } from './components/settings/ConfigImportModal'
import { validateConfigPayload, type ShareableConfig } from './lib/configShare'
import { useTranslation } from './i18n'
import type { DeepLinkPayload } from '../electron/services/deepLinkHandler'

export function App() {
  return isPublicAccessRuntime()
    ? <RemoteAccessGate><ConnectedApp /></RemoteAccessGate>
    : <ConnectedApp />
}

function ConnectedApp() {
  const [configToImport, setConfigToImport] = useState<ShareableConfig | null>(null)
  const t = useTranslation()

  useScheduledTaskDesktopNotifications()

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    installDesktopNotificationNavigation()
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          cleanup = fn
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  // Listen for deep link events
  useEffect(() => {
    const handleDeepLink = async (_event: unknown, payload: DeepLinkPayload) => {
      if (payload.type === 'config-import') {
        try {
          const config = payload.data
          const validation = validateConfigPayload(config)

          if (!validation.valid) {
            console.error('Config validation failed:', validation.error)
            alert(t('configImport.invalidLink'))
            return
          }

          setConfigToImport(config)
        } catch (err) {
          console.error('Failed to process config:', err)
          alert(t('configImport.invalidLink'))
        }
      }
    }

    const electron = (window as any).electron
    electron?.on('desktop:deep-link', handleDeepLink)

    return () => {
      electron?.off('desktop:deep-link', handleDeepLink)
    }
  }, [t])

  return (
    <>
      <AppShell />
      {configToImport && (
        <ConfigImportModal
          open={true}
          config={configToImport}
          onClose={() => setConfigToImport(null)}
        />
      )}
    </>
  )
}
