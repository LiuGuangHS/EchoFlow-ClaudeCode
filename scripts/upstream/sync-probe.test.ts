import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { git } from './sync'
import { parseMergeTreeConflicts } from './sync-plan'

/**
 * Regression coverage for the bug that made the sync runner lie.
 *
 * `git merge-tree --write-tree` prints the conflicting paths to *stdout* and exits
 * 1. The helper used to discard stdout whenever the exit code was non-zero, so a
 * 44-file conflict came back as an empty list and the plan reported "merges
 * cleanly". These tests pin the capture behaviour against a real repository, since
 * the failure only exists at the boundary between Git's exit code and our parsing.
 */

let repo: string
let baseSha: string

function run(args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function write(file: string, contents: string) {
  writeFileSync(path.join(repo, file), contents)
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'upstream-sync-probe-'))
  run(['init', '--initial-branch=main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  run(['config', 'commit.gpgsign', 'false'])

  // Shared base.
  write('conflict.txt', 'base\n')
  write('clean.txt', 'base\n')
  run(['add', '.'])
  run(['commit', '-m', 'base'])
  baseSha = run(['rev-parse', 'HEAD']).trim()
  run(['branch', 'upstream-release'])

  // The fork edits one line; upstream edits the same line differently.
  write('conflict.txt', 'fork\n')
  write('fork-only.txt', 'fork\n')
  run(['add', '.'])
  run(['commit', '-m', 'fork change'])

  run(['switch', 'upstream-release'])
  write('conflict.txt', 'upstream\n')
  write('upstream-only.txt', 'upstream\n')
  run(['add', '.'])
  run(['commit', '-m', 'upstream change'])
  run(['switch', 'main'])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('git helper', () => {
  test('keeps stdout when a command fails', () => {
    // The core of the bug: a non-zero exit must not erase what Git printed.
    const result = git(['merge-tree', '--write-tree', '--name-only', 'main', 'upstream-release'], {
      allowFailure: true,
      cwd: repo,
    })

    expect(result.ok).toBe(false)
    expect(parseMergeTreeConflicts(result.output)).toEqual(['conflict.txt'])
  })

  test('reports success and empty output for a clean merge', () => {
    // Branch from the shared base so the only edit is to a file upstream never
    // touches; this pair genuinely merges, unlike main (which shares conflict.txt).
    run(['switch', '-c', 'clean-line', baseSha])
    write('clean.txt', 'clean-line\n')
    run(['commit', '-am', 'clean line'])

    const merged = git(
      ['merge-tree', '--write-tree', '--name-only', 'clean-line', 'upstream-release'],
      { allowFailure: true, cwd: repo },
    )

    expect(merged.ok).toBe(true)
    expect(parseMergeTreeConflicts(merged.output)).toEqual([])
  })

  test('throws for a failing command unless allowFailure is set', () => {
    // Without the opt-in the caller wants a loud failure, not a silent empty string
    // that later reads as "nothing to see here".
    expect(() => git(['rev-parse', '--verify', 'refs/heads/does-not-exist'], { cwd: repo }))
      .toThrow()
  })
})
