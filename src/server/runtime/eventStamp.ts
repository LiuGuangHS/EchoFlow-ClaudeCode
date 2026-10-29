/**
 * Every runtime event goes through one stamper per session, so `seq` is
 * monotonic and `eventId` is unique without each producer inventing its own.
 */
import { randomUUID } from 'node:crypto'
import type { RuntimeEvent, RuntimeEventBody, RuntimeEventSource } from './contract.js'

export type StampEvent = (body: RuntimeEventBody, source?: RuntimeEventSource) => RuntimeEvent

export function createEventStamper(input: {
  sessionId: string
  runId: string
  now?: () => number
  newId?: () => string
}): StampEvent {
  const now = input.now ?? Date.now
  const newId = input.newId ?? randomUUID
  let seq = 0

  return (body, source = 'engine') => ({
    ...body,
    eventId: newId(),
    sessionId: input.sessionId,
    runId: input.runId,
    seq: (seq += 1),
    at: now(),
    source,
  }) as RuntimeEvent
}
