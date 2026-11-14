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
function readRepoFiles(baselineVersion = BASELINE_VERSION, desktopVersion = baselineVersion): Map<string, string> {
  const files = new Map<string, string>()
  const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'))
  files.set('release-please-config.json', JSON.stringify(config))
  files.set('.release-please-manifest.json', JSON.stringify({ desktop: baselineVersion }))
  for (const path of ['desktop/package.json', 'mobile/package.json', 'mobile/app.json']) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (path === 'mobile/app.json') {
      parsed.expo.version = '0.1.3'
    } else {
      parsed.version = path === 'mobile/package.json' ? '0.1.3' : desktopVersion
    }
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

  test('updates the desktop version without changing the independent mobile versions', async () => {
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
    ])
    expect(pullRequest.updates.some(update => update.path.startsWith('mobile/'))).toBe(false)
    const updatedFiles = new Map(scm.files)

    for (const update of pullRequest.updates) {
      if (!scm.files.has(update.path)) {
        continue
      }
      const content = update.updater.updateContent(scm.files.get(update.path) as string)
      updatedFiles.set(update.path, content)
      const parsed = JSON.parse(content)
      if (update.path === '.release-please-manifest.json') {
        expect(parsed.desktop).toBe('0.7.3')
      } else {
        expect(parsed.version).toBe('0.7.3')
      }
    }

    for (const path of ['mobile/package.json', 'mobile/app.json']) {
      expect(updatedFiles.get(path)).toBe(scm.files.get(path))
    }
    expect(JSON.parse(updatedFiles.get('mobile/package.json') as string).version).toBe('0.1.3')
    expect(JSON.parse(updatedFiles.get('mobile/app.json') as string).expo.version).toBe('0.1.3')
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

  test('uses a one-time footer with a stale manifest, then resumes patch releases', async () => {
    const files = readRepoFiles('0.7.4', '0.7.7')
    const recoveryCommit: Commit = {
      sha: 'sha-recovery',
      message: 'fix(desktop): repair release version coordination\n\nRelease-As: 0.7.7',
      files: ['desktop/package.json', 'release-please-config.json'],
    }
    const previousRelease: Release = {
      tagName: 'v0.7.4', sha: 'sha-v0.7.4', name: 'v0.7.4', notes: '',
    }
    const previousCommit: Commit = {
      sha: previousRelease.sha,
      message: 'chore(main): release 0.7.4',
      files: ['desktop/package.json', '.release-please-manifest.json'],
    }
    const manifest = await buildManifest(new FakeScm(files, [recoveryCommit, previousCommit], [previousRelease]))
    const pullRequests = await manifest.buildPullRequests()
    expect(pullRequests).toHaveLength(1)
    const [pullRequest] = pullRequests
    expect(pullRequest.version?.toString()).toBe('0.7.7')
    expect(pullRequest.updates.some(update => update.path.startsWith('mobile/'))).toBe(false)
    for (const update of pullRequest.updates) {
      if (files.has(update.path)) {
        files.set(update.path, update.updater.updateContent(files.get(update.path)!))
      }
    }
    expect(JSON.parse(files.get('.release-please-manifest.json')!).desktop).toBe('0.7.7')
    expect(JSON.parse(files.get('desktop/package.json')!).version).toBe('0.7.7')

    const releasedCommit: Commit = {
      sha: 'sha-v0.7.7',
      message: 'chore(main): release 0.7.7',
      files: ['desktop/package.json', '.release-please-manifest.json'],
    }
    // Keep the old footer in history: the release boundary, not the fixture, must exclude it.
    const nextManifest = await buildManifest(new FakeScm(files, [
      { sha: 'sha-next-fix', message: 'fix(desktop): preserve session title', files: ['desktop/src/App.tsx'] },
      releasedCommit,
      recoveryCommit,
      previousCommit,
    ], [
      { tagName: 'v0.7.7', sha: releasedCommit.sha, name: 'v0.7.7', notes: '' },
      previousRelease,
    ]))
    const nextPullRequests = await nextManifest.buildPullRequests()
    expect(nextPullRequests).toHaveLength(1)
    expect(nextPullRequests[0].version?.toString()).toBe('0.7.8')
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
