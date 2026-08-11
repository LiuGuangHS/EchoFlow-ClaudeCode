import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAgentTeamsWorkbenchOpen, mergeMemberTranscriptDelta, useTeamStore } from './teamStore'
import { useChatStore } from './chatStore'
import { useTabStore } from './tabStore'
import type { UIMessage } from '../types/chat'
import type { TeamWorkbenchSnapshot } from '../types/team'

const {
  getMemberTranscriptMock,
  getWorkbenchForSessionMock,
  getWorkbenchMock,
  getTeamMock,
} = vi.hoisted(() => ({
  getMemberTranscriptMock: vi.fn(),
  getWorkbenchForSessionMock: vi.fn(),
  getWorkbenchMock: vi.fn(),
  getTeamMock: vi.fn(),
}))

vi.mock('../api/teams', () => ({
  teamsApi: {
    getMemberTranscript: getMemberTranscriptMock,
    getWorkbenchForSession: getWorkbenchForSessionMock,
    getWorkbench: getWorkbenchMock,
    list: vi.fn(),
    get: getTeamMock,
    sendMemberMessage: vi.fn(),
    delete: vi.fn(),
  },
}))

function userMessage(id: string, content: string, timestamp: number, pending = false): UIMessage {
  return {
    id,
    type: 'user_text',
    content,
    timestamp,
    ...(pending ? { pending: true } : {}),
  }
}

function workbench(version: string, taskStatus: 'pending' | 'in_progress' | 'completed'): TeamWorkbenchSnapshot {
  return {
    version,
    generatedAt: `2026-08-08T00:00:0${version.slice(-1)}.000Z`,
    team: {
      name: 'team-workbench',
      leadAgentId: 'lead@team-workbench',
      leadSessionId: 'lead-session',
      members: [
        { agentId: 'lead@team-workbench', name: 'lead', role: 'lead', status: 'running' },
        { agentId: 'worker@team-workbench', name: 'worker', role: 'worker', status: 'running' },
      ],
    },
    tasks: [{
      id: '1',
      subject: 'Build workbench',
      description: 'Exercise the state reducer',
      status: taskStatus,
      owner: 'worker',
      blocks: [],
      blockedBy: [],
      taskListId: 'team-workbench',
    }],
    messages: [],
  }
}

