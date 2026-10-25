import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, devNull as osDevNull } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { formatConflictMap, parseCarriedDecisions } from './pr-conflict-map'

const HEAD = 'abc123def4567890'

describe('formatConflictMap', () => {
  test('reports a clean merge without a matrix', () => {
    const map = formatConflictMap({ base: 'origin/main', head: HEAD, files: [] })

    expect(map).toContain('没有冲突')
    expect(map).not.toContain('冲突矩阵模板')
  })

  test('renders one matrix row per file regardless of input order', () => {
    const map = formatConflictMap({
      base: 'origin/main',
      head: HEAD,
      files: ['desktop/src/b.ts', 'package.json'],
    })

    expect(map).toContain('共 **2** 个冲突文件')
    expect(map).toContain('| `desktop/src/b.ts` |  |  |')
    // The matrix must be stable across updates, so rows are sorted, not echoed.
    expect(map.indexOf('`desktop/src/b.ts`')).toBeLessThan(map.indexOf('| `package.json`'))
  })

  test('pre-decides brand and policy files, leaves the rest to the maintainer', () => {
    const map = formatConflictMap({
      base: 'origin/main',
      head: HEAD,
      files: ['package.json', 'src/server/config/providerPresets.json', 'src/server/other.ts'],
    })

    expect(map).toContain('| `package.json` | ours（品牌类） |  |')
    expect(map).toContain('| `src/server/config/providerPresets.json` | manual（provider 政策） |  |')
    expect(map).toContain('| `src/server/other.ts` |  |  |')
  })

  test('counts areas for orientation', () => {
    const map = formatConflictMap({
      base: 'origin/main',
      head: HEAD,
      files: ['desktop/src/a.ts', 'desktop/src/b.ts', 'docs/x.md'],
    })

    expect(map).toContain('| desktop/src | 2 |')
    expect(map).toContain('| docs | 1 |')
  })

  test('carries decisions from the previous map instead of resetting them', () => {
    // The map is re-rendered on every push; re-deciding a file the maintainer
    // already ruled on would silently roll their work back.
    const first = formatConflictMap({
      base: 'origin/main',
      head: HEAD,
      files: ['src/server/other.ts', 'src/server/third.ts'],
    })

    const filled = first
      .replace('| `src/server/other.ts` |  |  |', '| `src/server/other.ts` | theirs（吸上游修复） | `bun test` |')
      .replace('| `src/server/third.ts` |  |  |', '| `src/server/third.ts` | manual | 人工核对 |')

    const carried = parseCarriedDecisions(filled)
    expect(carried.get('src/server/other.ts')).toEqual({
      decision: 'theirs（吸上游修复）',
      command: '`bun test`',
    })

    const second = formatConflictMap({
      base: 'origin/main',
      head: HEAD,
      // The same two files plus one newly conflicted file.
      files: ['src/server/new.ts', 'src/server/other.ts', 'src/server/third.ts'],
      carried,
    })

    expect(second).toContain('| `src/server/other.ts` | theirs（吸上游修复） | `bun test` |')
    expect(second).toContain('| `src/server/third.ts` | manual | 人工核对 |')
    expect(second).toContain('| `src/server/new.ts` |  |  |')
  })

  test('ignores unresolved rows when carrying decisions forward', () => {
    const carried = parseCarriedDecisions([
      '| 文件 | 决策 | 验证命令 |',
      '| --- | --- | --- |',
      '| `a.ts` |  |  |',
      '| `b.ts` | ours | `bun run check:policy` |',
      '| `区域 | 文件数 |',
    ].join('\n'))

    expect(carried.has('a.ts')).toBe(false)
    expect(carried.get('b.ts')).toEqual({ decision: 'ours', command: '`bun run check:policy`' })
  })

  test('shortens commit ids but keeps ref names intact', () => {
    const shaMap = formatConflictMap({ base: 'origin/main', head: HEAD, files: [] })
    expect(shaMap).toContain('`abc123def456`')

    const refMap = formatConflictMap({
      base: 'origin/main',
      head: 'refs/remotes/upstream-release/v0.7.4',
      files: [],
    })
    expect(refMap).toContain('`refs/remotes/upstream-release/v0.7.4`')
  })
})

describe('conflict probe', () => {
  // A real repository, not a bare temp dir: `--base HEAD` has to resolve for the
  // probe to reach the point where it reports an unresolvable *head*. Without an
  // initialized repo the run hangs until the test times out instead.
  const repo = mkdtempSync(path.join(tmpdir(), 'echoflow-conflict-map-'))

  beforeAll(() => {
    const git = (args: string[]) => {
      const result = spawnSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: osDevNull },
      })
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
      }
    }
    git(['init', '--quiet'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'Test'])
    writeFileSync(path.join(repo, 'file.txt'), 'base\n')
    git(['add', 'file.txt'])
    git(['commit', '--quiet', '-m', 'base'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  /**
   * Runs the real script in `cwd`; returns exit code and both streams.
   *
   * The environment is stripped rather than inherited: a developer machine with a
   * global `http.proxy` makes Git resolve an unknown object id against the
   * network, and the run then hangs until the test times out instead of reporting
   * the ref it cannot resolve. `GIT_CONFIG_NOSYSTEM` and an empty
   * `GIT_CONFIG_GLOBAL` keep the probe offline and deterministic.
   */
  function runScript(args: string[], cwd: string) {
    const { http_proxy, https_proxy, HTTP_PROXY, HTTPS_PROXY, ...rest } = process.env
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dir, 'pr-conflict-map.ts'), ...args],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...rest,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: osDevNull,
        },
      },
    )

    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }

  // Spawns a real Bun process that runs real Git, so the default 5s budget is
  // tight on a loaded machine; the run itself is a couple of seconds.
  test('refuses to call an unevaluable merge clean', () => {
    // A ref Git cannot resolve exits non-zero with no conflict list, which used to
    // render as "没有冲突，可以进入评审" — a false all-clear on exactly the PRs this
    // map exists to inform.
    const missing = runScript(
      ['--base', 'HEAD', '--head', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
      repo,
    )

    expect(missing.code).not.toBe(0)
    expect(missing.stdout).not.toContain('没有冲突')
    expect(missing.stderr).toContain('not something we can merge')
  }, 30_000)

  test('never writes a map file when the merge was never evaluated', () => {
    const out = path.join(repo, 'map.md')
    const missing = runScript(
      ['--base', 'HEAD', '--head', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--out', out],
      repo,
    )

    expect(missing.code).not.toBe(0)
    // A stale map from an earlier successful run must not be left to be posted.
    expect(existsSync(out)).toBe(false)
  }, 30_000)
})
