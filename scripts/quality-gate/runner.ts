import { appendFileSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { baselineCases } from './baseline/cases'
import { executeBaselineCase } from './baseline/execute'
import { executeDesktopSmoke } from './desktop-smoke/execute'
import { lanesForMode } from './modes'
import { executeProviderSmoke } from './provider-smoke/execute'
import { writeReport } from './reporter'
import type {
  CandidateFingerprint,
  CoverageSuiteSummary,
  ImpactSummary,
  LaneCategory,
  LaneDefinition,
  LaneResult,
  QualityGateOptions,
  QualityGateReport,
  ReportArtifact,
} from './types'

type LaneExecutor = (lane: LaneDefinition, options: QualityGateOptions) => Promise<LaneResult>

function nowId() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function gitOutput(args: string[], cwd: string) {
  const proc = Bun.spawn(['git', '-c', 'core.fsmonitor=false', '-c', 'core.filemode=true', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, , code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ])
  if (code !== 0 || proc.signalCode) {
    throw new Error(`git ${args[0]} failed (exit ${code}, signal ${proc.signalCode ?? 'none'})`)
  }
  return Buffer.from(stdout)
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

async function fingerprint(rootDir: string): Promise<CandidateFingerprint> {
  let stage = 'HEAD'
  try {
    const head = (await gitOutput(['rev-parse', '--verify', 'HEAD'], rootDir)).toString().trim()
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) throw new Error('invalid full HEAD')
    const diffArgs = ['--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames']
    stage = 'index diff'
    const indexDiffSha256 = sha256(await gitOutput(['diff', '--cached', ...diffArgs, 'HEAD', '--'], rootDir))
    stage = 'worktree diff'
    const worktreeDiffSha256 = sha256(await gitOutput(['diff', ...diffArgs, '--'], rootDir))
    stage = 'untracked files'
    const listed = await gitOutput(['ls-files', '--others', '--exclude-standard', '-z'], rootDir)
    const paths: Buffer[] = []
    let start = 0
    for (let i = 0; i < listed.length; i += 1) {
      if (listed[i] === 0) {
        paths.push(listed.subarray(start, i))
        start = i + 1
      }
    }
    if (start !== listed.length) throw new Error('unterminated Git path list')
    const hash = createHash('sha256')
    const frame = (value: Buffer | string) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
      hash.update(`${bytes.length}\0`).update(bytes)
    }
    const root = Buffer.from(resolve(rootDir) + sep)
    for (const path of paths.sort(Buffer.compare)) {
      // Keep raw filename bytes; reject symlink ancestors instead of reading through them.
      for (let i = 0; i < path.length; i += 1) {
        if (path[i] === 47 && !lstatSync(Buffer.concat([root, path.subarray(0, i)])).isDirectory()) {
          throw new Error('untracked path has a non-directory ancestor')
        }
      }
      const absolute = Buffer.concat([root, path])
      const stat = lstatSync(absolute)
      frame(path)
      frame(String(stat.mode & 0o777))
      if (stat.isSymbolicLink()) {
        frame('symlink')
        frame(readlinkSync(absolute, { encoding: 'buffer' }))
      } else if (stat.isFile()) {
        frame('file')
        const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          frame(sha256(readFileSync(fd)))
        } finally {
          closeSync(fd)
        }
      } else {
        throw new Error('unsupported untracked file type')
      }
    }
    return { status: 'valid', head, indexDiffSha256, worktreeDiffSha256, untrackedSha256: hash.digest('hex') }
  } catch (error) {
    return { status: 'unknown', error: `${stage}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function candidateProvenance(before: CandidateFingerprint, after: CandidateFingerprint): NonNullable<QualityGateReport['candidate']> {
  const failures: string[] = []
  if (before.status === 'unknown') failures.push(`Before fingerprint unknown: ${before.error}`)
  if (after.status === 'unknown') failures.push(`After fingerprint unknown: ${after.error}`)
  const invalid = failures.length > 0
  if (before.status === 'valid' && after.status === 'valid') {
    for (const key of ['head', 'indexDiffSha256', 'worktreeDiffSha256', 'untrackedSha256'] as const) {
      if (before[key] !== after[key]) failures.push(`Candidate changed: ${key}`)
    }
  }
  return {
    before, after,
    status: invalid ? 'invalid' : failures.length ? 'changed' : 'stable',
    failures,
    limitation: 'Endpoint equality only; cannot detect intermediate change-and-restore. Collection is not an atomic filesystem snapshot.',
  }
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

function matchesLaneSelector(lane: LaneDefinition, selector: string) {
  const normalized = selector.trim()
  if (!normalized) return false
  if (normalized.endsWith('*')) {
    return lane.id.startsWith(normalized.slice(0, -1))
  }
  return lane.id === normalized
}

function filterLanesForOptions(lanes: LaneDefinition[], options: QualityGateOptions) {
  const only = options.onlyLaneSelectors?.filter(Boolean) ?? []
  const skip = options.skipLaneSelectors?.filter(Boolean) ?? []
  let selected = lanes

  if (only.length > 0) {
    selected = selected.filter((lane) => only.some((selector) => matchesLaneSelector(lane, selector)))
  }
  if (skip.length > 0) {
    selected = selected.filter((lane) => !skip.some((selector) => matchesLaneSelector(lane, selector)))
  }
  if (selected.length === 0) {
    throw new Error(`No quality gate lanes matched selectors. only=${only.join(',') || 'none'} skip=${skip.join(',') || 'none'}`)
  }

  return selected
}

async function pipeToLog(
  stream: ReadableStream<Uint8Array> | null,
  logPath: string,
  write: (chunk: Buffer) => void,
) {
  if (!stream) return
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = Buffer.from(value)
    appendFileSync(logPath, chunk)
    write(chunk)
  }
}

async function runCommandLane(lane: LaneDefinition, options: QualityGateOptions): Promise<LaneResult> {
  const started = Date.now()
  const command = lane.command ?? []
  const artifactRoot = options.runOutputDir ?? join(options.rootDir, 'artifacts', 'quality-runs', options.runId ?? 'current')
  const logPath = join(artifactRoot, 'logs', `${sanitizeId(lane.id)}.log`)

  if (options.dryRun) {
    mkdirSync(dirname(logPath), { recursive: true })
    writeFileSync(logPath, `$ ${command.join(' ')}\n[quality-gate] skipped: dry run\n`)
    return {
      id: lane.id,
      title: lane.title,
      status: 'skipped',
      command,
      durationMs: Date.now() - started,
      skipReason: 'dry run',
      logPath,
    }
  }

  mkdirSync(dirname(logPath), { recursive: true })
  writeFileSync(logPath, `$ ${command.join(' ')}\n`)

  if (options.mode === 'pr' && lane.impactRequiredCheck) {
    const requiredChecks = readImpactRequiredChecks(options)
    if (!requiredChecks) {
      const error = `Impact report unavailable before ${lane.impactRequiredCheck}`
      appendFileSync(logPath, `[quality-gate] failed: ${error}\n`)
      return {
        id: lane.id,
        title: lane.title,
        status: 'failed',
        command,
        durationMs: Date.now() - started,
        error,
        logPath,
      }
    }

    const requiredCheck = normalizeImpactCheck(lane.impactRequiredCheck)
    if (!requiredChecks.includes(requiredCheck)) {
      const skipReason = `${requiredCheck} not required by impact report`
      appendFileSync(logPath, `[quality-gate] skipped: ${skipReason}\n`)
      return {
        id: lane.id,
        title: lane.title,
        status: 'skipped',
        command,
        durationMs: Date.now() - started,
        skipReason,
        logPath,
      }
    }
  }

  const streamLogs = process.env.QUALITY_GATE_STREAM_LOGS === '1'
  const writeStdout = streamLogs ? (chunk: Buffer) => process.stdout.write(chunk) : () => {}
  const writeStderr = streamLogs ? (chunk: Buffer) => process.stderr.write(chunk) : () => {}
  const proc = Bun.spawn(command, {
    cwd: options.rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode] = await Promise.all([
    proc.exited,
    pipeToLog(proc.stdout, logPath, writeStdout),
    pipeToLog(proc.stderr, logPath, writeStderr),
  ])

  const signalCode = proc.signalCode
  if (signalCode) appendFileSync(logPath, `[quality-gate] terminated by signal: ${signalCode}\n`)
  return {
    id: lane.id,
    title: lane.title,
    status: exitCode === 0 && !signalCode ? 'passed' : 'failed',
    command,
    durationMs: Date.now() - started,
    exitCode,
    signalCode,
    ...(signalCode ? { error: `Command terminated by signal: ${signalCode}` } : {}),
    logPath,
  }
}

async function runBaselineCaseLane(lane: LaneDefinition, options: QualityGateOptions): Promise<LaneResult> {
  const started = Date.now()

  if (!options.allowLive) {
    return {
      id: lane.id,
      title: lane.title,
      status: 'skipped',
      durationMs: Date.now() - started,
      skipReason: 'live baseline cases require --allow-live',
    }
  }

  const caseId = lane.baselineCaseId ?? lane.id.replace(/^baseline:/, '').split(':')[0]
  const testCase = baselineCases.find((candidate) => candidate.id === caseId)
  if (!testCase) {
    return {
      id: lane.id,
      title: lane.title,
      status: 'failed',
      durationMs: Date.now() - started,
      error: `Unknown baseline case: ${caseId}`,
    }
  }

  const artifactRoot = options.runOutputDir ?? join(options.rootDir, 'artifacts', 'quality-runs', options.runId ?? 'current')
  return executeBaselineCase(
    testCase,
    options.rootDir,
    join(artifactRoot, 'cases', lane.id.replace(/[^a-zA-Z0-9._-]+/g, '-')),
    lane.baselineTarget,
  )
}

async function runLane(lane: LaneDefinition, options: QualityGateOptions): Promise<LaneResult> {
  if (lane.kind === 'baseline-case') {
    return runBaselineCaseLane(lane, options)
  }
  if (lane.kind === 'desktop-smoke') {
    const started = Date.now()

    if (!options.allowLive) {
      return {
        id: lane.id,
        title: lane.title,
        status: 'skipped',
        durationMs: Date.now() - started,
        skipReason: 'desktop agent-browser smoke requires --allow-live',
      }
    }

    const artifactRoot = options.runOutputDir ?? join(options.rootDir, 'artifacts', 'quality-runs', options.runId ?? 'current')
    return executeDesktopSmoke(
      options.rootDir,
      join(artifactRoot, 'cases', lane.id.replace(/[^a-zA-Z0-9._-]+/g, '-')),
      lane.id,
      lane.title,
      lane.baselineTarget,
    )
  }

  if (lane.kind === 'provider-smoke') {
    const started = Date.now()

    if (!options.allowLive) {
      return {
        id: lane.id,
        title: lane.title,
        status: 'skipped',
        durationMs: Date.now() - started,
        skipReason: 'provider smoke requires --allow-live',
      }
    }

    const artifactRoot = options.runOutputDir ?? join(options.rootDir, 'artifacts', 'quality-runs', options.runId ?? 'current')
    return executeProviderSmoke(
      options.rootDir,
      join(artifactRoot, 'cases', lane.id.replace(/[^a-zA-Z0-9._-]+/g, '-')),
      lane.id,
      lane.title,
      lane.baselineTarget,
    )
  }

  return runCommandLane(lane, options)
}

function summarize(results: LaneResult[]) {
  return {
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  }
}

function defaultCategoryForLane(lane: LaneDefinition): LaneCategory {
  if (lane.category) return lane.category
  if (lane.id === 'impact-report') return 'scope'
  if (lane.id === 'coverage') return 'coverage'
  if (lane.id === 'native-checks') return 'native'
  if (lane.kind === 'baseline-case') return 'integration'
  if (lane.kind === 'provider-smoke' || lane.kind === 'desktop-smoke') return 'smoke'
  if (lane.id.includes('test') || lane.id.includes('checks')) return 'unit'
  return 'governance'
}

function withLaneMetadata(lane: LaneDefinition, result: LaneResult): LaneResult {
  return {
    ...result,
    description: lane.description,
    category: defaultCategoryForLane(lane),
    live: Boolean(lane.live),
  }
}

function readText(path: string | undefined) {
  if (!path || !existsSync(path)) return null
  return readFileSync(path, 'utf8')
}

function readSection(lines: string[], heading: string) {
  const items: string[] = []
  let active = false

  for (const line of lines) {
    if (line.startsWith('## ')) {
      active = line.trim() === `## ${heading}`
      continue
    }

    if (!active) continue
    if (line.startsWith('- ')) {
      items.push(line.slice(2).trim())
    }
  }

  return items
}

