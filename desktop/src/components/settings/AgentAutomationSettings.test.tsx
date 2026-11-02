import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '@/api/settings'
import { useOpenTargetStore } from '@/stores/openTargetStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { AgentAutomationSettings } from './AgentAutomationSettings'

describe('Agent automation automatic answers', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'zh',
      workflowKeywordTriggerEnabled: true,
      agentTeamsEnabled: true,
      autoDreamEnabled: false,
      autoQuestion: { enabled: false, timeoutMinutes: 5 },
      fetchOutputStyles: async () => {},
      fetchAppMode: async () => {},
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

  it('starts disabled and saves the enabled wait duration', async () => {
    render(<AgentAutomationSettings />)

    const toggle = screen.getByRole('switch', { name: '等待超时后自动选择答案' })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByLabelText('等待时长')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    await waitFor(() => expect(settingsApi.updateUser).toHaveBeenCalledWith({
      autoQuestion: { enabled: true, timeoutMinutes: 5 },
    }))
    expect(toggle).toBeChecked()

    fireEvent.change(screen.getByLabelText('等待时长'), { target: { value: '10' } })
    await waitFor(() => expect(settingsApi.updateUser).toHaveBeenCalledWith({
      autoQuestion: { enabled: true, timeoutMinutes: 10 },
    }))
  })
})
