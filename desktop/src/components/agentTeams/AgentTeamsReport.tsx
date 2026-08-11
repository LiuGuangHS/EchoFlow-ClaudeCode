import { ArrowUpRight, X } from 'lucide-react'
import { Badge, StatusDot, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Progress } from '@/components/ui/Progress'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamMember, TeamWorkbenchTask } from '../../types/team'
import { MEMBER_AVATARS } from './agentTeamsAvatars'
import {
  getMemberAvatarKey,
  getWorkbenchPhase,
  getWorkbenchProgress,
  getWorkbenchTaskState,
  parseWorkbenchMessageBody,
  taskOwnedByMember,
  type WorkbenchPhase,
  type WorkbenchTaskState,
} from './agentTeamsModel'

type TranslationFn = ReturnType<typeof useTranslation>

function phaseTone(phase: WorkbenchPhase): Tone {
  if (phase === 'forming') return 'warning'
  if (phase === 'running') return 'brand'
  if (phase === 'finishing') return 'info'
  return 'success'
}

function taskStateTone(state: WorkbenchTaskState): Tone {
  if (state === 'completed') return 'success'
  if (state === 'running') return 'brand'
  if (state === 'blocked') return 'neutral'
  return 'info'
}

function memberStatusTone(status: TeamMember['status']): Tone {
  if (status === 'error') return 'danger'
  if (status === 'running') return 'brand'
  if (status === 'completed') return 'success'
  return 'neutral'
}

/**
 * The reading view of a team run: who is on it, what they were given, and
 * where it landed. The map, the per-member drill-down and the message log all
 * live in the detached workbench — at panel width they crowd out the summary
 * that answers "did this work?", which is the only question this side of the
 * split is asked.
 */
export function AgentTeamsReport({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const timeline = useTeamStore((state) => state.workbenchesBySession[sessionId])
  const setWorkbenchOpen = useTeamStore((state) => state.setWorkbenchOpen)

  const snapshots = timeline?.snapshots ?? []
  const snapshot = snapshots.at(-1)

  if (!snapshot) {
    return (
      <section
        aria-label={t('agentTeams.report.title')}
        className="flex h-full min-h-0 items-center justify-center bg-[var(--color-surface)] p-8 text-sm text-[var(--color-text-tertiary)]"
      >
        {timeline?.error || t('agentTeams.loading')}
      </section>
    )
  }

  const phase = getWorkbenchPhase(snapshot)
  const progress = getWorkbenchProgress(snapshot)
  const leadId = snapshot.team.leadAgentId
  const members = snapshot.team.members
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const conversationCount = snapshot.messages.filter(
    (message) => parseWorkbenchMessageBody(message).kind === 'text',
  ).length

  const openWorkbench = () => {
    useTabStore.getState().openTeamWorkbenchTab(sessionId, snapshot.team.name)
    setWorkbenchOpen(sessionId, false)
  }

  return (
    <section
      aria-label={t('agentTeams.report.title')}
      data-testid="agent-teams-report"
      className="flex h-full min-h-0 w-full flex-col bg-[var(--color-surface)] text-[var(--color-text-primary)]"
    >
      <header className="flex h-[42px] shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] font-extrabold"
          title={snapshot.team.name}
        >
          {snapshot.team.name}
        </span>
        <Badge tone={phaseTone(phase)} size="xs" bordered>
          {t(`agentTeams.phase.${phase}` as TranslationKey)}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowUpRight size={13} strokeWidth={2.2} aria-hidden="true" />}
          onClick={openWorkbench}
        >
          {t('agentTeams.report.openWorkbench')}
        </Button>
        <IconButton
          icon={<X aria-hidden="true" />}
          label={t('agentTeams.closeReport')}
          size="sm"
          tone="muted"
          onClick={() => setWorkbenchOpen(sessionId, false)}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        <div data-testid="agent-teams-report-progress">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-extrabold leading-none tabular-nums">
              {progress.completed}
              <span className="text-[var(--color-text-tertiary)]">/{progress.total}</span>
            </span>
            <span className="text-[11.5px] text-[var(--color-text-secondary)]">
              {t('agentTeams.report.tasksDone')}
            </span>
          </div>
          <Progress
            value={progress.percent}
            tone="auto"
            size="sm"
            label={t('agentTeams.progressLabel')}
            className="mt-2"
          />
        </div>

        <ReportSection title={t('agentTeams.report.members', { count: members.length })}>
          <ul className="flex flex-col gap-0.5">
            {members.map((member) => (
              <MemberRow
                key={member.agentId}
                member={member}
                isLead={member.agentId === leadId}
                tasks={snapshot.tasks}
                t={t}
              />
            ))}
          </ul>
        </ReportSection>

        <ReportSection title={t('agentTeams.report.tasks', { count: snapshot.tasks.length })}>
          {snapshot.tasks.length === 0 ? (
            <p className="px-1 py-3 text-[11.5px] text-[var(--color-text-tertiary)]">
              {t('agentTeams.emptyTasks')}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {snapshot.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  state={getWorkbenchTaskState(task, tasksById)}
                  t={t}
                />
              ))}
            </ul>
          )}
        </ReportSection>

        <button
          type="button"
          data-testid="agent-teams-report-communication"
          onClick={openWorkbench}
          className="mt-4 flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-1.5 text-left text-[11.5px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <span>{t('agentTeams.report.messages', { count: conversationCount })}</span>
          <ArrowUpRight size={12} strokeWidth={2.2} aria-hidden="true" className="text-[var(--color-brand)]" />
        </button>

        {snapshot.deletedAt ? (
          <p
            data-testid="agent-teams-report-disbanded"
            className="mt-1 flex items-center gap-1.5 px-1 text-[11.5px] font-semibold text-[var(--color-success)]"
          >
            <StatusDot tone="success" />
            {t('agentTeams.report.disbanded')}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-1.5 px-1 text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
        {title}
      </h3>
      {children}
    </div>
  )
}

