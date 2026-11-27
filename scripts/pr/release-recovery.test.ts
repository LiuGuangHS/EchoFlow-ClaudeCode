import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const workflow = () => parse(readFileSync('.github/workflows/release-please.yml', 'utf8'))
const desktop = () => parse(readFileSync('.github/workflows/release-desktop.yml', 'utf8'))

test('official staging stops at a draft until a main dispatch approves its receipt', () => {
  const staging = desktop().jobs['publish-release']
  const publicMutations = staging.steps.filter((step: { run?: string, with?: { draft?: boolean } }) =>
    step.with?.draft === false || step.run?.includes('draft=false'))
  expect(publicMutations.map((step: { name: string }) => step.name)).toEqual([])

  const { on, jobs } = workflow()
  expect(on.workflow_dispatch.inputs.staged_artifact_id).toMatchObject({ type: 'string', required: false })
  expect(jobs['publish-release'].if).toContain('!inputs.staged_artifact_id')
  expect(jobs['promote-release'].if).toContain("github.event_name == 'workflow_dispatch'")
  expect(jobs['promote-release'].if).toContain("github.ref == 'refs/heads/main'")
  expect(jobs['promote-release'].if).toContain('inputs.staged_artifact_id')
  expect(jobs['promote-release'].needs).toBe('resolve-release')
  expect(staging.concurrency).toMatchObject({ group: 'desktop-release-mutation', queue: 'max', 'cancel-in-progress': false })
  expect(jobs['promote-release'].concurrency).toEqual(staging.concurrency)
  expect(jobs['release-please'].concurrency).toEqual(staging.concurrency)
  for (const followup of ['site-release-sync', 'release-mobile']) {
    expect(desktop().jobs[followup]).toBeUndefined()
    expect(jobs[followup].needs).toBe('promote-release')
    expect(jobs[followup].if).toContain("needs.promote-release.result == 'success'")
  }
  expect(jobs['site-release-sync'].with?.release_tag).toBeUndefined()
  expect(jobs['release-mobile'].with.release_tag).toBe('${{ needs.promote-release.outputs.release_tag }}')
})

test('promotion verifies receipt provenance and all remote bytes before changing the draft', () => {
  const script = workflow().jobs['promote-release']?.steps.find((step: { id?: string }) => step.id === 'promote')?.run
  expect(typeof script).toBe('string')
  const directory = mkdtempSync(join(tmpdir(), 'release-promotion-'))
  const output = join(directory, 'output')
  const log = join(directory, 'gh.log')
  const sha = '1'.repeat(40)
  const head = '2'.repeat(40)
  const digest = `sha256:${'a'.repeat(64)}`
  const tag = 'v1.2.3'
  const metadata = { name: 'EchoFlow Code v1.2.3', body: 'First line.\n\nSecond line.\n', prerelease: false }
  const release = { id: 42, tag_name: tag, draft: true, ...metadata }
  const assets = [
    { name: 'fixture.exe', digest, state: 'uploaded' },
    { name: 'latest.yml', digest, state: 'uploaded' },
  ]
  const sourceRun = { id: 123, run_attempt: 2, head_sha: head, head_branch: 'main', status: 'completed', conclusion: 'success', event: 'push', path: '.github/workflows/release-please.yml', repository: { id: 7 }, head_repository: { id: 7 } }
  const receipt = { run_id: 123, run_attempt: 2, workflow_sha: head, release_id: 42, tag, release_sha: sha, metadata, assets }
  try {
    writeFileSync(join(directory, 'gh'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$GH_LOG"
case "$*" in
  'api repos/fixture/release/actions/artifacts/456') printf '%s' "$ARTIFACT" ;;
  'api repos/fixture/release/actions/runs/123') printf '%s' "$SOURCE_RUN" ;;
  'api repos/fixture/release/actions/artifacts/456/zip') base64 --decode <<< "$ARCHIVE" ;;
  'api repos/fixture/release/releases/42') printf '%s' "$RELEASE" ;;
  'api repos/fixture/release/releases/latest')
    if [[ "$LATEST_STATUS" != 200 ]]; then
      printf 'gh: fixture failure (HTTP %s)\\n' "$LATEST_STATUS" >&2
      exit 1
    fi
    printf '%s' "$LATEST_RELEASE" ;;
  'api repos/fixture/release/releases/42/assets?per_page=100 --paginate --slurp') printf '%s' "$ASSETS" ;;
  'api repos/fixture/release/git/ref/tags/v1.2.3') printf '%s' "$TAG_REF" ;;
  "api repos/fixture/release/git/tags/$TAG_OBJECT_SHA") printf '%s' "$TAG_OBJECT" ;;
  'api --method PATCH repos/fixture/release/releases/42 -F draft=false'*)
    [[ "$PATCH_RESPONSE_LOST" != true ]] || exit 17
    printf '%s' "$PUBLISHED_RELEASE" ;;
  *) exit 88 ;;
