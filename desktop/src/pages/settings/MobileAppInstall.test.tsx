import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { MobileAppInstall } from './MobileAppInstall'
import { mobileAppLinks } from './mobileAppLinks'
import { PRODUCT_IDENTITY } from '@/lib/productIdentity.generated'
import { en } from '@/i18n/locales/en'
import { zh } from '@/i18n/locales/zh'
import { zh as zhTW } from '@/i18n/locales/zh-TW'
import { jp } from '@/i18n/locales/jp'
import { kr } from '@/i18n/locales/kr'

const mocks = vi.hoisted(() => ({ open: vi.fn(async (_url: string) => {}) }))
vi.mock('@/lib/desktopHost', () => ({ getDesktopHost: () => ({ shell: { open: mocks.open } }) }))

const releasedAndroid = mobileAppLinks.android
const releasedTestFlight = mobileAppLinks.testFlight
beforeEach(() => useSettingsStore.setState({ locale: 'en' }))
afterEach(() => {
  cleanup()
  mocks.open.mockClear()
  mobileAppLinks.android = releasedAndroid
  mobileAppLinks.testFlight = releasedTestFlight
})

it('shows unverified Android availability honestly and opens the official guide', () => {
  expect(releasedAndroid).toBeNull()
  const { container } = render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.getByRole('heading', { name: `Get ${PRODUCT_IDENTITY.name} on your phone` })).toBeVisible()
  expect(screen.getByText(/No verified Android APK is available yet/)).toBeVisible()
  expect(screen.queryByText(/ships with every desktop release/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Download APK' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'View mobile availability guide' }))
  expect(mocks.open).toHaveBeenCalledTimes(1)
  expect(mocks.open).toHaveBeenCalledWith(`${PRODUCT_IDENTITY.docsUrl}/desktop/remote`)
  expect(container.querySelector('a, img')).toBeNull()
})

it('opens the verified Android APK when one is configured, never a generic release page', () => {
  const apk = `${PRODUCT_IDENTITY.repoUrl}/releases/download/v0.0.0/${PRODUCT_IDENTITY.slug}-mobile-0.0.0.apk`
  mobileAppLinks.android = apk
  render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.getByText(/Download the available Android APK/)).toBeVisible()
  expect(screen.queryByText(/No verified Android APK/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'View mobile availability guide' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Download APK' }))
  expect(mocks.open).toHaveBeenCalledTimes(1)
  expect(mocks.open).toHaveBeenCalledWith(apk)
})

it.each([
  ['en', en], ['zh', zh], ['zh-TW', zhTW], ['jp', jp], ['kr', kr],
] as const)('localizes both Android availability states in %s', (locale, copy) => {
  useSettingsStore.setState({ locale })
  mobileAppLinks.android = null
  const { rerender } = render(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(copy['mobileApp.androidPending']).toBeTruthy()
  expect(copy['mobileApp.availabilityGuide']).toBeTruthy()
  expect(screen.getByText(copy['mobileApp.androidPending'])).toBeVisible()
  expect(screen.getByRole('button', { name: copy['mobileApp.availabilityGuide'] })).toBeEnabled()
  for (const key of ['mobileApp.title', 'mobileApp.intro', 'mobileApp.browserHint', 'mobileApp.connectionHint'] as const) {
    expect(copy[key]).toContain('{productName}')
    expect(screen.getByText(copy[key].replace('{productName}', PRODUCT_IDENTITY.name))).toBeVisible()
  }

  mobileAppLinks.android = `${PRODUCT_IDENTITY.repoUrl}/releases/download/v0.0.0/fixture.apk`
  rerender(<MobileAppInstall connectionMethodsId="connection-methods" onUseBrowser={vi.fn()} />)
  expect(screen.getByText(copy['mobileApp.androidAvailable'])).toBeVisible()
  expect(screen.getByRole('button', { name: copy['mobileApp.downloadAndroid'] })).toBeEnabled()
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
