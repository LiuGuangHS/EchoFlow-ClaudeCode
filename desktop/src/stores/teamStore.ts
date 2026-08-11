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
import { AGENT_COLORS, teamMemberSessionId } from '../types/team'
import type {
  AgentTaskNotification,
  TeamMemberStatus,
  UIMessage,
} from '../types/chat'
import { runningTaskForMember } from '../components/agentTeams/agentTeamsModel'
import {
  useChatStore,
  mapHistoryMessagesToUiMessages,
  mergeReconstructedRunActivity,
  reconstructRunActivityFromTranscript,
} from './chatStore'
import { useTabStore } from './tabStore'
import { useActivityPanelStore } from './activityPanelStore'
import type { MessageEntry } from '../types/session'

const MEMBER_POLL_INTERVAL_MS = 1500
const MEMBER_TRANSCRIPT_MATCH_WINDOW_MS = 120_000
const WORKBENCH_HISTORY_LIMIT = 200
const TEAM_DISCOVERY_TTL_MS = 5_000

/** Generate a synthetic sessionId for team member tabs */
export const memberSessionId = teamMemberSessionId

/** Module-level timer for polling member transcript */
let memberPollTimer: ReturnType<typeof setInterval> | null = null
let polledMemberSessionId: string | null = null
const memberTranscriptCursors = new Map<string, {
  teamName: string
  agentId: string
  incarnationId?: string
  signature: string
  cursor: string
  afterOrdinal: number
}>()
const memberTranscriptEntries = new Map<string, MessageEntry[]>()
const memberTranscriptNotifications = new Map<string, AgentTaskNotification[]>()
const memberRefreshGenerations = new Map<string, number>()
const memberRefreshRequests = new Map<string, {
  storeGeneration: number
  lifecycleGeneration: number
  incarnationKey: string
  token: object
  promise: Promise<void>
}>()
const initialMemberSessionLoads = new Map<string, Promise<void>>()
const workbenchRefreshGenerations = new Map<string, number>()
type AwaitingMemberReply = {
  content: string
  sentAt: number
  baselineMessageKeys: Set<string>
}
const awaitingMemberReplies = new Map<string, AwaitingMemberReply[]>()
const teamLifecycleGenerations = new Map<string, number>()
const teamDiscoveryGenerations = new Map<string, number>()
const teamDiscoveryCompletedAt = new Map<string, number>()
const deletedTeamNames = new Set<string>()
const deletedTeamIncarnations = new Set<string>()
const deletedTeamLifecycles = new Map<string, {
  leadSessionId?: string
  incarnationId?: string
  createdAt?: number
  deletedAt: number
}>()
const teamRetryTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>()
let teamStoreGeneration = 0

function clearTeamRetryTimers(teamName?: string) {
  const entries = teamName
    ? [[teamName, teamRetryTimers.get(teamName) ?? []] as const]
    : Array.from(teamRetryTimers.entries())
  for (const [name, timers] of entries) {
    timers.forEach(clearTimeout)
    teamRetryTimers.delete(name)
  }
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
    backgroundAgentTasks: {},
    historyMutationEpoch: 0,
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
    incarnationId: typeof raw.incarnationId === 'string' ? raw.incarnationId : undefined,
    leadAgentId: typeof raw.leadAgentId === 'string' ? raw.leadAgentId : undefined,
    leadSessionId: typeof raw.leadSessionId === 'string' ? raw.leadSessionId : undefined,
    members: rawMembers.map((member) => toTeamMember(member as Record<string, unknown>)),
    createdAt: raw.createdAt != null ? String(raw.createdAt) : undefined,
  }
}

export function teamIdentityKey(team: TeamDetail): string | undefined {
  if (team.incarnationId) return team.incarnationId
  if (!team.createdAt || !team.leadSessionId) return undefined
  return `legacy:${team.name}:${team.leadSessionId}:${team.createdAt}`
}

function memberSessionIdForTeam(team: TeamDetail, member: TeamMember): string {
  return memberSessionId(member.agentId, teamIdentityKey(team))
}

function memberColorsForTeam(team: TeamDetail): Map<string, AgentColor> {
  const colors = new Map<string, AgentColor>()
  team.members.forEach((member, index) => {
    colors.set(member.agentId, AGENT_COLORS[index % AGENT_COLORS.length]!)
  })
  return colors
}

function memberIncarnationKey(team: TeamDetail, member: TeamMember): string {
  return [
    teamIdentityKey(team) ?? team.name,
    member.agentId,
    member.sessionId ?? '',
  ].join('\u0000')
}

function memberMatchesIdentity(member: TeamMember, value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  return [member.agentId, member.name, member.role]
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) => {
      const comparable = candidate.trim().toLowerCase()
      return comparable === normalized || comparable.split('@')[0] === normalized.split('@')[0]
    })
}

