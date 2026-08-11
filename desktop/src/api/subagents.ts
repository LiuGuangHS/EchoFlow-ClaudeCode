import { api } from './client'
import type { MessageEntry } from '../types/session'

export type SubagentRunStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'
export type SubagentRunSource = 'subagent-jsonl' | 'session-history' | 'live-task' | 'none'

export type SubagentRunUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type SubagentRunResponse = {
  sessionId: string
  toolUseId: string
  agentId: string | null
  taskId?: string
  status: SubagentRunStatus
  description?: string
  prompt?: string
  summary?: string
  result?: string
  outputFile?: string
  usage?: SubagentRunUsage
  messages: MessageEntry[]
  truncated: boolean
  updatedAt?: string
  source: SubagentRunSource
  /**
   * Whether a follow-up can still reach this agent. Only named teammates and
   * in-flight background agents have an inbox — a one-shot subagent answers
   * once and is done, so the page shows its record without a composer.
   * Optional so a response from an older server still parses.
   */
  canSendMessage?: boolean
}

export const subagentsApi = {
  getRunByTool(sessionId: string, toolUseId: string, taskId?: string) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
    return api.get<SubagentRunResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/subagents/by-tool/${encodeURIComponent(toolUseId)}${query}`,
    )
  },

  sendMessage(sessionId: string, toolUseId: string, content: string, taskId?: string) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
    return api.post<{ ok: true; delivery?: 'queued' | 'resumed'; agent_id?: string }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/subagents/by-tool/${encodeURIComponent(toolUseId)}/messages${query}`,
      { content },
    )
  },
}
