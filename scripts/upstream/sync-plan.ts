/**
 * Upstream sync planner.
 *
 * Turns "the fork is N commits behind upstream" into one deterministic decision:
 * which release to sync to, on which branch, and whether the merge is clean
 * enough to open a PR without a human writing conflict resolutions.
 *
 * The fork tracks upstream *releases*, not upstream's moving tip. Upstream `main`
 * is a development branch; a release tag is what a fork can version against.
 * See AGENTS.md "Safe Upstream Sync Workflow" for the policies this encodes.
 */

export type UpstreamRelease = {
  tag: string
  version: string
  commit: string
}

export type SyncState = {
  branch: string
  behind: number
  ahead: number
  conflictFiles: string[]
}

export type SyncPlan =
  | { action: 'none'; reason: string; currentVersion: string | null }
  | { action: 'already-synced'; release: UpstreamRelease; branch: string }
  | {
    action: 'open-pr' | 'needs-conflict-resolution'
    release: UpstreamRelease
    previousVersion: string | null
    branch: string
    behind: number
    ahead: number
    conflictFiles: string[]
    reason: string
  }

type ParsedVersion = { major: number; minor: number; patch: number }

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)

  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareParsedVersion(a: ParsedVersion, b: ParsedVersion) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/**
 * Keeps only `vX.Y.Z` release tags. Prerelease and fork-local tags such as
 * `v0.3.2-rc.1` are deliberately excluded: they are not upstream releases.
 */
export function parseUpstreamReleases(
  entries: { tag: string; commit: string }[],
): UpstreamRelease[] {
  const releases: UpstreamRelease[] = []

  for (const entry of entries) {
    const match = entry.tag.match(RELEASE_TAG)

    if (!match) {
      continue
    }

    releases.push({
      tag: entry.tag,
      version: `${match[1]}.${match[2]}.${match[3]}`,
      commit: entry.commit,
    })
  }

  return releases.sort((a, b) => compareParsedVersion(
    parseVersion(a.version) as ParsedVersion,
    parseVersion(b.version) as ParsedVersion,
  ))
}

export function latestRelease(releases: UpstreamRelease[]): UpstreamRelease | null {
  return releases.length > 0 ? releases[releases.length - 1] : null
}

/**
 * Parses `git ls-remote --tags` output into `{ tag, commit }` entries.
 *
 * Annotated tags appear twice: once as the tag object and once as `refs/tags/x^{}`
 * pointing at the commit it wraps. The peeled line is the one a merge can use, so
 * it wins when both are present.
 *
 * Reading tags over `ls-remote` keeps them out of the local tag namespace, which
 * AGENTS.md requires: upstream and fork release tags share names.
 */
export function parseLsRemoteTags(output: string) {
  const commits = new Map<string, string>()

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    const [commit, ref] = trimmed.split(/\s+/)
    const match = ref?.match(/^refs\/tags\/(.+?)(\^\{\})?$/)

    if (!commit || !match) {
      continue
    }

    const tag = match[1]
    const isPeeled = Boolean(match[2])

    if (isPeeled || !commits.has(tag)) {
      commits.set(tag, commit)
    }
  }

  return [...commits.entries()].map(([tag, commit]) => ({ tag, commit }))
}

/**
 * Reads the fork's own version from the desktop package. The fork ships plain
 * `X.Y.Z`; a legacy prerelease suffix such as `0.5.5-rc.1` reduces to its base.
 */
export function parseCurrentVersion(desktopPackageJson: string): string | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(desktopPackageJson)
  } catch {
    return null
  }

  const version = (parsed as { version?: unknown } | null)?.version

  if (typeof version !== 'string') {
    return null
  }

  const base = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  return base ? `${base[1]}.${base[2]}.${base[3]}` : null
}

export function syncBranchFor(release: UpstreamRelease) {
  return `sync/upstream-${release.tag}`
}

/**
 * Reads the conflicting paths out of `git merge-tree --write-tree --name-only`.
 *
 * Output layout: the merged tree oid, then one line per conflicting path, then a
 * blank line, then informational messages that echo some of those same paths. Only
 * the run before the first blank line is the file list, so the messages cannot
 * double-count a path that happens to be mentioned in both places.
 *
 * Conflict kinds that are not a content merge (`CONFLICT (modify/delete)`) still
 * list the path above the blank line, so they are captured too.
 */
export function parseMergeTreeConflicts(output: string): string[] {
  const files: string[] = []

  for (const line of output.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim()

    if (!trimmed) {
      break
    }

    files.push(trimmed)
  }

  return files
}

/**
 * Phase one: the cheap question.
 *
 * "Is a newer upstream release than the fork's own version available?" This needs
 * only a tag list and `desktop/package.json`, so it runs before touching the
 * working tree and costs nothing when the answer is no.
 *
 * Returns the release to sync to, or null when there is nothing to do. A null
 * `currentVersion` is treated as "unknown" and reports the latest release rather
 * than silently claiming the fork is current.
 */
