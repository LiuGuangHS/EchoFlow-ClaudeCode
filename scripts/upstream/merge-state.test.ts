import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
  formatMergeState,
  parseStatus,
  resolveBrandOnlyHunks,
  splitConflictHunks,
  summarizeMergeState,
  type MergeState,
  type UnmergedFile,
} from './merge-state'
import { normalizeForkBrand, parseSyncPolicy } from './sync-plan'

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

  test('a plain report still says it is read-only', () => {
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [file({ path: 'a.ts' })],
    })

    // Without a resolution run the report never touched anything, so the
    // read-only statement is the accurate one.
    expect(formatMergeState(state)).toContain('本报告只读')
  })

  test('a resolve-brand run reports the rewrite instead of claiming read-only', () => {
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [file({ path: 'a.ts' }), file({ path: 'b.ts' })],
    })

    const report = formatMergeState(state, {
      rewrittenHunks: 3,
      touchedFiles: ['a.ts', 'b.ts'],
      manualFiles: 0,
    })

    expect(report).not.toContain('本报告只读')
    expect(report).toContain('改写了 **3** 个品牌类冲突块')
    // The joined form only the touched-file line produces: `a.ts` and `b.ts`
    // also appear in the ready-to-stage list below, so asserting them bare would
    // stay green even if the listing were dropped from the report.
    expect(report).toContain('（2 个文件：`a.ts`、`b.ts`）')
    // Staging stays the maintainer's call even after the rewrite.
    expect(report).toContain('未暂存')
  })

  test('a resolve-brand run that found nothing says so rather than claiming read-only', () => {
    const state = summarizeMergeState({
      merging: 'abc123',
      unmerged: [file({ path: 'a.ts' })],
    })

    const report = formatMergeState(state, {
      rewrittenHunks: 0,
      touchedFiles: [],
      manualFiles: 1,
    })

    expect(report).not.toContain('本报告只读')
    expect(report).toContain('未发现品牌类冲突块')
    expect(report).toContain('跳过 1 个 manual 文件')
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

describe('splitConflictHunks', () => {
  test('separates conflict blocks from surrounding text', () => {
    const parts = splitConflictHunks('a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\nb\n')

    expect(parts).toHaveLength(3)
    expect(parts[1]).toMatchObject({ kind: 'conflict', ours: 'ours\n', theirs: 'theirs\n' })
  })

  test('keeps a body line of equals signs outside a conflict intact', () => {
    // A markdown rule or a diagram separator is a line of equals. Outside a real
    // <<<<<<< / >>>>>>> pair it is content, and must survive untouched.
    expect(splitConflictHunks('top\n=======\nbottom\n'))
      .toEqual([{ kind: 'text', text: 'top\n=======\nbottom\n' }])
  })

  test('returns an unterminated marker block as text rather than throwing', () => {
    // modify/delete conflicts leave a marker with no pair. A tool that cannot
    // parse a block must leave it for a human, not refuse to report anything.
    const content = 'ok\n<<<<<<< HEAD\ngone\n'
    expect(splitConflictHunks(content)).toEqual([{ kind: 'text', text: content }])
  })
})

describe('resolveBrandOnlyHunks', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [{ upstream: 'cc-haha', fork: 'echoflow' }],
    fileDecisions: {},
  }))

  test('resolves a brand-only hunk to the fork brand over upstream logic', () => {
    const result = resolveBrandOnlyHunks({
      content: 'a\n<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\nb\n',
      policy,
    })

    expect(result.content).toBe('a\nechoflow-api\nb\n')
    expect(result.resolved).toBe(1)
    expect(result.remaining).toBe(0)
  })

  test('leaves a semantic hunk marked and counts it as remaining', () => {
    const before = '<<<<<<< HEAD\nv2\n=======\nv1\n>>>>>>> x\n'
    const result = resolveBrandOnlyHunks({ content: before, policy })

    expect(result.content).toBe(before)
    expect(result.resolved).toBe(0)
    expect(result.remaining).toBe(1)
  })

  test('resolves the brand-only hunks of a mixed file and keeps the rest', () => {
    const result = resolveBrandOnlyHunks({
      content: [
        'a',
        '<<<<<<< HEAD',
        'echoflow-api',
        '=======',
        'cc-haha-api',
        '>>>>>>> x',
        'b',
        '<<<<<<< HEAD',
        'v2',
        '=======',
        'v1',
        '>>>>>>> y',
        'c',
        '',
      ].join('\n'),
      policy,
    })

    expect(result.content).toContain('echoflow-api')
    expect(result.content).not.toContain('cc-haha-api')
    expect(result.content).toContain('<<<<<<< HEAD\nv2\n=======\nv1\n>>>>>>> y')
    expect(result.resolved).toBe(1)
    expect(result.remaining).toBe(1)
  })

  test('keeps a deliberate historical token the fork side retained', () => {
    // AGENTS.md: historical names are retained for explicit compatibility, attribution,
    // migration fixtures, or supported variables. A brand-only hunk is brand-equivalent
    // on both sides, so ours already carries "fork brand over upstream logic" — and it
    // is the only side that can hold a retention. Rewriting theirs would silently drop it.
    const branding = parseSyncPolicy(JSON.stringify({
      brandTokens: [
        { upstream: 'CC_HAHA_', fork: 'ECHOFLOW_' },
        { upstream: 'cc-haha', fork: 'echoflow' },
      ],
      fileDecisions: {},
    }))
    const result = resolveBrandOnlyHunks({
      content: '<<<<<<< HEAD\nECHOFLOW_API_KEY fallback CC_HAHA_API_KEY\n=======\nCC_HAHA_API_KEY fallback CC_HAHA_API_KEY\n>>>>>>> x\n',
      policy: branding,
    })

    expect(result.content).toBe('ECHOFLOW_API_KEY fallback CC_HAHA_API_KEY\n')
    expect(result.resolved).toBe(1)
  })

  test('both normalizations agree for a brand-only hunk', () => {
    // Taking theirs and normalizing is only unambiguous because ours normalizes
    // to the same text — otherwise the hunk is not brand-only at all.
    const ours = 'echoflow-api'
    const theirs = 'cc-haha-api'
    expect(normalizeForkBrand(ours, policy)).toBe(normalizeForkBrand(theirs, policy))
  })
})

