import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTeamStore } from '../../stores/teamStore'
import { useTabStore } from '../../stores/tabStore'
import type { TeamWorkbenchSnapshot, TeamWorkbenchTask } from '../../types/team'
import { AgentTeamsWorkbench } from './AgentTeamsWorkbench'

const { getWorkbenchForSessionMock, getWorkbenchMock } = vi.hoisted(() => ({
  getWorkbenchForSessionMock: vi.fn(),
  getWorkbenchMock: vi.fn(),
}))

vi.mock('../../api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getWorkbenchForSession: getWorkbenchForSessionMock,
    getWorkbench: getWorkbenchMock,
    getMemberTranscript: vi.fn(),
    sendMemberMessage: vi.fn(),
    delete: vi.fn(),
  },
}))

function task(
  id: string,
  status: TeamWorkbenchTask['status'],
  blockedBy: string[] = [],
  owner?: string,
): TeamWorkbenchTask {
  return {
    id,
    subject: `Task ${id}`,
    description: `Task ${id} detail`,
    activeForm: status === 'in_progress' ? `Working on task ${id}` : undefined,
    owner,
    status,
    blocks: [],
    blockedBy,
    taskListId: 'visual-team',
  }
}

function workbench(
  version: string,
  statuses: [TeamWorkbenchTask['status'], TeamWorkbenchTask['status'], TeamWorkbenchTask['status']],
): TeamWorkbenchSnapshot {
  return {
    version,
    generatedAt: `2026-08-08T00:00:0${version.slice(-1)}.000Z`,
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
      task('1', statuses[0], [], 'builder'),
      task('2', statuses[1], ['1'], 'reviewer'),
      task('3', statuses[2], ['1', '2']),
    ],
    messages: [{
      id: `message-${version}`,
      from: 'builder',
      to: 'reviewer',
      recipients: ['reviewer'],
      kind: 'direct',
      text: `Snapshot ${version} ready`,
      timestamp: `2026-08-08T00:00:0${version.slice(-1)}.000Z`,
    }],
  }
}

