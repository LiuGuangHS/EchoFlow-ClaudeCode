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
  snapshots: TeamWorkbenchSnapshot[]
  source: 'live' | 'archive' | 'transcript'
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

const CURSOR_WINDOW_BYTES = 64 * 1024
const MESSAGE_ENTRY_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'tool_use',
  'tool_result',
])

const TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION = 1
const TEAM_WORKBENCH_ARCHIVE_HISTORY_LIMIT = 200

type TeamWorkbenchArchiveEntry = {
  teamName: string
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
): Map<string, Record<string, unknown>> {
  const results = new Map<string, Record<string, unknown>>()
  for (const message of messages) {
    if (message.type !== 'tool_result') continue
    const blocks = Array.isArray(message.content) ? message.content : []
    for (const block of blocks) {
      const record = objectValue(block)
      const toolUseId = stringValue(record?.tool_use_id)
      if (!toolUseId) continue
      const structured = objectValue(message.toolUseResult)
      results.set(toolUseId, structured ?? record!)
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
      const result = results.get(toolUseId) ?? {}

      if (name === 'TeamCreate') {
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

    try {
      config = await this.loadTeamConfig(teamName)
      memberName = await this.resolveMemberName(config, teamName, agentId)
      const configMember = config.members.find((candidate) => candidate.agentId === agentId)
      memberSessionId = configMember?.sessionId
      leadSessionId = config.leadSessionId
    } catch (error) {
      configError = error
      if (leadSessionId) {
        const archive = await this.readArchiveDocument(leadSessionId)
        const archivedSnapshot = archive?.teams
          .find((entry) => entry.teamName === teamName)
          ?.snapshots.at(-1)
        const archivedMember = archivedSnapshot?.team.members.find((candidate) => (
          candidate.agentId === agentId || candidate.name === agentId
        ))
        memberName = archivedMember?.name ?? null
        memberSessionId = archivedMember?.sessionId
        leadSessionId = archivedSnapshot?.team.leadSessionId ?? leadSessionId
      }
    }

    if (!memberName) {
      if (configError && !leadSessionId) throw configError
      throw ApiError.notFound(
        `Team member not found: ${agentId} in team ${teamName}`,
      )
    }

    let transcriptPath: string | null = null

    // Try config.json member with sessionId first. SessionService uses the
    // scalar session index for this lookup when it is ready.
    if (memberSessionId) {
      transcriptPath = (await this.sessionLocator.findSessionFile(memberSessionId))?.filePath ??
        await this.findTranscriptFile(memberSessionId)
    }

    // Fallback: aggregate every in-process transcript fragment for this member.
    // A teammate can be resumed many times and each resume owns a new agent-*.jsonl
    // file. Treating only the newest fragment as the conversation made the member
    // page lose its earlier messages and often left it looking empty.
    if (!transcriptPath && leadSessionId) {
      const subagentPaths = await this.findSubagentTranscripts(
        leadSessionId,
        memberName,
      )
      if (subagentPaths.length === 1) {
        transcriptPath = subagentPaths[0] ?? null
      } else if (subagentPaths.length > 1) {
        return this.parseTranscriptFragmentsPage(subagentPaths, options)
      }
    }
    if (!transcriptPath) {
      return {
        messages: [],
        signature: 'missing',
        cursor: encodeTranscriptCursor(cursorForBuffer(Buffer.alloc(0), null, 0, -1)),
        afterOrdinal: -1,
      }
    }

    const indexed = await this.readIndexedTranscriptPage(transcriptPath, options)
    if (indexed) return indexed
    return this.parseTranscriptFilePage(transcriptPath, options)
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
  ): Promise<TeamWorkbenchSessionTimeline | null> {
    const liveTeams = await this.listTeams()
    for (const summary of liveTeams) {
      try {
        const team = await this.getTeam(summary.name)
        if (team.leadSessionId !== sessionId) continue
        await this.getWorkbench(team.name)
        const entry = this.latestArchiveEntry(await this.readArchiveDocument(sessionId))
        if (!entry) return null
        return {
          sessionId,
          teamName: entry.teamName,
          snapshots: entry.snapshots,
          source: 'live',
        }
      } catch {
        // Another CLI process can remove a team between list and detail reads.
      }
    }

    const archived = this.latestArchiveEntry(await this.readArchiveDocument(sessionId))
    if (archived) {
      return {
        sessionId,
        teamName: archived.teamName,
        snapshots: archived.snapshots,
        source: 'archive',
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
    const migrated = this.latestArchiveEntry(await this.readArchiveDocument(sessionId))
    if (!migrated) return null
    return {
      sessionId,
      teamName: migrated.teamName,
      snapshots: migrated.snapshots,
      source: 'transcript',
    }
  }

  async archiveWorkbenchSnapshot(snapshot: TeamWorkbenchSnapshot): Promise<void> {
    const sessionId = snapshot.team.leadSessionId
    if (!sessionId) return
    const filePath = this.getWorkbenchArchivePath(sessionId)
    await this.withArchiveWriteLock(filePath, async () => {
      const current = await this.readArchiveDocument(sessionId) ?? {
        schemaVersion: TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION,
        sessionId,
        updatedAt: snapshot.generatedAt,
        teams: [],
      }
      const teams = [...current.teams]
      const index = teams.findIndex((entry) => entry.teamName === snapshot.team.name)
      const existing = index >= 0 ? teams[index] : undefined
      const snapshots = existing?.snapshots.at(-1)?.version === snapshot.version
        ? existing.snapshots
        : [...(existing?.snapshots ?? []), snapshot].slice(-TEAM_WORKBENCH_ARCHIVE_HISTORY_LIMIT)
      const nextEntry: TeamWorkbenchArchiveEntry = {
        ...(existing ?? {}),
        teamName: snapshot.team.name,
        updatedAt: snapshot.generatedAt,
        snapshots,
      }
      if (index >= 0) teams[index] = nextEntry
      else teams.push(nextEntry)
      await this.writeArchiveDocument(filePath, {
        ...current,
        schemaVersion: TEAM_WORKBENCH_ARCHIVE_SCHEMA_VERSION,
        sessionId,
        updatedAt: snapshot.generatedAt,
        teams,
      })
    })
  }

  async markWorkbenchArchiveDeleted(
    teamName: string,
    sessionId: string | undefined,
  ): Promise<void> {
    if (!sessionId) return
    const document = await this.readArchiveDocument(sessionId)
    const entry = document?.teams.find((candidate) => candidate.teamName === teamName)
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
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        right.teamName.localeCompare(left.teamName)
      ))[0] ?? null
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
      const teams = raw.teams.flatMap((value) => {
        const entry = objectValue(value)
        const teamName = stringValue(entry?.teamName)
        const updatedAt = stringValue(entry?.updatedAt)
        const snapshots = Array.isArray(entry?.snapshots)
          ? entry.snapshots.filter((snapshot): snapshot is TeamWorkbenchSnapshot => {
            const record = objectValue(snapshot)
            return Boolean(
              stringValue(record?.version) &&
              stringValue(record?.generatedAt) &&
              objectValue(record?.team) &&
              Array.isArray(record?.tasks) &&
              Array.isArray(record?.messages),
            )
          })
          : []
        if (!entry || !teamName || !updatedAt || snapshots.length === 0) return []
        return [{ ...entry, teamName, updatedAt, snapshots } as TeamWorkbenchArchiveEntry]
      })
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
    await this.markWorkbenchArchiveDeleted(name, config.leadSessionId)
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
    return {
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
        locator.ordinal > afterOrdinal && MESSAGE_ENTRY_TYPES.has(locator.entryType),
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
        .map(entry => this.transcriptMessageFromEntry(entry))
        .filter((message): message is TranscriptMessage => message !== null)
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
  ): Promise<TeamTranscriptPage> {
    const bytes = await fs.readFile(filePath)
    const stat = await fs.stat(filePath)
    return this.parseTranscriptBufferPage(
      bytes,
      options,
      stat.ctimeMs,
      this.fileIdentity(stat),
    )
  }

  private async parseTranscriptFragmentsPage(
    filePaths: string[],
    options: TeamTranscriptPageOptions,
  ): Promise<TeamTranscriptPage> {
    const fragments = await Promise.all(filePaths.map(async filePath => {
      const [bytes, stat] = await Promise.all([
        fs.readFile(filePath),
        fs.stat(filePath),
      ])
      return { bytes, ctimeMs: stat.ctimeMs }
    }))
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
    )
  }

  private parseTranscriptBufferPage(
    bytes: Buffer,
    options: TeamTranscriptPageOptions,
    ctimeMs: number,
    identity: string | null,
  ): TeamTranscriptPage {
    const entries: Array<{ ordinal: number; message: TranscriptMessage }> = []
    let ordinal = -1
    for (const line of bytes.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as Record<string, unknown>
        ordinal += 1
        const message = this.transcriptMessageFromEntry(entry)
        if (message) entries.push({ ordinal, message })
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
        .filter(entry => entry.ordinal > afterOrdinal)
        .map(entry => entry.message),
      signature,
      cursor,
      afterOrdinal: currentAfterOrdinal,
      ...(reset ? { reset: true } : {}),
    }
  }
}

export const teamService = new TeamService()