describe('--resolve-brand', () => {
  const script = path.join(import.meta.dir, 'merge-state.ts')

  /** Runs the real script and returns its raw result; `reportOn` is the JSON view. */
  function runMain(repo: string, args: string[]) {
    return spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' })
  }

  test('resolve-brand rewrites file content without staging it', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-brand-'))
    createConflict(repo, ['conflicted.ts'])
    writeFileSync(
      path.join(repo, 'conflicted.ts'),
      'a\n<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\nb\n',
    )

    const result = runMain(repo, ['--cwd', repo, '--resolve-brand'])
    // The merge is not finished: the file is resolved but still unmerged until a
    // human stages it, and the exit code keeps answering that question.
    expect(result.status).toBe(1)

    const content = readFileSync(path.join(repo, 'conflicted.ts'), 'utf8')
    expect(content).toContain('echoflow-api')
    expect(content).not.toContain('<<<<<<<')

    // The invariant that makes this safe: content is written, the index is not
    // touched. AGENTS.md reserves `git add` for the maintainer.
    const status = runGit(repo, ['status', '--porcelain'])
    expect(status.stdout).toMatch(/^UU /m)

    rmSync(repo, { recursive: true, force: true })
  })

  test('resolve-brand leaves a semantic hunk marked for a human', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-semantic-'))
    createConflict(repo, ['conflicted.ts'])
    writeFileSync(path.join(repo, 'conflicted.ts'), '<<<<<<< HEAD\nv2\n=======\nv1\n>>>>>>> x\n')

    runMain(repo, ['--cwd', repo, '--resolve-brand'])

    expect(readFileSync(path.join(repo, 'conflicted.ts'), 'utf8')).toContain('<<<<<<<')
    rmSync(repo, { recursive: true, force: true })
  })

  test('resolve-brand keeps --json output parseable', () => {
    // The summary is a diagnostic; stdout is the machine-readable document. Mixing
    // them breaks the natural "resolve, then report" invocation.
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-json-'))
    createConflict(repo, ['conflicted.ts'])
    writeFileSync(path.join(repo, 'conflicted.ts'), '<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\n')

    const result = spawnSync(
      process.execPath,
      [script, '--cwd', repo, '--resolve-brand', '--json'],
      { encoding: 'utf8' },
    )

    expect(() => JSON.parse(result.stdout)).not.toThrow()
    rmSync(repo, { recursive: true, force: true })
  })

  test('resolve-brand reports the rewritten file by name', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-report-'))
    createConflict(repo, ['conflicted.ts'])
    writeFileSync(
      path.join(repo, 'conflicted.ts'),
      '<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\n',
    )

    // Markdown mode is the human's view; it must describe what the run just did,
    // not repeat the read-only disclaimer that was true before it ran.
    const result = runMain(repo, ['--cwd', repo, '--resolve-brand'])

    expect(result.stdout).toContain('conflicted.ts')
    expect(result.stdout).not.toContain('本报告只读')
    rmSync(repo, { recursive: true, force: true })
  })

  test('resolve-brand refuses when the merge direction is inverted', () => {
    // The v0.7.4 worktree is this shape: HEAD is the upstream release commit and
    // MERGE_HEAD is the fork. Keeping "ours" there would rewrite EchoFlow back to
    // cc-haha across the tree, so the run must refuse rather than do it.
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-inverted-'))
    createConflict(repo, ['conflicted.ts'], {
      // main is HEAD ("ours") and carries the upstream brand; side is MERGE_HEAD
      // ("theirs") and carries the fork brand. base must differ from both, or
      // `git commit -a` has nothing to record on the branch.
      content: branch => (branch === 'main'
        ? 'cc-haha-api\n'
        : branch === 'side' ? 'echoflow-api\n' : 'base\n'),
    })

    const result = runMain(repo, ['--cwd', repo, '--resolve-brand'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('inverted')
    // Nothing was rewritten — the conflict is still there for a human.
    expect(readFileSync(path.join(repo, 'conflicted.ts'), 'utf8')).toContain('<<<<<<<')
    rmSync(repo, { recursive: true, force: true })
  })

  test('resolve-brand skips manual policy files entirely', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'merge-state-resolve-manual-'))
    const relative = 'src/server/config/providerPresets.json'
    mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true })
    createConflict(repo, [relative])
    const before = '<<<<<<< HEAD\nechoflow-api\n=======\ncc-haha-api\n>>>>>>> x\n'
    writeFileSync(path.join(repo, relative), before)

    runMain(repo, ['--cwd', repo, '--resolve-brand'])

    // Provider policy is adjudicated entry by entry against AGENTS.md, never by
    // a token rewrite — so the file is left byte-for-byte as it was.
    expect(readFileSync(path.join(repo, relative), 'utf8')).toBe(before)
    rmSync(repo, { recursive: true, force: true })
  })
})

