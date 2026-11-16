import { describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import * as childProcess from 'node:child_process'
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

describe('Swift sandbox disk image lifecycle', () => {
  test.skipIf(process.platform === 'win32').each([
    'success', 'failed-swift', 'busy', 'info-failure', 'invalid-plist', 'still-mounted',
    'outside', 'sibling', 'mixed', 'symlink-escape', 'invalid-device', 'replacement',
    'replacement-directory', 'other-error', 'cleanup-failure', 'parser-failure', 'invalid-json', 'changed-after-first-detach',
  ])('detaches only sandbox-owned images and preserves failures: %s', async scenario => {
    const outside = mkdtempSync(join(tmpdir(), 'swift-image-external-'))
    writeFileSync(join(outside, 'keep'), 'external fixture')
    let home = ''
    let sibling = ''
    let plist = ''
    let infos = 0
    const commands: string[][] = []
    const originalRemove = fs.rmSync
    const originalSpawn = childProcess.spawnSync
    const remove = spyOn(fs, 'rmSync')
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const log = spyOn(console, 'log').mockImplementation(() => {})
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const image = (mounts: string[], device = '/dev/disk9s1') => `<dict><key>attach-date</key><date>2026-11-15T00:00:00Z</date><key>image-alias</key><data>YWJj</data><key>system-entities</key><array>${mounts.map(point => `<dict><key>dev-entry</key><string>${device}</string><key>mount-point</key><string>${xml(point)}</string></dict>`).join('')}</array></dict>`
    const document = (images: string[]) => `<?xml version="1.0"?><plist version="1.0"><dict><key>images</key><array>${images.join('')}</array></dict></plist>`
    const result = (stdout = '', status = 0, stderr = '') => ({ status, signal: null, stdout, stderr }) as ReturnType<typeof childProcess.spawnSync>
    const spawn = spyOn(childProcess, 'spawnSync').mockImplementation((command: any, args: any, options: any) => {
      commands.push([command, ...args])
      if (command === '/usr/bin/python3') {
        expect(args.slice(0, 2)).toEqual(['-I', '-c'])
        expect(options.env).toEqual({})
        if (scenario === 'parser-failure') return result('', 1, 'fixture parser failed')
        if (scenario === 'invalid-json') return result('not json')
        return originalSpawn(command, args, options)
      }
      expect(command).toBe('/usr/bin/hdiutil')
      expect(options.env.HOME).toBe(home)
      expect(options.env.CFFIXED_USER_HOME).toBe(home)
      expect(options.env.GH_TOKEN).toBeUndefined()
      expect(options.timeout).toBe(10_000)
      if (args[0] === 'info') {
        expect(args).toEqual(['info', '-plist'])
        infos++
        if (scenario === 'info-failure') return result('', 1, 'fixture info failed')
        if (scenario === 'invalid-plist') return result('<plist><dict>')
        return result(infos === 1 || scenario === 'still-mounted' ? plist : document([]))
      }
      expect(args).toEqual(['detach', '/dev/disk9s1'])
      if (scenario === 'changed-after-first-detach') {
        fs.renameSync(home, join(outside, 'original-sandbox'))
        mkdirSync(home)
      }
      return scenario === 'busy' ? result('', 1, 'fixture resource busy') : result()
    })
    const exit = scenario === 'success' || scenario === 'busy' ? 0 : 7
    try {
      expect(await runSwiftChecks({ platform: 'darwin', run: async (_command, options) => {
        if (home) return exit
        home = options.env.HOME
        const mount = join(home, 'Library', 'Developer', 'Metal Toolchain & fixture')
        mkdirSync(mount, { recursive: true })
        const extraMount = join(home, 'second-volume')
        mkdirSync(extraMount)
        const mounts = [mount, extraMount]
        if (scenario === 'outside') mounts.splice(0, mounts.length, outside)
        if (scenario === 'sibling') {
          sibling = `${home}-neighbor`
          mkdirSync(sibling)
          mounts.splice(0, mounts.length, sibling)
        }
        if (scenario === 'mixed') mounts.push(outside)
        if (scenario === 'symlink-escape') {
          const link = join(home, 'escape')
          symlinkSync(outside, link, 'dir')
          mounts.splice(0, mounts.length, link)
        }
        plist = document([image(mounts, scenario === 'invalid-device' ? '/dev/invalid' : '/dev/disk9s1'), image([outside], '/dev/disk22s1')])
        if (scenario === 'changed-after-first-detach') plist = document([image([mount]), image([extraMount], '/dev/disk10s1')])
        if (scenario.startsWith('replacement')) {
          fs.renameSync(home, join(outside, 'original-sandbox'))
          if (scenario === 'replacement') symlinkSync(outside, home, 'dir')
          else mkdirSync(home)
        }
        const code = scenario === 'other-error' ? 'EACCES' : 'EROFS'
        remove.mockImplementationOnce(() => { throw Object.assign(new Error('initial removal'), { code }) })
        remove.mockImplementationOnce(() => { throw Object.assign(new Error('retry removal'), { code }) })
        if (scenario === 'cleanup-failure') {
          remove.mockImplementationOnce(() => { throw new Error('post-detach removal') })
          remove.mockImplementationOnce(() => { throw new Error('post-detach retry') })
        }
        return exit
      } })).toBe(exit)
      expect(existsSync(join(outside, 'keep'))).toBe(true)
      const detaches = commands.filter(command => command[1] === 'detach')
      const shouldDetach = ['success', 'failed-swift', 'busy', 'still-mounted', 'cleanup-failure', 'changed-after-first-detach'].includes(scenario)
      expect(detaches).toEqual(shouldDetach ? [['/usr/bin/hdiutil', 'detach', '/dev/disk9s1']] : [])
      expect(commands.some(command => command[0] === '/bin/rm')).toBe(false)
      if (scenario === 'success' || scenario === 'failed-swift') {
        expect(existsSync(home)).toBe(false)
        expect(warn).not.toHaveBeenCalled()
        expect(log.mock.calls.flat().join(' ')).toContain('detached 1 sandbox disk image(s)')
      } else {
        expect(existsSync(home)).toBe(true)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls.flat().join(' ')).toContain('could not remove test sandbox')
      }
      if (scenario.startsWith('replacement') || scenario === 'other-error') expect(commands).toEqual([])
      if (scenario === 'busy') expect(warn.mock.calls.flat().join(' ')).toContain('fixture resource busy')
      if (scenario === 'mixed') expect(warn.mock.calls.flat().join(' ')).toContain('mount outside sandbox')
      if (scenario === 'symlink-escape') expect(warn.mock.calls.flat().join(' ')).toContain('resolves outside sandbox')
      if (scenario === 'changed-after-first-detach') expect(warn.mock.calls.flat().join(' ')).toContain('identity changed')
      if (scenario === 'parser-failure') expect(warn.mock.calls.flat().join(' ')).toContain('fixture parser failed')
      if (scenario === 'still-mounted') expect(warn.mock.calls.flat().join(' ')).toContain('remains mounted')
    } finally {
      remove.mockRestore()
      spawn.mockRestore()
      warn.mockRestore()
      log.mockRestore()
      if (home) originalRemove(home, { recursive: true, force: true })
      if (sibling) originalRemove(sibling, { recursive: true, force: true })
      originalRemove(outside, { recursive: true, force: true })
    }
  })
})
