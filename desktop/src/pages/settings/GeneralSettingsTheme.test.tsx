import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GeneralSettings } from './GeneralSettings'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore, teardownTheme } from '@/stores/uiStore'
import { useOpenTargetStore } from '@/stores/openTargetStore'
import { settingsApi } from '@/api/settings'

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(useSettingsStore.getState(), 'fetchOutputStyles').mockResolvedValue()
  vi.spyOn(useSettingsStore.getState(), 'fetchAppMode').mockResolvedValue()
  vi.spyOn(useOpenTargetStore.getState(), 'ensureTargets').mockResolvedValue()
  useSettingsStore.setState({ locale: 'en' })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  useUIStore.getState().setFollowSystemTheme(true)
})
afterEach(() => {
  cleanup()
  teardownTheme()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
  localStorage.clear()
})

it('desktop palette controls keep following the OS and change only their selected ground', () => {
  const update = vi.spyOn(settingsApi, 'updateUser')
  const select = vi.spyOn(useSettingsStore.getState(), 'setTheme')
  render(<GeneralSettings />)
  const follow = screen.getByRole('switch', { name: 'Follow the system' })
  expect(follow).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Ink Blue' }))
  expect(select).toHaveBeenCalledExactlyOnceWith('ink-blue')
  expect(useUIStore.getState()).toMatchObject({ theme: 'white', darkTheme: 'ink-blue', lightTheme: 'white', followSystemTheme: true })
  expect(screen.getByRole('button', { name: 'Ink Blue' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Celadon' }))
  expect(useUIStore.getState()).toMatchObject({ theme: 'celadon', darkTheme: 'ink-blue', lightTheme: 'celadon', followSystemTheme: true })
  fireEvent.click(follow)
  expect(useUIStore.getState()).toMatchObject({ theme: 'celadon', followSystemTheme: false })
  expect(update).not.toHaveBeenCalled()
  expect(JSON.parse(localStorage.getItem('echoflow-code-theme-preferences')!)).toMatchObject({ theme: 'celadon', followSystem: false, mirrorSync: { pending: false } })
})
