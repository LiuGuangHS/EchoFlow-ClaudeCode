import { api } from './client'
import type {
  TeamSummary,
  TeamDetail,
  TeamWorkbenchSnapshot,
  TeamWorkbenchSessionTimeline,
} from '../types/team'

type TeamsResponse = { teams: TeamSummary[] }

type TranscriptMessage = {
  id: string
  type: string
  content: unknown
  timestamp: string
  model?: string
  parentToolUseId?: string
  toolUseResult?: unknown
}

type TranscriptResponse = {
  messages: TranscriptMessage[]
  signature?: string
  cursor?: string
  afterOrdinal?: number
  reset?: boolean
}

type TranscriptOptions = {
  signature?: string
  cursor?: string
  afterOrdinal?: number
  leadSessionId?: string
}

export type { TranscriptMessage }

export const teamsApi = {
  list() {
    return api.get<TeamsResponse>('/api/teams')
  },

  get(name: string) {
    return api.get<TeamDetail>(`/api/teams/${encodeURIComponent(name)}`)
  },

  getWorkbench(name: string) {
    return api.get<TeamWorkbenchSnapshot>(
      `/api/teams/${encodeURIComponent(name)}/workbench`,
    )
  },

  getWorkbenchForSession(sessionId: string) {
    return api.get<TeamWorkbenchSessionTimeline>(
      `/api/teams/session/${encodeURIComponent(sessionId)}/workbench`,
    )
  },

  getMemberTranscript(
    teamName: string,
    agentId: string,
    options?: TranscriptOptions,
  ) {
    const params = new URLSearchParams()
    if (options) {
      params.set('incremental', 'true')
      if (options.leadSessionId) params.set('leadSessionId', options.leadSessionId)
      if (options.signature) params.set('signature', options.signature)
      if (options.cursor) params.set('cursor', options.cursor)
      if (options.afterOrdinal !== undefined) {
        params.set('afterOrdinal', String(options.afterOrdinal))
      }
    }
    const query = params.toString()
    return api.get<TranscriptResponse>(
      `/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(agentId)}/transcript${query ? `?${query}` : ''}`,
    )
  },

  sendMemberMessage(teamName: string, agentId: string, content: string) {
    return api.post<{ ok: true }>(
      `/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(agentId)}/messages`,
      { content },
    )
  },

  delete(name: string) {
    return api.delete<{ ok: true }>(`/api/teams/${encodeURIComponent(name)}`)
  },
}
