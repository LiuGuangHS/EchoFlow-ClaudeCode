import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  getSubagentRunByTool,
  mergeTeammateTranscriptFragments,
  resolveSubagentRunFromMessages,
  truncateSubagentMessages,
} from './subagentRunService.js'
import type { MessageEntry } from './sessionService.js'

let tmpDir: string | null = null

async function setupTmpConfigDir(): Promise<string> {
  tmpDir = path.join(os.tmpdir(), `subagent-run-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  return tmpDir
}

async function writeSessionFile(
  projectDir: string,
  sessionId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  if (!tmpDir) throw new Error('tmpDir not initialized')
  const dir = path.join(tmpDir, 'projects', projectDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, `${sessionId}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf-8',
  )
}

async function writeSubagentTranscriptFile(
  projectDir: string,
  sessionId: string,
  agentId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  if (!tmpDir) throw new Error('tmpDir not initialized')
  const dir = path.join(tmpDir, 'projects', projectDir, sessionId, 'subagents')
  await fs.mkdir(dir, { recursive: true })
  const normalizedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`
  await fs.writeFile(
    path.join(dir, `${normalizedAgentId}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf-8',
  )
}

async function writeSubagentMetadata(
  projectDir: string,
  sessionId: string,
  agentId: string,
  agentType: string,
  modifiedAt: number,
): Promise<void> {
  if (!tmpDir) throw new Error('tmpDir not initialized')
  const dir = path.join(tmpDir, 'projects', projectDir, sessionId, 'subagents')
  const normalizedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`
  const transcriptPath = path.join(dir, `${normalizedAgentId}.jsonl`)
  await fs.writeFile(
    path.join(dir, `${normalizedAgentId}.meta.json`),
    JSON.stringify({ agentType }),
    'utf-8',
  )
  const modifiedDate = new Date(modifiedAt)
  await fs.utimes(transcriptPath, modifiedDate, modifiedDate)
}

/**
 * The sidecar the CLI writes before an agent's query loop starts. Unlike
 * {@link writeSubagentMetadata} it carries the spawning tool_use id, which is
 * what lets a live run be resolved before any result exists.
 */
async function writeSubagentLaunchMetadata(
  projectDir: string,
  sessionId: string,
  agentId: string,
  metadata: { agentType: string; toolUseId?: string; description?: string },
): Promise<void> {
  if (!tmpDir) throw new Error('tmpDir not initialized')
  const dir = path.join(tmpDir, 'projects', projectDir, sessionId, 'subagents')
  await fs.mkdir(dir, { recursive: true })
  const normalizedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`
  await fs.writeFile(
    path.join(dir, `${normalizedAgentId}.meta.json`),
    JSON.stringify(metadata),
    'utf-8',
  )
}

function makeAgentToolUseEntry(toolUseId: string): Record<string, unknown> {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolUseId,
        name: 'Agent',
        input: { description: 'Explore repo', prompt: 'Read files' },
      }],
    },
    uuid: 'assistant-agent-use',
    timestamp: '2026-01-01T00:00:01.000Z',
  }
}

function makeAgentToolResultEntry(toolUseId: string, agentId: string): Record<string, unknown> {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: [{
          type: 'text',
          text: `Finished exploring the repo\nagentId: ${agentId}\n<usage>input_tokens: 7\noutput_tokens: 11\ntotal_tokens: 18</usage>`,
        }],
      }],
    },
    uuid: 'user-agent-result',
    timestamp: '2026-01-01T00:00:03.000Z',
  }
}

function makeOneShotAgentToolResultEntry(toolUseId: string): Record<string, unknown> {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: [{ type: 'text', text: 'Finished exploring the repo' }],
      }],
    },
    uuid: 'user-one-shot-agent-result',
    timestamp: '2026-01-01T00:00:05.000Z',
  }
}

function makeTaskNotificationEntry(
  toolUseId: string,
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
): Record<string, unknown> {
  return {
    type: 'echoflow-code-task-notification',
    isMeta: true,
    taskNotification: {
      taskId,
      toolUseId,
      status,
      summary: 'Agent completed',
    },
    timestamp: '2026-01-01T00:00:06.000Z',
  }
}

