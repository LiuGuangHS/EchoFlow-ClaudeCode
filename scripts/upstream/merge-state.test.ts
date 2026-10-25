import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
  formatMergeState,
  parseStatus,
  summarizeMergeState,
  type MergeState,
  type UnmergedFile,
} from './merge-state'

const file = (overrides: Partial<UnmergedFile> & { path: string }): UnmergedFile => ({
  status: 'UU',
  present: true,
  hasMarkers: false,
  ...overrides,
})

/**
 * Builds a checkout whose `git merge side` conflicts on every named file: a base
 * commit, then `side` and `main` each editing all of them. `content` decides what
 * each branch writes, so a test can ask for content that stresses the reader.
 */
function createConflict(
  repo: string,
  files: string[],
  options: { content?: (branch: string) => string; env?: NodeJS.ProcessEnv } = {},
): void {
  const content = options.content ?? (branch => `${branch}\n`)
  const runGit = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: options.env })
    expect(result.status).toBe(0)
  }

  runGit(['init', '-q'])
  runGit(['config', 'user.email', 'test@example.com'])
  runGit(['config', 'user.name', 'Test'])
  for (const name of files) {
    writeFileSync(path.join(repo, name), content('base'))
  }
  runGit(['add', '--', ...files])
  runGit(['commit', '-qm', 'base'])

  runGit(['checkout', '-qb', 'side'])
  for (const name of files) {
    writeFileSync(path.join(repo, name), content('side'))
  }
  runGit(['commit', '-qam', 'side'])

  runGit(['checkout', '-q', 'HEAD~1'])
  runGit(['checkout', '-qb', 'main'])
  for (const name of files) {
    writeFileSync(path.join(repo, name), content('main'))
  }
  runGit(['commit', '-qam', 'main'])

  const merge = spawnSync('git', ['merge', 'side'], {
    cwd: repo,
    encoding: 'utf8',
    env: options.env,
  })
  expect(merge.status).not.toBe(0)
}

/** Runs one Git command in a fixture checkout, failing the test on a bad exit. */
function runGit(repo: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env })
  expect(result.status).toBe(0)
  return result
}

/** Runs the real script against a checkout and parses its JSON report. */
function reportOn(repo: string): { status: number | null; state: MergeState } {
  const script = path.join(import.meta.dir, 'merge-state.ts')
  const result = spawnSync(process.execPath, [script, '--json', '--cwd', repo], {
    encoding: 'utf8',
  })

  return { status: result.status, state: JSON.parse(result.stdout) as MergeState }
}

const pathsOf = (files: { path: string }[]): string[] => files.map(file => file.path)

describe('parseStatus', () => {
  test('reads NUL-separated entries, including paths that look like pathspec magic', () => {
    // `git status --porcelain -z` keeps names literal, so a file called
    // `:(weird).txt` reaches us intact. Passing such a name back to Git as a
    // pathspec would fail with "Invalid pathspec magic" — one reason the reader
    // queries the whole index instead of one path at a time.
    const parsed = parseStatus('UU :(weird).txt\0M  plain.txt\0')

    expect(parsed).toEqual([
      { status: 'UU', path: ':(weird).txt' },
      { status: 'M ', path: 'plain.txt' },
    ])
  })

  test('resolves a NUL-separated rename to the path that exists on disk', () => {
    const parsed = parseStatus('R  old.txt\0R  new.txt\0')

    expect(parsed).toEqual([{ status: 'R ', path: 'new.txt' }])
  })

  test('a path containing a newline is not split into two entries', () => {
    const parsed = parseStatus('UU a\nb.txt\0')

    expect(parsed).toEqual([{ status: 'UU', path: 'a\nb.txt' }])
  })

  test('falls back to the line format when no NUL separator is present', () => {
    const parsed = parseStatus('UU file.txt\nR  old.txt -> new.txt\n')

    expect(parsed).toEqual([
      { status: 'UU', path: 'file.txt' },
      { status: 'R ', path: 'new.txt' },
    ])
  })
})

describe('summarizeMergeState', () => {
  test('treats a resolved-but-unstaged file as ready, not as work', () => {
    // This is the state a long campaign actually ends in: the content is finished
    // but `git add` has not run. Reporting it as "needs work" would send the
    // maintainer back through files they already resolved.
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [file({ path: 'a.ts' }), file({ path: 'b.ts', hasMarkers: true })],
    })

    expect(state.readyToStage.map(f => f.path)).toEqual(['a.ts'])
    expect(state.needsWork.map(f => f.path)).toEqual(['b.ts'])
  })

  test('counts a missing file as work even without markers', () => {
    // A delete/modify conflict leaves no file to scan, so "no markers" must not
    // be read as "resolved".
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [file({ path: 'gone.ts', present: false })],
    })

    expect(state.needsWork.map(f => f.path)).toEqual(['gone.ts'])
    expect(state.readyToStage).toEqual([])
  })

  test('reports no merge in progress when nothing is unmerged', () => {
    const state = summarizeMergeState({ merging: null, unmerged: [] })

    expect(state.inProgress).toBe(false)
    expect(formatMergeState(state)).toContain('当前没有进行中的合并')
  })
})

