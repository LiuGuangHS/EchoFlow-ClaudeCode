import { useState } from 'react'
import { useProviderStore } from '../../stores/providerStore'
import { useTranslation } from '../../i18n'
import { SettingsPageHeader } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { providerToShareable, generateDeepLinkUrl } from '../../lib/configShare'
import type { ShareableConfig } from '../../types/configShare'

export function ConfigGeneratorPage() {
  const t = useTranslation()
  const providers = useProviderStore((state) => state.providers)
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([])
  const [source, setSource] = useState('')
  const [generatedLink, setGeneratedLink] = useState('')
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [copied, setCopied] = useState(false)

  const toggleProvider = (id: string) => {
    setSelectedProviderIds(current => current.includes(id)
      ? current.filter(providerId => providerId !== id)
      : [...current, id])
  }

  const generateLink = () => {
    const selectedProviders = providers
      .filter(provider => selectedProviderIds.includes(provider.id))
      .map(providerToShareable)
    if (selectedProviders.length === 0) return

    const config: ShareableConfig = {
      version: 1,
      source: source.trim() || 'EchoFlow Code',
      timestamp: Date.now(),
      config: { providers: selectedProviders },
    }
    setGeneratedLink(generateDeepLinkUrl(config))
    setShowLinkModal(true)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy config link:', error)
    }
  }

  return (
    <div>
      <SettingsPageHeader
        title={t('configGenerator.title')}
        description={t('configGenerator.description')}
      />

      <div className="mt-6 space-y-8">
        <section>
          <label className="block text-sm font-medium mb-2">{t('configGenerator.sourceIdentifier')}</label>
          <Input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="EchoFlow Code"
          />
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('configGenerator.sourceIdentifierHelp')}
          </p>
        </section>

        <section>
          <h3 className="text-base font-medium mb-3">{t('configGenerator.section.providers')}</h3>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            {t('configGenerator.providerHint')}
          </p>
          <div className="space-y-2">
            {providers.map(provider => (
              <label
                key={provider.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                <Checkbox
                  label={provider.name}
                  labelHidden
                  checked={selectedProviderIds.includes(provider.id)}
                  onChange={() => toggleProvider(provider.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{provider.name}</div>
                  {provider.baseUrl && (
                    <div className="text-sm text-[var(--color-text-secondary)] truncate">{provider.baseUrl}</div>
                  )}
                </div>
              </label>
            ))}
            {providers.length === 0 && (
              <div className="text-sm text-[var(--color-text-secondary)] p-3">
                {t('configGenerator.selectProvider')}
              </div>
            )}
          </div>
        </section>

        <Button onClick={generateLink} disabled={selectedProviderIds.length === 0} variant="primary">
          {t('configGenerator.generate')}
        </Button>
      </div>

      {showLinkModal && (
        <Modal
          open={showLinkModal}
          onClose={() => {
            setShowLinkModal(false)
            setCopied(false)
          }}
          title={t('configGenerator.generatedLink')}
        >
          <div className="space-y-4">
            <div className="p-3 bg-[var(--color-surface-secondary)] rounded-lg border border-[var(--color-border)] break-all font-mono text-sm">
              {generatedLink}
            </div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              {t('configGenerator.linkExpires')}
              <div className="mt-2">{t('configGenerator.securityNote')}</div>
            </div>
            <div className="flex gap-3">
              <Button onClick={copyLink} variant="primary">
                {copied ? t('configGenerator.copied') : t('configGenerator.copy')}
              </Button>
              <Button onClick={() => setShowLinkModal(false)}>{t('configImport.cancel')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
