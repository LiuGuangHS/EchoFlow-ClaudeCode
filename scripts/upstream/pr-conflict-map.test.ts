import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'

import { areaOf, formatConflictMap, parseCarriedDecisions } from './pr-conflict-map'

const HEAD = 'abc123def4567890'

describe('areaOf', () => {
  test('buckets root-level files on their own', () => {
    expect(areaOf('package.json')).toBe('仓库根目录')
  })

  test('splits the two big trees by second segment', () => {
    // desktop/ and src/ each hold more conflict files than every other area
    // combined, so a top-level bucket would say nothing a maintainer can act on.
    expect(areaOf('desktop/src/stores/chatStore.ts')).toBe('desktop/src')
    expect(areaOf('src/server/services/localIndex/search.ts')).toBe('src/server')
  })

  test('keeps shallower trees whole', () => {
    expect(areaOf('docs/internals/contributing.md')).toBe('docs')
    expect(areaOf('desktop/package.json')).toBe('desktop')
  })
})

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
  const repo = mkdtempSync(path.join(tmpdir(), 'echoflow-conflict-map-'))

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  /** Runs the real script in `cwd`; returns exit code and both streams. */
  function runScript(args: string[], cwd: string) {
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dir, 'pr-conflict-map.ts'), ...args],
      { cwd, encoding: 'utf8' },
    )

    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }

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
  })

  test('never writes a map file when the merge was never evaluated', () => {
    const out = path.join(repo, 'map.md')
    const missing = runScript(
      ['--base', 'HEAD', '--head', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--out', out],
      repo,
    )

    expect(missing.code).not.toBe(0)
    // A stale map from an earlier successful run must not be left to be posted.
    expect(existsSync(out)).toBe(false)
  })
})
