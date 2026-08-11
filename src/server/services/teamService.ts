/**
 * TeamService — 读取 CLI 生成的 Agent Teams 配置
 *
 * Team 配置存储在 ~/.claude/teams/{name}/config.json
 * 成员 transcript 存储为 JSONL 文件:
 *   - 有 sessionId 的成员: ~/.claude/projects/{project}/{sessionId}.jsonl
 *   - in-process 成员 (无 sessionId): ~/.claude/projects/{project}/{leadSessionId}/subagents/agent-*.jsonl
 * 成员发现: config.json + inboxes/ 目录 (解决并发写入丢失成员的问题)
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'node:crypto'
import { ApiError } from '../middleware/errorHandler.js'
import { writeToMailbox } from '../../utils/teammateMailbox.js'
import {
  sessionService,
  type MessageEntry as SessionMessageEntry,
  type SessionTaskNotification,
} from './sessionService.js'
import { localIndexCoordinator } from './localIndex/coordinator.js'
import { readSessionEntriesByLocator } from './localIndex/sessionEntries.js'
import { deserializeSourceFingerprint } from './localIndex/sourceFingerprint.js'
import type { LocalIndexGateway } from './localIndex/sessionIndex.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getEchoFlowConfigDir, getEchoFlowInternalDir } from '../../utils/echoFlowConfigRoot.js'
import { taskService, type TaskInfo } from './taskService.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export type TeamMember = {
  agentId: string
  name: string
  agentType?: string
  model?: string
  color?: string
  backendType?: string
  status: 'running' | 'completed' | 'idle' | 'failed'
  joinedAt: number
  cwd: string
  sessionId?: string
}

export type TeamSummary = {
  name: string
  description?: string
  createdAt: number
  incarnationId: string
  memberCount: number
  activeMemberCount: number
}

export type TeamDetail = TeamSummary & {
  leadAgentId: string
  leadSessionId?: string
  members: TeamMember[]
}

export type TeamWorkbenchMessage = {
  id: string
  from: string
  to: string | '*'
  recipients: string[]
  kind: 'direct' | 'broadcast' | 'system'
  text: string
  summary?: string
  timestamp: string
  color?: string
  taskId?: string
  protocolType?: string
}

export type TeamWorkbenchSnapshot = {
  version: string
  generatedAt: string
  team: TeamDetail
  tasks: TaskInfo[]
  messages: TeamWorkbenchMessage[]
  deletedAt?: string
}

export type TeamWorkbenchSessionTimeline = {
  sessionId: string
  teamName: string
  incarnationId: string
  snapshots: TeamWorkbenchSnapshot[]
  source: 'live' | 'archive' | 'transcript'
}

export type TeamWorkbenchSessionLookup = {
  teamName?: string
  incarnationId?: string
  at?: number
}

export type TranscriptMessage = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  timestamp: string
  model?: string
  parentToolUseId?: string
  /**
   * Structured tool output the desktop transcript needs to render a result as
   * anything richer than plain text. Dropping it here degraded every member
   * tool call to its stringified body.
   */
  toolUseResult?: unknown
}

export type TeamTranscriptPage = {
  messages: TranscriptMessage[]
  /**
   * Physical `agent-<id>.jsonl` fragments that contributed to this member.
   * Empty means the member owns a root session transcript (or has no
   * transcript), not that fragment discovery is still pending.
   */
  ownerAgentIds: string[]
  /**
   * Terminal background-task notifications from the same cursor page as
   * `messages`. Consumers must merge deltas by `toolUseId`, and replace their
   * cache when `reset` is true.
   */
  taskNotifications: SessionTaskNotification[]
  signature: string
  cursor: string
  afterOrdinal: number
  reset?: boolean
}

export type TeamTranscriptPageOptions = {
  signature?: string
  cursor?: string
  afterOrdinal?: number
  leadSessionId?: string
  incarnationId?: string
}

type TranscriptCursor = {
  version: 2
  size: number
  ctimeMs: number
  fileIdentity: string | null
  firstWindowHash: string
  lastWindowHash: string
  afterOrdinal: number
}

type TranscriptFragmentProjection = {
  /** One owner for a single physical fragment. */
  ownerAgentId?: string
  /** Per-entry owners for a buffer assembled from several fragments. */
  ownerAgentIdByOrdinal?: Array<string | undefined>
  /** Always the complete incarnation-bounded owner set, including on deltas. */
  ownerAgentIds?: string[]
}

const CURSOR_WINDOW_BYTES = 64 * 1024
const MESSAGE_ENTRY_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'tool_use',
  'tool_result',
])
const PERSISTED_TASK_NOTIFICATION_ENTRY_TYPE = 'cc-haha-task-notification'
const TASK_NOTIFICATION_BLOCK_RE = /<task-notification>\s*[\s\S]*?<\/task-notification>/i

const TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION = 1
const TEAM_WORKBENCH_ARCHIVE_HISTORY_LIMIT = 200

type TeamWorkbenchArchiveEntry = {
  teamName: string
  incarnationId: string
  updatedAt: string
  snapshots: TeamWorkbenchSnapshot[]
  [key: string]: unknown
}

type TeamWorkbenchArchiveDocument = {
  schemaVersion: 1
  sessionId: string
  updatedAt: string
  teams: TeamWorkbenchArchiveEntry[]
  [key: string]: unknown
}

type ProjectedTeamState = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId: string
  members: Map<string, TeamMember>
  tasks: Map<string, TaskInfo>
  messages: TeamWorkbenchMessage[]
  updatedAt: string
  deletedAt?: string
}

function hash(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function physicalAgentIdFromTranscriptPath(filePath: string): string | undefined {
  return path.basename(filePath).match(/^agent-(.+)\.jsonl$/)?.[1]
}

/**
 * A CLI Team directory is a mutable name, not an identity. The same name can
 * be deleted and recreated (including under the same lead session), so every
 * durable join uses the creation tuple instead of the directory name alone.
 */
export function teamIncarnationId(
  team: Pick<TeamSummary, 'name' | 'createdAt'> & { leadSessionId?: string },
): string {
  return hash(JSON.stringify([
    team.name,
    team.leadSessionId ?? '',
    Number.isFinite(team.createdAt) ? team.createdAt : 0,
  ]))
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function transcriptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block === 'string') return block
      const record = objectValue(block)
      return record && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function readXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1] ? decodeXmlText(match[1].trim()) : undefined
}

function terminalTaskStatus(
  value: unknown,
): SessionTaskNotification['status'] | null {
  if (value === 'completed' || value === 'failed' || value === 'stopped') return value
  return value === 'killed' ? 'stopped' : null
}

function fragmentScopedId(ownerAgentId: string, value: string): string {
  return value.startsWith(`${ownerAgentId}/`)
    ? value
    : `${ownerAgentId}/${value}`
}

function projectFragmentContent(content: unknown, ownerAgentId: string): unknown {
  if (Array.isArray(content)) {
    return content.map(value => projectFragmentContent(value, ownerAgentId))
  }
  const block = objectValue(content)
  if (!block) return content
  if (block.type === 'tool_use' && typeof block.id === 'string') {
    return {
      ...block,
      id: fragmentScopedId(ownerAgentId, block.id),
      original_tool_use_id: stringValue(block.original_tool_use_id) ?? block.id,
    }
  }
  if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
    return {
      ...block,
      tool_use_id: fragmentScopedId(ownerAgentId, block.tool_use_id),
      original_tool_use_id:
        stringValue(block.original_tool_use_id) ?? block.tool_use_id,
      ...('content' in block
        ? { content: projectFragmentContent(block.content, ownerAgentId) }
        : {}),
    }
  }
  if ('content' in block) {
    const projectedContent = projectFragmentContent(block.content, ownerAgentId)
    if (projectedContent !== block.content) {
      return { ...block, content: projectedContent }
    }
  }
  return content
}

function projectFragmentToolUseResult(
  value: unknown,
  ownerAgentId: string,
): unknown {
  const result = objectValue(value)
  if (!result) return value
  const backgroundTaskId = stringValue(result.backgroundTaskId)
  const snakeBackgroundTaskId = stringValue(result.background_task_id)
  if (!backgroundTaskId && !snakeBackgroundTaskId) return value
  return {
    ...result,
    ...(backgroundTaskId
      ? { backgroundTaskId: fragmentScopedId(ownerAgentId, backgroundTaskId) }
      : {}),
    ...(snakeBackgroundTaskId
      ? { background_task_id: fragmentScopedId(ownerAgentId, snakeBackgroundTaskId) }
      : {}),
  }
}

function projectFragmentTaskNotification(
  notification: SessionTaskNotification,
  ownerAgentId: string | undefined,
): SessionTaskNotification {
  if (!ownerAgentId) return notification
  return {
    ...notification,
    taskId: fragmentScopedId(ownerAgentId, notification.taskId),
    toolUseId: fragmentScopedId(ownerAgentId, notification.toolUseId),
  }
}

