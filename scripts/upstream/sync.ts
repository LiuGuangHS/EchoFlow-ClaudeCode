#!/usr/bin/env bun
/**
 * Upstream sync runner.
 *
 * Publishes upstream's latest release as a branch so a pull request can merge it
 * into `main`. That PR is the whole mechanism: clean merge, review and merge;
 * conflict, resolve it in the PR.
 *
 * The branch points at the upstream release commit itself. Git refuses to *commit*
 * an unresolved merge, so there is no "merge result with conflict markers" to push;
 * instead GitHub computes the merge when the PR opens and shows the conflict there.
 *
 * Modes:
 *   default          read-only. Reports the verdict, pushes nothing, changes nothing.
 *   --publish        pushes `sync/upstream-vX.Y.Z` for the PR.
 *   --prepare-local  fetches the sync branch and merges `main` into it locally,
 *                    leaving the conflict markers in the working tree to resolve.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  formatPlan,
  parseCurrentVersion,
  parseLsRemoteTags,
  parseMergeTreeConflicts,
  parseUpstreamReleases,
  planUpstreamSync,
  releaseToSync,
  syncBranchFor,
  syncPullRequestBody,
  syncPullRequestDraft,
  syncPullRequestTitle,
  type SyncState,
} from './sync-plan'

const root = path.resolve(import.meta.dir, '..', '..')

export function git(
  args: string[],
  options: { allowFailure?: boolean; cwd?: string } = {},
) {
  try {
    return {
      ok: true,
      output: execFileSync('git', args, {
        cwd: options.cwd ?? root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      }).trim(),
    }
  } catch (error) {
    // Several Git commands report a *finding* on stdout and still exit non-zero:
    // `merge-tree` prints the conflicting paths and exits 1. Throwing away stdout
    // here turned a 44-file conflict into "merges cleanly", so the captured stdout
    // is kept and the caller decides what the exit code means.
    const stdout = (error as { stdout?: Buffer | string }).stdout
    const output = (typeof stdout === 'string' ? stdout : stdout?.toString() ?? '').trim()

    if (!options.allowFailure) {
      const stderr = (error as { stderr?: Buffer | string }).stderr
      const detail = typeof stderr === 'string'
        ? stderr
        : stderr?.toString() ?? (error as Error).message
      throw new Error(`git ${args.join(' ')} failed: ${detail}`)
    }

    return { ok: false, output }
  }
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      continue
    }

    const next = argv[index + 1]

    if (next && !next.startsWith('--')) {
      args.set(arg, next)
      index += 1
    } else {
      args.set(arg, 'true')
    }
  }

  return args
}

function writeGithubOutputs(values: Record<string, string>) {
  const outputPath = process.env.GITHUB_OUTPUT

  if (!outputPath) {
    return
  }

  const lines = Object.entries(values).map(([key, value]) => {
    // A multi-line value needs the heredoc form; a bare `key=value` is truncated at
    // the first newline and every later step would read half of it.
    if (!value.includes('\n')) {
      return `${key}=${value}`
    }

    const delimiter = `__${key.toUpperCase()}__`
    return `${key}<<${delimiter}\n${value}\n${delimiter}`
  })

  appendFileSync(outputPath, `${lines.join('\n')}\n`)
}

/** Writes the verdict to a file when the runner asks for one. */
function writeReport(report: { action: string; tag: string; branch: string; lines: string[] }) {
  const reportDir = process.env.UPSTREAM_SYNC_REPORT_DIR

  if (!reportDir) {
    return
  }

  mkdirSync(reportDir, { recursive: true })
  writeFileSync(
    path.join(reportDir, 'report.md'),
    [
      `# Upstream sync: ${report.tag}`,
      '',
      `- Action: \`${report.action}\``,
      `- Branch: \`${report.branch}\``,
      '',
      ...report.lines,
      '',
    ].join('\n'),
  )
}

