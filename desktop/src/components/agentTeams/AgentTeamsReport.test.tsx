import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamWorkbenchSnapshot } from '../../types/team'
import { AgentTeamsReport } from './AgentTeamsReport'

const { getWorkbenchMock } = vi.hoisted(() => ({ getWorkbenchMock: vi.fn() }))

vi.mock('../../api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getWorkbenchForSession: vi.fn(),
    getWorkbench: getWorkbenchMock,
    getMemberTranscript: vi.fn(),
    sendMemberMessage: vi.fn(),
    delete: vi.fn(),
  },
}))

function snapshot(overrides: Partial<TeamWorkbenchSnapshot> = {}): TeamWorkbenchSnapshot {
  return {
    version: 'v1',
    generatedAt: '2026-08-08T00:00:01.000Z',
    team: {
      name: 'visual-team',
      leadAgentId: 'team-lead@visual-team',
      leadSessionId: 'lead-session',
      members: [
        { agentId: 'team-lead@visual-team', name: 'team-lead', role: 'lead', status: 'running' },
        { agentId: 'builder@visual-team', name: 'builder', role: 'frontend', status: 'running' },
        { agentId: 'reviewer@visual-team', name: 'reviewer', role: 'reviewer', status: 'idle' },
      ],
    },
    tasks: [
      {
        id: '1',
        subject: 'Audit the queue scheduler',
        description: 'detail',
        owner: 'builder',
        status: 'completed',
        blocks: [],
        blockedBy: [],
        taskListId: 'visual-team',
      },
      {
        id: '2',
        subject: 'Design the adversarial matrix',
        description: 'detail',
        owner: 'reviewer',
        status: 'in_progress',
        blocks: [],
        blockedBy: ['1'],
        taskListId: 'visual-team',
      },
    ],
    messages: [
      {
        id: 'm1',
        from: 'builder',
        to: 'reviewer',
        recipients: ['reviewer'],
        kind: 'direct',
        text: 'Baseline is green',
        timestamp: '2026-08-08T00:00:01.000Z',
      },
      {
        id: 'm2',
        from: 'reviewer',
        to: 'team-lead',
        recipients: ['team-lead'],
        kind: 'direct',
        text: JSON.stringify({ type: 'idle_notification' }),
        timestamp: '2026-08-08T00:00:02.000Z',
      },
    ],
    ...overrides,
  }
}

function seed(value = snapshot()) {
  useTeamStore.setState({
    workbenchesBySession: {
      'lead-session': { teamName: 'visual-team', loading: false, error: null, snapshots: [value] },
    },
  })
}

describe('AgentTeamsReport', () => {
  beforeEach(() => {
    getWorkbenchMock.mockReset()
    useTeamStore.getState().clearTeam()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSettingsStore.setState({ locale: 'en' })
  })

  it('summarises the run without dragging the workbench into the panel', () => {
    seed()

    render(<AgentTeamsReport sessionId="lead-session" />)

    expect(screen.getByText('visual-team')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-report-progress').textContent).toContain('1/2')
    expect(screen.getByText('Audit the queue scheduler')).toBeTruthy()
    expect(screen.getByText('Design the adversarial matrix')).toBeTruthy()
    // The roster lists every member with its own status, lead included.
    expect(screen.getByTitle('team-lead')).toBeTruthy()
    expect(screen.getByTitle('builder')).toBeTruthy()
    expect(screen.getByTitle('reviewer')).toBeTruthy()
    expect(screen.getByText('Standing by')).toBeTruthy()

    // The point of the split: the map, the member drill-down and the message
    // log stay in the tab. Re-docking any of them is the regression.
    expect(screen.queryByTestId('agent-teams-office')).toBeNull()
    expect(screen.queryByTestId('agent-teams-communication')).toBeNull()
    expect(screen.queryByTestId('agent-teams-member-view')).toBeNull()
    expect(screen.queryByText('Baseline is green')).toBeNull()
  })

  it('counts real messages only and links out instead of embedding the feed', () => {
    seed()

    render(<AgentTeamsReport sessionId="lead-session" />)

    // Two stored messages, but one is an idle_notification protocol signal.
    expect(screen.getByTestId('agent-teams-report-communication').textContent).toContain('1 messages')
  })

  it('opens the workbench tab and releases the docked panel', () => {
    seed()
    useTeamStore.getState().setWorkbenchOpen('lead-session', true)

    render(<AgentTeamsReport sessionId="lead-session" />)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Workbench' }))
    })

    const tab = useTabStore.getState().tabs.find((current) => current.type === 'team')
    expect(tab?.sessionId).toBe('__team__lead-session')
    expect(tab?.teamLeadSessionId).toBe('lead-session')
    expect(useTabStore.getState().activeTabId).toBe('__team__lead-session')
    // The docked side would otherwise keep a duplicate pinned beside the tab.
    expect(useTeamStore.getState().workbenchOpenBySession['lead-session']).toBe(false)
  })

  it('closes without discarding the archived timeline', () => {
    seed()
    useTeamStore.getState().setWorkbenchOpen('lead-session', true)

    render(<AgentTeamsReport sessionId="lead-session" />)

    fireEvent.click(screen.getByRole('button', { name: /Close Agent Teams run report/i }))

    expect(useTeamStore.getState().workbenchOpenBySession['lead-session']).toBe(false)
    expect(useTeamStore.getState().workbenchesBySession['lead-session']?.snapshots[0]?.version).toBe('v1')
  })

  it('reports the disbanded outcome once the team is archived', () => {
    seed(snapshot({ deletedAt: '2026-08-08T00:10:00.000Z' }))

    render(<AgentTeamsReport sessionId="lead-session" />)

    expect(screen.getByTestId('agent-teams-report-disbanded').textContent)
      .toContain('Team disbanded, results merged into the main session')
  })
})
