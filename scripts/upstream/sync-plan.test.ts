import { describe, expect, test } from 'bun:test'

import {
  areaOf,
  classifyConflictHunk,
  decisionFor,
  formatPlan,
  latestRelease,
  normalizeForkBrand,
  parseCurrentVersion,
  parseLsRemoteTags,
  parseMergeTreeConflicts,
  parseSyncPolicy,
  parseUpstreamReleases,
  pendingRelease,
  pendingReleaseNotes,
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

  test('asks the commit graph when the caller can answer it', () => {
    // A fork version ahead of upstream's must not read as "already synced". The
    // fork ships its own version line, so only ancestry is trustworthy.
    const plan = planUpstreamSync({
      releases: RELEASES,
      currentVersion: '0.9.0',
      state: { branch: 'sync/upstream-v0.6.3', behind: 4, ahead: 0, conflictFiles: [] },
      isMerged: () => false,
    })

    expect(plan.action).toBe('open-pr')
    expect(syncPullRequestTitle(plan)).toBe('chore: sync upstream v0.6.3')
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

  test('prefers the commit graph over the version comparison', () => {
    // The version comparison returns null here, which is exactly the silent
    // desync it cannot see: the fork moved to 0.7.0 on its own line while
    // upstream's v0.6.3 was never merged.
    expect(releaseToSync({ releases: RELEASES, currentVersion: '0.7.0' })).toBeNull()
    expect(releaseToSync({
      releases: RELEASES,
      currentVersion: '0.7.0',
      isMerged: (commit) => commit === 'c1',
    })?.tag).toBe('v0.6.3')
  })
})

describe('pendingRelease', () => {
  test('returns the newest release the base branch has not merged', () => {
    // v0.6.3 is integrated; v0.6.2 is the newest one that is not.
    expect(pendingRelease({
      releases: RELEASES,
      isMerged: (commit) => commit === 'c3',
    })?.tag).toBe('v0.6.2')
  })

  test('returns null when every release is already merged', () => {
    expect(pendingRelease({ releases: RELEASES, isMerged: () => true })).toBeNull()
  })

  test('returns the latest release when nothing is merged', () => {
    expect(pendingRelease({ releases: RELEASES, isMerged: () => false })?.tag).toBe('v0.6.3')
  })

  test('returns null when upstream has no release tags', () => {
    expect(pendingRelease({ releases: [], isMerged: () => false })).toBeNull()
  })

  test('does not treat a parked sync branch as a merge', () => {
    // The regression this whole function exists for: the branch can hold the
    // release commit while the base branch never merged it.
    const branchHead = 'c3'
    expect(pendingRelease({
      releases: RELEASES,
      isMerged: (commit) => commit === branchHead,
    })?.tag).toBe('v0.6.2')
  })
})

describe('pendingReleaseNotes', () => {
  // The shape that prompted this function: v0.7.2 and v0.7.3 are ancestors of
  // v0.7.4, so merging v0.7.4 subsumes all three commit-wise — but it does not
  // fold their notes. The commit graph absorbs the merge; the notes are manual.
  const CHAIN = parseUpstreamReleases([
    { tag: 'v0.7.1', commit: 'c1' },
    { tag: 'v0.7.2', commit: 'c2' },
    { tag: 'v0.7.3', commit: 'c3' },
    { tag: 'v0.7.4', commit: 'c4' },
  ])

  const tags = (input: ReturnType<typeof pendingReleaseNotes>) => input.map(r => r.tag)

  test('returns just the target when the previous release is already merged', () => {
    expect(tags(pendingReleaseNotes({
      releases: CHAIN,
      target: CHAIN[3],
      isMerged: (commit) => commit === 'c3' || commit === 'c2' || commit === 'c1',
    }))).toEqual(['v0.7.4'])
  })

  test('returns every release back to the last merged one', () => {
    expect(tags(pendingReleaseNotes({
      releases: CHAIN,
      target: CHAIN[3],
      isMerged: (commit) => commit === 'c1',
    }))).toEqual(['v0.7.2', 'v0.7.3', 'v0.7.4'])
  })

  test('stops at the first merged release rather than folding it again', () => {
    // v0.7.2 is integrated, so only v0.7.3 and v0.7.4 are outstanding. Re-folding
    // v0.7.2 would duplicate content the fork note already carries.
    expect(tags(pendingReleaseNotes({
      releases: CHAIN,
      target: CHAIN[3],
      isMerged: (commit) => commit === 'c2' || commit === 'c1',
    }))).toEqual(['v0.7.3', 'v0.7.4'])
  })

  test('returns every release when nothing is merged', () => {
    expect(tags(pendingReleaseNotes({
      releases: CHAIN,
      target: CHAIN[3],
      isMerged: () => false,
    }))).toEqual(['v0.7.1', 'v0.7.2', 'v0.7.3', 'v0.7.4'])
  })

  test('returns nothing when the target itself is already merged', () => {
    expect(pendingReleaseNotes({
      releases: CHAIN,
      target: CHAIN[3],
      isMerged: () => true,
    })).toEqual([])
  })

  test('returns nothing for a target outside the release list', () => {
    // An unknown tag has no position to walk back from; returning the whole chain
    // would demand notes that may already be folded.
    expect(pendingReleaseNotes({
      releases: CHAIN,
      target: { tag: 'v9.9.9', version: '9.9.9', commit: 'cn' },
      isMerged: () => false,
    })).toEqual([])
  })

  test('orders the notes oldest-first, the order they get folded', () => {
    const notes = pendingReleaseNotes({
      releases: CHAIN,
      target: CHAIN[3],
      isMerged: (commit) => commit === 'c1',
    })

    expect(notes.map(r => r.tag)).toEqual(['v0.7.2', 'v0.7.3', 'v0.7.4'])
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

describe('parseSyncPolicy', () => {
  test('reads brand tokens and file decisions from policy data', () => {
    const policy = parseSyncPolicy(JSON.stringify({
      brandTokens: [{ upstream: 'cc-haha', fork: 'echoflow' }],
      fileDecisions: { 'package.json': 'fork-brand-with-upstream-logic' },
    }))

    expect(policy.brandTokens).toHaveLength(1)
    expect(policy.fileDecisions['package.json']).toBe('fork-brand-with-upstream-logic')
  })

  test('rejects an unknown file decision', () => {
    // A decision no resolver understands must fail loudly rather than be treated
    // as "no decision", which would silently drop a rule someone thought they wrote.
    expect(() => parseSyncPolicy(JSON.stringify({
      brandTokens: [],
      fileDecisions: { 'x.ts': 'take-theirs' },
    }))).toThrow()
  })

  test('rejects a brand token that is not an upstream/fork pair', () => {
    expect(() => parseSyncPolicy(JSON.stringify({
      brandTokens: [{ upstream: 'cc-haha' }],
      fileDecisions: {},
    }))).toThrow()
  })
})

describe('decisionFor', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [],
    fileDecisions: {
      'package.json': 'fork-brand-with-upstream-logic',
      'src/server/config/providerPresets.json': 'manual',
    },
  }))

  test('returns the recorded decision for a known path', () => {
    expect(decisionFor('package.json', policy)).toBe('fork-brand-with-upstream-logic')
    expect(decisionFor('src/server/config/providerPresets.json', policy)).toBe('manual')
  })

  test('returns null for a path with no recorded decision', () => {
    expect(decisionFor('src/server/foo.ts', policy)).toBeNull()
  })
})

// areaOf lives here now: both the PR conflict map and the merge-state report
// bucket through it, and two copies of the same function stopped being the same
// function the first time only one of them changed.
describe('areaOf', () => {
  test('buckets root-level files on their own', () => {
    expect(areaOf('package.json')).toBe('仓库根目录')
  })

  test('splits the two big trees by second segment', () => {
    // desktop/ and src/ each hold more conflict files than every other area
    // combined, so a top-level bucket would say nothing a maintainer can act on.
    expect(areaOf('desktop/src/stores/chatStore.ts')).toBe('desktop/src')
    expect(areaOf('src/server/services/localIndex/search.ts')).toBe('src/server')
    expect(areaOf('src/server/services/sessionService.ts')).toBe('src/server')
  })

  test('keeps shallower trees whole', () => {
    expect(areaOf('docs/internals/contributing.md')).toBe('docs')
    expect(areaOf('desktop/package.json')).toBe('desktop')
  })
})

describe('normalizeForkBrand', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [
      { upstream: 'Claude-Code-Haha', fork: 'EchoFlow-Code' },
      { upstream: 'CC_HAHA_', fork: 'ECHOFLOW_' },
      { upstream: 'cc-haha', fork: 'echoflow' },
    ],
    fileDecisions: {},
  }))

  test('rewrites upstream brand tokens to fork tokens', () => {
    expect(normalizeForkBrand('from cc-haha-plugin', policy)).toBe('from echoflow-plugin')
    expect(normalizeForkBrand('CC_HAHA_API_KEY', policy)).toBe('ECHOFLOW_API_KEY')
    expect(normalizeForkBrand('Claude-Code-Haha', policy)).toBe('EchoFlow-Code')
  })

  test('replaces longest tokens first so shorter tokens cannot clobber', () => {
    // 若先替换 cc-haha，CC_HAHA_ 不会被改写；若顺序错乱，Claude-Code-Haha 可能被截断。
    expect(normalizeForkBrand('CC_HAHA_X cc-haha Claude-Code-Haha', policy))
      .toBe('ECHOFLOW_X echoflow EchoFlow-Code')
  })

  test('leaves text without brand tokens unchanged', () => {
    expect(normalizeForkBrand('claude-code-plugin CLAUDE_CODE_HOME', policy))
      .toBe('claude-code-plugin CLAUDE_CODE_HOME')
  })

  test('normalizes a scrambled policy to the same result as an ordered one', () => {
    // Nested tokens make the order observable: applying `ab` first turns `abcd`
    // into `Xd`, so the longer rewrite never lands. The policy file is data a
    // maintainer edits, so a wrong row order must not change the output.
    const nested = (order: { upstream: string, fork: string }[]) => parseSyncPolicy(JSON.stringify({
      brandTokens: order,
      fileDecisions: {},
    }))
    const ordered = nested([
      { upstream: 'abcd', fork: 'Y' },
      { upstream: 'ab', fork: 'X' },
    ])
    const scrambled = nested([
      { upstream: 'ab', fork: 'X' },
      { upstream: 'abcd', fork: 'Y' },
    ])
    expect(normalizeForkBrand('abcd ab', ordered)).toBe('Y X')
    expect(normalizeForkBrand('abcd ab', scrambled)).toBe('Y X')
  })
})

describe('classifyConflictHunk', () => {
  const policy = parseSyncPolicy(JSON.stringify({
    brandTokens: [{ upstream: 'cc-haha', fork: 'echoflow' }],
    fileDecisions: {},
  }))

  test('classifies hunks that differ only by brand tokens as brand-only', () => {
    expect(classifyConflictHunk({ ours: 'echoflow-api', theirs: 'cc-haha-api', policy }))
      .toBe('brand-only')
  })

  test('classifies hunks with real code divergence as semantic', () => {
    expect(classifyConflictHunk({ ours: 'echoflow-api-v2', theirs: 'cc-haha-api-v1', policy }))
      .toBe('semantic')
  })

  test('classifies identical sides as brand-only', () => {
    expect(classifyConflictHunk({ ours: 'same', theirs: 'same', policy })).toBe('brand-only')
  })

  test('treats a brand difference as semantic when it is not the only difference', () => {
    // The guard is exact equality after normalization: a hunk that carries both a
    // brand rename and a real edit must never be auto-resolved.
    expect(classifyConflictHunk({ ours: 'echoflow-api call()', theirs: 'cc-haha-api call2()', policy }))
      .toBe('semantic')
  })
})