function currentVersion() {
  try {
    return parseCurrentVersion(readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function upstreamReleases() {
  const output = git(['ls-remote', '--tags', 'upstream', 'v*']).output
  return parseUpstreamReleases(parseLsRemoteTags(output))
}

function remoteBranchHead(branch: string) {
  const output = git(['ls-remote', '--heads', 'origin', branch]).output
  return output ? output.split(/\s+/)[0] : null
}

/**
 * Fetches into `refs/remotes/upstream-release/` rather than the tag namespace.
 * Upstream and fork release tags share names, so a normal tag fetch would clobber
 * the fork's own `vX.Y.Z` tags.
 */
function releaseRef(tag: string) {
  return `refs/remotes/upstream-release/${tag}`
}

function fetchRelease(tag: string) {
  git(['fetch', '--no-tags', 'upstream', `+refs/tags/${tag}:${releaseRef(tag)}`])

  // Upstream tags are annotated, so the ref points at a tag object. `^{commit}`
  // peels to the commit it wraps, which is what a branch should point at.
  return git(['rev-parse', `${releaseRef(tag)}^{commit}`]).output
}

/**
 * Resolves the branch the PR will target.
 *
 * The checkout is not guaranteed to have a local branch for `main`; `actions/checkout`
 * with an explicit `ref` can leave only the remote-tracking copy.
 */
function resolveBase(branch: string) {
  if (git(['rev-parse', '--verify', `refs/heads/${branch}`], { allowFailure: true }).ok) {
    return branch
  }

  if (git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], { allowFailure: true }).ok) {
    return `origin/${branch}`
  }

  throw new Error(`Cannot resolve base branch '${branch}' as a local or origin branch.`)
}

/**
 * Asks Git what the merge would produce without touching the working tree.
 *
 * `merge-tree` writes the merged tree to the object database and reports conflicts
 * on stdout, so the probe is read-only, leaves no MERGE_HEAD behind, and cannot
 * strand the checkout in a half-merged state. This is the same computation GitHub
 * performs when the PR opens.
 */
function probeMerge(base: string, target: string) {
  const result = git(['merge-tree', '--write-tree', '--name-only', base, target], {
    allowFailure: true,
  })

  if (result.ok) {
    return { conflicted: false, files: [] as string[] }
  }

  const files = parseMergeTreeConflicts(result.output)
  return { conflicted: files.length > 0, files }
}

function workingTreeIsDirty() {
  return git(['status', '--porcelain']).output.length > 0
}

/**
 * Sets up the conflicted merge locally so a maintainer can resolve it in place.
 *
 * This is the manual half of the workflow: it creates the exact state the PR
 * describes, and stops. Resolving, staging, and pushing stay with the developer,
 * which is what AGENTS.md requires.
 */
function prepareLocal(branch: string, baseBranch: string) {
  if (workingTreeIsDirty()) {
    throw new Error(
      'Working tree has uncommitted changes. Commit or stash them before preparing a local merge.',
    )
  }

  git(['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
  git(['switch', '--track', '--force-create', branch, `origin/${branch}`])

  const merge = git(['merge', '--no-commit', '--no-ff', baseBranch], { allowFailure: true })
  const unmerged = git(['diff', '--name-only', '--diff-filter=U']).output
  const files = unmerged ? unmerged.split(/\r?\n/).filter(Boolean) : []

  console.log(merge.ok
    ? `Merged ${baseBranch} into ${branch} with no conflicts; review and commit.`
    : `Conflicts while merging ${baseBranch} into ${branch}:`)

  for (const file of files) {
    console.log(`  - ${file}`)
  }

  console.log(
    '\nResolve the files, then `git add` and `git commit` yourself, then push the branch.',
  )
}

function reportSkipped(reason: string, values: Record<string, string> = {}) {
  console.log(reason)
  writeGithubOutputs({
    action: 'none',
    tag: '',
    branch: '',
    conflicts: '0',
    conflict_files: '',
    pr_title: '',
    pr_body: '',
    pr_draft: 'false',
    ...values,
  })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseBranch = args.get('--base') ?? 'main'
  const publish = args.has('--publish')
  const base = resolveBase(baseBranch)

  const releases = upstreamReleases()
  const version = currentVersion()
  const target = releaseToSync({ releases, currentVersion: version })

  if (!target) {
    const latest = releases[releases.length - 1]
    console.log(latest ? `already synced to ${latest.tag}` : 'no-op: No upstream release tag found.')
    writeGithubOutputs({
      action: latest ? 'already-synced' : 'none',
      tag: latest?.tag ?? '',
      branch: '',
      conflicts: '0',
      conflict_files: '',
      pr_title: '',
      pr_body: '',
      pr_draft: 'false',
      version: version ?? '',
    })
    return
  }

  const branch = syncBranchFor(target)

  if (args.has('--prepare-local')) {
    prepareLocal(branch, baseBranch)
    return
  }

  const commit = fetchRelease(target.tag)
  const existingHead = remoteBranchHead(branch)

  // A parked PR must not be re-pushed and re-described every day. The fork's own
  // version only moves when the sync PR merges, so the branch is what answers
  // "is this release already staged?".
  if (existingHead && git(['merge-base', '--is-ancestor', commit, existingHead], { allowFailure: true }).ok) {
    console.log(`${branch} already contains ${target.tag}; nothing to do.`)
    writeGithubOutputs({
      action: 'already-synced',
      tag: target.tag,
      branch,
      conflicts: '0',
      conflict_files: '',
      pr_title: '',
      pr_body: '',
      pr_draft: 'false',
      version: version ?? '',
    })
    return
  }

  const counts = git(['rev-list', '--left-right', '--count', `${base}...${commit}`]).output
  const [behind, ahead] = counts.split(/\s+/).map(Number)
  const probe = probeMerge(base, commit)

  const state: SyncState = {
    branch,
    behind,
    ahead,
    conflictFiles: probe.files,
  }
  const plan = planUpstreamSync({ releases, currentVersion: version, state })
  const draft = syncPullRequestDraft(plan)

  console.log(formatPlan(plan))
  console.log(`  base: ${baseBranch}, target: ${target.tag} (${commit.slice(0, 12)})`)

  if (plan.action === 'needs-conflict-resolution') {
    console.log('Conflicting files:')
    for (const file of probe.files) {
      console.log(`  - ${file}`)
    }
  }

  writeReport({
    action: plan.action,
    tag: target.tag,
    branch,
    lines: [
      `Merging \`${target.tag}\` (${commit.slice(0, 12)}) into \`${baseBranch}\`.`,
      '',
      `- Upstream commits: ${behind}`,
      `- Fork commits ahead: ${ahead}`,
      `- Conflicting files: ${probe.files.length}`,
      ...(probe.files.length > 0 ? ['', ...probe.files.map((file) => `- \`${file}\``)] : []),
    ],
  })

  if (publish) {
    // The branch is the upstream release itself, so the PR is a plain
    // `sync/upstream-vX.Y.Z -> main` and GitHub surfaces any conflict in the UI.
    if (existingHead && existingHead !== commit) {
      console.log(
        `origin/${branch} already holds different content. `
        + 'Refusing to overwrite it; merge or delete that branch first.',
      )
      writeGithubOutputs({
        action: 'branch-diverged',
        tag: target.tag,
        branch,
        conflicts: '0',
        conflict_files: '',
        pr_title: '',
        pr_body: '',
        pr_draft: 'false',
        version: version ?? '',
      })
      return
    }

    git(['push', '--force-with-lease', 'origin', `${commit}:refs/heads/${branch}`])
    console.log(`Pushed ${branch} at ${commit.slice(0, 12)}.`)
  } else {
    console.log('Probe only; pass --publish to push the sync branch.')
  }

  writeGithubOutputs({
    action: plan.action,
    version: version ?? '',
    tag: target.tag,
    branch,
    commit,
    conflicts: String(probe.files.length),
    conflict_files: probe.files.join('\n'),
    upstream_commits: String(behind),
    upstream_ahead: String(ahead),
    previous_version: version ?? '',
    pr_draft: String(draft),
    pr_title: syncPullRequestTitle(plan) ?? '',
    pr_body: syncPullRequestBody(plan) ?? '',
  })
}

// Guarded so tests can import `git` without the runner executing and pushing.
if (import.meta.main) {
  main()
}
