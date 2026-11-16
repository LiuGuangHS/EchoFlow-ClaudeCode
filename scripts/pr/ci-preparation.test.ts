import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

type Step = {
  id?: string
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
  'working-directory'?: string
  'continue-on-error'?: boolean
}
type Job = {
  if?: string
  needs?: string[]
  steps: Step[]
}
type Workflow = {
  concurrency?: { group: string; 'cancel-in-progress': boolean | string }
  jobs: Record<string, Job>
}

function workflow(name: string): Workflow {
  return parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))
}

const frozenInstall = (step: Step) => step.run === 'bun install --frozen-lockfile'

function requirePreparation(steps: Step[], command: string, workspaces: string[]) {
  const check = steps.findIndex(step => step.run === command)
  expect(check, command).toBeGreaterThanOrEqual(0)
  for (const workspace of workspaces) {
    const install = steps.findIndex(step => frozenInstall(step) && (step['working-directory'] ?? '.') === workspace)
    expect(install, `${command}: ${workspace}`).toBeGreaterThanOrEqual(0)
    expect(install, `${command}: ${workspace}`).toBeLessThan(check)
    expect(steps[install].if).toBeUndefined()
    expect(steps[install]['continue-on-error']).toBeUndefined()
  }
  return check
}

describe('quality CI dependency preparation', () => {
  test.each(['pr-quality', 'nightly-quality', 'push-quality'])(
    '%s caches Bun downloads with platform, actual version, lockfiles and dependency-set identity', name => {
      const jobs = workflow(name).jobs
      let cachedJobs = 0
      for (const [jobId, job] of Object.entries(jobs)) {
        const steps = job.steps
        const installs = steps.filter(frozenInstall)
        for (const step of steps.filter(step => step.uses?.startsWith('actions/cache@'))) {
          expect(String(step.with?.path), `${name}/${jobId}`).not.toContain('node_modules')
        }
        if (installs.length === 0) continue
        cachedJobs++
        const caches = steps.filter(step => step.uses === 'actions/cache@v5' && step.with?.path === '~/.bun/install/cache')
        expect(caches.length, `${name}/${jobId}`).toBe(1)
        const cache = caches[0]
        const key = String(cache.with?.key)
        for (const component of ['${{ runner.os }}', '${{ runner.arch }}', '${{ github.workflow }}', '${{ github.job }}']) {
          expect(key, `${name}/${jobId}`).toContain(component)
        }
        // All current Bun dependency sets are hashed. No broad restore prefix may
        // cross platforms, Bun versions or dependency sets.
        expect(key).toContain("${{ hashFiles('**/bun.lock', '**/bun.lockb') }}")
        expect(cache.with?.['restore-keys']).toBeUndefined()
        const versionReference = key.match(/\$\{\{ steps\.([\w-]+)\.outputs\.version \}\}/)
        expect(versionReference, `${name}/${jobId}: actual Bun version`).not.toBeNull()
        const version = steps.findIndex(step => step.id === versionReference![1])
        const setup = steps.findIndex(step => step.uses === 'oven-sh/setup-bun@v2')
        expect(setup).toBeGreaterThanOrEqual(0)
        expect(steps[setup].with?.['bun-version-file']).toBe('package.json')
        expect(version).toBeGreaterThan(setup)
        expect(steps[version].run).toBe('printf \'version=%s\\n\' "$(bun --version)" >> "$GITHUB_OUTPUT"')
        expect(steps.indexOf(cache)).toBeGreaterThan(version)
        for (const install of installs) {
          expect(steps.indexOf(cache)).toBeLessThan(steps.indexOf(install))
          const expectedCondition = name === 'pr-quality' && jobId === 'policy-enforcement'
            ? "needs.scope-plan.outputs.policy_checks == 'true'"
            : undefined
          expect(install.if).toBe(expectedCondition)
          expect(cache.if).toBe(expectedCondition)
          expect(steps[version].if).toBe(expectedCondition)
          expect(install['continue-on-error']).toBeUndefined()
        }
        // A cold or warm cache must not change whether installs/checks run.
        expect(job.if ?? '').not.toContain('cache')
        for (const step of steps) {
          expect(step.if ?? '').not.toContain('cache')
          expect(step.run ?? '').not.toContain('cache-hit')
          if (/\bbun install\b/.test(step.run ?? '')) expect(frozenInstall(step)).toBe(true)
        }
      }
      expect(cachedJobs).toBeGreaterThan(0)
    },
  )

  test('scope planning stays dependency-free and does not restore a download cache', () => {
    const steps = workflow('pr-quality').jobs['scope-plan'].steps
    expect(steps.some(step => /\b(?:bun|npm) (?:install|ci)\b/.test(step.run ?? ''))).toBe(false)
    expect(steps.some(step => step.uses?.startsWith('actions/cache@'))).toBe(false)
  })

  test('nightly npm downloads cover both installed npm lockfiles', () => {
    const steps = workflow('nightly-quality').jobs['full-deterministic'].steps
    const node = steps.findIndex(step => step.uses === 'actions/setup-node@v5')
    expect(node).toBeGreaterThanOrEqual(0)
    expect(steps[node].with?.cache).toBe('npm')
    expect(String(steps[node].with?.['cache-dependency-path']).trim().split(/\s+/).sort())
      .toEqual(['harness/package-lock.json', 'site/package-lock.json'])
    for (const command of ['npm --prefix harness ci', 'bun run check:docs']) {
      expect(steps.findIndex(step => step.run === command)).toBeGreaterThan(node)
    }
  })

  test('manual runtime checks prepare ripgrep and the real Host harness without dropping checks', () => {
    const jobs = workflow('push-quality').jobs
    const steps = jobs.server.steps
    const check = requirePreparation(steps, 'bun run check:server', ['.', 'desktop', 'adapters'])
    const ripgrep = steps.findIndex(step => step.run?.includes('apt-get install') && /\bripgrep\b/.test(step.run))
    expect(ripgrep).toBeGreaterThanOrEqual(0)
    expect(ripgrep).toBeLessThan(check)
    expect(steps[ripgrep].if).toBeUndefined()
    const node = steps.findIndex(step => step.uses === 'actions/setup-node@v5' && String(step.with?.['node-version']) === '24')
    const harness = steps.findIndex(step => step.run === 'npm --prefix harness ci')
    expect(node).toBeGreaterThanOrEqual(0)
    expect(harness).toBeGreaterThan(node)
    expect(harness).toBeLessThan(check)
    expect(steps[harness].if).toBeUndefined()
    expect(steps.filter(step => step.run?.startsWith('bun run check:')).map(step => step.run)).toEqual([
      'bun run check:server',
      'bun run check:provider-contract',
      'bun run check:chat-contract',
      'bun run check:agent-flow',
      'bun run check:adapters',
    ])
    expect(jobs['push-quality-gate'].needs).toEqual(['contract', 'policy', 'server', 'desktop'])
    expect(jobs['push-quality-gate'].if).toBe('always()')
  })

  test('manual desktop checks install sidecar adapters and phone H5 dependencies with Node 22', () => {
    const steps = workflow('push-quality').jobs.desktop.steps
    const check = requirePreparation(steps, 'bun run check:desktop', ['.', 'desktop', 'adapters', 'mobile'])
    const node = steps.findIndex(step => step.uses === 'actions/setup-node@v5' && String(step.with?.['node-version']) === '22')
    const mobile = steps.findIndex(step => frozenInstall(step) && step['working-directory'] === 'mobile')
    expect(node).toBeGreaterThanOrEqual(0)
    expect(node).toBeLessThan(mobile)
    expect(node).toBeLessThan(check)
    expect(steps[node].if).toBeUndefined()
  })

  test('nightly selection drift uses the complete-tree entrypoint without a path cap', () => {
    const steps = workflow('nightly-quality').jobs['selection-drift'].steps
    const graph = steps.findIndex(step => step.run === 'bun test ./scripts/pr/module-graph.test.ts')
    const fullTree = steps.findIndex(step => step.run?.trim() === [
      'git ls-files -z > "$RUNNER_TEMP/full-tree.nul"',
      'bun run scripts/pr/change-policy.ts --files0 "$RUNNER_TEMP/full-tree.nul" --plan-only',
    ].join('\n'))
    expect(graph).toBeGreaterThanOrEqual(0)
    expect(fullTree).toBeGreaterThan(graph)
    expect(steps[fullTree].if).toBeUndefined()
    expect(steps[fullTree]['continue-on-error']).toBeUndefined()
    expect(steps.some(step => /head\s+-\d+/.test(step.run ?? ''))).toBe(false)
  })

  test('native jobs supersede only the same PR, keeping pushes in SHA-specific groups', () => {
    const native = workflow('native-computer-use')
    expect(native.concurrency).toEqual({
      group: 'native-computer-use-${{ github.event.pull_request.number || github.sha }}',
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    })
    expect(native.concurrency?.['cancel-in-progress']).toBe(workflow('pr-quality').concurrency?.['cancel-in-progress'])
  })
})