describe('AgentTeamsWorkbench', () => {
  beforeEach(() => {
    getWorkbenchMock.mockReset()
    getWorkbenchForSessionMock.mockReset()
    useTeamStore.getState().clearTeam()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSettingsStore.setState({ locale: 'en' })
  })

  it('renders a multi-dependency team and keeps history fixed while live updates continue', async () => {
    getWorkbenchMock
      .mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
      .mockResolvedValueOnce(workbench('v2', ['completed', 'completed', 'in_progress']))
      .mockResolvedValueOnce(workbench('v3', ['completed', 'completed', 'completed']))

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    const { container } = render(<AgentTeamsWorkbench sessionId="lead-session" />)

    expect(screen.getByTestId('agent-teams-task-2').getAttribute('data-state')).toBe('completed')
    expect(screen.getByTestId('agent-teams-task-3').getAttribute('data-state')).toBe('running')
    expect(screen.getByText('Snapshot v2 ready')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-member-team-lead@visual-team').getAttribute('data-avatar-key')).toBe('team-lead')
    expect(screen.getByTestId('agent-teams-member-builder@visual-team').getAttribute('data-avatar-key')).toBe('ui-designer')
    expect(screen.getByTestId('agent-teams-member-builder@visual-team').querySelector('img')).toBeTruthy()
    expect(container.querySelector('[data-layout-role="leader-root"]')?.getAttribute('data-center-x')).toBe('302')
    expect(container.querySelectorAll('[data-edge-kind="leader-root"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-edge-kind="dependency-primary"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-edge-kind="dependency-secondary"]')).toHaveLength(1)
    expect(screen.getByTestId('agent-teams-task-2').querySelector('img')).toBeTruthy()
    expect(screen.getByTestId('agent-teams-member-builder@visual-team').className).toContain('cursor-pointer')

    fireEvent.mouseEnter(screen.getByTestId('agent-teams-task-3'))
    expect(container.querySelectorAll('[data-edge-active="true"]')).toHaveLength(2)
    fireEvent.mouseLeave(screen.getByTestId('agent-teams-task-3'))
    expect(container.querySelectorAll('[data-edge-active="true"]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Review history' }))
    expect(screen.getByTestId('agent-teams-task-2').getAttribute('data-state')).toBe('running')
    expect(screen.getByTestId('agent-teams-task-3').getAttribute('data-state')).toBe('blocked')

    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    expect(screen.getByTestId('agent-teams-task-2').getAttribute('data-state')).toBe('running')
    expect(screen.getByText('Snapshot v1 ready')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    await waitFor(() => {
      expect(screen.getByTestId('agent-teams-task-3').getAttribute('data-state')).toBe('completed')
    })
    expect(screen.getByText('Snapshot v3 ready')).toBeTruthy()
  })

  it('swaps the workbench body to a teammate run and back without leaving the panel', async () => {
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@visual-team'))
    })

    const memberView = screen.getByTestId('agent-teams-member-view')
    expect(memberView.getAttribute('data-member-agent-id')).toBe('reviewer@visual-team')
    expect(screen.getByTestId('agent-teams-member-current-task').textContent).toContain('Working on task 2')
    // The map is replaced, not overlaid — the panel is too narrow to show both.
    expect(screen.queryByTestId('agent-teams-office')).toBeNull()
    // Selecting a teammate must not steal the tab; that is what the explicit
    // "open in tab" action is for.
    expect(useTabStore.getState().activeTabId).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to team overview' }))
    })
    expect(screen.getByTestId('agent-teams-office')).toBeTruthy()
    expect(screen.queryByTestId('agent-teams-member-view')).toBeNull()
  })

  it('detaches the selected teammate into its own tab on request', async () => {
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@visual-team'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in tab' }))
    })

    expect(useTabStore.getState().activeTabId).toBe('team-member:reviewer@visual-team')
  })

  // Opening the workbench tab and closing the docked side now belong to
  // AgentTeamsReport — see AgentTeamsReport.test.tsx.

  it('carries no docked-panel chrome of its own', async () => {
    getWorkbenchMock.mockResolvedValueOnce(workbench('v1', ['completed', 'in_progress', 'pending']))
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })
    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    expect(screen.queryByRole('button', { name: /Open the workbench full screen/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Close Agent Teams workbench/i })).toBeNull()
    // The feed always owns a column here; the 210px docked strip is gone.
    const feed = screen.getByTestId('agent-teams-communication')
    expect(feed.className).toContain('h-full')
    expect(feed.className).not.toContain('h-[210px]')
  })

  it('keeps every archived teammate character visible inside the organization tree', async () => {
    const archived = workbench('v1', ['completed', 'completed', 'completed'])
    archived.deletedAt = '2026-08-08T00:10:00.000Z'
    archived.team.members = archived.team.members.map((member) => ({
      ...member,
      status: 'completed',
    }))
    getWorkbenchMock.mockResolvedValueOnce(archived)
    await act(async () => {
      await useTeamStore.getState().fetchWorkbench('visual-team')
    })

    render(<AgentTeamsWorkbench sessionId="lead-session" />)

    for (const member of archived.team.members) {
      const figure = screen.getByTestId(`agent-teams-member-${member.agentId}`)
      expect(figure.getAttribute('data-member-state')).toBe('exited')
      expect(figure.querySelector('img')).toBeTruthy()
      expect(figure.getAttribute('style') ?? '').not.toContain('opacity: 0')
    }

    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-teams-member-reviewer@visual-team'))
    })
    const executionButton = screen.getByRole('button', { name: 'Open in tab' })
    expect((executionButton as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(executionButton)
    })
    expect(useTabStore.getState().activeTabId).toBe('team-member:reviewer@visual-team')
  })
})
