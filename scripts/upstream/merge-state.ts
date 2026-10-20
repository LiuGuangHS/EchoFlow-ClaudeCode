#!/usr/bin/env bun
/**
 * Reports the state of an in-progress upstream merge.
 *
 * `upstream:check` and the PR conflict map both answer questions about *committed*
 * history: what would merge, and what a pushed PR still conflicts on. Neither can
 * see a merge that is half-resolved in a worktree, which is where the actual work
 * happens — a 124-file campaign sits in that state for days, and the only way to
 * know whether it is finished was `git status` plus reading files by hand.
 *
 * Read-only: it stages nothing, commits nothing, and writes nothing. It only reads
 * the index and the working tree.
 *
 * Usage:
 *   bun run scripts/upstream/merge-state.ts [--cwd <worktree>] [--json] [--out report.md]
 *
 * `--cwd` matters: a long merge usually lives in a separate worktree, and without
 * it this would silently report on the checkout the script happens to sit in.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { git } from './sync'

/** Git's unmerged stage marker in `git status --porcelain` output. */
const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/**
 * Conflict markers as Git writes them. A file can be resolved without being
 * staged, and a staged file can still contain markers if it was resolved by hand
 * and added too early — both are worth reporting, so they are checked separately.
 */
const MARKER_PATTERN = /^(<<<<<<<|=======|>>>>>>>)/m

export type UnmergedFile = {
  path: string
  status: string
  /** The file exists on disk. A delete/modify conflict leaves it absent. */
  present: boolean
  /** Conflict markers remain, so the resolution is incomplete or was staged early. */
  hasMarkers: boolean
}

export type MergeState = {
  inProgress: boolean
  /** The commit being merged in, when a merge is in progress. */
  merging: string | null
  unmerged: UnmergedFile[]
  /** Unmerged files whose content is finished but that are not staged yet. */
  readyToStage: UnmergedFile[]
  /** Unmerged files that still need work: markers remain, or the file is missing. */
  needsWork: UnmergedFile[]
}

/** Buckets a path for the area summary, matching the PR conflict map. */
export function areaOf(file: string): string {
  const segments = file.split('/')

  if (segments.length === 1) {
    return '仓库根目录'
  }

  if ((segments[0] === 'desktop' || segments[0] === 'src') && segments.length > 2) {
    return `${segments[0]}/${segments[1]}`
  }

  return segments[0]
}

/**
 * Classifies one unmerged path.
 *
 * `present` and `hasMarkers` are passed in rather than probed here so the
 * classification stays a pure function the tests can drive without a repository.
 */
export function classifyUnmerged(input: {
  path: string
  status: string
  present: boolean
  hasMarkers: boolean
}): UnmergedFile {
  return { ...input }
}

export function summarizeMergeState(input: {
  merging: string | null
  unmerged: UnmergedFile[]
}): MergeState {
  const needsWork = input.unmerged.filter(file => !file.present || file.hasMarkers)
  const readyToStage = input.unmerged.filter(file => file.present && !file.hasMarkers)

  return {
    inProgress: input.merging !== null || input.unmerged.length > 0,
    merging: input.merging,
    unmerged: input.unmerged,
    readyToStage,
    needsWork,
  }
}

export function formatMergeState(state: MergeState): string {
  if (!state.inProgress) {
    return [
      '## 合并状态',
      '',
      '当前没有进行中的合并，也没有未解决的冲突。',
      '',
    ].join('\n')
  }

  const lines: string[] = [
    '## 合并状态',
    '',
    state.merging
      ? `正在合并 \`${state.merging}\`。`
      : '存在未解决的冲突，但未找到 MERGE_HEAD。',
    '',
  ]

  if (state.unmerged.length === 0) {
    lines.push('所有冲突都已解决并暂存，可以提交这次合并。', '')
    return lines.join('\n')
  }

  lines.push(
    `未解决冲突：**${state.unmerged.length}** 个`
    + `（已改完待暂存 ${state.readyToStage.length}，仍需处理 ${state.needsWork.length}）。`,
    '',
  )

  const counts = new Map<string, number>()
  for (const file of state.unmerged) {
    const area = areaOf(file.path)
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }

  lines.push('| 区域 | 文件数 |', '| --- | --- |')
  for (const [area, count] of [...counts.entries()].sort(
    ([areaA, countA], [areaB, countB]) => countB - countA || areaA.localeCompare(areaB),
  )) {
    lines.push(`| ${area} | ${count} |`)
  }

  if (state.needsWork.length > 0) {
    lines.push(
      '',
      '<details><summary>仍需处理的文件</summary>',
      '',
      ...state.needsWork
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(file => `- \`${file.path}\`${file.present ? '（仍有冲突标记）' : '（文件缺失）'}`),
      '',
      '</details>',
    )
  }

  if (state.readyToStage.length > 0) {
    lines.push(
      '',
      '<details><summary>已改完、待暂存的文件</summary>',
      '',
      ...state.readyToStage
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(file => `- \`${file.path}\``),
      '',
      '</details>',
    )
  }

  lines.push(
    '',
    '本报告只读：不暂存、不提交。`git add` 与 `git commit` 仍按 `AGENTS.md`'
    + '「Upstream Sync Direction」由维护者逐文件确认后执行。',
    '',
  )

  return lines.join('\n')
}

/**
 * Splits `git status --porcelain` output into status codes and paths.
 *
 * `-z` output is NUL-separated and cannot be split on newlines, because a path
 * may contain one. It also separates a rename into two consecutive records (old
 * then new) instead of joining them with ` -> `. The line format is still
 * accepted so the parse keeps working if `-z` is unavailable.
 */
