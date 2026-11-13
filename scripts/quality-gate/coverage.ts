#!/usr/bin/env bun

import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep, win32 } from 'node:path'
import { rootBunTestFilter } from '../pr/bun-test-filter'
import { createSandboxedTestEnvironment, removeTestSandbox } from '../pr/test-environment'
import { loadQuarantineManifest, quarantinedPathSet } from './quarantine'

type CoverageMetric = {
  total: number
  covered: number
  pct: number
}

type CoverageSummary = {
  lines: CoverageMetric
  functions: CoverageMetric
  branches: CoverageMetric
  statements: CoverageMetric
}

type CoverageScope = {
  id: string
  title: string
  includePrefixes: string[]
  excludePrefixes?: string[]
  excludePathFragments?: string[]
  excludeSuffixes?: string[]
}

type CommandTermination = {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  error?: string
}

type ChangedLineScope = {
  strategy: 'explicit-base' | 'dirty-worktree' | 'branch-fallback' | 'none'
  baseRef?: string
  diffArgs?: string[]
  includes: { committed: boolean; staged: boolean; unstaged: boolean; untracked: boolean }
  error?: string
}

type SuiteCoverage = {
  id: string
  title: string
  status: 'passed' | 'failed'
  command: string[]
  durationMs: number
  summary?: CoverageSummary
  logPath: string
  exitCode?: number | null
  signalCode?: NodeJS.Signals | null
  lcovAvailable?: boolean
  error?: string
  note?: string
}

type CoverageThresholds = {
  schemaVersion: 1
  minimums: Record<string, Partial<Record<keyof CoverageSummary, number>>>
  targets?: Record<string, Partial<Record<keyof CoverageSummary, number>>>
  changedLines?: {
    minimumPercent: number
  }
  ratchet?: {
    baselinePath: string
    allowedDropPercent: number
  }
}

type BaselineFile = {
  schemaVersion: 1
  generatedAt?: string
  suites: Record<string, CoverageSummary>
}

type CoverageReport = {
  schemaVersion: 1
  runId: string
  startedAt: string
  finishedAt: string
  outputDir: string
  baselineRef?: string
  suites: SuiteCoverage[]
  changedLines?: ChangedLineCoverage
  targetGaps: string[]
  failures: string[]
}

type LcovRecord = {
  file: string
  linesTotal: number
  linesCovered: number
  functionsTotal: number
  functionsCovered: number
  branchesTotal: number
  branchesCovered: number
  lineHits: Map<number, number>
}

type FileLineCoverage = {
  suiteId: string
  executableLines: Set<number>
  coveredLines: Set<number>
}

type ChangedLineCoverage = {
  scope?: ChangedLineScope
  minimumPercent: number
  covered: number
  total: number
  pct: number
  /** Changed lines in scopes whose suite failed: not counted, never shown as 0%. */
  unmeasured?: number
  files: Array<{
    file: string
    suiteId: string
    covered: number
    total: number
    pct: number
    unmeasured?: true
    reason?: string
  }>
  failures: string[]
}

const ROOT_DIR = process.cwd()
const DEFAULT_THRESHOLDS_PATH = join(ROOT_DIR, 'scripts', 'quality-gate', 'coverage-thresholds.json')

const ROOT_COVERAGE_SCOPES: CoverageScope[] = [
  {
    id: 'server-api',
    title: 'Server/API',
    includePrefixes: ['src/server/'],
    excludePathFragments: ['/__tests__/', '/fixtures/', '/__fixtures__/'],
    excludeSuffixes: ['.test.ts', '.test.tsx'],
  },
  {
    id: 'agent-tools',
    title: 'Agent tools',
    includePrefixes: ['src/tools/'],
    excludePathFragments: ['/__tests__/', '/fixtures/', '/__fixtures__/'],
    excludeSuffixes: ['.test.ts', '.test.tsx'],
  },
  {
    id: 'agent-utils',
    title: 'Agent utils',
    includePrefixes: ['src/utils/'],
    excludePathFragments: ['/__tests__/', '/fixtures/', '/__fixtures__/'],
    excludeSuffixes: ['.test.ts', '.test.tsx'],
  },
]

const ADAPTERS_SCOPE: CoverageScope = {
  id: 'adapters',
  title: 'IM adapters',
  includePrefixes: ['adapters/'],
  excludePrefixes: ['adapters/node_modules/'],
  excludePathFragments: ['/__tests__/', '/fixtures/', '/__fixtures__/'],
  excludeSuffixes: ['.test.ts', '.test.tsx', '.d.ts'],
}

/**
 * Coverage answers "is this tested", never "should this exist". Three components sat
 * at zero because nothing imported them any more, and the gate read that as missing
 * tests: 598b968ee wrote suites for two of them to clear the threshold, and the dead
 * code was then carried through a UI redesign. `desktop/src/__tests__/componentReachability.test.ts`
 * asks the question this scope cannot, and it runs inside the same desktop suite that
 * produces this LCOV — so an unreachable component fails the run before its coverage
 * is ever scored.
 */
