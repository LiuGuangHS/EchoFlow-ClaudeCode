import { describe, expect, test } from 'bun:test'
import { createEventStamper } from '../eventStamp.js'

describe('createEventStamper', () => {
  test('stamps a monotonic seq, a unique id, the injected clock and the default source', () => {
    let clock = 1_000
    let counter = 0
    const stamp = createEventStamper({
      sessionId: 'session-1',
      runId: 'run-1',
      now: () => clock++,
      newId: () => `event-${++counter}`,
    })

    const first = stamp({ kind: 'assistant.delta', text: 'one' })
    const second = stamp({ kind: 'assistant.delta', text: 'two' }, 'echoflow')

    expect(first).toMatchObject({
      eventId: 'event-1',
      sessionId: 'session-1',
      runId: 'run-1',
      seq: 1,
      at: 1_000,
      source: 'engine',
    })
    expect(second).toMatchObject({ eventId: 'event-2', seq: 2, at: 1_001, source: 'echoflow' })
  })

  test('keeps every body field intact', () => {
    const stamp = createEventStamper({ sessionId: 's', runId: 'r', now: () => 1, newId: () => 'e' })
    expect(stamp({ kind: 'turn.completed', reason: 'end_turn', native: { stopReason: 'end_turn' } }))
      .toMatchObject({ kind: 'turn.completed', reason: 'end_turn', native: { stopReason: 'end_turn' } })
  })

  test('defaults to a random id and the wall clock', () => {
    const stamp = createEventStamper({ sessionId: 's', runId: 'r' })
    const event = stamp({ kind: 'assistant.delta', text: 'x' })
    expect(event.eventId).toHaveLength(36)
    expect(Math.abs(Date.now() - event.at)).toBeLessThan(5_000)
  })
})
