import { useMemo, useState } from 'react'
import { Megaphone, MessageSquare, Radio, Settings2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import type { TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../../types/team'
import {
  formatWorkbenchMessageTime,
  parseWorkbenchMessageBody,
  type WorkbenchMessageBody,
} from './agentTeamsModel'

type TranslationFn = ReturnType<typeof useTranslation>

/** Beyond this the body collapses behind a "show more" toggle. */
const COLLAPSED_BODY_CHARS = 260

function kindIcon(kind: TeamWorkbenchMessage['kind']): LucideIcon {
  if (kind === 'broadcast') return Megaphone
  if (kind === 'direct') return MessageSquare
  return Settings2
}

function kindLabel(kind: TeamWorkbenchMessage['kind'], t: TranslationFn): string {
  if (kind === 'direct') return t('agentTeams.communication.direct')
  if (kind === 'broadcast') return t('agentTeams.communication.broadcast')
  return t('agentTeams.communication.system')
}

function kindColor(kind: TeamWorkbenchMessage['kind']): string {
  if (kind === 'direct') return 'var(--color-brand)'
  if (kind === 'broadcast') return 'var(--color-warning)'
  return 'var(--color-text-tertiary)'
}

function lifecycleNarration(
  body: Extract<WorkbenchMessageBody, { kind: 'lifecycle' }>,
  message: TeamWorkbenchMessage,
  t: TranslationFn,
): string {
  if (body.type === 'task_assignment') {
    return t('agentTeams.communication.taskAssignment', {
      task: message.taskId ? `#${message.taskId}` : '',
      subject: body.detail ?? '',
    })
  }
  const narration = t(`agentTeams.communication.lifecycle.${body.type}` as TranslationKey)
  return body.detail ? `${narration} · ${body.detail}` : narration
}

export function AgentTeamsCommunicationFeed({
  snapshot,
  fill = false,
}: {
  snapshot: TeamWorkbenchSnapshot
  /** Full-height layouts let the feed own its column instead of a fixed strip. */
  fill?: boolean
}) {
  const t = useTranslation()
  const [showLifecycle, setShowLifecycle] = useState(false)

  const rows = useMemo(() => snapshot.messages
    .map((message) => ({ message, body: parseWorkbenchMessageBody(message) }))
    .reverse(), [snapshot.messages])
  const lifecycleCount = rows.filter(({ body }) => body.kind === 'lifecycle').length
  const visibleRows = showLifecycle ? rows : rows.filter(({ body }) => body.kind !== 'lifecycle')

  return (
    <section
      data-testid="agent-teams-communication"
      className={[
        'flex min-h-0 flex-col border-[var(--color-border)] bg-[var(--color-surface)]',
        fill
          ? 'h-full w-[min(400px,38%)] shrink-0 border-l'
          : 'h-[210px] shrink-0 border-t',
      ].join(' ')}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pb-1.5 pt-2.5">
        <h3 className="text-[12px] font-extrabold tracking-[-0.1px]">
          {t('agentTeams.communication.title')}
        </h3>
        <span className="text-[10.5px] text-[var(--color-text-tertiary)]">
          {t('agentTeams.communication.count', { count: visibleRows.length })}
        </span>
        {lifecycleCount > 0 ? (
          <button
            type="button"
            data-testid="agent-teams-lifecycle-toggle"
            aria-pressed={showLifecycle}
            onClick={() => setShowLifecycle((current) => !current)}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          >
            {t(showLifecycle
              ? 'agentTeams.communication.hideLifecycle'
              : 'agentTeams.communication.showLifecycle', { count: lifecycleCount })}
          </button>
        ) : null}
        {snapshot.deletedAt ? (
          <span className="ml-auto shrink-0 text-[10px] font-semibold text-[var(--color-success)]">
            {t('agentTeams.disbanded')}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {visibleRows.length === 0 ? (
          <div className="px-1 py-6 text-center text-[11px] text-[var(--color-text-tertiary)]">
            {t('agentTeams.communication.empty')}
          </div>
        ) : visibleRows.map(({ message, body }, index) => (
          <FeedRow
            key={message.id}
            message={message}
            body={body}
            isLatest={index === 0}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

function FeedRow({
  message,
  body,
  isLatest,
  t,
}: {
  message: TeamWorkbenchMessage
  body: WorkbenchMessageBody
  isLatest: boolean
  t: TranslationFn
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = kindIcon(message.kind)
  const color = kindColor(message.kind)
  const time = formatWorkbenchMessageTime(message.timestamp)
  const text = body.kind === 'lifecycle'
    ? lifecycleNarration(body, message, t)
    : body.text
  const isTruncatable = body.kind === 'text' && text.length > COLLAPSED_BODY_CHARS
  const shownText = isTruncatable && !expanded
    ? `${text.slice(0, COLLAPSED_BODY_CHARS)}…`
    : text

  return (
    <article
      data-testid={`agent-teams-message-${message.id}`}
      data-message-body={body.kind}
      className={[
        'mb-0.5 rounded-[var(--radius-md)] px-2 py-1.5',
        isLatest ? 'bg-[var(--color-brand-soft)]' : '',
        body.kind === 'lifecycle' ? 'opacity-70' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon size={11} strokeWidth={2.4} style={{ color }} aria-hidden="true" className="shrink-0" />
        <span className="shrink-0 text-[9px] font-extrabold" style={{ color }}>
          {kindLabel(message.kind, t)}
        </span>
        {message.kind !== 'system' ? (
          <span className="min-w-0 truncate font-mono text-[10px] font-bold text-[var(--color-text-secondary)]">
            {message.from} → {message.kind === 'broadcast'
              ? t('agentTeams.communication.everyone')
              : message.to}
          </span>
        ) : null}
        {message.taskId ? (
          <span className="shrink-0 font-mono text-[9px] text-[var(--color-text-tertiary)]">
            #{message.taskId}
          </span>
        ) : null}
        {isLatest ? (
          <Radio size={9} strokeWidth={2.6} aria-hidden="true" className="shrink-0 text-[var(--color-brand)]" />
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-[var(--color-text-tertiary)]">
          {time}
        </span>
      </div>
      <div
        className={[
          'mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-[1.55]',
          body.kind === 'lifecycle'
            ? 'text-[var(--color-text-tertiary)]'
            : 'text-[var(--color-text-secondary)]',
        ].join(' ')}
      >
        {shownText}
      </div>
      {isTruncatable ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-0.5 rounded-[var(--radius-sm)] text-[10px] font-semibold text-[var(--color-brand)] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          {t(expanded ? 'agentTeams.communication.collapse' : 'agentTeams.communication.expand')}
        </button>
      ) : null}
    </article>
  )
}
