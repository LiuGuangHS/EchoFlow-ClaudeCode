import { useMemo, useState } from 'react'
import { ArrowRight, Clock3, Megaphone, MessageSquare, Settings2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { useTranslation, type TranslationKey } from '../../i18n'
import type { TeamMember, TeamWorkbenchMessage, TeamWorkbenchSnapshot } from '../../types/team'
import { MEMBER_AVATARS, memberAccentColor } from './agentTeamsAvatars'
import {
  formatWorkbenchMessageTime,
  getMemberAvatarKey,
  parseWorkbenchMessageBody,
  resolveTeamMemberIdentity,
  type MemberAvatarKey,
  type WorkbenchMessageBody,
} from './agentTeamsModel'

type TranslationFn = ReturnType<typeof useTranslation>
type FeedFilter = 'all' | TeamWorkbenchMessage['kind']
type TimeFilter = 'all' | 'early' | 'middle' | 'late'

/** Beyond this the body collapses behind a "show more" toggle. */
const COLLAPSED_BODY_CHARS = 260

type ParsedMessageRow = {
  message: TeamWorkbenchMessage
  body: WorkbenchMessageBody
}

type TimeRange = {
  start: number
  end: number
}

function timestampMs(value: string | undefined): number | null {
  if (!value) return null
  const numeric = /^\d+$/.test(value) ? Number(value) : Number.NaN
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getTaskTimeRange(
  snapshot: TeamWorkbenchSnapshot,
  rows: ParsedMessageRow[],
): TimeRange | null {
  const messageTimes = rows
    .map(({ message }) => timestampMs(message.timestamp))
    .filter((time): time is number => time !== null)
  if (messageTimes.length < 2) return null

  const starts = [timestampMs(snapshot.team.createdAt), ...messageTimes]
    .filter((time): time is number => time !== null)
  const ends = [timestampMs(snapshot.deletedAt), timestampMs(snapshot.generatedAt), ...messageTimes]
    .filter((time): time is number => time !== null)
  const start = Math.min(...starts)
  const end = Math.max(...ends)
  return end > start ? { start, end } : null
}

function timePhase(timestamp: string, range: TimeRange): Exclude<TimeFilter, 'all'> | null {
  const time = timestampMs(timestamp)
  if (time === null) return null
  const progress = (time - range.start) / (range.end - range.start)
  if (progress < 1 / 3) return 'early'
  if (progress < 2 / 3) return 'middle'
  return 'late'
}

function formatTimePoint(value: number): string {
  return formatWorkbenchMessageTime(new Date(value).toISOString())
}

type MessageParticipant = {
  member: TeamMember
  avatarKey: MemberAvatarKey
  accent: string
}

function resolveParticipant(
  value: string,
  snapshot: TeamWorkbenchSnapshot,
  fallbackIndex: number,
): MessageParticipant {
  const { member, isLead } = resolveTeamMemberIdentity(snapshot.team, value)

  return {
    member,
    avatarKey: getMemberAvatarKey(member, isLead),
    accent: memberAccentColor(member.color, fallbackIndex),
  }
}

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
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  const rows = useMemo(() => snapshot.messages
    .map((message) => ({ message, body: parseWorkbenchMessageBody(message) }))
    .reverse(), [snapshot.messages])
  const lifecycleCount = rows.filter(({ body }) => body.kind === 'lifecycle').length
  const readableRows = showLifecycle ? rows : rows.filter(({ body }) => body.kind !== 'lifecycle')
  const timeRange = useMemo(
    () => getTaskTimeRange(snapshot, readableRows),
    [readableRows, snapshot],
  )
  const timeCounts = useMemo(() => ({
    early: timeRange
      ? readableRows.filter(({ message }) => timePhase(message.timestamp, timeRange) === 'early').length
      : 0,
    middle: timeRange
      ? readableRows.filter(({ message }) => timePhase(message.timestamp, timeRange) === 'middle').length
      : 0,
    late: timeRange
      ? readableRows.filter(({ message }) => timePhase(message.timestamp, timeRange) === 'late').length
      : 0,
  }), [readableRows, timeRange])
  const effectiveTimeFilter = timeRange ? timeFilter : 'all'
  const timeFilteredRows = effectiveTimeFilter === 'all'
    ? readableRows
    : readableRows.filter(({ message }) => timePhase(message.timestamp, timeRange!) === effectiveTimeFilter)
  const kindCounts = useMemo(() => ({
    direct: timeFilteredRows.filter(({ message }) => message.kind === 'direct').length,
    broadcast: timeFilteredRows.filter(({ message }) => message.kind === 'broadcast').length,
    system: timeFilteredRows.filter(({ message }) => message.kind === 'system').length,
  }), [timeFilteredRows])
  const filters: Array<{ key: FeedFilter; label: string; count: number }> = [
    { key: 'all', label: t('agentTeams.communication.all'), count: timeFilteredRows.length },
    { key: 'direct', label: kindLabel('direct', t), count: kindCounts.direct },
    { key: 'broadcast', label: kindLabel('broadcast', t), count: kindCounts.broadcast },
    { key: 'system', label: kindLabel('system', t), count: kindCounts.system },
  ]
  const visibleFilters = filters.filter(({ key, count }) => key === 'all' || count > 0)
  const visibleRows = filter === 'all'
    ? timeFilteredRows
    : timeFilteredRows.filter(({ message }) => message.kind === filter)
  const timeOptions: Array<{
    key: TimeFilter
    label: string
    count: number
  }> = [
    { key: 'all', label: t('agentTeams.communication.timeAll'), count: readableRows.length },
    { key: 'early', label: t('agentTeams.communication.timeEarly'), count: timeCounts.early },
    { key: 'middle', label: t('agentTeams.communication.timeMiddle'), count: timeCounts.middle },
    { key: 'late', label: t('agentTeams.communication.timeLate'), count: timeCounts.late },
  ]

  return (
    <section
      data-testid="agent-teams-communication"
      className={[
        'flex min-h-0 flex-col border-[var(--color-border)] bg-[var(--color-surface)]',
        fill
          ? 'h-full w-full min-w-0'
          : 'h-[240px] shrink-0 border-t',
      ].join(' ')}
    >
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-[12px] font-extrabold tracking-[-0.1px]">
            {t('agentTeams.communication.title')}
          </h3>
          <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
            {t('agentTeams.communication.count', { count: visibleRows.length })}
          </span>
          {snapshot.deletedAt ? (
            <span className="ml-auto truncate text-[10px] font-semibold text-[var(--color-success)]">
              {t('agentTeams.disbanded')}
            </span>
          ) : null}
        </div>

        <div
          role="group"
          aria-label={t('agentTeams.communication.title')}
          className="mt-2.5 flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {visibleFilters.map((option) => {
            const selected = filter === option.key
            return (
              <button
                key={option.key}
                type="button"
                data-testid={`agent-teams-filter-${option.key}`}
                aria-pressed={selected}
                onClick={() => setFilter(option.key)}
                className={[
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold outline-none transition-[transform,background-color,border-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] active:scale-[0.98]',
                  selected
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                    : 'border-transparent text-[var(--color-text-tertiary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {option.label}
                <span className="font-mono tabular-nums opacity-70">{option.count}</span>
              </button>
            )
          })}
          {lifecycleCount > 0 ? (
            <button
              type="button"
              data-testid="agent-teams-lifecycle-toggle"
              aria-pressed={showLifecycle}
              onClick={() => setShowLifecycle((current) => !current)}
              className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-tertiary)] outline-none transition-[transform,background-color,color] duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] active:scale-[0.98]"
            >
              {t(showLifecycle
                ? 'agentTeams.communication.hideLifecycle'
                : 'agentTeams.communication.showLifecycle', { count: lifecycleCount })}
            </button>
          ) : null}
        </div>

        {timeRange ? (
          <div className="mt-2.5 border-t border-[var(--color-border)] pt-2.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <Clock3 size={12} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="text-[9.5px] font-semibold text-[var(--color-text-secondary)]">
                {t('agentTeams.communication.timeline')}
              </span>
              <span
                data-testid="agent-teams-time-range"
                className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-[var(--color-text-tertiary)]"
              >
                {formatTimePoint(timeRange.start)}–{formatTimePoint(timeRange.end)}
              </span>
            </div>
            <div
              role="group"
              aria-label={t('agentTeams.communication.timeline')}
              className="mt-2 flex min-w-0 items-stretch gap-1.5"
            >
              <button
                type="button"
                data-testid="agent-teams-time-all"
                aria-pressed={timeFilter === 'all'}
                onClick={() => setTimeFilter('all')}
                className={[
                  'shrink-0 rounded-[var(--radius-sm)] border px-2 py-1 text-[9px] font-semibold outline-none transition-[transform,background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] active:scale-[0.98]',
                  timeFilter === 'all'
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]',
                ].join(' ')}
              >
                {timeOptions[0]!.label}
              </button>
              <div className="grid min-w-[210px] flex-1 grid-cols-3 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                {timeOptions.slice(1).map((option, index) => {
                  const selected = timeFilter === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      data-testid={`agent-teams-time-${option.key}`}
                      aria-pressed={selected}
                      onClick={() => setTimeFilter(option.key)}
                      className={[
                        'flex min-w-0 items-center justify-center gap-1 px-1.5 py-1 text-[9px] font-semibold outline-none transition-[transform,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-focus)] active:scale-[0.98]',
                        index > 0 ? 'border-l border-[var(--color-border)]' : '',
                        selected
                          ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className="truncate">{option.label}</span>
                      <span className="shrink-0 font-mono tabular-nums opacity-65">{option.count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center px-6 text-center text-[11px] leading-5 text-[var(--color-text-tertiary)]">
            {t('agentTeams.communication.empty')}
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {visibleRows.map(({ message, body }, index) => (
              <FeedRow
                key={message.id}
                message={message}
                body={body}
                isLatest={index === 0}
                snapshot={snapshot}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function FeedRow({
  message,
  body,
  isLatest,
  snapshot,
  t,
}: {
  message: TeamWorkbenchMessage
  body: WorkbenchMessageBody
  isLatest: boolean
  snapshot: TeamWorkbenchSnapshot
  t: TranslationFn
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = kindIcon(message.kind)
  const time = formatWorkbenchMessageTime(message.timestamp)
  const text = body.kind === 'lifecycle'
    ? lifecycleNarration(body, message, t)
    : body.text
  const isTruncatable = body.kind === 'text' && text.length > COLLAPSED_BODY_CHARS
  const collapsed = isTruncatable && !expanded
  const recipient = message.kind === 'broadcast'
    ? t('agentTeams.communication.everyone')
    : message.to
  const senderParticipant = message.kind === 'system'
    ? null
    : resolveParticipant(message.from, snapshot, 0)
  const recipientParticipant = message.kind === 'direct'
    ? resolveParticipant(message.to, snapshot, 1)
    : null

  return (
    <article
      data-testid={`agent-teams-message-${message.id}`}
      data-message-body={body.kind}
      data-message-kind={message.kind}
      className={[
        'relative px-4 py-3.5',
        body.kind === 'lifecycle' ? 'bg-[var(--color-surface-container-low)]' : '',
      ].filter(Boolean).join(' ')}
    >
      {isLatest ? (
        <span className="absolute bottom-3 left-0 top-3 w-0.5 rounded-r-full bg-[var(--color-brand)]" aria-hidden="true" />
      ) : null}

      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[var(--color-brand)]">
              <Icon size={12} strokeWidth={2} aria-hidden="true" />
              {kindLabel(message.kind, t)}
            </span>
            {message.taskId ? (
              <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-text-tertiary)]">
                #{message.taskId}
              </span>
            ) : null}
          </div>

          {message.kind !== 'system' ? (
            <div
              data-testid={`agent-teams-message-${message.id}-route`}
              className="mt-2 flex min-w-0 items-center gap-2"
            >
              <ParticipantFigure
                participant={senderParticipant!}
                name={message.from}
                nameTestId={`agent-teams-message-${message.id}-from`}
                avatarTestId={`agent-teams-message-${message.id}-from-avatar`}
              />
              <ArrowRight size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
              {recipientParticipant ? (
                <ParticipantFigure
                  participant={recipientParticipant}
                  name={recipient}
                  nameTestId={`agent-teams-message-${message.id}-to`}
                  avatarTestId={`agent-teams-message-${message.id}-to-avatar`}
                />
              ) : (
                <span
                  data-testid={`agent-teams-message-${message.id}-to`}
                  className="inline-flex min-w-0 flex-1 items-center gap-1.5"
                  title={recipient}
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-brand)]">
                    <Megaphone size={13} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 truncate font-mono text-[10px] font-semibold text-[var(--color-text-secondary)]">
                    {recipient}
                  </span>
                </span>
              )}
            </div>
          ) : null}
        </div>
        <time
          dateTime={message.timestamp}
          className="shrink-0 pt-0.5 font-mono text-[9px] tabular-nums text-[var(--color-text-tertiary)]"
        >
          {time}
        </time>
      </div>

      <div
        data-testid={`agent-teams-message-${message.id}-body`}
        data-collapsed={collapsed ? 'true' : 'false'}
        className={`relative mt-3 ${message.kind === 'direct' ? 'pl-10' : ''}`}
      >
        {body.kind === 'lifecycle' ? (
          <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">{text}</p>
        ) : (
          <div className={collapsed ? 'max-h-[148px] overflow-hidden' : ''}>
            <MarkdownRenderer
              content={text}
              variant="compact"
              className="prose-p:first:mt-0 prose-p:last:mb-0 prose-headings:first:mt-0 prose-headings:text-[var(--color-text-primary)] prose-code:text-[11px]"
            />
          </div>
        )}
        {collapsed ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[var(--color-surface)]"
          />
        ) : null}
      </div>

      {isTruncatable ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={`relative mt-2 rounded-[var(--radius-sm)] text-[10px] font-semibold text-[var(--color-brand)] outline-none transition-[transform,color] duration-200 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] active:scale-[0.98] ${message.kind === 'direct' ? 'ml-10' : ''}`}
        >
          {t(expanded ? 'agentTeams.communication.collapse' : 'agentTeams.communication.expand')}
        </button>
      ) : null}
    </article>
  )
}

function ParticipantFigure({
  participant,
  name,
  nameTestId,
  avatarTestId,
}: {
  participant: MessageParticipant
  name: string
  nameTestId: string
  avatarTestId: string
}) {
  return (
    <span className="inline-flex min-w-0 flex-1 items-center gap-1.5" title={name}>
      <span
        data-testid={avatarTestId}
        data-avatar-key={participant.avatarKey}
        aria-hidden="true"
        className="relative h-9 w-8 shrink-0"
      >
        <img
          src={MEMBER_AVATARS[participant.avatarKey]}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-contain drop-shadow-[0_2px_2px_rgba(0,0,0,0.14)]"
        />
        <span
          className="absolute bottom-0 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full border border-[var(--color-surface)]"
          style={{ background: participant.accent }}
        />
      </span>
      <span
        data-testid={nameTestId}
        className="min-w-0 truncate font-mono text-[10px] font-bold text-[var(--color-text-primary)]"
      >
        {name}
      </span>
    </span>
  )
}
