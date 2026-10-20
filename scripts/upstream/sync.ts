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
 *   --prepare-local  merges `main` into the sync branch locally, leaving the
 *                    conflict markers in the working tree to resolve. Creates the
 *                    branch from the release commit when origin does not have it
 *                    yet. `--force` is required to move a local branch that
 *                    already points somewhere else.
 *   --strict         exit 1 when the merge conflicts. Default: always exit 0.
 *   --base <branch>  branch the sync merges into. Default: main.
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

/** Network round-trips must not hang a run forever. */
const NETWORK_TIMEOUT_MS = 120_000

/**
 * Fails with the fix rather than Git's wording.
 *
 * `ls-remote` against a remote that was never added reports "does not appear to
 * be a git repository", which reads like a URL problem and sends people off to
 * check credentials instead of running `git remote add`.
 */
function requireRemote(name: string) {
  const remotes = git(['remote']).output.split(/\r?\n/).filter(Boolean)

  if (!remotes.includes(name)) {
    throw new Error(
      `No git remote named '${name}'. Add it first: git remote add ${name} <url>`,
    )
  }
}

export function git(
  args: string[],
  options: { allowFailure?: boolean; cwd?: string; timeout?: number } = {},
) {
  try {
    return {
      ok: true,
      output: execFileSync('git', args, {
        cwd: options.cwd ?? root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeout,
      }).trim(),
      stderr: '',
    }
  } catch (error) {
    // Several Git commands report a *finding* on stdout and still exit non-zero:
    // `merge-tree` prints the conflicting paths and exits 1. Throwing away stdout
    // here turned a 44-file conflict into "merges cleanly", so the captured stdout
    // is kept and the caller decides what the exit code means.
    const stdout = (error as { stdout?: Buffer | string }).stdout
    const output = (typeof stdout === 'string' ? stdout : stdout?.toString() ?? '').trim()
    const capturedStderr = (error as { stderr?: Buffer | string }).stderr
    const stderr = typeof capturedStderr === 'string'
      ? capturedStderr
      : capturedStderr?.toString() ?? (error as Error).message

    if (!options.allowFailure) {
      throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
    }

    // stderr travels with the failure because an empty stdout plus a non-zero exit
    // is ambiguous on its own: it means either "no conflicts" or "git could not
    // merge these at all", and only stderr tells the two apart.
    return { ok: false, output, stderr: stderr.trim() }
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
  // Defaults to a gitignored local path so a manual probe leaves evidence behind;
  // CI overrides it with the runner temp dir.
  const reportDir = process.env.UPSTREAM_SYNC_REPORT_DIR
    ?? path.join(root, 'artifacts', 'upstream-sync')

  mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, 'report.md')
  writeFileSync(
    reportPath,
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

  console.log(`\nReport: ${reportPath}`)
}

function currentVersion() {
  try {
    return parseCurrentVersion(readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function upstreamReleases() {
  const output = git(['ls-remote', '--tags', 'upstream', 'v*'], {
    timeout: NETWORK_TIMEOUT_MS,
  }).output
  return parseUpstreamReleases(parseLsRemoteTags(output))
}

function remoteBranchHead(branch: string) {
  const output = git(['ls-remote', '--heads', 'origin', branch], {
    timeout: NETWORK_TIMEOUT_MS,
  }).output
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
  // `--no-filter` overrides the `blob:none` partial-clone filter configured on the
  // upstream remote. `merge-tree` below needs blob contents to merge them, and
  // lazy-fetching one blob per changed file is both slow and fragile: when the
  // promisor remote cannot be reached mid-run the probe fails outright.
  git(
    ['fetch', '--no-tags', '--no-filter', 'upstream', `+refs/tags/${tag}:${releaseRef(tag)}`],
    { timeout: NETWORK_TIMEOUT_MS },
  )

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

  // Non-zero with no conflict list means Git never evaluated the merge (unresolvable
  // ref, unrelated histories, a missing object). Reporting that as zero conflicts
  // would publish a clean-merge verdict the probe never actually produced.
  if (files.length === 0) {
    throw new Error(
      `Could not evaluate the merge between \`${base}\` and \`${target}\`: `
      + `${result.stderr || 'git merge-tree exited non-zero without reporting conflicts'}`,
    )
  }

  return { conflicted: true, files }
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
function prepareLocal(input: {
  branch: string
  base: string
  commit: string
  force: boolean
}) {
  const { branch, base, commit, force } = input

  if (workingTreeIsDirty()) {
    throw new Error(
      'Working tree has uncommitted changes. Commit or stash them before preparing a local merge.',
    )
  }

  // `git switch --force-create` moves the ref, so anything committed here but not
  // pushed stops being reachable from it. `workingTreeIsDirty` above covers the
  // working tree, not the branch, and this is the branch-destroying half.
  const localHead = git(['rev-parse', '--verify', `refs/heads/${branch}`], {
    allowFailure: true,
  })

  if (localHead.ok && localHead.output !== commit) {
    if (!force) {
      throw new Error(
        `Local branch '${branch}' is at ${localHead.output.slice(0, 12)}, not the release `
        + `commit ${commit.slice(0, 12)}. Preparing the merge would move that ref.\n\n`
        + `Save it first, then re-run:\n`
        + `  git branch -f ${branch}-saved ${localHead.output.slice(0, 12)}\n\n`
        + `Or push the resolution you already have (bun run upstream:sync), or pass --force `
        + `to accept losing it. Recovery afterwards is best-effort via `
        + `git reflog ${branch}.`,
      )
    }

    console.log(
      `Moving ${branch} from ${localHead.output.slice(0, 12)} to ${commit.slice(0, 12)} (--force).`,
    )
  }

  // The sync branch only exists on origin once `--publish` has run, and the
  // documented order used to put this step first — which made a fresh release
  // fail with "couldn't find remote ref". Fall back to the release commit that
  // `fetchRelease` already fetched, and say which path was taken so the
  // maintainer knows whether the branch has an upstream yet.
  const onOrigin = git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], {
    allowFailure: true,
  }).ok

  if (onOrigin) {
    git(['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], {
      timeout: NETWORK_TIMEOUT_MS,
    })
    git(['switch', '--track', '--force-create', branch, `origin/${branch}`])
  } else {
    console.log(
      `origin/${branch} does not exist yet; creating ${branch} locally at `
      + `${commit.slice(0, 12)}. Run \`bun run upstream:sync\` to publish it before opening the PR.`,
    )
    // No --track: there is nothing to track until the branch is pushed.
    git(['switch', '--force-create', branch, commit])
  }

  const merge = git(['merge', '--no-commit', '--no-ff', base], { allowFailure: true })
  const unmerged = git(['diff', '--name-only', '--diff-filter=U']).output
  const files = unmerged ? unmerged.split(/\r?\n/).filter(Boolean) : []

  console.log(merge.ok
    ? `Merged ${base} into ${branch} with no conflicts; review and commit.`
    : `Conflicts while merging ${base} into ${branch}:`)

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
  const strict = args.has('--strict')
  const base = resolveBase(baseBranch)

  requireRemote('upstream')

  // Both `--publish` and `--prepare-local` eventually talk to origin, and the
  // check has to run before either: `git fetch origin` reports a missing remote
  // as "does not appear to be a git repository", which reads like a URL problem
  // and sends people off to check credentials.
  if (publish || args.has('--prepare-local')) {
    requireRemote('origin')
  }

  const releases = upstreamReleases()
  const version = currentVersion()

  // "Is this release already synced?" is a question about the base branch, not
  // about the sync branch. A parked sync branch can hold the release commit while
  // the base branch never merged it, and answering from the branch made the probe
  // report "already synced" forever for a release that was still outstanding.
  const isMerged = (commit: string) =>
    git(['merge-base', '--is-ancestor', commit, base], { allowFailure: true }).ok
  const target = releaseToSync({ releases, currentVersion: version, isMerged })

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

  // Fetch before branching off to --prepare-local: that path needs the release
  // objects local to build the branch from, and it used to run before this line,
  // which left it fetching nothing and then demanding a branch origin never had.
  const commit = fetchRelease(target.tag)

  if (args.has('--prepare-local')) {
    prepareLocal({ branch, base, commit, force: args.has('--force') })
    return
  }

  // The ancestry test above runs before the fetch, so a release whose objects are
  // not local yet reads as "not merged". Ask again now that they are.
  if (isMerged(commit)) {
    console.log(`${baseBranch} already contains ${target.tag}; nothing to do.`)
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

  const existingHead = remoteBranchHead(branch)

  // A parked branch is not evidence of a merge; it only constrains --publish.
  // Probing anyway is the point: the release can sit unmerged in a branch for
  // months while the base branch stays behind.
  if (existingHead && existingHead !== commit) {
    console.log(
      `origin/${branch} already holds different content (${existingHead.slice(0, 12)}). `
      + 'The merge is still proposed; --publish will refuse to overwrite that branch.',
    )
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
  const plan = planUpstreamSync({ releases, currentVersion: version, state, isMerged })
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
      '',
      // The merge subsumes these releases commit-wise; their notes still have to be
      // folded by hand, and this list is the only place that says so up front.
      `- Upstream release notes to fold: ${plan.pendingNotes.length}`,
      ...plan.pendingNotes.map(release => `- \`release-notes/${release.tag}.md\``),
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

  // Default exit stays 0 so a conflicting probe does not fail a scheduled run;
  // --strict turns the verdict into an exit code for scripts and gates.
  if (strict && plan.action === 'needs-conflict-resolution') {
    process.exit(1)
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
