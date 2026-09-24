import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { harnessApiMock } = vi.hoisted(() => ({
  harnessApiMock: {
    getStatus: vi.fn(),
    install: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
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
}

describe('DeepSeekHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harnessApiMock.getStatus.mockResolvedValue(unavailableStatus)
    harnessApiMock.install.mockResolvedValue({
      state: 'installed',
      version: '0.1.5-rc.2',
      url: null,
      error: null,
    })
  })

  it('offers one-click environment installation when Node.js is unavailable', async () => {
    render(<DeepSeekHarness />)

    const installButton = await screen.findByRole('button', {
      name: '安装运行环境并安装 DeepSeek Harness',
    })
    fireEvent.click(installButton)

    await waitFor(() => {
      expect(harnessApiMock.install).toHaveBeenCalledTimes(1)
    })
  })
})
