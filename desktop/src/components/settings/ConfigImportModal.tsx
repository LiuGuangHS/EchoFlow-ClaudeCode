import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '../../i18n'
import { useProviderStore } from '../../stores/providerStore'
import { useUIStore } from '../../stores/uiStore'
import { importConfig } from '../../lib/configImport'
import type { ShareableConfig } from '../../types/configShare'

interface ConfigImportModalProps {
  open: boolean
  onClose: () => void
  config: ShareableConfig
  apiKey?: string
}

export function ConfigImportModal({ open, onClose, config, apiKey }: ConfigImportModalProps) {
  const t = useTranslation()
  const providers = useProviderStore(state => state.providers)
  const createProvider = useProviderStore(state => state.createProvider)
  const addToast = useUIStore(state => state.addToast)
  const [importing, setImporting] = useState(false)

  const handleImport = async () => {
    setImporting(true)
    try {
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

        <div style={{
          padding: '12px',
          backgroundColor: 'var(--color-warning-bg)',
          border: '1px solid var(--color-warning-border)',
          borderRadius: '8px',
          fontSize: '13px',
        }}>
          ⚠️ {t('configImport.manualConfig')}
          <ul style={{ marginLeft: '20px', marginTop: '4px' }}>
            <li>{t('configImport.apiKeyRequired')}</li>
          </ul>
        </div>

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
