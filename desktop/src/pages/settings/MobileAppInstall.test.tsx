import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { MobileAppInstall } from './MobileAppInstall'
import { mobileAppLinks } from './mobileAppLinks'

const mocks = vi.hoisted(() => ({ open: vi.fn(async (_url: string) => {}) }))
vi.mock('@/lib/desktopHost', () => ({ getDesktopHost: () => ({ shell: { open: mocks.open } }) }))

const releasedTestFlight = mobileAppLinks.testFlight
beforeEach(() => useSettingsStore.setState({ locale: 'en' }))
afterEach(() => {
  cleanup()
  mocks.open.mockClear()
  mobileAppLinks.testFlight = releasedTestFlight
})

it('sends Android users to the official EchoFlow mobile availability guide', () => {
  const { container } = render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Get EchoFlow Code on your phone' })).toBeVisible()
  expect(screen.getByText(/ships with every desktop release on GitHub Releases/)).toBeVisible()
  expect(screen.queryByText('Not released')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Download from GitHub' }))
  expect(mocks.open).toHaveBeenCalledTimes(1)
  expect(mocks.open).toHaveBeenCalledWith('https://code.echoflow.cn/desktop/remote')
  expect(container.querySelector('a, img')).toBeNull()
})

it('does not advertise an unverified EchoFlow iOS distribution channel', () => {
  expect(releasedTestFlight).toBeNull()
  render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Join TestFlight beta' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Use phone browser' })).not.toBeDisabled()
  expect(mocks.open).not.toHaveBeenCalled()
})

it('keeps the iOS entry closed until a TestFlight public link exists, then opens that link', () => {
  mobileAppLinks.testFlight = null
  const { unmount } = render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.getByText('Not open yet')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Join TestFlight beta' })).toBeDisabled()
  unmount()

  mobileAppLinks.testFlight = 'https://testflight.apple.com/join/FIXTURE1'
  render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.queryByText('Not open yet')).toBeNull()
  expect(screen.getByText(/join the beta with the public link/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Join TestFlight beta' }))
  expect(mocks.open).toHaveBeenCalledWith('https://testflight.apple.com/join/FIXTURE1')
})

it('offers a working browser connection action alongside the native apps', () => {
  const onUseBrowser = vi.fn()
  render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={onUseBrowser} />)
  const button = screen.getByRole('button', { name: 'Use phone browser' })
  expect(button).toHaveAttribute('aria-controls', 'connection-methods')
  expect(button).not.toBeDisabled()
  fireEvent.click(button)
  expect(onUseBrowser).toHaveBeenCalledTimes(1)
  expect(mocks.open).not.toHaveBeenCalled()
  expect(screen.getByText(/Same-Wi-Fi and Cloudflare connections/)).toBeVisible()
  expect(screen.getByText(/No extra VPN app is needed/)).toBeVisible()
})