const DESKTOP_SCOPE: CoverageScope = {
  id: 'desktop',
  title: 'Desktop React',
  includePrefixes: ['desktop/src/'],
  excludePrefixes: [
    'desktop/src/types/',
    'desktop/src/test/',
    // Dev-only tooling, same category as mocks/. `dev/` holds the component
    // gallery, which Vite never bundles (its build input is index.html alone)
    // and which exists precisely to be looked at by a person — unit-testing a
    // page whose whole job is rendering every primitive would assert that the
    // primitives render, which their own tests already do.
    'desktop/src/dev/',
  ],
  excludeSuffixes: ['.test.ts', '.test.tsx', '.d.ts', 'vite-env.d.ts', '.css'],
}

const ROOT_RUNTIME_CHANGED_SCOPE: CoverageScope = {
  id: 'root-runtime',
  title: 'Root runtime',
  includePrefixes: ['src/'],
  excludePrefixes: ['src/server/', 'src/tools/', 'src/utils/'],
  excludePathFragments: ['/__tests__/', '/fixtures/', '/__fixtures__/'],
  excludeSuffixes: ['.test.ts', '.test.tsx', '.d.ts'],
}

export const CHANGED_LINE_SCOPES = [
  ...ROOT_COVERAGE_SCOPES,
  ROOT_RUNTIME_CHANGED_SCOPE,
  ADAPTERS_SCOPE,
  DESKTOP_SCOPE,
]
const TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?$/

function nowId() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args.set(arg, next)
      index += 1
    } else {
      args.set(arg, true)
    }
  }
  return args
}

function pct(covered: number, total: number) {
  return total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2))
}

function metric(covered: number, total: number): CoverageMetric {
  return { covered, total, pct: pct(covered, total) }
}

function normalize(path: string, rootDir = ROOT_DIR) {
  return relative(rootDir, path).split(sep).join('/')
}

function normalizeCoveragePath(path: string, rootDir = ROOT_DIR) {
  const normalized = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) {
    return win32.relative(rootDir.replace(/\//g, '\\'), normalized.replace(/\//g, '\\'))
      .split(win32.sep)
      .join('/')
  }
  if (normalized.startsWith('/')) {
    return relative(rootDir, normalized).split(sep).join('/')
  }
  return normalized.replace(/^\.\//, '')
}

export function prefixRelativeLcovSourcePaths(content: string, prefix: string) {
  const normalizedPrefix = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return content.replace(/^SF:(.+)$/gm, (line, sourcePath: string) => {
    const normalizedSourcePath = String(sourcePath).replace(/\\/g, '/').replace(/^\.\//, '')
    if (
      normalizedSourcePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalizedSourcePath) ||
      normalizedSourcePath.startsWith(`${normalizedPrefix}/`)
    ) {
      return line
    }
    return `SF:${normalizedPrefix}/${normalizedSourcePath}`
  })
}

function matchesScope(file: string, scope: CoverageScope) {
  const normalized = file.replace(/\\/g, '/')
  if (!/\.[cm]?[jt]sx?$/.test(normalized)) {
    return false
  }
  if (!scope.includePrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }
  if (scope.excludePrefixes?.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }
  if (scope.excludePathFragments?.some((fragment) => normalized.includes(fragment))) {
    return false
  }
  if (scope.excludeSuffixes?.some((suffix) => normalized.endsWith(suffix))) {
    return false
  }
  return true
}

function walkTestFiles(path: string, files: string[], excluded: Set<string>, rootDir = ROOT_DIR) {
  const stat = statSync(path)
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      walkTestFiles(join(path, entry), files, excluded, rootDir)
    }
    return
  }
  if (!stat.isFile()) return

  const normalized = normalize(path, rootDir)
  if (TEST_FILE_PATTERN.test(normalized) && !excluded.has(normalized)) {
    files.push(normalized)
  }
}

export function collectServerTestFiles(rootDir = ROOT_DIR, quarantineManifest = loadQuarantineManifest()) {
  const excluded = quarantinedPathSet(quarantineManifest)
  const files: string[] = []
  walkTestFiles(join(rootDir, 'src'), files, excluded, rootDir)
  return files.sort()
}

function parseLcovRecords(content: string, options: {
  rootDir?: string
  scope?: CoverageScope
} = {}) {
  const records: LcovRecord[] = []
  let current: LcovRecord | null = null

  function flush() {
    if (!current) return
    if (!options.scope || matchesScope(current.file, options.scope)) {
      records.push(current)
    }
    current = null
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === 'end_of_record') {
      flush()
      continue
    }
    if (line.startsWith('SF:')) {
      flush()
      current = {
        file: normalizeCoveragePath(line.slice(3), options.rootDir),
        linesTotal: 0,
        linesCovered: 0,
        functionsTotal: 0,
        functionsCovered: 0,
        branchesTotal: 0,
        branchesCovered: 0,
        lineHits: new Map(),
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('LF:')) current.linesTotal += Number(line.slice(3)) || 0
    if (line.startsWith('LH:')) current.linesCovered += Number(line.slice(3)) || 0
    if (line.startsWith('FNF:')) current.functionsTotal += Number(line.slice(4)) || 0
    if (line.startsWith('FNH:')) current.functionsCovered += Number(line.slice(4)) || 0
    if (line.startsWith('BRF:')) current.branchesTotal += Number(line.slice(4)) || 0
    if (line.startsWith('BRH:')) current.branchesCovered += Number(line.slice(4)) || 0
    if (line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',')
      const parsedLine = Number(lineNumber)
      if (Number.isFinite(parsedLine)) {
        current.lineHits.set(parsedLine, Number(hits) || 0)
      }
    }
  }

  flush()
  return records
}

