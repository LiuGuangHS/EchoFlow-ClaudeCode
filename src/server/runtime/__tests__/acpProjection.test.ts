import { describe, expect, test } from 'bun:test'
import { projectSessionUpdate } from '../acpProjection.js'

const chunk = (text: string) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })

describe('projectSessionUpdate', () => {
  test('maps streamed assistant text to assistant.delta', () => {
    expect(projectSessionUpdate(chunk('hello'))).toEqual({ kind: 'assistant.delta', text: 'hello' })
  })

  test('drops the echo of our own user input', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } })).toBeNull()
  })

  test('maps a tool call to tool.started with the native call attached', () => {
    const native = { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Write file', kind: 'edit', status: 'pending', rawInput: { path: 'a.ts' } }
    expect(projectSessionUpdate(native)).toEqual({
      kind: 'tool.started', toolCallId: 'call-1', name: 'Write file', input: { path: 'a.ts' }, native,
    })
  })

  test('maps a completed tool call to tool.completed without an error', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', rawOutput: 'ok' }))
      .toMatchObject({ kind: 'tool.completed', toolCallId: 'call-1', output: 'ok', isError: false })
  })

  test('maps a failed tool call to tool.completed with isError', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'failed' }))
      .toMatchObject({ kind: 'tool.completed', isError: true })
  })

  test('maps an in-flight tool call update to tool.updated', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress' }))
      .toMatchObject({ kind: 'tool.updated', toolCallId: 'call-1' })
  })

  test('maps a plan to plan', () => {
    const entries = [{ content: 'step' }]
    expect(projectSessionUpdate({ sessionUpdate: 'plan', entries })).toMatchObject({ kind: 'plan', entries })
  })

  test('maps usage_update to usage and keeps the native payload', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'usage_update', used: 10, size: 100, cost: { amount: 0.5, currency: 'USD' } }))
      .toMatchObject({ kind: 'usage', native: { used: 10, size: 100 } })
  })

  test('turns metadata updates into info diagnostics instead of dropping them', () => {
    for (const sessionUpdate of ['available_commands_update', 'current_mode_update', 'config_option_update', 'session_info_update', 'plan_update', 'plan_removed', 'compaction_update']) {
      expect(projectSessionUpdate({ sessionUpdate })).toMatchObject({
        kind: 'diagnostic', level: 'info', code: `acp.${sessionUpdate}`,
      })
    }
  })

  test('turns an unknown update kind into a warning diagnostic with the native payload', () => {
    const update = { sessionUpdate: 'something_new_from_dsh', value: 1 }
    expect(projectSessionUpdate(update)).toMatchObject({ kind: 'diagnostic', level: 'warn', code: 'acp.unknown_update', native: update })
  })

  test('turns a malformed update into a warning diagnostic instead of throwing', () => {
    expect(projectSessionUpdate('not-an-object')).toMatchObject({ kind: 'diagnostic', level: 'warn', code: 'acp.unknown_update', native: 'not-an-object' })
  })

  test('maps a non-text assistant chunk to an info diagnostic', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'image' } }))
      .toMatchObject({ kind: 'diagnostic', level: 'info', code: 'acp.unsupported_content' })
  })
})
