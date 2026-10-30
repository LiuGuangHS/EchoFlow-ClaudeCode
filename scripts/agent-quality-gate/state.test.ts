import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  evaluateGate,
  legacyStatePath,
  recordBlock,
  recordEdit,
  recordReview,
  recordTest,
  recordWaiver,
  readState,
  statePath,
} from './state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-quality-gate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('gate state', () => {
  test('starts empty for a session that has done nothing', async () => {
    const state = await readState('s1', dir)
    expect(state.lastEditSeq).toBeNull()
    expect(state.lastReviewSeq).toBeNull()
    expect(state.lastTestSeq).toBeNull()
    expect(state.editedFiles).toEqual([])
  })

  test('records which files the session edited', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordEdit('s1', 'src/b.ts', dir)
    await recordEdit('s1', 'src/a.ts', dir)
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('a corrupt state file fails open instead of throwing', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(statePath('s1', dir), '{ not json', 'utf-8')
    const state = await readState('s1', dir)
    expect(state.lastEditSeq).toBeNull()
  })

  test('keeps sessions apart', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordReview('s2', dir)
    const one = await readState('s1', dir)
    const two = await readState('s2', dir)
    expect(one.editedFiles).toEqual(['src/a.ts'])
    expect(two.editedFiles).toEqual([])
    expect(two.lastReviewSeq).not.toBeNull()
  })
})

describe('evaluateGate', () => {
  test('never blocks a session that changed no code', async () => {
    await recordReview('s1', dir)
    await recordTest('s1', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(false)
  })

  test('blocks when code changed and nothing ran after the edit', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(true)
    expect(verdict.missing).toContain('review')
    expect(verdict.missing).toContain('test')
  })

  test('allows once a review and a test both follow the edit', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordReview('s1', dir)
    await recordTest('s1', dir)
    expect(evaluateGate(await readState('s1', dir)).blocked).toBe(false)
  })

  test('a review before the edit does not count', async () => {
    await recordReview('s1', dir)
    await recordEdit('s1', 'src/a.ts', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(true)
    expect(verdict.missing).toContain('review')
  })

  test('a later edit invalidates an earlier review', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordReview('s1', dir)
    await recordTest('s1', dir)
    expect(evaluateGate(await readState('s1', dir)).blocked).toBe(false)

    await recordEdit('s1', 'src/a.ts', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(true)
    expect(verdict.missing).toContain('review')
  })

  test('a test run before the edit does not count', async () => {
    await recordTest('s1', dir)
    await recordEdit('s1', 'src/a.ts', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(true)
    expect(verdict.missing).toContain('test')
  })

  test('a fresh waiver lets the session end and says why', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordWaiver('s1', 'reviewer unavailable', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(false)
    expect(verdict.waived).toBe(true)
  })

  test('a waiver from before the edit is stale and does not count', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordWaiver('s1', 'reviewer unavailable', dir)
    await recordEdit('s1', 'src/a.ts', dir)
    const verdict = evaluateGate(await readState('s1', dir))
    expect(verdict.blocked).toBe(true)
    expect(verdict.waived).toBe(false)
  })

  test('state survives a round trip to disk', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordReview('s1', dir)
    await recordTest('s1', dir)
    const state = await readState('s1', dir)
    expect(state.lastEditSeq).not.toBeNull()
    expect(state.lastReviewSeq).toBeGreaterThan(state.lastEditSeq!)
    expect(state.lastTestSeq).toBeGreaterThan(state.lastReviewSeq!)
    expect(state.editedFiles).toEqual(['src/a.ts'])
    expect(state.seq).toBe(3)
  })

  test('a state file written by the earlier snapshot format is still read', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(
      legacyStatePath('s1', dir),
      JSON.stringify({
        sessionId: 's1',
        seq: 4,
        lastEditSeq: 2,
        lastReviewSeq: 3,
        lastTestSeq: null,
        lastReviewer: 'Explore',
        editedFiles: ['src/a.ts'],
        waiver: null,
        blockCount: 0,
      }),
      'utf-8',
    )
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts'])
    expect(state.lastReviewer).toBe('Explore')
    expect(evaluateGate(state).missing).toEqual(['test'])
  })

  test('events appended after an earlier snapshot stay after it', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(
      legacyStatePath('s1', dir),
      JSON.stringify({
        sessionId: 's1',
        seq: 4,
        lastEditSeq: 2,
        lastReviewSeq: 3,
        lastTestSeq: null,
        lastReviewer: 'Explore',
        editedFiles: ['src/a.ts'],
        waiver: null,
        blockCount: 0,
      }),
      'utf-8',
    )
    await recordEdit('s1', 'src/b.ts', dir)
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts', 'src/b.ts'])
    // The snapshot's review was already superseded by this edit.
    expect(evaluateGate(state).missing).toContain('review')
  })

  // Hooks are separate processes and run in parallel whenever a batch of tool
  // calls is issued. A read-modify-write that loses an event loses the edit
  // record, which is the one direction the gate must never fail open in.
  test('events from concurrent hook processes are all recorded', async () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`)
    await Promise.all(files.map(file => recordEdit('s1', file, dir)))
    const state = await readState('s1', dir)
    expect(state.editedFiles.length).toBe(25)
  })

  test('events from concurrent hook processes keep their order unambiguous', async () => {
    await Promise.all([recordEdit('s1', 'src/a.ts', dir), recordReview('s1', dir, 'Explore')])
    const state = await readState('s1', dir)
    // The invariant is that neither event was lost and neither tied with the
    // other. Which one landed first is not something a racing writer owes us.
    expect(state.lastReviewSeq).not.toBeNull()
    expect(state.lastEditSeq).not.toBeNull()
    expect(state.lastReviewSeq).not.toEqual(state.lastEditSeq)
  })

  test('the refusal counter resets once the gap is closed', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordBlock('s1', dir)
    await recordBlock('s1', dir)
    await recordBlock('s1', dir)
    expect((await readState('s1', dir)).blockCount).toBe(3)
    await recordReview('s1', dir, 'Explore')
    await recordTest('s1', dir)
    const state = await readState('s1', dir)
    expect(evaluateGate(state).blocked).toBe(false)
    expect(state.blockCount).toBe(0)
  })

  // Replaying history must not carry an old gap's refusals into the next one:
  // three refusals spread over unrelated tasks would otherwise disarm the gate.
  test('refusals from a closed gap do not count against the next gap', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordBlock('s1', dir)
    await recordBlock('s1', dir)
    await recordReview('s1', dir, 'Explore')
    await recordTest('s1', dir)
    await recordEdit('s1', 'src/b.ts', dir)
    expect((await readState('s1', dir)).blockCount).toBe(0)
    await recordBlock('s1', dir)
    expect((await readState('s1', dir)).blockCount).toBe(1)
    await recordBlock('s1', dir)
    await recordBlock('s1', dir)
    expect((await readState('s1', dir)).blockCount).toBe(3)
  })

  test('a malformed base event does not take the state down', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(statePath('s1', dir), '{"kind":"base"}\n{"kind":"edit","file":"src/a.ts"}\n', 'utf-8')
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts'])
    expect(state.seq).toBe(1)
  })
})