export function hasUsableLcov(content: string, options: {
  rootDir?: string
  scope?: CoverageScope
} = {}) {
  return parseLcovRecords(content, options).some(isUsableLcovRecord)
}

function isUsableLcovRecord(record: LcovRecord) {
  return record.linesTotal > 0 ||
    record.functionsTotal > 0 ||
    record.branchesTotal > 0 ||
    record.lineHits.size > 0
}

export function parseBunTestFileCount(output: string) {
  const match = output.match(/^Ran \d+ tests? across (\d+) files?\./m)
  return match ? Number(match[1]) : null
}

export function parseBunStartedTestFileCount(output: string) {
  const startedTestFiles = new Set<string>()
  for (const group of output.matchAll(/^(?:::group::)?(.+):\r?$/gm)) {
    const file = group[1]?.trim()
    if (file && TEST_FILE_PATTERN.test(file)) {
      startedTestFiles.add(file.replace(/\\/g, '/'))
    }
  }
  return startedTestFiles.size
}

function terminationError(result?: CommandTermination) {
  if (result?.error) return `coverage command failed: ${result.error}`
  if (result?.signalCode) return `coverage command terminated by signal ${result.signalCode} (exit ${result.exitCode ?? 'unknown'})`
  if (result && result.exitCode === null) return 'coverage command has unknown exit status'
  return undefined
}

export function evaluateRootCoverage(output: string, expectedFiles: number, lcov: string, options: {
  rootDir?: string
  scope?: CoverageScope
  process?: CommandTermination
} = {}) {
  const completedFiles = parseBunTestFileCount(output)
  const startedFiles = parseBunStartedTestFileCount(output)
  const lcovAvailable = hasUsableLcov(lcov, options)
  const error = terminationError(options.process) ?? (completedFiles !== expectedFiles
    ? `coverage command final test file summary ${completedFiles ?? 'unknown'}/${expectedFiles}; started ${startedFiles}/${expectedFiles} root test files`
    : !hasUsableLcov(lcov, { rootDir: options.rootDir })
      ? 'coverage command produced no usable LCOV records'
      : !lcovAvailable && options.scope
        ? `coverage command produced no LCOV records for ${options.scope.id}`
        : undefined)
  return { completedFiles, startedFiles, lcovAvailable, available: error === undefined, error }
}

export function buildRootCoverageCommand(outputDir: string, serverFiles: string[], rootDir = ROOT_DIR) {
  return [
    'bun',
    '--no-env-file',
    '--feature=TRANSCRIPT_CLASSIFIER',
    'test',
    // Preserve one LCOV universe without sharing globals/module caches across files.
    '--isolate',
    '--preload',
    resolve(rootDir, 'preload.ts'),
    '--timeout=20000',
    '--coverage',
    '--coverage-reporter=lcov',
    '--coverage-reporter=text',
    '--coverage-dir',
    join(outputDir, 'root-server'),
    ...serverFiles.map(rootBunTestFilter),
  ]
}

export function buildAdaptersCoverageCommand(outputDir: string) {
  return [
    'bun',
    '--no-env-file',
    'test',
    '--isolate',
    '--coverage',
    '--coverage-reporter=lcov',
    '--coverage-reporter=text',
    '--coverage-dir',
    join(outputDir, 'adapters'),
  ]
}

function summarizeLcovRecords(records: LcovRecord[]): CoverageSummary {
  let linesTotal = 0
  let linesCovered = 0
  let functionsTotal = 0
  let functionsCovered = 0
  let branchesTotal = 0
  let branchesCovered = 0

  for (const record of records) {
    linesTotal += record.linesTotal
    linesCovered += record.linesCovered
    functionsTotal += record.functionsTotal
    functionsCovered += record.functionsCovered
    branchesTotal += record.branchesTotal
    branchesCovered += record.branchesCovered
  }

  return {
    lines: metric(linesCovered, linesTotal),
    functions: metric(functionsCovered, functionsTotal),
    branches: metric(branchesCovered, branchesTotal),
    statements: metric(linesCovered, linesTotal),
  }
}

export function parseLcov(content: string, options: {
  rootDir?: string
  scope?: CoverageScope
} = {}): CoverageSummary {
  return summarizeLcovRecords(parseLcovRecords(content, options))
}

function lcovRecordLineCoverage(records: LcovRecord[], suiteId: string) {
  const coverage = new Map<string, FileLineCoverage>()
  for (const record of records) {
    const executableLines = new Set<number>()
    const coveredLines = new Set<number>()
    for (const [line, hits] of record.lineHits) {
      executableLines.add(line)
      if (hits > 0) {
        coveredLines.add(line)
      }
    }
    coverage.set(record.file, { suiteId, executableLines, coveredLines })
  }
  return coverage
}

function lcovLineCoverage(content: string, suiteId: string, scope: CoverageScope, rootDir = ROOT_DIR) {
  return lcovRecordLineCoverage(
    parseLcovRecords(content, { rootDir, scope }),
    suiteId,
  )
}

