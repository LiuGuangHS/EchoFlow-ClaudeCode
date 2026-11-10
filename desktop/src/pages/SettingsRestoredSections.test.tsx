import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression for the settings rebuild: the rail briefly lost the Network,
 * Runtime, Data and Trace entries (and the panels behind them), so no user
 * could reach those sections even though the panel files still existed.
 *
 * The four panels are mocked so this suite isolates the shell's entry and
 * routing wiring; reachability of the real panels is covered by
 * componentReachability and the panel suites.
 */
vi.mock('./settings/NetworkSettings', () => ({
  NetworkSettings: () => <div data-testid="panel-network" />,
}))
vi.mock('./settings/RuntimeSettings', () => ({
  RuntimeSettings: () => <div data-testid="panel-runtime" />,
}))
vi.mock('./settings/DataSettings', () => ({
  DataSettings: () => <div data-testid="panel-data" />,
}))
vi.mock('./TraceList', () => ({
  TraceList: () => <div data-testid="panel-trace" />,
}))

import { DesktopSettings as Settings } from './Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const RESTORED_SECTIONS = [
  { tab: 'network', label: 'Network', testId: 'panel-network' },
  { tab: 'runtime', label: 'Runtime management', testId: 'panel-runtime' },
  { tab: 'data', label: 'Data & Storage', testId: 'panel-data' },
  { tab: 'trace', label: 'Trace', testId: 'panel-trace' },
] as const

const scrollIntoView = vi.fn()

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  })
  useSettingsStore.setState({ locale: 'en' })
  useUIStore.setState({ activeSettingsTab: 'providers', pendingSettingsTab: null })
})

afterEach(() => {
  cleanup()
  scrollIntoView.mockClear()
  useUIStore.setState({ activeSettingsTab: 'providers', pendingSettingsTab: null })
})

describe('Settings restored section entries', () => {
  for (const section of RESTORED_SECTIONS) {
    it(`offers the ${section.label} entry in the rail`, () => {
      render(<Settings />)
      expect(screen.getByRole('button', { name: section.label })).toBeInTheDocument()
    })

    it(`opens the ${section.label} panel when its entry is clicked`, () => {
      render(<Settings />)
      fireEvent.click(screen.getByRole('button', { name: section.label }))
      expect(useUIStore.getState().activeSettingsTab).toBe(section.tab)
      expect(screen.getByTestId(section.testId)).toBeInTheDocument()
    })

    it(`opens ${section.label} from a pending settings-tab request`, async () => {
      useUIStore.setState({ pendingSettingsTab: section.tab })
      render(<Settings />)
      await waitFor(() => expect(useUIStore.getState().activeSettingsTab).toBe(section.tab))
      expect(screen.getByTestId(section.testId)).toBeInTheDocument()
      expect(useUIStore.getState().pendingSettingsTab).toBeNull()
    })
  }

  it('keeps the pre-existing rail entries while restoring the four sections', () => {
    render(<Settings />)
    for (const label of ['Model Settings', 'General', 'Voice Input', 'Diagnostics', 'About']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})
