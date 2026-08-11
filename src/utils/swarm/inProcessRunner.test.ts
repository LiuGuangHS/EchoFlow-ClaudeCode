import { describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetStateForTests, setIsInteractive } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  InProcessTeammateTaskState,
  TeammateIdentity,
} from '../../tasks/InProcessTeammateTask/types.js'
import type {
  CustomAgentDefinition,
  PluginAgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import * as runAgentModule from '../../tools/AgentTool/runAgent.js'
import { drainSdkEvents } from '../sdkEventQueue.js'
import { createTask, listTasks } from '../tasks.js'
import { createTeammateContext } from '../teammateContext.js'
import {
  buildInProcessTeammateAgentDefinition,
  claimNextInProcessTask,
  composeInitialTeammatePrompt,
  runInProcessTeammate,
  withInProcessTeammateActivity,
} from './inProcessRunner.js'
import * as teamHelpers from './teamHelpers.js'
import {
  readTeamFile,
  type TeamFile,
  writeTeamFileAsync,
} from './teamHelpers.js'

async function withTempConfig(
  run: (configDir: string) => Promise<void>,
): Promise<void> {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const configDir = await mkdtemp(join(tmpdir(), 'cc-haha-in-process-runner-'))
  process.env.CLAUDE_CONFIG_DIR = configDir

  try {
    await run(configDir)
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    await rm(configDir, { recursive: true, force: true })
  }
}

function createMember(
  name: string,
  teamName: string,
  isActive = false,
): TeamFile['members'][number] {
  return {
    agentId: `${name}@${teamName}`,
    name,
    joinedAt: Date.now(),
    tmuxPaneId: '',
    cwd: process.cwd(),
    subscriptions: [],
    backendType: 'in-process',
    isActive,
  }
}

describe('buildInProcessTeammateAgentDefinition', () => {
  test('preserves model and effort from the selected custom agent', () => {
    const selectedAgent: CustomAgentDefinition = {
      agentType: 'deep-reviewer',
      whenToUse: 'Review deeply',
      rawSystemPrompt: 'Review carefully',
      getSystemPrompt: () => 'Review carefully',
      source: 'projectSettings',
      tools: ['Read'],
      model: 'opus',
      effort: 'xhigh',
    }

    const resolved = buildInProcessTeammateAgentDefinition(
      'reviewer-1',
      'Team prompt',
      selectedAgent,
    )

    expect(resolved.model).toBe('opus')
    expect(resolved.effort).toBe('xhigh')
    expect(resolved.tools).toContain('Read')
    expect(resolved.tools).toContain('SendMessage')
    expect(resolved.rawSystemPrompt).toBe('Team prompt')
    expect(resolved.getSystemPrompt()).toBe('Team prompt')
  })

  test('inherits session effort when no custom agent effort is present', () => {
    const resolved = buildInProcessTeammateAgentDefinition(
      'generalist',
      'Team prompt',
    )

    expect(resolved.effort).toBeUndefined()
    expect(resolved.tools).toEqual(['*'])
  })

  test('preserves tools, model, and effort from a selected plugin Agent', () => {
    const selectedAgent: PluginAgentDefinition = {
      agentType: 'plugin-reviewer',
      whenToUse: 'Review with the plugin',
      getSystemPrompt: () => 'Apply the plugin review policy.',
      source: 'plugin',
      plugin: 'review-suite',
      tools: ['Read'],
      model: 'haiku',
      effort: 'low',
    }

    const resolved = buildInProcessTeammateAgentDefinition(
      'reviewer-2',
      selectedAgent.getSystemPrompt(),
      selectedAgent,
    )

    expect(resolved.model).toBe('haiku')
    expect(resolved.effort).toBe('low')
    expect(resolved.tools).toContain('Read')
    expect(resolved.tools).toContain('SendMessage')
    expect(resolved.rawSystemPrompt).toBe('Apply the plugin review policy.')
  })
})

describe('in-process teammate task claiming', () => {
  test('claims from the team list instead of the parent session list', async () => {
    await withTempConfig(async () => {
      const teamName = 'Release_Audit'
      const taskListId = 'release-audit'
      const parentSessionId = 'leader-session'
      const agentName = 'workflow-analyzer'

      await createTask(taskListId, {
        subject: 'Audit workflow',
        description: 'Audit workflow changes',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      })
      await createTask(parentSessionId, {
        subject: 'Unrelated session task',
        description: 'Must not be claimed by a teammate',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      })

      const prompt = await claimNextInProcessTask({ agentName, teamName })

      expect(prompt).toContain('Audit workflow')
      const claimedTasks = await listTasks(taskListId)
      expect(claimedTasks[0]?.owner).toBe(agentName)
      expect(claimedTasks.every(task => task.status === 'in_progress')).toBe(
        true,
      )

      const unrelatedTasks = await listTasks(parentSessionId)
      expect(unrelatedTasks).toHaveLength(1)
      expect(unrelatedTasks[0]?.owner).toBeUndefined()
      expect(unrelatedTasks[0]?.status).toBe('pending')

      expect(await claimNextInProcessTask({ agentName, teamName })).toBeUndefined()
    })
  })

  test('lets concurrent members fall through to distinct available tasks', async () => {
    await withTempConfig(async () => {
      const teamName = 'parallel-audit'
      const agentNames = ['workflow-analyzer', 'desktop-analyzer', 'provider-analyzer']
      for (const subject of ['Audit workflow', 'Audit desktop', 'Audit providers']) {
        await createTask(teamName, {
          subject,
          description: subject,
          status: 'pending',
          blocks: [],
          blockedBy: [],
        })
      }

      const prompts = await Promise.all(agentNames.map(agentName =>
        claimNextInProcessTask({ agentName, teamName }),
      ))

      expect(prompts.every(Boolean)).toBe(true)
      const claimedTasks = await listTasks(teamName)
      expect(claimedTasks.map(task => task.owner).sort()).toEqual([...agentNames].sort())
      expect(claimedTasks.every(task => task.status === 'in_progress')).toBe(true)
    })
  })

  test('honors the explicit task list override used by the leader', async () => {
    await withTempConfig(async () => {
      const previousTaskListId = process.env.CLAUDE_CODE_TASK_LIST_ID
      process.env.CLAUDE_CODE_TASK_LIST_ID = 'explicit-team-list'
      try {
        await createTask('explicit-team-list', {
          subject: 'Audit explicit list',
          description: 'Use the configured list',
          status: 'pending',
          blocks: [],
          blockedBy: [],
        })

        expect(await claimNextInProcessTask({
          agentName: 'auditor',
          teamName: 'Ignored_Team_Name',
        })).toContain('Audit explicit list')
        expect((await listTasks('explicit-team-list'))[0]?.owner).toBe('auditor')
      } finally {
        if (previousTaskListId === undefined) {
          delete process.env.CLAUDE_CODE_TASK_LIST_ID
        } else {
          process.env.CLAUDE_CODE_TASK_LIST_ID = previousTaskListId
        }
      }
    })
  })

  test('delivers the claimed task instructions in the first teammate turn', () => {
    expect(composeInitialTeammatePrompt(
      '<teammate-message>Review the release</teammate-message>',
      'Complete task #2: Audit desktop changes',
    )).toContain('Complete task #2: Audit desktop changes')
    expect(composeInitialTeammatePrompt('Review the release', undefined)).toBe('Review the release')
  })
})

describe('in-process teammate activity synchronization', () => {
  test('synchronizes active and idle turn transitions to the team roster', async () => {
    await withTempConfig(async () => {
      const teamName = 'activity-team'
      const member = createMember('worker', teamName)
      await writeTeamFileAsync(teamName, {
        name: teamName,
        createdAt: Date.now(),
        leadAgentId: `team-lead@${teamName}`,
        members: [member],
      })

      await expect(withInProcessTeammateActivity(
        { agentName: member.name, teamName },
        async () => {
          expect(readTeamFile(teamName)?.members[0]?.isActive).toBe(true)
          throw new Error('turn failed')
        },
      )).rejects.toThrow('turn failed')
      expect(readTeamFile(teamName)?.members[0]?.isActive).toBe(false)
    })
  })

  test('keeps the turn running when roster activity persistence fails', async () => {
    const setMemberActive = spyOn(
      teamHelpers,
      'setMemberActive',
    ).mockImplementation(async () => {
      throw new Error('roster unavailable')
    })

    try {
      await expect(withInProcessTeammateActivity(
        { agentName: 'worker', teamName: 'activity-team' },
        async () => 'turn completed',
      )).resolves.toBe('turn completed')
      expect(setMemberActive).toHaveBeenCalledTimes(2)
    } finally {
      setMemberActive.mockRestore()
    }
  })

  test('delivers the claimed task during the first active turn and scopes its terminal event', async () => {
    await withTempConfig(async () => {
      resetStateForTests()
      setIsInteractive(false)
      drainSdkEvents()

      const teamName = 'first-turn-team'
      const agentName = 'worker'
      const taskId = 'in-process-worker'
      const abortController = new AbortController()
      const identity: TeammateIdentity = {
        agentId: `${agentName}@${teamName}`,
        agentName,
        teamName,
        planModeRequired: false,
        parentSessionId: 'leader-session',
      }
      const member = createMember(agentName, teamName)
      await writeTeamFileAsync(teamName, {
        name: teamName,
        createdAt: Date.now(),
        leadAgentId: `team-lead@${teamName}`,
        members: [member],
      })
      await createTask(teamName, {
        subject: 'Audit first-turn delivery',
        description: 'Verify the claimed task reaches runAgent',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      })

      const teammateTask: InProcessTeammateTaskState = {
        id: taskId,
        type: 'in_process_teammate',
        status: 'running',
        description: 'First-turn worker',
        toolUseId: 'team-member-tool',
        startTime: Date.now(),
        outputFile: '/tmp/in-process-worker.output',
        outputOffset: 0,
        notified: false,
        identity,
        prompt: 'Review the release',
        abortController,
        awaitingPlanApproval: false,
        permissionMode: 'default',
        isIdle: false,
        shutdownRequested: false,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
        pendingUserMessages: [],
        messages: [],
      }
      let state = {
        tasks: { [taskId]: teammateTask },
      } as unknown as AppState
      const setAppState = (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      }
      const toolUseContext = {
        options: {
          tools: [],
          mainLoopModel: 'test-model',
        },
        getAppState: () => state,
        setAppState,
      } as unknown as ToolUseContext

      let firstPrompt = ''
      const runAgent = spyOn(runAgentModule, 'runAgent').mockImplementation(
        async function* (input: Parameters<typeof runAgentModule.runAgent>[0]) {
          firstPrompt = JSON.stringify(input.promptMessages[0])
          expect(readTeamFile(teamName)?.members[0]?.isActive).toBe(true)
          abortController.abort()
        },
      )

      try {
        const result = await runInProcessTeammate({
          identity,
          taskId,
          prompt: teammateTask.prompt,
          teammateContext: createTeammateContext({
            ...identity,
            abortController,
          }),
          toolUseContext,
          abortController,
          systemPrompt: 'Test teammate prompt',
          systemPromptMode: 'replace',
        })

        expect(result.success).toBe(true)
        expect(firstPrompt).toContain('Review the release')
        expect(firstPrompt).toContain('Audit first-turn delivery')
        expect(readTeamFile(teamName)?.members[0]?.isActive).toBe(false)
        expect((await listTasks(teamName))[0]).toMatchObject({
          owner: agentName,
          status: 'in_progress',
        })
        expect(drainSdkEvents()).toContainEqual(expect.objectContaining({
          subtype: 'task_notification',
          task_id: taskId,
          status: 'completed',
          owner_agent_id: identity.agentId,
        }))
      } finally {
        runAgent.mockRestore()
        drainSdkEvents()
        resetStateForTests()
      }
    })
  })
})