describe('subagentRunService helpers', () => {
  it('deduplicates copied transcript history by upstream id while retaining legitimate repeated messages', () => {
    const repeated = (id: string): MessageEntry => ({
      id,
      type: 'assistant',
      content: 'same reply',
      timestamp: '2026-01-01T00:00:02.000Z',
    })
    const copied = repeated('shared-message-id')

    expect(mergeTeammateTranscriptFragments([
      { messages: [copied, repeated('legitimate-repeat-1')] },
      { messages: [{ ...copied }, repeated('legitimate-repeat-2')] },
    ])).toEqual([
      copied,
      repeated('legitimate-repeat-1'),
      repeated('legitimate-repeat-2'),
    ])
  })

  it('resolves agentId, description, and prompt from parent Agent messages by toolUseId', () => {
    const messages = [
      {
        id: 'assistant-agent-use',
        type: 'tool_use',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'Agent',
          input: { description: 'Explore repo', prompt: 'Read files' },
        }],
        timestamp: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'user-agent-result',
        type: 'tool_result',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [{ type: 'text', text: 'agentId: abc123\nStarted' }],
        }],
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    ] as MessageEntry[]

    expect(resolveSubagentRunFromMessages(messages, 'tool-1')).toMatchObject({
      agentId: 'abc123',
      description: 'Explore repo',
      prompt: 'Read files',
    })
  })

  it('does not truncate transcripts with at most 1000 messages', () => {
    const messages = Array.from({ length: 1000 }, (_, index) => ({ id: String(index) }))

    const result = truncateSubagentMessages(messages)

    expect(result).toEqual({ messages, truncated: false })
  })

  it('truncates long transcripts to first 50 and latest 950 entries', () => {
    const messages = Array.from({ length: 1200 }, (_, index) => ({ id: String(index) }))

    const result = truncateSubagentMessages(messages)

    expect(result.truncated).toBe(true)
    expect(result.messages).toHaveLength(1000)
    expect(result.messages[0]).toEqual({ id: '0' })
    expect(result.messages[49]).toEqual({ id: '49' })
    expect(result.messages[50]).toEqual({ id: '250' })
    expect(result.messages[999]).toEqual({ id: '1199' })
  })
})

