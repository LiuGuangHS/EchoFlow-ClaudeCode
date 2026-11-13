import { describe, expect, spyOn, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentPackageSmokeArch, currentPackageSmokePlatform, currentReleaseArtifactsDir, lanesForMode } from './modes'
import { renderJUnitReport, renderMarkdownReport } from './reporter'
import { runQualityGate, runQualityGateLanes } from './runner'
import type { LaneDefinition, QualityGateReport } from './types'

describe('quality gate modes', () => {
  test('pr mode includes existing path-aware PR checks', () => {
    const lanes = lanesForMode('pr').map((lane) => lane.id)
    expect(lanes).toContain('impact-report')
    expect(lanes).toContain('policy-checks')
    expect(lanes).toContain('desktop-checks')
    expect(lanes).toContain('mobile-checks')
    expect(lanes).toContain('server-checks')
    expect(lanes).toContain('provider-contract-checks')
    expect(lanes).toContain('chat-contract-checks')
    expect(lanes).toContain('adapter-checks')
    expect(lanes).toContain('native-checks')
    expect(lanes).toContain('docs-checks')
    expect(lanes).toContain('persistence-upgrade')
    expect(lanes).not.toContain('quarantine')
    expect(lanes).toContain('coverage')
    expect(lanes.some((lane) => lane.startsWith('baseline:'))).toBe(false)
  })

  test('PR and release always check public content and generated product identity', () => {
    for (const mode of ['pr', 'release'] as const) {
      for (const [id, command] of [
        ['public-content-checks', 'check:upstream-content'],
        ['product-identity-checks', 'check:product-identity'],
      ]) {
        const lane = lanesForMode(mode).find(candidate => candidate.id === id)
        expect(lane, `${id} missing from ${mode}`).toBeDefined()
        expect(lane?.command).toEqual(['bun', 'run', command])
        expect(lane?.impactRequiredCheck).toBeUndefined()
        expect(lane?.live).toBeUndefined()
      }
    }
  })

  test('runs the deterministic agent flow in every mode without requiring a live provider', () => {
    for (const mode of ['pr', 'baseline', 'release'] as const) {
      const lane = lanesForMode(mode).find((candidate) => candidate.id === 'agent-flow-checks')
      expect(lane, `agent-flow-checks missing from ${mode} mode`).toBeDefined()
      // `live` gates a lane behind --allow-live. The agent flow must never be gated:
      // it is the only end-to-end proof a contributor without credentials can run.
      expect(lane?.live).toBeUndefined()
      expect(lane?.command).toEqual(['bun', 'run', 'check:agent-flow'])
      expect(lane?.impactRequiredCheck).toBe('bun run check:agent-flow')
    }
  })

  test('baseline mode includes live baseline cases but not native checks', () => {
    const lanes = lanesForMode('baseline').map((lane) => lane.id)
    expect(lanes).toContain('baseline-catalog')
    expect(lanes).toContain('quarantine')
    expect(lanes).toContain('coverage')
    expect(lanes).toContain('baseline:failing-unit:current-runtime')
    expect(lanes).toContain('provider-smoke:current-runtime')
    expect(lanes).toContain('baseline:multi-file-api:current-runtime')
    expect(lanes).toContain('desktop-smoke:agent-browser-chat:current-runtime')
    expect(lanes).not.toContain('native-checks')
  })

  test('release mode composes PR, baseline, and native lanes', () => {
    const laneDefinitions = lanesForMode('release')
    const lanes = laneDefinitions.map((lane) => lane.id)
    const packageSmokePlatform = currentPackageSmokePlatform()
    const packageSmokeArch = currentPackageSmokeArch()
    expect(lanes).toContain('policy-checks')
    expect(lanes).toContain('desktop-checks')
    expect(lanes).toContain('mobile-checks')
    expect(lanes).toContain('server-checks')
    expect(lanes).toContain('provider-contract-checks')
    expect(lanes).toContain('chat-contract-checks')
    expect(lanes).toContain('adapter-checks')
    expect(lanes).toContain('docs-checks')
    expect(lanes).toContain('persistence-upgrade')
    expect(lanes).toContain('quarantine')
    expect(lanes).toContain('coverage')
    expect(lanes).toContain('baseline:failing-unit:current-runtime')
    expect(lanes).toContain('provider-smoke:current-runtime')
    expect(lanes).not.toContain('desktop-smoke:agent-browser-chat:current-runtime')
    if (packageSmokePlatform) {
      expect(lanes).toContain(`desktop-package-smoke:${packageSmokePlatform}`)
      const packageSmokeLane = laneDefinitions.find((lane) => lane.id === `desktop-package-smoke:${packageSmokePlatform}`)
      expect(packageSmokeLane?.command).toContain('--package-kind')
      expect(packageSmokeLane?.command).toContain('release')
      expect(packageSmokeLane?.command).toContain('--artifacts-dir')
      if (packageSmokeArch) {
        expect(packageSmokeLane?.command).toContain('--arch')
        expect(packageSmokeLane?.command).toContain(packageSmokeArch)
      }
      if (packageSmokePlatform === 'macos') {
        expect(packageSmokeLane?.command).toContain('--require-macos-gatekeeper')
      }
    }
    expect(lanes).toContain('native-checks')
  })

  test('maps host platforms to package-smoke platform names', () => {
    expect(currentPackageSmokePlatform('darwin')).toBe('macos')
    expect(currentPackageSmokePlatform('win32')).toBe('windows')
    expect(currentPackageSmokePlatform('linux')).toBe('linux')
    expect(currentPackageSmokePlatform('freebsd')).toBeNull()
    expect(currentPackageSmokeArch('arm64')).toBe('arm64')
    expect(currentPackageSmokeArch('x64')).toBe('x64')
    expect(currentPackageSmokeArch('ia32')).toBeNull()
    expect(currentReleaseArtifactsDir('darwin', 'arm64')).toBe('desktop/build-artifacts/macos-arm64')
    expect(currentReleaseArtifactsDir('darwin', 'x64')).toBe('desktop/build-artifacts/macos-x64')
    expect(currentReleaseArtifactsDir('win32', 'x64')).toBe('desktop/build-artifacts/windows-x64')
    expect(currentReleaseArtifactsDir('linux', 'arm64')).toBe('desktop/build-artifacts/linux-arm64')
    expect(currentReleaseArtifactsDir('freebsd', 'x64')).toBeNull()
  })

  test('baseline mode expands cases across explicit provider/model targets', () => {
    const lanes = lanesForMode('baseline', [
      { providerId: 'provider-a', modelId: 'model-a', label: 'provider-a-model-a' },
      { providerId: 'provider-b', modelId: 'model-b', label: 'provider-b-model-b' },
    ]).map((lane) => lane.id)

    expect(lanes).toContain('baseline:failing-unit:provider-a-model-a')
    expect(lanes).toContain('baseline:failing-unit:provider-b-model-b')
    expect(lanes).toContain('baseline:multi-file-api:provider-a-model-a')
    expect(lanes).toContain('baseline:multi-file-api:provider-b-model-b')
    expect(lanes).toContain('provider-smoke:provider-a-model-a')
    expect(lanes).toContain('provider-smoke:provider-b-model-b')
    expect(lanes).toContain('desktop-smoke:agent-browser-chat:provider-a-model-a')
    expect(lanes).toContain('desktop-smoke:agent-browser-chat:provider-b-model-b')
  })
})