function snapshotForTeamActivity(
  snapshots: TeamWorkbenchSnapshot[],
  teamName: string,
  startedAt: number,
): TeamWorkbenchSnapshot | undefined {
  const matchingIncarnation = snapshots
    .filter((snapshot) => snapshot.team.name === teamName)
    .map((snapshot) => ({
      snapshot,
      identity: teamIdentityKey(snapshot.team),
      createdAt: teamTimestamp(snapshot.team.createdAt, Number.NEGATIVE_INFINITY),
      deletedAt: snapshot.deletedAt
        ? teamTimestamp(snapshot.deletedAt, Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY,
    }))
    .filter((candidate) => (
      candidate.createdAt <= startedAt && startedAt <= candidate.deletedAt
    ))
    .sort((left, right) => right.createdAt - left.createdAt)[0]
  if (!matchingIncarnation) return undefined
  return [...snapshots].reverse().find((snapshot) => (
    teamIdentityKey(snapshot.team) === matchingIncarnation.identity
  )) ?? matchingIncarnation.snapshot
}

function mergeTeamMemberStatuses(
  team: TeamDetail,
  incoming: TeamMemberStatus[],
): TeamDetail {
  if (incoming.length === 0) return team
  const existingById = new Map(team.members.map((member) => [member.agentId, member]))
  const incomingIds = new Set(incoming.map((member) => member.agentId))
  const kept = team.members.filter((member) => !incomingIds.has(member.agentId))
  const updated = incoming.map((member, index): TeamMember => {
    const existing = existingById.get(member.agentId)
    return {
      ...(existing ?? {}),
      name: existing?.name,
      agentId: member.agentId,
      role: member.role,
      status: normalizeMemberStatus(member.status),
      currentTask: member.currentTask,
      color: existing?.color ?? AGENT_COLORS[index % AGENT_COLORS.length]!,
      sessionId: existing?.sessionId,
    }
  })
  return { ...team, members: [...kept, ...updated] }
}

function teamTimestamp(value: string | undefined, fallback = Date.now()): number {
  if (!value) return fallback
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function teamMatchesLifecycle(
  team: TeamDetail,
  teamName: string,
  leadSessionId?: string,
  identity?: TeamLifecycleIdentity,
): boolean {
  if (team.name !== teamName) return false
  if (identity?.incarnationId) {
    return team.incarnationId === identity.incarnationId
  }
  if (identity?.createdAt !== undefined) {
    return teamTimestamp(team.createdAt, Number.NaN) === identity.createdAt && (
      !leadSessionId || team.leadSessionId === leadSessionId
    )
  }
  if (leadSessionId) return team.leadSessionId === leadSessionId
  return true
}

function teamIsDeleted(team: TeamDetail): boolean {
  return deletedTeamNames.has(team.name) || Boolean(
    team.incarnationId && deletedTeamIncarnations.has(team.incarnationId),
  )
}

export function teamTaskWindowsForSnapshot(
  snapshot: TeamWorkbenchSnapshot | undefined,
  activeStartedAt: number | undefined,
): Array<{ startedAt: number; endedAt?: number }> {
  const snapshotStartedAt = snapshot?.team.createdAt
    ? teamTimestamp(snapshot.team.createdAt, Number.NaN)
    : Number.NaN
  const startedAt = Number.isFinite(snapshotStartedAt) ? snapshotStartedAt : activeStartedAt
  if (startedAt === undefined) return []

  const snapshotEndedAt = snapshot?.deletedAt
    ? teamTimestamp(snapshot.deletedAt, Number.NaN)
    : Number.NaN
  return [{
    startedAt,
    ...(Number.isFinite(snapshotEndedAt) ? { endedAt: snapshotEndedAt } : {}),
  }]
}

function updateActiveTeamScope(
  teamNameBySession: Record<string, string | undefined>,
  activeTeamStartedAtBySession: Record<string, number | undefined>,
  sessionId: string,
  teamName?: string,
  startedAt?: number,
) {
  const nextNames = { ...teamNameBySession }
  const nextStartedAt = { ...activeTeamStartedAtBySession }
  if (teamName) {
    nextNames[sessionId] = teamName
    nextStartedAt[sessionId] = startedAt ?? Date.now()
  } else {
    delete nextNames[sessionId]
    delete nextStartedAt[sessionId]
  }
  return {
    teamNameBySession: nextNames,
    activeTeamStartedAtBySession: nextStartedAt,
  }
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

function teamForMemberSession(
  state: Pick<TeamStore, 'activeTeam' | 'memberTeamBySession' | 'workbenchesBySession'>,
  sessionId: string,
): TeamDetail | null {
  const tab = useTabStore.getState().tabs.find((candidate) => candidate.sessionId === sessionId)
  const leadSessionId = tab?.teamLeadSessionId ?? tab?.sourceSessionId
  const tabTeam = leadSessionId
    ? state.workbenchesBySession[leadSessionId]?.snapshots.at(-1)?.team
    : undefined
  if (tabTeam?.members.some((member) => memberSessionIdForTeam(tabTeam, member) === sessionId)) {
    return tabTeam
  }

  const openedTeam = state.memberTeamBySession[sessionId]
  if (openedTeam?.members.some((member) => memberSessionIdForTeam(openedTeam, member) === sessionId)) {
    return openedTeam
  }

  for (const timeline of Object.values(state.workbenchesBySession)) {
    const team = timeline?.snapshots.at(-1)?.team
    if (team?.members.some((member) => memberSessionIdForTeam(team, member) === sessionId)) {
      return team
    }
  }

  return state.activeTeam?.members.some((member) => (
    memberSessionIdForTeam(state.activeTeam!, member) === sessionId
  ))
    ? state.activeTeam
    : null
}

/** A member transcript stays worth polling while its shared run desktop is active. */
function isMemberSessionWatched(memberTabId: string): boolean {
  return useTabStore.getState().activeTabId === memberTabId
}

function isPendingMemberMessage(message: UIMessage): message is Extract<UIMessage, { type: 'user_text' }> & { pending: true } {
  return message.type === 'user_text' && message.pending === true
}

function pendingMessagesWithoutTranscriptEcho(
  pendingMessages: Array<Extract<UIMessage, { type: 'user_text' }> & { pending: true }>,
  transcriptMessages: UIMessage[],
): UIMessage[] {
  const availableEchoes = transcriptMessages.filter((message): message is Extract<UIMessage, { type: 'user_text' }> => (
    message.type === 'user_text' &&
    message.pending !== true &&
    !message.teammateFrom
  ))
  return pendingMessages.filter((pendingMessage) => {
    const matchIndex = availableEchoes.findIndex((message) => (
      message.content === pendingMessage.content &&
      Math.abs(message.timestamp - pendingMessage.timestamp) <= MEMBER_TRANSCRIPT_MATCH_WINDOW_MS
    ))
    if (matchIndex < 0) return true
    availableEchoes.splice(matchIndex, 1)
    return false
  })
}

export function mergeMemberTranscriptMessages(
  existingMessages: UIMessage[],
  transcriptMessages: UIMessage[],
): UIMessage[] {
  const seenIds = new Set<string>()
  const durableMessages = transcriptMessages.filter((message) => {
    if (seenIds.has(message.id)) return false
    seenIds.add(message.id)
    return true
  })
  const pendingMessages = pendingMessagesWithoutTranscriptEcho(
    existingMessages.filter(isPendingMemberMessage),
    durableMessages,
  )

  return pendingMessages.length > 0
    ? [...durableMessages, ...pendingMessages]
    : durableMessages
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
  const pendingMessages = pendingMessagesWithoutTranscriptEcho(
    existingMessages.filter(isPendingMemberMessage),
    appended,
  )
  return [...durableMessages, ...appended, ...pendingMessages]
}

function latestWorkbenchSnapshotForTeam(
  workbenchesBySession: Record<string, TeamWorkbenchTimeline | undefined>,
  team: TeamDetail,
): TeamWorkbenchSnapshot | undefined {
  const leadTimeline = team.leadSessionId
    ? workbenchesBySession[team.leadSessionId]
    : undefined
  const identity = teamIdentityKey(team)
  const matchesTeam = (snapshot: TeamWorkbenchSnapshot | undefined) => Boolean(
    snapshot &&
    snapshot.team.name === team.name &&
    snapshot.team.leadSessionId === team.leadSessionId &&
    teamIdentityKey(snapshot.team) === identity,
  )
  if (matchesTeam(leadTimeline?.snapshots.at(-1))) {
    return leadTimeline!.snapshots.at(-1)
  }
  return Object.values(workbenchesBySession)
    .find((timeline) => matchesTeam(timeline?.snapshots.at(-1)))
    ?.snapshots.at(-1)
}

function memberHasActiveTask(
  member: TeamMember,
  snapshot: TeamWorkbenchSnapshot | undefined,
): boolean {
  if (member.status === 'completed' || member.status === 'error' || snapshot?.deletedAt) {
    return false
  }
  if (!snapshot) return member.status === 'running'

  return Boolean(runningTaskForMember(snapshot.tasks, member))
}

function memberMessageKey(message: UIMessage): string {
  const transcriptMessageId = 'transcriptMessageId' in message
    ? message.transcriptMessageId
    : undefined
  return `${message.type}:${transcriptMessageId ?? message.id}`
}

function isMemberTurnMessage(message: UIMessage): boolean {
  return message.type === 'user_text' ||
    message.type === 'assistant_text' ||
    message.type === 'thinking' ||
    message.type === 'tool_use' ||
    message.type === 'tool_result' ||
    message.type === 'permission_request' ||
    message.type === 'error'
}

function memberReplySettlement(
  messages: UIMessage[],
  awaiting: AwaitingMemberReply,
): { settled: boolean; promptKey?: string } {
  let promptIndex = -1
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (
      message.type === 'user_text' &&
      message.pending !== true &&
      !message.teammateFrom &&
      !awaiting.baselineMessageKeys.has(memberMessageKey(message)) &&
      message.content === awaiting.content &&
      Math.abs(message.timestamp - awaiting.sentAt) <= MEMBER_TRANSCRIPT_MATCH_WINDOW_MS
    ) {
      promptIndex = index
      break
    }
  }
  if (promptIndex < 0) return { settled: false }

  let turnEnd = messages.length
  const nextPromptOffset = messages.slice(promptIndex + 1).findIndex((message) => (
    message.type === 'user_text' &&
    !message.teammateFrom
  ))
  if (nextPromptOffset >= 0) {
    turnEnd = promptIndex + 1 + nextPromptOffset
  }
  const turnMessages = messages
    .slice(promptIndex + 1, turnEnd)
    .filter(isMemberTurnMessage)
  const lastMessage = turnMessages.at(-1)
  return {
    settled: lastMessage?.type === 'assistant_text' || lastMessage?.type === 'error',
    promptKey: memberMessageKey(messages[promptIndex]!),
  }
}

function removeAwaitingMemberReply(sessionId: string, reply: AwaitingMemberReply) {
  const remainingReplies = (awaitingMemberReplies.get(sessionId) ?? [])
    .filter((candidate) => candidate !== reply)
  if (remainingReplies.length > 0) awaitingMemberReplies.set(sessionId, remainingReplies)
  else awaitingMemberReplies.delete(sessionId)
}

function mergeTranscriptEntries(
  existingEntries: MessageEntry[],
  incomingEntries: MessageEntry[],
): MessageEntry[] {
  const seenIds = new Set(existingEntries.map(entry => entry.id))
  return [
    ...existingEntries,
    ...incomingEntries.filter((entry) => {
      if (seenIds.has(entry.id)) return false
      seenIds.add(entry.id)
      return true
    }),
  ]
}

function mergeTranscriptNotifications(
  existing: AgentTaskNotification[],
  incoming: AgentTaskNotification[],
): AgentTaskNotification[] {
  const merged = new Map(existing.map((notification) => [notification.toolUseId, notification]))
  for (const notification of incoming) {
    merged.set(notification.toolUseId, notification)
  }
  return [...merged.values()]
}

function syncMemberSessionMessages(
  sessionId: string,
  member: TeamMember,
  snapshot: TeamWorkbenchSnapshot | undefined,
  messages: UIMessage[],
  activity?: ReturnType<typeof reconstructRunActivityFromTranscript>,
  requestedMutationEpoch?: number,
  requestedTaskUpdatedAt?: Map<string, number>,
) {
  const isTerminal = member.status === 'completed' ||
    member.status === 'error' ||
    Boolean(snapshot?.deletedAt)
  const awaitingReplies = awaitingMemberReplies.get(sessionId) ?? []
  const unsettledReplies: AwaitingMemberReply[] = []
  if (!isTerminal) {
    awaitingReplies.forEach((reply, index) => {
      const settlement = memberReplySettlement(messages, reply)
      if (settlement.promptKey) {
        for (let laterIndex = index + 1; laterIndex < awaitingReplies.length; laterIndex += 1) {
          awaitingReplies[laterIndex]!.baselineMessageKeys.add(settlement.promptKey)
        }
      }
      if (!settlement.settled) unsettledReplies.push(reply)
    })
  }
  if (unsettledReplies.length === 0) {
    awaitingMemberReplies.delete(sessionId)
  } else if (unsettledReplies.length !== awaitingReplies.length) {
    awaitingMemberReplies.set(sessionId, unsettledReplies)
  }
  const isActive = !isTerminal && (
    memberHasActiveTask(member, snapshot) ||
    unsettledReplies.length > 0
  )
  useChatStore.setState((state) => {
    const existing = state.sessions[sessionId]
    const nextState = existing ?? createMemberSessionState()
    const mutationEpochChanged = requestedMutationEpoch !== undefined &&
      (nextState.historyMutationEpoch ?? 0) !== requestedMutationEpoch
    const taskFreshnessChanged = existing && Object.values(
      existing.backgroundAgentTasks ?? {},
    ).some((task) => {
        const requestedAt = requestedTaskUpdatedAt?.get(task.taskId) ?? (
          task.toolUseId ? requestedTaskUpdatedAt?.get(task.toolUseId) : undefined
        )
        return requestedAt === undefined || task.updatedAt > requestedAt
      })
    const preferCurrentActivity = Boolean(mutationEpochChanged || taskFreshnessChanged)
    const mergedActivity = activity && preferCurrentActivity
      ? mergeReconstructedRunActivity(
          {
            agentTaskNotifications: existing?.agentTaskNotifications ?? {},
            backgroundAgentTasks: existing?.backgroundAgentTasks ?? {},
          },
          activity,
          { preferCurrent: true },
        )
      : activity
    if (mergedActivity && preferCurrentActivity) {
      const notifications = { ...mergedActivity.agentTaskNotifications }
      for (const [toolUseId, notification] of Object.entries(notifications)) {
        if (existing?.agentTaskNotifications[toolUseId]) continue
        const runningTask = Object.values(mergedActivity.backgroundAgentTasks).find((task) => (
          task.status === 'running' &&
          (task.toolUseId === toolUseId || task.taskId === notification.taskId)
        ))
        const notificationAt = notification.timestamp
          ? Date.parse(notification.timestamp)
          : Number.NaN
        if (
          runningTask &&
          (!Number.isFinite(notificationAt) || notificationAt < runningTask.startedAt)
        ) {
          delete notifications[toolUseId]
        }
      }
      mergedActivity.agentTaskNotifications = notifications
    }
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...nextState,
          messages,
          ...(activity ? {
            agentTaskNotifications: mergedActivity!.agentTaskNotifications,
            backgroundAgentTasks: mergedActivity!.backgroundAgentTasks,
          } : {}),
          connectionState: 'connected',
          chatState: isActive ? 'thinking' : 'idle',
        },
      },
    }
  })
}