function taskNotificationFromEntry(
  entry: Record<string, unknown>,
  ownerAgentId?: string,
): SessionTaskNotification | null {
  const timestamp = stringValue(entry.timestamp)
  if (entry.type === PERSISTED_TASK_NOTIFICATION_ENTRY_TYPE) {
    const notification = objectValue(entry.taskNotification)
    if (!notification) return null
    const toolUseId = stringValue(notification.toolUseId)
    const status = terminalTaskStatus(notification.status)
    if (!toolUseId || !status) return null
    const taskId = stringValue(notification.taskId) ?? toolUseId
    const summary = stringValue(notification.summary)
    const result = stringValue(notification.result)
    const outputFile = stringValue(notification.outputFile)
    const notificationTimestamp = stringValue(notification.timestamp) ?? timestamp
    return projectFragmentTaskNotification({
      taskId,
      toolUseId,
      status,
      ...(summary ? { summary } : {}),
      ...(result ? { result } : {}),
      ...(outputFile ? { outputFile } : {}),
      ...(notificationTimestamp ? { timestamp: notificationTimestamp } : {}),
    }, ownerAgentId)
  }

  const message = objectValue(entry.message)
  if (entry.type !== 'user' || message?.role !== 'user') return null
  const xml = transcriptText(message.content).match(TASK_NOTIFICATION_BLOCK_RE)?.[0]
  if (!xml) return null
  const toolUseId = readXmlTag(xml, 'tool-use-id')
  const status = terminalTaskStatus(readXmlTag(xml, 'status'))
  if (!toolUseId || !status) return null
  const taskId = readXmlTag(xml, 'task-id') ?? toolUseId
  const summary = readXmlTag(xml, 'summary')
  const result = readXmlTag(xml, 'result')
  const outputFile = readXmlTag(xml, 'output-file')
  return projectFragmentTaskNotification({
    taskId,
    toolUseId,
    status,
    ...(summary ? { summary } : {}),
    ...(result ? { result } : {}),
    ...(outputFile ? { outputFile } : {}),
    ...(timestamp ? { timestamp } : {}),
  }, ownerAgentId)
}

function timestampOrNow(value: string | undefined): string {
  if (value && Number.isFinite(Date.parse(value))) return value
  return new Date().toISOString()
}

function addUnique(values: string[], additions: string[]): string[] {
  return [...new Set([...values, ...additions])]
}

function taskStatus(value: unknown): TaskInfo['status'] | undefined {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
    ? value
    : undefined
}

function resultRecordsByToolUseId(
  messages: SessionMessageEntry[],
): Map<string, { value: Record<string, unknown>; isError: boolean }> {
  const results = new Map<string, { value: Record<string, unknown>; isError: boolean }>()
  for (const message of messages) {
    if (message.type !== 'tool_result') continue
    const blocks = Array.isArray(message.content) ? message.content : []
    for (const block of blocks) {
      const record = objectValue(block)
      const toolUseId = stringValue(record?.tool_use_id)
      if (!toolUseId) continue
      const structured = objectValue(message.toolUseResult)
      const previous = results.get(toolUseId)
      results.set(toolUseId, {
        value: structured ?? record!,
        isError: previous?.isError === true || record?.is_error === true,
      })
    }
  }
  return results
}

function ensureProjectedTask(
  team: ProjectedTeamState,
  id: string,
): TaskInfo {
  const existing = team.tasks.get(id)
  if (existing) return existing
  const task: TaskInfo = {
    id,
    subject: `Task #${id}`,
    description: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    taskListId: team.name,
  }
  team.tasks.set(id, task)
  return task
}

function applyProjectedTaskUpdate(task: TaskInfo, input: Record<string, unknown>): void {
  const subject = stringValue(input.subject)
  const description = stringValue(input.description)
  const activeForm = stringValue(input.activeForm)
  const owner = stringValue(input.owner)
  const status = taskStatus(input.status)
  if (subject) task.subject = subject
  if (description !== undefined) task.description = description
  if (activeForm !== undefined) task.activeForm = activeForm
  if (owner !== undefined) task.owner = owner
  if (status) task.status = status
  task.blocks = addUnique(task.blocks, stringArray(input.addBlocks))
  task.blockedBy = addUnique(task.blockedBy, stringArray(input.addBlockedBy))
  const metadata = objectValue(input.metadata)
  if (metadata) task.metadata = { ...(task.metadata ?? {}), ...metadata }
}

function finalizeProjectedTaskEdges(tasks: Map<string, TaskInfo>): void {
  for (const task of tasks.values()) {
    for (const blockedId of task.blocks) {
      const blocked = tasks.get(blockedId)
      if (blocked) blocked.blockedBy = addUnique(blocked.blockedBy, [task.id])
    }
    for (const blockerId of task.blockedBy) {
      const blocker = tasks.get(blockerId)
      if (blocker) blocker.blocks = addUnique(blocker.blocks, [task.id])
    }
  }
}

/**
 * Rebuilds a read-only final workbench from durable transcript identities.
 * This is the migration path for Team runs created before workbench archives
 * existed; new runs are archived directly from their live snapshot instead.
 */
export function projectTeamWorkbenchesFromTranscript(
  sessionId: string,
  messages: SessionMessageEntry[],
): TeamWorkbenchSnapshot[] {
  const results = resultRecordsByToolUseId(messages)
  const ordered = messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => (
      Date.parse(left.message.timestamp) - Date.parse(right.message.timestamp) ||
      left.index - right.index
    ))
  const teams = new Map<string, ProjectedTeamState>()
  let currentTeamName: string | null = null

  for (const { message } of ordered) {
    const timestamp = timestampOrNow(message.timestamp)
    if (message.type === 'user' && currentTeamName) {
      const team = teams.get(currentTeamName)
      if (team) {
        const text = transcriptText(message.content)
        const teammatePattern = /<teammate-message\s+teammate_id="([^"]+)"(?:\s+color="([^"]+)")?[^>]*>([\s\S]*?)<\/teammate-message>/g
        for (const match of text.matchAll(teammatePattern)) {
          const body = match[3]?.trim()
          if (!body) continue
          team.messages.push({
            id: `${message.id}:teammate:${team.messages.length}`,
            from: match[1]!,
            to: 'team-lead',
            recipients: ['team-lead'],
            kind: 'direct',
            text: body,
            timestamp,
            ...(match[2] ? { color: match[2] } : {}),
          })
          team.updatedAt = timestamp
        }
      }
    }

    if (message.type !== 'tool_use' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      const tool = objectValue(block)
      if (tool?.type !== 'tool_use') continue
      const toolUseId = stringValue(tool.id)
      const name = stringValue(tool.name)
      const input = objectValue(tool.input) ?? {}
      if (!toolUseId || !name) continue
      const toolResult = results.get(toolUseId)
      const result = toolResult?.value ?? {}

      if (name === 'TeamCreate') {
        if (toolResult?.isError) continue
        const teamName = stringValue(input.team_name) ?? stringValue(result.team_name)
        if (!teamName) continue
        currentTeamName = teamName
        const leadAgentId = stringValue(result.lead_agent_id) ?? `team-lead@${teamName}`
        const team: ProjectedTeamState = {
          name: teamName,
          description: stringValue(input.description),
          createdAt: Date.parse(timestamp),
          leadAgentId,
          leadSessionId: sessionId,
          members: new Map(),
          tasks: new Map(),
          messages: [],
          updatedAt: timestamp,
        }
        team.members.set(leadAgentId, {
          agentId: leadAgentId,
          name: 'team-lead',
          agentType: stringValue(input.agent_type) ?? 'team-lead',
          status: 'completed',
          joinedAt: team.createdAt,
          cwd: stringValue(message.cwd) ?? '',
          sessionId,
        })
        teams.set(teamName, team)
        continue
      }

      const explicitTeamName = stringValue(input.team_name)
      const teamName = explicitTeamName ?? currentTeamName
      if (!teamName) continue
      const team = teams.get(teamName)
      if (!team) continue
      team.updatedAt = timestamp
      if (toolResult?.isError) continue

      if (name === 'TeamDelete') {
        team.deletedAt = timestamp
        if (currentTeamName === teamName) currentTeamName = null
        continue
      }

      if (name === 'Agent' && explicitTeamName) {
        const memberName = stringValue(input.name)
        if (!memberName) continue
        const agentId = stringValue(result.agent_id) ??
          stringValue(result.teammate_id) ??
          `${memberName}@${teamName}`
        team.members.set(agentId, {
          agentId,
          name: memberName,
          agentType: stringValue(result.agent_type) ?? stringValue(input.subagent_type),
          model: stringValue(result.model),
          color: stringValue(result.color),
          backendType: stringValue(result.tmux_session_name) === 'in-process'
            ? 'in-process'
            : undefined,
          status: 'completed',
          joinedAt: Date.parse(timestamp),
          cwd: stringValue(message.cwd) ?? '',
        })
        continue
      }

      if (name === 'TaskCreate') {
        const resultTask = objectValue(result.task)
        const id = stringValue(resultTask?.id)
        if (!id) continue
        const task = ensureProjectedTask(team, id)
        applyProjectedTaskUpdate(task, input)
        task.subject = stringValue(resultTask?.subject) ?? task.subject
        continue
      }

      if (name === 'TaskUpdate') {
        const id = stringValue(input.taskId)
        if (!id) continue
        applyProjectedTaskUpdate(ensureProjectedTask(team, id), input)
        continue
      }

      if (name === 'TaskList') {
        const listed = Array.isArray(result.tasks) ? result.tasks : []
        for (const rawTask of listed) {
          const record = objectValue(rawTask)
          const id = stringValue(record?.id)
          if (!record || !id) continue
          const task = ensureProjectedTask(team, id)
          const status = taskStatus(record.status)
          const subject = stringValue(record.subject)
          const owner = stringValue(record.owner)
          if (status) task.status = status
          if (subject) task.subject = subject
          if (owner) task.owner = owner
        }
        continue
      }

      if (name === 'SendMessage') {
        const text = stringValue(input.message) ?? stringValue(input.content)
        if (!text) continue
        const target = stringValue(input.to) ?? stringValue(input.recipient) ?? 'team-lead'
        const broadcast = target === '*' || input.type === 'broadcast'
        const recipients = broadcast
          ? [...team.members.values()].map((member) => member.name ?? member.agentId)
              .filter((memberName) => memberName !== 'team-lead')
          : [target]
        team.messages.push({
          id: toolUseId,
          from: 'team-lead',
          to: broadcast ? '*' : target,
          recipients,
          kind: broadcast ? 'broadcast' : 'direct',
          text,
          summary: stringValue(input.summary),
          timestamp,
        })
      }
    }
  }

  return [...teams.values()].map((team) => {
    finalizeProjectedTaskEdges(team.tasks)
    const members = [...team.members.values()]
    const tasks = [...team.tasks.values()].sort((left, right) => {
      const leftNumber = Number.parseInt(left.id, 10)
      const rightNumber = Number.parseInt(right.id, 10)
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
      return left.id.localeCompare(right.id)
    })
    const generatedAt = team.updatedAt
    const detail: TeamDetail = {
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      incarnationId: teamIncarnationId(team),
      memberCount: members.length,
      activeMemberCount: 0,
      leadAgentId: team.leadAgentId,
      leadSessionId: team.leadSessionId,
      members,
    }
    const canonical = JSON.stringify({ team: detail, tasks, messages: team.messages })
    return {
      version: `transcript:${hash(canonical)}`,
      generatedAt,
      deletedAt: team.deletedAt ?? generatedAt,
      team: detail,
      tasks,
      messages: team.messages.sort((left, right) => (
        left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
      )),
    }
  })
}

