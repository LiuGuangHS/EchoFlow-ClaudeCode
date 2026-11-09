import { describe, expect, test } from 'bun:test'
import { SessionTurnOwnership } from './sessionTurnOwnership.js'

describe('session turn ownership', () => {
  test('a replaced turn cannot release its successor', () => {
    const turns = new SessionTurnOwnership<object>()
    const previous = {}
    const current = {}
    turns.set('session', previous)
    turns.set('session', current)

    expect(turns.release('session', previous)).toBe(false)
    expect(turns.get('session')).toBe(current)
    expect(turns.release('session', current)).toBe(true)
    expect(turns.has('session')).toBe(false)
    expect(turns.release('session', current)).toBe(false)
  })

  test('releasing one session preserves another session and its pending state', () => {
    const turns = new SessionTurnOwnership<{ messageSent: boolean; cancelled?: boolean }>()
    const pending: { messageSent: boolean; cancelled?: boolean } = { messageSent: false }
    const running = { messageSent: true }
    turns.set('pending', pending)
    turns.set('running', running)

    expect(turns.has('pending')).toBe(true)
    pending.cancelled = true
    expect(turns.has('pending')).toBe(true)
    expect(turns.release('running', running)).toBe(true)
    expect(turns.get('pending')).toBe(pending)
    expect(turns.release('pending', running)).toBe(false)
    expect(turns.release('pending', pending)).toBe(true)
  })

  test('cleanup revokes ownership and stale releases cannot affect a later turn', () => {
    const turns = new SessionTurnOwnership<object>()
    const previous = {}
    turns.set('session', previous)
    turns.clear()
    const current = {}
    turns.set('session', current)

    expect(turns.release('session', previous)).toBe(false)
    expect([...turns.values()]).toEqual([current])
    turns.delete('session')
    expect(turns.release('session', current)).toBe(false)
  })
})
