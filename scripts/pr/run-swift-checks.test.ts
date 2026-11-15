import { describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { runSwiftChecks } from './run-swift-checks'
import { removeTestSandbox } from './test-environment'

describe('Swift platform checks', () => {
  test.each(['linux', 'win32'] as const)('does not invoke the macOS-only package on %s', async platform => {
    const run = mock(async () => { throw new Error('Swift cannot run on this fixture platform') })
    expect(await runSwiftChecks({ platform, run })).toBe(0)
    expect(run).not.toHaveBeenCalled()
  })

  test.each([
    { swiftExit: 0, packagingExit: 0, expected: 0, calls: 2 },
    { swiftExit: 7, packagingExit: 0, expected: 7, calls: 1 },
    { swiftExit: 0, packagingExit: 9, expected: 9, calls: 2 },
  ])('runs Swift and shell packaging regressions in isolation and propagates their result: %j', async scenario => {
    let home = ''
    const commands: string[][] = []
    const run = mock(async (command: string[], options: { cwd: string; env: Record<string, string> }) => {
      commands.push(command)
      home = options.env.HOME!
      if (command[0] === 'swift') {
        expect(command.slice(0, 2)).toEqual(['swift', 'test'])
        expect(command).toContain('--enable-xctest')
        expect(command[command.indexOf('--package-path') + 1]).toBe(join(options.cwd, 'native/cu-helper'))
        expect(command[command.indexOf('--scratch-path') + 1]).toBe(join(home, 'build'))
      } else {
        expect(command).toEqual(['bun', 'test', join(options.cwd, 'native/cu-helper/build.test.ts')])
        expect(commands[0]?.[0]).toBe('swift')
      }
      expect(isAbsolute(options.cwd)).toBe(true)
      expect(home).not.toBe(process.env.HOME)
      expect(options.env.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude'))
      expect(options.env.CFFIXED_USER_HOME).toBe(home)
      expect(options.env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      expect(options.env.GH_TOKEN).toBeUndefined()
      writeFileSync(join(home, 'cleanup-fixture'), 'disposable Swift test output')
      return command[0] === 'swift' ? scenario.swiftExit : scenario.packagingExit
    })
    expect(await runSwiftChecks({ platform: 'darwin', run })).toBe(scenario.expected)
    expect(run).toHaveBeenCalledTimes(scenario.calls)
    expect(existsSync(home)).toBe(false)
  })

  test('a passing run stays green when a test leaves a read-only directory behind', async () => {
    let home = ''
    const run = mock(async (_command: string[], options: { env: Record<string, string> }) => {
      home = options.env.HOME!
      const locked = join(home, 'tmp', 'locked')
      mkdirSync(join(locked, 'inner'), { recursive: true })
      writeFileSync(join(locked, 'inner', 'file'), 'x')
      chmodSync(join(locked, 'inner'), 0o500)
      chmodSync(locked, 0o500)
      return 0
    })
    expect(await runSwiftChecks({ platform: 'darwin', run })).toBe(0)
    expect(existsSync(home)).toBe(false)
  })

  test('cleans the sandbox and reports a Swift launch failure', async () => {
    let home = ''
    await expect(runSwiftChecks({
      platform: 'darwin',
      run: async (_command, options) => {
        home = options.env.HOME!
        throw new Error('swift executable unavailable')
      },
    })).rejects.toThrow('swift executable unavailable')
    expect(existsSync(home)).toBe(false)
  })
})

describe('sandbox cleanup diagnostics', () => {
  test('keeps both removal errors and bounded metadata without following links', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swift-cleanup-diagnostic-'))
    const outside = mkdtempSync(join(tmpdir(), 'swift-cleanup-outside-'))
    const warnings: string[] = []
    writeFileSync(join(outside, 'private-content'), 'must never appear in diagnostics')
    symlinkSync(outside, join(directory, '00-link'), process.platform === 'win32' ? 'junction' : 'dir')
    for (let index = 0; index < 14; index++) mkdirSync(join(directory, `entry-${index}`))
    const remove = spyOn(fs, 'rmSync')
    remove.mockImplementationOnce(() => { throw Object.assign(new Error('first removal failed'), { code: 'EROFS', syscall: 'rm', path: directory }) })
    remove.mockImplementationOnce(() => { throw Object.assign(new Error('second removal failed'), { code: 'EROFS', syscall: 'rm', path: directory }) })
    try {
      expect(() => removeTestSandbox(directory, 'swift-checks', message => warnings.push(message))).not.toThrow()
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('could not remove test sandbox')
      expect(warnings[0]).toContain('stage=retry-rm')
      expect(warnings[0]).toContain('first removal failed')
      expect(warnings[0]).toContain('second removal failed')
      expect(warnings[0]).toContain('"code":"EROFS"')
      expect(warnings[0]).toContain('"type":"symlink"')
      expect(warnings[0]).toContain('"omitted":3')
      expect(warnings[0]).not.toContain('private-content')
      expect(warnings[0]).not.toContain('must never appear')
      expect(existsSync(join(outside, 'private-content'))).toBe(true)
    } finally {
      remove.mockRestore()
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('reports permission-repair failures separately from removal failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swift-cleanup-stage-'))
    const warnings: string[] = []
    const remove = spyOn(fs, 'rmSync').mockImplementationOnce(() => { throw new Error('initial removal') })
    const stat = spyOn(fs, 'lstatSync').mockImplementationOnce(() => { throw new Error('cannot inspect directory') })
    try {
      expect(() => removeTestSandbox(directory, 'swift-checks', message => warnings.push(message))).not.toThrow()
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('stage=open-directory-tree')
      expect(warnings[0]).toContain('initial removal')
      expect(warnings[0]).toContain('cannot inspect directory')
    } finally {
      remove.mockRestore()
      stat.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