function encodeTranscriptCursor(cursor: TranscriptCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeTranscriptCursor(value: string | undefined): TranscriptCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as TranscriptCursor
    if (
      parsed.version === 2 &&
      Number.isSafeInteger(parsed.size) && parsed.size >= 0 &&
      Number.isFinite(parsed.ctimeMs) && parsed.ctimeMs >= 0 &&
      Number.isSafeInteger(parsed.afterOrdinal) && parsed.afterOrdinal >= -1 &&
      (parsed.fileIdentity === null || typeof parsed.fileIdentity === 'string') &&
      typeof parsed.firstWindowHash === 'string' &&
      typeof parsed.lastWindowHash === 'string'
    ) return parsed
  } catch {
    // Treat malformed client cursors as a reset request.
  }
  return null
}

function cursorForBuffer(
  bytes: Buffer,
  fileIdentity: string | null,
  ctimeMs: number,
  afterOrdinal: number,
): TranscriptCursor {
  return {
    version: 2,
    size: bytes.length,
    ctimeMs,
    fileIdentity,
    firstWindowHash: hash(bytes.subarray(0, Math.min(bytes.length, CURSOR_WINDOW_BYTES))),
    lastWindowHash: hash(bytes.subarray(Math.max(0, bytes.length - CURSOR_WINDOW_BYTES))),
    afterOrdinal,
  }
}

function bufferPreservesCursorPrefix(
  bytes: Buffer,
  cursor: TranscriptCursor,
  fileIdentity: string | null,
): boolean {
  if (bytes.length <= cursor.size) return false
  if (
    cursor.fileIdentity !== null &&
    fileIdentity !== null &&
    cursor.fileIdentity !== fileIdentity
  ) return false
  const firstEnd = Math.min(cursor.size, CURSOR_WINDOW_BYTES)
  const lastStart = Math.max(0, cursor.size - CURSOR_WINDOW_BYTES)
  return hash(bytes.subarray(0, firstEnd)) === cursor.firstWindowHash &&
    hash(bytes.subarray(lastStart, cursor.size)) === cursor.lastWindowHash
}

function sameTranscriptFileSnapshot(
  left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
}

/** Raw config.json structure written by CLI */
type TeamFileRaw = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string
  members: Array<{
    agentId: string
    name: string
    agentType?: string
    model?: string
    prompt?: string
    color?: string
    joinedAt: number
    tmuxPaneId: string
    cwd: string
    worktreePath?: string
    sessionId?: string
    backendType?: string
    isActive?: boolean
    mode?: string
  }>
}

// ─── Service ───────────────────────────────────────────────────────────────

export class TeamService {
  private readonly sessionLocator: Pick<typeof sessionService, 'findSessionFile'>
  private readonly sessionReader: Pick<typeof sessionService, 'getSessionMessages'>
  private readonly localIndexGateway: LocalIndexGateway
  private readonly targetedEntryReader: typeof readSessionEntriesByLocator
  private readonly archiveWriteLocks = new Map<string, Promise<unknown>>()

  constructor(options: {
    sessionLocator?: Pick<typeof sessionService, 'findSessionFile'>
    sessionReader?: Pick<typeof sessionService, 'getSessionMessages'>
    localIndexGateway?: LocalIndexGateway
    targetedEntryReader?: typeof readSessionEntriesByLocator
  } = {}) {
    this.sessionLocator = options.sessionLocator ?? sessionService
    this.sessionReader = options.sessionReader ?? sessionService
    this.localIndexGateway = options.localIndexGateway ?? localIndexCoordinator
    this.targetedEntryReader = options.targetedEntryReader ?? readSessionEntriesByLocator
  }

  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  private getTeamsDir(): string {
    return path.join(this.getConfigDir(), 'teams')
  }

  private getProjectsDir(): string {
    return path.join(this.getConfigDir(), 'projects')
  }

  private getWorkbenchArchiveDir(): string {
    return path.join(getEchoFlowInternalDir(getEchoFlowConfigDir()), 'agent-teams')
  }

  private getWorkbenchArchivePath(sessionId: string): string {
    return path.join(this.getWorkbenchArchiveDir(), `${hash(sessionId)}.json`)
  }

  // ── List all teams ──────────────────────────────────────────────────────

  async listTeams(): Promise<TeamSummary[]> {
    const teamsDir = this.getTeamsDir()

    try {
      await fs.access(teamsDir)
    } catch {
      return []
    }

    const entries = await fs.readdir(teamsDir, { withFileTypes: true })
    const teams: TeamSummary[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      try {
        const config = await this.loadTeamConfig(entry.name)
        // Include inbox-discovered members in the count
        const inboxNames = await this.discoverInboxMembers(entry.name)
        const configNames = new Set(config.members.map((m) => m.name))
        const extraCount = inboxNames.filter((n) => !configNames.has(n)).length
        const summary = this.toSummary(config)
        summary.memberCount += extraCount
        summary.activeMemberCount += extraCount // assume running if newly discovered
        teams.push(summary)
      } catch {
        // Skip malformed team directories
      }
    }

    return teams
  }

  // ── Get team detail ─────────────────────────────────────────────────────

  async getTeam(name: string): Promise<TeamDetail> {
    const config = await this.loadTeamConfig(name)

    const members: TeamMember[] = config.members.map((m) => ({
      agentId: m.agentId,
      name: m.name,
      agentType: m.agentType,
      model: m.model,
      color: m.color,
      backendType: m.backendType,
      status: this.deriveStatus(m.isActive),
      joinedAt: m.joinedAt,
      cwd: m.cwd,
      sessionId: m.sessionId,
    }))

    // Discover members from inboxes/ that aren't in config.json (race condition fix)
    const inboxNames = await this.discoverInboxMembers(name)
    const configNames = new Set(config.members.map((m) => m.name))

    for (const inboxName of inboxNames) {
      if (!configNames.has(inboxName)) {
        members.push({
          agentId: `${inboxName}@${name}`,
          name: inboxName,
          agentType: 'general-purpose',
          status: 'running', // assume running since we can see their inbox
          joinedAt: config.createdAt,
          cwd: config.members[0]?.cwd || '',
        })
      }
    }

    if (config.leadSessionId) {
      const subagentNames = await this.discoverSubagentMembers(
        config.leadSessionId,
      )
      for (const subagentName of subagentNames) {
        if (
          !configNames.has(subagentName) &&
          !members.some((member) => member.name === subagentName)
        ) {
          members.push({
            agentId: `${subagentName}@${name}`,
            name: subagentName,
            status: 'running',
            joinedAt: config.createdAt,
            cwd: config.members[0]?.cwd || '',
          })
        }
      }
    }

    return {
      ...this.toSummary(config),
      leadAgentId: config.leadAgentId,
      leadSessionId: config.leadSessionId,
      memberCount: members.length,
      activeMemberCount: members.filter(
        (m) => m.status === 'running',
      ).length,
      members,
    }
  }

  // ── Get member transcript ───────────────────────────────────────────────

