import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '@/api/settings'
import { useOpenTargetStore } from '@/stores/openTargetStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { GeneralSettings } from './GeneralSettings'
import { NetworkSettings } from './NetworkSettings'
import { modelsApi } from '@/api/models'
import { h5AccessApi } from '@/api/h5Access'
import { tracesApi } from '@/api/traces'
import type { UserSettings } from '@/types/settings'

describe('General settings lean mode availability', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'zh', leanModeEnabled: false,
      fetchOutputStyles: async () => {}, fetchAppMode: async () => {},
    })
    useOpenTargetStore.setState({ ensureTargets: async () => {} })
    vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useOpenTargetStore.setState(useOpenTargetStore.getInitialState(), true)
  })
  it('defaults off and saves both choices', async () => {
    render(<GeneralSettings />)
    const toggle = screen.getByRole('switch', { name: '启用精简模式' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(settingsApi.updateUser).toHaveBeenCalledWith({ leanModeEnabled: true })
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(settingsApi.updateUser).toHaveBeenLastCalledWith({ leanModeEnabled: false })
  })
  it('keeps the previous choice when saving fails', async () => {
    vi.mocked(settingsApi.updateUser).mockRejectedValue(new Error('fixture failure'))
    render(<GeneralSettings />)
    const toggle = screen.getByRole('switch', { name: '启用精简模式' })
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).not.toBeChecked()
  })
})

describe('General and Network settings persistence', () => {
  it('shares saved DeepSeek settings between panels and reloads them after restart', async () => {
    const persisted: UserSettings = {
      env: { FIXTURE_ENV: 'keep' },
      unknownFuturePreference: true,
      webSearch: { mode: 'auto', tavilyApiKey: 'tvly-fixture', braveApiKey: 'brave-fixture' },
    }
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useSettingsStore.setState({ locale: 'zh', fetchOutputStyles: async () => {}, fetchAppMode: async () => {} })
    useOpenTargetStore.setState({ ensureTargets: async () => {} })
    vi.spyOn(settingsApi, 'getPermissionMode').mockResolvedValue({ mode: 'default' })
    vi.spyOn(settingsApi, 'getUser').mockImplementation(async () => structuredClone(persisted))
    vi.spyOn(settingsApi, 'updateUser').mockImplementation(async patch => {
      Object.assign(persisted, structuredClone(patch))
      return { ok: true }
    })
    vi.spyOn(modelsApi, 'list').mockResolvedValue({ models: [], provider: null })
    vi.spyOn(modelsApi, 'getCurrent').mockResolvedValue({ model: { id: 'fixture', name: 'Fixture', description: '', context: '' } })
    vi.spyOn(modelsApi, 'getEffort').mockResolvedValue({ level: 'low', available: ['low'] })
    vi.spyOn(h5AccessApi, 'get').mockResolvedValue({ settings: { enabled: false } } as Awaited<ReturnType<typeof h5AccessApi.get>>)
    vi.spyOn(tracesApi, 'getSettings').mockResolvedValue({ enabled: true, storageDir: '' })

    try {
      await useSettingsStore.getState().fetchAll()
      const general = render(<GeneralSettings />)
      const key = document.querySelector<HTMLInputElement>('#web-search-deepseek-key')!
      expect(key).toHaveValue('')
      fireEvent.change(key, { target: { value: 'fixture-general-key' } })
      fireEvent.click(within(key.closest('section')!).getByRole('button', { name: '保存' }))
      await waitFor(() => expect(persisted.webSearch?.deepseekApiKey).toBe('fixture-general-key'))
      general.unmount()

      const network = render(<NetworkSettings />)
      const networkKey = document.querySelector<HTMLInputElement>('#web-search-deepseek-key')!
      expect(networkKey).toHaveValue('fixture-general-key')
      fireEvent.change(networkKey, { target: { value: 'fixture-network-key' } })
      const networkSave = screen.getAllByRole('button', { name: '保存' }).find((button) => !button.hasAttribute('disabled'))
      expect(networkSave).toBeDefined()
      fireEvent.click(networkSave!)
      await waitFor(() => expect(persisted.webSearch?.deepseekApiKey).toBe('fixture-network-key'))
      network.unmount()

      useSettingsStore.setState(useSettingsStore.getInitialState(), true)
      await useSettingsStore.getState().fetchAll()
      useSettingsStore.setState({ locale: 'zh', fetchOutputStyles: async () => {}, fetchAppMode: async () => {} })
      render(<GeneralSettings />)
      expect(document.querySelector('#web-search-deepseek-key')).toHaveValue('fixture-network-key')
      expect(persisted.webSearch).toEqual({ mode: 'auto', tavilyApiKey: 'tvly-fixture', braveApiKey: 'brave-fixture', deepseekApiKey: 'fixture-network-key' })
      expect(persisted.env).toEqual({ FIXTURE_ENV: 'keep' })
      expect(persisted.unknownFuturePreference).toBe(true)
      expect(settingsApi.updateUser).toHaveBeenCalledTimes(2)
      expect(settingsApi.updateUser).toHaveBeenNthCalledWith(1, { webSearch: { ...persisted.webSearch, deepseekApiKey: 'fixture-general-key' } })
      expect(settingsApi.updateUser).toHaveBeenNthCalledWith(2, { webSearch: persisted.webSearch })
    } finally {
      cleanup()
      vi.restoreAllMocks()
      useSettingsStore.setState(useSettingsStore.getInitialState(), true)
      useOpenTargetStore.setState(useOpenTargetStore.getInitialState(), true)
    }
  })
})
