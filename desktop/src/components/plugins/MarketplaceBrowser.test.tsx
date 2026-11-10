import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { expect, it, vi } from 'vitest'
import { MarketplaceBrowser } from './MarketplaceBrowser'

const actions = vi.hoisted(() => ({
  fetchMarketplaceCatalog: vi.fn(),
  discoverMarketplace: vi.fn(),
  fetchMarketplacePluginDetail: vi.fn(),
  clearMarketplaceSelection: vi.fn(),
}))
vi.mock('../../i18n', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('../../stores/pluginStore', () => ({
  usePluginStore: () => ({
    marketplacePresets: [{ id: 'preset', label: 'Preset', description: 'Preset description' }],
    registeredMarketplaces: [{ name: 'registered' }],
    discoveredMarketplace: { name: 'registered', plugins: [{ id: 'plugin@registered', name: 'plugin', description: 'Plugin description' }] },
    selectedMarketplacePlugin: { name: 'plugin', description: 'Plugin detail' },
    isMarketplaceLoading: false,
    marketplaceError: null,
    ...actions,
  }),
}))

it('保留只读预设、注册源浏览及插件详情操作', () => {
  render(<MarketplaceBrowser />)
  expect(actions.fetchMarketplaceCatalog).toHaveBeenCalledOnce()
  expect(screen.getByText('Preset description')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'registered' }))
  expect(actions.discoverMarketplace).toHaveBeenCalledWith('registered')
  fireEvent.click(screen.getByRole('button', { name: /plugin.*Plugin description/ }))
  expect(actions.fetchMarketplacePluginDetail).toHaveBeenCalledWith('registered', 'plugin')
  expect(screen.getByText('Plugin detail')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'settings.plugins.back' }))
  expect(actions.clearMarketplaceSelection).toHaveBeenCalledTimes(2)
})