function parseVitestSummary(path: string): CoverageSummary {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    total: Record<string, { total: number; covered: number; pct: number }>
  }
  const total = raw.total
  return {
    lines: metric(total.lines.covered, total.lines.total),
    functions: metric(total.functions.covered, total.functions.total),
    branches: metric(total.branches.covered, total.branches.total),
    statements: metric(total.statements.covered, total.statements.total),
  }
}

export function hasUsableCoverageSummary(summary: CoverageSummary) {
  return Object.values(summary).some((coverage) => coverage.total > 0)
}

/**
 * Remove a suite's sandbox HOME without letting a test's leftovers discard the
 * finished coverage run. See `removeTestSandbox`.
 */
export function removeSandboxHome(directory: string, warn: (message: string) => void = console.warn) {
  removeTestSandbox(directory, 'coverage', warn)
}

export async function runCommand(command: string[], cwd: string, logPath: string) {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const sandboxHome = mkdtempSync(join(tmpdir(), 'cc-haha-coverage-test-'))
  const header = `$ ${command.join(' ')}\n`
  const capturePath = join(sandboxHome, 'coverage-output.log')
  const context = { command, cwd, logPath, capturePath, startedAt }
  let logFd: number | undefined
  let exitCode: number | null = null
  let signalCode: NodeJS.Signals | null = null
  let failed = false
  let failure: unknown
  try {
    try {
      // Reporters such as Vitest delete their output directory on startup. Keep
      // the live capture outside that directory until the process has finished.
      logFd = openSync(capturePath, 'w')
      console.log(`[coverage] ${JSON.stringify({ phase: 'start', ...context })}`)
      // Bun's synchronous text coverage reporter can fail while writing a large
      // report to a pipe, before it emits LCOV or its test-count summary. Give
      // both streams a regular file descriptor, with no pipe buffer to exhaust.
      const proc = Bun.spawn(command, {
        cwd,
        env: createSandboxedTestEnvironment(sandboxHome),
        stdout: logFd,
        stderr: logFd,
      })
      try {
        exitCode = await proc.exited
      } finally {
        signalCode = proc.signalCode
      }
    } catch (error) {
      failed = true
      failure = error
    } finally {
      if (logFd !== undefined) closeSync(logFd)
    }
    const output = existsSync(capturePath) ? readFileSync(capturePath, 'utf8') : ''
    const diagnostics = {
      ...context,
      exitCode,
      signalCode,
      ...(failed ? { error: failure instanceof Error ? failure.message : String(failure) } : {}),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      runnerRuntime: {
        executable: process.execPath,
        bunVersion: Bun.version,
        platform: process.platform,
        arch: process.arch,
      },
    }
    mkdirSync(dirname(logPath), { recursive: true })
    writeFileSync(logPath, `${header}${output}`)
    writeFileSync(`${logPath}.process.json`, JSON.stringify(diagnostics, null, 2) + '\n')
    console.log(`[coverage] ${JSON.stringify({ phase: 'end', ...diagnostics })}`)
    if (failed) throw failure
    return { ...diagnostics, output }
  } finally {
    removeSandboxHome(sandboxHome)
  }
}

