import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import {
  subagentsApi,
  type SubagentRunResponse,
  type SubagentRunStatus,
} from '../api/subagents'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { Badge, type Tone as BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '../i18n'
import {
  createDefaultSessionState,
  mapHistoryMessagesToUiMessages,
  useChatStore,
} from '../stores/chatStore'
import { SUBAGENT_TAB_PREFIX, useTabStore } from '../stores/tabStore'
import type { UIMessage } from '../types/chat'

type TranslationFn = ReturnType<typeof useTranslation>
const LIVE_RUN_REFRESH_MS = 2000

export function SubagentRunPage({
  sourceSessionId,
  toolUseId,
  taskId,
  title,
}: {
  sourceSessionId: string
  toolUseId: string
  taskId?: string
  title: string
}) {
  const t = useTranslation()
  const [data, setData] = useState<SubagentRunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const tabId = useTabStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.sessionId === state.activeTabId)
    return activeTab?.type === 'subagent' && activeTab.subagentToolUseId === toolUseId
      ? activeTab.sessionId
      : `${SUBAGENT_TAB_PREFIX}${sourceSessionId}__${toolUseId}`
  })
  const discoveredTaskId = useChatStore((state) => {
    const session = state.sessions[sourceSessionId]
    const liveTask = Object.values(session?.backgroundAgentTasks ?? {})
      .find((candidate) => candidate.toolUseId === toolUseId)
    return liveTask?.taskId ?? session?.agentTaskNotifications?.[toolUseId]?.taskId
  })
  const resolvedTaskId = taskId ?? discoveredTaskId

  const handleReturn = () => {
    const store = useTabStore.getState()
    const activeTab = store.tabs.find((tab) => tab.sessionId === store.activeTabId)
    const tabId = activeTab?.type === 'subagent' && activeTab.subagentToolUseId === toolUseId
      ? activeTab.sessionId
      : `${SUBAGENT_TAB_PREFIX}${sourceSessionId}__${toolUseId}`
    store.returnFromSubagent(tabId)
  }

  const load = useCallback(async (options?: { resetData?: boolean }) => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    if (options?.resetData) setData(null)
    try {
      const nextData = await subagentsApi.getRunByTool(sourceSessionId, toolUseId, resolvedTaskId)
      if (requestIdRef.current !== requestId) return
      setData(nextData)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestIdRef.current !== requestId) return
      setLoading(false)
    }
  }, [resolvedTaskId, sourceSessionId, toolUseId])

  useEffect(() => {
    void load({ resetData: true })
  }, [load])

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(() => void load(), LIVE_RUN_REFRESH_MS)
    return () => window.clearTimeout(timer)
  }, [data?.updatedAt, load, loading])

  useEffect(() => {
    if (!data) return
    const transcriptMessages = buildSubagentConversationMessages(data)
    useChatStore.setState((state) => {
      const existing = state.sessions[tabId] ?? createDefaultSessionState()
      const localMessages = existing.messages.filter((message) => {
        if (message.type === 'error' && message.code === 'SUBAGENT_MESSAGE_FAILED') {
          return true
        }
        return message.type === 'user_text' && !transcriptMessages.some((candidate) => (
          candidate.type === 'user_text' && candidate.content === message.content
        ))
      })
      const hasPendingMessage = localMessages.some((message) => (
        message.type === 'user_text' && message.pending === true
      ))
      return {
        sessions: {
          ...state.sessions,
          [tabId]: {
            ...existing,
            messages: [...transcriptMessages, ...localMessages],
            connectionState: 'connected',
            chatState: data.status === 'running' || hasPendingMessage
              ? 'thinking'
              : 'idle',
          },
        },
      }
    })
  }, [data, tabId])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            variant="ghost"
            size="base"
            onClick={handleReturn}
            icon={<ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />}
            className="mt-0.5 shrink-0"
          >
            {t('subagentRun.backToParent')}
          </Button>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1
                className="min-w-0 truncate text-[16.5px] font-semibold leading-tight text-[var(--color-text-primary)]"
                style={{ fontFamily: 'var(--font-headline)' }}
              >
                {title}
              </h1>
              {data ? <StatusBadge status={data.status} t={t} /> : null}
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {sourceSessionId} / {toolUseId}
            </p>
            {data ? (
              <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-[11px] text-[var(--color-text-tertiary)]">
                <span>{t('subagentRun.agent')}: {data.agentId ?? t('subagentRun.unknown')}</span>
                {data.description ? <span>{data.description}</span> : null}
                {data.outputFile ? <span>{t('subagentRun.output')}: {data.outputFile}</span> : null}
              </p>
            ) : null}
          </div>
        </div>
        {/* The icon spins in place while loading rather than using IconButton's
            `loading` prop, which would swap RefreshCw for the generic Spinner. */}
        <IconButton
          icon={<RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" className={loading ? 'animate-spin' : undefined} />}
          label={t('subagentRun.refresh')}
          showTooltip={false}
          size="md"
          tone="muted"
          onClick={() => void load()}
          disabled={loading}
        />
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {loading && !data ? (
          <div role="status" className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-tertiary)]">{t('subagentRun.loading')}</div>
        ) : null}
        {error ? (
          <div role="alert" className="mx-5 mt-4 rounded-[var(--radius-md)] border border-[var(--color-error)] bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-on-error-container)]">
            {error}
          </div>
        ) : null}
        {data ? (
          <div data-testid="subagent-conversation" className="flex min-h-0 flex-1 flex-col">
            <MessageList sessionId={tabId} />
          </div>
        ) : null}
      </main>
      {/* A one-shot subagent has no inbox: the parent turn already collected
          its answer, so a message here would only fork a detached background
          copy. Only teammates and in-flight background agents get a composer. */}
      {data?.canSendMessage ? <ChatInput /> : null}
      {data && !data.canSendMessage ? (
        <p
          data-testid="subagent-readonly-note"
          className="shrink-0 border-t border-[var(--color-border)] px-5 py-3 text-center text-[11.5px] text-[var(--color-text-tertiary)]"
        >
          {t('subagentRun.readOnly')}
        </p>
      ) : null}
    </div>
  )
}