describe('getSubagentRunByTool', () => {
  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('returns parent metadata and visible persisted subagent transcript messages', async () => {
    await setupTmpConfigDir()
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'
    const agentId = 'abc123'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
      makeAgentToolResultEntry(toolUseId, agentId),
      {
        type: 'user',
        message: {
          role: 'user',
          content: '<task-notification>\n<task-id>task-1</task-id>\n<tool-use-id>tool-1</tool-use-id>\n<status>completed</status>\n<summary>Agent completed</summary>\n<result>Finished exploring the repo</result>\n<output-file>/tmp/agent.out</output-file>\n</task-notification>',
        },
        uuid: 'task-notification',
        timestamp: '2026-01-01T00:00:04.000Z',
      },
    ])
    await writeSubagentTranscriptFile(projectDir, sessionId, agentId, [
      {
        type: 'user',
        message: { role: 'user', content: 'Read the source' },
        uuid: 'subagent-user',
        timestamp: '2026-01-01T00:00:05.000Z',
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Found the service seam' }],
          usage: { input_tokens: 13, output_tokens: 17 },
        },
        uuid: 'subagent-assistant',
        timestamp: '2026-01-01T00:00:06.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result).toMatchObject({
      sessionId,
      toolUseId,
      agentId,
      taskId: 'task-1',
      status: 'completed',
      description: 'Explore repo',
      prompt: 'Read files',
      summary: 'Agent completed',
      result: 'Finished exploring the repo',
      outputFile: '/tmp/agent.out',
      usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
      truncated: false,
      updatedAt: '2026-01-01T00:00:06.000Z',
      source: 'subagent-jsonl',
    })
    expect(result?.messages).toHaveLength(2)
    expect(result?.messages[0]).toMatchObject({
      type: 'user',
      content: 'Read the source',
      isSidechain: undefined,
    })
    expect(result?.messages[1]).toMatchObject({
      type: 'assistant',
      content: [{ type: 'text', text: 'Found the service seam' }],
      usage: { input_tokens: 13, output_tokens: 17 },
    })
  })

  it('uses the live task id to resolve a running one-shot SubAgent transcript', async () => {
    await setupTmpConfigDir()
    const sessionId = 'eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'
    const agentId = 'abc123'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
    ])
    await writeSubagentTranscriptFile(projectDir, sessionId, agentId, [
      {
        type: 'user',
        message: { role: 'user', content: 'Read the source' },
        uuid: 'subagent-user',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'subagent-tool-1',
            name: 'Read',
            input: { file_path: '/tmp/example.ts' },
          }],
        },
        uuid: 'subagent-assistant-tool',
        timestamp: '2026-01-01T00:00:03.000Z',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'subagent-tool-1',
            content: 'export const ready = true',
          }],
        },
        uuid: 'subagent-tool-result',
        timestamp: '2026-01-01T00:00:04.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId, agentId)

    expect(result).toMatchObject({
      sessionId,
      toolUseId,
      agentId,
      taskId: agentId,
      status: 'running',
      source: 'subagent-jsonl',
      canSendMessage: false,
    })
    expect(result?.messages).toHaveLength(3)
    expect(result?.messages[1]).toMatchObject({
      type: 'tool_use',
      content: [{ type: 'tool_use', id: 'subagent-tool-1', name: 'Read' }],
    })
    expect(result?.messages[2]).toMatchObject({
      type: 'tool_result',
      content: [{ type: 'tool_result', tool_use_id: 'subagent-tool-1' }],
    })
  })

  it('streams a running one-shot SubAgent transcript resolved from launch metadata alone', async () => {
    await setupTmpConfigDir()
    const sessionId = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'call_00_live'
    const agentId = 'a46d5bd4ae656c8d5'

    // A synchronously dispatched agent that is still running: the parent has
    // only the tool_use, so there is no result text to mine an agent id from
    // and no background task id for the client to pass in.
    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
    ])
    await writeSubagentLaunchMetadata(projectDir, sessionId, agentId, {
      agentType: 'general-purpose',
      description: 'Explore repo',
      toolUseId,
    })
    await writeSubagentTranscriptFile(projectDir, sessionId, agentId, [
      {
        type: 'user',
        message: { role: 'user', content: 'Read the source' },
        uuid: 'subagent-user',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'subagent-tool-1',
            name: 'Bash',
            input: { command: 'git log --oneline -5' },
          }],
        },
        uuid: 'subagent-assistant-tool',
        timestamp: '2026-01-01T00:00:03.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result).toMatchObject({
      sessionId,
      toolUseId,
      agentId,
      status: 'running',
      source: 'subagent-jsonl',
      // Still running, but synchronously dispatched: the parent turn is
      // waiting on its result, so there is no inbox to send into.
      canSendMessage: false,
    })
    expect(result?.messages).toHaveLength(2)
    expect(result?.messages[1]).toMatchObject({
      type: 'tool_use',
      content: [{ type: 'tool_use', id: 'subagent-tool-1', name: 'Bash' }],
    })
  })

  it('resolves the agent id from launch metadata even before the transcript has entries', async () => {
    await setupTmpConfigDir()
    const sessionId = 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'call_00_cold'
    const agentId = 'b91f2c3d4e5a6b7c8'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
    ])
    await writeSubagentLaunchMetadata(projectDir, sessionId, agentId, {
      agentType: 'general-purpose',
      toolUseId,
    })

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result).toMatchObject({ agentId, status: 'running' })
    expect(result?.messages).toHaveLength(0)
  })

  it('ignores launch metadata written for a different tool call', async () => {
    await setupTmpConfigDir()
    const sessionId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'call_00_mine'
    const otherAgentId = 'f00dcafe12345678a'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
    ])
    await writeSubagentLaunchMetadata(projectDir, sessionId, otherAgentId, {
      agentType: 'general-purpose',
      toolUseId: 'call_99_someone_else',
    })
    await writeSubagentTranscriptFile(projectDir, sessionId, otherAgentId, [
      {
        type: 'user',
        message: { role: 'user', content: 'Not for this card' },
        uuid: 'other-subagent-user',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result?.agentId).toBeNull()
    expect(result?.messages).toHaveLength(0)
  })

  it('uses the terminal notification task id when a one-shot result omits agentId', async () => {
    await setupTmpConfigDir()
    const sessionId = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'
    const agentId = 'abc123'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
      makeOneShotAgentToolResultEntry(toolUseId),
      makeTaskNotificationEntry(toolUseId, agentId, 'completed'),
    ])
    await writeSubagentTranscriptFile(projectDir, sessionId, agentId, [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'subagent-tool-1', name: 'Read', input: {} }],
        },
        uuid: 'subagent-assistant-tool',
        timestamp: '2026-01-01T00:00:03.000Z',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'subagent-tool-1', content: 'done' }],
        },
        uuid: 'subagent-tool-result',
        timestamp: '2026-01-01T00:00:04.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result).toMatchObject({
      agentId,
      taskId: agentId,
      status: 'completed',
      source: 'subagent-jsonl',
    })
    expect(result?.messages).toHaveLength(2)
  })

  it('aggregates resumed named teammate fragments and returns the latest resumable transcript id', async () => {
    await setupTmpConfigDir()
    const sessionId = '11111111-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-team-1'
    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: [{
              type: 'text',
              text: 'Spawned successfully.\nagent_id: id-worker-a@workbench-id-0808\nname: id-worker-a\nteam_name: workbench-id-0808',
            }],
          }],
        },
        uuid: 'team-agent-result',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    ])
    await writeSubagentTranscriptFile(projectDir, sessionId, 'older123', [{
      type: 'assistant',
      message: { role: 'assistant', content: 'First teammate turn' },
      uuid: 'older-message',
      timestamp: '2026-01-01T00:00:03.000Z',
    }])
    await writeSubagentMetadata(projectDir, sessionId, 'older123', 'id-worker-a', 1_000)
    await writeSubagentTranscriptFile(projectDir, sessionId, 'latest456', [{
      type: 'assistant',
      message: { role: 'assistant', content: 'Resumed teammate turn' },
      uuid: 'latest-message',
      timestamp: '2026-01-01T00:00:04.000Z',
    }])
    await writeSubagentMetadata(projectDir, sessionId, 'latest456', 'id-worker-a', 2_000)

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result).toMatchObject({
      agentId: 'latest456',
      status: 'completed',
      source: 'subagent-jsonl',
      // A named teammate keeps its mailbox after a turn ends.
      canSendMessage: true,
    })
    expect(result?.messages.map((message) => message.content)).toEqual([
      'First teammate turn',
      'Resumed teammate turn',
    ])
  })

  it('keeps an async launch acknowledgement running until a terminal notification arrives', async () => {
    await setupTmpConfigDir()
    const sessionId = 'abababab-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'
    const agentId = 'abc123'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `Async agent launched successfully.\nagentId: ${agentId}\nThe agent is working in the background.`,
          }],
        },
        uuid: 'async-launch-result',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId, agentId)

    expect(result).toMatchObject({
      agentId,
      taskId: agentId,
      status: 'running',
      source: 'live-task',
      // An in-flight background agent has a live inbox: a follow-up queues.
      canSendMessage: true,
    })
  })

  it('ignores unsafe live task ids instead of using them as transcript paths', async () => {
    await setupTmpConfigDir()
    const sessionId = 'cdcdcdcd-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'
    await writeSessionFile(projectDir, sessionId, [makeAgentToolUseEntry(toolUseId)])

    const result = await getSubagentRunByTool(sessionId, toolUseId, 'agent-/../../outside')

    expect(result).toMatchObject({
      agentId: null,
      status: 'running',
      source: 'session-history',
    })
    expect(result?.taskId).toBeUndefined()
    expect(result?.messages).toEqual([])
  })

  it('does not report usage when parent and transcript usage are unknown', async () => {
    await setupTmpConfigDir()
    const sessionId = 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'
    const agentId = 'abc123'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `Finished exploring the repo\nagentId: ${agentId}`,
          }],
        },
        uuid: 'user-agent-result-without-usage',
        timestamp: '2026-01-01T00:00:03.000Z',
      },
    ])
    await writeSubagentTranscriptFile(projectDir, sessionId, agentId, [
      {
        type: 'user',
        message: { role: 'user', content: 'Read the source' },
        uuid: 'subagent-user',
        timestamp: '2026-01-01T00:00:05.000Z',
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Found the service seam' }],
        },
        uuid: 'subagent-assistant',
        timestamp: '2026-01-01T00:00:06.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result?.usage).toBeUndefined()
  })

  it('marks parent Agent tool errors as failed when no task notification overrides them', async () => {
    await setupTmpConfigDir()
    const sessionId = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee'
    const projectDir = '-tmp-subagent-run'
    const toolUseId = 'tool-1'

    await writeSessionFile(projectDir, sessionId, [
      makeAgentToolUseEntry(toolUseId),
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: "Agent type 'general' not found",
            is_error: true,
          }],
        },
        uuid: 'user-agent-error-result',
        timestamp: '2026-01-01T00:00:03.000Z',
      },
    ])

    const result = await getSubagentRunByTool(sessionId, toolUseId)

    expect(result).toMatchObject({
      sessionId,
      toolUseId,
      status: 'failed',
      result: "Agent type 'general' not found",
      source: 'session-history',
    })
  })

  it('returns null when the parent Agent tool use is not present', async () => {
    await setupTmpConfigDir()
    const sessionId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeSessionFile('-tmp-subagent-run', sessionId, [
      makeAgentToolResultEntry('tool-1', 'abc123'),
    ])

    await expect(getSubagentRunByTool(sessionId, 'tool-1')).resolves.toBeNull()
  })
})
