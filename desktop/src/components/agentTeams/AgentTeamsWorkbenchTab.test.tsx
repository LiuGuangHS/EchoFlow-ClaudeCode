import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
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

  it('remeasures the organization graph after returning from a teammate run', async () => {
    const observedTargets: Array<string | null> = []
    class ResizeObserverMock {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observedTargets.push(target.getAttribute('data-testid'))
        this.callback([{
          target,
          contentRect: { width: 760 },
        } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    const member = { agentId: 'reviewer@t', name: 'reviewer', role: 'reviewer', status: 'running' as const }
    useTeamStore.setState({
      activeTeam: {
        name: 't',
        leadAgentId: 'lead@t',
        leadSessionId: 'lead-session',
        members: [member],
      },
      workbenchesBySession: {
        'lead-session': {
          teamName: 't', loading: false, error: null,
          snapshots: [{
            version: 'v1', generatedAt: '2026-08-08T00:00:00.000Z',
            team: {
              name: 't',
              leadAgentId: 'reviewer@t',
              leadSessionId: 'lead-session',
              members: [member],
            },
            tasks: ['1', '2', '3'].map((id) => ({
              id,
              subject: `Task ${id}`,
              description: '',
              status: 'pending' as const,
              blocks: [],
              blockedBy: [],
              taskListId: 't',
            })),
            messages: [],
          }],
        },
      },
    })
    useTabStore.getState().openTab('lead-session', 'Lead session')
    const teamTabId = useTabStore.getState().openTeamWorkbenchTab('lead-session', 't')

    function RoutedWorkbench() {
      const activeTab = useTabStore((state) => state.tabs.find((tab) => tab.sessionId === state.activeTabId))
      if (activeTab?.type === 'team-member') {
        return (
          <button type="button" onClick={() => useTabStore.getState().returnFromTeamMember(activeTab.sessionId)}>
            Return to workbench
          </button>
        )
      }
      return <AgentTeamsWorkbenchTab tabId={teamTabId} leadSessionId="lead-session" />
    }

    render(<RoutedWorkbench />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-teams-office').getAttribute('data-layout-columns')).toBe('3')
    })

    fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@t'))
    expect(screen.getByRole('button', { name: 'Return to workbench' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Return to workbench' }))
    await waitFor(() => {
      expect(screen.getByTestId('agent-teams-office').getAttribute('data-layout-columns')).toBe('3')
    })
    expect(observedTargets.filter((testId) => testId === 'agent-teams-office-viewport')).toHaveLength(2)
    expect(observedTargets.filter((testId) => testId === 'agent-teams-split-container')).toHaveLength(2)
  })
})