describe('teamStore incremental transcript polling', () => {
  beforeEach(() => {
    getMemberTranscriptMock.mockReset()
    getWorkbenchForSessionMock.mockReset()
    getWorkbenchMock.mockReset()
    getTeamMock.mockReset()
    useTeamStore.getState().clearTeam()
    useChatStore.setState({ sessions: {} })
  })

  afterEach(() => {
    useTeamStore.getState().stopMemberPolling()
    useTeamStore.getState().clearTeam()
    useTabStore.getState().closeTab('team-member:idle-worker@team-idle')
    vi.useRealTimers()
  })

  it('appends unseen messages once and removes a matching pending echo', () => {
    const pending = userMessage('pending-1', 'please review', 1_000, true)
    const existing = [userMessage('durable-1', 'old', 500), pending]
    const delta = [
      userMessage('server-1', 'please review', 1_100),
      userMessage('server-1', 'please review', 1_100),
    ]

    const merged = mergeMemberTranscriptDelta(existing, delta)

    expect(merged.map(message => message.id)).toEqual(['durable-1', 'server-1'])
  })

  it('ignores a stale transcript response that resolves after a newer poll', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    getMemberTranscriptMock
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce({
        messages: [{
          id: 'new-message',
          type: 'user',
          content: 'new',
          timestamp: '2026-01-01T00:00:02.000Z',
        }],
        signature: 'new-signature',
        cursor: 'new-cursor',
        afterOrdinal: 1,
      })
    useTeamStore.setState({
      activeTeam: {
        name: 'team-1',
        members: [{
          agentId: 'agent-1',
          role: 'worker',
          status: 'running',
        }],
      },
    })
    const sessionId = 'team-member:agent-1'

    const oldPoll = useTeamStore.getState().refreshMemberSession(sessionId)
    await useTeamStore.getState().refreshMemberSession(sessionId)
    resolveOld({
      messages: [{
        id: 'old-message',
        type: 'user',
        content: 'old',
        timestamp: '2026-01-01T00:00:01.000Z',
      }],
      signature: 'old-signature',
      cursor: 'old-cursor',
      afterOrdinal: 0,
    })
    await oldPoll

    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    expect(messages.map(message => message.id)).toEqual(['new-message'])
  })

  it('replaces a cursor-backed transcript when a legacy sidecar omits cursor metadata', async () => {
    const fullSnapshot = {
      messages: [
        {
          id: 'deleted-message',
          type: 'user',
          content: 'removed by the legacy full snapshot',
          timestamp: '2026-01-01T00:00:01.000Z',
        },
        {
          id: 'kept-message',
          type: 'user',
          content: 'still present',
          timestamp: '2026-01-01T00:00:02.000Z',
        },
      ],
      signature: 'cursor-signature',
      cursor: 'cursor-token',
      afterOrdinal: 1,
    }
    const legacySnapshot = {
      messages: [{
        id: 'kept-message',
        type: 'user',
        content: 'still present',
        timestamp: '2026-01-01T00:00:02.000Z',
      }],
    }
    getMemberTranscriptMock
      .mockResolvedValueOnce(fullSnapshot)
      .mockResolvedValueOnce(legacySnapshot)
      .mockResolvedValueOnce(legacySnapshot)
    useTeamStore.setState({
      activeTeam: {
        name: 'team-legacy',
        members: [{
          agentId: 'agent-legacy',
          role: 'worker',
          status: 'running',
        }],
      },
    })
    const sessionId = 'team-member:agent-legacy'

    await useTeamStore.getState().refreshMemberSession(sessionId)
    await useTeamStore.getState().refreshMemberSession(sessionId)

    expect(getMemberTranscriptMock.mock.calls[1]?.[2]).toMatchObject({
      signature: 'cursor-signature',
      cursor: 'cursor-token',
      afterOrdinal: 1,
    })
    expect(
      useChatStore.getState().sessions[sessionId]?.messages.map(message => message.id),
    ).toEqual(['kept-message'])

    await useTeamStore.getState().refreshMemberSession(sessionId)
    expect(getMemberTranscriptMock.mock.calls[2]?.[2]).toEqual({})
  })

  it('keeps polling an idle member tab so a resumed reply appears in the same conversation', async () => {
    vi.useFakeTimers()
    getMemberTranscriptMock
      .mockResolvedValueOnce({
        messages: [{
          id: 'before-resume',
          type: 'assistant',
          content: [{ type: 'text', text: 'Initial review complete.' }],
          timestamp: '2026-01-01T00:00:01.000Z',
        }],
        signature: 'signature-1',
        cursor: 'cursor-1',
        afterOrdinal: 0,
      })
      .mockResolvedValueOnce({
        messages: [{
          id: 'after-resume',
          type: 'assistant',
          content: [{ type: 'text', text: 'Follow-up review complete.' }],
          timestamp: '2026-01-01T00:00:02.000Z',
        }],
        signature: 'signature-2',
        cursor: 'cursor-2',
        afterOrdinal: 1,
      })
    const member = {
      agentId: 'idle-worker@team-idle',
      name: 'idle-worker',
      role: 'security-reviewer',
      status: 'idle' as const,
    }
    getTeamMock.mockResolvedValue({
      name: 'team-idle',
      leadAgentId: 'lead@team-idle',
      members: [member],
    })

    await useTeamStore.getState().fetchTeamDetail('team-idle')
    useTeamStore.getState().openMemberSession(member)
    await vi.advanceTimersByTimeAsync(0)
    expect(getMemberTranscriptMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_500)

    expect(getMemberTranscriptMock).toHaveBeenCalledTimes(2)
    expect(
      useChatStore.getState().sessions['team-member:idle-worker@team-idle']?.messages
        .filter(message => message.type === 'assistant_text')
        .map(message => message.content),
    ).toEqual(['Initial review complete.', 'Follow-up review complete.'])
  })

  it('opens an archived member once with lead identity and does not start live polling', async () => {
    vi.useFakeTimers()
    getMemberTranscriptMock.mockResolvedValue({
      messages: [{
        id: 'archived-tool-call',
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'bun test' } }],
        timestamp: '2026-08-08T00:00:00.000Z',
      }],
      signature: 'archive-signature',
      cursor: 'archive-cursor',
      afterOrdinal: 0,
    })
    const member = {
      agentId: 'reviewer@archived-team',
      name: 'reviewer',
      role: 'security-reviewer',
      status: 'completed' as const,
    }
    useTeamStore.setState({
      activeTeam: {
        name: 'archived-team',
        leadAgentId: 'team-lead@archived-team',
        leadSessionId: 'archived-lead-session',
        members: [member],
      },
    })

    useTeamStore.getState().openMemberSession(member)
    await vi.advanceTimersByTimeAsync(0)

    expect(getMemberTranscriptMock).toHaveBeenCalledWith(
      'archived-team',
      'reviewer@archived-team',
      { leadSessionId: 'archived-lead-session' },
    )
    await vi.advanceTimersByTimeAsync(2_000)
    expect(getMemberTranscriptMock).toHaveBeenCalledTimes(1)
    useTabStore.getState().closeTab('team-member:reviewer@archived-team')
  })
})

