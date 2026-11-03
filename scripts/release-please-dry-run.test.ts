/**
 * Offline proof that the pinned Release Please configuration produces the
 * expected release for this repository.
 *
 * The repository cannot call GitHub from a test, so this harness drives the
 * real `release-please` releaser against an in-memory SCM: the same code path
 * the GitHub Action runs, minus the network. That is what makes the version
 * numbers below evidence rather than a restatement of the config file.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { Manifest } from 'release-please'

type Commit = {
  sha: string
  message: string
  pullRequest?: { number: number }
  files?: string[]
}

type Release = {
  tagName: string
  sha: string
  name: string
  notes: string
  draft?: boolean
  prerelease?: boolean
}

/**
 * The subset of the release-please SCM interface the manifest builder uses.
 * Everything is served from memory so the test never touches the network.
 */
class FakeScm {
  repository = { owner: 'echoflow', repo: 'EchoFlow-Code', defaultBranch: 'main' }

  constructor(
    private readonly files: Map<string, string>,
    private readonly commits: Commit[],
    private readonly releases: Release[],
  ) {}

  async getFileContents(path: string) {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`missing file: ${path}`)
    }
    return {
      parsedContent: content,
      sha: `sha-${path}`,
      path,
      mode: '100644',
      type: 'file' as const,
      size: content.length,
    }
  }

  async getFileContentsOnBranch(path: string) {
    return this.getFileContents(path)
  }

  async getFileJson<T>(path: string): Promise<T> {
    return JSON.parse((await this.getFileContents(path)).parsedContent) as T
  }

  async findFilesByFilename() {
    return []
  }

  async findFilesByFilenameAndRef() {
    return []
  }

  async findFilesByGlob() {
    return []
  }

  async findFilesByGlobAndRef() {
    return []
  }

  async findFilesByExtension() {
    return []
  }

  async findFilesByExtensionAndRef() {
    return []
  }

  async commitsSince(targetBranch: string) {
    return this.commits
  }

  async *mergeCommitIterator() {
    for (const commit of this.commits) {
      yield commit
    }
  }

  async *pullRequestIterator() {
    // No release pull request exists yet: the flow under test is the
    // "maintain a Release PR" path, not the "tag an existing PR" path.
  }

  async *releaseIterator() {
    for (const release of this.releases) {
      yield release
    }
  }

  async *tagIterator() {
    for (const release of this.releases) {
      yield { name: release.tagName, sha: release.sha }
    }
  }

  async createPullRequest() {
    throw new Error('createPullRequest is not used by the offline proof')
  }

  async updatePullRequest() {
    throw new Error('updatePullRequest is not used by the offline proof')
  }

  async getPullRequest() {
    throw new Error('getPullRequest is not used by the offline proof')
  }

  async createRelease() {
    throw new Error('createRelease is not used by the offline proof')
  }

  async commentOnIssue() {
    return ''
  }

  async removeIssueLabels() {}

  async addIssueLabels() {}
}

const BASELINE_VERSION = '0.7.2'

// Release state is pinned to the baseline so the proof does not fail after each release.
function readRepoFiles(): Map<string, string> {
  const files = new Map<string, string>()
  files.set('release-please-config.json', readFileSync('release-please-config.json', 'utf8'))
  files.set('.release-please-manifest.json', JSON.stringify({ desktop: BASELINE_VERSION }))
  for (const path of ['desktop/package.json', 'mobile/package.json', 'mobile/app.json']) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    parsed.version = BASELINE_VERSION
    files.set(path, JSON.stringify(parsed, null, 2))
  }
  return files
}

/**
 * Commits released after the `v0.7.2` baseline, as the repository actually
 * has them: a fix, a feature, and a breaking change.
 */
function commitsAfterBaseline(): Commit[] {
  return [
    {
      sha: 'sha-fix',
      message: 'fix(echoflow): keep saved token keys and reject a mismatched restored session',
      files: ['desktop/src/api/echoflow.ts'],
    },
    {
      sha: 'sha-feat',
      message: 'feat(desktop): add a release surface audit target',
      files: ['scripts/pr/release-surface-audit.ts'],
    },
    {
      sha: 'sha-breaking',
      message:
        'feat(desktop)!: replace the legacy session picker\n\nBREAKING CHANGE: the legacy picker is removed',
      files: ['desktop/src/components/layout/Sidebar.tsx'],
    },
  ]
}