function syncTeamMemberSessions(
  team: TeamDetail,
  snapshot: TeamWorkbenchSnapshot | undefined,
) {
  const sessions = useChatStore.getState().sessions
  for (const member of team.members) {
    const sessionId = memberSessionIdForTeam(team, member)
    const session = sessions[sessionId]
    if (!session) continue
    syncMemberSessionMessages(sessionId, member, snapshot, session.messages)
  }
}

function clearMemberSessionState(sessionIds: Iterable<string>): void {
  const ids = new Set(sessionIds)
  if (ids.size === 0) return
  for (const sessionId of ids) {
    memberTranscriptCursors.delete(sessionId)
    memberTranscriptEntries.delete(sessionId)
    memberTranscriptNotifications.delete(sessionId)
    memberRefreshRequests.delete(sessionId)
    memberRefreshGenerations.set(
      sessionId,
      (memberRefreshGenerations.get(sessionId) ?? 0) + 1,
    )
    initialMemberSessionLoads.delete(sessionId)
    awaitingMemberReplies.delete(sessionId)
  }
  useChatStore.setState((state) => {
    const sessions = { ...state.sessions }
    for (const sessionId of ids) delete sessions[sessionId]
    return { sessions }
  })
  useActivityPanelStore.setState((state) => {
    const selectedSectionBySession = { ...state.selectedSectionBySession }
    const dismissedBackgroundTaskKeysBySession = {
      ...state.dismissedBackgroundTaskKeysBySession,
    }
    for (const sessionId of ids) {
      delete selectedSectionBySession[sessionId]
      delete dismissedBackgroundTaskKeysBySession[sessionId]
    }
    return {
      openSessionId: state.openSessionId && ids.has(state.openSessionId)
        ? null
        : state.openSessionId,
      selectedSectionBySession,
      dismissedBackgroundTaskKeysBySession,
    }
  })
}

export type TeamLifecycleIdentity = {
  incarnationId?: string
  createdAt?: number
}

