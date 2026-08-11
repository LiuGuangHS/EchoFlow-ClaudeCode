import { describe, expect, it } from 'vitest'
import type { TeamMember, TeamWorkbenchSnapshot, TeamWorkbenchTask } from '../../types/team'
import {
  formatWorkbenchMessageTime,
  getWorkbenchPhase,
  getWorkbenchProgress,
  getWorkbenchTaskState,
  getMemberAvatarKey,
  layoutWorkbenchTasks,
  parseWorkbenchMessageBody,
  runningTaskForMember,
  taskOwnedByMember,
  WORKBENCH_TASK_WIDTH,
} from './agentTeamsModel'

function task(
  id: string,
  status: TeamWorkbenchTask['status'],
  blockedBy: string[] = [],
  owner?: string,
): TeamWorkbenchTask {
  return {
    id,
    subject: `Task ${id}`,
    description: `Description ${id}`,
    status,
    owner,
    blocks: [],
    blockedBy,
    taskListId: 'team-a',
  }
}

function snapshot(tasks: TeamWorkbenchTask[]): TeamWorkbenchSnapshot {
  return {
    version: 'v1',
    generatedAt: '2026-08-08T00:00:00.000Z',
    team: {
      name: 'team-a',
      leadAgentId: 'lead@team-a',
      leadSessionId: 'session-a',
      members: [],
    },
    tasks,
    messages: [],
  }
}

