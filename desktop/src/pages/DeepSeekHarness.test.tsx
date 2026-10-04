import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { harnessApiMock } = vi.hoisted(() => ({
  harnessApiMock: {
    getStatus: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    update: vi.fn(),
    open: vi.fn(),
  },
}))

vi.mock('../lib/desktopHost', () => ({
  getDesktopHost: () => ({ deepSeekHarness: harnessApiMock }),
}))

import { DeepSeekHarness } from './DeepSeekHarness'

const unavailableStatus = {
  state: 'unavailable' as const,
  version: null,
  url: null,
  error: 'Node.js 22.19.0 or later is required',
  nodeVersion: null,
  nodeSource: null,
}

describe('DeepSeekHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harnessApiMock.getStatus.mockResolvedValue(unavailableStatus)
    harnessApiMock.start.mockResolvedValue({
      state: 'running',
      version: '1.2.3',
      url: null,
      error: null,
      nodeVersion: 'v22.19.0',
      nodeSource: 'managed',
    })
  })

  it('offers on-demand runtime preparation and starts official DSH when Node.js is unavailable', async () => {
    render(<DeepSeekHarness />)

    const startButton = await screen.findByRole('button', {
      name: '准备运行环境并启动',
    })
    fireEvent.click(startButton)

    await waitFor(() => {
      expect(harnessApiMock.start).toHaveBeenCalledTimes(1)
    })
  })

  it('offers an explicit online update while the service is running', async () => {
    harnessApiMock.getStatus.mockResolvedValue({
      state: 'running', version: '1.2.3', url: 'http://127.0.0.1:31415', error: null,
      nodeVersion: 'v22.19.0', nodeSource: 'system',
    })
    harnessApiMock.update.mockResolvedValue({
      state: 'running', version: '1.2.4', url: 'http://127.0.0.1:31415', error: null,
      nodeVersion: 'v22.19.0', nodeSource: 'system',
    })
    render(<DeepSeekHarness />)

    fireEvent.click(await screen.findByRole('button', { name: '检查官方更新并重启' }))
    await waitFor(() => expect(harnessApiMock.update).toHaveBeenCalledTimes(1))
  })
})
