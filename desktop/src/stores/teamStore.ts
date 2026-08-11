import { create } from 'zustand'
import { teamsApi } from '../api/teams'
import type {
  TeamSummary,
  TeamDetail,
  TeamMember,
  AgentColor,
  TeamWorkbenchSnapshot,
  TeamWorkbenchTimeline,
} from '../types/team'
import { AGENT_COLORS } from '../types/team'
import type { TeamMemberStatus, UIMessage } from '../types/chat'
import { useChatStore, mapHistoryMessagesToUiMessages } from './chatStore'
import { useTabStore } from './tabStore'

const MEMBER_POLL_INTERVAL_MS = 1500
const MEMBER_TRANSCRIPT_MATCH_WINDOW_MS = 120_000
const WORKBENCH_HISTORY_LIMIT = 200
/**
 * Sized against the workspace panel rather than the workbench's own content:
 * both share the one right-hand slot, and a wider default was what squeezed the
 * chat column past the point where its 900px reading measure survives.
 */
export const AGENT_TEAMS_WORKBENCH_DEFAULT_WIDTH = 480
export const AGENT_TEAMS_WORKBENCH_MIN_WIDTH = 380
export const AGENT_TEAMS_WORKBENCH_MAX_WIDTH = 720

/** Generate a synthetic sessionId for team member tabs */
export const memberSessionId = (agentId: string) => `team-member:${agentId}`

/** Module-level timer for polling member transcript */
let memberPollTimer: ReturnType<typeof setInterval> | null = null
let polledMemberSessionId: string | null = null
const memberTranscriptCursors = new Map<string, {
  teamName: string
  agentId: string
  signature: string
  cursor: string
  afterOrdinal: number
}>()
const memberRefreshGenerations = new Map<string, number>()
const workbenchRefreshGenerations = new Map<string, number>()

/**
 * The workbench opens on an explicit user gesture, never on discovery. Auto
 * expanding it took over the one right-hand slot, hid the workspace and
 * activity entries, and compacted the transcript the moment a team appeared.
 */
export function isAgentTeamsWorkbenchOpen(
  state: Pick<TeamStore, 'workbenchesBySession' | 'workbenchOpenBySession'>,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false
  if (!state.workbenchesBySession[sessionId]?.snapshots.length) return false
  return state.workbenchOpenBySession[sessionId] === true
}

export function clampAgentTeamsWorkbenchWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_TEAMS_WORKBENCH_DEFAULT_WIDTH
  return Math.min(
    AGENT_TEAMS_WORKBENCH_MAX_WIDTH,
    Math.max(AGENT_TEAMS_WORKBENCH_MIN_WIDTH, Math.round(width)),
  )
}

function createMemberSessionState() {
  return {
    messages: [] as UIMessage[],
    chatState: 'idle' as const,
    connectionState: 'connected' as const,
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    streamingResponseChars: 0,
    elapsedSeconds: 0,
    statusVerb: '',
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
  }
}

function normalizeMemberStatus(status: string | undefined): TeamMember['status'] {
  if (status === 'running' || status === 'idle' || status === 'completed') {
    return status
  }
  return status === 'failed' ? 'error' : 'idle'
}

function toTeamMember(raw: Record<string, unknown>): TeamMember {
  return {
    agentId: (raw.agentId as string) || '',
    name: raw.name as string | undefined,
    role:
      (raw.agentType as string) ||
      (raw.role as string) ||
      (raw.name as string) ||
      (raw.agentId as string) ||
      '',
    status: normalizeMemberStatus(raw.status as string | undefined),
    currentTask: raw.currentTask as string | undefined,
    color: raw.color as AgentColor | undefined,
    sessionId: raw.sessionId as string | undefined,
  }
}

function toTeamDetail(raw: Record<string, unknown>): TeamDetail {
  const rawMembers = Array.isArray(raw.members) ? raw.members : []
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    leadAgentId: typeof raw.leadAgentId === 'string' ? raw.leadAgentId : undefined,
    leadSessionId: typeof raw.leadSessionId === 'string' ? raw.leadSessionId : undefined,
    members: rawMembers.map((member) => toTeamMember(member as Record<string, unknown>)),
    createdAt: raw.createdAt != null ? String(raw.createdAt) : undefined,
  }
}

