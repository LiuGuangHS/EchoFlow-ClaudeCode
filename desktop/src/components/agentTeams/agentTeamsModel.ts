import { AGENT_LIFECYCLE_TYPES } from '../../types/team'
import type {
  TeamMember,
  TeamWorkbenchMessage,
  TeamWorkbenchSnapshot,
  TeamWorkbenchTask,
} from '../../types/team'

export type WorkbenchTaskState = 'blocked' | 'open' | 'running' | 'completed'
export type WorkbenchPhase = 'forming' | 'running' | 'finishing' | 'completed'
export type MemberAvatarKey =
  | 'team-lead'
  | 'server-engineer'
  | 'ui-designer'
  | 'qa-engineer'
  | 'security-reviewer'
  | 'data-analyst'
  | 'release-engineer'
  | 'docs-coordinator'

export type PositionedWorkbenchTask = {
  task: TeamWorkbenchTask
  state: WorkbenchTaskState
  x: number
  y: number
}

export type WorkbenchLayout = {
  tasks: PositionedWorkbenchTask[]
  byId: Map<string, PositionedWorkbenchTask>
  width: number
  height: number
  columns: number
}

const TASK_WIDTH = 216
const TASK_HEIGHT = 94
const HORIZONTAL_GAP = 32
const ROW_HEIGHT = 154
const DAG_TOP = 196

const WORKER_AVATARS: Array<{
  key: Exclude<MemberAvatarKey, 'team-lead'>
  matches: RegExp
}> = [
  { key: 'release-engineer', matches: /release|\bbuild\b|package|deploy|\bops\b|\bci\b|ship/ },
  { key: 'security-reviewer', matches: /security|secure|audit|risk|threat|review/ },
  { key: 'qa-engineer', matches: /\bqa\b|test|quality|verify|verification/ },
  { key: 'ui-designer', matches: /\bui\b|\bux\b|frontend|desktop|design|theme|accessib/ },
  { key: 'server-engineer', matches: /server|backend|\bapi\b|runtime|watcher|service|contract/ },
  { key: 'data-analyst', matches: /data|research|analyst|replay|state|investigat|explor/ },
  { key: 'docs-coordinator', matches: /docs?|product|spec|writer|coordinat/ },
]

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

/**
 * Keeps a teammate's visual identity stable across snapshots while still
 * assigning the purpose-built occupational art when its role is known.
 */
export function getMemberAvatarKey(member: TeamMember, isLead = false): MemberAvatarKey {
  if (isLead) return 'team-lead'
  const identity = [member.name, member.role, member.agentId, member.currentTask]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const matched = WORKER_AVATARS.find(({ matches }) => matches.test(identity))
  if (matched) return matched.key
  return WORKER_AVATARS[stableHash(member.agentId) % WORKER_AVATARS.length]!.key
}

function identityAliases(value: string): string[] {
  const normalized = value.trim().toLowerCase()
  const short = normalized.split('@')[0] ?? normalized
  return normalized === short ? [normalized] : [normalized, short]
}

/**
 * Resolves the same persisted teammate identity for the DAG, communication
 * feed, and member transcript. A sender can be serialized as either its bare
 * name or full `name@team` id, but it must keep one visual character.
 */
export function resolveTeamMemberIdentity(
  team: TeamWorkbenchSnapshot['team'],
  value: string,
): { member: TeamMember; isLead: boolean } {
  const aliases = identityAliases(value)
  const member = team.members.find((candidate) => {
    const candidateAliases = [
      ...identityAliases(candidate.agentId),
      ...(candidate.name ? identityAliases(candidate.name) : []),
    ]
    return aliases.some((alias) => candidateAliases.includes(alias))
  }) ?? {
    agentId: value,
    name: value,
    role: value,
    status: 'idle' as const,
  }
  const leadAliases = team.leadAgentId ? identityAliases(team.leadAgentId) : []
  const memberAliases = [
    ...identityAliases(member.agentId),
    ...(member.name ? identityAliases(member.name) : []),
  ]
  const isLead = aliases.includes('team-lead')
    || leadAliases.some((alias) => aliases.includes(alias) || memberAliases.includes(alias))

  return { member, isLead }
}

export function getWorkbenchTaskState(
  task: TeamWorkbenchTask,
  tasksById: Map<string, TeamWorkbenchTask>,
): WorkbenchTaskState {
  if (task.status === 'completed') return 'completed'
  if (task.status === 'in_progress') return 'running'
  const hasOpenDependency = task.blockedBy.some(
    (dependencyId) => tasksById.get(dependencyId)?.status !== 'completed',
  )
  return hasOpenDependency ? 'blocked' : 'open'
}

/** Longest dependency path with deterministic fallbacks for missing nodes/cycles. */
function taskDepths(tasks: TeamWorkbenchTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    const task = byId.get(taskId)
    if (!task) return 0

    visiting.add(taskId)
    const dependencies = task.blockedBy.filter((dependencyId) => byId.has(dependencyId))
    const depth = dependencies.length === 0
      ? 0
      : 1 + Math.max(...dependencies.map(depthOf))
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }

  for (const task of tasks) depthOf(task.id)
  return depths
}