esac
`)
    chmodSync(join(directory, 'gh'), 0o755)
    const run = (overrides: Record<string, string> = {}, contents = receipt) => {
      for (const file of [output, log]) writeFileSync(file, '')
      // The GitHub Actions digest covers the ZIP bytes, not the JSON member.
      writeFileSync(join(directory, 'desktop-release-receipt.json'), JSON.stringify(contents))
      const archive = Bun.spawnSync(['python3', '-I', '-m', 'zipfile', '-c', 'receipt.zip', 'desktop-release-receipt.json'], { cwd: directory })
      expect(archive.exitCode, archive.stderr.toString()).toBe(0)
      const bytes = readFileSync(join(directory, 'receipt.zip'))
      const metadata = { id: 456, name: 'desktop-release-receipt-2', expired: false,
        digest: `sha256:${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}`,
        workflow_run: { id: 123, repository_id: 7, head_repository_id: 7, head_sha: head, head_branch: 'main' } }
      const result = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', script], {
        cwd: directory, env: {
          PATH: `${directory}:${process.env.PATH}`, HOME: directory, CLAUDE_CONFIG_DIR: directory,
          RUNNER_TEMP: directory, GITHUB_REPOSITORY: 'fixture/release', GITHUB_REPOSITORY_ID: '7', GITHUB_OUTPUT: output,
          RELEASE_TAG: tag, RELEASE_SHA: sha, STAGED_ARTIFACT_ID: '456', GH_LOG: log,
          ARTIFACT: JSON.stringify(metadata), SOURCE_RUN: JSON.stringify(sourceRun), ARCHIVE: bytes.toString('base64'),
          RELEASE: JSON.stringify(release), ASSETS: JSON.stringify([[assets[1]], [assets[0]]]),
          TAG_REF: JSON.stringify({ object: { type: 'tag', sha: '3'.repeat(40) } }), TAG_OBJECT_SHA: '3'.repeat(40),
          TAG_OBJECT: JSON.stringify({ object: { type: 'commit', sha } }),
          LATEST_STATUS: '200', LATEST_RELEASE: JSON.stringify({ id: 41, tag_name: 'v1.2.2', draft: false, prerelease: false }),
          PATCH_RESPONSE_LOST: 'false', PUBLISHED_RELEASE: JSON.stringify({ ...release, draft: false }), ...overrides,
        },
      })
      return { code: result.exitCode, stderr: result.stderr.toString(), log: readFileSync(log, 'utf8'), output: readFileSync(output, 'utf8') }
    }
    const valid = run()
    expect(valid.code, valid.stderr).toBe(0)
    expect(valid.output).toBe(`release_tag=${tag}\n`)
    const patch = 'api --method PATCH repos/fixture/release/releases/42 -F draft=false'
    expect(valid.log.trim().split('\n').at(-1)).toBe(`${patch} -f make_latest=true`)
    const backfill = run({ LATEST_RELEASE: JSON.stringify({ id: 55, tag_name: 'v1.2.10', draft: false, prerelease: false }) })
    expect(backfill.code, backfill.stderr).toBe(0)
    expect(backfill.log.trim().split('\n').at(-1)).toBe(`${patch} -f make_latest=false`)
    const first = run({ LATEST_STATUS: '404' })
    expect(first.code, first.stderr).toBe(0)
    expect(first.log.trim().split('\n').at(-1)).toBe(`${patch} -f make_latest=true`)
    for (const overrides of [{ LATEST_STATUS: '500' }, { LATEST_RELEASE: '{"tag_name":"v1.2.10"}' }]) {
      const uncertain = run(overrides)
      expect(uncertain.code).not.toBe(0)
      expect(uncertain.log).not.toContain('--method PATCH')
    }
    for (const badRun of [
      { ...sourceRun, head_branch: 'feature' }, { ...sourceRun, path: '.github/workflows/release-desktop.yml' },
      { ...sourceRun, conclusion: 'failure' }, { ...sourceRun, status: 'in_progress' },
      { ...sourceRun, run_attempt: 3 }, { ...sourceRun, head_repository: { id: 8 } },
    ]) {
      const result = run({ SOURCE_RUN: JSON.stringify(badRun) })
      expect(result.code, JSON.stringify(badRun)).not.toBe(0)
      expect(result.log).not.toMatch(/\/zip|--method PATCH/)
    }
    for (const changed of [
      [], [assets[0]], [...assets, { ...assets[0], name: 'extra.exe' }],
      [assets[0], { ...assets[1], digest: `sha256:${'b'.repeat(64)}` }],
      [assets[0], { ...assets[1], digest: null }], [assets[0], { ...assets[1], state: 'starter' }],
    ]) {
      const result = run({ ASSETS: JSON.stringify([changed]) })
      expect(result.code, JSON.stringify(changed)).not.toBe(0)
      expect(result.log).not.toContain('--method PATCH')
    }
    const invalidReleaseFields = [
      { id: 43 }, { id: '42' }, { tag_name: 'v2.0.0' }, { draft: 'true' }, { draft: null },
      { name: 'Edited' }, { name: null }, { body: metadata.body.trimEnd() }, { body: null },
      { prerelease: true }, { prerelease: 'false' }, { prerelease: undefined },
    ]
    for (const draft of [true, false]) {
      const current = { RELEASE: JSON.stringify({ ...release, draft }) }
      for (const changed of [
        ...invalidReleaseFields.map(fields => ({ RELEASE: JSON.stringify({ ...release, draft, ...fields }) })),
        { ARCHIVE: 'AAAA' }, { TAG_REF: JSON.stringify({ object: { type: 'commit', sha: head } }) },
        { ASSETS: JSON.stringify([[...assets, { ...assets[0], name: 'extra.apk' }]]) },
      ]) {
        const result = run({ ...current, ...changed })
        expect(result.code, JSON.stringify(changed)).not.toBe(0)
        expect(result.log).not.toContain('--method PATCH')
        expect(result.output).toBe('')
      }
      for (const changed of [{ release_sha: head }, { metadata: undefined }, { metadata: { ...metadata, prerelease: true } }]) {
        const result = run(current, { ...receipt, ...changed })
        expect(result.code).not.toBe(0)
        expect(result.log).not.toContain('--method PATCH')
      }
    }
    for (const fields of [{ id: 43 }, { draft: 'false' }, { body: 'Edited' }, { prerelease: true }]) {
      const invalidPatch = run({ PUBLISHED_RELEASE: JSON.stringify({ ...release, draft: false, ...fields }) })
      expect(invalidPatch.code).not.toBe(0)
      expect(invalidPatch.output).toBe('')
    }
    const lostResponse = run({ PATCH_RESPONSE_LOST: 'true' })
    expect(lostResponse.code).not.toBe(0)
    expect(lostResponse.output).toBe('')
    expect(lostResponse.log).toContain('--method PATCH')
    const reconciled = run({ RELEASE: JSON.stringify({ ...release, draft: false }) })
    expect(reconciled.code, reconciled.stderr).toBe(0)
    expect(reconciled.output).toBe(`release_tag=${tag}\n`)
    expect(reconciled.log).not.toContain('--method PATCH')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)

test('release recovery uses the main trusted publisher without creating a new version', () => {
  const { on, jobs } = workflow()
  expect(on.workflow_dispatch.inputs.release_tag).toMatchObject({ required: true, type: 'string' })
  expect(on.workflow_dispatch.inputs.release_sha).toMatchObject({ required: true, type: 'string' })
  expect(jobs['release-please'].if).toBe("github.event_name == 'push'")
  expect(jobs['resolve-release'].if).toBe("always() && (needs.release-please.outputs.release_created == 'true' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))")
  expect(jobs['publish-release'].if).toBe("always() && needs.resolve-release.result == 'success' && !inputs.staged_artifact_id")
  expect(jobs['publish-release'].uses).toBe('./.github/workflows/release-desktop.yml')
  expect(jobs['publish-release'].with).toMatchObject({ official_release: true, draft: false })
  const resolver = jobs['resolve-release'].steps.find((step: { id?: string }) => step.id === 'resolve')
  expect(resolver.env.EXPECTED_SHA).toBe('${{ inputs.release_sha || needs.release-please.outputs.release_sha }}')
  expect(resolver.env.RELEASE_TAG).toBe('${{ inputs.release_tag || needs.release-please.outputs.tag_name }}')
  expect(resolver.env.EVENT_NAME).toBe('${{ github.event_name }}')
  expect(resolver.env.WORKFLOW_REF).toBe('${{ github.ref }}')
  expect(resolver.env.STAGED_ARTIFACT_ID).toBe('${{ inputs.staged_artifact_id }}')
})

test('official recovery preserves signed macOS notarization and Gatekeeper checks', () => {
  const steps = parse(readFileSync('.github/workflows/release-desktop.yml', 'utf8')).jobs.build.steps
  const step = (name: string) => steps.find((item: { name: string }) => item.name === name)
  expect(step('Build signed macOS Electron release artifacts').env.MACOS_NOTARIZE).toBe("${{ inputs.official_release == true || github.event_name != 'workflow_dispatch' || inputs.notarize_macos }}")
  expect(step('Verify macOS launch policy').if).toBe("matrix.smoke_platform == 'macos' && needs.signing-preflight.outputs.macos_signed == 'true' && (inputs.official_release == true || github.event_name != 'workflow_dispatch' || inputs.notarize_macos == true)")
  expect(step('Warn macOS notarization skipped').if).toContain('inputs.official_release != true')
})

test('release recovery rejects wrong refs, tag identity, off-main commits and invalid drafts', () => {
  const script = workflow().jobs['resolve-release'].steps.find((step: { id?: string }) => step.id === 'resolve').run
  const directory = mkdtempSync(join(tmpdir(), 'release-recovery-'))
  const output = join(directory, 'output')
  const env = { PATH: `${directory}:${process.env.PATH}`, HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: directory, env })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    return result.stdout.toString().trim()
  }
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Release fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('commit', '-qm', 'release', '--allow-empty')
    const sha = git('rev-parse', 'HEAD')
    git('tag', '-a', 'v1.2.3', '-m', 'release')
    git('update-ref', 'refs/remotes/origin/main', sha)
    git('switch', '-qc', 'unmerged')
    git('commit', '-qm', 'not on main', '--allow-empty')
    const unmerged = git('rev-parse', 'HEAD')
    git('tag', 'v1.2.4')
    writeFileSync(join(directory, 'gh'), '#!/usr/bin/env bash\n[[ "$FAKE_API_FAILURE" != true ]] || exit 17\nprintf \'%s\\n\' "$FAKE_RELEASE_PAGES"\n')
    chmodSync(join(directory, 'gh'), 0o755)
    const release = { id: 42, tag_name: 'v1.2.3', draft: true }
    const run = (overrides: Record<string, string> = {}) => {
      writeFileSync(output, '')
      const result = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', script], {
        cwd: directory,
        env: {
          ...env, EXPECTED_SHA: sha, RELEASE_TAG: 'v1.2.3', EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_REF: 'refs/heads/main', GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'fixture/release',
          CLAUDE_CONFIG_DIR: directory, STAGED_ARTIFACT_ID: '',
          FAKE_RELEASE_PAGES: JSON.stringify([[], [release]]), FAKE_API_FAILURE: 'false', ...overrides,
        },
      })
      return { code: result.exitCode, stderr: result.stderr.toString(), output: readFileSync(output, 'utf8') }
    }
    const valid = run()
    expect(valid.code, valid.stderr).toBe(0)
    expect(valid.output).toBe(`release_tag=v1.2.3\nrelease_sha=${sha}\n`)
    const invalidInputs: Record<string, string>[] = [
      { WORKFLOW_REF: 'refs/heads/feature' },
      { RELEASE_TAG: 'main' },
      { EXPECTED_SHA: 'invalid' },
      { EXPECTED_SHA: unmerged },
      { RELEASE_TAG: 'v1.2.4', EXPECTED_SHA: unmerged },
      { FAKE_API_FAILURE: 'true' },
      { FAKE_RELEASE_PAGES: '[[]]' },
      { FAKE_RELEASE_PAGES: JSON.stringify([[{ ...release, draft: false }]]) },
      { FAKE_RELEASE_PAGES: JSON.stringify([[release], [release]]) },
      { FAKE_RELEASE_PAGES: JSON.stringify([[{ ...release, id: 0 }]]) },
      { FAKE_RELEASE_PAGES: 'invalid json' },
    ]
    for (const overrides of invalidInputs) {
      const result = run(overrides)
      expect(result.code, JSON.stringify(overrides)).not.toBe(0)
      expect(result.output).toBe('')
    }
    // Promotion checks the receipt's exact release ID instead of the staging-only draft lookup.
    const promotion = run({ STAGED_ARTIFACT_ID: '456', FAKE_RELEASE_PAGES: JSON.stringify([[{ ...release, draft: false }]]) })
    expect(promotion.code, promotion.stderr).toBe(0)
    expect(promotion.output).toBe(valid.output)
    expect(run({ STAGED_ARTIFACT_ID: '456', EXPECTED_SHA: unmerged }).code).not.toBe(0)
    // Automatic Release Please staging still resolves without a recovery API call.
    expect(run({ EVENT_NAME: 'push', FAKE_API_FAILURE: 'true' }).code).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