function memberColorsForTeam(team: TeamDetail): Map<string, AgentColor> {
  const colors = new Map<string, AgentColor>()
  team.members.forEach((member, index) => {
    colors.set(member.agentId, AGENT_COLORS[index % AGENT_COLORS.length]!)
  })
  return colors
}

function appendWorkbenchSnapshot(
  timeline: TeamWorkbenchTimeline | undefined,
  snapshot: TeamWorkbenchSnapshot,
): TeamWorkbenchTimeline {
  if (timeline?.snapshots.at(-1)?.version === snapshot.version) {
    return { ...timeline, loading: false, error: null }
  }
  const snapshots = [...(timeline?.snapshots ?? []), snapshot].slice(-WORKBENCH_HISTORY_LIMIT)
  return {
    teamName: snapshot.team.name,
    snapshots,
    loading: false,
    error: null,
  }
}

/**
 * A member transcript stays worth polling while any surface is showing it: the
 * detached member tab, or a workbench body switched to that member.
 */
function isMemberSessionWatched(
  state: Pick<TeamStore, 'workbenchViewBySession'>,
  memberTabId: string,
  agentId: string,
): boolean {
  if (useTabStore.getState().activeTabId === memberTabId) return true
  return Object.values(state.workbenchViewBySession).some(
    (view) => view?.kind === 'member' && view.agentId === agentId,
  )
}

function isPendingMemberMessage(message: UIMessage): message is Extract<UIMessage, { type: 'user_text' }> & { pending: true } {
  return message.type === 'user_text' && message.pending === true
}

function transcriptAlreadyContainsMessage(
  transcriptMessages: UIMessage[],
  pendingMessage: Extract<UIMessage, { type: 'user_text' }> & { pending: true },
): boolean {
  return transcriptMessages.some((message) => (
    message.type === 'user_text' &&
    message.pending !== true &&
    message.content === pendingMessage.content &&
    Math.abs(message.timestamp - pendingMessage.timestamp) <= MEMBER_TRANSCRIPT_MATCH_WINDOW_MS
  ))
}

function mergeMemberTranscriptMessages(
  existingMessages: UIMessage[],
  transcriptMessages: UIMessage[],
): UIMessage[] {
  const pendingMessages = existingMessages.filter(isPendingMemberMessage).filter(
    (message) => !transcriptAlreadyContainsMessage(transcriptMessages, message),
  )

  return pendingMessages.length > 0
    ? [...transcriptMessages, ...pendingMessages]
    : transcriptMessages
}

export function mergeMemberTranscriptDelta(
  existingMessages: UIMessage[],
  deltaMessages: UIMessage[],
): UIMessage[] {
  const durableMessages = existingMessages.filter(message => !isPendingMemberMessage(message))
  const existingIds = new Set(durableMessages.map(message => message.id))
  const appended = deltaMessages.filter((message) => {
    if (existingIds.has(message.id)) return false
    existingIds.add(message.id)
    return true
  })
  const pendingMessages = existingMessages.filter(isPendingMemberMessage).filter(
    message => !transcriptAlreadyContainsMessage(deltaMessages, message),
  )
  return [...durableMessages, ...appended, ...pendingMessages]
}

function syncMemberSessionMessages(
  sessionId: string,
  memberStatus: TeamMember['status'],
  messages: UIMessage[],
) {
  const hasPendingMessages = messages.some(isPendingMemberMessage)
  useChatStore.setState((state) => {
    const existing = state.sessions[sessionId]
    const nextState = existing ?? createMemberSessionState()
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...nextState,
          messages,
          connectionState: 'connected',
          chatState:
            memberStatus === 'running' || hasPendingMessages
              ? 'thinking'
              : 'idle',
        },
      },
    }
  })
}

/** Which face of the workbench is showing: the team map, or one member's run. */
export type WorkbenchView =
  | { kind: 'overview' }
  | { kind: 'member'; agentId: string }

