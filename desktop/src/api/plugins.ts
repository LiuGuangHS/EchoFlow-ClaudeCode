import { api } from './client'
import type {
  MarketplaceDiscovery,
  MarketplacePlugin,
  MarketplacePreset,
  PluginDetail,
  PluginListResponse,
  RegisteredMarketplace,
  PluginReloadSummary,
  PluginSessionReloadSummary,
  PluginScope,
} from '../types/plugin'

type PluginActionPayload = {
  id: string
  scope?: PluginScope
  keepData?: boolean
  cwd?: string
}

export const pluginsApi = {
  marketplacePresets: () =>
    api.get<{ presets: MarketplacePreset[] }>('/api/plugins/marketplace/presets'),

  registeredMarketplaces: () =>
    api.get<{ marketplaces: RegisteredMarketplace[] }>('/api/plugins/marketplace/registered'),

  discoverMarketplace: (marketplace: string) => {
    const query = new URLSearchParams({ marketplace })
    return api.get<MarketplaceDiscovery>(`/api/plugins/marketplace/discover?${query.toString()}`)
  },

  marketplacePluginDetail: (marketplace: string, plugin: string) => {
    const query = new URLSearchParams({ marketplace, plugin })
    return api.get<{ detail: MarketplacePlugin }>(`/api/plugins/marketplace/detail?${query.toString()}`)
  },

  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<PluginListResponse>(`/api/plugins${query}`)
  },

  detail: (id: string, cwd?: string) => {
    const query = new URLSearchParams({ id })
    if (cwd) query.set('cwd', cwd)
    return api.get<{ detail: PluginDetail }>(`/api/plugins/detail?${query.toString()}`)
  },

  enable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/enable', payload),

  disable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/disable', payload),

  update: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/update', payload),

  uninstall: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/uninstall', payload),

  reload: (cwd?: string, sessionId?: string) => {
    const query = new URLSearchParams()
    if (cwd) query.set('cwd', cwd)
    if (sessionId) query.set('sessionId', sessionId)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return api.post<{
      ok: true
      summary: PluginReloadSummary
      session?: PluginSessionReloadSummary
    }>(
      `/api/plugins/reload${suffix}`,
      undefined,
      { timeout: 120_000 },
    )
  },
}
