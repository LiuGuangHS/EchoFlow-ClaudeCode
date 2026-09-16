import { describe, expect, test } from 'bun:test'

import {
  formatPlan,
  latestRelease,
  parseCurrentVersion,
  parseLsRemoteTags,
  parseMergeTreeConflicts,
  parseUpstreamReleases,
  planUpstreamSync,
  releaseToSync,
  syncBranchFor,
  syncPullRequestDraft,
  syncPullRequestBody,
  syncPullRequestTitle,
} from './sync-plan'

const RELEASES = parseUpstreamReleases([
  { tag: 'v0.6.1', commit: 'c1' },
  { tag: 'v0.6.3', commit: 'c3' },
  { tag: 'v0.6.2', commit: 'c2' },
])

describe('parseUpstreamReleases', () => {
  test('orders releases numerically, not lexically', () => {
    // Lexical sorting puts v0.6.10 before v0.6.2, which would pin the fork to an
    // older release the moment upstream crosses a double-digit patch.
    const releases = parseUpstreamReleases([
      { tag: 'v0.6.10', commit: 'c10' },
      { tag: 'v0.6.9', commit: 'c9' },
      { tag: 'v0.6.2', commit: 'c2' },
    ])

    expect(releases.map((release) => release.tag)).toEqual(['v0.6.2', 'v0.6.9', 'v0.6.10'])
  })

  test('drops prerelease and fork-local tags', () => {
    // `v0.3.2-rc.1` is a fork tag. Treating it as an upstream release would let a
    // fork-only prerelease masquerade as the sync target.
    const releases = parseUpstreamReleases([
      { tag: 'v0.3.2-rc.1', commit: 'rc1' },
      { tag: 'v0.6.3', commit: 'c3' },
      { tag: 'v0.6.3-rc.2', commit: 'rc2' },
      { tag: 'nightly', commit: 'n' },
    ])

    expect(releases.map((release) => release.tag)).toEqual(['v0.6.3'])
  })

  test('is empty for input with no release tags', () => {
    expect(parseUpstreamReleases([{ tag: 'v1.0.0-beta', commit: 'b' }])).toEqual([])
  })
})

describe('parseLsRemoteTags', () => {
  test('prefers the peeled commit for an annotated tag', () => {
    // An annotated tag appears twice. Merging the tag object instead of the commit
    // it wraps produces a merge target that is not a commit.
    const parsed = parseLsRemoteTags([
      'aaaa refs/tags/v0.6.3',
      'bbbb refs/tags/v0.6.3^{}',
    ].join('\n'))

    expect(parsed).toEqual([{ tag: 'v0.6.3', commit: 'bbbb' }])
  })

  test('keeps a lightweight tag once', () => {
    const parsed = parseLsRemoteTags('cccc\trefs/tags/v0.6.3')

    expect(parsed).toEqual([{ tag: 'v0.6.3', commit: 'cccc' }])
  })

  test('ignores unrelated refs and blank lines', () => {
    const parsed = parseLsRemoteTags([
      '',
      'dddd refs/heads/main',
      'eeee refs/tags/v0.6.3^{}',
    ].join('\n'))

    expect(parsed).toEqual([{ tag: 'v0.6.3', commit: 'eeee' }])
  })
})

describe('parseCurrentVersion', () => {
  test('reads a plain version', () => {
    expect(parseCurrentVersion('{"version":"0.5.5"}')).toBe('0.5.5')
  })

  test('reduces a legacy prerelease suffix to its base', () => {
    expect(parseCurrentVersion('{"version":"0.5.5-rc.2"}')).toBe('0.5.5')
  })

  test('returns null rather than throwing on unusable input', () => {
    expect(parseCurrentVersion('not json')).toBeNull()
    expect(parseCurrentVersion('{"version":12}')).toBeNull()
    expect(parseCurrentVersion('{}')).toBeNull()
  })
})