function MemberRow({
  member,
  isLead,
  tasks,
  t,
}: {
  member: TeamMember
  isLead: boolean
  tasks: TeamWorkbenchTask[]
  t: TranslationFn
}) {
  const ownedCount = tasks.filter((task) => taskOwnedByMember(task, member)).length
  const label = member.name || member.agentId

  return (
    <li className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1">
      <img
        src={MEMBER_AVATARS[getMemberAvatarKey(member, isLead)]}
        alt=""
        draggable={false}
        className="size-[22px] shrink-0 select-none object-contain"
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-bold" title={label}>
        {label}
      </span>
      {isLead ? (
        <Badge tone="brand" size="xs">{t('agentTeams.leader')}</Badge>
      ) : null}
      <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-[var(--color-text-tertiary)]">
        <StatusDot tone={memberStatusTone(member.status)} pulse={member.status === 'running'} />
        {t(`agentTeams.report.memberStatus.${member.status}` as TranslationKey)}
      </span>
      {ownedCount > 0 ? (
        <span className="shrink-0 tabular-nums text-[10.5px] text-[var(--color-text-tertiary)]">
          {t('agentTeams.report.ownedTasks', { count: ownedCount })}
        </span>
      ) : null}
    </li>
  )
}

function TaskRow({
  task,
  state,
  t,
}: {
  task: TeamWorkbenchTask
  state: WorkbenchTaskState
  t: TranslationFn
}) {
  return (
    <li
      data-testid={`agent-teams-report-task-${task.id}`}
      className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1"
    >
      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[var(--color-text-tertiary)]">
        #{task.id}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px]" title={task.subject}>
        {task.subject}
      </span>
      {task.owner ? (
        <span className="min-w-0 max-w-[96px] shrink-0 truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">
          {task.owner}
        </span>
      ) : null}
      <Badge tone={taskStateTone(state)} size="xs">
        {t(`agentTeams.task.${state}` as TranslationKey)}
      </Badge>
    </li>
  )
}
