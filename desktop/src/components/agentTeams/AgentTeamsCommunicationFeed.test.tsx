import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import type { TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../../types/team'
import { AgentTeamsCommunicationFeed } from './AgentTeamsCommunicationFeed'

function message(overrides: Partial<TeamWorkbenchMessage> & { id: string }): TeamWorkbenchMessage {
  return {
    from: 'builder',
    to: 'reviewer',
    recipients: ['reviewer'],
    kind: 'direct',
    text: 'body',
    timestamp: '2026-08-08T07:42:16.666Z',
    ...overrides,
  }
}

function snapshot(messages: TeamWorkbenchMessage[]): TeamWorkbenchSnapshot {
  return {
    version: 'v1',
    generatedAt: '2026-08-08T07:00:00.000Z',
    team: { name: 'team-a', leadAgentId: 'lead@team-a', leadSessionId: 'lead-session', members: [] },
    tasks: [],
    messages,
  }
}

describe('AgentTeamsCommunicationFeed', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('narrates lifecycle signals behind a toggle instead of printing their JSON', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', text: 'Race condition confirmed in queue.ts' }),
      message({
        id: 'm2',
        from: 'release-engineer',
        to: 'team-lead',
        text: '{"type":"idle_notification","from":"release-engineer","timestamp":"2026-08-08T07:42:16.666Z","idleReason":"available"}',
      }),
    ])} />)

    // Lifecycle noise is out of the way by default, and never as raw JSON.
    expect(screen.queryByText(/idle_notification/)).toBeNull()
    expect(screen.getByText('Race condition confirmed in queue.ts')).toBeTruthy()

    fireEvent.click(screen.getByTestId('agent-teams-lifecycle-toggle'))

    expect(screen.queryByText(/idle_notification/)).toBeNull()
    expect(screen.getByText(/Went idle, waiting for work · available/)).toBeTruthy()
    expect(screen.getByTestId('agent-teams-message-m2').getAttribute('data-message-body')).toBe('lifecycle')
  })

  it('stamps each row with its own send time rather than a shared snapshot index', () => {
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', text: 'first', timestamp: '2026-08-08T07:42:00.000Z' }),
      message({ id: 'm2', text: 'second', timestamp: '2026-08-08T09:15:00.000Z' }),
    ])} />)

    const times = ['m1', 'm2'].map((id) => {
      const row = screen.getByTestId(`agent-teams-message-${id}`)
      return row.querySelector('.tabular-nums')?.textContent
    })

    expect(times[0]).toBeTruthy()
    expect(times[0]).not.toBe(times[1])
    expect(screen.queryByText(/^T\+\d+$/)).toBeNull()
  })

  it('keeps a long broadcast readable by collapsing it behind an expander', () => {
    const long = 'x'.repeat(400)
    render(<AgentTeamsCommunicationFeed snapshot={snapshot([
      message({ id: 'm1', kind: 'broadcast', to: '*', text: long }),
    ])} />)

    const row = screen.getByTestId('agent-teams-message-m1')
    expect(row.textContent).toContain('…')
    expect(row.textContent).not.toContain(long)

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByTestId('agent-teams-message-m1').textContent).toContain(long)

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByTestId('agent-teams-message-m1').textContent).not.toContain(long)
  })
})