describe('planUpstreamSync', () => {
  const current = '0.5.5'

  test('opens a PR when the merge is clean', () => {
    const plan = planUpstreamSync({
      releases: RELEASES,
      currentVersion: current,
      state: { branch: 'sync/upstream-v0.6.3', behind: 170, ahead: 90, conflictFiles: [] },
    })

    expect(plan).toMatchObject({
      action: 'open-pr',
      branch: 'sync/upstream-v0.6.3',
      behind: 170,
      ahead: 90,
    })
    expect(syncPullRequestTitle(plan)).toBe('chore: sync upstream v0.6.3')
    expect(syncPullRequestDraft(plan)).toBe(false)
  })

  test('opens a draft PR when the merge conflicts', () => {
    // A conflicting release still gets a PR, so the sync is tracked on the PR itself
    // rather than only in a job log.
    const plan = planUpstreamSync({
      releases: RELEASES,
      currentVersion: current,
      state: {
        branch: 'sync/upstream-v0.6.3',
        behind: 170,
        ahead: 90,
        conflictFiles: ['AGENTS.md', 'README.md'],
      },
    })

    expect(plan).toMatchObject({
      action: 'needs-conflict-resolution',
      conflictFiles: ['AGENTS.md', 'README.md'],
    })
    expect(syncPullRequestDraft(plan)).toBe(true)
    const body = syncPullRequestBody(plan) ?? ''
    expect(body).toContain('never apply blanket `--ours` or')
    expect(body).toContain('`--theirs`')
    expect(body).toContain('`AGENTS.md`')
    expect(body).toContain('`README.md`')
  })

  test('keeps proposing the merge while the fork version is still behind', () => {
    // Idempotency for a parked PR is decided by asking whether the remote sync
    // branch already contains the release, not by the version the fork ships.
    const plan = planUpstreamSync({
      releases: RELEASES,
      currentVersion: current,
      state: { branch: 'sync/upstream-v0.6.3', behind: 12, ahead: 0, conflictFiles: [] },
    })

    expect(plan.action).toBe('open-pr')
  })

  test('reports already-synced once the fork version reaches the latest release', () => {
    expect(planUpstreamSync({
      releases: RELEASES,
      currentVersion: '0.6.3',
      state: { branch: 'b', behind: 0, ahead: 0, conflictFiles: [] },
    })).toMatchObject({ action: 'already-synced' })
  })

  test('reports no-op when upstream has published no release tag', () => {
    expect(planUpstreamSync({
      releases: [],
      currentVersion: current,
      state: { branch: 'b', behind: 0, ahead: 0, conflictFiles: [] },
    })).toMatchObject({ action: 'none' })
  })
})

describe('releaseToSync', () => {
  test('picks the latest release when the fork is behind', () => {
    expect(releaseToSync({ releases: RELEASES, currentVersion: '0.5.5' })?.tag).toBe('v0.6.3')
  })

  test('returns null when the fork is already at or past the latest release', () => {
    expect(releaseToSync({ releases: RELEASES, currentVersion: '0.6.3' })).toBeNull()
    expect(releaseToSync({ releases: RELEASES, currentVersion: '0.7.0' })).toBeNull()
  })

  test('returns null when upstream has no release tags', () => {
    expect(releaseToSync({ releases: [], currentVersion: '0.5.5' })).toBeNull()
  })

  test('reports a target when the fork version cannot be read', () => {
    // Guessing "current" from an unreadable package would let the fork silently
    // stop tracking upstream, which is the failure this whole workflow prevents.
    expect(releaseToSync({ releases: RELEASES, currentVersion: null })?.tag).toBe('v0.6.3')
  })
})

describe('syncBranchFor', () => {
  test('names the branch after the release tag', () => {
    expect(syncBranchFor({ tag: 'v0.6.3', version: '0.6.3', commit: 'c' }))
      .toBe('sync/upstream-v0.6.3')
  })
})

describe('latestRelease', () => {
  test('returns the highest release or null', () => {
    expect(latestRelease(RELEASES)?.tag).toBe('v0.6.3')
    expect(latestRelease([])).toBeNull()
  })
})

describe('parseMergeTreeConflicts', () => {
  test('reads the conflict run and stops at the blank line', () => {
    // Shape taken from a real run: the merged tree oid, the conflicting paths, a
    // blank line, then messages that echo paths a second time.
    const output = [
      '563df6f680a6ee21ff16c17601548219b844b314',
      '.github/ISSUE_TEMPLATE/feature_request.md',
      'AGENTS.md',
      'README.md',
      '',
      'Auto-merging AGENTS.md',
      'CONFLICT (content): Merge conflict in AGENTS.md',
    ].join('\n')

    // Without the blank-line stop, AGENTS.md would be reported twice and the count
    // would not match the merge-tree header.
    expect(parseMergeTreeConflicts(output)).toEqual([
      '.github/ISSUE_TEMPLATE/feature_request.md',
      'AGENTS.md',
      'README.md',
    ])
  })

  test('handles a conflict with no informational tail', () => {
    expect(parseMergeTreeConflicts('abc123\nAGENTS.md')).toEqual(['AGENTS.md'])
  })

  test('returns nothing when only the tree oid is present', () => {
    expect(parseMergeTreeConflicts('abc123\n')).toEqual([])
  })
})

describe('formatPlan', () => {
  test('describes every outcome in one line', () => {
    expect(formatPlan({ action: 'none', reason: 'No upstream release tag found.', currentVersion: null }))
      .toBe('no-op: No upstream release tag found.')
    expect(formatPlan({ action: 'already-synced', release: RELEASES[2], branch: 'sync/upstream-v0.6.3' }))
      .toBe('already synced to v0.6.3')
    expect(formatPlan({
      action: 'needs-conflict-resolution',
      release: RELEASES[2],
      previousVersion: '0.5.5',
      branch: 'sync/upstream-v0.6.3',
      behind: 170,
      ahead: 90,
      conflictFiles: ['AGENTS.md'],
      reason: 'conflicts',
    })).toBe('v0.6.3 has 1 conflicting file(s); draft sync PR on sync/upstream-v0.6.3')
  })
})

describe('syncPullRequestTitle', () => {
  test('returns a title only for an actionable plan', () => {
    expect(syncPullRequestTitle({ action: 'none', reason: 'x', currentVersion: null })).toBeNull()
    expect(syncPullRequestTitle({ action: 'already-synced', release: RELEASES[2], branch: 'b' })).toBeNull()
  })
})
