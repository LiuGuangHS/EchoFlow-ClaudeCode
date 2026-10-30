import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handlePostTool, isTestCommand } from './post-tool.js'
import { handlePreTool } from './pre-tool.js'
import { evaluateGate, readState } from './state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-quality-gate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('isTestCommand', () => {
  test.each([
    ['bun test scripts/a.test.ts'],
    ['bun run test -- --run'],
    ['bun run check:desktop'],
    ['bun run verify'],
    ['bun run quality:pr'],
    ['npm test'],
    ['npx vitest run'],
  ])('counts %s as verification', command => {
    expect(isTestCommand(command)).toBe(true)
  })

  // check:impact prints a report and always exits 0. Counting it would let a
  // task end without a single test having run.
  test('a report-only command is not verification', () => {
    expect(isTestCommand('bun run check:impact')).toBe(false)
  })

  test('an ordinary command is not verification', () => {
    expect(isTestCommand('git commit -m "fix: x"')).toBe(false)
  })

  test.each([
    ['ls -la'],
    ['git status'],
    ['cat bun.test.txt'],
    ['bun scripts/build.ts'],
  ])('does not count %s as verification', command => {
    expect(isTestCommand(command)).toBe(false)
  })

  test('counts a runner later in a command chain', () => {
    expect(isTestCommand('cd desktop && bun run check:desktop')).toBe(true)
    expect(isTestCommand('git add -A; bun run verify')).toBe(true)
  })

  test('an && inside double quotes does not split the command', () => {
    expect(isTestCommand('git commit -m "x && bun test"')).toBe(false)
  })

  test('an && inside single quotes does not split the command', () => {
    expect(isTestCommand("git commit -m 'x || bun test'")).toBe(false)
  })

  test('a command that only echoes a test name is not verification', () => {
    expect(isTestCommand('echo "bun test"')).toBe(false)
  })

  test('a quoted argument after a real test command still counts', () => {
    expect(isTestCommand('bun test "a && b"')).toBe(true)
  })

  test('a semicolon inside quotes does not split the command', () => {
    expect(isTestCommand('git commit -m "a; bun run verify"')).toBe(false)
  })

  test('a newline separates commands the way && does', () => {
    expect(isTestCommand('git status\nbun test x')).toBe(true)
  })

  test('a newline does not let a report-only command pass as verification', () => {
    expect(isTestCommand('git status\nbun run check:impact')).toBe(false)
  })

  // A heredoc body is arbitrary text. Splitting it would let a document that
  // merely quotes a command pass itself off as having run one.
  test('a heredoc body is not mistaken for a verification run', () => {
    expect(isTestCommand("cat > notes.md <<'EOF'\nbun run verify\nEOF")).toBe(false)
    expect(isTestCommand('cat > notes.md <<EOF\nfoo && bun test\nEOF')).toBe(false)
    expect(isTestCommand('cat > notes.md <<-EOF\nbun run check:desktop\nEOF')).toBe(false)
    expect(isTestCommand('tee out.txt <<< bun test')).toBe(false)
  })

  test.each([
    ['bun test-utils.ts'],
    ['bun run testing'],
    ['jestfoo --version'],
    ['npx vitest-something'],
    ['npm testx'],
  ])('does not count %s, which only starts with a runner name', command => {
    expect(isTestCommand(command)).toBe(false)
  })

  test('an escaped semicolon does not split the command', () => {
    expect(isTestCommand('bun test\\; echo hi')).toBe(false)
    expect(isTestCommand('echo hi \\; bun test')).toBe(false)
  })

  // These name a runner and run nothing: a syntax error, or text that is only
  // text. Crediting them would let a task end with no check at all.
  test.each([
    ['bun test &&'],
    ['bun test && && x'],
    ['&& bun test'],
    ['|| bun test'],
    ['bun test; ;'],
    ["echo 'bun run check:desktop'"],
    ['echo "bun run verify"'],
    ['# bun test'],
    ['   '],
    [''],
  ])('does not count %s, which runs nothing', command => {
    expect(isTestCommand(command)).toBe(false)
  })

  test('a pipeline that still runs the runner counts', () => {
    expect(isTestCommand('bun test | tee log')).toBe(true)
    expect(isTestCommand('bun test > out.txt 2>&1')).toBe(true)
    expect(isTestCommand('bun test < input.txt')).toBe(true)
    expect(isTestCommand('bun test "a << b"')).toBe(true)
    expect(isTestCommand('echo x && bun test')).toBe(true)
    expect(isTestCommand('bun test; echo done')).toBe(true)
    expect(isTestCommand('bun test\n')).toBe(true)
  })
})

describe('handlePostTool', () => {
  test('a completed verification run is credited', async () => {
    await handlePostTool(
      {
        session_id: 's1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'bun test' },
      },
      dir,
    )
    expect((await readState('s1', dir)).lastTestSeq).not.toBeNull()
  })

  test('a completed ordinary command records nothing', async () => {
    await handlePostTool(
      {
        session_id: 's1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
      },
      dir,
    )
    expect((await readState('s1', dir)).lastTestSeq).toBeNull()
  })

  test('a non-Bash tool does not record a test run', async () => {
    await handlePostTool(
      {
        session_id: 's1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/a.ts' },
      },
      dir,
    )
    expect((await readState('s1', dir)).lastTestSeq).toBeNull()
  })

  // The only writer of the test credit is handlePostTool, and PostToolUse fires
  // only after the tool ran. A denied or interrupted command produces no hook
  // at all, so there is nothing that could credit it.
  test('a run that never completed leaves the gate unsatisfied', async () => {
    await handlePreTool(
      { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } },
      dir,
    )
    await handlePreTool(
      { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'bun test' } },
      dir,
    )
    const state = await readState('s1', dir)
    expect(state.lastTestSeq).toBeNull()
    expect(evaluateGate(state).missing).toContain('test')
  })

  test('a request with no session id is ignored', async () => {
    await handlePostTool(
      { tool_name: 'Bash', tool_input: { command: 'bun test' } },
      dir,
    )
    expect((await readState('', dir)).lastTestSeq).toBeNull()
    expect((await readState('undefined', dir)).lastTestSeq).toBeNull()
  })

  // The join, not each end: an edit plus a completed verification run must come
  // out ordered so the gate can see the verification covered that edit.
  test('an edit followed by a completed verification run is ordered correctly', async () => {
    await handlePreTool(
      { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } },
      dir,
    )
    await handlePostTool(
      {
        session_id: 's1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'bun run verify' },
      },
      dir,
    )
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts'])
    expect(state.lastTestSeq).toBeGreaterThan(state.lastEditSeq!)
    expect(evaluateGate(state).missing).toEqual(['review'])
  })
})
