import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Badge, StatusDot } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { MessageList } from '../chat/MessageList'
import { useTranslation, type TranslationKey } from '../../i18n'
import { memberSessionId } from '../../stores/teamStore'
import type { TeamMember, TeamWorkbenchSnapshot } from '../../types/team'
import { MEMBER_AVATARS, memberAccentColor } from './agentTeamsAvatars'
import {
  getMemberAvatarKey,
  runningTaskForMember,
  taskOwnedByMember,
} from './agentTeamsModel'

function memberName(member: TeamMember): string {
  return member.name || member.role || member.agentId.split('@')[0] || member.agentId
}

function memberStatusTone(member: TeamMember) {
  if (member.status === 'error') return 'danger' as const
  if (member.status === 'running') return 'brand' as const
  if (member.status === 'completed') return 'success' as const
  return 'neutral' as const
}

/**
 * A teammate's run rendered with the same transcript machinery as the main
 * session — thinking blocks, grouped tool calls, streaming indicator — instead
 * of the summary-only drawer that used to cover the team map.
 */
export function AgentTeamsMemberView({
  member,
  snapshot,
  onBack,
  onOpenInTab,
}: {
  member: TeamMember
  snapshot: TeamWorkbenchSnapshot
  onBack: () => void
  onOpenInTab: () => void
}) {
  const t = useTranslation()
  const isLead = member.agentId === snapshot.team.leadAgentId
  const name = memberName(member)
  const avatarKey = getMemberAvatarKey(member, isLead)
  const accent = memberAccentColor(member.color, snapshot.team.members.indexOf(member))
  const ownedTasks = snapshot.tasks.filter((task) => taskOwnedByMember(task, member))
  const currentTask = runningTaskForMember(snapshot.tasks, member)
  const statusLabel = t(`agentTeams.member.${
    snapshot.deletedAt || member.status === 'completed'
      ? 'exited'
      : member.status === 'error'
        ? 'error'
        : member.status === 'running'
          ? 'working'
          : 'idle'
  }` as TranslationKey)

  return (
    <div
      data-testid="agent-teams-member-view"
      data-member-agent-id={member.agentId}
      className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]"
    >
      <header className="shrink-0 border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <IconButton
            icon={<ArrowLeft aria-hidden="true" />}
            label={t('agentTeams.backToOverview')}
            size="sm"
            tone="muted"
            onClick={onBack}
          />
          <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
            <img
              src={MEMBER_AVATARS[avatarKey]}
              alt=""
              draggable={false}
              className="h-8 w-8 select-none object-contain"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full"
              style={{ background: accent }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-[13px] font-extrabold">{name}</span>
              {isLead ? <Badge tone="brand" size="xs" bordered>{t('agentTeams.leader')}</Badge> : null}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <StatusDot tone={memberStatusTone(member)} pulse={member.status === 'running'} />
              <span className="shrink-0">{statusLabel}</span>
              <span aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]">·</span>
              <span className="min-w-0 truncate text-[var(--color-text-tertiary)]">{member.role}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={onOpenInTab}
            icon={<ExternalLink size={13} aria-hidden="true" />}
          >
            {t('agentTeams.openInTab')}
          </Button>
        </div>

        {currentTask || member.currentTask ? (
          <p
            data-testid="agent-teams-member-current-task"
            className="mt-2 truncate rounded-[var(--radius-sm)] bg-[var(--color-surface-container)] px-2.5 py-1.5 font-mono text-[10.5px] text-[var(--color-text-secondary)]"
            title={currentTask?.activeForm || currentTask?.subject || member.currentTask}
          >
            {currentTask?.activeForm || currentTask?.subject || member.currentTask}
          </p>
        ) : null}

        {ownedTasks.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {ownedTasks.map((task) => (
              <span
                key={task.id}
                title={task.subject}
                className={[
                  'inline-flex max-w-[190px] items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px]',
                  task.status === 'completed'
                    ? 'border-[var(--color-success)] text-[var(--color-success)]'
                    : task.status === 'in_progress'
                      ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-tertiary)]',
                ].join(' ')}
              >
                <span className="shrink-0 font-mono font-bold">#{task.id}</span>
                <span className="min-w-0 truncate">{task.subject}</span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <MessageList sessionId={memberSessionId(member.agentId)} compact />
    </div>
  )
}
