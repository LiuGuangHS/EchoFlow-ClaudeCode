import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { classify, handlePreTool } from './pre-tool.js'
import { readState } from './state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-quality-gate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('classify', () => {
  test.each([
    ['Edit'],
    ['Write'],
    ['MultiEdit'],
    ['NotebookEdit'],
  ])('%s records an edit', tool => {
    const result = classify({ tool_name: tool, tool_input: { file_path: 'src/a.ts' } })
    expect(result).toEqual({ kind: 'edit', file: 'src/a.ts' })
  })

  test('a non-file tool is ignored', () => {
    expect(classify({ tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } })).toEqual({
      kind: 'ignore',
    })
  })

  test('a file tool without a path is ignored rather than recorded as nothing', () => {
    expect(classify({ tool_name: 'Edit', tool_input: {} })).toEqual({ kind: 'ignore' })
  })

  // NotebookEdit reports the file as notebook_path, never file_path. Reading the
  // wrong key would make every notebook edit invisible to the gate.
  test('NotebookEdit records the notebook it edits', () => {
    const result = classify({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'notebooks/a.ipynb' },
    })
    expect(result).toEqual({ kind: 'edit', file: 'notebooks/a.ipynb' })
  })

  // A scratch script under /tmp has no test in this repository, so counting it
  // would block the session on a step that cannot exist.
  test('a file outside the session working directory is ignored', () => {
    const result = classify({
      tool_name: 'Write',
      cwd: '/work/repo',
      tool_input: { file_path: '/tmp/drift_scan.py' },
    }, '/work/repo')
    expect(result).toEqual({ kind: 'ignore' })
  })

  test('a file inside the project above the session working directory is recorded', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: '/work/repo/packages/app',
      tool_input: { file_path: '/work/repo/package.json' },
    }, '/work/repo')
    expect(result).toEqual({ kind: 'edit', file: '/work/repo/package.json' })
  })

  test('a file outside the project is ignored when cwd is nested', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: '/work/repo/packages/app',
      tool_input: { file_path: '/tmp/drift_scan.py' },
    }, '/work/repo')
    expect(result).toEqual({ kind: 'ignore' })
  })

  test('a relative path resolves against cwd before project filtering', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: '/work/repo/packages/app',
      tool_input: { file_path: '../../../outside.ts' },
    }, '/work/repo')
    expect(result).toEqual({ kind: 'ignore' })
  })

  // A name that merely starts with two dots is still inside the repo.
  test('a dot-dot-prefixed file name inside the working directory is recorded', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: '/work/repo',
      tool_input: { file_path: '/work/repo/..env.ts' },
    })
    expect(result).toEqual({ kind: 'edit', file: '/work/repo/..env.ts' })
  })

  // A sibling directory sharing the prefix must not pass as inside the repo.
  test('a sibling directory that shares the working directory prefix is ignored', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: '/work/repo',
      tool_input: { file_path: '/work/repo-scratch/a.ts' },
    }, '/work/repo')
    expect(result).toEqual({ kind: 'ignore' })
  })

  test('accepts Windows cwd and Git Bash project paths for an in-project edit', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: 'C:\\Users\\runner\\repo\\packages\\app',
      tool_input: { file_path: 'src\\a.ts' },
    }, '/c/Users/runner/repo')
    expect(result).toEqual({ kind: 'edit', file: 'src\\a.ts' })
  })

  test('compares mixed Windows paths case-insensitively', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: 'c:\\users\\RUNNER\\repo\\packages\\app',
      tool_input: { file_path: 'src\\a.ts' },
    }, '/C/Users/runner/repo')
    expect(result).toEqual({ kind: 'edit', file: 'src\\a.ts' })
  })

  test('ignores a relative edit on a different Windows drive', () => {
    const result = classify({
      tool_name: 'Edit',
      cwd: 'D:\\scratch\\repo',
      tool_input: { file_path: 'src\\a.ts' },
    }, '/c/Users/runner/repo')
    expect(result).toEqual({ kind: 'ignore' })
  })

  test('keeps POSIX scratch paths outside a mixed Windows project', () => {
    const result = classify({
      tool_name: 'Write',
      cwd: 'C:\\Users\\runner\\repo',
      tool_input: { file_path: '/tmp/drift_scan.py' },
    }, '/c/Users/runner/repo')
    expect(result).toEqual({ kind: 'ignore' })
  })

  test('uses the active worktree root without widening to the session cwd', () => {
    const result = classify({
      cwd: '/repo/.claude/worktrees/feature',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/changed.ts' },
    }, '/repo/.claude/worktrees/feature')
    expect(result).toEqual({ kind: 'edit', file: 'src/changed.ts' })

    expect(classify({
      cwd: '/repo/.claude/worktrees/feature',
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/scratch.ts' },
    }, '/repo/.claude/worktrees/feature')).toEqual({ kind: 'ignore' })
  })
})