export function releaseToSync(input: {
  releases: UpstreamRelease[]
  currentVersion: string | null
}): UpstreamRelease | null {
  const release = latestRelease(input.releases)

  if (!release) {
    return null
  }

  const current = input.currentVersion ? parseVersion(input.currentVersion) : null
  const target = parseVersion(release.version) as ParsedVersion

  if (current && compareParsedVersion(current, target) >= 0) {
    return null
  }

  return release
}

/**
 * Phase two: the real decision.
 *
 * `state` describes what a merge probe of `releaseToSync`'s target actually
 * produced. It is required: without a probe the honest answer is "unknown", and
 * this function refuses to guess between opening a PR and asking for conflict
 * resolution.
 */
export function planUpstreamSync(input: {
  releases: UpstreamRelease[]
  currentVersion: string | null
  state: SyncState
}): SyncPlan {
  const release = releaseToSync(input)

  if (!release) {
    const latest = latestRelease(input.releases)
    return latest
      ? { action: 'already-synced', release: latest, branch: syncBranchFor(latest) }
      : { action: 'none', reason: 'No upstream release tag found.', currentVersion: input.currentVersion }
  }

  const branch = syncBranchFor(release)

  const conflictCount = input.state.conflictFiles.length
  const base = {
    release,
    previousVersion: input.currentVersion,
    branch,
    behind: input.state.behind,
    ahead: input.state.ahead,
    conflictFiles: input.state.conflictFiles,
  }

  if (conflictCount > 0) {
    return {
      ...base,
      action: 'needs-conflict-resolution',
      reason: `${conflictCount} file(s) conflict when merging ${release.tag}.`,
    }
  }

  return {
    ...base,
    action: 'open-pr',
    reason: `Merge ${release.tag} cleanly (${input.state.behind} upstream commit(s) to integrate).`,
  }
}

export function formatPlan(plan: SyncPlan) {
  switch (plan.action) {
    case 'none':
      return `no-op: ${plan.reason}`
    case 'already-synced':
      return `already synced to ${plan.release.tag}`
    case 'open-pr':
      return `${plan.release.tag} merges cleanly; sync PR on ${plan.branch}`
    case 'needs-conflict-resolution':
      return `${plan.release.tag} has ${plan.conflictFiles.length} conflicting file(s); draft sync PR on ${plan.branch}`
  }
}

/**
 * Title for the sync pull request. It stays descriptive on purpose: the repo
 * contract requires accurate provenance, so a sync is labelled as a sync.
 */
export function syncPullRequestTitle(plan: SyncPlan) {
  if (plan.action !== 'open-pr' && plan.action !== 'needs-conflict-resolution') {
    return null
  }

  return `chore: sync upstream ${plan.release.tag}`
}

/**
 * A conflicting sync opens as a draft.
 *
 * The PR still exists so the release is tracked and the conflict list is visible,
 * but it must not look mergeable: the fork's brand and provider policy decisions
 * have not been made yet.
 */
export function syncPullRequestDraft(plan: SyncPlan) {
  return plan.action === 'needs-conflict-resolution'
}

export function syncPullRequestBody(plan: SyncPlan) {
  if (plan.action !== 'open-pr' && plan.action !== 'needs-conflict-resolution') {
    return null
  }

  const lines = [
    `Merges upstream \`${plan.release.tag}\` into \`main\`.`,
    '',
    '| | |',
    '| --- | --- |',
    `| Upstream release | ${plan.release.tag} |`,
    `| Upstream commit | ${plan.release.commit} |`,
    `| Fork version before | ${plan.previousVersion ?? 'unknown'} |`,
    `| Upstream commits behind | ${plan.behind} |`,
    `| Fork commits ahead | ${plan.ahead} |`,
    `| Conflicting files | ${plan.conflictFiles.length} |`,
    '',
  ]

  if (plan.action === 'needs-conflict-resolution') {
    lines.push(
      'Git could not merge these files on its own, so this PR is opened as a draft:',
      '',
      ...plan.conflictFiles.map((file) => `- \`${file}\``),
      '',
      'Resolve them in this PR, then mark it ready for review. The fork identity and',
      'provider policy in `AGENTS.md` apply: never apply blanket `--ours` or',
      '`--theirs`, and audit the brand, provider, and release surfaces in the',
      'upstream sync checklist.',
      '',
      'To resolve locally:',
      '',
      '```bash',
      `git fetch origin ${plan.branch}`,
      `git switch --track -c ${plan.branch} origin/${plan.branch}`,
      'git merge main',
      '# resolve, then: git add <files> && git commit',
      'git push',
      '```',
    )
  } else {
    lines.push(
      'Git merged this release without conflicts. Review the brand, provider, and',
      'release surfaces called out by the upstream sync checklist before merging.',
    )
  }

  lines.push(
    '',
    'Generated by the upstream sync workflow.',
  )

  return lines.join('\n')
}