describe('formatMergeState', () => {
  test('says the merge can be committed once every file is staged-ready', () => {
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [file({ path: 'a.ts' }), file({ path: 'b.ts' })],
    })
    const report = formatMergeState(state)

    expect(report).toContain('未解决冲突：**2** 个')
    expect(report).toContain('已改完待暂存 2，仍需处理 0')
    expect(report).toContain('不暂存、不提交')
  })

  test('returns a non-zero exit code for unresolved conflicts in JSON mode', () => {
    const script = path.join(import.meta.dir, 'merge-state.ts')
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-json-conflict-'))

    try {
      const runGit = (args: string[]) => {
        const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
        expect(result.status).toBe(0)
      }

      runGit(['init', '-q'])
      runGit(['config', 'user.email', 'test@example.com'])
      runGit(['config', 'user.name', 'Test'])
      writeFileSync(path.join(repo, 'file.txt'), 'base\\n')
      runGit(['add', 'file.txt'])
      runGit(['commit', '-qm', 'base'])
      runGit(['checkout', '-qb', 'side'])
      writeFileSync(path.join(repo, 'file.txt'), 'side\\n')
      runGit(['commit', '-qam', 'side'])
      runGit(['checkout', '-q', 'HEAD~1'])
      runGit(['checkout', '-qb', 'main'])
      writeFileSync(path.join(repo, 'file.txt'), 'main\\n')
      runGit(['commit', '-qam', 'main'])
      const merge = spawnSync('git', ['merge', 'side'], { cwd: repo, encoding: 'utf8' })
      expect(merge.status).not.toBe(0)

      const report = spawnSync(process.execPath, [script, '--json', '--cwd', repo], {
        encoding: 'utf8',
      })

      expect(report.status).toBe(1)
      expect(JSON.parse(report.stdout).unmerged).toHaveLength(1)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('does not treat a staged file with conflict markers as resolved', () => {
    const script = path.join(import.meta.dir, 'merge-state.ts')
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-staged-markers-'))

    try {
      const runGit = (args: string[]) => {
        const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
        expect(result.status).toBe(0)
      }

      runGit(['init', '-q'])
      runGit(['config', 'user.email', 'test@example.com'])
      runGit(['config', 'user.name', 'Test'])
      writeFileSync(path.join(repo, 'file.txt'), 'base\\n')
      runGit(['add', 'file.txt'])
      runGit(['commit', '-qm', 'base'])
      runGit(['checkout', '-qb', 'side'])
      writeFileSync(path.join(repo, 'file.txt'), 'side\\n')
      runGit(['commit', '-qam', 'side'])
      runGit(['checkout', '-q', 'HEAD~1'])
      runGit(['checkout', '-qb', 'main'])
      writeFileSync(path.join(repo, 'file.txt'), 'main\\n')
      runGit(['commit', '-qam', 'main'])
      const merge = spawnSync('git', ['merge', 'side'], { cwd: repo, encoding: 'utf8' })
      expect(merge.status).not.toBe(0)

      // Simulate an early add: Git clears the unmerged index stages even though
      // the conflict markers remain in the staged blob and on disk.
      runGit(['add', 'file.txt'])
      const report = spawnSync(process.execPath, [script, '--json', '--cwd', repo], {
        encoding: 'utf8',
      })
      const state = JSON.parse(report.stdout)

      expect(report.status).toBe(1)
      expect(state.unmerged).toEqual([
        expect.objectContaining({
          path: 'file.txt',
          status: 'M ',
          hasMarkers: true,
        }),
      ])
      expect(state.needsWork).toHaveLength(1)
      expect(state.readyToStage).toHaveLength(0)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('keeps a staged conflict with remaining markers in the unresolved report', () => {
    const script = path.join(import.meta.dir, 'merge-state.ts')
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-staged-conflict-'))

    try {
      const runGit = (args: string[]) => {
        const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
        expect(result.status).toBe(0)
      }

      runGit(['init', '-q'])
      runGit(['config', 'user.email', 'test@example.com'])
      runGit(['config', 'user.name', 'Test'])
      writeFileSync(path.join(repo, 'conflict.txt'), 'base\\n')
      writeFileSync(path.join(repo, 'ordinary.txt'), 'base\\n')
      runGit(['add', '.'])
      runGit(['commit', '-qm', 'base'])
      runGit(['checkout', '-qb', 'side'])
      writeFileSync(path.join(repo, 'conflict.txt'), 'side\\n')
      runGit(['commit', '-qam', 'side'])
      runGit(['checkout', '-q', 'HEAD~1'])
      runGit(['checkout', '-qb', 'main'])
      writeFileSync(path.join(repo, 'conflict.txt'), 'main\\n')
      runGit(['commit', '-qam', 'main'])

      const merge = spawnSync('git', ['merge', 'side'], { cwd: repo, encoding: 'utf8' })
      expect(merge.status).not.toBe(0)

      writeFileSync(path.join(repo, 'ordinary.txt'), '<<<<<<< this is ordinary text\\n')
      runGit(['add', 'conflict.txt', 'ordinary.txt'])

      const report = spawnSync(process.execPath, [script, '--json', '--cwd', repo], {
        encoding: 'utf8',
      })
      const state = JSON.parse(report.stdout)

      expect(report.status).toBe(1)
      expect(state.unmerged.map((file: { path: string }) => file.path)).toEqual(['conflict.txt'])
      expect(state.needsWork.map((file: { path: string }) => file.path)).toEqual(['conflict.txt'])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('stays silent once a conflict is genuinely resolved and staged', () => {
    // The false-all-clear bug is only worth fixing if the fix does not swallow
    // the opposite signal: a real resolution must still let the merge commit.
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-clean-staged-'))

    try {
      createConflict(repo, ['file.txt'])
      writeFileSync(path.join(repo, 'file.txt'), 'resolved\n')
      expect(runGit(repo, ['add', 'file.txt']).status).toBe(0)

      const { status, state } = reportOn(repo)

      expect(status).toBe(0)
      expect(state.unmerged).toEqual([])
      expect(state.inProgress).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('reads the staged blob, not the worktree, when they disagree', () => {
    // Staging markers and then fixing the file on disk without re-adding is the
    // dangerous case: the worktree looks clean but a commit would record the
    // markers. The blob is what matters, so it must still be reported.
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-stale-worktree-'))

    try {
      createConflict(repo, ['file.txt'])
      expect(runGit(repo, ['add', 'file.txt']).status).toBe(0)
      writeFileSync(path.join(repo, 'file.txt'), 'fixed on disk, not re-added\n')

      const { status, state } = reportOn(repo)

      expect(status).toBe(1)
      expect(pathsOf(state.unmerged)).toEqual(['file.txt'])
      expect(state.unmerged[0].hasMarkers).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('survives a staged conflict blob larger than the default child buffer', () => {
    // Node's default maxBuffer is ~1 MiB. A generated lockfile or snapshot can
    // exceed that, and a crash there would take down the whole report rather
    // than misreport one file — so the reader must not use the default.
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-large-blob-'))
    const padding = 'x'.repeat(1024)

    try {
      createConflict(repo, ['big.txt'], {
        content: branch => `${branch}\n${padding.repeat(1100)}\n`,
      })
      expect(runGit(repo, ['add', 'big.txt']).status).toBe(0)

      const { status, state } = reportOn(repo)

      expect(status).toBe(1)
      expect(pathsOf(state.unmerged)).toEqual(['big.txt'])
      expect(state.unmerged[0].hasMarkers).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('reports a conflicted file whose name looks like pathspec magic', () => {
    // Names beginning with `:(` are pathspec magic to Git, and a per-path query
    // would fail on them. The reader scans the whole index, so such a name is
    // just a name. GIT_LITERAL_PATHSPECS only lets the test build the fixture.
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-odd-path-'))
    const env = { ...process.env, GIT_LITERAL_PATHSPECS: '1' }

    try {
      createConflict(repo, [':(weird).txt'], { env })
      expect(runGit(repo, ['add', '--', ':(weird).txt'], env).status).toBe(0)

      const { status, state } = reportOn(repo)

      expect(status).toBe(1)
      expect(pathsOf(state.unmerged)).toEqual([':(weird).txt'])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('reports on the worktree named by --cwd, not the checkout it runs from', () => {
    // The merge under inspection usually lives in a separate worktree. Resolving
    // the root from the script's own location made this report "no merge in
    // progress" while 115 files were in fact unresolved — a silent all-clear.
    const script = path.join(import.meta.dir, 'merge-state.ts')
    const repoRoot = path.join(import.meta.dir, '..', '..')
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'merge-state-cwd-'))

    try {
      const report = spawnSync(
        process.execPath,
        [script, '--json', '--cwd', elsewhere],
        { encoding: 'utf8' },
      )

      // A directory that is not a checkout must be rejected by name, never
      // silently reported as "no merge in progress".
      expect(report.status).not.toBe(0)
      expect(report.stderr).toContain(`Not a git checkout: ${elsewhere}`)

      const own = spawnSync(process.execPath, [script, '--json', '--cwd', repoRoot], {
        encoding: 'utf8',
      })
      expect(() => JSON.parse(own.stdout)).not.toThrow()
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  test('lists remaining work and groups areas for orientation', () => {
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [
        file({ path: 'desktop/src/a.ts', hasMarkers: true }),
        file({ path: 'desktop/src/b.ts', hasMarkers: true }),
        file({ path: 'docs/x.md' }),
      ],
    })
    const report = formatMergeState(state)

    expect(report).toContain('| desktop/src | 2 |')
    expect(report).toContain('| docs | 1 |')
    expect(report).toContain('`desktop/src/a.ts`（仍有冲突标记）')
  })
})