async function buildManifest(scm: FakeScm) {
  return Manifest.fromManifest(scm, 'main', 'release-please-config.json', '.release-please-manifest.json')
}

describe('release please offline dry run', () => {
  test('proposes 0.7.3 for the pending release', async () => {
    const scm = new FakeScm(readRepoFiles(), commitsAfterBaseline(), [
      {
        tagName: 'v0.7.2',
        sha: 'sha-v0.7.2',
        name: 'v0.7.2',
        notes: '',
      },
    ])
    const manifest = await buildManifest(scm)
    const pullRequests = await manifest.buildPullRequests()

    expect(pullRequests).toHaveLength(1)
    expect(pullRequests[0].version?.toString()).toBe('0.7.3')
  })

  test('writes one version into the three product version files', async () => {
    const scm = new FakeScm(readRepoFiles(), commitsAfterBaseline(), [
      {
        tagName: 'v0.7.2',
        sha: 'sha-v0.7.2',
        name: 'v0.7.2',
        notes: '',
      },
    ])
    const manifest = await buildManifest(scm)
    const [pullRequest] = await manifest.buildPullRequests()

    // The node strategy also proposes lockfile and samples updates. Those are
    // skipped because the files do not exist, so only the files this
    // repository actually ships are changed.
    const changedPaths = pullRequest.updates
      .map(update => update.path)
      .filter(path => scm.files.has(path))
      .sort()

    expect(changedPaths).toEqual([
      '.release-please-manifest.json',
      'desktop/package.json',
      'mobile/app.json',
      'mobile/package.json',
    ])

    for (const update of pullRequest.updates) {
      if (!scm.files.has(update.path)) {
        continue
      }
      const content = update.updater.updateContent(scm.files.get(update.path) as string)
      const parsed = JSON.parse(content)
      if (update.path === '.release-please-manifest.json') {
        expect(parsed.desktop).toBe('0.7.3')
      } else {
        expect(parsed.version).toBe('0.7.3')
      }
    }
  })

  test('does not generate a changelog file', async () => {
    const scm = new FakeScm(readRepoFiles(), commitsAfterBaseline(), [
      {
        tagName: 'v0.7.2',
        sha: 'sha-v0.7.2',
        name: 'v0.7.2',
        notes: '',
      },
    ])
    const manifest = await buildManifest(scm)
    const [pullRequest] = await manifest.buildPullRequests()

    expect(pullRequest.updates.some(update => update.path.includes('CHANGELOG'))).toBe(false)
  })

  test('keeps the patch bump for a breaking change below 1.0.0', async () => {
    const scm = new FakeScm(readRepoFiles(), commitsAfterBaseline(), [
      {
        tagName: 'v0.7.2',
        sha: 'sha-v0.7.2',
        name: 'v0.7.2',
        notes: '',
      },
    ])
    const manifest = await buildManifest(scm)
    const [pullRequest] = await manifest.buildPullRequests()

    // A major bump would jump to 1.0.0 and break the 0.x release line.
    expect(pullRequest.version?.major).toBe(0)
    expect(pullRequest.version?.patch).toBe(3)
  })

  test('keeps the config within the pinned releaser schema', () => {
    const schema = JSON.parse(
      readFileSync('node_modules/release-please/schemas/config.json', 'utf8'),
    )
    const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'))

    // The pinned schema validates the package-level keys this config relies on.
    const packageProperties = schema.definitions.ReleaserConfigOptions.properties
    for (const key of Object.keys(config.packages.desktop)) {
      expect(Object.keys(packageProperties)).toContain(key)
    }
    for (const key of ['bump-patch-for-minor-pre-major', 'skip-changelog', 'draft', 'force-tag-creation']) {
      expect(Object.keys(schema.properties)).toContain(key)
    }
  })
})