export function parseStatus(output: string): { status: string; path: string }[] {
  const entries: { status: string; path: string }[] = []

  if (output.includes('\0')) {
    const records = output.split('\0').filter(Boolean)
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      const status = record.slice(0, 2)
      const file = record.slice(3)

      // A rename is "XY <old>\0XY <new>"; the new path is what exists on disk.
      if (status[0] === 'R' || status[1] === 'R') {
        const next = records[index + 1]
        if (next) {
          index += 1
          entries.push({ status, path: next.slice(3) })
          continue
        }
      }

      entries.push({ status, path: file })
    }

    return entries
  }

  for (const line of output.split(/\r?\n/)) {
    const status = line.slice(0, 2)
    if (!status.trim()) {
      continue
    }

    const raw = line.slice(3)
    entries.push({
      status,
      path: raw.includes(' -> ') ? raw.split(' -> ')[1] : raw,
    })
  }

  return entries
}

/** Reads the real repository. Kept out of the pure functions so tests can skip it. */
export function readMergeState(root: string): MergeState {
  // A path that is not a checkout must fail with the path named, not with Git's
  // stack trace: `--cwd` is easy to point one level off.
  if (!existsSync(root)) {
    throw new Error(`No such directory: ${root}`)
  }

  let status: string
  try {
    // `-z` keeps path names literal: without it Git quotes unusual names, which
    // would both mangle `path.join` and misreport the file as missing.
    status = git(['status', '--porcelain', '-z'], { cwd: root }).output
    if (!status.includes('\0')) {
      // Guard against a Git that silently ignores `-z`: fall back to the line
      // format rather than read a NUL-separated stream that never arrived.
      status = git(['status', '--porcelain'], { cwd: root }).output
    }
  } catch {
    throw new Error(`Not a git checkout: ${root}`)
  }

  const mergeHead = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
    cwd: root,
    allowFailure: true,
  })
  const unmerged: UnmergedFile[] = []
  // Every reported path, not just the unmerged ones, so a candidate recovered
  // from resolve-undo can carry the status Git actually shows instead of a guess.
  const statusByPath = new Map<string, string>()

  for (const { status: statusCode, path: file } of parseStatus(status)) {
    statusByPath.set(file, statusCode)

    if (!UNMERGED.has(statusCode)) {
      continue
    }

    const absolute = path.join(root, file)
    const present = existsSync(absolute)

    unmerged.push(classifyUnmerged({
      path: file,
      status: statusCode,
      present,
      hasMarkers: present && MARKER_PATTERN.test(readFileSync(absolute, 'utf8')),
    }))
  }

  if (mergeHead.ok) {
    // `git add` clears a path from the unmerged index, even when the staged blob
    // still contains conflict markers. The resolve-undo index extension retains
    // the pre-resolution stages, giving us a Git-owned candidate list without
    // mistaking ordinary changed files that happen to contain marker-like text
    // for unresolved conflicts.
    const resolveUndo = git(['ls-files', '--resolve-undo', '-z'], { cwd: root }).output
    const resolveUndoPaths = new Set(
      resolveUndo
        .split('\0')
        .filter(Boolean)
        .flatMap(record => {
          const separator = record.indexOf('\t')
          return separator >= 0 ? [record.slice(separator + 1)] : []
        }),
    )

    // Read the index once rather than querying each path with a pathspec. Besides
    // avoiding one Git process per candidate, this keeps unusual path names
    // literal and lets `git()` apply its 64 MiB output limit to blob reads.
    const staged = git(['ls-files', '--stage', '-z'], { cwd: root }).output
    const stageZeroByPath = new Map<string, string>()
    for (const record of staged.split('\0').filter(Boolean)) {
      const separator = record.indexOf('\t')
      if (separator < 0) {
        continue
      }

      const metadata = record.slice(0, separator).split(' ')
      if (metadata[2] === '0' && metadata[1]) {
        stageZeroByPath.set(record.slice(separator + 1), metadata[1])
      }
    }

    for (const file of resolveUndoPaths) {
      if (unmerged.some(entry => entry.path === file)) {
        continue
      }

      const stageZero = stageZeroByPath.get(file)
      if (!stageZero) {
        continue
      }

      const content = git(['cat-file', 'blob', stageZero], { cwd: root }).output
      if (!MARKER_PATTERN.test(content)) {
        continue
      }

      // The staged blob is authoritative: it is what a merge commit would record.
      // `present` still reports the worktree, because that is what a maintainer
      // editing the file sees, and a missing file is itself work to do.
      unmerged.push(classifyUnmerged({
        path: file,
        status: statusByPath.get(file) ?? 'M ',
        present: existsSync(path.join(root, file)),
        hasMarkers: true,
      }))
    }
  }

  return summarizeMergeState({
    merging: mergeHead.ok ? mergeHead.output : null,
    unmerged,
  })
}

function main() {
  const argv = process.argv.slice(2)
  const cwdIndex = argv.indexOf('--cwd')
  const root = cwdIndex >= 0 && argv[cwdIndex + 1]
    ? path.resolve(argv[cwdIndex + 1])
    : path.resolve(import.meta.dir, '..', '..')

  const state = readMergeState(root)
  if (state.unmerged.length > 0) {
    process.exitCode = 1
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(state, null, 2))
    return
  }

  const markdown = formatMergeState(state)
  const outIndex = argv.indexOf('--out')
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined

  if (out) {
    writeFileSync(out, markdown)
    console.log(`Wrote ${out}.`)
  } else {
    console.log(markdown)
  }

}

// Guarded so tests can import the pure helpers without touching a repository.
if (import.meta.main) {
  main()
}
