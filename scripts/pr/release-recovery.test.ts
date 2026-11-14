import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const workflow = () => parse(readFileSync('.github/workflows/release-please.yml', 'utf8'))

test('release recovery uses the main trusted publisher without creating a new version', () => {
  const { on, jobs } = workflow()
  expect(on.workflow_dispatch.inputs.release_tag).toMatchObject({ required: true, type: 'string' })
  expect(on.workflow_dispatch.inputs.release_sha).toMatchObject({ required: true, type: 'string' })
  expect(jobs['release-please'].if).toBe("github.event_name == 'push'")
  expect(jobs['resolve-release'].if).toBe("always() && (needs.release-please.outputs.release_created == 'true' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))")
  expect(jobs['publish-release'].if).toBe("always() && needs.resolve-release.result == 'success'")
  expect(jobs['publish-release'].uses).toBe('./.github/workflows/release-desktop.yml')
  expect(jobs['publish-release'].with).toMatchObject({ official_release: true, draft: false })
  const resolver = jobs['resolve-release'].steps.find((step: { id?: string }) => step.id === 'resolve')
  expect(resolver.env.EXPECTED_SHA).toBe('${{ inputs.release_sha || needs.release-please.outputs.release_sha }}')
  expect(resolver.env.RELEASE_TAG).toBe('${{ inputs.release_tag || needs.release-please.outputs.tag_name }}')
  expect(resolver.env.EVENT_NAME).toBe('${{ github.event_name }}')
  expect(resolver.env.WORKFLOW_REF).toBe('${{ github.ref }}')
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
    // Automatic Release Please publication still resolves without a recovery API call.
    expect(run({ EVENT_NAME: 'push', FAKE_API_FAILURE: 'true' }).code).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