  async getMemberTranscript(
    teamName: string,
    agentId: string,
  ): Promise<TranscriptMessage[]> {
    return (await this.getMemberTranscriptPage(teamName, agentId)).messages
  }

  async getMemberTranscriptPage(
    teamName: string,
    agentId: string,
    options: TeamTranscriptPageOptions = {},
  ): Promise<TeamTranscriptPage> {
    let config: TeamFileRaw | null = null
    let configError: unknown
    let memberName: string | null = null
    let memberSessionId: string | undefined
    let leadSessionId = options.leadSessionId
    let transcriptStartedAt: number | undefined
    let transcriptEndedAt: number | undefined

    try {
      config = await this.loadTeamConfig(teamName)
      const configIncarnationId = teamIncarnationId(config)
      if (
        options.incarnationId &&
        options.incarnationId !== configIncarnationId
      ) {
        throw ApiError.notFound(
          `Team incarnation not found: ${options.incarnationId}`,
        )
      }
      memberName = await this.resolveMemberName(config, teamName, agentId)
      const configMember = config.members.find((candidate) => candidate.agentId === agentId)
      memberSessionId = configMember?.sessionId
      leadSessionId = config.leadSessionId
      transcriptStartedAt = config.createdAt
    } catch (error) {
      configError = error
      if (leadSessionId) {
        const archive = await this.readArchiveDocument(leadSessionId)
        const archivedEntry = this.archiveEntryForTeam(
          archive,
          teamName,
          options.incarnationId,
        )
        const archivedSnapshot = archivedEntry?.snapshots.at(-1)
        const archivedMember = archivedSnapshot?.team.members.find((candidate) => (
          candidate.agentId === agentId || candidate.name === agentId
        ))
        memberName = archivedMember?.name ?? null
        memberSessionId = archivedMember?.sessionId
        leadSessionId = archivedSnapshot?.team.leadSessionId ?? leadSessionId
        transcriptStartedAt = archivedSnapshot?.team.createdAt
        const deletedAt = archivedSnapshot?.deletedAt
          ? Date.parse(archivedSnapshot.deletedAt)
          : undefined
        const nextIncarnationStartedAt = archive?.teams
          .filter((entry) => entry.teamName === teamName)
          .map((entry) => entry.snapshots.at(-1)?.team.createdAt)
          .filter((createdAt): createdAt is number => (
            Number.isFinite(createdAt) &&
            Number.isFinite(transcriptStartedAt) &&
            createdAt! > transcriptStartedAt!
          ))
          .sort((left, right) => left - right)[0]
        transcriptEndedAt = [deletedAt, nextIncarnationStartedAt]
          .filter((value): value is number => Number.isFinite(value))
          .sort((left, right) => left - right)[0]
      }
    }

    if (!memberName) {
      if (configError && !leadSessionId) throw configError
      throw ApiError.notFound(
        `Team member not found: ${agentId} in team ${teamName}`,
      )
    }

    let transcriptPath: string | null = null
    let transcriptOwnerAgentId: string | undefined

    // Try config.json member with sessionId first. SessionService uses the
    // scalar session index for this lookup when it is ready.
    if (memberSessionId) {
      transcriptPath = (await this.sessionLocator.findSessionFile(memberSessionId))?.filePath ??
        await this.findTranscriptFile(memberSessionId)
      if (
        transcriptPath &&
        !await this.transcriptBelongsToIncarnation(
          transcriptPath,
          transcriptStartedAt,
          transcriptEndedAt,
        )
      ) {
        transcriptPath = null
      }
    }

    // Fallback: aggregate every in-process transcript fragment for this member.
    // A teammate can be resumed many times and each resume owns a new agent-*.jsonl
    // file. Treating only the newest fragment as the conversation made the member
    // page lose its earlier messages and often left it looking empty.
    if (!transcriptPath && leadSessionId) {
      const subagentPaths = await this.findSubagentTranscripts(
        leadSessionId,
        memberName,
        transcriptStartedAt,
        transcriptEndedAt,
      )
      if (subagentPaths.length === 1) {
        transcriptPath = subagentPaths[0] ?? null
        transcriptOwnerAgentId = transcriptPath
          ? physicalAgentIdFromTranscriptPath(transcriptPath)
          : undefined
      } else if (subagentPaths.length > 1) {
        return this.parseTranscriptFragmentsPage(
          subagentPaths.map(filePath => ({
            filePath,
            ownerAgentId: physicalAgentIdFromTranscriptPath(filePath),
          })),
          options,
        )
      }
    }

    // Out-of-process teammates own root session JSONL files rather than lead
    // subagent fragments. The incarnation time bounds this legacy identity
    // lookup so a reused team/member name cannot select another run.
    if (!transcriptPath && Number.isFinite(transcriptStartedAt)) {
      const teammatePaths = await this.findTeammateSessionTranscripts(
        teamName,
        memberName,
        transcriptStartedAt,
        transcriptEndedAt,
      )
      if (teammatePaths.length === 1) {
        transcriptPath = teammatePaths[0] ?? null
      } else if (teammatePaths.length > 1) {
        return this.parseTranscriptFragmentsPage(
          teammatePaths.map(filePath => ({ filePath })),
          options,
        )
      }
    }
    if (!transcriptPath) {
      return {
        messages: [],
        ownerAgentIds: [],
        taskNotifications: [],
        signature: 'missing',
        cursor: encodeTranscriptCursor(cursorForBuffer(Buffer.alloc(0), null, 0, -1)),
        afterOrdinal: -1,
      }
    }

    const projection: TranscriptFragmentProjection = transcriptOwnerAgentId
      ? {
          ownerAgentId: transcriptOwnerAgentId,
          ownerAgentIds: [transcriptOwnerAgentId],
        }
      : { ownerAgentIds: [] }
    const indexed = await this.readIndexedTranscriptPage(
      transcriptPath,
      options,
      projection,
    )
    if (indexed) return indexed
    return this.parseTranscriptFilePage(transcriptPath, options, projection)
  }

  async sendMemberMessage(
    teamName: string,
    agentId: string,
    content: string,
  ): Promise<void> {
    const text = content.trim()
    if (!text) {
      throw ApiError.badRequest('content (string) is required in request body')
    }

    const config = await this.loadTeamConfig(teamName)
    const recipientName = await this.resolveMemberName(
      config,
      teamName,
      agentId,
    )

    if (!recipientName) {
      throw ApiError.notFound(
        `Team member not found: ${agentId} in team ${teamName}`,
      )
    }

    await writeToMailbox(
      recipientName,
      {
        from: 'user',
        text,
        timestamp: new Date().toISOString(),
      },
      teamName,
    )
  }

  // ── Get Agent Teams workbench snapshot ──────────────────────────────────────

  /**
   * Join the three CLI-owned Agent Teams surfaces behind one read-only contract:
   * team membership, the shared task box, and teammate mailboxes. The desktop
   * must not know where any of these files live, and this method never marks an
   * inbox entry as read or otherwise mutates CLI state.
   */
  async getWorkbench(name: string): Promise<TeamWorkbenchSnapshot> {
    const config = await this.loadTeamConfig(name)
    const discoveredTeam = await this.getTeam(name)
    const rosterIds = new Set(config.members.map((member) => member.agentId))
    const members = discoveredTeam.members.filter((member) => rosterIds.has(member.agentId))
    const team = {
      ...discoveredTeam,
      memberCount: members.length,
      activeMemberCount: members.filter((member) => member.status === 'running').length,
      members,
    }
    const tasks = await taskService.getTasksForList(name)
    const messages = await this.readWorkbenchMessages(name)
    const canonical = JSON.stringify({ team, tasks, messages })

    const snapshot: TeamWorkbenchSnapshot = {
      version: hash(canonical),
      generatedAt: new Date().toISOString(),
      team,
      tasks,
      messages,
    }
    await this.archiveWorkbenchSnapshot(snapshot)
    return snapshot
  }

  /**
   * Resolve the newest Team workbench associated with a lead session. Live
   * state wins; otherwise a durable archive or a one-time transcript migration
   * makes the completed Team available after CLI cleanup and app restarts.
   */
  async getWorkbenchForSession(
    sessionId: string,
    lookup: TeamWorkbenchSessionLookup = {},
  ): Promise<TeamWorkbenchSessionTimeline | null> {
    const liveTeams = await this.listTeams()
    const liveIncarnations = new Set<string>()
    for (const summary of liveTeams) {
      try {
        const team = await this.getTeam(summary.name)
        if (team.leadSessionId !== sessionId) continue
        const snapshot = await this.getWorkbench(team.name)
        liveIncarnations.add(snapshot.team.incarnationId)
      } catch {
        // Another CLI process can remove a team between list and detail reads.
      }
    }

    let archive = await this.readArchiveDocument(sessionId)
    let archived = this.archiveEntryForLookup(archive, lookup)
    if (archived) {
      return {
        sessionId,
        teamName: archived.teamName,
        incarnationId: archived.incarnationId,
        snapshots: archived.snapshots,
        source: liveIncarnations.has(archived.incarnationId) ? 'live' : 'archive',
      }
    }

    let messages: SessionMessageEntry[]
    try {
      messages = await this.sessionReader.getSessionMessages(sessionId)
    } catch {
      return null
    }
    const projected = projectTeamWorkbenchesFromTranscript(sessionId, messages)
    for (const snapshot of projected) {
      await this.archiveWorkbenchSnapshot(snapshot)
    }
    archive = await this.readArchiveDocument(sessionId)
    const migrated = this.archiveEntryForLookup(archive, lookup)
    if (!migrated) return null
    return {
      sessionId,
      teamName: migrated.teamName,
      incarnationId: migrated.incarnationId,
      snapshots: migrated.snapshots,
      source: 'transcript',
    }
  }

