import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import { AgentTeamsWorkbenchTab } from './AgentTeamsWorkbenchTab'

vi.mock('../../api/teams', () => ({
  teamsApi: {
    list: vi.fn(), get: vi.fn(),
    getWorkbenchForSession: vi.fn().mockRejectedValue(new Error('no')),
    getWorkbench: vi.fn(), getMemberTranscript: vi.fn(), sendMemberMessage: vi.fn(), delete: vi.fn(),
  },
}))

describe('AgentTeamsWorkbenchTab', () => {
  beforeEach(() => {
    useTeamStore.getState().clearTeam()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSettingsStore.setState({ locale: 'en' })
  })

  it('renders the workbench in full variant with the feed in its own column', () => {
    useTeamStore.setState({
      workbenchesBySession: {
        'lead-session': {
          teamName: 't', loading: false, error: null,
          snapshots: [{
            version: 'v1', generatedAt: '2026-08-08T00:00:00.000Z',
            team: { name: 't', leadAgentId: 'lead@t', leadSessionId: 'lead-session', members: [{ agentId: 'lead@t', name: 'lead', role: 'lead', status: 'running' }] },
            tasks: [], messages: [{ id: 'm1', from: 'a', to: 'b', recipients: ['b'], kind: 'direct', text: 'hello there', timestamp: '2026-08-08T00:00:00.000Z' }],
          }],
        },
      },
    })

    render(<AgentTeamsWorkbenchTab tabId="__team__lead-session" leadSessionId="lead-session" />)

    expect(screen.getByTestId('agent-teams-office')).toBeTruthy()
    expect(screen.getByText('hello there')).toBeTruthy()
    // Full variant: the feed owns a column, so it must not carry the docked strip height.
    const feed = screen.getByTestId('agent-teams-communication')
    expect(feed.className).toContain('h-full')
    expect(feed.className).not.toContain('h-[210px]')
    // The detached tab has no close/fullscreen chrome of its own.
    expect(screen.queryByRole('button', { name: /Open the workbench full screen/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to session' })).toBeTruthy()
  })
})