type TeamStore = {
  teams: TeamSummary[]
  activeTeam: TeamDetail | null
  memberColors: Map<string, AgentColor>
  error: string | null
  workbenchesBySession: Record<string, TeamWorkbenchTimeline | undefined>
  workbenchHistoryIndexBySession: Record<string, number | null | undefined>
  teamNameBySession: Record<string, string | undefined>
  activeTeamStartedAtBySession: Record<string, number | undefined>
  memberTeamBySession: Record<string, TeamDetail | undefined>
  memberSnapshotBySession: Record<string, TeamWorkbenchSnapshot | undefined>
  memberOwnerAgentIdsBySession: Record<string, string[] | undefined>

  fetchTeams: () => Promise<void>
  fetchTeamDetail: (name: string) => Promise<void>
  fetchTeamForSession: (sessionId: string, options?: { force?: boolean }) => Promise<void>
  fetchWorkbench: (teamName: string) => Promise<void>
  setWorkbenchHistoryIndex: (sessionId: string, index: number | null) => void
  getTeamByMemberSessionId: (sessionId: string) => TeamDetail | null
  getMemberBySessionId: (sessionId: string) => TeamMember | null
  refreshMemberSession: (sessionId: string) => Promise<void>
  ensureMemberSession: (sessionId: string) => Promise<void>
  openMemberFromActivity: (
    leadSessionId: string,
    teamName: string,
    memberName: string,
    startedAt: number,
  ) => Promise<boolean>
  openMemberSession: (
    member: TeamMember,
    team?: TeamDetail,
    snapshot?: TeamWorkbenchSnapshot,
  ) => void
  sendMessageToMember: (sessionId: string, content: string) => Promise<void>
  startMemberPolling: (sessionId: string, force?: boolean) => void
  stopMemberPolling: () => void
  clearTeam: () => void

  // WebSocket handlers
  handleTeamCreated: (
    teamName: string,
    leadSessionId: string,
    identity?: TeamLifecycleIdentity,
  ) => void
  handleTeamUpdate: (
    teamName: string,
    members: TeamMemberStatus[],
    identity?: TeamLifecycleIdentity,
  ) => void
  handleTeamWorkbenchUpdated: (
    teamName: string,
    identity?: TeamLifecycleIdentity,
  ) => void
  handleTeamDeleted: (
    teamName: string,
    leadSessionId?: string,
    identity?: TeamLifecycleIdentity,
  ) => void
}