  async archiveWorkbenchSnapshot(snapshot: TeamWorkbenchSnapshot): Promise<void> {
    const normalizedSnapshot: TeamWorkbenchSnapshot = {
      ...snapshot,
      team: {
        ...snapshot.team,
        incarnationId: snapshot.team.incarnationId || teamIncarnationId(snapshot.team),
      },
    }
    const sessionId = normalizedSnapshot.team.leadSessionId
    if (!sessionId) return
    const incarnationId = normalizedSnapshot.team.incarnationId
    const filePath = this.getWorkbenchArchivePath(sessionId)
    await this.withArchiveWriteLock(filePath, async () => {
      const current = await this.readArchiveDocument(sessionId) ?? {
        schemaVersion: TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION,
        sessionId,
        updatedAt: normalizedSnapshot.generatedAt,
        teams: [],
      }
      const teams = [...current.teams]
      const index = teams.findIndex((entry) => entry.incarnationId === incarnationId)
      const existing = index >= 0 ? teams[index] : undefined
      const snapshots = existing?.snapshots.at(-1)?.version === normalizedSnapshot.version
        ? existing.snapshots
        : [...(existing?.snapshots ?? []), normalizedSnapshot]
            .slice(-TEAM_WORKBENCH_ARCHIVE_HISTORY_LIMIT)
      const nextEntry: TeamWorkbenchArchiveEntry = {
        ...(existing ?? {}),
        teamName: normalizedSnapshot.team.name,
        incarnationId,
        updatedAt: normalizedSnapshot.generatedAt,
        snapshots,
      }
      if (index >= 0) teams[index] = nextEntry
      else teams.push(nextEntry)
      await this.writeArchiveDocument(filePath, {
        ...current,
        schemaVersion: TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION,
        sessionId,
        updatedAt: normalizedSnapshot.generatedAt,
        teams,
      })
    })
  }

  async markWorkbenchArchiveDeleted(
    teamName: string,
    sessionId: string | undefined,
    incarnationId?: string,
  ): Promise<void> {
    if (!sessionId) return
    const document = await this.readArchiveDocument(sessionId)
    const entry = this.archiveEntryForTeam(document, teamName, incarnationId)
    const latest = entry?.snapshots.at(-1)
    if (!latest || latest.deletedAt) return
    const deletedAt = new Date().toISOString()
    await this.archiveWorkbenchSnapshot({
      ...latest,
      version: `${latest.version}:deleted`,
      generatedAt: deletedAt,
      deletedAt,
      team: {
        ...latest.team,
        activeMemberCount: 0,
        members: latest.team.members.map((member) => ({
          ...member,
          status: 'completed' as const,
        })),
      },
    })
  }

  private latestArchiveEntry(
    document: TeamWorkbenchArchiveDocument | null,
  ): TeamWorkbenchArchiveEntry | null {
    if (!document) return null
    return [...document.teams]
      .filter((entry) => entry.snapshots.length > 0)
      .sort((left, right) => (
        this.archiveEntryCreatedAt(right) - this.archiveEntryCreatedAt(left) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        right.teamName.localeCompare(left.teamName)
      ))[0] ?? null
  }

  private archiveEntryForTeam(
    document: TeamWorkbenchArchiveDocument | null,
    teamName: string,
    incarnationId?: string,
  ): TeamWorkbenchArchiveEntry | null {
    if (!document) return null
    if (incarnationId) {
      return document.teams.find((entry) => (
        entry.teamName === teamName && entry.incarnationId === incarnationId
      )) ?? null
    }
    return [...document.teams]
      .filter((entry) => entry.teamName === teamName && entry.snapshots.length > 0)
      .sort((left, right) => (
        this.archiveEntryCreatedAt(right) - this.archiveEntryCreatedAt(left) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      ))[0] ?? null
  }

  private archiveEntryForLookup(
    document: TeamWorkbenchArchiveDocument | null,
    lookup: TeamWorkbenchSessionLookup,
  ): TeamWorkbenchArchiveEntry | null {
    if (!document) return null
    if (lookup.incarnationId) {
      return document.teams.find((entry) => (
        entry.incarnationId === lookup.incarnationId &&
        (!lookup.teamName || entry.teamName === lookup.teamName) &&
        entry.snapshots.length > 0
      )) ?? null
    }

    let candidates = document.teams.filter((entry) => (
      entry.snapshots.length > 0 &&
      (!lookup.teamName || entry.teamName === lookup.teamName)
    ))
    if (lookup.at !== undefined && Number.isFinite(lookup.at)) {
      candidates = candidates.filter((entry) => {
        const startedAt = this.archiveEntryCreatedAt(entry)
        const deletedAt = entry.snapshots.at(-1)?.deletedAt
          ? Date.parse(entry.snapshots.at(-1)!.deletedAt!)
          : Number.POSITIVE_INFINITY
        const nextStartedAt = document.teams
          .filter((candidate) => (
            candidate.teamName === entry.teamName &&
            candidate.incarnationId !== entry.incarnationId
          ))
          .map(candidate => this.archiveEntryCreatedAt(candidate))
          .filter(candidateStartedAt => candidateStartedAt > startedAt)
          .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY
        const endedAt = Math.min(
          Number.isFinite(deletedAt) ? deletedAt : Number.POSITIVE_INFINITY,
          nextStartedAt,
        )
        return startedAt <= lookup.at! && lookup.at! < endedAt
      })
    }
    return [...candidates].sort((left, right) => (
      this.archiveEntryCreatedAt(right) - this.archiveEntryCreatedAt(left) ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    ))[0] ?? null
  }

  private archiveEntryCreatedAt(entry: TeamWorkbenchArchiveEntry): number {
    const createdAt = entry.snapshots.at(-1)?.team.createdAt
    return Number.isFinite(createdAt) ? createdAt! : 0
  }

  private async readArchiveDocument(
    sessionId: string,
  ): Promise<TeamWorkbenchArchiveDocument | null> {
    try {
      const raw = JSON.parse(
        await fs.readFile(this.getWorkbenchArchivePath(sessionId), 'utf8'),
      ) as Record<string, unknown>
      if (
        raw.schemaVersion !== TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION ||
        raw.sessionId !== sessionId ||
        !Array.isArray(raw.teams)
      ) return null
      const groupedTeams = new Map<string, TeamWorkbenchArchiveEntry>()
      for (const value of raw.teams) {
        const entry = objectValue(value)
        const teamName = stringValue(entry?.teamName)
        const updatedAt = stringValue(entry?.updatedAt)
        if (!entry || !teamName || !updatedAt || !Array.isArray(entry.snapshots)) continue

        for (const snapshotValue of entry.snapshots) {
          const record = objectValue(snapshotValue)
          const teamRecord = objectValue(record?.team)
          if (
            !record ||
            !teamRecord ||
            !stringValue(record.version) ||
            !stringValue(record.generatedAt) ||
            !Array.isArray(record.tasks) ||
            !Array.isArray(record.messages)
          ) continue
          const createdAt = typeof teamRecord.createdAt === 'number'
            ? teamRecord.createdAt
            : Number(teamRecord.createdAt)
          const incarnationId = stringValue(teamRecord.incarnationId) ?? teamIncarnationId({
            name: stringValue(teamRecord.name) ?? teamName,
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
            leadSessionId: stringValue(teamRecord.leadSessionId),
          })
          const snapshot = {
            ...record,
            team: {
              ...teamRecord,
              incarnationId,
            },
          } as TeamWorkbenchSnapshot
          const key = `${teamName}\u0000${incarnationId}`
          const existing = groupedTeams.get(key)
          const snapshots = existing?.snapshots.at(-1)?.version === snapshot.version
            ? existing.snapshots
            : [...(existing?.snapshots ?? []), snapshot]
          groupedTeams.set(key, {
            ...(existing ?? entry),
            teamName,
            incarnationId,
            updatedAt: snapshot.generatedAt,
            snapshots,
          })
        }
      }
      const teams = [...groupedTeams.values()]
      return {
        ...raw,
        schemaVersion: TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION,
        sessionId,
        updatedAt: stringValue(raw.updatedAt) ?? teams.at(-1)?.updatedAt ?? new Date(0).toISOString(),
        teams,
      }
    } catch {
      return null
    }
  }