type TeamStore = {
  teams: TeamSummary[]
  activeTeam: TeamDetail | null
  memberColors: Map<string, AgentColor>
  error: string | null
  workbenchesBySession: Record<string, TeamWorkbenchTimeline | undefined>
  workbenchHistoryIndexBySession: Record<string, number | null | undefined>
  workbenchOpenBySession: Record<string, boolean | undefined>
  workbenchViewBySession: Record<string, WorkbenchView | undefined>
  workbenchPanelWidth: number

  fetchTeams: () => Promise<void>
  fetchTeamDetail: (name: string) => Promise<void>
  fetchTeamForSession: (sessionId: string) => Promise<void>
  fetchWorkbench: (teamName: string) => Promise<void>
  setWorkbenchHistoryIndex: (sessionId: string, index: number | null) => void
  setWorkbenchOpen: (sessionId: string, open: boolean) => void
  toggleWorkbench: (sessionId: string) => void
  setWorkbenchView: (sessionId: string, view: WorkbenchView) => void
  openMemberInWorkbench: (sessionId: string, member: TeamMember, team?: TeamDetail) => void
  setWorkbenchPanelWidth: (width: number) => void
  getMemberBySessionId: (sessionId: string) => TeamMember | null
  refreshMemberSession: (sessionId: string) => Promise<void>
  openMemberSession: (member: TeamMember, team?: TeamDetail) => void
  sendMessageToMember: (sessionId: string, content: string) => Promise<void>
  startMemberPolling: (sessionId: string, force?: boolean) => void
  stopMemberPolling: () => void
  clearTeam: () => void

  // WebSocket handlers
  handleTeamCreated: (teamName: string) => void
  handleTeamUpdate: (teamName: string, members: TeamMemberStatus[]) => void
  handleTeamWorkbenchUpdated: (teamName: string) => void
  handleTeamDeleted: (teamName: string) => void
}