export function layoutWorkbenchTasks(
  tasks: TeamWorkbenchTask[],
  requestedWidth: number,
): WorkbenchLayout {
  const width = Math.max(360, Math.min(760, Math.round(requestedWidth || 604)))
  const columns = width >= 704 ? 3 : width >= 480 ? 2 : 1
  const depths = taskDepths(tasks)
  const byLayer = new Map<number, TeamWorkbenchTask[]>()

  for (const task of tasks) {
    const depth = depths.get(task.id) ?? 0
    const layer = byLayer.get(depth)
    if (layer) layer.push(task)
    else byLayer.set(depth, [task])
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const positioned: PositionedWorkbenchTask[] = []
  let row = 0
  for (const depth of Array.from(byLayer.keys()).sort((left, right) => left - right)) {
    const layer = byLayer.get(depth)!
    for (let offset = 0; offset < layer.length; offset += columns) {
      const chunk = layer.slice(offset, offset + columns)
      const chunkWidth = chunk.length * TASK_WIDTH + (chunk.length - 1) * HORIZONTAL_GAP
      const startX = Math.round((width - chunkWidth) / 2)
      chunk.forEach((task, index) => {
        positioned.push({
          task,
          state: getWorkbenchTaskState(task, tasksById),
          x: startX + index * (TASK_WIDTH + HORIZONTAL_GAP),
          y: DAG_TOP + row * ROW_HEIGHT,
        })
      })
      row += 1
    }
  }

  return {
    tasks: positioned,
    byId: new Map(positioned.map((task) => [task.task.id, task])),
    width,
    height: DAG_TOP + Math.max(0, row - 1) * ROW_HEIGHT + TASK_HEIGHT + 54,
    columns,
  }
}

function memberNames(member: TeamMember): string[] {
  return [
    member.agentId,
    member.agentId.split('@')[0] ?? '',
    member.name ?? '',
  ].filter(Boolean)
}

export function taskOwnedByMember(
  task: TeamWorkbenchTask,
  member: TeamMember,
): boolean {
  if (!task.owner) return false
  return memberNames(member).includes(task.owner)
}

export function runningTaskForMember(
  tasks: TeamWorkbenchTask[],
  member: TeamMember,
): TeamWorkbenchTask | undefined {
  return tasks.find((task) => task.status === 'in_progress' && taskOwnedByMember(task, member))
}

export function getWorkbenchPhase(snapshot: TeamWorkbenchSnapshot): WorkbenchPhase {
  if (snapshot.deletedAt) return 'completed'
  if (snapshot.tasks.length === 0) return 'forming'
  if (snapshot.tasks.every((task) => task.status === 'completed')) return 'finishing'
  return 'running'
}

export function getWorkbenchProgress(snapshot: TeamWorkbenchSnapshot) {
  const total = snapshot.tasks.length
  const completed = snapshot.tasks.filter((task) => task.status === 'completed').length
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  }
}

/**
 * A workbench message is either something a teammate wrote or a protocol
 * signal the runtime emitted. The feed used to print the latter as raw JSON
 * (`{"type":"idle_notification",...}`), which is both unreadable and the
 * opposite of what the transcript does — `extractVisibleTeammateMessageContents`
 * has always dropped these payloads from chat. Classifying here lets the feed
 * render a sentence and de-emphasise it instead.
 */
export type WorkbenchMessageBody =
  | { kind: 'text'; text: string }
  | { kind: 'lifecycle'; type: string; detail?: string }

/** Protocol payloads the feed states in words rather than dumping verbatim. */
const NARRATED_PROTOCOL_TYPES = new Set([
  ...AGENT_LIFECYCLE_TYPES,
  'shutdown_response',
  'task_assignment',
])

const LIFECYCLE_DETAIL_FIELDS = ['idleReason', 'reason', 'detail', 'message'] as const
const READABLE_BODY_FIELDS = ['message', 'content', 'text', 'summary', 'reason'] as const

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw.startsWith('{') || !raw.endsWith('}')) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function firstNonEmptyString(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function parseWorkbenchMessageBody(
  message: Pick<TeamWorkbenchMessage, 'text' | 'protocolType'>,
): WorkbenchMessageBody {
  const raw = message.text?.trim() ?? ''
  const payload = parseJsonObject(raw)
  const payloadType = typeof payload?.type === 'string' ? payload.type : undefined
  const type = message.protocolType ?? payloadType

  if (type && NARRATED_PROTOCOL_TYPES.has(type)) {
    return {
      kind: 'lifecycle',
      type,
      ...(payload ? { detail: firstNonEmptyString(payload, LIFECYCLE_DETAIL_FIELDS) } : {}),
    }
  }

  // An unrecognised JSON payload still beats raw braces: surface whichever
  // field actually carries prose, and only fall back to the literal text when
  // nothing readable is in there.
  if (payload) {
    return { kind: 'text', text: firstNonEmptyString(payload, READABLE_BODY_FIELDS) ?? raw }
  }
  return { kind: 'text', text: raw }
}

/**
 * Wall-clock time the message was sent. The feed previously stamped every row
 * with `T+{snapshotIndex}`, which is identical for every message in a snapshot
 * and therefore carries no information at all.
 */
export function formatWorkbenchMessageTime(timestamp: string): string {
  const time = new Date(timestamp)
  return Number.isNaN(time.getTime())
    ? ''
    : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function memberInitials(member: TeamMember): string {
  const source = member.name || member.role || member.agentId.split('@')[0] || 'AG'
  const words = source.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return (words.length > 1
    ? words.slice(0, 2).map((word) => word[0]).join('')
    : source.slice(0, 2)
  ).toUpperCase()
}

export const WORKBENCH_TASK_WIDTH = TASK_WIDTH
export const WORKBENCH_TASK_HEIGHT = TASK_HEIGHT
