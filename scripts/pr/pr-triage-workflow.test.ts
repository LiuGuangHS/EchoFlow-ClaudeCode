import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

async function runTriage(filenames: string[], options: { author?: string, labels?: string[], routing?: unknown } = {}) {
  const workflow = parse(readFileSync('.github/workflows/pr-triage.yml', 'utf8'))
  const script = workflow.jobs.triage.steps[0].with.script
  const requests: Array<{ path: string, ref: string }> = []
  const labels: string[] = []
  let body = ''
  const github = {
    paginate: async (_method: unknown, params: { pull_number?: number }) => params.pull_number
      ? filenames.map(filename => ({ filename })) : [],
    rest: {
      pulls: { listFiles: () => {} },
      repos: { getContent: async (request: { path: string, ref: string }) => {
        requests.push(request)
        const content = request.path === '.github/CODEOWNERS' ? '* @trusted-owner\n'
          : JSON.stringify(options.routing ?? JSON.parse(readFileSync('scripts/pr/area-routing.json', 'utf8')))
        return { data: { type: 'file', content: Buffer.from(content).toString('base64') } }
      } },
      issues: {
        createLabel: async () => {},
        addLabels: async (request: { labels: string[] }) => { labels.push(...request.labels) },
        removeLabel: async () => {},
        listComments: () => {},
        createComment: async (request: { body: string }) => { body = request.body },
      },
    },
  }
  const context = { repo: { owner: 'test', repo: 'repo' }, payload: { pull_request: {
    number: 1, base: { sha: 'trusted-base-sha', ref: 'main' },
    user: { login: options.author ?? 'contributor' }, labels: (options.labels ?? []).map(name => ({ name })),
  } } }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction('github', 'context', 'core', script)(github, context, { warning: () => {} })
  return { requests, labels, body }
}

describe('PR triage workflow comment', () => {
  test('uses base SHA routing data, including exclusions and instruction files', async () => {
    const result = await runTriage(['custom/file.md', 'src/server/service.test.ts', 'src/AGENTS.md'], {
      routing: { areas: {
        mobile: { prefixes: ['custom/'] },
        'cli-core': { prefixes: ['src/'], excludePrefixes: ['src/server/'] },
      } },
    })
    expect(result.requests).toContainEqual(expect.objectContaining({ path: 'scripts/pr/area-routing.json', ref: 'trusted-base-sha' }))
    expect(result.labels).toEqual(['area:mobile'])
    expect(result.body).toContain('PR Quality / scope-plan')
  })

  test('routes restored surfaces and blocks non-owner root runtime changes', async () => {
    const result = await runTriage(['mobile/app.md', 'native/helper.md', 'site/page.md', 'harness/fixture.md', 'src/services/example.test.ts'])
    for (const area of ['mobile', 'desktop', 'docs', 'harness', 'cli-core']) {
      expect(result.labels).toContain(`area:${area}`)
    }
    expect(result.labels).toContain('needs-maintainer-approval')
  })

  test('preserves trusted CODEOWNER exemption without bypassing missing tests or coverage policy', async () => {
    const approved = await runTriage(['src/services/example.test.ts'], { author: 'TRUSTED-OWNER' })
    expect(approved.labels).not.toContain('needs-maintainer-approval')
    expect(approved.requests).toContainEqual(expect.objectContaining({ path: '.github/CODEOWNERS', ref: 'main' }))
    expect(approved.body).toContain('CLI-core change authored by a CODEOWNER')
    const blocked = await runTriage(['src/services/example.ts', 'scripts/quality-gate/coverage-baseline.json'], { author: 'trusted-owner' })
    expect(blocked.labels).toContain('needs-maintainer-approval')
    expect(blocked.body).toContain('Blocked by policy until a maintainer applies `allow-missing-tests`')
    expect(blocked.body).toContain('Blocked by policy until a maintainer applies `allow-coverage-baseline-change`')
  })

  test('requires tests in each changed adapter package', async () => {
    const blocked = await runTriage(['adapters/alpha/index.ts', 'adapters/beta/index.test.ts'])
    expect(blocked.labels).toContain('needs-maintainer-approval')
    expect(blocked.body).toContain('matching adapter test file in the PR: adapters/alpha')
    const covered = await runTriage(['adapters/alpha/index.ts', 'adapters/alpha/index.test.ts'])
    expect(covered.labels).not.toContain('needs-maintainer-approval')
  })

  test('points workflow changes at the authoritative policy lane', () => {
    const workflow = readFileSync('.github/workflows/pr-triage.yml', 'utf8')
    expect(workflow).toContain('policy-enforcement')
    expect(workflow).not.toContain('const cliPrefixes')
    expect(workflow).not.toContain('const docsExact')
    expect(workflow).not.toContain('const releaseExact')
  })

  test('uses base routing exact paths and rejects unknown areas', async () => {
    const result = await runTriage(['custom.md'], { routing: { areas: { docs: { exact: ['custom.md'] } } } })
    expect(result.labels).toEqual(['area:docs'])
    await expect(runTriage(['custom.md'], { routing: { areas: { unknown: { exact: ['custom.md'] } } } })).rejects.toThrow('Unknown area label')
  })

  test('keeps AI review out of the deterministic quality contract', () => {
    const workflow = readFileSync('.github/workflows/pr-triage.yml', 'utf8')

    expect(workflow).toContain('Hard merge gates come from the deterministic GitHub Actions contract lanes above.')
    expect(workflow).not.toContain('@dosubot')
  })

  test('does not execute untrusted PR code from pull_request_target', () => {
    const workflow = readFileSync('.github/workflows/pr-triage.yml', 'utf8')

    expect(workflow).toContain('pull_request_target:')
    expect(workflow).not.toContain('actions/checkout')
    expect(workflow).not.toContain('bun install')
    expect(workflow).not.toContain('pull_request.head.sha')
    expect(workflow).not.toContain('--allow-live')
    expect(workflow).not.toContain('secrets.')
  })

  test('exempts CODEOWNER-authored CLI core changes using base-branch CODEOWNERS', () => {
    const workflow = readFileSync('.github/workflows/pr-triage.yml', 'utf8')

    expect(workflow).toContain("path: '.github/CODEOWNERS', ref: context.payload.pull_request.base.ref")
    expect(workflow).toContain("const cliCoreApproved = currentLabels.has('allow-cli-core-change') || authorIsCodeOwner")
    expect(workflow).toContain('if (cliCoreFiles.length > 0 && !cliCoreApproved) {')
  })

  test('surfaces missing-test and coverage-baseline policy branches', () => {
    const workflow = readFileSync('.github/workflows/pr-triage.yml', 'utf8')

    expect(workflow).toContain("'allow-missing-tests': 'c2e0c6'")
    expect(workflow).toContain("'allow-coverage-baseline-change': 'c2e0c6'")
    expect(workflow).toContain('See `PR Quality / scope-plan`; it is the single source of truth for selected jobs.')
    expect(workflow).not.toContain('requiredChecks.push(')
    expect(workflow).toContain('Coverage baseline policy')
    expect(workflow).toContain('coveragePolicyFiles')
    expect(workflow).toContain('Root runtime product files changed without a matching root runtime test file in the PR.')
    expect(workflow).toContain('BLOCKING unless \\`allow-missing-tests\\` is applied')
  })
})