function StatusBadge({ status, t }: { status: SubagentRunStatus; t: TranslationFn }) {
  return (
    <Badge tone={statusTone(status)} size="xs" bordered>
      {getSubagentStatusLabel(status, t)}
    </Badge>
  )
}

function statusTone(status: SubagentRunStatus): BadgeTone {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'stopped') return 'danger'
  if (status === 'running') return 'brand'
  return 'neutral'
}

function getSubagentStatusLabel(status: SubagentRunStatus, t: TranslationFn) {
  switch (status) {
    case 'completed':
      return t('subagentRun.status.completed')
    case 'failed':
      return t('subagentRun.status.failed')
    case 'stopped':
      return t('subagentRun.status.stopped')
    case 'running':
      return t('subagentRun.status.running')
    case 'unknown':
      return t('subagentRun.status.unknown')
  }
}

function timestampMs(value: string | undefined) {
  if (!value) return Date.now()
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : Date.now()
}

function normalizedText(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function hasPromptMessage(messages: UIMessage[], prompt: string) {
  const normalizedPrompt = normalizedText(prompt)
  if (!normalizedPrompt) return false

  return messages.some((message) => (
    message.type === 'user_text' &&
    normalizedText(message.content) === normalizedPrompt
  ))
}

function buildSubagentConversationMessages(data: SubagentRunResponse): UIMessage[] {
  const transcriptMessages = mapHistoryMessagesToUiMessages(data.messages, { includeTeammateMessages: true })
  const messages = [...transcriptMessages]
  const prompt = data.prompt?.trim()
  const baseTimestamp = timestampMs(data.updatedAt)

  if (prompt && !hasPromptMessage(transcriptMessages, prompt)) {
    messages.unshift({
      id: `subagent-prompt-${data.toolUseId}`,
      type: 'user_text',
      content: prompt,
      timestamp: baseTimestamp - 1,
    })
  }

  const resultText = (data.result || data.summary)?.trim()
  if (transcriptMessages.length === 0 && resultText) {
    messages.push({
      id: `subagent-result-message-${data.toolUseId}`,
      type: 'assistant_text',
      content: resultText,
      timestamp: baseTimestamp,
    })
  }

  return messages
}