describe('runQualityGate', () => {
  test('writes dry-run reports without executing expensive commands', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    try {
      const { report, outputDir } = await runQualityGate({
        mode: 'baseline',
        dryRun: true,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'dry-run-test',
      })

      expect(report.mode).toBe('baseline')
      expect(report.summary.failed).toBe(0)
      expect(report.summary.skipped).toBeGreaterThan(0)
      expect(report.results.find((result) => result.id === 'coverage')?.category).toBe('coverage')
      expect(report.results.find((result) => result.id.startsWith('baseline:'))?.live).toBe(true)
      expect(readFileSync(join(outputDir, 'report.json'), 'utf8')).toContain('"mode": "baseline"')
      expect(readFileSync(join(outputDir, 'report.md'), 'utf8')).toContain('# Quality Gate Report')
      expect(readFileSync(join(outputDir, 'report.md'), 'utf8')).toContain('## Result Matrix')
      expect(readFileSync(join(outputDir, 'junit.xml'), 'utf8')).toContain('<testsuite name="quality-gate.baseline"')
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('continues through later lanes after a failure so reports show full impact', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const lanes: LaneDefinition[] = [
      {
        id: 'first-lane',
        title: 'First lane',
        description: 'Fails intentionally',
        kind: 'command',
        command: ['false'],
        requiredForModes: ['pr'],
      },
      {
        id: 'second-lane',
        title: 'Second lane',
        description: 'Still runs',
        kind: 'command',
        command: ['true'],
        requiredForModes: ['pr'],
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'pr',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'continue-after-failure-test',
      }, lanes, async (lane) => ({
        id: lane.id,
        title: lane.title,
        status: lane.id === 'first-lane' ? 'failed' : 'passed',
        command: lane.command,
        durationMs: 1,
        exitCode: lane.id === 'first-lane' ? 1 : 0,
      }))

      expect(report.results.map((result) => result.id)).toEqual(['first-lane', 'second-lane'])
      expect(report.summary).toEqual({
        passed: 1,
        failed: 1,
        skipped: 0,
      })
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('filters lanes by exact id or prefix selector', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    try {
      const { report } = await runQualityGate({
        mode: 'baseline',
        dryRun: true,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'filter-lanes-test',
        onlyLaneSelectors: ['provider-smoke:*'],
      })

      expect(report.results.length).toBe(1)
      expect(report.results[0].id).toBe('provider-smoke:current-runtime')
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('command lanes persist per-lane logs', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const lanes: LaneDefinition[] = [
      {
        id: 'log-lane',
        title: 'Log lane',
        description: 'Writes output',
        kind: 'command',
        command: ['bun', '--version'],
        requiredForModes: ['pr'],
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'pr',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'command-log-test',
      }, lanes)

      const logPath = report.results[0].logPath
      expect(report.results[0].status).toBe('passed')
      expect(logPath).toBeTruthy()
      expect(readFileSync(logPath!, 'utf8')).toContain('$ bun --version')
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('skips PR local check lanes when the impact report does not require them', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const lanes: LaneDefinition[] = [
      {
        id: 'impact-report',
        title: 'Impact report',
        description: 'Writes selected local checks',
        kind: 'command',
        command: ['bash', '-lc', [
          'printf "%s\\n"',
          '"# PR impact report"',
          '""',
          '"Changed files: 1"',
          '"Areas: server"',
          '"Labels: none"',
          '"Blocked: no"',
          '""',
          '"## Required local checks"',
          '"- bun run check:server"',
        ].join(' ')],
        requiredForModes: ['pr'],
      },
      {
        id: 'desktop-checks',
        title: 'Desktop checks',
        description: 'Should be skipped',
        kind: 'command',
        command: ['bash', '-lc', 'exit 7'],
        impactRequiredCheck: 'bun run check:desktop',
        requiredForModes: ['pr'],
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'pr',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'impact-selected-skip-test',
      }, lanes)

      expect(report.results.map((result) => result.status)).toEqual(['passed', 'skipped'])
      expect(report.results[1].skipReason).toContain('not required by impact report')
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('runs PR local check lanes selected by the impact report', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const lanes: LaneDefinition[] = [
      {
        id: 'impact-report',
        title: 'Impact report',
        description: 'Writes selected local checks',
        kind: 'command',
        command: ['bash', '-lc', [
          'printf "%s\\n"',
          '"# PR impact report"',
          '""',
          '"Changed files: 1"',
          '"Areas: desktop"',
          '"Labels: none"',
          '"Blocked: no"',
          '""',
          '"## Required local checks"',
          '"- bun run check:desktop"',
        ].join(' ')],
        requiredForModes: ['pr'],
      },
      {
        id: 'desktop-checks',
        title: 'Desktop checks',
        description: 'Should run',
        kind: 'command',
        command: ['bash', '-lc', 'exit 0'],
        impactRequiredCheck: 'bun run check:desktop',
        requiredForModes: ['pr'],
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'pr',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'impact-selected-run-test',
      }, lanes)

      expect(report.results.map((result) => result.status)).toEqual(['passed', 'passed'])
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('hydrates impact and coverage summaries from generated command artifacts', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const coverageDir = join(artifactsDir, 'coverage-output')
    mkdirSync(coverageDir, { recursive: true })
    writeFileSync(join(coverageDir, 'coverage-report.md'), '# Coverage Report\n')
    writeFileSync(join(coverageDir, 'coverage-report.json'), JSON.stringify({
      suites: [
        {
          id: 'desktop',
          title: 'Desktop React',
          status: 'passed',
          summary: {
            lines: { pct: 88, covered: 88, total: 100 },
            functions: { pct: 80, covered: 8, total: 10 },
            branches: { pct: 75, covered: 15, total: 20 },
            statements: { pct: 88, covered: 88, total: 100 },
          },
        },
      ],
      failures: [],
    }) + '\n')

    const lanes: LaneDefinition[] = [
      {
        id: 'impact-report',
        title: 'Impact report',
        description: 'Summarize changed areas',
        kind: 'command',
        command: ['bun', 'run', 'check:impact'],
        requiredForModes: ['pr'],
        category: 'scope',
      },
      {
        id: 'coverage',
        title: 'Coverage gate',
        description: 'Run coverage',
        kind: 'command',
        command: ['bun', 'run', 'check:coverage'],
        requiredForModes: ['pr'],
        category: 'coverage',
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'pr',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'artifact-summary-test',
      }, lanes, async (lane, options) => {
        const logPath = join(options.runOutputDir!, 'logs', `${lane.id}.log`)
        mkdirSync(join(options.runOutputDir!, 'logs'), { recursive: true })
        if (lane.id === 'impact-report') {
          writeFileSync(logPath, [
            '# PR impact report',
            '',
            'Changed files: 2',
            'Areas: desktop, server',
            'Labels: none',
            'Blocked: no',
            '',
            '## Required local checks',
            '- `bun run check:desktop`',
            '',
            '## Test coverage signals',
            '- No obvious missing-test signal from changed paths.',
            '',
            '## Risk notes',
            '- Desktop state/API layer changed.',
          ].join('\n'))
        } else {
          writeFileSync(logPath, `Coverage report: ${join(coverageDir, 'coverage-report.md')}\nSummary: passed=1 failed=0\n`)
        }
        return {
          id: lane.id,
          title: lane.title,
          status: 'passed',
          command: lane.command,
          durationMs: 1,
          exitCode: 0,
          logPath,
        }
      })

      expect(report.impact?.changedFiles).toBe(2)
      expect(report.impact?.requiredChecks).toEqual(['`bun run check:desktop`'])
      expect(report.coverage?.suites[0].lines?.pct).toBe(88)
      expect(report.artifacts.map((artifact) => artifact.path)).toContain(join(coverageDir, 'coverage-report.md'))
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('fails PR mode when the impact report is blocked by policy', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const lanes: LaneDefinition[] = [
      {
        id: 'impact-report',
        title: 'Impact report',
        description: 'Writes a blocked policy decision',
        kind: 'command',
        command: ['bash', '-lc', [
          'printf "%s\\n"',
          '"# PR impact report"',
          '""',
          '"Changed files: 1"',
          '"Areas: cli-core"',
          '"Labels: none"',
          '"Blocked: yes"',
          '"Blocking reasons:"',
          '"- CLI core changes require maintainer approval."',
          '""',
          '"## Required local checks"',
          '"- bun run check:server"',
        ].join(' ')],
        requiredForModes: ['pr'],
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'pr',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'blocked-impact-test',
      }, lanes)

      expect(report.impact?.blocked).toBe(true)
      expect(report.results[0].status).toBe('failed')
      expect(report.results[0].error).toContain('change policy blocked')
      expect(report.summary.failed).toBe(1)
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  test('release mode treats skipped live lanes as failures', async () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), 'quality-gate-test-'))
    const lanes: LaneDefinition[] = [
      {
        id: 'live-lane',
        title: 'Live lane',
        description: 'Requires release evidence',
        kind: 'provider-smoke',
        live: true,
        requiredForModes: ['release'],
      },
    ]

    try {
      const { report } = await runQualityGateLanes({
        mode: 'release',
        dryRun: false,
        allowLive: false,
        baselineTargets: [],
        rootDir: process.cwd(),
        artifactsDir,
        runId: 'release-live-skipped-test',
      }, lanes, async (lane) => ({
        id: lane.id,
        title: lane.title,
        status: 'skipped',
        durationMs: 1,
        skipReason: 'missing credentials',
      }))

      expect(report.summary).toEqual({
        passed: 0,
        failed: 1,
        skipped: 0,
      })
      expect(report.results[0].error).toBe('missing credentials')
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })
})

describe('candidate provenance', () => {
  const lane: LaneDefinition = {
    id: 'fixture', title: 'Fixture', description: 'Offline fixture', kind: 'command',
    command: ['true'], requiredForModes: ['pr'],
  }
  const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'quality-candidate-'))
    const root = join(dir, 'repo')
    mkdirSync(root)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    git('init', '-q')
    // Fixture identity is not PR policy context.
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(root, '.gitignore'), 'ignored\n')
    writeFileSync(join(root, 'tracked'), 'base\n')
    git('add', '.')
    git('commit', '-qm', 'fixture')
    const options = {
      mode: 'pr' as const, dryRun: false, allowLive: false, baselineTargets: [],
      rootDir: root, artifactsDir: join(dir, 'reports'), runId: 'fixture',
    }
    const run = (change: () => void = () => {}) => runQualityGateLanes(options, [lane], async () => {
      change()
      return { id: lane.id, title: lane.title, status: 'passed', durationMs: 0, exitCode: 0 }
    })
    return { dir, root, git, options, run }
  }

  test('records full HEAD, separate dirty digests and actual runner identity without rejecting unchanged dirt', async () => {
    const f = fixture()
    try {
      f.git('config', 'diff.external', 'false')
      f.git('config', 'diff.fixture.textconv', 'false')
      writeFileSync(join(f.root, '.gitattributes'), 'tracked diff=fixture\n')
      writeFileSync(join(f.root, 'tracked'), 'index\n')
      f.git('add', 'tracked')
      writeFileSync(join(f.root, 'tracked'), 'worktree\n')
      writeFileSync(join(f.root, 'untracked\nfile'), Buffer.from([0, 255, 1]))
      const { report } = await f.run()
      expect(report.candidate?.status).toBe('stable')
      expect(report.candidate?.failures).toEqual([])
      const before = report.candidate?.before
      expect(before?.status).toBe('valid')
      if (before?.status !== 'valid') throw new Error('missing fingerprint')
      expect(before.head).toBe(f.git('rev-parse', 'HEAD'))
      expect(before.head).toMatch(/^[a-f0-9]{40}$/)
      expect(before.indexDiffSha256).not.toBe(sha256(''))
      expect(before.worktreeDiffSha256).not.toBe(sha256(''))
      expect(before.indexDiffSha256).not.toBe(before.worktreeDiffSha256)
      const diff = ['--binary', '--full-index', '--no-ext-diff', '--no-textconv']
      expect(before.indexDiffSha256).toBe(sha256(execFileSync('git', ['diff', '--cached', ...diff, 'HEAD', '--'], { cwd: f.root })))
      expect(before.worktreeDiffSha256).toBe(sha256(execFileSync('git', ['diff', ...diff, '--'], { cwd: f.root })))
      expect(before.untrackedSha256).not.toBe(sha256(''))
      expect(report.candidate?.after).toEqual(before)
      expect(report.git).toEqual({ sha: before.head, dirty: true })
      expect(report.runtime).toEqual({
        name: 'bun', version: Bun.version, executable: process.execPath,
        argv: process.argv, platform: process.platform, arch: process.arch,
      })
      expect(report.summary).toEqual({ passed: 1, failed: 0, skipped: 0 })
      expect(report.status).toBe('passed')
      expect(report.candidate?.limitation).toContain('change-and-restore')
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })

  for (const change of ['index', 'text', 'binary', 'mode', 'symlink', 'delete', 'head', 'tracked-mode'] as const) {
    test(`fails the candidate, not the passing lane, on ${change} drift in every report format`, async () => {
      const f = fixture()
      try {
        writeFileSync(join(f.root, 'loose'), 'old\n')
        f.git('config', 'core.filemode', 'false')
        const { report, outputDir } = await f.run(() => {
          if (change === 'index') {
            writeFileSync(join(f.root, 'tracked'), 'staged\n')
            f.git('add', 'tracked')
            writeFileSync(join(f.root, 'tracked'), 'base\n')
          }
          if (change === 'text') writeFileSync(join(f.root, 'loose'), 'new\n')
          if (change === 'binary') writeFileSync(join(f.root, 'loose'), Buffer.from([0, 255, 2]))
          if (change === 'mode') chmodSync(join(f.root, 'loose'), 0o755)
          if (change === 'symlink') {
            unlinkSync(join(f.root, 'loose'))
            symlinkSync('/nonexistent-outside-repo', join(f.root, 'loose'))
          }
          if (change === 'delete') unlinkSync(join(f.root, 'loose'))
          if (change === 'head') f.git('commit', '--allow-empty', '-qm', 'next')
          if (change === 'tracked-mode') chmodSync(join(f.root, 'tracked'), 0o755)
        })
        expect(report.summary).toEqual({ passed: 1, failed: 0, skipped: 0 })
        expect(report.status).toBe('failed')
        expect(report.candidate?.status).toBe('changed')
        expect(report.candidate?.failures.length).toBeGreaterThan(0)
        const json = JSON.parse(readFileSync(join(outputDir, 'report.json'), 'utf8'))
        expect(json.status).toBe('failed')
        expect(json.results[0].status).toBe('passed')
        const markdown = readFileSync(join(outputDir, 'report.md'), 'utf8')
        expect(markdown).toContain('Candidate status: changed')
        expect(markdown).toContain('Candidate Failures')
        expect(markdown).toContain('Passed: 1')
        const junit = readFileSync(join(outputDir, 'junit.xml'), 'utf8')
        expect(junit).toContain('tests="2" failures="1"')
        expect(junit).toContain('name="candidate-provenance"')
      } finally { rmSync(f.dir, { recursive: true, force: true }) }
    })
  }

  test('canonicalizes NUL-separated paths, hashes binary bytes and ignores link targets and ignored files', async () => {
    const f = fixture()
    try {
      const target = join(f.dir, 'external')
      writeFileSync(target, 'outside-one')
      symlinkSync(target, join(f.root, 'link'))
      writeFileSync(join(f.root, 'z\nfile'), Buffer.from([0, 255]))
      writeFileSync(join(f.root, 'a'), 'a')
      const first = await f.run()
      expect(first.report.candidate?.status).toBe('stable')
      const { report } = await f.run(() => {
        writeFileSync(target, 'outside-two')
        writeFileSync(join(f.root, 'ignored'), 'ignored')
        unlinkSync(join(f.root, 'a'))
        writeFileSync(join(f.root, 'a'), 'a')
      })
      expect(report.candidate?.status).toBe('stable')
      expect(report.candidate?.before).toEqual(first.report.candidate?.before)
      const changed = await f.run(() => {
        unlinkSync(join(f.root, 'link'))
        symlinkSync(join(f.dir, 'different-missing-target'), join(f.root, 'link'))
      })
      expect(changed.report.candidate?.status).toBe('changed')
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })

  test('records unknown endpoints and fails closed on Git/read errors instead of claiming clean', async () => {
    const f = fixture()
    try {
      const { report } = await f.run(() => rmSync(join(f.root, '.git'), { recursive: true }))
      expect(report.candidate?.before.status).toBe('valid')
      expect(report.candidate?.after.status).toBe('unknown')
      expect(report.candidate?.status).toBe('invalid')
      expect(report.status).toBe('failed')
      expect(report.git).toEqual({ sha: null, dirty: null })
      expect(renderMarkdownReport(report)).toContain('Dirty worktree: unknown')
      const invalidBefore = await f.run()
      expect(invalidBefore.report.candidate?.before.status).toBe('unknown')
      expect(invalidBefore.report.status).toBe('failed')
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })

  test('marks an untracked file read failure unknown rather than hashing an empty file', async () => {
    const f = fixture()
    try {
      const unreadable = join(f.root, 'unreadable')
      writeFileSync(unreadable, 'not empty')
      chmodSync(unreadable, 0o000)
      try {
        expect(() => readFileSync(unreadable)).toThrow()
        const { report } = await f.run()
        expect(report.candidate?.status).toBe('invalid')
        expect(report.candidate?.before.status).toBe('unknown')
        expect(report.status).toBe('failed')
      } finally { chmodSync(unreadable, 0o600) }
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })

  test('persists executor rejection and spawn failure, preserves partial logs and continues independent lanes', async () => {
    const f = fixture()
    try {
      const second = { ...lane, id: 'second' }
      const { report } = await runQualityGateLanes(f.options, [lane, second], async (current, options) => {
        if (current.id === lane.id) {
          mkdirSync(join(options.runOutputDir!, 'logs'), { recursive: true })
          writeFileSync(join(options.runOutputDir!, 'logs', 'fixture.log'), 'partial output\n')
          throw new Error('executor fixture rejection')
        }
        return { id: current.id, title: current.title, status: 'passed', durationMs: 0 }
      })
      expect(report.results.map(result => result.status)).toEqual(['failed', 'passed'])
      expect(report.summary).toEqual({ passed: 1, failed: 1, skipped: 0 })
      expect(report.results[0].command).toEqual(['true'])
      expect(report.results[0].error).toContain('executor fixture rejection')
      expect(readFileSync(report.results[0].logPath!, 'utf8')).toContain('partial output\n')
      expect(readFileSync(report.results[0].logPath!, 'utf8')).toContain('executor fixture rejection')
      const spawned = await runQualityGateLanes(f.options, [{ ...lane, command: ['/nonexistent-fixture-executable'] }, second])
      expect(spawned.report.results.map(result => result.status)).toEqual(['failed', 'passed'])
      expect(readFileSync(spawned.report.results[0].logPath!, 'utf8')).toContain('/nonexistent-fixture-executable')
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })

  test('records command termination signal and fails even if the exit code is zero', async () => {
    const f = fixture()
    const original = Bun.spawn
    const spawn = spyOn(Bun, 'spawn').mockImplementation(((command: string[], options: unknown) => {
      if (command[0] !== 'signal-fixture') return original(command, options as never)
      // No process signals: model the subprocess result at the existing spawn boundary.
      return { exited: Promise.resolve(0), signalCode: 'SIGTERM', stdout: new Response('partial\n').body, stderr: null }
    }) as typeof Bun.spawn)
    try {
      const { report } = await runQualityGateLanes(f.options, [{ ...lane, command: ['signal-fixture'] }])
      expect(report.results[0].status).toBe('failed')
      expect(report.results[0].signalCode).toBe('SIGTERM')
      expect(readFileSync(report.results[0].logPath!, 'utf8')).toContain('SIGTERM')
      expect(renderMarkdownReport(report)).toContain('Signal: SIGTERM')
      expect(renderJUnitReport(report)).toContain('SIGTERM')
    } finally {
      spawn.mockRestore()
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test('CLI exits nonzero on drift even when every selected lane passed', async () => {
    const f = fixture()
    try {
      const baseline = join(f.root, 'scripts', 'quality-gate', 'baseline')
      mkdirSync(baseline, { recursive: true })
      writeFileSync(join(baseline, 'cases.test.ts'), [
        "import { test } from 'bun:test'",
        "import { writeFileSync } from 'node:fs'",
        "test('offline fixture mutation', () => writeFileSync('tracked', 'changed by fixture'))",
      ].join('\n'))
      const proc = Bun.spawn([
        process.execPath, '--no-env-file', join(import.meta.dir, 'index.ts'),
        '--mode', 'baseline', '--only', 'baseline-catalog', '--artifacts-dir', f.options.artifactsDir,
      ], { cwd: f.root, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      expect(code).toBe(1)
      expect(stdout).toContain('passed=1 failed=0 skipped=0')
      expect(stdout).toContain('Candidate: changed')
      const reportPath = stdout.match(/Quality gate report: (.+)\/report.md/)?.[1]
      expect(reportPath).toBeTruthy()
      const report = JSON.parse(readFileSync(join(reportPath!, 'report.json'), 'utf8'))
      expect(report.status).toBe('failed')
      expect(report.results[0].status).toBe('passed')
      expect(report.candidate.status).toBe('changed')
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })

  test('CLI exits nonzero for candidate failure despite zero failed lanes and preserves reports', async () => {
    const f = fixture()
    try {
      rmSync(join(f.root, '.git'), { recursive: true })
      const proc = Bun.spawn([
        process.execPath, '--no-env-file', join(import.meta.dir, 'index.ts'),
        '--mode', 'baseline', '--dry-run', '--only', 'baseline-catalog', '--artifacts-dir', f.options.artifactsDir,
      ], { cwd: f.root, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      expect(stderr).toBe('')
      expect(stdout).toContain('failed=0')
      expect(code).toBe(1)
      const reportPath = stdout.match(/Quality gate report: (.+)\/report.md/)?.[1]
      expect(reportPath).toBeTruthy()
      const report = JSON.parse(readFileSync(join(reportPath!, 'report.json'), 'utf8'))
      expect(report.candidate.status).toBe('invalid')
      expect(report.summary.failed).toBe(0)
      expect(report.status).toBe('failed')
    } finally { rmSync(f.dir, { recursive: true, force: true }) }
  })
})

describe('renderMarkdownReport', () => {
  test('renders command, skip reason, and summary', () => {
    const report: QualityGateReport = {
      schemaVersion: 1,
      runId: 'example',
      mode: 'pr',
      dryRun: true,
      allowLive: false,
      startedAt: '2026-05-02T00:00:00.000Z',
      finishedAt: '2026-05-02T00:00:01.000Z',
      rootDir: process.cwd(),
      git: {
        sha: 'abc123',
        dirty: true,
      },
      results: [
        {
          id: 'impact-report',
          title: 'Impact report',
          description: 'Summarize changed areas.',
          category: 'scope',
          live: false,
          status: 'skipped',
          command: ['bun', 'run', 'check:impact'],
          durationMs: 1,
          skipReason: 'dry run',
          logPath: '/tmp/impact-report.log',
        },
      ],
      summary: {
        passed: 0,
        failed: 0,
        skipped: 1,
      },
      artifacts: [],
    }

    const markdown = renderMarkdownReport(report)
    expect(markdown).toContain('Skipped: 1')
    expect(markdown).toContain('Test scope')
    expect(markdown).toContain('`bun run check:impact`')
    expect(markdown).toContain('dry run')
    expect(markdown).toContain('/tmp/impact-report.log')
  })

  test('renders impact and coverage summaries in one markdown report', () => {
    const report: QualityGateReport = {
      schemaVersion: 1,
      runId: 'example',
      mode: 'pr',
      dryRun: false,
      allowLive: false,
      startedAt: '2026-05-02T00:00:00.000Z',
      finishedAt: '2026-05-02T00:00:03.000Z',
      rootDir: process.cwd(),
      git: {
        sha: 'abc123',
        dirty: false,
      },
      results: [
        {
          id: 'coverage',
          title: 'Coverage gate',
          category: 'coverage',
          live: false,
          status: 'passed',
          command: ['bun', 'run', 'check:coverage'],
          durationMs: 2500,
          logPath: '/tmp/coverage.log',
        },
      ],
      impact: {
        changedFiles: 3,
        areas: ['desktop', 'server'],
        labels: ['allow-cli-core-change'],
        blocked: false,
        requiredChecks: ['`bun run check:desktop`', '`bun run check:coverage`'],
        testCoverageSignals: ['No obvious missing-test signal from changed paths.'],
        riskNotes: ['Session runtime changed.'],
      },
      coverage: {
        reportPath: '/tmp/coverage-report.md',
        failures: [],
        suites: [
          {
            id: 'desktop',
            title: 'Desktop React',
            status: 'passed',
            lines: { pct: 82, covered: 82, total: 100 },
            functions: { pct: 80, covered: 8, total: 10 },
            branches: { pct: 75, covered: 15, total: 20 },
            statements: { pct: 82, covered: 82, total: 100 },
          },
        ],
      },
      artifacts: [{ title: 'Coverage report markdown', path: '/tmp/coverage-report.md' }],
      summary: {
        passed: 1,
        failed: 0,
        skipped: 0,
      },
    }

    const markdown = renderMarkdownReport(report)
    expect(markdown).toContain('Changed files: 3')
    expect(markdown).toContain('| Desktop React | passed | 82% (82/100)')
    expect(markdown).toContain('Coverage report markdown: /tmp/coverage-report.md')
  })

  test('renders JUnit report for CI test-summary consumers', () => {
    const report: QualityGateReport = {
      schemaVersion: 1,
      runId: 'example',
      mode: 'release',
      dryRun: false,
      allowLive: true,
      startedAt: '2026-05-02T00:00:00.000Z',
      finishedAt: '2026-05-02T00:00:02.000Z',
      rootDir: process.cwd(),
      git: {
        sha: 'abc123',
        dirty: false,
      },
      results: [
        {
          id: 'provider-smoke:example',
          title: 'Provider smoke',
          category: 'smoke',
          live: true,
          status: 'failed',
          durationMs: 500,
          error: 'API <error>',
          logPath: '/tmp/provider.log',
        },
      ],
      summary: {
        passed: 0,
        failed: 1,
        skipped: 0,
      },
      artifacts: [],
    }

    const junit = renderJUnitReport(report)
    expect(junit).toContain('testsuite name="quality-gate.release"')
    expect(junit).toContain('failures="1"')
    expect(junit).toContain('API &lt;error&gt;')
    expect(junit).toContain('/tmp/provider.log')
  })
})