describe('teamStore workbench timeline', () => {
  beforeEach(() => {
    vi.useRealTimers()
    getWorkbenchForSessionMock.mockReset()
    getWorkbenchMock.mockReset()
    useTeamStore.getState().clearTeam()
  })

  afterEach(() => {
    useTeamStore.getState().clearTeam()
  })

  it('keeps collecting live snapshots while the user remains on a historical state', async () => {
    getWorkbenchMock
      .mockResolvedValueOnce(workbench('v1', 'pending'))
      .mockResolvedValueOnce(workbench('v2', 'in_progress'))
      .mockResolvedValueOnce(workbench('v3', 'completed'))

    await useTeamStore.getState().fetchWorkbench('team-workbench')
    await useTeamStore.getState().fetchWorkbench('team-workbench')
    useTeamStore.getState().setWorkbenchHistoryIndex('lead-session', 0)
    useTeamStore.getState().handleTeamWorkbenchUpdated('team-workbench')
    await vi.waitFor(() => {
      expect(useTeamStore.getState().workbenchesBySession['lead-session']?.snapshots).toHaveLength(3)
    })

    const state = useTeamStore.getState()
    expect(state.workbenchHistoryIndexBySession['lead-session']).toBe(0)
    expect(state.workbenchesBySession['lead-session']?.snapshots.map((entry) => entry.version)).toEqual([
      'v1',
      'v2',
      'v3',
    ])
  })

  it('deduplicates unchanged snapshots and appends a durable disbanded tombstone', async () => {
    getWorkbenchMock
      .mockResolvedValueOnce(workbench('v1', 'completed'))
      .mockResolvedValueOnce(workbench('v1', 'completed'))

    await useTeamStore.getState().fetchWorkbench('team-workbench')
    await useTeamStore.getState().fetchWorkbench('team-workbench')
    expect(useTeamStore.getState().workbenchesBySession['lead-session']?.snapshots).toHaveLength(1)

    useTeamStore.getState().handleTeamDeleted('team-workbench')
    const snapshots = useTeamStore.getState().workbenchesBySession['lead-session']?.snapshots ?? []
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1]).toMatchObject({
      version: 'v1:deleted',
      team: {
        members: [
          expect.objectContaining({ status: 'completed' }),
          expect.objectContaining({ status: 'completed' }),
        ],
      },
    })
    expect(snapshots[1]?.deletedAt).toBeTruthy()
  })

  it('restores an archived workbench by lead session without forcing it open', async () => {
    const archived = {
      ...workbench('v9', 'completed'),
      deletedAt: '2026-08-08T00:10:00.000Z',
    }
    getWorkbenchForSessionMock.mockResolvedValue({
      sessionId: 'lead-session',
      teamName: 'team-workbench',
      source: 'archive',
      snapshots: [archived],
    })

    await useTeamStore.getState().fetchTeamForSession('lead-session')

    const state = useTeamStore.getState()
    expect(getWorkbenchForSessionMock).toHaveBeenCalledWith('lead-session')
    expect(state.workbenchesBySession['lead-session']).toMatchObject({
      teamName: 'team-workbench',
      snapshots: [expect.objectContaining({ version: 'v9', deletedAt: archived.deletedAt })],
    })
    expect(state.activeTeam?.name).toBe('team-workbench')
    // Discovery must not open the panel — that is the header strip's job, and
    // auto-opening evicted the workspace panel and compacted the transcript.
    expect(isAgentTeamsWorkbenchOpen(state, 'lead-session')).toBe(false)

    state.setWorkbenchOpen('lead-session', true)
    expect(isAgentTeamsWorkbenchOpen(useTeamStore.getState(), 'lead-session')).toBe(true)
  })

  it('never reports the workbench open for a session that has no timeline', () => {
    const state = useTeamStore.getState()
    state.setWorkbenchOpen('session-without-team', true)

    expect(isAgentTeamsWorkbenchOpen(useTeamStore.getState(), 'session-without-team')).toBe(false)
    expect(isAgentTeamsWorkbenchOpen(useTeamStore.getState(), null)).toBe(false)
  })

  it('keeps a restored workbench available after closing and reopening it', async () => {
    getWorkbenchForSessionMock.mockResolvedValue({
      sessionId: 'lead-session',
      teamName: 'team-workbench',
      source: 'transcript',
      snapshots: [workbench('v8', 'completed')],
    })
    await useTeamStore.getState().fetchTeamForSession('lead-session')

    useTeamStore.getState().setWorkbenchOpen('lead-session', false)
    expect(useTeamStore.getState().workbenchOpenBySession['lead-session']).toBe(false)
    expect(useTeamStore.getState().workbenchesBySession['lead-session']?.snapshots).toHaveLength(1)

    useTeamStore.getState().toggleWorkbench('lead-session')
    expect(useTeamStore.getState().workbenchOpenBySession['lead-session']).toBe(true)
    expect(useTeamStore.getState().workbenchesBySession['lead-session']?.snapshots[0]?.version).toBe('v8')
  })

  it('does not mistake the lead session for the synthetic team-lead conversation', () => {
    useTeamStore.setState({
      activeTeam: {
        name: 'team-workbench',
        leadAgentId: 'lead@team-workbench',
        leadSessionId: 'lead-session',
        members: [{
          agentId: 'lead@team-workbench',
          name: 'lead',
          role: 'lead',
          status: 'completed',
          sessionId: 'lead-session',
        }],
      },
    })

    expect(useTeamStore.getState().getMemberBySessionId('lead-session')).toBeNull()
    expect(
      useTeamStore.getState().getMemberBySessionId('team-member:lead@team-workbench'),
    ).toMatchObject({ agentId: 'lead@team-workbench' })
  })
})
