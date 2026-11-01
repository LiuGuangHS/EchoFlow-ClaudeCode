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

  test('lifts the context window numbers ACP actually sends', () => {
    const update = { sessionUpdate: 'usage_update', used: 10, size: 100, cost: { amount: 0.5, currency: 'USD' } }
    expect(projectSessionUpdate(update))
      .toEqual({ kind: 'usage', contextUsed: 10, contextSize: 100, cost: { amount: 0.5, currency: 'USD' }, native: update })
  })

  test('omits a malformed cost instead of coercing it', () => {
    const body = projectSessionUpdate({ sessionUpdate: 'usage_update', used: 1, size: 2, cost: 'free' })
    expect(body).toMatchObject({ kind: 'usage', contextUsed: 1, contextSize: 2 })
    expect(body !== null && 'cost' in body).toBe(false)
  })

  test('turns metadata updates into info diagnostics instead of dropping them', () => {
    for (const sessionUpdate of ['available_commands_update', 'current_mode_update', 'session_info_update', 'plan_update', 'plan_removed', 'compaction_update']) {
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

  test('projects an ACP thought chunk as assistant.thinking', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'plan' } }))
      .toEqual({ kind: 'assistant.thinking', text: 'plan' })
  })

  test('maps a non-text thought chunk to an info diagnostic', () => {
    expect(projectSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'image' } }))
      .toMatchObject({ kind: 'diagnostic', level: 'info', code: 'acp.unsupported_content' })
  })

  test('projects a config option update as config.changed with the whole option table', () => {
    const update = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'echoflow/kimi-k3',
          options: [
            { group: 'main', name: 'Main', options: [{ value: 'echoflow/kimi-k3', name: 'Kimi K3', description: 'default' }] },
            { group: 'other', name: 'Other', options: [{ value: 'echoflow/other', name: 'Other model' }] },
          ],
        },
        {
          type: 'select',
          id: 'reasoning_effort',
          name: 'Reasoning effort',
          currentValue: 'high',
          options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
        },
        { type: 'boolean', id: 'thinking', name: 'Thinking', currentValue: true },
      ],
    }
    expect(projectSessionUpdate(update)).toEqual({
      kind: 'config.changed',
      options: [
        {
          kind: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          value: 'echoflow/kimi-k3',
          options: [
            { name: 'Main', options: [{ value: 'echoflow/kimi-k3', name: 'Kimi K3', description: 'default' }] },
            { name: 'Other', options: [{ value: 'echoflow/other', name: 'Other model' }] },
          ],
        },
        {
          kind: 'select',
          id: 'reasoning_effort',
          name: 'Reasoning effort',
          value: 'high',
          options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
        },
        { kind: 'boolean', id: 'thinking', name: 'Thinking', value: true },
      ],
    })
  })

  test('keeps option candidates, groups, categories and boolean values', () => {
    const update = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          description: 'which model to run',
          currentValue: 'echoflow/kimi-k3',
          options: [
            { group: 'main', name: 'Main', options: [{ value: 'echoflow/kimi-k3', name: 'Kimi K3', description: 'default' }] },
            { group: 'other', name: 'Other', options: [{ value: 'echoflow/other', name: 'Other model' }] },
          ],
        },
        {
          type: 'select',
          id: 'reasoning_effort',
          name: 'Reasoning effort',
          currentValue: 'high',
          options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
        },
        { type: 'boolean', id: 'thinking', name: 'Thinking', currentValue: true },
      ],
    }
    const projected = projectSessionUpdate(update) as { options: Array<Record<string, unknown>> }
    const [model, reasoning, thinking] = projected.options
    // A category and a description survive the projection instead of being flattened away.
    expect(model).toMatchObject({ kind: 'select', category: 'model', description: 'which model to run' })
    // A group becomes a nested list keyed by its label.
    expect(model.options).toEqual([
      { name: 'Main', options: [{ value: 'echoflow/kimi-k3', name: 'Kimi K3', description: 'default' }] },
      { name: 'Other', options: [{ value: 'echoflow/other', name: 'Other model' }] },
    ])
    // A flat candidate list survives as-is.
    expect(reasoning.options).toEqual([{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }])
    // A boolean stays a boolean; stringifying it would make `false` indistinguishable from absent.
    expect(thinking).toMatchObject({ kind: 'boolean', value: true })
    expect(typeof thinking.value).toBe('boolean')
  })

  test('drops null optional fields instead of rendering the string "null"', () => {
    const projected = projectSessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: null,
          description: null,
          currentValue: 'a',
          options: [{ value: 'a', name: 'A', description: null }],
        },
      ],
    }) as { options: Array<Record<string, unknown>> }
    const [model] = projected.options
    // ACP allows an explicit null on these optional fields; that is absent, not the word "null".
    expect(model).toEqual({ kind: 'select', id: 'model', name: 'Model', value: 'a', options: [{ value: 'a', name: 'A' }] })
    expect('category' in model).toBe(false)
    expect('description' in model).toBe(false)
    expect((model.options as Array<Record<string, unknown>>)[0].description).toBeUndefined()
  })

  test('keeps a false boolean as a real false', () => {
    const projected = projectSessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [{ type: 'boolean', id: 'thinking', name: 'Thinking', currentValue: false }],
    }) as { options: Array<Record<string, unknown>> }
    expect(projected.options[0]).toMatchObject({ kind: 'boolean', value: false })
    expect(typeof projected.options[0].value).toBe('boolean')
  })
})
