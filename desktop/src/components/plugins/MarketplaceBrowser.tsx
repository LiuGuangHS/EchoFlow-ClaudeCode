import { useEffect, useState } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useTranslation } from '../../i18n'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingState } from '@/components/ui/LoadingState'

export function MarketplaceBrowser() {
  const t = useTranslation()
  const {
    marketplacePresets,
    registeredMarketplaces,
    discoveredMarketplace,
    selectedMarketplacePlugin,
    isMarketplaceLoading,
    marketplaceError,
    fetchMarketplaceCatalog,
    discoverMarketplace,
    fetchMarketplacePluginDetail,
    clearMarketplaceSelection,
  } = usePluginStore()
  const [selectedMarketplace, setSelectedMarketplace] = useState('')

  useEffect(() => {
    void fetchMarketplaceCatalog()
  }, [fetchMarketplaceCatalog])

  useEffect(() => {
    if (!selectedMarketplace && registeredMarketplaces.length > 0) setSelectedMarketplace(registeredMarketplaces[0]!.name)
  }, [registeredMarketplaces, selectedMarketplace])

  const openMarketplace = (name: string) => {
    setSelectedMarketplace(name)
    clearMarketplaceSelection()
    void discoverMarketplace(name)
  }

  if (isMarketplaceLoading && registeredMarketplaces.length === 0 && marketplacePresets.length === 0) {
    return <LoadingState label={t('common.loading')} labelHidden />
  }
  if (marketplaceError && registeredMarketplaces.length === 0 && marketplacePresets.length === 0) {
    return <ErrorState title={marketplaceError} />
  }

  return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:p-6">
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('extensions.marketplacePresets')}</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('extensions.marketplacePresetsHint')}</p>
      {marketplacePresets.length === 0
        ? <EmptyState size="sm" variant="plain" title={t('extensions.marketplacePresetsEmpty')} description={t('extensions.marketplacePresetsEmptyHint')} />
        : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {marketplacePresets.map(preset => <article key={preset.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{preset.label}</h3>
            {preset.description && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{preset.description}</p>}
          </article>)}
        </div>}
    </section>

    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('extensions.registeredMarketplaces')}</h2>
      {registeredMarketplaces.length === 0
        ? <EmptyState size="sm" variant="plain" title={t('extensions.noRegisteredMarketplaces')} description={t('extensions.noRegisteredMarketplacesHint')} />
        : <div className="mt-3 flex flex-wrap gap-2">{registeredMarketplaces.map(marketplace => <Button key={marketplace.name} size="sm" variant={selectedMarketplace === marketplace.name ? 'primary' : 'secondary'} onClick={() => openMarketplace(marketplace.name)}>{marketplace.name}</Button>)}</div>}
      {marketplaceError && <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{marketplaceError}</p>}
      {isMarketplaceLoading && <LoadingState label={t('common.loading')} labelHidden />}
      {!isMarketplaceLoading && selectedMarketplace && discoveredMarketplace && <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{discoveredMarketplace.name}</h3>
        {discoveredMarketplace.description && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{discoveredMarketplace.description}</p>}
        <div className="mt-3 grid gap-2 md:grid-cols-2">{discoveredMarketplace.plugins.map(plugin => <button key={plugin.id} type="button" className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 text-left hover:bg-[var(--color-surface-hover)]" onClick={() => void fetchMarketplacePluginDetail(selectedMarketplace, plugin.name)}>
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">{plugin.name}{plugin.version && <span className="font-mono text-xs text-[var(--color-text-tertiary)]">v{plugin.version}</span>}</span>
          <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{plugin.description || t('settings.plugins.noDescription')}</span>
        </button>)}</div>
      </div>}
      {selectedMarketplacePlugin && <aside className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{selectedMarketplacePlugin.name}</h3><Button size="sm" variant="ghost" onClick={clearMarketplaceSelection}>{t('settings.plugins.back')}</Button></div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{selectedMarketplacePlugin.description || t('settings.plugins.noDescription')}</p>
      </aside>}
    </section>
  </div>
}