describe('handlePreTool', () => {
  test('records the edited file', async () => {
    await handlePreTool(
      { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } },
      dir,
    )
    const state = await readState('s1', dir)
    expect(state.editedFiles).toEqual(['src/a.ts'])
    expect(state.lastEditSeq).not.toBeNull()
    expect(state.lastTestSeq).toBeNull()
  })

  test('ignores unrelated tools without touching state', async () => {
    await handlePreTool({ session_id: 's1', tool_name: 'Read', tool_input: {} }, dir)
    const state = await readState('s1', dir)
    expect(state.seq).toBe(0)
  })

  test('ignores a request with no session id instead of writing a broken record', async () => {
    await handlePreTool({ tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }, dir)
    expect(await readState('undefined', dir)).toMatchObject({ lastEditSeq: null })
    expect(await readState('', dir)).toMatchObject({ lastEditSeq: null })
  })

  // A hook fires before the command runs, so crediting here would count a
  // command that was denied, interrupted, or never started.
  test('does not credit a verification run before the command has executed', async () => {
    await handlePreTool(
      { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'bun test' } },
      dir,
    )
    expect((await readState('s1', dir)).lastTestSeq).toBeNull()
  })

  test('honors the active quality-gate root for worktree edits', async () => {
    const previousProjectDir = process.env.CLAUDE_PROJECT_DIR
    const previousQualityGateRoot = process.env.AGENT_QUALITY_GATE_PROJECT_DIR
    delete process.env.CLAUDE_PROJECT_DIR
    process.env.AGENT_QUALITY_GATE_PROJECT_DIR = '/repo/.claude/worktrees/feature'

    try {
      await handlePreTool(
        {
          session_id: 's1',
          cwd: '/repo/.claude/worktrees/feature',
          tool_name: 'Edit',
          tool_input: { file_path: 'src/changed.ts' },
        },
        dir,
      )
      await handlePreTool(
        {
          session_id: 's1',
          cwd: '/repo/.claude/worktrees/feature',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/scratch.ts' },
        },
        dir,
      )

      expect((await readState('s1', dir)).editedFiles).toEqual(['src/changed.ts'])
    } finally {
      if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR
      else process.env.CLAUDE_PROJECT_DIR = previousProjectDir
      if (previousQualityGateRoot === undefined) delete process.env.AGENT_QUALITY_GATE_PROJECT_DIR
      else process.env.AGENT_QUALITY_GATE_PROJECT_DIR = previousQualityGateRoot
    }
  })

  test('honors CLAUDE_PROJECT_DIR for nested cwd and NotebookEdit paths', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'agent-quality-gate-project-'))
    const nestedCwd = path.join(projectDir, 'packages', 'app')
    const previousProjectDir = process.env.CLAUDE_PROJECT_DIR
    process.env.CLAUDE_PROJECT_DIR = projectDir

    try {
      await handlePreTool(
        {
          session_id: 's1',
          cwd: nestedCwd,
          tool_name: 'Edit',
          tool_input: { file_path: '../../src/in-project.ts' },
        },
        dir,
      )
      await handlePreTool(
        {
          session_id: 's1',
          cwd: nestedCwd,
          tool_name: 'Write',
          tool_input: { file_path: '../../../outside.ts' },
        },
        dir,
      )
      await handlePreTool(
        {
          session_id: 's1',
          cwd: nestedCwd,
          tool_name: 'NotebookEdit',
          tool_input: { notebook_path: '../../notebooks/a.ipynb' },
        },
        dir,
      )

      const state = await readState('s1', dir)
      expect(state.editedFiles).toEqual(['../../src/in-project.ts', '../../notebooks/a.ipynb'])
      expect(state.editedFiles).not.toContain('../../../outside.ts')
      expect(state.lastEditSeq).not.toBeNull()
    } finally {
      if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR
      else process.env.CLAUDE_PROJECT_DIR = previousProjectDir
      await rm(projectDir, { recursive: true, force: true })
    }
  })
})
