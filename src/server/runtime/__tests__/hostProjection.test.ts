import { describe, expect, test } from 'bun:test'
import { projectHostRecord } from '../hostProjection.js'

// Shapes below were captured from a real dsh Host (0.2.1-rc.5) driven by the
// official mock LLM, not written from the types.

describe('projectHostRecord against real Host records', () => {
  test('a text assistant message projects its text blocks', () => {
    const events = projectHostRecord({
      seq: 20,
      type: 'assistant/message',
      data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
    })
    expect(events).toEqual([{ kind: 'assistant.message', text: 'done', native: expect.anything() }])
  })

  test('an assistant message that only calls a tool carries no text', () => {
    const events = projectHostRecord({
      seq: 13,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'tool-call', id: 'mock-call-1', name: 'bash', arguments: '{}' }] },
      },
    })
    expect(events).toEqual([])
  })

  test('tool/call starts a tool with its callId and parsed arguments', () => {
    const events = projectHostRecord({
      seq: 14,
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'mock-call-1', name: 'bash', arguments: '{"command":"echo x"}' },
    })
    expect(events).toEqual([
      {
        kind: 'tool.started',
        toolCallId: 'mock-call-1',
        name: 'bash',
        input: { command: 'echo x' },
        native: expect.anything(),
      },
    ])
  })

  test('tool/call keeps unparseable arguments as the raw string', () => {
    const [event] = projectHostRecord({
      seq: 14,
      type: 'tool/call',
      data: { callId: 'c', name: 'bash', arguments: '{not json' },
    })
    expect(event).toMatchObject({ kind: 'tool.started', toolCallId: 'c', input: '{not json' })
  })

  test('tool/result completes the tool with its output text and error flag', () => {
    const events = projectHostRecord({
      seq: 17,
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: { role: 'tool', toolCallId: 'mock-call-1', content: [{ type: 'text', text: 'x\n' }], isError: false },
      },
    })
    expect(events).toEqual([
      { kind: 'tool.completed', toolCallId: 'mock-call-1', output: 'x\n', isError: false, native: expect.anything() },
    ])
  })

  test('a failed tool/result is marked as an error', () => {
    const [event] = projectHostRecord({
      seq: 17,
      type: 'tool/result',
      data: { message: { toolCallId: 'c', content: [{ type: 'text', text: 'boom' }], isError: true } },
    })
    expect(event).toMatchObject({ kind: 'tool.completed', toolCallId: 'c', isError: true })
  })

  test('turn/end with reason completed is end_turn, not an error', () => {
    const events = projectHostRecord({ seq: 22, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    expect(events).toEqual([{ kind: 'turn.completed', reason: 'end_turn', native: expect.anything() }])
  })

  test('turn/end with an unknown reason is an error', () => {
    const [event] = projectHostRecord({ seq: 22, type: 'turn/end', data: { reason: { kind: 'something-new' } } })
    expect(event).toMatchObject({ kind: 'turn.completed', reason: 'error' })
  })

  test('turn/end with reason cancelled stays cancelled', () => {
    const [event] = projectHostRecord({ seq: 22, type: 'turn/end', data: { reason: { kind: 'cancelled' } } })
    expect(event).toMatchObject({ kind: 'turn.completed', reason: 'cancelled' })
  })

  test('records without a contract projection become an info diagnostic', () => {
    const [event] = projectHostRecord({ seq: 15, type: 'job/registered', data: { jobId: 'j' } })
    expect(event).toMatchObject({ kind: 'diagnostic', level: 'info', code: 'host.job/registered' })
  })
})
