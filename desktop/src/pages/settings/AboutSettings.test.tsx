import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUpdateStore } from '@/stores/updateStore'
import { AboutSettings } from './AboutSettings'

beforeEach(() => {
  useSettingsStore.setState({ locale: 'zh' })
  useUpdateStore.setState({ status: 'idle', error: null, errorCode: null })
})

afterEach(() => {
  cleanup()
})

it('opens the group QR in a dialog instead of pushing it below the fold', async () => {
  render(<AboutSettings />)
  // The version arrives from an async host call; let it settle so the assertion
  // is not racing a state update.
  await screen.findByText((_, node) => node?.tagName === 'SPAN' && node.textContent === '版本 0.1.0')

  const entry = screen.getByRole('button', { name: /加入 EchoFlow 交流群/ })
  expect(entry.compareDocumentPosition(screen.getByRole('button', { name: /反馈问题/ })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  expect(entry).toHaveAttribute('aria-haspopup', 'dialog')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.click(entry)

  const dialog = screen.getByRole('dialog', { name: '加入 EchoFlow 交流群' })
  const qr = screen.getByRole('img', { name: 'EchoFlow 企业微信群二维码' })
  expect(dialog).toContainElement(qr)
  expect(qr).toHaveAttribute('src', expect.stringContaining('icons/wechat-group-qr.png'))

  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('guides users to the official download page when the update check fails', async () => {
  useUpdateStore.setState({ status: 'error', errorCode: 'network', error: null })
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<AboutSettings />)

  // 引导文案要露出地址本身：按钮点不动时用户也能照着手打。
  expect(await screen.findByText(/code\.echoflow\.cn\/download/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '前往下载页' }))
  expect(open).toHaveBeenCalledWith('https://code.echoflow.cn/download', '_blank', 'noopener,noreferrer')

  open.mockRestore()
})

it('offers a manual download even while the update check is healthy', async () => {
  useUpdateStore.setState({ status: 'idle', error: null, errorCode: null })
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<AboutSettings />)
  await screen.findByText((_, node) => node?.tagName === 'SPAN' && node.textContent === '版本 0.1.0')

  fireEvent.click(screen.getByRole('button', { name: '前往下载页' }))
  expect(open).toHaveBeenCalledWith('https://code.echoflow.cn/download', '_blank', 'noopener,noreferrer')

  open.mockRestore()
})
