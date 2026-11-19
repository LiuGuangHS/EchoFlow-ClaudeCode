import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSandboxedTestEnvironment } from './test-environment'

const checkPr = fileURLToPath(new URL('./check-pr.ts', import.meta.url))
const impactReport = fileURLToPath(new URL('./impact-report.ts', import.meta.url))
const surfaceCommands = [
  ['bun', 'run', 'check:desktop'],
  ['bun', 'run', 'check:mobile'],
  ['bun', 'run', 'check:server'],
  ['bun', 'run', 'check:provider-contract'],
  ['bun', 'run', 'check:chat-contract'],
  ['bun', 'run', 'check:agent-flow'],
  ['bun', 'run', 'check:agent-e2e'],
  ['bun', 'run', '--cwd', 'harness', 'test'],
  ['bun', 'run', 'audit:harness'],
  ['bun', 'run', 'check:adapters'],
  ['bun', 'run', 'check:native'],
  ['bun', 'run', 'check:persistence-upgrade'],
]

// shortcut: the executable fixture uses a POSIX shell, run these CLI contracts on Linux/macOS.
describe.skipIf(process.platform === 'win32')('check:pr CLI contracts', () => {
  let root: string
  let repo: string
  let env: Record<string, string>

  function write(path: string, content: string) {
    const target = join(repo, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  function calls(): string[][] {
    const path = join(root, 'calls.jsonl')
    return existsSync(path)
      ? readFileSync(path, 'utf8').trim().split('\n').map(line => ['bun', ...JSON.parse(line)])
      : []
  }

  function launch(entry: string, args: string[], overrides: Record<string, string> = {}, preload?: string) {
    return Bun.spawn([
      process.execPath, '--no-env-file', ...(preload ? ['--preload', preload] : []), entry, ...args,
    ], { cwd: repo, env: { ...env, ...overrides }, stdout: 'pipe', stderr: 'pipe' })
  }

  async function run(entry: string, args: string[], overrides: Record<string, string> = {}, preload?: string) {
    const proc = launch(entry, args, overrides, preload)
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    return { stdout, stderr, code }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'local-pr-cli-'))
    repo = join(root, 'repo')
    const bin = join(root, 'bin')
    mkdirSync(repo)
    mkdirSync(bin)
    const fixtureBun = join(root, "Bun Tools/bun's executable")
    mkdirSync(dirname(fixtureBun))
    symlinkSync(process.execPath, fixtureBun)
    env = createSandboxedTestEnvironment(join(root, 'home'), {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      FIXTURE_BUN: fixtureBun,
      FIXTURE_SCRIPT: join(root, 'fake-bun.ts'),
      FIXTURE_CALLS: join(root, 'calls.jsonl'),
      FIXTURE_RELEASE: join(root, 'release'),
    })
    const fakeBun = join(bin, 'bun')
    writeFileSync(fakeBun, '#!/bin/sh\nexec "$FIXTURE_BUN" --no-env-file "$FIXTURE_SCRIPT" "$@"\n')
    writeFileSync(env.FIXTURE_SCRIPT, `
import { appendFileSync, existsSync } from 'node:fs'
const args = process.argv.slice(2)
const command = args.join(' ')
appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(args) + '\\n')
console.log('fixture stdout: ' + command)
console.error('fixture stderr: ' + command)
if (process.env.FIXTURE_WAIT === command) {
  for (let attempt = 0; !existsSync(process.env.FIXTURE_RELEASE); attempt++) {
    if (attempt === 500) process.exit(98)
    await Bun.sleep(10)
  }
}
process.exit(process.env.FIXTURE_FAIL === command ? Number(process.env.FIXTURE_EXIT) : 0)
`)
    chmodSync(fakeBun, 0o755)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test.each([
    { file: 'scripts/quality-gate/agent-flow/scenarios.test.ts', checks: ['check:policy', 'check:agent-flow', 'check:agent-e2e'] },
    { file: 'scripts/quality-gate/mock-llm/mockLlm.test.ts', checks: ['check:policy', 'check:agent-e2e'] },
    { file: 'desktop/src/pages/Settings.test.tsx', checks: ['check:desktop'] },
    { file: 'docs/guide.md', checks: ['check:docs'] },
  ])('executes only the selected lanes for $file', async ({ file, checks }) => {
    const result = await run(checkPr, [file])
    expect(result.code, result.stderr).toBe(0)
    expect(calls()).toEqual(checks.map(check => ['bun', 'run', check]))
    expect(result.stdout).toContain('PR local checks completed.')
  })

  test('preserves a positional filename containing spaces and commas as one diff path', async () => {
    const result = await run(checkPr, ['desktop/src/folder, docs/file name.test.ts'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Files: 1')
    expect(calls()).toEqual([['bun', 'run', 'check:desktop']])
  })

  test('uses existing local discovery when no files are supplied', async () => {
    const init = Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: repo, env, stdout: 'pipe', stderr: 'pipe' })
    expect(init.exitCode, new TextDecoder().decode(init.stderr)).toBe(0)
    write('docs/local.md', '# local\n')
    const result = await run(checkPr, [])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Files: 1')
    expect(calls()).toEqual([['bun', 'run', 'check:docs']])
  })

  test('expands importer surfaces without treating importers as changed files or approvals', async () => {
    write('desktop/src/shared.ts', 'export const value = 1\n')
    write('desktop/src/shared.test.ts', '// diff test signal\n')
    for (const path of [
      'src/tools/consumer.ts', 'src/server/ws/handler.ts', 'src/server/services/providerService.ts',
      'desktop/electron/main.ts', 'mobile/src/app/index.tsx', 'adapters/bot.ts', 'harness/src/boot.js',
      'src/server/services/desktopUiPreferencesService.ts',
    ]) {
      const relative = path.startsWith('desktop/') ? '../src/shared' : path.startsWith('mobile/') ? '../../../desktop/src/shared'
        : path.startsWith('adapters/') ? '../desktop/src/shared' : path.startsWith('src/server/') ? '../../../desktop/src/shared'
          : '../../desktop/src/shared'
      write(path, `import { value } from '${relative}'\n`)
    }
    const files = ['desktop/src/shared.ts', 'desktop/src/shared.test.ts']
    const result = await run(checkPr, files)
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Files: 2')
    expect(result.stdout).toContain('Areas: desktop')
    expect(calls()).toEqual(surfaceCommands)

    const impact = await run(impactReport, ['--files', files.join(',')])
    expect(impact.code, impact.stderr).toBe(0)
    expect(impact.stdout).toContain('Changed files: 2\nAreas: desktop\nLabels: none\nBlocked: no')
    expect(impact.stdout).toContain('## Cross-surface impact')
    expect(impact.stdout).toContain('file(s) outside the diff import a changed file.')
    expect(impact.stdout).not.toContain('BLOCKING:')
    expect(impact.stdout).toContain('- `bun run check:coverage`')
    expect(calls()).toEqual(surfaceCommands)
  })

  test('graph failure selects importer-expandable surfaces, not all policy keys', async () => {
    write('src/placeholder.ts', 'export {}\n')
    const preload = join(root, 'graph-failure.ts')
    writeFileSync(preload, `
import { spyOn } from 'bun:test'
import * as fs from 'node:fs'
const stat = fs.statSync
spyOn(fs, 'statSync').mockImplementation((path, ...args) => {
  if (path === ${JSON.stringify(join(repo, 'src'))}) throw new Error('fixture graph unavailable')
  return stat(path, ...args)
})
`)
    const result = await run(checkPr, ['unclassified.txt'], {}, preload)
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toContain('dependency graph unavailable')
    expect(result.stderr).toContain('fixture graph unavailable')
    expect(result.stdout).toContain('Files: 1\n  Areas: none')
    expect(calls()).toEqual(surfaceCommands)

    const impact = await run(impactReport, ['--files', 'unclassified.txt'], {}, preload)
    expect(impact.code, impact.stderr).toBe(0)
    expect(impact.stdout).toContain('Dependency graph unavailable (fixture graph unavailable)')
    expect(impact.stdout).not.toContain('- `bun run check:policy`')
    expect(impact.stdout).not.toContain('- `bun run check:docs`')
    expect(impact.stdout).not.toContain('- `bun run check:coverage`')
  })

  test.each(['src/tools/fixture.ts', 'src/server/fixture.ts', 'scripts/quality-gate/coverage-baseline.json'])(
    'blocks before any check subprocess for %s', async file => {
      const result = await run(checkPr, [file, 'docs/guide.md'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Blocked:')
      expect(calls()).toEqual([])
      expect(result.stdout).not.toContain('PR local checks completed.')
    },
  )

  const approvalInputs: Record<string, string>[] = [
    { PR_LABELS: 'allow-cli-core-change, allow-missing-tests,allow-coverage-baseline-change' },
    { ALLOW_CLI_CORE_CHANGE: '1', ALLOW_MISSING_TESTS: '1', ALLOW_COVERAGE_BASELINE_CHANGE: '1' },
  ]
  test.each(approvalInputs)('retains existing label and approval input %j', async approvals => {
    const result = await run(checkPr, [
      'src/tools/fixture.ts', 'src/server/fixture.ts', 'scripts/quality-gate/coverage-baseline.json',
    ], approvals)
    expect(result.code, result.stderr).toBe(0)
    expect(calls()).toEqual(['check:policy', 'check:server', 'check:agent-e2e'].map(check => ['bun', 'run', check]))
  })

  test.each([
    { fail: 'run check:policy', code: 7, checks: ['check:policy'] },
    { fail: 'run check:agent-flow', code: 23, checks: ['check:policy', 'check:agent-flow'] },
    { fail: 'run check:agent-e2e', code: 31, checks: ['check:policy', 'check:agent-flow', 'check:agent-e2e'] },
  ])('stops at the first failing lane and propagates $code', async ({ fail, code, checks }) => {
    const result = await run(checkPr, ['scripts/quality-gate/agent-flow/scenarios.test.ts', 'docs/guide.md'], {
      FIXTURE_FAIL: fail, FIXTURE_EXIT: String(code),
    })
    expect(result.code).toBe(code)
    expect(calls()).toEqual(checks.map(check => ['bun', 'run', check]))
    expect(result.stdout).not.toContain('PR local checks completed.')
  })

  test.each([
    { fail: '', code: 0, audit: true },
    { fail: 'run --cwd harness test', code: 13, audit: false },
    { fail: 'run audit:harness', code: 17, audit: true },
  ])('runs harness suite before audit, preserving failure $code', async ({ fail, code, audit }) => {
    const result = await run(checkPr, ['harness/src/boot.js', 'docs/guide.md'], {
      FIXTURE_FAIL: fail, FIXTURE_EXIT: String(code),
    })
    expect(result.code, result.stderr).toBe(code)
    expect(calls()).toEqual([
      ['bun', 'run', '--cwd', 'harness', 'test'],
      ...(audit ? [['bun', 'run', 'audit:harness']] : []),
      ...(code === 0 ? [['bun', 'run', 'check:docs']] : []),
    ])
  })

  test('streams stdout and stderr while a check is still running', async () => {
    const proc = launch(checkPr, ['docs/guide.md'], { FIXTURE_WAIT: 'run check:docs' })
    async function readMarker(stream: ReadableStream<Uint8Array>, marker: string) {
      const reader = stream.getReader()
      let output = ''
      try {
        while (!output.includes(marker)) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error(`Check exited without streaming ${marker}`)
          output += new TextDecoder().decode(chunk.value)
        }
      } finally {
        reader.releaseLock()
      }
    }
    try {
      await Promise.all([
        readMarker(proc.stdout, 'fixture stdout: run check:docs'),
        readMarker(proc.stderr, 'fixture stderr: run check:docs'),
      ])
      expect(existsSync(join(root, 'release'))).toBe(false)
      expect(proc.exitCode).toBeNull()
    } finally {
      writeFileSync(join(root, 'release'), '')
      await proc.exited
    }
    expect(proc.exitCode).toBe(0)
  }, 10_000)
})