describe('Agent Teams workbench model', () => {
  it('lays out a multi-parent DAG after every dependency and keeps edge states honest', () => {
    const tasks = [
      task('1', 'completed'),
      task('2', 'in_progress'),
      task('3', 'pending', ['1', '2']),
      task('4', 'pending', ['missing']),
    ]
    const layout = layoutWorkbenchTasks(tasks, 604)
    const byId = new Map(tasks.map((entry) => [entry.id, entry]))

    expect(layout.columns).toBe(2)
    expect(layout.tasks.every((entry) => entry.x >= 0 && entry.x + WORKBENCH_TASK_WIDTH <= layout.width)).toBe(true)
    expect(layout.byId.get('3')!.y).toBeGreaterThan(layout.byId.get('1')!.y)
    expect(layout.byId.get('3')!.y).toBeGreaterThan(layout.byId.get('2')!.y)
    expect(getWorkbenchTaskState(tasks[2]!, byId)).toBe('blocked')
    expect(getWorkbenchTaskState(tasks[3]!, byId)).toBe('blocked')

    tasks[1] = task('2', 'completed')
    const completedParents = new Map(tasks.map((entry) => [entry.id, entry]))
    expect(getWorkbenchTaskState(tasks[2]!, completedParents)).toBe('open')
  })

  it('falls back deterministically for cyclic dependencies instead of recursing forever', () => {
    const tasks = [
      task('a', 'pending', ['b']),
      task('b', 'pending', ['a']),
    ]

    const layout = layoutWorkbenchTasks(tasks, 440)

    expect(layout.tasks.map((entry) => entry.task.id).sort()).toEqual(['a', 'b'])
    expect(layout.columns).toBe(1)
    expect(layout.tasks.every((entry) => entry.x >= 0 && entry.x + WORKBENCH_TASK_WIDTH <= layout.width)).toBe(true)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('uses a three-column organization tree only when complete person nodes fit', () => {
    const tasks = [task('1', 'pending'), task('2', 'pending'), task('3', 'pending')]

    const layout = layoutWorkbenchTasks(tasks, 760)

    expect(layout.columns).toBe(3)
    expect(layout.tasks.every((entry) => entry.x >= 0 && entry.x + WORKBENCH_TASK_WIDTH <= layout.width)).toBe(true)
  })

  it('normalizes bare owner names and full agent ids for active work', () => {
    const member: TeamMember = {
      agentId: 'reviewer@team-a',
      name: 'reviewer',
      role: 'security-reviewer',
      status: 'running',
    }
    const bareOwner = task('1', 'in_progress', [], 'reviewer')
    const fullOwner = task('2', 'pending', [], 'reviewer@team-a')

    expect(taskOwnedByMember(bareOwner, member)).toBe(true)
    expect(taskOwnedByMember(fullOwner, member)).toBe(true)
    expect(runningTaskForMember([fullOwner, bareOwner], member)?.id).toBe('1')
  })

  it('assigns generated occupational characters and preserves unknown-member identity', () => {
    const member = (agentId: string, role: string): TeamMember => ({
      agentId,
      name: agentId.split('@')[0],
      role,
      status: 'running',
    })

    expect(getMemberAvatarKey(member('lead@team-a', 'orchestrator'), true)).toBe('team-lead')
    expect(getMemberAvatarKey(member('watcher-runtime@team-a', 'backend'))).toBe('server-engineer')
    expect(getMemberAvatarKey(member('desktop-workbench@team-a', 'frontend'))).toBe('ui-designer')
    expect(getMemberAvatarKey(member('test-engineer@team-a', 'quality'))).toBe('qa-engineer')
    expect(getMemberAvatarKey(member('security-reviewer@team-a', 'reviewer'))).toBe('security-reviewer')
    expect(getMemberAvatarKey(member('release-auditor@team-a', 'release'))).toBe('release-engineer')
    expect(getMemberAvatarKey(member('unknown-specialist@team-a', 'general-purpose')))
      .toBe(getMemberAvatarKey(member('unknown-specialist@team-a', 'general-purpose')))
  })

  it('derives forming, running, finishing, and completed phases from real transitions', () => {
    expect(getWorkbenchPhase(snapshot([]))).toBe('forming')
    expect(getWorkbenchPhase(snapshot([task('1', 'in_progress')]))).toBe('running')

    const finished = snapshot([task('1', 'completed'), task('2', 'completed')])
    expect(getWorkbenchPhase(finished)).toBe('finishing')
    expect(getWorkbenchProgress(finished)).toEqual({ completed: 2, total: 2, percent: 100 })

    expect(getWorkbenchPhase({
      ...finished,
      deletedAt: '2026-08-08T00:01:00.000Z',
    })).toBe('completed')
  })

  it('narrates protocol payloads instead of leaking their raw JSON into the feed', () => {
    // This exact shape was rendering verbatim in the communication feed.
    const idle = parseWorkbenchMessageBody({
      text: '{"type":"idle_notification","from":"release-engineer","timestamp":"2026-08-08T07:42:16.666Z","idleReason":"available"}',
    })
    expect(idle).toEqual({ kind: 'lifecycle', type: 'idle_notification', detail: 'available' })

    // protocolType wins over the body, and is enough on its own.
    expect(parseWorkbenchMessageBody({ text: 'shutting down', protocolType: 'shutdown_request' }))
      .toEqual({ kind: 'lifecycle', type: 'shutdown_request', detail: undefined })

    // Authored prose is never reclassified.
    expect(parseWorkbenchMessageBody({ text: 'Race condition confirmed in queue.ts' }))
      .toEqual({ kind: 'text', text: 'Race condition confirmed in queue.ts' })
  })

  it('surfaces readable fields from unrecognised JSON rather than printing braces', () => {
    expect(parseWorkbenchMessageBody({ text: '{"type":"custom_event","message":"handoff ready"}' }))
      .toEqual({ kind: 'text', text: 'handoff ready' })

    // Nothing prose-like inside: keep the payload rather than silently dropping it.
    const opaque = '{"type":"custom_event","count":3}'
    expect(parseWorkbenchMessageBody({ text: opaque })).toEqual({ kind: 'text', text: opaque })

    // Malformed JSON must not throw or be mistaken for a protocol signal.
    expect(parseWorkbenchMessageBody({ text: '{not json' })).toEqual({ kind: 'text', text: '{not json' })
  })

  it('stamps messages with their own send time, not a shared snapshot index', () => {
    const first = formatWorkbenchMessageTime('2026-08-08T07:42:16.666Z')
    const second = formatWorkbenchMessageTime('2026-08-08T09:15:00.000Z')
    expect(first).toBeTruthy()
    // Two messages inside one snapshot used to render an identical `T+0`.
    expect(first).not.toBe(second)
    expect(formatWorkbenchMessageTime('not-a-date')).toBe('')
  })
})