function normalizeImpactCheck(value: string) {
  return value.replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

function impactReportLogPath(options: QualityGateOptions) {
  const artifactRoot = options.runOutputDir ?? join(options.rootDir, 'artifacts', 'quality-runs', options.runId ?? 'current')
  return join(artifactRoot, 'logs', 'impact-report.log')
}

function readImpactRequiredChecks(options: QualityGateOptions) {
  const log = readText(impactReportLogPath(options))
  if (!log) return null
  return readSection(log.split(/\r?\n/), 'Required local checks').map(normalizeImpactCheck)
}

function splitSummaryList(value: string | undefined) {
  if (!value || value === 'none') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseImpactSummary(results: LaneResult[]): ImpactSummary | undefined {
  const impact = results.find((result) => result.id === 'impact-report')
  const log = readText(impact?.logPath)
  if (!log) return undefined

  const lines = log.split(/\r?\n/)
  const findValue = (label: string) => {
    const prefix = `${label}:`
    return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim()
  }

  const changedFiles = Number(findValue('Changed files'))

  return {
    ...(Number.isFinite(changedFiles) ? { changedFiles } : {}),
    areas: splitSummaryList(findValue('Areas')),
    labels: splitSummaryList(findValue('Labels')),
    blocked: findValue('Blocked') === 'yes' ? true : findValue('Blocked') === 'no' ? false : undefined,
    requiredChecks: readSection(lines, 'Required local checks'),
    testCoverageSignals: readSection(lines, 'Test coverage signals'),
    riskNotes: readSection(lines, 'Risk notes'),
  }
}

function coverageReportPathFromLog(results: LaneResult[]) {
  const coverage = results.find((result) => result.id === 'coverage')
  const log = readText(coverage?.logPath)
  if (!log) return null
  return log.match(/Coverage report:\s*(.+coverage-report\.md)/)?.[1]?.trim() ?? null
}

function parseCoverageSummary(results: LaneResult[]) {
  const reportPath = coverageReportPathFromLog(results)
  if (!reportPath) return undefined

  const jsonPath = reportPath.replace(/coverage-report\.md$/, 'coverage-report.json')
  if (!existsSync(jsonPath)) return undefined

  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
    suites?: Array<CoverageSuiteSummary & {
      summary?: Pick<CoverageSuiteSummary, 'lines' | 'functions' | 'branches' | 'statements'>
    }>
    failures?: string[]
  }

  return {
    reportPath,
    suites: (parsed.suites ?? []).map((suite) => ({
      id: suite.id,
      title: suite.title,
      status: suite.status,
      lines: suite.lines ?? suite.summary?.lines,
      functions: suite.functions ?? suite.summary?.functions,
      branches: suite.branches ?? suite.summary?.branches,
      statements: suite.statements ?? suite.summary?.statements,
    })),
    failures: parsed.failures ?? [],
  }
}

function collectReportArtifacts(outputDir: string, results: LaneResult[]): ReportArtifact[] {
  const artifacts: ReportArtifact[] = [
    { title: 'Quality report markdown', path: join(outputDir, 'report.md') },
    { title: 'Quality report JSON', path: join(outputDir, 'report.json') },
    { title: 'Quality report JUnit', path: join(outputDir, 'junit.xml') },
  ]

  const coveragePath = coverageReportPathFromLog(results)
  if (coveragePath) {
    artifacts.push({ title: 'Coverage report markdown', path: coveragePath })
    artifacts.push({ title: 'Coverage report JSON', path: coveragePath.replace(/coverage-report\.md$/, 'coverage-report.json') })
  }

  return artifacts
}

function enforceReleaseLiveLanes(
  options: QualityGateOptions,
  lanes: LaneDefinition[],
  results: LaneResult[],
) {
  if (options.mode !== 'release' || options.dryRun) {
    return results
  }

  return results.map((result, index) => {
    if (result.status !== 'skipped' || !lanes[index]?.live) {
      return result
    }

    return {
      ...result,
      status: 'failed' as const,
      error: result.skipReason ?? 'release live lane was skipped',
      skipReason: undefined,
    }
  })
}

function enforceBlockedImpact(
  options: QualityGateOptions,
  results: LaneResult[],
) {
  if (options.dryRun || (options.mode !== 'pr' && options.mode !== 'release')) {
    return results
  }

  const impact = parseImpactSummary(results)
  if (!impact?.blocked) {
    return results
  }

  return results.map((result) => {
    if (result.id !== 'impact-report' || result.status === 'failed') {
      return result
    }

    return {
      ...result,
      status: 'failed' as const,
      exitCode: result.exitCode === 0 ? 1 : result.exitCode,
      error: 'Local change policy blocked this diff; inspect the impact report and use maintainer overrides only when explicitly approved.',
    }
  })
}

export async function runQualityGate(options: QualityGateOptions) {
  return runQualityGateLanes(options, lanesForMode(options.mode, options.baselineTargets))
}

export async function runQualityGateLanes(
  options: QualityGateOptions,
  lanes: LaneDefinition[],
  executeLane: LaneExecutor = runLane,
) {
  const runId = options.runId ?? nowId()
  const startedAt = new Date().toISOString()
  const artifactsRoot = options.artifactsDir ?? join(options.rootDir, 'artifacts', 'quality-runs')
  const outputDir = join(artifactsRoot, runId)
  mkdirSync(outputDir, { recursive: true })
  const selectedLanes = filterLanesForOptions(lanes, options)

  const runOptions = { ...options, runId, runOutputDir: outputDir }
  const before = await fingerprint(options.rootDir)
  const rawResults: LaneResult[] = []
  for (const lane of selectedLanes) {
    const started = Date.now()
    let result: LaneResult
    try {
      result = await executeLane(lane, runOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const logPath = join(outputDir, 'logs', `${sanitizeId(lane.id)}.log`)
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `[quality-gate] executor failed: ${message}\n`)
      result = {
        id: lane.id, title: lane.title, command: lane.command, status: 'failed',
        durationMs: Date.now() - started, error: message, logPath,
      }
    }
    rawResults.push(withLaneMetadata(lane, result))
  }
  const after = await fingerprint(options.rootDir)
  const candidate = candidateProvenance(before, after)
  const releaseResults = enforceReleaseLiveLanes(options, selectedLanes, rawResults)
  const results = enforceBlockedImpact(options, releaseResults)

  const report: QualityGateReport = {
    schemaVersion: 1,
    runId,
    mode: options.mode,
    dryRun: options.dryRun,
    allowLive: options.allowLive,
    startedAt,
    finishedAt: new Date().toISOString(),
    rootDir: options.rootDir,
    git: {
      sha: after.status === 'valid' ? after.head : null,
      dirty: after.status === 'valid'
        ? [after.indexDiffSha256, after.worktreeDiffSha256, after.untrackedSha256].some(value => value !== sha256(''))
        : null,
    },
    status: candidate.failures.length || results.some(result => result.status === 'failed') ? 'failed' : 'passed',
    candidate,
    runtime: {
      name: process.versions.bun ? 'bun' : 'node',
      version: process.versions.bun ?? process.versions.node,
      executable: process.execPath,
      argv: [...process.argv],
      platform: process.platform,
      arch: process.arch,
    },
    results,
    impact: parseImpactSummary(results),
    coverage: parseCoverageSummary(results),
    artifacts: collectReportArtifacts(outputDir, results),
    summary: summarize(results),
  }

  writeReport(report, outputDir)
  return { report, outputDir }
}