export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: [],
  activeTeam: null,
  memberColors: new Map(),
  error: null,
  workbenchesBySession: {},
  workbenchHistoryIndexBySession: {},
  teamNameBySession: {},
  activeTeamStartedAtBySession: {},
  memberTeamBySession: {},
  memberSnapshotBySession: {},
  memberOwnerAgentIdsBySession: {},

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
    if (deletedTeamNames.has(name)) return
    const storeGeneration = teamStoreGeneration
    const lifecycleGeneration = teamLifecycleGenerations.get(name) ?? 0
    set({ error: null })
    try {
      const raw = await teamsApi.get(name) as Record<string, unknown>
      const detail = toTeamDetail(raw)
      if (
        deletedTeamNames.has(name) ||
        teamIsDeleted(detail) ||
        teamStoreGeneration !== storeGeneration ||
        (teamLifecycleGenerations.get(name) ?? 0) !== lifecycleGeneration
      ) return
      set((state) => ({
        activeTeam: detail,
        memberColors: memberColorsForTeam(detail),
        ...(detail.leadSessionId ? {
          ...updateActiveTeamScope(
            state.teamNameBySession,
            state.activeTeamStartedAtBySession,
            detail.leadSessionId,
            detail.name,
            teamTimestamp(detail.createdAt),
          ),
        } : {}),
      }))
      syncTeamMemberSessions(
        detail,
        latestWorkbenchSnapshotForTeam(get().workbenchesBySession, detail),
      )
    } catch (err) {
      if (
        deletedTeamNames.has(name) ||
        teamStoreGeneration !== storeGeneration ||
        (teamLifecycleGenerations.get(name) ?? 0) !== lifecycleGeneration
      ) return
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  fetchTeamForSession: async (sessionId, options) => {
    const known = get().workbenchesBySession[sessionId]
    if (known?.snapshots.length) {
      const latest = known.snapshots.at(-1)!
      set((state) => updateActiveTeamScope(
        state.teamNameBySession,
        state.activeTeamStartedAtBySession,
        sessionId,
        latest.deletedAt ? undefined : known.teamName,
        teamTimestamp(latest.team.createdAt),
      ))
      const lastDurableDiscovery = teamDiscoveryCompletedAt.get(sessionId) ?? 0
      if (
        !options?.force &&
        !latest.deletedAt &&
        Date.now() - lastDurableDiscovery < TEAM_DISCOVERY_TTL_MS
      ) return
    }

    const storeGeneration = teamStoreGeneration
    const discoveryGeneration = (teamDiscoveryGenerations.get(sessionId) ?? 0) + 1
    teamDiscoveryGenerations.set(sessionId, discoveryGeneration)
    try {
      const timeline = await teamsApi.getWorkbenchForSession(sessionId)
      if (
        teamStoreGeneration !== storeGeneration ||
        teamDiscoveryGenerations.get(sessionId) !== discoveryGeneration
      ) return
      const snapshots = timeline.snapshots.slice(-WORKBENCH_HISTORY_LIMIT).map((snapshot) => {
        const team = toTeamDetail(snapshot.team as unknown as Record<string, unknown>)
        if (!team.incarnationId && timeline.incarnationId) {
          team.incarnationId = timeline.incarnationId
        }
        return { ...snapshot, team }
      })
      const latest = snapshots.at(-1)
      if (!latest) return
      const detail = latest.team
      const previousTeam = known?.snapshots.at(-1)?.team
      let obsoleteMemberSessionIds: string[] = []
      if (
        previousTeam &&
        teamIdentityKey(previousTeam) !== teamIdentityKey(detail)
      ) {
        obsoleteMemberSessionIds = previousTeam.members.map((member) => (
          memberSessionIdForTeam(previousTeam, member)
        ))
      }
      const deletedLifecycle = deletedTeamLifecycles.get(timeline.teamName)
      const discoveredCreatedAt = detail.createdAt
        ? teamTimestamp(detail.createdAt, Number.NaN)
        : Number.NaN
      const isNewIncarnation = Boolean(
        deletedLifecycle && (
          (
            detail.incarnationId &&
            deletedLifecycle.incarnationId &&
            detail.incarnationId !== deletedLifecycle.incarnationId
          ) ||
          (
            detail.leadSessionId &&
            deletedLifecycle.leadSessionId &&
            detail.leadSessionId !== deletedLifecycle.leadSessionId
          ) ||
          (
            Number.isFinite(discoveredCreatedAt) &&
            discoveredCreatedAt > deletedLifecycle.deletedAt
          )
        ),
      )
      if (
        teamIsDeleted(detail) &&
        !latest.deletedAt &&
        !isNewIncarnation
      ) return
      if (isNewIncarnation) {
        deletedTeamNames.delete(timeline.teamName)
        deletedTeamLifecycles.delete(timeline.teamName)
        teamLifecycleGenerations.set(
          timeline.teamName,
          (teamLifecycleGenerations.get(timeline.teamName) ?? 0) + 1,
        )
      }
      clearMemberSessionState(obsoleteMemberSessionIds)
      for (const obsoleteSessionId of obsoleteMemberSessionIds) {
        useTabStore.getState().closeTab(obsoleteSessionId)
      }
      set((state) => ({
        activeTeam: detail,
        memberColors: memberColorsForTeam(detail),
        memberTeamBySession: Object.fromEntries(
          Object.entries(state.memberTeamBySession).filter(([memberSessionId]) => (
            !obsoleteMemberSessionIds.includes(memberSessionId)
          )),
        ),
        memberSnapshotBySession: Object.fromEntries(
          Object.entries(state.memberSnapshotBySession).filter(([memberSessionId]) => (
            !obsoleteMemberSessionIds.includes(memberSessionId)
          )),
        ),
        memberOwnerAgentIdsBySession: Object.fromEntries(
          Object.entries(state.memberOwnerAgentIdsBySession).filter(([memberSessionId]) => (
            !obsoleteMemberSessionIds.includes(memberSessionId)
          )),
        ),
        ...updateActiveTeamScope(
          state.teamNameBySession,
          state.activeTeamStartedAtBySession,
          sessionId,
          latest.deletedAt ? undefined : timeline.teamName,
          teamTimestamp(detail.createdAt),
        ),
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
      syncTeamMemberSessions(detail, latest)
      teamDiscoveryCompletedAt.set(sessionId, Date.now())
    } catch {
      // Workbench discovery supplements the session; an ordinary conversation
      // or a legacy sidecar must still open without an error surface.
    }
  },

  fetchWorkbench: async (teamName) => {
    if (deletedTeamNames.has(teamName)) return
    const storeGeneration = teamStoreGeneration
    const lifecycleGeneration = teamLifecycleGenerations.get(teamName) ?? 0
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
      const team = toTeamDetail(raw.team as unknown as Record<string, unknown>)
      if (
        workbenchRefreshGenerations.get(teamName) !== generation ||
        teamStoreGeneration !== storeGeneration ||
        (teamLifecycleGenerations.get(teamName) ?? 0) !== lifecycleGeneration ||
        teamIsDeleted(team)
      ) return
      const snapshot: TeamWorkbenchSnapshot = { ...raw, team }
      const sessionId = team.leadSessionId
      if (!sessionId) return

      set((state) => ({
        activeTeam: team,
        memberColors: memberColorsForTeam(team),
        ...updateActiveTeamScope(
          state.teamNameBySession,
          state.activeTeamStartedAtBySession,
          sessionId,
          snapshot.deletedAt ? undefined : team.name,
          teamTimestamp(team.createdAt),
        ),
        workbenchesBySession: {
          ...state.workbenchesBySession,
          [sessionId]: appendWorkbenchSnapshot(
            state.workbenchesBySession[sessionId],
            snapshot,
          ),
        },
      }))
      syncTeamMemberSessions(team, snapshot)
    } catch (err) {
      if (
        workbenchRefreshGenerations.get(teamName) !== generation ||
        teamStoreGeneration !== storeGeneration ||
        (teamLifecycleGenerations.get(teamName) ?? 0) !== lifecycleGeneration ||
        deletedTeamNames.has(teamName)
      ) return
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

  getTeamByMemberSessionId: (sessionId: string) => teamForMemberSession(get(), sessionId),

  getMemberBySessionId: (sessionId: string) => {
    const team = get().getTeamByMemberSessionId(sessionId)
    if (!team) return null
    return team.members.find((member) => memberSessionIdForTeam(team, member) === sessionId) ?? null
  },

  refreshMemberSession: (sessionId) => {
    const team = get().getTeamByMemberSessionId(sessionId)
    const member = get().getMemberBySessionId(sessionId)
    if (!team || !member) return Promise.resolve()

    const storeGeneration = teamStoreGeneration
    const lifecycleGeneration = teamLifecycleGenerations.get(team.name) ?? 0
    const incarnationKey = memberIncarnationKey(team, member)
    const requestedSession = useChatStore.getState().sessions[sessionId]
    const requestedMutationEpoch = requestedSession?.historyMutationEpoch ?? 0
    const requestedTaskUpdatedAt = new Map<string, number>()
    for (const task of Object.values(requestedSession?.backgroundAgentTasks ?? {})) {
      requestedTaskUpdatedAt.set(task.taskId, task.updatedAt)
      if (task.toolUseId) requestedTaskUpdatedAt.set(task.toolUseId, task.updatedAt)
    }
    const inFlight = memberRefreshRequests.get(sessionId)
    if (
      inFlight?.storeGeneration === storeGeneration &&
      inFlight.lifecycleGeneration === lifecycleGeneration &&
      inFlight.incarnationKey === incarnationKey
    ) {
      return inFlight.promise
    }
    const generation = (memberRefreshGenerations.get(sessionId) ?? 0) + 1
    memberRefreshGenerations.set(sessionId, generation)
    const previousCursor = memberTranscriptCursors.get(sessionId)
    const cursorMatchesMember = previousCursor?.teamName === team.name &&
      previousCursor.agentId === member.agentId &&
      previousCursor.incarnationId === teamIdentityKey(team)

    const operation = (async () => {
      try {
        const response = await teamsApi.getMemberTranscript(
          team.name,
          member.agentId,
          {
            ...(cursorMatchesMember ? previousCursor : {}),
            ...(team.leadSessionId ? { leadSessionId: team.leadSessionId } : {}),
            ...(team.incarnationId ? { incarnationId: team.incarnationId } : {}),
          },
        )
        const currentTeam = get().getTeamByMemberSessionId(sessionId)
        const currentMember = get().getMemberBySessionId(sessionId)
        if (
          memberRefreshGenerations.get(sessionId) !== generation ||
          teamStoreGeneration !== storeGeneration ||
          (teamLifecycleGenerations.get(team.name) ?? 0) !== lifecycleGeneration ||
          currentTeam?.name !== team.name ||
          currentMember?.agentId !== member.agentId ||
          memberIncarnationKey(currentTeam, currentMember) !== incarnationKey
        ) return
        const { messages } = response
        const asEntries: MessageEntry[] = messages.map((msg) => ({
          id: msg.id,
          type: msg.type as MessageEntry['type'],
          content: msg.content,
          timestamp: msg.timestamp,
          model: msg.model,
          parentToolUseId: msg.parentToolUseId,
          // Structured tool output drives the richer result renderers; omitting
          // it here flattened every member tool call back to plain text.
          toolUseResult: msg.toolUseResult,
        }))
        const existingMessages = useChatStore.getState().sessions[sessionId]?.messages ?? []
        const hasIncrementalMetadata = typeof response.signature === 'string' &&
          typeof response.cursor === 'string' &&
          response.afterOrdinal !== undefined
        const existingEntries = memberTranscriptEntries.get(sessionId) ?? []
        const existingNotifications = memberTranscriptNotifications.get(sessionId) ?? []
        const mergedEntries = cursorMatchesMember && !response.reset && hasIncrementalMetadata
          ? mergeTranscriptEntries(existingEntries, asEntries)
          : mergeTranscriptEntries([], asEntries)
        const mergedNotifications = cursorMatchesMember && !response.reset && hasIncrementalMetadata
          ? mergeTranscriptNotifications(existingNotifications, response.taskNotifications ?? [])
          : mergeTranscriptNotifications([], response.taskNotifications ?? [])
        memberTranscriptEntries.set(sessionId, mergedEntries)
        memberTranscriptNotifications.set(sessionId, mergedNotifications)
        const incomingOwnerAgentIds = response.ownerAgentIds ?? []
        set((state) => ({
          memberOwnerAgentIdsBySession: {
            ...state.memberOwnerAgentIdsBySession,
            [sessionId]: response.reset || !cursorMatchesMember
              ? [...new Set(incomingOwnerAgentIds)]
              : [...new Set([
                  ...(state.memberOwnerAgentIdsBySession[sessionId] ?? []),
                  ...incomingOwnerAgentIds,
                ])],
          },
        }))
        // Mapping the complete durable transcript preserves suppression state
        // across cursor pages (for example task-notification follow-up blocks).
        // Pending local sends are merged back only after that projection.
        const transcriptMessages = mapHistoryMessagesToUiMessages(
          mergedEntries,
          { includeTeammateMessages: true },
        )
        const currentMutationEpoch = useChatStore.getState().sessions[sessionId]
          ?.historyMutationEpoch ?? 0
        const mergedMessages = currentMutationEpoch !== requestedMutationEpoch
          ? mergeMemberTranscriptDelta(existingMessages, transcriptMessages)
          : mergeMemberTranscriptMessages(existingMessages, transcriptMessages)
        const activity = reconstructRunActivityFromTranscript(mergedEntries, mergedNotifications)
        if (hasIncrementalMetadata) {
          memberTranscriptCursors.set(sessionId, {
            teamName: team.name,
            agentId: member.agentId,
            incarnationId: teamIdentityKey(team),
            signature: response.signature!,
            cursor: response.cursor!,
            afterOrdinal: response.afterOrdinal!,
          })
        } else {
          memberTranscriptCursors.delete(sessionId)
        }
        const snapshot = latestWorkbenchSnapshotForTeam(
          get().workbenchesBySession,
          currentTeam,
        ) ?? get().memberSnapshotBySession[sessionId]
        syncMemberSessionMessages(
          sessionId,
          currentMember,
          snapshot,
          mergedMessages,
          activity,
          requestedMutationEpoch,
          requestedTaskUpdatedAt,
        )
      } catch {
        const currentTeam = get().getTeamByMemberSessionId(sessionId)
        const currentMember = get().getMemberBySessionId(sessionId)
        if (
          memberRefreshGenerations.get(sessionId) !== generation ||
          teamStoreGeneration !== storeGeneration ||
          (teamLifecycleGenerations.get(team.name) ?? 0) !== lifecycleGeneration ||
          !currentTeam ||
          !currentMember ||
          memberIncarnationKey(currentTeam, currentMember) !== incarnationKey
        ) return
        const existingMessages = useChatStore.getState().sessions[sessionId]?.messages ?? []
        const snapshot = latestWorkbenchSnapshotForTeam(
          get().workbenchesBySession,
          currentTeam,
        ) ?? get().memberSnapshotBySession[sessionId]
        syncMemberSessionMessages(
          sessionId,
          currentMember,
          snapshot,
          existingMessages,
        )
      }
    })()
    const token = {}
    const request = operation.finally(() => {
      if (memberRefreshRequests.get(sessionId)?.token === token) {
        memberRefreshRequests.delete(sessionId)
      }
    })
    memberRefreshRequests.set(sessionId, {
      storeGeneration,
      lifecycleGeneration,
      incarnationKey,
      token,
      promise: request,
    })
    return request
  },

  ensureMemberSession: (sessionId) => {
    const existing = initialMemberSessionLoads.get(sessionId)
    if (existing) return existing

    const request = get().refreshMemberSession(sessionId)
    initialMemberSessionLoads.set(sessionId, request)
    void request.finally(() => {
      if (initialMemberSessionLoads.get(sessionId) === request) {
        initialMemberSessionLoads.delete(sessionId)
      }
    })
    return request
  },

  openMemberFromActivity: async (leadSessionId, teamName, memberName, startedAt) => {
    let snapshot = snapshotForTeamActivity(
      get().workbenchesBySession[leadSessionId]?.snapshots ?? [],
      teamName,
      startedAt,
    )
    if (!snapshot) {
      try {
        const timeline = await teamsApi.getWorkbenchForSession(leadSessionId, {
          teamName,
          at: startedAt,
        })
        const snapshots = timeline.snapshots.map((candidate) => {
          const team = toTeamDetail(candidate.team as unknown as Record<string, unknown>)
          if (!team.incarnationId && timeline.incarnationId) {
            team.incarnationId = timeline.incarnationId
          }
          return { ...candidate, team }
        })
        snapshot = snapshotForTeamActivity(snapshots, teamName, startedAt) ?? snapshots.at(-1)
      } catch {
        return false
      }
    }
    if (!snapshot) return false
    const member = snapshot.team.members.find((candidate) => (
      memberMatchesIdentity(candidate, memberName)
    ))
    if (!member || member.agentId === snapshot.team.leadAgentId) return false
    get().openMemberSession(member, snapshot.team, snapshot)
    return true
  },

  openMemberSession: (member: TeamMember, requestedTeam?: TeamDetail, snapshot?: TeamWorkbenchSnapshot) => {
    const team = requestedTeam ?? get().activeTeam
    if (!team) return

    if (get().activeTeam?.name !== team.name) {
      set({ activeTeam: team, memberColors: memberColorsForTeam(team) })
    }

    get().stopMemberPolling()

    const incarnationId = teamIdentityKey(team)
    const sessionId = memberSessionId(member.agentId, incarnationId)
    set((state) => ({
      memberTeamBySession: {
        ...state.memberTeamBySession,
        [sessionId]: team,
      },
      memberSnapshotBySession: snapshot
        ? {
            ...state.memberSnapshotBySession,
            [sessionId]: snapshot,
          }
        : state.memberSnapshotBySession,
    }))
    // Start the expensive transcript lookup in the click turn. The member
    // page's mount effect joins this promise, including React StrictMode's
    // second development mount, instead of launching another filesystem scan.
    void get().ensureMemberSession(sessionId)

    const tabStore = useTabStore.getState()
    const activeTab = tabStore.tabs.find((tab) => tab.sessionId === tabStore.activeTabId)
    const openedSessionId = tabStore.openTeamMemberTab(
      team.leadSessionId ?? team.name,
      member.agentId,
      member.name || member.role,
      activeTab?.type === 'team' ? activeTab.sessionId : undefined,
      incarnationId,
    )
    const activityPanel = useActivityPanelStore.getState()
    const relatedSessionIds = new Set([
      team.leadSessionId,
      ...team.members.map((teamMember) => memberSessionIdForTeam(team, teamMember)),
    ].filter((value): value is string => Boolean(value)))
    const openPanelTeam = activityPanel.openSessionId
      ? get().getTeamByMemberSessionId(activityPanel.openSessionId)
      : null
    if (
      activityPanel.openSessionId && (
        relatedSessionIds.has(activityPanel.openSessionId) ||
        openPanelTeam?.name === team.name
      )
    ) {
      activityPanel.open(openedSessionId)
    }
  },

  sendMessageToMember: async (sessionId, content) => {
    const team = get().getTeamByMemberSessionId(sessionId)
    const member = get().getMemberBySessionId(sessionId)
    if (!team || !member) {
      throw new Error('Team member session is no longer available')
    }
    const incarnationKey = memberIncarnationKey(team, member)

    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    const optimisticMessage = [...messages].reverse().find((message) => (
      isPendingMemberMessage(message) && message.content === content
    ))
    const awaitingReply: AwaitingMemberReply = {
      content,
      sentAt: optimisticMessage?.timestamp ?? Date.now(),
      baselineMessageKeys: new Set(
        messages
          .filter((message) => message.id !== optimisticMessage?.id)
          .map(memberMessageKey),
      ),
    }
    awaitingMemberReplies.set(sessionId, [
      ...(awaitingMemberReplies.get(sessionId) ?? []),
      awaitingReply,
    ])

    try {
      await teamsApi.sendMemberMessage(team.name, member.agentId, content)
      const currentTeam = get().getTeamByMemberSessionId(sessionId)
      const currentMember = get().getMemberBySessionId(sessionId)
      const snapshot = currentTeam
        ? latestWorkbenchSnapshotForTeam(get().workbenchesBySession, currentTeam) ??
          get().memberSnapshotBySession[sessionId]
        : undefined
      const sessionIsAvailable = Boolean(currentTeam && currentMember) &&
        memberIncarnationKey(currentTeam!, currentMember!) === incarnationKey &&
        currentMember?.agentId === member.agentId &&
        currentMember.status !== 'completed' &&
        currentMember.status !== 'error' &&
        !snapshot?.deletedAt
      if (!sessionIsAvailable) {
        removeAwaitingMemberReply(sessionId, awaitingReply)
        return
      }
      get().startMemberPolling(sessionId, true)
      await get().refreshMemberSession(sessionId)
    } catch (error) {
      removeAwaitingMemberReply(sessionId, awaitingReply)
      throw error
    }
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
      // The shared agent run desktop is ephemeral. Stop as soon as navigation
      // returns to the workbench so a hidden member cannot keep polling.
      if (!isMemberSessionWatched(sessionId)) {
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
    teamStoreGeneration += 1
    get().stopMemberPolling()
    clearMemberSessionState(new Set([
      ...Object.keys(get().memberTeamBySession),
      ...memberTranscriptCursors.keys(),
      ...memberTranscriptEntries.keys(),
    ]))
    memberTranscriptCursors.clear()
    memberTranscriptEntries.clear()
    memberTranscriptNotifications.clear()
    memberRefreshGenerations.clear()
    memberRefreshRequests.clear()
    initialMemberSessionLoads.clear()
    workbenchRefreshGenerations.clear()
    awaitingMemberReplies.clear()
    teamLifecycleGenerations.clear()
    teamDiscoveryGenerations.clear()
    teamDiscoveryCompletedAt.clear()
    deletedTeamNames.clear()
    deletedTeamIncarnations.clear()
    deletedTeamLifecycles.clear()
    clearTeamRetryTimers()
    set({
      activeTeam: null,
      memberColors: new Map(),
      workbenchesBySession: {},
      workbenchHistoryIndexBySession: {},
      teamNameBySession: {},
      activeTeamStartedAtBySession: {},
      memberTeamBySession: {},
      memberSnapshotBySession: {},
      memberOwnerAgentIdsBySession: {},
    })
  },

  handleTeamCreated: (teamName, leadSessionId, identity) => {
    const stateBeforeCreate = get()
    const obsoleteTeams = [
      stateBeforeCreate.activeTeam,
      ...Object.values(stateBeforeCreate.memberTeamBySession),
      ...Object.values(stateBeforeCreate.workbenchesBySession)
        .map((timeline) => timeline?.snapshots.at(-1)?.team),
    ].filter((team): team is TeamDetail => Boolean(
      team &&
      team.name === teamName &&
      !teamMatchesLifecycle(team, teamName, leadSessionId, identity),
    ))
    const obsoleteSessionIds = obsoleteTeams.flatMap((team) => (
      team.members.map((member) => memberSessionIdForTeam(team, member))
    ))
    clearMemberSessionState(obsoleteSessionIds)
    for (const sessionId of obsoleteSessionIds) {
      useTabStore.getState().closeTab(sessionId)
    }
    deletedTeamNames.delete(teamName)
    if (identity?.incarnationId) {
      deletedTeamIncarnations.delete(identity.incarnationId)
    }
    const deletedLifecycle = deletedTeamLifecycles.get(teamName)
    if (
      !deletedLifecycle?.incarnationId ||
      !identity?.incarnationId ||
      deletedLifecycle.incarnationId === identity.incarnationId
    ) {
      deletedTeamLifecycles.delete(teamName)
    }
    teamLifecycleGenerations.set(
      teamName,
      (teamLifecycleGenerations.get(teamName) ?? 0) + 1,
    )
    teamDiscoveryGenerations.set(
      leadSessionId,
      (teamDiscoveryGenerations.get(leadSessionId) ?? 0) + 1,
    )
    teamDiscoveryCompletedAt.delete(leadSessionId)
    clearTeamRetryTimers(teamName)
    set((s) => ({
      teams: [
        ...s.teams.filter((team) => team.name !== teamName),
        {
          name: teamName,
          memberCount: 0,
          ...(identity?.incarnationId ? { incarnationId: identity.incarnationId } : {}),
          ...(identity?.createdAt !== undefined
            ? { createdAt: String(identity.createdAt) }
            : {}),
        },
      ],
      activeTeam: s.activeTeam && obsoleteTeams.includes(s.activeTeam)
        ? null
        : s.activeTeam,
      memberTeamBySession: Object.fromEntries(
        Object.entries(s.memberTeamBySession).filter(([, team]) => (
          !team || !obsoleteTeams.includes(team)
        )),
      ),
      memberSnapshotBySession: Object.fromEntries(
        Object.entries(s.memberSnapshotBySession).filter(([sessionId]) => (
          !obsoleteSessionIds.includes(sessionId)
        )),
      ),
      memberOwnerAgentIdsBySession: Object.fromEntries(
        Object.entries(s.memberOwnerAgentIdsBySession).filter(([sessionId]) => (
          !obsoleteSessionIds.includes(sessionId)
        )),
      ),
      workbenchesBySession: Object.fromEntries(
        Object.entries(s.workbenchesBySession).filter(([sessionId, timeline]) => {
          if (sessionId !== leadSessionId || !timeline) return true
          const latest = timeline.snapshots.at(-1)
          return Boolean(
            latest &&
            !latest.deletedAt &&
            teamMatchesLifecycle(latest.team, teamName, leadSessionId, identity),
          )
        }),
      ),
      // This lifecycle event arrives before the first workbench request can
      // complete. Record ownership synchronously so TaskCreate/TaskUpdate
      // messages emitted in that window cannot be projected into the lead's
      // run-local Activity panel.
      teamNameBySession: {
        ...s.teamNameBySession,
        [leadSessionId]: teamName,
      },
      activeTeamStartedAtBySession: {
        ...s.activeTeamStartedAtBySession,
        [leadSessionId]: identity?.createdAt ?? Date.now(),
      },
    }))
    void get().fetchTeamDetail(teamName)
    void get().fetchWorkbench(teamName)
    teamRetryTimers.set(teamName, [1500, 4000, 8000].map((delay) => setTimeout(() => {
      void get().fetchTeamDetail(teamName)
      void get().fetchWorkbench(teamName)
    }, delay)))
  },

  handleTeamUpdate: (teamName, members, identity) => {
    if (members.length === 0) return
    const state = get()
    const knownTeams = [
      state.activeTeam,
      ...Object.values(state.memberTeamBySession),
      ...Object.values(state.workbenchesBySession)
        .map((timeline) => timeline?.snapshots.at(-1)?.team),
    ].filter((team): team is TeamDetail => Boolean(
      team && teamMatchesLifecycle(team, teamName, team.leadSessionId, identity),
    ))
    const baseTeam = knownTeams[0]
    if (!baseTeam) {
      void get().fetchTeamDetail(teamName)
      void get().fetchWorkbench(teamName)
      return
    }

    if (members.length > baseTeam.members.length) {
      void get().fetchTeamDetail(teamName)
    }

    set((current) => {
      const activeTeam = current.activeTeam && teamMatchesLifecycle(
        current.activeTeam,
        teamName,
        current.activeTeam.leadSessionId,
        identity,
      )
        ? mergeTeamMemberStatuses(current.activeTeam, members)
        : current.activeTeam
      const memberTeamBySession = Object.fromEntries(
        Object.entries(current.memberTeamBySession).map(([sessionId, memberTeam]) => [
          sessionId,
          memberTeam && teamMatchesLifecycle(
            memberTeam,
            teamName,
            memberTeam.leadSessionId,
            identity,
          )
            ? mergeTeamMemberStatuses(memberTeam, members)
            : memberTeam,
        ]),
      )
      const workbenchesBySession = Object.fromEntries(
        Object.entries(current.workbenchesBySession).map(([sessionId, timeline]) => {
          const latestTeam = timeline?.snapshots.at(-1)?.team
          if (
            !timeline ||
            !latestTeam ||
            !teamMatchesLifecycle(latestTeam, teamName, latestTeam.leadSessionId, identity)
          ) {
            return [sessionId, timeline]
          }
          const snapshots = [...timeline.snapshots]
          const latest = snapshots[snapshots.length - 1]!
          snapshots[snapshots.length - 1] = {
            ...latest,
            team: mergeTeamMemberStatuses(latest.team, members),
          }
          return [sessionId, { ...timeline, snapshots }]
        }),
      )
      return {
        activeTeam,
        ...(activeTeam?.name === teamName
          ? { memberColors: memberColorsForTeam(activeTeam) }
          : {}),
        memberTeamBySession,
        workbenchesBySession,
      }
    })

    const updatedTeam = [
      get().activeTeam,
      ...Object.values(get().memberTeamBySession),
    ].find((team): team is TeamDetail => Boolean(
      team && teamMatchesLifecycle(team, teamName, team.leadSessionId, identity),
    ))
    if (updatedTeam) {
      syncTeamMemberSessions(
        updatedTeam,
        latestWorkbenchSnapshotForTeam(get().workbenchesBySession, updatedTeam),
      )
    }

    const currentTabId = useTabStore.getState().activeTabId
    const currentMemberTeam = currentTabId
      ? get().getTeamByMemberSessionId(currentTabId)
      : null
    if (
      currentTabId &&
      currentMemberTeam &&
      teamMatchesLifecycle(
        currentMemberTeam,
        teamName,
        currentMemberTeam.leadSessionId,
        identity,
      )
    ) {
      void get().refreshMemberSession(currentTabId)
      get().startMemberPolling(currentTabId)
    }
  },

  handleTeamWorkbenchUpdated: (teamName, identity) => {
    const knownTeam = [
      get().activeTeam,
      ...Object.values(get().memberTeamBySession),
      ...Object.values(get().workbenchesBySession)
        .map((timeline) => timeline?.snapshots.at(-1)?.team),
    ].find((team): team is TeamDetail => Boolean(
      team && teamMatchesLifecycle(team, teamName, team.leadSessionId, identity),
    ))
    if (identity?.incarnationId && !knownTeam) return
    void get().fetchTeamDetail(teamName)
    void get().fetchWorkbench(teamName)
  },

  handleTeamDeleted: (teamName, leadSessionId, identity) => {
    const deletedAtTimestamp = Date.now()
    const preciseIdentity = Boolean(identity?.incarnationId || identity?.createdAt !== undefined)
    if (identity?.incarnationId) {
      deletedTeamIncarnations.add(identity.incarnationId)
    } else if (!preciseIdentity) {
      deletedTeamNames.add(teamName)
    }
    const currentState = get()
    const knownTeams = [
      currentState.activeTeam,
      ...Object.values(currentState.memberTeamBySession),
      ...Object.values(currentState.workbenchesBySession)
        .map((timeline) => timeline?.snapshots.at(-1)?.team),
    ].filter((team): team is TeamDetail => team?.name === teamName)
    const matchingTeams = knownTeams.filter((team) => (
      teamMatchesLifecycle(team, teamName, leadSessionId, identity)
    ))
    const summaryConflict = currentState.teams.some((team) => (
      team.name === teamName &&
      identity?.incarnationId &&
      team.incarnationId &&
      team.incarnationId !== identity.incarnationId
    ))
    const hasConflictingNewIncarnation = summaryConflict || knownTeams.some((team) => (
      !teamMatchesLifecycle(team, teamName, leadSessionId, identity)
    ))
    const staleAgainstNewIncarnation = preciseIdentity &&
      matchingTeams.length === 0 &&
      hasConflictingNewIncarnation
    if (staleAgainstNewIncarnation) return

    deletedTeamLifecycles.set(teamName, {
      ...(leadSessionId ? { leadSessionId } : {}),
      ...(identity?.incarnationId ? { incarnationId: identity.incarnationId } : {}),
      ...(identity?.createdAt !== undefined ? { createdAt: identity.createdAt } : {}),
      deletedAt: deletedAtTimestamp,
    })
    if (!hasConflictingNewIncarnation) {
      teamLifecycleGenerations.set(
        teamName,
        (teamLifecycleGenerations.get(teamName) ?? 0) + 1,
      )
      clearTeamRetryTimers(teamName)
      workbenchRefreshGenerations.delete(teamName)
    }
    if (leadSessionId && !hasConflictingNewIncarnation) {
      teamDiscoveryGenerations.set(
        leadSessionId,
        (teamDiscoveryGenerations.get(leadSessionId) ?? 0) + 1,
      )
      teamDiscoveryCompletedAt.delete(leadSessionId)
    }
    const affectedMemberSessionIds = new Set(matchingTeams.flatMap((team) => (
      team.members.map((member) => memberSessionIdForTeam(team, member))
    )))
    if (
      polledMemberSessionId &&
      matchingTeams.includes(get().getTeamByMemberSessionId(polledMemberSessionId)!)
    ) {
      affectedMemberSessionIds.add(polledMemberSessionId)
    }
    if (polledMemberSessionId && affectedMemberSessionIds.has(polledMemberSessionId)) {
      get().stopMemberPolling()
    }
    for (const [sessionId, cursor] of memberTranscriptCursors) {
      if (
        cursor.teamName !== teamName ||
        (
          identity?.incarnationId &&
          cursor.incarnationId !== identity.incarnationId
        )
      ) continue
      affectedMemberSessionIds.add(sessionId)
    }
    clearMemberSessionState(affectedMemberSessionIds)
    set((state) => {
      const deletedAt = new Date(deletedAtTimestamp).toISOString()
      const workbenchesBySession = { ...state.workbenchesBySession }
      for (const [sessionId, timeline] of Object.entries(workbenchesBySession)) {
        if (!timeline || timeline.teamName !== teamName) continue
        const latest = timeline.snapshots.at(-1)
        if (
          !latest ||
          latest.deletedAt ||
          !teamMatchesLifecycle(latest.team, teamName, leadSessionId, identity)
        ) continue
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

      const teamScopeSessionIds = Object.entries(state.teamNameBySession)
        .filter(([sessionId, activeTeamName]) => {
          if (activeTeamName !== teamName) return false
          const scopedTeam = state.workbenchesBySession[sessionId]?.snapshots.at(-1)?.team
          return !scopedTeam || teamMatchesLifecycle(
            scopedTeam,
            teamName,
            leadSessionId,
            identity,
          )
        })
        .map(([sessionId]) => sessionId)
      if (leadSessionId) {
        const leadTeam = state.workbenchesBySession[leadSessionId]?.snapshots.at(-1)?.team
        if (
          !leadTeam ||
          teamMatchesLifecycle(leadTeam, teamName, leadSessionId, identity)
        ) {
          teamScopeSessionIds.push(leadSessionId)
        }
      }
      let teamNameBySession = state.teamNameBySession
      let activeTeamStartedAtBySession = state.activeTeamStartedAtBySession
      for (const sessionId of new Set(teamScopeSessionIds)) {
        const nextScope = updateActiveTeamScope(
          teamNameBySession,
          activeTeamStartedAtBySession,
          sessionId,
        )
        teamNameBySession = nextScope.teamNameBySession
        activeTeamStartedAtBySession = nextScope.activeTeamStartedAtBySession
      }

      return {
        teams: state.teams.filter((team) => {
          if (team.name !== teamName) return true
          if (identity?.incarnationId && team.incarnationId) {
            return team.incarnationId !== identity.incarnationId
          }
          if (identity?.createdAt !== undefined && team.createdAt) {
            return teamTimestamp(team.createdAt, Number.NaN) !== identity.createdAt
          }
          return false
        }),
        activeTeam: state.activeTeam && teamMatchesLifecycle(
          state.activeTeam,
          teamName,
          leadSessionId,
          identity,
        )
          ? {
              ...state.activeTeam,
              members: state.activeTeam.members.map((member) => ({
                ...member,
                status: 'completed' as const,
              })),
            }
          : state.activeTeam,
        memberTeamBySession: Object.fromEntries(
          Object.entries(state.memberTeamBySession).map(([sessionId, memberTeam]) => [
            sessionId,
            memberTeam && teamMatchesLifecycle(
              memberTeam,
              teamName,
              leadSessionId,
              identity,
            )
              ? {
                  ...memberTeam,
                  members: memberTeam.members.map((member) => ({
                    ...member,
                    status: 'completed' as const,
                  })),
                }
              : memberTeam,
          ]),
        ),
        teamNameBySession,
        activeTeamStartedAtBySession,
        workbenchesBySession,
      }
    })
    const completedTeam = get().activeTeam
    if (completedTeam?.name === teamName) {
      syncTeamMemberSessions(
        completedTeam,
        latestWorkbenchSnapshotForTeam(get().workbenchesBySession, completedTeam),
      )
    }
  },
}))
