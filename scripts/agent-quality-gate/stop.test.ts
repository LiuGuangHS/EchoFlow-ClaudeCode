import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acknowledge, decideStop, readAll, runCli } from './stop.js'
import { handleSubagentStop } from './subagent-stop.js'
import { recordEdit, recordTest, readState, statePath } from './state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-quality-gate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('decideStop', () => {
  test('lets a session that changed no code end freely', async () => {
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(0)
  })

  test('blocks when code changed with no review and no test after it', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(2)
    expect(decision.message).toContain('review')
    expect(decision.message).toContain('test')
    expect(decision.message).toContain('src/a.ts')
  })

  test('names only the step that is actually missing', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await recordTest('s1', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(2)
    expect(decision.message).toContain('review')
    expect(decision.message).not.toContain('test did not')
  })

  test('allows once a review and a test both follow the edit', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await handleSubagentStop({ session_id: 's1', agent_type: 'Explore' }, dir)
    await recordTest('s1', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(0)
  })

  test('an explicit waiver ends the task and says it was waived', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await acknowledge('s1', 'reviewer unavailable on this machine', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(0)
    expect(decision.message).toContain('reviewer unavailable')
    expect(decision.message).toContain('BLOCKED')
  })

  test('the waiver does not cover edits made after it', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await acknowledge('s1', 'reviewer unavailable', dir)
    await recordEdit('s1', 'src/a.ts', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(2)
  })

  test('gives up blocking after repeated refusals instead of locking the session', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = await decideStop({ session_id: 's1' }, dir)
      expect(decision.exit).toBe(2)
    }
    const final = await decideStop({ session_id: 's1' }, dir)
    expect(final.exit).toBe(0)
    expect(final.message).toContain('giving up')
    expect((await readState('s1', dir)).blockCount).toBe(3)
  })

  test('a corrupt state file never blocks the session', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(statePath('s1', dir), '{ not json at all\n', 'utf-8')
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(0)
  })

  test('a session that has no state file at all is not blocked', async () => {
    const decision = await decideStop({ session_id: 'nope-not-written' }, dir)
    expect(decision.exit).toBe(0)
  })
})

describe('handleSubagentStop', () => {
  test('counts a finished subagent as an independent look', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await handleSubagentStop({ session_id: 's1', agent_type: 'Explore' }, dir)
    const state = await readState('s1', dir)
    expect(state.lastReviewSeq).toBeGreaterThan(state.lastEditSeq!)
    expect(state.lastReviewer).toBe('Explore')
  })

  test('a subagent with no session id is ignored', async () => {
    await handleSubagentStop({ agent_type: 'Explore' }, dir)
    expect((await readState('', dir)).lastReviewSeq).toBeNull()
  })

  // A fork inherits the author's context; the relay-only subagents are forks.
  test('a fork is the author with a second hat, not a reviewer', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await handleSubagentStop({ session_id: 's1', agent_type: 'fork' }, dir)
    expect((await readState('s1', dir)).lastReviewSeq).toBeNull()
  })

  test('an unnamed subagent is not evidence of independence', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    await handleSubagentStop({ session_id: 's1' }, dir)
    expect((await readState('s1', dir)).lastReviewSeq).toBeNull()
  })
})

describe('runCli', () => {
  // The block message tells the model to run --ack. If that only works when a
  // session id also arrives on stdin, the escape hatch it advertises is a lie.
  test('--ack records a waiver without needing stdin', async () => {
    await runCli(['--ack', 'review is still running', '--session', 's1'], '', dir)
    expect((await readState('s1', dir)).waiver?.reason).toBe('review is still running')
  })

  test('--ack still works when the session id arrives on stdin', async () => {
    await runCli(['--ack', 'handing off'], JSON.stringify({ session_id: 's1' }), dir)
    expect((await readState('s1', dir)).waiver?.reason).toBe('handing off')
  })

  test('--ack with no reason or no session id records nothing', async () => {
    await runCli(['--ack'], '', dir)
    await runCli(['--ack', 'reason'], '', dir)
    expect((await readState('', dir)).waiver).toBeNull()
    expect((await readState('undefined', dir)).waiver).toBeNull()
  })

  test('unreadable stdin lets the session end rather than killing the hook', async () => {
    const decision = await runCli([], '{{{ not json', dir)
    expect(decision.exit).toBe(0)
  })
})

describe('what the model is told', () => {
  test('the give-up message is reported instead of being silently dropped', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    for (let i = 0; i < 3; i++) await decideStop({ session_id: 's1' }, dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(0)
    expect(decision.message).toContain('giving up')
    expect(decision.report).toBe(true)
  })

  test('a stop that needs nothing is silent', async () => {
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(0)
    expect(decision.report).toBe(false)
  })

  test('a blocked stop is always reported', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(2)
    expect(decision.report).toBe(true)
  })

  // The waiver exists for a maintainer. Printing the exact command would hand
  // the model a way to wave its own work through.
  test('the block message does not hand the model its own escape hatch', async () => {
    await recordEdit('s1', 'src/a.ts', dir)
    const decision = await decideStop({ session_id: 's1' }, dir)
    expect(decision.exit).toBe(2)
    expect(decision.message).not.toContain('--ack')
  })
})

describe('readAll', () => {
  test('a stream that errors mid-read does not take the hook down', async () => {
    async function* broken() {
      yield Buffer.from('{"session_id"')
      throw new Error('boom')
    }
    expect(await readAll(broken())).toBe('{"session_id"')
  })
})