  private async writeArchiveDocument(
    filePath: string,
    document: TeamWorkbenchArchiveDocument,
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await fs.rename(temporaryPath, filePath)
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  private async withArchiveWriteLock<T>(
    filePath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.archiveWriteLocks.get(filePath) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    this.archiveWriteLocks.set(filePath, next)
    try {
      return await next
    } finally {
      if (this.archiveWriteLocks.get(filePath) === next) {
        this.archiveWriteLocks.delete(filePath)
      }
    }
  }

  // ── Delete team ─────────────────────────────────────────────────────────

  async deleteTeam(name: string): Promise<void> {
    const config = await this.loadTeamConfig(name)

    const hasActive = config.members.some(
      (m) => m.isActive === undefined || m.isActive === true,
    )
    if (hasActive) {
      throw ApiError.conflict(
        `Cannot delete team "${name}": has active members`,
      )
    }

    await this.getWorkbench(name)
    await this.markWorkbenchArchiveDeleted(
      name,
      config.leadSessionId,
      teamIncarnationId(config),
    )
    const teamDir = path.join(this.getTeamsDir(), name)
    await fs.rm(teamDir, { recursive: true, force: true })
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private async loadTeamConfig(name: string): Promise<TeamFileRaw> {
    const configPath = path.join(this.getTeamsDir(), name, 'config.json')

    try {
      const raw = await fs.readFile(configPath, 'utf-8')
      return JSON.parse(raw) as TeamFileRaw
    } catch {
      throw ApiError.notFound(`Team not found: ${name}`)
    }
  }

  /**
   * Discover member names from the inboxes/ directory.
   * Each file `{name}.json` in inboxes/ represents a team member.
   * Excludes the team-lead inbox since the leader is already in config.
   */
  private async discoverInboxMembers(teamName: string): Promise<string[]> {
    const inboxDir = path.join(this.getTeamsDir(), teamName, 'inboxes')

    try {
      const files = await fs.readdir(inboxDir)
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .filter((name) => name !== 'team-lead')
    } catch {
      return []
    }
  }

  private async readWorkbenchMessages(
    teamName: string,
  ): Promise<TeamWorkbenchMessage[]> {
    const inboxDir = path.join(this.getTeamsDir(), teamName, 'inboxes')
    let files: string[]
    try {
      files = (await fs.readdir(inboxDir)).filter((file) => file.endsWith('.json'))
    } catch {
      return []
    }

    type InboxMessage = {
      id?: unknown
      from?: unknown
      text?: unknown
      timestamp?: unknown
      color?: unknown
      summary?: unknown
    }
    type MessageAccumulator = {
      from: string
      text: string
      timestamp: string
      color?: string
      summary?: string
      recipients: Set<string>
    }

    const grouped = new Map<string, MessageAccumulator>()
    const occurrenceByRecipientAndContent = new Map<string, number>()
    for (const file of files.sort()) {
      const recipient = file.replace(/\.json$/, '')
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(inboxDir, file), 'utf8'))
        if (!Array.isArray(parsed)) continue

        for (const raw of parsed as InboxMessage[]) {
          if (
            typeof raw?.from !== 'string' ||
            typeof raw.text !== 'string' ||
            typeof raw.timestamp !== 'string'
          ) continue
          const messageId = typeof raw.id === 'string' && raw.id ? raw.id : undefined
          const summary = typeof raw.summary === 'string' ? raw.summary : undefined
          const color = typeof raw.color === 'string' ? raw.color : undefined
          const timestampSecond = raw.timestamp.slice(0, 19)
          const contentKey = hash(JSON.stringify([
            raw.from,
            raw.text,
            timestampSecond,
            summary ?? '',
            color ?? '',
          ]))
          // New envelopes carry a stable upstream ID, shared by every copy of a
          // broadcast. The occurrence fallback is only for legacy mailbox data
          // written before IDs were introduced.
          const occurrenceKey = `${recipient}\u0000${contentKey}`
          const occurrence = occurrenceByRecipientAndContent.get(occurrenceKey) ?? 0
          occurrenceByRecipientAndContent.set(occurrenceKey, occurrence + 1)
          const key = messageId ? `mailbox:${messageId}` : `legacy:${contentKey}:${occurrence}`
          const existing = grouped.get(key)
          if (existing) {
            existing.recipients.add(recipient)
            if (raw.timestamp < existing.timestamp) existing.timestamp = raw.timestamp
          } else {
            grouped.set(key, {
              from: raw.from,
              text: raw.text,
              timestamp: raw.timestamp,
              ...(summary ? { summary } : {}),
              ...(color ? { color } : {}),
              recipients: new Set([recipient]),
            })
          }
        }
      } catch {
        // A mailbox can be between its truncate and rename while the CLI is
        // writing it. The watcher will invalidate the snapshot again.
      }
    }

