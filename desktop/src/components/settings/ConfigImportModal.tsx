import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '../../i18n'
import { useProviderStore } from '../../stores/providerStore'
import { useUIStore } from '../../stores/uiStore'
import { importConfig } from '../../lib/configImport'
import { getDesktopHost } from '../../lib/desktopHost'
import type { ShareableConfig } from '../../types/configShare'

interface ConfigImportModalProps {
  open: boolean
  onClose: () => void
  config: ShareableConfig
  apiKey?: string
}

export function ConfigImportModal({ open, onClose, config, apiKey }: ConfigImportModalProps) {
  const t = useTranslation()
  const addToast = useUIStore(state => state.addToast)
  const [importing, setImporting] = useState(false)

  const handleImport = async () => {
    setImporting(true)
    try {
      // A link can open the app straight into this dialog, before any page has
      // loaded providers; skipping existing ones needs the real list.
      const store = useProviderStore.getState()
      if (!store.hasLoadedProviders) await store.fetchProviders()
      const { providers, createProvider, hasLoadedProviders } = useProviderStore.getState()
      if (!hasLoadedProviders) throw new Error('Providers could not be loaded')
      const result = await importConfig(config, { providers, createProvider }, { apiKey })
      const message = result.skipped > 0
        ? `${t('configImport.success')} ${t('configImport.skippedExisting', { count: result.skipped })}`
        : t('configImport.success')
      addToast({ message, type: 'success' })
      onClose()
    } catch (error) {
      console.error('Failed to import config:', error)
      addToast({ message: t('configImport.error'), type: 'error' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('configImport.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          <div>{t('configImport.source')}: {config.source}</div>
          <div>{t('configImport.timestamp')}: {new Date(config.timestamp).toLocaleString()}</div>
        </div>

        <div>
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>{t('configImport.willImport')}</div>
          <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
            {t('configImport.providers', { count: config.config.providers.length })}
          </div>
          <ul style={{ marginLeft: '20px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {config.config.providers.map((provider, index) => (
              <li key={`${provider.name}-${index}`}>{provider.name}</li>
            ))}
          </ul>
        </div>

        {!apiKey && <div style={{
          padding: '12px',
          backgroundColor: 'var(--color-warning-container)',
          border: '1px solid var(--color-warning)',
          borderRadius: '8px',
          fontSize: '13px',
        }}>
          ⚠️ {t('configImport.manualConfig')}
          <ul style={{ marginLeft: '20px', marginTop: '4px' }}>
            <li>{t('configImport.apiKeyRequired')}</li>
          </ul>
        </div>}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            {t('configImport.cancel')}
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? t('configImport.importing') : t('configImport.import')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Shows the import dialog for `echoflowcode://` links the main process received. */
export function DeepLinkConfigImport() {
  const t = useTranslation()
  const addToast = useUIStore(state => state.addToast)
  const [pending, setPending] = useState<{ config: ShareableConfig; apiKey?: string } | null>(null)

  useEffect(() => {
    const host = getDesktopHost().configImport
    // The main process retains the link until ack(), including across React remounts.
    const pull = () => {
      void host.take().then(async next => {
        if (!next) return
        if ('invalid' in next) {
          await host.ack()
          addToast({ message: t('configImport.invalidLink'), type: 'error' })
        } else {
          setPending(next)
        }
      }).catch(() => {})
    }
    let unlisten: (() => void) | undefined
    let cancelled = false
    void host.onPending(pull).then(fn => {
      if (cancelled) fn()
      else {
        unlisten = fn
        pull()
      }
    }).catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [addToast, t])

  if (!pending) return null
  return (
    <ConfigImportModal
      open
      config={pending.config}
      apiKey={pending.apiKey}
      onClose={() => {
        setPending(null)
        void getDesktopHost().configImport.ack()
      }}
    />
  )
}