async function runSuite(
  id: string,
  title: string,
  command: string[],
  cwd: string,
  suiteDir: string,
  readSummary: () => CoverageSummary,
): Promise<SuiteCoverage> {
  mkdirSync(suiteDir, { recursive: true })
  const logPath = join(suiteDir, 'coverage.log')
  const result = await runCommand(command, cwd, logPath)
  const termination = { exitCode: result.exitCode, signalCode: result.signalCode }
  const processError = terminationError(result)
  if (processError || result.exitCode !== 0) {
    return {
      id,
      title,
      status: 'failed',
      command,
      durationMs: result.durationMs,
      logPath,
      ...termination,
      error: processError ?? `coverage command exited with ${result.exitCode}`,
    }
  }

  try {
    const summary = readSummary()
    if (!hasUsableCoverageSummary(summary)) {
      throw new Error('coverage artifact contained no measurable source records')
    }
    return {
      id,
      title,
      status: 'passed',
      command,
      durationMs: result.durationMs,
      logPath,
      ...termination,
      summary,
    }
  } catch (error) {
    return {
      id,
      title,
      status: 'failed',
      command,
      durationMs: result.durationMs,
      logPath,
      ...termination,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function loadThresholds(path = DEFAULT_THRESHOLDS_PATH): CoverageThresholds {
  if (!existsSync(path)) {
    return { schemaVersion: 1, minimums: {} }
  }
  return JSON.parse(readFileSync(path, 'utf8')) as CoverageThresholds
}

function readGitFile(rootDir: string, ref: string, filePath: string) {
  const gitPath = filePath.startsWith('/')
    ? relative(rootDir, filePath).split(sep).join('/')
    : filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const proc = Bun.spawnSync(['git', 'show', `${ref}:${gitPath}`], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0) {
    return null
  }
  return new TextDecoder().decode(proc.stdout)
}

export function parseChangedLinesFromDiff(diff: string) {
  const changed = new Map<string, Set<number>>()
  let currentFile: string | null = null
  let nextLine = 0

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith('+++ ')) {
      const file = rawLine.slice(4).trim()
      currentFile = file === '/dev/null' ? null : file.replace(/^b\//, '')
      continue
    }

    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      nextLine = Number(hunk[1])
      continue
    }

    if (!currentFile || nextLine === 0) continue
    if (rawLine.startsWith('+++')) continue
    if (rawLine.startsWith('+')) {
      let lines = changed.get(currentFile)
      if (!lines) {
        lines = new Set()
        changed.set(currentFile, lines)
      }
      lines.add(nextLine)
      nextLine += 1
      continue
    }
    if (rawLine.startsWith('-')) continue
    if (rawLine.length > 0) {
      nextLine += 1
    }
  }

  return changed
}

function gitOutput(rootDir: string, args: string[]) {
  const proc = Bun.spawnSync(['git', ...args], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0) return null
  return new TextDecoder().decode(proc.stdout)
}

function collectChangedLines(rootDir: string, baseRef?: string) {
  function collect(strategy: ChangedLineScope['strategy'], base: string, comparison: string) {
    const diffArgs = ['diff', '--unified=0', '--no-ext-diff', comparison, '--']
    const diff = gitOutput(rootDir, diffArgs)
    const dirty = strategy === 'dirty-worktree'
    const scope: ChangedLineScope = {
      strategy,
      baseRef: base,
      diffArgs,
      includes: { committed: !dirty, staged: dirty, unstaged: dirty, untracked: false },
      ...(diff === null ? { error: 'git diff failed; changed lines are unknown, not an empty diff' } : {}),
    }
    return { lines: diff ? parseChangedLinesFromDiff(diff) : new Map<string, Set<number>>(), scope }
  }

  const explicitBase = baseRef?.trim()
  if (explicitBase) {
    return collect('explicit-base', explicitBase, `${explicitBase}...HEAD`)
  }

  const dirty = gitOutput(rootDir, ['diff', '--name-only', '--'])
  if (dirty?.trim()) {
    return collect('dirty-worktree', 'HEAD', 'HEAD')
  }

  const branch = gitOutput(rootDir, ['branch', '--show-current'])?.trim()
  const hasOriginMain = gitOutput(rootDir, ['rev-parse', '--verify', 'origin/main'])
  if (branch && branch !== 'main' && hasOriginMain) {
    return collect('branch-fallback', 'origin/main', 'origin/main...HEAD')
  }

  const scope: ChangedLineScope = {
    strategy: 'none',
    includes: { committed: false, staged: false, unstaged: false, untracked: false },
    ...(dirty === null || branch === undefined ? { error: 'git scope discovery failed; changed lines are unknown' } : {}),
  }
  return { lines: new Map<string, Set<number>>(), scope }
}

export function evaluateChangedLineCoverage(
  changedLines: Map<string, Set<number>>,
  coverageByFile: Map<string, FileLineCoverage>,
  scopes: CoverageScope[],
  minimumPercent: number,
  /** Scope id -> why its suite produced no coverage. The suite failure is reported on its own. */
  unavailableScopes: Map<string, string> = new Map(),
): ChangedLineCoverage {
  const files: ChangedLineCoverage['files'] = []
  let total = 0
  let covered = 0
  let unmeasured = 0

  for (const [file, lines] of [...changedLines.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const scope = scopes.find((candidate) => matchesScope(file, candidate))
    if (!scope) continue

    const fileCoverage = coverageByFile.get(file)
    const unavailable = unavailableScopes.get(scope.id)
    if (!fileCoverage && unavailable) {
      unmeasured += lines.size
      files.push({
        file,
        suiteId: scope.id,
        covered: 0,
        total: lines.size,
        pct: 0,
        unmeasured: true,
        reason: `not measured: ${unavailable}`,
      })
      continue
    }
    if (!fileCoverage) {
      const lineCount = lines.size
      total += lineCount
      files.push({
        file,
        suiteId: scope.id,
        covered: 0,
        total: lineCount,
        pct: 0,
        reason: 'no coverage data for changed source file',
      })
      continue
    }

    const executableChangedLines = [...lines].filter((line) => fileCoverage.executableLines.has(line))
    if (executableChangedLines.length === 0) continue
    const fileCovered = executableChangedLines.filter((line) => fileCoverage.coveredLines.has(line)).length
    total += executableChangedLines.length
    covered += fileCovered
    files.push({
      file,
      suiteId: fileCoverage.suiteId,
      covered: fileCovered,
      total: executableChangedLines.length,
      pct: pct(fileCovered, executableChangedLines.length),
    })
  }

  const coverage = pct(covered, total)
  const failures = total > 0 && coverage + Number.EPSILON < minimumPercent
    ? [`changed-lines: coverage ${coverage}% is below minimum ${minimumPercent}%`]
    : []

  return {
    minimumPercent,
    covered,
    total,
    pct: coverage,
    ...(unmeasured > 0 ? { unmeasured } : {}),
    files,
    failures,
  }
}

function loadBaseline(path: string, rootDir = ROOT_DIR, baselineRef?: string): BaselineFile | null {
  if (baselineRef) {
    const raw = readGitFile(rootDir, baselineRef, path)
    return raw ? JSON.parse(raw) as BaselineFile : null
  }

  const resolved = path.startsWith('/') ? path : join(rootDir, path)
  if (!existsSync(resolved)) return null
  return JSON.parse(readFileSync(resolved, 'utf8')) as BaselineFile
}

export function evaluateThresholds(
  suites: SuiteCoverage[],
  thresholds: CoverageThresholds,
  rootDir = ROOT_DIR,
  baselineRef?: string,
) {
  const failures: string[] = []
  const baseline = thresholds.ratchet?.baselinePath
    ? loadBaseline(thresholds.ratchet.baselinePath, rootDir, baselineRef)
    : null
  const allowedDrop = thresholds.ratchet?.allowedDropPercent ?? 0

  for (const suite of suites) {
    if (suite.status !== 'passed' || !suite.summary) {
      failures.push(`${suite.id}: ${suite.error ?? 'coverage suite failed'}`)
      continue
    }

    const minimums = thresholds.minimums[suite.id] ?? {}
    for (const [metricName, minimum] of Object.entries(minimums)) {
      const actual = suite.summary[metricName as keyof CoverageSummary].pct
      if (actual + Number.EPSILON < minimum) {
        failures.push(`${suite.id}: ${metricName} coverage ${actual}% is below minimum ${minimum}%`)
      }
    }

    const baselineSummary = baseline?.suites[suite.id]
    if (!baselineSummary) continue
    for (const metricName of ['lines', 'functions', 'branches', 'statements'] as const) {
      const actual = suite.summary[metricName].pct
      const expected = baselineSummary[metricName].pct - allowedDrop
      if (actual + Number.EPSILON < expected) {
        failures.push(`${suite.id}: ${metricName} coverage ${actual}% dropped below baseline ${baselineSummary[metricName].pct}%`)
      }
    }
  }

  return failures
}

function evaluateTargetGaps(suites: SuiteCoverage[], thresholds: CoverageThresholds) {
  const gaps: string[] = []
  for (const suite of suites) {
    if (suite.status !== 'passed' || !suite.summary) continue
    const targets = thresholds.targets?.[suite.id] ?? {}
    for (const [metricName, target] of Object.entries(targets)) {
      const actual = suite.summary[metricName as keyof CoverageSummary].pct
      if (actual + Number.EPSILON < target) {
        gaps.push(`${suite.id}: ${metricName} coverage ${actual}% is below target ${target}%`)
      }
    }
  }
  return gaps
}

function renderReport(report: CoverageReport) {
  const lines = [
    '# Coverage Report',
    '',
    `- Run: ${report.runId}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Output: ${report.outputDir}`,
    ...(report.baselineRef ? [`- Baseline ref: ${report.baselineRef}`] : []),
    '',
    '| Suite | Status | Lines | Functions | Branches | Statements |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ]

  for (const suite of report.suites) {
    const summary = suite.summary
    lines.push(`| ${[
      suite.title,
      suite.status,
      summary ? `${summary.lines.pct}%` : '-',
      summary ? `${summary.functions.pct}%` : '-',
      summary ? `${summary.branches.pct}%` : '-',
      summary ? `${summary.statements.pct}%` : '-',
    ].join(' | ')} |`)
  }

  lines.push('', '## Command Diagnostics', '')
  for (const suite of report.suites) {
    const lcov = suite.lcovAvailable === undefined ? 'not evaluated' : suite.lcovAvailable ? 'available' : 'unavailable'
    lines.push(`- ${suite.title}: exit=${suite.exitCode ?? 'unknown'}; signal=${suite.signalCode ?? 'none'}; LCOV=${lcov}; duration=${suite.durationMs}ms; log=${suite.logPath}; process=${suite.logPath}.process.json`)
  }

  const suiteNotes = report.suites.filter((suite) => suite.note)
  if (suiteNotes.length > 0) {
    lines.push('', '## Suite Notes', '')
    for (const suite of suiteNotes) {
      lines.push(`- ${suite.title}: ${suite.note}`)
    }
  }

  lines.push('', '## Changed Lines', '')
  const scope = report.changedLines?.scope
  if (scope) {
    lines.push(
      `- Strategy: ${scope.strategy}; base: ${scope.baseRef ?? 'none'}`,
      `- Diff: ${scope.diffArgs ? ['git', ...scope.diffArgs].join(' ') : 'none'}`,
      `- Included change categories: ${Object.entries(scope.includes).map(([kind, included]) => `${kind}=${included}`).join(', ')}`,
      '- Selection preserves existing semantics: dirty fallback is triggered by unstaged tracked changes, not staged-only or untracked changes. Dirty diff is not whole-branch coverage; three-dot comparisons include committed changes since the merge base only. Untracked files are always excluded.',
      ...(scope.error ? [`- Scope diagnostic: ${scope.error}`] : []),
    )
  }
  if (report.changedLines?.unmeasured) {
    lines.push(`- Not measured: ${report.changedLines.unmeasured} changed lines belong to a suite that failed (see Failures); they are not counted as uncovered.`)
  }
  if (!report.changedLines) {
    lines.push('- not evaluated')
  } else if (report.changedLines.total === 0 && report.changedLines.unmeasured) {
    lines.push(`- No measured changed lines. Minimum: ${report.changedLines.minimumPercent}%`)
    lines.push('', '| File | Suite | Lines | Reason |', '| --- | --- | ---: | --- |')
    for (const file of report.changedLines.files) {
      lines.push(`| ${file.file} | ${file.suiteId} | - (${file.total} lines) | ${file.reason ?? '-'} |`)
    }
  } else if (report.changedLines.total === 0) {
    lines.push(scope?.error
      ? `- Changed lines are unknown; the existing empty-fallback scoring is unchanged, not evidence of no changes. Minimum: ${report.changedLines.minimumPercent}%`
      : `- No changed executable production lines matched the coverage scopes. Minimum: ${report.changedLines.minimumPercent}%`)
  } else {
    lines.push(
      `- Coverage: ${report.changedLines.pct}% (${report.changedLines.covered}/${report.changedLines.total})`,
      `- Minimum: ${report.changedLines.minimumPercent}%`,
      '',
      '| File | Suite | Lines | Reason |',
      '| --- | --- | ---: | --- |',
    )
    for (const file of report.changedLines.files) {
      const measured = file.unmeasured ? `- (${file.total} lines)` : `${file.pct}% (${file.covered}/${file.total})`
      lines.push(`| ${file.file} | ${file.suiteId} | ${measured} | ${file.reason ?? '-'} |`)
    }
  }

  lines.push('', '## Target Gaps', '')
  if (report.targetGaps.length === 0) {
    lines.push('- none')
  } else {
    for (const gap of report.targetGaps) {
      lines.push(`- ${gap}`)
    }
  }

  lines.push('', '## Failures', '')
  if (report.failures.length === 0) {
    lines.push('- none')
  } else {
    for (const failure of report.failures) {
      lines.push(`- ${failure}`)
    }
  }

  return lines.join('\n') + '\n'
}

export async function runCoverageGate(options: {
  rootDir?: string
  artifactsDir?: string
  runId?: string
  thresholdsPath?: string
  baselineRef?: string
  changedBaseRef?: string
} = {}) {
  const rootDir = options.rootDir ?? ROOT_DIR
  const runId = options.runId ?? nowId()
  const outputDir = join(options.artifactsDir ?? join(rootDir, 'artifacts', 'coverage'), runId)
  const startedAt = new Date().toISOString()
  const baselineRef = options.baselineRef ?? process.env.COVERAGE_BASE_REF
  mkdirSync(outputDir, { recursive: true })

  const serverFiles = collectServerTestFiles(rootDir)
  const suites: SuiteCoverage[] = []
  const coverageByFile = new Map<string, FileLineCoverage>()

  mkdirSync(join(outputDir, 'root-server'), { recursive: true })
  const rootCommand = buildRootCoverageCommand(outputDir, serverFiles, rootDir)
  const rootLogPath = join(outputDir, 'root-server', 'coverage.log')
  const rootResult = await runCommand(rootCommand, rootDir, rootLogPath)
  const rootLcovPath = join(outputDir, 'root-server', 'lcov.info')
  const rootLcov = existsSync(rootLcovPath)
    ? readFileSync(rootLcovPath, 'utf8')
    : ''
  const rootRecords = parseLcovRecords(rootLcov, { rootDir }).filter(isUsableLcovRecord)
  const rootCoverage = evaluateRootCoverage(rootResult.output, serverFiles.length, rootLcov, { rootDir, process: rootResult })
  const rootCoverageAvailable = rootCoverage.available

  if (rootResult.exitCode !== 0 && rootCoverageAvailable) {
    writeFileSync(
      rootLogPath,
      `${readFileSync(rootLogPath, 'utf8')}\n# Coverage note: test assertions exited with ${rootResult.exitCode}; correctness is enforced by check:server's per-file sandboxed test processes. This lane uses the complete single-process LCOV universe because Bun LCOV does not expose function identities for lossless cross-process merging.\n`,
    )
  }

  for (const scope of ROOT_COVERAGE_SCOPES) {
    const scopedRecords = rootRecords.filter((record) => matchesScope(record.file, scope))
    const scopeCoverage = evaluateRootCoverage(rootResult.output, serverFiles.length, rootLcov, { rootDir, scope, process: rootResult })
    const scopeCoverageAvailable = scopeCoverage.available
    const summary = scopeCoverageAvailable
      ? summarizeLcovRecords(scopedRecords)
      : undefined
    suites.push({
      id: scope.id,
      title: scope.title,
      status: scopeCoverageAvailable ? 'passed' : 'failed',
      command: rootCommand,
      durationMs: rootResult.durationMs,
      logPath: rootLogPath,
      exitCode: rootResult.exitCode,
      signalCode: rootResult.signalCode,
      lcovAvailable: scopeCoverage.lcovAvailable,
      ...(summary ? { summary } : {}),
      ...(rootResult.exitCode !== 0 && rootCoverageAvailable ? {
        note: `instrumentation test process exited with ${rootResult.exitCode}; correctness is enforced by the required per-file server gate`,
      } : {}),
      ...(!scopeCoverageAvailable ? {
        error: scopeCoverage.error,
      } : {}),
    })
    if (scopeCoverageAvailable) {
      for (const [file, coverage] of lcovRecordLineCoverage(scopedRecords, scope.id)) {
        coverageByFile.set(file, coverage)
      }
    }
  }

  const rootRuntimeRecords = rootCoverageAvailable ? rootRecords.filter((record) => (
    matchesScope(record.file, ROOT_RUNTIME_CHANGED_SCOPE)
  )) : []
  for (const [file, coverage] of lcovRecordLineCoverage(
    rootRuntimeRecords,
    ROOT_RUNTIME_CHANGED_SCOPE.id,
  )) {
    coverageByFile.set(file, coverage)
  }

  const adapters = await runSuite(
    'adapters',
    'IM adapters',
    buildAdaptersCoverageCommand(outputDir),
    join(rootDir, 'adapters'),
    join(outputDir, 'adapters'),
    () => parseLcov(readFileSync(join(outputDir, 'adapters', 'lcov.info'), 'utf8')),
  )
  suites.push(adapters)
  const adaptersLcovPath = join(outputDir, 'adapters', 'lcov.info')
  if (adapters.status === 'passed' && existsSync(adaptersLcovPath)) {
    const adaptersLcov = prefixRelativeLcovSourcePaths(readFileSync(adaptersLcovPath, 'utf8'), 'adapters')
    for (const [file, coverage] of lcovLineCoverage(adaptersLcov, 'adapters', ADAPTERS_SCOPE, rootDir)) {
      coverageByFile.set(file, coverage)
    }
  }

  const desktop = await runSuite(
    'desktop',
    'Desktop React',
    [
      'bun',
      '--no-env-file',
      'run',
      'test',
      '--',
      '--run',
      '--coverage',
      '--coverage.reporter=json-summary',
      '--coverage.reporter=lcov',
      `--coverage.reportsDirectory=${join(outputDir, 'desktop')}`,
      '--testTimeout=20000',
    ],
    join(rootDir, 'desktop'),
    join(outputDir, 'desktop'),
    () => parseVitestSummary(join(outputDir, 'desktop', 'coverage-summary.json')),
  )
  suites.push(desktop)
  const desktopLcovPath = join(outputDir, 'desktop', 'lcov.info')
  if (desktop.status === 'passed' && existsSync(desktopLcovPath)) {
    const desktopLcov = prefixRelativeLcovSourcePaths(readFileSync(desktopLcovPath, 'utf8'), 'desktop')
    for (const [file, coverage] of lcovLineCoverage(desktopLcov, 'desktop', DESKTOP_SCOPE, rootDir)) {
      coverageByFile.set(file, coverage)
    }
  }

  const thresholds = loadThresholds(options.thresholdsPath ?? join(rootDir, 'scripts', 'quality-gate', 'coverage-thresholds.json'))
  const failures = evaluateThresholds(suites, thresholds, rootDir, baselineRef)
  const changedLineMinimum = thresholds.changedLines?.minimumPercent
  // A failed suite is already a failure above. Its changed lines were never
  // measured, so they must not also read as 0% covered.
  const unavailableScopes = new Map(suites
    .filter((suite) => suite.status !== 'passed' || !suite.summary)
    .map((suite) => [suite.id, `${suite.id}: ${suite.error ?? 'coverage suite failed'}`]))
  if (!rootCoverageAvailable) {
    unavailableScopes.set(ROOT_RUNTIME_CHANGED_SCOPE.id, `${ROOT_RUNTIME_CHANGED_SCOPE.id}: ${rootCoverage.error ?? 'root coverage run unavailable'}`)
  }
  const changed = typeof changedLineMinimum === 'number'
    ? collectChangedLines(rootDir, options.changedBaseRef ?? process.env.COVERAGE_BASE_REF)
    : undefined
  const changedLines = changed && typeof changedLineMinimum === 'number'
    ? {
      ...evaluateChangedLineCoverage(
        changed.lines,
        coverageByFile,
        CHANGED_LINE_SCOPES,
        changedLineMinimum,
        unavailableScopes,
      ),
      scope: changed.scope,
    }
    : undefined
  if (changedLines) {
    failures.push(...changedLines.failures)
  }
  const targetGaps = evaluateTargetGaps(suites, thresholds)
  const report: CoverageReport = {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    outputDir,
    ...(baselineRef ? { baselineRef } : {}),
    suites,
    ...(changedLines ? { changedLines } : {}),
    targetGaps,
    failures,
  }

  writeFileSync(join(outputDir, 'coverage-report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(outputDir, 'coverage-report.md'), renderReport(report))
  return report
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2))
  const report = await runCoverageGate({
    artifactsDir: typeof args.get('--artifacts-dir') === 'string' ? String(args.get('--artifacts-dir')) : undefined,
    runId: typeof args.get('--run-id') === 'string' ? String(args.get('--run-id')) : undefined,
    thresholdsPath: typeof args.get('--thresholds') === 'string' ? String(args.get('--thresholds')) : undefined,
    baselineRef: typeof args.get('--baseline-ref') === 'string' ? String(args.get('--baseline-ref')) : undefined,
    changedBaseRef: typeof args.get('--changed-base') === 'string' ? String(args.get('--changed-base')) : undefined,
  })
  console.log(`Coverage report: ${report.outputDir}/coverage-report.md`)
  console.log(`Summary: passed=${report.suites.filter((suite) => suite.status === 'passed').length} failed=${report.failures.length}`)
  if (report.failures.length > 0) {
    process.exit(1)
  }
}