export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: [],
  activeTeam: null,
  memberColors: new Map(),
  error: null,
  workbenchesBySession: {},
  workbenchHistoryIndexBySession: {},
  workbenchOpenBySession: {},
  workbenchViewBySession: {},
  workbenchPanelWidth: AGENT_TEAMS_WORKBENCH_DEFAULT_WIDTH,

  fetchTeams: async () => {
    set({ error: null })
    try {
      const { teams } = await teamsApi.list()
      set({ teams })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  fetchTeamDetail: async (name: string) => {
    set({ error: null })
    try {
      const raw = await teamsApi.get(name) as Record<string, unknown>
      const detail = toTeamDetail(raw)
      set({ activeTeam: detail, memberColors: memberColorsForTeam(detail) })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  fetchTeamForSession: async (sessionId) => {
    const known = get().workbenchesBySession[sessionId]
    if (known?.snapshots.length) return

    try {
      const timeline = await teamsApi.getWorkbenchForSession(sessionId)
      const snapshots = timeline.snapshots.slice(-WORKBENCH_HISTORY_LIMIT)
      const latest = snapshots.at(-1)
      if (!latest) return
      const detail = toTeamDetail(latest.team as unknown as Record<string, unknown>)
      set((state) => ({
        activeTeam: detail,
        memberColors: memberColorsForTeam(detail),
        workbenchesBySession: {
          ...state.workbenchesBySession,
          [sessionId]: {
            teamName: timeline.teamName,
            snapshots,
            loading: false,
            error: null,
          },
        },
      }))
    } catch {
      // Workbench discovery supplements the session; an ordinary conversation
      // or a legacy sidecar must still open without an error surface.
    }
  },

  fetchWorkbench: async (teamName) => {
    const generation = (workbenchRefreshGenerations.get(teamName) ?? 0) + 1
    workbenchRefreshGenerations.set(teamName, generation)
    const knownSessionId = Object.entries(get().workbenchesBySession)
      .find(([, timeline]) => timeline?.teamName === teamName)?.[0]
    if (knownSessionId) {
      set((state) => ({
        workbenchesBySession: {
          ...state.workbenchesBySession,
          [knownSessionId]: {
            ...state.workbenchesBySession[knownSessionId]!,
            loading: true,
            error: null,
          },
        },
      }))
    }

    try {
      const raw = await teamsApi.getWorkbench(teamName)
      if (workbenchRefreshGenerations.get(teamName) !== generation) return
      const team = toTeamDetail(raw.team as unknown as Record<string, unknown>)
      const snapshot: TeamWorkbenchSnapshot = { ...raw, team }
      const sessionId = team.leadSessionId
      if (!sessionId) return

      set((state) => ({
        activeTeam: team,
        memberColors: memberColorsForTeam(team),
        workbenchesBySession: {
          ...state.workbenchesBySession,
          [sessionId]: appendWorkbenchSnapshot(
            state.workbenchesBySession[sessionId],
            snapshot,
          ),
        },
      }))
    } catch (err) {
      if (workbenchRefreshGenerations.get(teamName) !== generation) return
      const message = err instanceof Error ? err.message : String(err)
      const sessionId = Object.entries(get().workbenchesBySession)
        .find(([, timeline]) => timeline?.teamName === teamName)?.[0]
      if (!sessionId) return
      set((state) => ({
        workbenchesBySession: {
          ...state.workbenchesBySession,
          [sessionId]: {
            ...state.workbenchesBySession[sessionId]!,
            loading: false,
            error: message,
          },
        },
      }))
    }
  },

  setWorkbenchHistoryIndex: (sessionId, index) => set((state) => {
    const snapshots = state.workbenchesBySession[sessionId]?.snapshots ?? []
    const nextIndex = index === null
      ? null
      : Math.max(0, Math.min(snapshots.length - 1, Math.round(index)))
    return {
      workbenchHistoryIndexBySession: {
        ...state.workbenchHistoryIndexBySession,
        [sessionId]: nextIndex,
      },
    }
  }),

  setWorkbenchOpen: (sessionId, open) => set((state) => ({
    workbenchOpenBySession: {
      ...state.workbenchOpenBySession,
      [sessionId]: open,
    },
  })),

  toggleWorkbench: (sessionId) => set((state) => ({
    workbenchOpenBySession: {
      ...state.workbenchOpenBySession,
      [sessionId]: state.workbenchOpenBySession[sessionId] !== true,
    },
  })),

  setWorkbenchView: (sessionId, view) => set((state) => ({
    workbenchViewBySession: {
      ...state.workbenchViewBySession,
      [sessionId]: view,
    },
  })),

  /**
   * Selecting a teammate swaps the workbench's own body instead of opening a
   * tab, so the team map stays one click away. The member transcript still
   * loads through the same poll path a detached member tab uses.
   */
  openMemberInWorkbench: (sessionId, member, requestedTeam) => {
    const team = requestedTeam ?? get().activeTeam
    if (team && get().activeTeam?.name !== team.name) {
      set({ activeTeam: team, memberColors: memberColorsForTeam(team) })
    }
    set((state) => ({
      workbenchViewBySession: {
        ...state.workbenchViewBySession,
        [sessionId]: { kind: 'member', agentId: member.agentId },
      },
    }))

    const memberTabId = memberSessionId(member.agentId)
    void get().refreshMemberSession(memberTabId)
    if (member.status === 'running' || member.status === 'idle') {
      get().startMemberPolling(memberTabId)
    }
  },

  setWorkbenchPanelWidth: (width) => set({
    workbenchPanelWidth: clampAgentTeamsWorkbenchWidth(width),
  }),

  getMemberBySessionId: (sessionId: string) => {
    const team = get().activeTeam
    if (!team) return null
    return team.members.find((member) => memberSessionId(member.agentId) === sessionId) ?? null
  },

  refreshMemberSession: async (sessionId) => {
    const team = get().activeTeam
    const member = get().getMemberBySessionId(sessionId)
    if (!team || !member) return

    const generation = (memberRefreshGenerations.get(sessionId) ?? 0) + 1
    memberRefreshGenerations.set(sessionId, generation)
    const previousCursor = memberTranscriptCursors.get(sessionId)
    const cursorMatchesMember = previousCursor?.teamName === team.name &&
      previousCursor.agentId === member.agentId

    try {
      const response = await teamsApi.getMemberTranscript(
        team.name,
        member.agentId,
        {
          ...(cursorMatchesMember ? previousCursor : {}),
          ...(team.leadSessionId ? { leadSessionId: team.leadSessionId } : {}),
        },
      )
      if (memberRefreshGenerations.get(sessionId) !== generation) return
      const currentTeam = get().activeTeam
      const currentMember = get().getMemberBySessionId(sessionId)
      if (
        currentTeam?.name !== team.name ||
        currentMember?.agentId !== member.agentId
      ) return
      const { messages } = response
      const asEntries = messages.map((msg) => ({
        id: msg.id,
        type: msg.type,
        content: msg.content,
        timestamp: msg.timestamp,
        model: msg.model,
        parentToolUseId: msg.parentToolUseId,
        // Structured tool output drives the richer result renderers; omitting
        // it here flattened every member tool call back to plain text.
        toolUseResult: msg.toolUseResult,
      }))
      const transcriptMessages = mapHistoryMessagesToUiMessages(
        asEntries as Parameters<typeof mapHistoryMessagesToUiMessages>[0],
        { includeTeammateMessages: true },
      )
      const existingMessages = useChatStore.getState().sessions[sessionId]?.messages ?? []
      const hasIncrementalMetadata = typeof response.signature === 'string' &&
        typeof response.cursor === 'string' &&
        response.afterOrdinal !== undefined
      const mergedMessages = cursorMatchesMember && !response.reset && hasIncrementalMetadata
        ? mergeMemberTranscriptDelta(existingMessages, transcriptMessages)
        : mergeMemberTranscriptMessages(existingMessages, transcriptMessages)
      if (hasIncrementalMetadata) {
        memberTranscriptCursors.set(sessionId, {
          teamName: team.name,
          agentId: member.agentId,
          signature: response.signature!,
          cursor: response.cursor!,
          afterOrdinal: response.afterOrdinal!,
        })
      } else {
        memberTranscriptCursors.delete(sessionId)
      }
      syncMemberSessionMessages(sessionId, member.status, mergedMessages)
    } catch {
      if (memberRefreshGenerations.get(sessionId) !== generation) return
      const existingMessages = useChatStore.getState().sessions[sessionId]?.messages ?? []
      syncMemberSessionMessages(sessionId, member.status, existingMessages)
    }
  },

  openMemberSession: (member: TeamMember, requestedTeam?: TeamDetail) => {
    const team = requestedTeam ?? get().activeTeam
    if (!team) return

    if (get().activeTeam?.name !== team.name) {
      set({ activeTeam: team, memberColors: memberColorsForTeam(team) })
    }

    get().stopMemberPolling()

    const tabId = memberSessionId(member.agentId)
    useTabStore.getState().openTab(tabId, member.role, 'session')
    void get().refreshMemberSession(tabId)
    if (member.status === 'running' || member.status === 'idle') {
      get().startMemberPolling(tabId)
    }
  },

  sendMessageToMember: async (sessionId, content) => {
    const team = get().activeTeam
    const member = get().getMemberBySessionId(sessionId)
    if (!team || !member) {
      throw new Error('Team member session is no longer available')
    }

    await teamsApi.sendMemberMessage(team.name, member.agentId, content)
    get().startMemberPolling(sessionId, true)
    await get().refreshMemberSession(sessionId)
  },

  startMemberPolling: (sessionId, force = false) => {
    const member = get().getMemberBySessionId(sessionId)
    if (!member) return

    if (!force && polledMemberSessionId === sessionId && memberPollTimer) {
      return
    }

    get().stopMemberPolling()
    polledMemberSessionId = sessionId
    memberPollTimer = setInterval(() => {
      // A member transcript is watched either through its own tab or through a
      // workbench body showing that member; polling only on the former stopped
      // the embedded view dead on its first tick.
      if (!isMemberSessionWatched(get(), sessionId, member.agentId)) {
        get().stopMemberPolling()
        return
      }
      void get().refreshMemberSession(sessionId)
    }, MEMBER_POLL_INTERVAL_MS)
  },

  stopMemberPolling: () => {
    if (memberPollTimer) {
      clearInterval(memberPollTimer)
      memberPollTimer = null
    }
    polledMemberSessionId = null
  },

  clearTeam: () => {
    get().stopMemberPolling()
    memberTranscriptCursors.clear()
    memberRefreshGenerations.clear()
    workbenchRefreshGenerations.clear()
    set({
      activeTeam: null,
      memberColors: new Map(),
      workbenchesBySession: {},
      workbenchHistoryIndexBySession: {},
      workbenchOpenBySession: {},
      workbenchViewBySession: {},
    })
  },

  handleTeamCreated: (teamName: string) => {
    set((s) => ({
      teams: [...s.teams, { name: teamName, memberCount: 0 }],
    }))
    void get().fetchTeamDetail(teamName)
    void get().fetchWorkbench(teamName)
    setTimeout(() => {
      void get().fetchTeamDetail(teamName)
      void get().fetchWorkbench(teamName)
    }, 1500)
    setTimeout(() => {
      void get().fetchTeamDetail(teamName)
      void get().fetchWorkbench(teamName)
    }, 4000)
    setTimeout(() => {
      void get().fetchTeamDetail(teamName)
      void get().fetchWorkbench(teamName)
    }, 8000)
  },

  handleTeamUpdate: (teamName: string, members: TeamMemberStatus[]) => {
    const team = get().activeTeam
    if (team && team.name === teamName) {
      if (members.length === 0) return

      if (members.length > team.members.length) {
        get().fetchTeamDetail(teamName)
      }

      const colors = get().memberColors
      const existingMap = new Map(team.members.map((m) => [m.agentId, m]))
      const incomingIds = new Set(members.map((m) => m.agentId))
      const kept = team.members.filter((m) => !incomingIds.has(m.agentId))
      const updatedMembers: TeamMember[] = [
        ...kept,
        ...members.map((m, i) => {
          const existing = existingMap.get(m.agentId)
          return {
            ...(existing ?? {}),
            name: existing?.name,
            agentId: m.agentId,
            role: m.role,
            status: normalizeMemberStatus(m.status),
            currentTask: m.currentTask,
            color: colors.get(m.agentId) ?? AGENT_COLORS[i % AGENT_COLORS.length]!,
            sessionId: existing?.sessionId,
          }
        }),
      ]
      set({ activeTeam: { ...team, members: updatedMembers } })

      const currentTabId = useTabStore.getState().activeTabId
      if (currentTabId) {
        const viewedMember = get().getMemberBySessionId(currentTabId)
        if (viewedMember) {
          void get().refreshMemberSession(currentTabId)
          get().startMemberPolling(currentTabId)
        }
      }
    }
  },

  handleTeamWorkbenchUpdated: (teamName: string) => {
    void get().fetchTeamDetail(teamName)
    void get().fetchWorkbench(teamName)
  },

  handleTeamDeleted: (teamName: string) => {
    get().stopMemberPolling()
    memberTranscriptCursors.clear()
    memberRefreshGenerations.clear()
    workbenchRefreshGenerations.delete(teamName)
    set((state) => {
      const deletedAt = new Date().toISOString()
      const workbenchesBySession = { ...state.workbenchesBySession }
      for (const [sessionId, timeline] of Object.entries(workbenchesBySession)) {
        if (!timeline || timeline.teamName !== teamName) continue
        const latest = timeline.snapshots.at(-1)
        if (!latest || latest.deletedAt) continue
        const tombstone: TeamWorkbenchSnapshot = {
          ...latest,
          version: `${latest.version}:deleted`,
          generatedAt: deletedAt,
          deletedAt,
          team: {
            ...latest.team,
            members: latest.team.members.map((member) => ({
              ...member,
              status: 'completed' as const,
            })),
          },
        }
        workbenchesBySession[sessionId] = appendWorkbenchSnapshot(timeline, tombstone)
      }

      return {
        teams: state.teams.filter((team) => team.name !== teamName),
        activeTeam: state.activeTeam?.name === teamName
          ? {
              ...state.activeTeam,
              members: state.activeTeam.members.map((member) => ({
                ...member,
                status: 'completed' as const,
              })),
            }
          : state.activeTeam,
        workbenchesBySession,
      }
    })
  },
}))