    return Array.from(grouped.entries())
      .map(([id, message]) => this.toWorkbenchMessage(id, message))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id))
  }

  private toWorkbenchMessage(
    id: string,
    message: {
      from: string
      text: string
      timestamp: string
      color?: string
      summary?: string
      recipients: Set<string>
    },
  ): TeamWorkbenchMessage {
    const recipients = Array.from(message.recipients).sort()
    let protocolType: string | undefined
    let taskId: string | undefined
    let text = message.text

    try {
      const structured = JSON.parse(message.text) as Record<string, unknown>
      if (typeof structured.type === 'string') protocolType = structured.type
      if (typeof structured.taskId === 'string') taskId = structured.taskId
      if (typeof structured.subject === 'string') text = structured.subject
      else if (typeof structured.reason === 'string') text = structured.reason
    } catch {
      // Ordinary teammate prose is the common path.
    }

    const isSystem = Boolean(protocolType)
    const isBroadcast = !isSystem && recipients.length > 1
    return {
      id,
      from: message.from,
      to: isBroadcast ? '*' : recipients[0] ?? '*',
      recipients,
      kind: isSystem ? 'system' : isBroadcast ? 'broadcast' : 'direct',
      text,
      timestamp: message.timestamp,
      ...(message.summary ? { summary: message.summary } : {}),
      ...(message.color ? { color: message.color } : {}),
      ...(taskId ? { taskId } : {}),
      ...(protocolType ? { protocolType } : {}),
    }
  }

  private toSummary(config: TeamFileRaw): TeamSummary {
    const activeMemberCount = config.members.filter(
      (m) => m.isActive === undefined || m.isActive === true,
    ).length

    return {
      name: config.name,
      description: config.description,
      createdAt: config.createdAt,
      incarnationId: teamIncarnationId(config),
      memberCount: config.members.length,
      activeMemberCount,
    }
  }

  private deriveStatus(
    isActive: boolean | undefined,
  ): 'running' | 'completed' | 'idle' | 'failed' {
    if (isActive === false) return 'idle'
    // isActive === undefined || isActive === true
    return 'running'
  }

  private async resolveMemberName(
    config: TeamFileRaw,
    teamName: string,
    agentId: string,
  ): Promise<string | null> {
    const configMember = config.members.find((m) => m.agentId === agentId)
    if (configMember?.name) {
      return configMember.name
    }

    const parsedName = agentId.includes('@') ? agentId.split('@')[0]! : agentId
    const inboxNames = await this.discoverInboxMembers(teamName)
    if (inboxNames.includes(parsedName)) {
      return parsedName
    }

    if (config.leadSessionId) {
      const subagentNames = await this.discoverSubagentMembers(
        config.leadSessionId,
      )
      if (subagentNames.includes(parsedName)) {
        return parsedName
      }
    }

    return null
  }

  private async discoverSubagentMembers(leadSessionId: string): Promise<string[]> {
    const projectsDir = this.getProjectsDir()

    try {
      await fs.access(projectsDir)
    } catch {
      return []
    }

    const discovered = new Set<string>()
    const projectEntries = await fs.readdir(projectsDir, {
      withFileTypes: true,
    })

    for (const projEntry of projectEntries) {
      if (!projEntry.isDirectory()) continue

      const subagentsDir = path.join(
        projectsDir,
        projEntry.name,
        leadSessionId,
        'subagents',
      )

      let files: string[]
      try {
        files = await fs.readdir(subagentsDir)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const discoveredName = await this.extractSubagentName(
          path.join(subagentsDir, file),
        )
        if (discoveredName && discoveredName !== 'team-lead') {
          discovered.add(discoveredName)
        }
      }
    }

    return [...discovered]
  }

  /** Search ~/.claude/projects/ for a JSONL file matching the sessionId. */
  private async findTranscriptFile(
    sessionId: string,
  ): Promise<string | null> {
    const projectsDir = this.getProjectsDir()

    try {
      await fs.access(projectsDir)
    } catch {
      return null
    }

    const projectEntries = await fs.readdir(projectsDir, {
      withFileTypes: true,
    })

    for (const entry of projectEntries) {
      if (!entry.isDirectory()) continue

      const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`)
      try {
        await fs.access(candidate)
        return candidate
      } catch {
        // Not in this project directory
      }
    }

    return null
  }

  /**
   * Search subagents directory for a specific member's transcript.
   * Path: ~/.claude/projects/{project}/{leadSessionId}/subagents/agent-*.jsonl
   *
   * Matches only persisted agent identity. Prompt text can legitimately mention
   * several teammates and cannot distinguish one execution transcript from another.
   */
  private async findSubagentTranscripts(
    leadSessionId: string,
    memberName: string,
    startedAt?: number,
    endedAt?: number,
  ): Promise<string[]> {
    const projectsDir = this.getProjectsDir()

    try {
      await fs.access(projectsDir)
    } catch {
      return []
    }

    const projectEntries = await fs.readdir(projectsDir, {
      withFileTypes: true,
    })

    for (const projEntry of projectEntries) {
      if (!projEntry.isDirectory()) continue

      const subagentsDir = path.join(
        projectsDir,
        projEntry.name,
        leadSessionId,
        'subagents',
      )

      let files: string[]
      try {
        files = await fs.readdir(subagentsDir)
      } catch {
        continue
      }

      const matches: Array<{ path: string; mtime: number }> = []

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue

        const filePath = path.join(subagentsDir, file)

        try {
          const metadataName = await this.extractSubagentMetadataName(filePath)
          const structuredName = await this.extractSubagentName(filePath)
          if (
            metadataName === memberName ||
            structuredName === memberName
          ) {
            if (!await this.transcriptBelongsToIncarnation(filePath, startedAt, endedAt)) {
              continue
            }
            const stat = await fs.stat(filePath)
            matches.push({ path: filePath, mtime: stat.mtimeMs })
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (matches.length > 0) {
        return matches
          .sort((left, right) => left.mtime - right.mtime || left.path.localeCompare(right.path))
          .map(match => match.path)
      }
    }

    return []
  }

  private async findTeammateSessionTranscripts(
    teamName: string,
    memberName: string,
    startedAt?: number,
    endedAt?: number,
  ): Promise<string[]> {
    const projectsDir = this.getProjectsDir()
    const readDirectoryEntries = async (directory: string) => {
      try {
        return await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return []
      }
    }
    const projectEntries = await readDirectoryEntries(projectsDir)
    if (projectEntries.length === 0) return []

    const matches: Array<{ path: string; mtime: number }> = []
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) continue
      const projectDir = path.join(projectsDir, projectEntry.name)
      const transcriptEntries = await readDirectoryEntries(projectDir)

      for (const transcriptEntry of transcriptEntries) {
        if (!transcriptEntry.isFile() || !transcriptEntry.name.endsWith('.jsonl')) continue
        const filePath = path.join(projectDir, transcriptEntry.name)
        const identity = await this.extractTeammateSessionIdentity(filePath)
        if (identity?.teamName !== teamName || identity.agentName !== memberName) continue
        if (!await this.transcriptBelongsToIncarnation(filePath, startedAt, endedAt)) continue
        try {
          const stat = await fs.stat(filePath)
          matches.push({ path: filePath, mtime: stat.mtimeMs })
        } catch {
          // The session may disappear while a completed team is being opened.
        }
      }
    }

    return matches
      .sort((left, right) => left.mtime - right.mtime || left.path.localeCompare(right.path))
      .map((match) => match.path)
  }

  /**
   * Legacy teammate transcripts persist only the mutable team name. Their
   * first durable timestamp is the strongest available incarnation boundary:
   * a late write to an old file must not make that file part of a recreated
   * team merely because its mtime is new.
   */
  private async transcriptBelongsToIncarnation(
    filePath: string,
    startedAt?: number,
    endedAt?: number,
  ): Promise<boolean> {
    if (!Number.isFinite(startedAt)) return true
    let firstTimestamp: number | undefined
    try {
      const head = await this.readTranscriptHead(filePath)
      for (const line of head.split('\n')) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line) as Record<string, unknown>
          const parsed = typeof entry.timestamp === 'string'
            ? Date.parse(entry.timestamp)
            : Number.NaN
          if (Number.isFinite(parsed)) {
            firstTimestamp = parsed
            break
          }
        } catch {
          // Ignore a partial bounded-preview line.
        }
      }
      if (firstTimestamp === undefined) {
        const stat = await fs.stat(filePath)
        firstTimestamp = stat.birthtimeMs || stat.ctimeMs
      }
    } catch {
      return false
    }

    return firstTimestamp >= startedAt! && (
      !Number.isFinite(endedAt) || firstTimestamp < endedAt!
    )
  }

  private async extractTeammateSessionIdentity(
    filePath: string,
  ): Promise<{ teamName: string; agentName: string } | null> {
    try {
      const head = await this.readTranscriptHead(filePath)
      for (const line of head.split('\n')) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line) as Record<string, unknown>
          const teamName = stringValue(entry.teamName)
          const agentName = stringValue(entry.agentName)
          if (teamName && agentName) return { teamName, agentName }
        } catch {
          // Ignore a partial final line in the bounded preview window.
        }
      }
      return null
    } catch {
      return null
    }
  }

  private async extractSubagentMetadataName(filePath: string): Promise<string | null> {
    try {
      const metadataPath = filePath.replace(/\.jsonl$/, '.meta.json')
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>
      return typeof metadata.agentType === 'string' && metadata.agentType.trim()
        ? metadata.agentType
        : null
    } catch {
      return null
    }
  }

  private async readTranscriptHead(filePath: string): Promise<string> {
    const fd = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(8192)
      const { bytesRead } = await fd.read(buf, 0, 8192, 0)
      return buf.toString('utf-8', 0, bytesRead)
    } finally {
      await fd.close()
    }
  }

  private async extractSubagentName(filePath: string): Promise<string | null> {
    try {
      const head = await this.readTranscriptHead(filePath)
      const lines = head.split('\n').filter((line) => line.trim().length > 0)

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>
          if (typeof entry.agentName === 'string' && entry.agentName.trim()) {
            return entry.agentName
          }
          if (typeof entry.agentId === 'string' && entry.agentId.includes('@')) {
            return entry.agentId.split('@')[0] ?? null
          }
        } catch {
          // Ignore partial or non-JSON lines in the preview window.
        }
      }
      return null
    } catch {
      return null
    }
  }

  private fileIdentity(stat: { dev: number; ino: number }): string | null {
    return process.platform === 'win32' || stat.ino === 0
      ? null
      : `${stat.dev}:${stat.ino}`
  }

  private transcriptMessageFromEntry(
    entry: Record<string, unknown>,
    ownerAgentId?: string,
  ): TranscriptMessage | null {
    const entryType = entry.type as string | undefined
    if (!entryType || !MESSAGE_ENTRY_TYPES.has(entryType) || entry.isMeta) return null
    const message = entry.message && typeof entry.message === 'object' && !Array.isArray(entry.message)
      ? entry.message as Record<string, unknown>
      : null
    const content = message && 'content' in message
      ? message.content
      : entry.content ?? entry.message ?? null
    const model = typeof entry.model === 'string'
      ? entry.model
      : typeof message?.model === 'string'
        ? message.model
        : undefined
    const transcriptMessage: TranscriptMessage = {
      id: (entry.uuid as string) || crypto.randomUUID(),
      type: entryType as TranscriptMessage['type'],
      content,
      timestamp: (entry.timestamp as string) || new Date().toISOString(),
      ...(typeof entry.parentToolUseId === 'string'
        ? { parentToolUseId: entry.parentToolUseId }
        : {}),
      ...(model ? { model } : {}),
      ...(entry.toolUseResult !== undefined ? { toolUseResult: entry.toolUseResult } : {}),
    }
    if (!ownerAgentId) return transcriptMessage
    return {
      ...transcriptMessage,
      id: fragmentScopedId(ownerAgentId, transcriptMessage.id),
      content: projectFragmentContent(transcriptMessage.content, ownerAgentId),
      ...(transcriptMessage.parentToolUseId
        ? {
            parentToolUseId: fragmentScopedId(
              ownerAgentId,
              transcriptMessage.parentToolUseId,
            ),
          }
        : {}),
      ...(transcriptMessage.toolUseResult !== undefined
        ? {
            toolUseResult: projectFragmentToolUseResult(
              transcriptMessage.toolUseResult,
              ownerAgentId,
            ),
          }
        : {}),
    }
  }

  private async filePreservesCursorPrefix(
    filePath: string,
    cursor: TranscriptCursor,
  ): Promise<boolean> {
    let handle: fs.FileHandle | undefined
    try {
      const stat = await fs.stat(filePath)
      const identity = this.fileIdentity(stat)
      if (stat.size <= cursor.size) return false
      if (
        cursor.fileIdentity !== null &&
        identity !== null &&
        cursor.fileIdentity !== identity
      ) return false

      handle = await fs.open(filePath, 'r')
      const firstLength = Math.min(cursor.size, CURSOR_WINDOW_BYTES)
      const lastStart = Math.max(0, cursor.size - CURSOR_WINDOW_BYTES)
      const lastLength = cursor.size - lastStart
      const first = Buffer.alloc(firstLength)
      const last = Buffer.alloc(lastLength)
      if (firstLength > 0) await handle.read(first, 0, firstLength, 0)
      if (lastLength > 0) await handle.read(last, 0, lastLength, lastStart)
      return hash(first) === cursor.firstWindowHash &&
        hash(last) === cursor.lastWindowHash
    } catch {
      return false
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  private async readIndexedTranscriptPage(
    filePath: string,
    options: TeamTranscriptPageOptions,
    projection: TranscriptFragmentProjection = {},
  ): Promise<TeamTranscriptPage | null> {
    try {
      if (
        this.localIndexGateway.getMode() !== 'on' ||
        !this.localIndexGateway.isSessionScopeReady() ||
        !this.localIndexGateway.getSessionEntryLocators
      ) return null
      const page = this.localIndexGateway.getSessionEntryLocators(filePath)
      if (!page) return null
      // A pending source can contain a valid final JSON object without a
      // newline. Locators intentionally exclude that tail, while the legacy
      // canonical parser includes it, so never serve a partial indexed page.
      if (
        page.source.state !== 'ready' ||
        page.source.indexedBytes !== page.source.size
      ) return null
      const fingerprint = deserializeSourceFingerprint(page.source.fingerprint)
      if (!fingerprint) return null
      const currentStat = await fs.stat(filePath)
      const currentIdentity = this.fileIdentity(currentStat)

      const currentAfterOrdinal = page.entries.at(-1)?.ordinal ?? -1
      const signature = hash(page.source.fingerprint)
      const previousCursor = decodeTranscriptCursor(options.cursor)
      let afterOrdinal = options.afterOrdinal ?? -1
      let reset = false
      if (options.cursor !== undefined && !previousCursor) {
        afterOrdinal = -1
        reset = true
      } else if (afterOrdinal >= 0 && (!options.signature || !previousCursor)) {
        afterOrdinal = -1
        reset = true
      } else if (afterOrdinal > currentAfterOrdinal) {
        afterOrdinal = -1
        reset = true
      } else if (previousCursor && previousCursor.afterOrdinal !== afterOrdinal) {
        afterOrdinal = -1
        reset = true
      } else if (options.signature) {
        if (options.signature === signature) {
          const snapshotMatches = previousCursor &&
            previousCursor.size === currentStat.size &&
            previousCursor.ctimeMs === currentStat.ctimeMs &&
            (
              previousCursor.fileIdentity === null ||
              currentIdentity === null ||
              previousCursor.fileIdentity === currentIdentity
            )
          if (!snapshotMatches) {
            afterOrdinal = -1
            reset = true
          }
        } else {
          const appendProven = previousCursor &&
            currentStat.size > previousCursor.size &&
            await this.filePreservesCursorPrefix(filePath, previousCursor)
          if (!appendProven) {
            afterOrdinal = -1
            reset = true
          }
        }
      }

      if (currentStat.size !== fingerprint.size) {
        return null
      }

      const selected = page.entries.filter(locator =>
        locator.ordinal > afterOrdinal && (
          MESSAGE_ENTRY_TYPES.has(locator.entryType) ||
          locator.entryType === PERSISTED_TASK_NOTIFICATION_ENTRY_TYPE
        ),
      )
      const result = await this.targetedEntryReader({
        transcriptPath: filePath,
        projectsRoot: this.getProjectsDir(),
        expectedProjectDir: path.basename(path.dirname(filePath)),
        page: { source: page.source, entries: selected },
      })
      if (!result) return null
      const statAfterRead = await fs.stat(filePath)
      if (!sameTranscriptFileSnapshot(currentStat, statAfterRead)) return null

      const messages = result.entries
        .map(entry => this.transcriptMessageFromEntry(entry, projection.ownerAgentId))
        .filter((message): message is TranscriptMessage => message !== null)
      const taskNotifications = new Map<string, SessionTaskNotification>()
      for (const entry of result.entries) {
        const notification = taskNotificationFromEntry(entry, projection.ownerAgentId)
        if (notification) taskNotifications.set(notification.toolUseId, notification)
      }
      const cursor = encodeTranscriptCursor({
        version: 2,
        size: fingerprint.size,
        ctimeMs: currentStat.ctimeMs,
        fileIdentity: currentIdentity,
        firstWindowHash: fingerprint.firstWindowHash,
        lastWindowHash: fingerprint.lastWindowHash,
        afterOrdinal: currentAfterOrdinal,
      })
      return {
        messages,
        ownerAgentIds: projection.ownerAgentIds ?? [],
        taskNotifications: [...taskNotifications.values()],
        signature,
        cursor,
        afterOrdinal: currentAfterOrdinal,
        ...(reset ? { reset: true } : {}),
      }
    } catch {
      return null
    }
  }

  /** Canonical parser used for legacy reads and every degraded/stale fallback. */
  private async parseTranscriptFilePage(
    filePath: string,
    options: TeamTranscriptPageOptions,
    projection: TranscriptFragmentProjection = {},
  ): Promise<TeamTranscriptPage> {
    const bytes = await fs.readFile(filePath)
    const stat = await fs.stat(filePath)
    return this.parseTranscriptBufferPage(
      bytes,
      options,
      stat.ctimeMs,
      this.fileIdentity(stat),
      projection,
    )
  }

  private async parseTranscriptFragmentsPage(
    sources: Array<{ filePath: string; ownerAgentId?: string }>,
    options: TeamTranscriptPageOptions,
  ): Promise<TeamTranscriptPage> {
    const fragments = await Promise.all(sources.map(async source => {
      const [bytes, stat] = await Promise.all([
        fs.readFile(source.filePath),
        fs.stat(source.filePath),
      ])
      return { ...source, bytes, ctimeMs: stat.ctimeMs }
    }))
    const ownerAgentIdByOrdinal: Array<string | undefined> = []
    for (const fragment of fragments) {
      for (const line of fragment.bytes.toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          JSON.parse(line)
          ownerAgentIdByOrdinal.push(fragment.ownerAgentId)
        } catch {
          // Keep this aligned with parseTranscriptBufferPage's ordinal rules.
        }
      }
    }
    const bytes = Buffer.concat(fragments.flatMap((fragment, index) => (
      index === fragments.length - 1
        ? [fragment.bytes]
        : [fragment.bytes, Buffer.from('\n')]
    )))
    return this.parseTranscriptBufferPage(
      bytes,
      options,
      Math.max(0, ...fragments.map(fragment => fragment.ctimeMs)),
      null,
      {
        ownerAgentIdByOrdinal,
        ownerAgentIds: [...new Set(fragments
          .map(fragment => fragment.ownerAgentId)
          .filter((ownerAgentId): ownerAgentId is string => Boolean(ownerAgentId)))],
      },
    )
  }

  private parseTranscriptBufferPage(
    bytes: Buffer,
    options: TeamTranscriptPageOptions,
    ctimeMs: number,
    identity: string | null,
    projection: TranscriptFragmentProjection = {},
  ): TeamTranscriptPage {
    const entries: Array<{
      ordinal: number
      message?: TranscriptMessage
      taskNotification?: SessionTaskNotification
    }> = []
    let ordinal = -1
    for (const line of bytes.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as Record<string, unknown>
        ordinal += 1
        const ownerAgentId = projection.ownerAgentIdByOrdinal?.[ordinal] ??
          projection.ownerAgentId
        const message = this.transcriptMessageFromEntry(entry, ownerAgentId)
        const taskNotification = taskNotificationFromEntry(entry, ownerAgentId)
        if (message || taskNotification) {
          entries.push({
            ordinal,
            ...(message ? { message } : {}),
            ...(taskNotification ? { taskNotification } : {}),
          })
        }
      } catch {
        // Skip unparseable lines
      }
    }
    const currentAfterOrdinal = ordinal
    const signature = hash(bytes)
    const previousCursor = decodeTranscriptCursor(options.cursor)
    let afterOrdinal = options.afterOrdinal ?? -1
    let reset = false
    if (options.cursor !== undefined && !previousCursor) {
      afterOrdinal = -1
      reset = true
    } else if (afterOrdinal >= 0 && !options.signature) {
      afterOrdinal = -1
      reset = true
    } else if (afterOrdinal > currentAfterOrdinal) {
      afterOrdinal = -1
      reset = true
    } else if (previousCursor && previousCursor.afterOrdinal !== afterOrdinal) {
      afterOrdinal = -1
      reset = true
    } else if (options.signature) {
      if (options.signature === signature) {
        const snapshotMismatch = previousCursor &&
          (
            previousCursor.size !== bytes.length ||
            previousCursor.ctimeMs !== ctimeMs ||
            (
              previousCursor.fileIdentity !== null &&
              identity !== null &&
              previousCursor.fileIdentity !== identity
            )
          )
        if (snapshotMismatch) {
          afterOrdinal = -1
          reset = true
        }
      } else {
        const appendProven = previousCursor &&
          bytes.length > previousCursor.size &&
          bufferPreservesCursorPrefix(bytes, previousCursor, identity)
        if (!appendProven) {
          afterOrdinal = -1
          reset = true
        }
      }
    }
    const cursor = encodeTranscriptCursor(cursorForBuffer(
      bytes,
      identity,
      ctimeMs,
      currentAfterOrdinal,
    ))
    return {
      messages: entries
        .filter((entry): entry is typeof entry & { message: TranscriptMessage } => (
          entry.ordinal > afterOrdinal && entry.message !== undefined
        ))
        .map(entry => entry.message),
      ownerAgentIds: projection.ownerAgentIds ?? [],
      taskNotifications: [...entries
        .filter((entry): entry is typeof entry & { taskNotification: SessionTaskNotification } => (
          entry.ordinal > afterOrdinal && entry.taskNotification !== undefined
        ))
        .reduce((notifications, entry) => {
          notifications.set(entry.taskNotification.toolUseId, entry.taskNotification)
          return notifications
        }, new Map<string, SessionTaskNotification>())
        .values()],
      signature,
      cursor,
      afterOrdinal: currentAfterOrdinal,
      ...(reset ? { reset: true } : {}),
    }
  }
}

export const teamService = new TeamService()
