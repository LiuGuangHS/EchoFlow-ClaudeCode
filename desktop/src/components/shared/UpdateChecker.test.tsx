import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { UpdateChecker } from './UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUpdateStore } from '../../stores/updateStore'

describe('UpdateChecker', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      configurable: true,
    })

    useUpdateStore.setState({
      status: 'available',
      availableVersion: '0.1.5',
      releaseNotes: '# EchoFlowAI-Claude-Code v0.1.5\n\n[Release notes](https://example.com/releases/v0.1.5)',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('renders markdown release notes in the update prompt', () => {
    useUpdateStore.setState({ status: 'downloaded' })

    render(<UpdateChecker />)

    expect(screen.getByText('Update ready')).toBeInTheDocument()
    expect(screen.getByText('v0.1.5 has been downloaded. Restart when you are ready to use it.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EchoFlowAI-Claude-Code v0.1.5' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Release notes' })
    expect(link).toHaveAttribute('href', 'https://example.com/releases/v0.1.5')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows downloaded bytes when the updater does not provide total size', () => {
    useUpdateStore.setState({
      status: 'downloading',
      availableVersion: '0.1.5',
      releaseNotes: '# EchoFlowAI-Claude-Code v0.1.5',
      progressPercent: 0,
      downloadedBytes: 1536,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })

    render(<UpdateChecker />)

    expect(screen.queryByText('Downloading update... 1.5 KB downloaded')).not.toBeInTheDocument()
    expect(screen.queryByText('Update ready')).not.toBeInTheDocument()
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument()
  })

  it.each(['installing', 'restarting'] as const)('does not keep a forced prompt during %s', (status) => {
    useUpdateStore.setState({
      status,
      availableVersion: '0.1.5',
      shouldPrompt: true,
    })

    render(<UpdateChecker />)

    expect(screen.queryByText('Update ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Install and restart')).not.toBeInTheDocument()
  })

  it('keeps the ready prompt retryable when install fails after download', () => {
    useUpdateStore.setState({
      status: 'downloaded',
      error: 'installer failed',
      shouldPrompt: true,
    })

    render(<UpdateChecker />)

    expect(screen.getByText('Update ready')).toBeInTheDocument()
    expect(screen.getByText('Update failed: installer failed')).toBeInTheDocument()
    expect(screen.getByText('Install and restart')).toBeInTheDocument()
  })
})
