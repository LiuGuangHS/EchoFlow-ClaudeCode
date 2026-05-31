import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { AdapterSettings } from './AdapterSettings'
import { useAdapterStore } from '../stores/adapterStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { AdapterFileConfig } from '../types/adapter'

const FEISHU_CREATE_BOT_URL = 'https://open.feishu.cn/page/openclaw?form=multiAgent'

function renderAdapterSettings(
  config: AdapterFileConfig,
  overrides: Partial<ReturnType<typeof useAdapterStore.getState>> = {},
) {
  useSettingsStore.setState({ locale: 'en' })
  useAdapterStore.setState({
    config,
    isLoading: false,
    fetchConfig: vi.fn(async () => {}),
    updateConfig: vi.fn(async () => {}),
    unbindWechatAccount: vi.fn(async () => {}),
    unbindDingtalkBot: vi.fn(async () => {}),
    removePairedUser: vi.fn(async () => {}),
    beginDingtalkRegistration: vi.fn(async () => ({
      deviceCode: 'device-code',
      verificationUriComplete: 'https://example.com/auth',
      intervalSeconds: 1,
      expiresInSeconds: 60,
    })),
    pollDingtalkRegistration: vi.fn(async () => ({ status: 'PENDING' })),
    ...overrides,
  } as Partial<ReturnType<typeof useAdapterStore.getState>>)

  render(<AdapterSettings />)
}

afterEach(() => {
  cleanup()
  useAdapterStore.setState(useAdapterStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('AdapterSettings Feishu onboarding', () => {
  it('shows the documented one-click Feishu bot link before credentials are configured', () => {
    renderAdapterSettings({})

    expect(screen.getByText('Need a Feishu bot?')).toBeInTheDocument()
    expect(screen.getByText(/OpenClaw template/)).toBeInTheDocument()
    expect(screen.getByText('1. Create the bot from the template.')).toBeInTheDocument()
    expect(screen.getByText('2. Copy its App ID and App Secret, then fill them in here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create feishu bot/i })).toHaveAttribute(
      'href',
      FEISHU_CREATE_BOT_URL,
    )
  })

  it('hides the one-click Feishu bot prompt once saved credentials exist', () => {
    renderAdapterSettings({
      feishu: {
        appId: 'cli_existing',
        appSecret: '****cret',
      },
    })

    expect(screen.queryByRole('link', { name: /create feishu bot/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Need a Feishu bot?')).not.toBeInTheDocument()
  })
})

describe('AdapterSettings account unbind confirmation', () => {
  it('confirms before unbinding a WeChat account', async () => {
    const unbindWechatAccount = vi.fn(async () => {})
    renderAdapterSettings(
      { wechat: { accountId: 'wx-account' } },
      { unbindWechatAccount },
    )

    fireEvent.click(screen.getByRole('tab', { name: 'WeChat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unbind WeChat account' }))

    expect(unbindWechatAccount).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Unbind WeChat account' })
    expect(within(dialog).getByText(/You will need to scan again/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(unbindWechatAccount).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Unbind WeChat account' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Unbind WeChat account' })).getByRole('button', { name: 'Unbind WeChat account' }))

    await waitFor(() => {
      expect(unbindWechatAccount).toHaveBeenCalledTimes(1)
    })
  })

  it('confirms before unbinding a DingTalk bot account', async () => {
    const unbindDingtalkBot = vi.fn(async () => {})
    renderAdapterSettings(
      { dingtalk: { clientId: 'dt-client' } },
      { unbindDingtalkBot },
    )

    fireEvent.click(screen.getByRole('tab', { name: 'DingTalk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unbind bot account' }))

    expect(unbindDingtalkBot).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Unbind bot account' })
    expect(within(dialog).getByText(/You will need to scan again/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unbind bot account' }))

    await waitFor(() => {
      expect(unbindDingtalkBot).toHaveBeenCalledTimes(1)
    })
  })
})
