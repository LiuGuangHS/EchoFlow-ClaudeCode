// @vitest-environment node
import { spawnSync, type ExecFileSyncOptions } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { packageElectronDirectory } from './package-electron-directory'
import { createCuHelperBuildEnv } from './cu-helper-build-target'
import { codesignTimestampArgument, resolveStableSigningIdentity } from './sign-identity'

const temporaryDirs: string[] = []
const version = '42.7.0'

function fixture(platform: 'linux' | 'darwin' | 'win32' = 'linux', arch = 'x64') {
  const desktopRoot = mkdtempSync(path.join(os.tmpdir(), 'echoflow directory package '))
  temporaryDirs.push(desktopRoot)
  const electronRoot = path.join(desktopRoot, 'node_modules/electron')
  const dist = path.join(electronRoot, 'dist')
  const executablePath = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron'
  const executable = path.join(dist, executablePath)
  function write(relativePath: string, content: string) {
    const file = path.join(desktopRoot, relativePath)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  write('package.json', JSON.stringify({ devDependencies: { electron: '^42.4.0' } }))
  write('node_modules/electron/package.json', JSON.stringify({ name: 'electron', version }))
  write('node_modules/electron/path.txt', executablePath)
  write('node_modules/electron/dist/version', version)
  const resources = [executablePath, ...(platform === 'darwin'
    ? ['Electron.app/Contents/Info.plist', 'Electron.app/Contents/Resources/default_app.asar']
    : ['resources/default_app.asar', 'resources.pak', 'icudtl.dat', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'locales/en-US.pak'])]
  for (const file of resources) write(`node_modules/electron/dist/${file}`, 'fixture')
  chmodSync(executable, 0o755)
  const run = vi.fn((command: string, _args: readonly string[], _options: ExecFileSyncOptions) => (
    command === executable ? JSON.stringify({ version, platform, arch }) : Buffer.alloc(0)
  ))
  return { desktopRoot, dist, executable, run, write, options: { desktopRoot, platform, arch, run } }
}

beforeEach(() => {
  for (const key of ['SIDECAR_TARGET_TRIPLE', 'TAURI_ENV_TARGET_TRIPLE', 'CARGO_BUILD_TARGET', 'CI', 'GITHUB_ACTIONS']) {
    vi.stubEnv(key, undefined)
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('offline current-platform Electron directory packaging', () => {
  it.each([
    ['linux', 'x64', 'linux'], ['linux', 'arm64', 'linux'],
    ['darwin', 'x64', 'mac'], ['darwin', 'arm64', 'mac'],
    ['win32', 'x64', 'win'], ['win32', 'arm64', 'win'],
  ] as const)('probes then prepares and packages %s/%s from the installed distribution', (platform, arch, builderPlatform) => {
    const f = fixture(platform, arch)
    packageElectronDirectory(f.options)
    expect(f.run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [f.executable, ['-p', 'JSON.stringify({version:process.versions.electron,platform:process.platform,arch:process.arch})']],
      ['bun', ['run', 'clean:electron-output']],
      ['bun', ['run', 'electron:build']],
      ['node', [
        './node_modules/electron-builder/out/cli/cli.js', '--dir', '--publish', 'never', `--${builderPlatform}`, `--${arch}`,
        `--config.electronDist=${f.dist}`, `--config.electronVersion=${version}`,
        ...(platform === 'darwin' ? ['--config.mac.identity=-', '--config.mac.notarize=false', '--config.mac.timestamp=none'] : []),
        ...(platform === 'win32' ? ['--config.win.signAndEditExecutable=false'] : []),
      ]],
    ])
    expect(f.run.mock.calls[0][2]).toMatchObject({
      cwd: f.desktopRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
      env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
    })
    for (const call of f.run.mock.calls.slice(1)) expect(call[2]).toMatchObject({ cwd: f.desktopRoot, stdio: 'inherit' })
  })

  it.each(['linux', 'darwin', 'win32'] as const)('rejects builder environment files before probing or changing outputs on %s', platform => {
    const f = fixture(platform)
    f.write('electron-builder.env', 'CSC_LINK=fixture-certificate\n')
    f.write('build-artifacts/electron/keep.txt', 'previous output')
    // Invalid metadata must not mask the earlier environment-file refusal.
    f.write('node_modules/electron/package.json', '{')
    expect(() => packageElectronDirectory(f.options)).toThrow('electron-builder.env')
    expect(f.run).not.toHaveBeenCalled()
    expect(readFileSync(path.join(f.desktopRoot, 'build-artifacts/electron/keep.txt'), 'utf8')).toBe('previous output')
    expect(readFileSync(path.join(f.desktopRoot, 'electron-builder.env'), 'utf8')).toBe('CSC_LINK=fixture-certificate\n')
  })

  it.each(['empty file', 'directory'] as const)('rejects a builder environment path containing a %s before any command', kind => {
    const f = fixture()
    if (kind === 'directory') mkdirSync(path.join(f.desktopRoot, 'electron-builder.env'))
    else f.write('electron-builder.env', '')
    expect(() => packageElectronDirectory(f.options)).toThrow('electron-builder.env')
    expect(f.run).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('rejects a symlink at the builder environment path before any command', () => {
    const f = fixture()
    f.write('signing.env', 'CSC_LINK=fixture-certificate\n')
    symlinkSync(path.join(f.desktopRoot, 'signing.env'), path.join(f.desktopRoot, 'electron-builder.env'))
    expect(() => packageElectronDirectory(f.options)).toThrow('electron-builder.env')
    expect(f.run).not.toHaveBeenCalled()
  })

  it('does not confuse the invoking cwd with the builder cwd or load ordinary dotenv files', () => {
    const caller = fixture()
    const f = fixture()
    caller.write('electron-builder.env', 'CSC_LINK=caller-fixture\n')
    f.write('.env', 'CSC_LINK=ordinary-dotenv-fixture\n')
    vi.spyOn(process, 'cwd').mockReturnValue(caller.desktopRoot)
    packageElectronDirectory(f.options)
    expect(f.run).toHaveBeenCalledTimes(4)
    expect(f.run.mock.calls[3][2].cwd).toBe(f.desktopRoot)
  })

  it.each([
    ['package build', true, true, undefined, 'manifest'],
    ['discovered YAML', false, true, undefined, 'yaml'],
    ['explicit JSON', true, false, 'electron-builder.json', 'json'],
  ] as const)('matches installed CLI environment and configuration precedence with %s', (_case, buildField, cwdEnv, explicitConfig, expectedProductName) => {
    const caller = fixture()
    const project = fixture()
    caller.write('.env', 'CSC_LINK=ordinary-cwd-dotenv\n')
    project.write('.env', 'CSC_LINK=ordinary-project-dotenv\n')
    project.write('electron-builder.env', 'CSC_LINK=project-env\n')
    if (cwdEnv) caller.write('electron-builder.env', 'CSC_LINK=cwd-env\nCSC_NAME=file-name\n')
    project.write('package.json', JSON.stringify({
      name: 'fixture', version: '1.0.0',
      ...(buildField ? { build: { productName: 'manifest', extends: null } } : {}),
    }))
    project.write('electron-builder.yml', 'productName: yaml\nextends: null\n')
    project.write('electron-builder.json', JSON.stringify({ productName: 'json', extends: null }))
    const require = createRequire(import.meta.url)
    // Execute the real CLI loader/parser, replacing only the build task: no packing or certificate access.
    const script = `
      process.argv = ['node', 'electron-builder', '--projectDir', ${JSON.stringify(project.desktopRoot)},
        ${explicitConfig ? `'--config', ${JSON.stringify(explicitConfig)},` : ''} '--dir', '--publish', 'never']
      const builder = require(${JSON.stringify(require.resolve('electron-builder/out/builder.js'))})
      const { getConfig } = require(${JSON.stringify(require.resolve('app-builder-lib/out/util/config/config.js'))})
      builder.build = async args => {
        const options = builder.normalizeOptions(args)
        const config = await getConfig(options.projectDir, typeof options.config === 'string' ? options.config : undefined)
        console.log('FIXTURE_RESULT=' + JSON.stringify({
          productName: config.productName, cscLink: process.env.CSC_LINK ?? null, cscName: process.env.CSC_NAME,
        }))
      }
      require(${JSON.stringify(require.resolve('electron-builder/out/cli/cli.js'))})
    `
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: caller.desktopRoot,
      env: { HOME: caller.desktopRoot, USERPROFILE: caller.desktopRoot, CI: '1', NO_UPDATE_NOTIFIER: '1', CSC_NAME: 'inherited-name' },
      encoding: 'utf8', timeout: 10_000,
    })
    expect(child.status, `${child.error ?? ''}\n${child.stdout}\n${child.stderr}`).toBe(0)
    const result = child.stdout.split('\n').find(line => line.startsWith('FIXTURE_RESULT='))
    expect(result).toBeDefined()
    expect(JSON.parse(result!.slice('FIXTURE_RESULT='.length))).toEqual({
      productName: expectedProductName, cscLink: cwdEnv ? 'cwd-env' : null, cscName: 'inherited-name',
    })
  })

  it.each(['SIDECAR_TARGET_TRIPLE', 'TAURI_ENV_TARGET_TRIPLE', 'CARGO_BUILD_TARGET'])('rejects an effective cross-target %s before probing or cleaning', key => {
    const f = fixture()
    vi.stubEnv(key, 'aarch64-apple-darwin')
    expect(() => packageElectronDirectory(f.options)).toThrow('does not match host x86_64-unknown-linux-gnu')
    expect(f.run).not.toHaveBeenCalled()
  })

  it.each([
    ['linux', 'x64', 'x86_64-unknown-linux-gnu'], ['linux', 'arm64', 'aarch64-unknown-linux-gnu'],
    ['darwin', 'x64', 'x86_64-apple-darwin'], ['darwin', 'arm64', 'aarch64-apple-darwin'],
    ['win32', 'x64', 'x86_64-pc-windows-msvc'], ['win32', 'arm64', 'aarch64-pc-windows-msvc'],
  ] as const)('accepts an explicit matching target for %s/%s', (platform, arch, triple) => {
    const f = fixture(platform, arch)
    vi.stubEnv('SIDECAR_TARGET_TRIPLE', triple)
    packageElectronDirectory(f.options)
    expect(f.run).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu', false],
    ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin', 'aarch64-apple-darwin', true],
    ['', 'x86_64-unknown-linux-gnu', 'aarch64-apple-darwin', true],
    ['', 'aarch64-apple-darwin', 'x86_64-unknown-linux-gnu', false],
    ['', '', 'aarch64-apple-darwin', false],
    ['', '', 'x86_64-unknown-linux-gnu', true],
  ])('uses build-sidecars target precedence (%s, %s, %s)', (sidecar, tauri, cargo, allowed) => {
    const f = fixture()
    vi.stubEnv('SIDECAR_TARGET_TRIPLE', sidecar)
    vi.stubEnv('TAURI_ENV_TARGET_TRIPLE', tauri)
    vi.stubEnv('CARGO_BUILD_TARGET', cargo)
    if (allowed) {
      packageElectronDirectory(f.options)
      expect(f.run).toHaveBeenCalledTimes(4)
    } else {
      expect(() => packageElectronDirectory(f.options)).toThrow('does not match host')
      expect(f.run).not.toHaveBeenCalled()
    }
  })

  it('pins the existing offline unsigned macOS mode before building, without leaking it to later release builds', () => {
    const f = fixture('darwin', 'arm64')
    const inherited = {
      ECHOFLOW_SIGN_IDENTITY: 'Developer ID Application: Sidecar (FIXTURE)',
      CC_HAHA_SIGN_IDENTITY: 'Developer ID Application: Helper (FIXTURE)',
      CU_HELPER_IDENTITY: 'Developer ID Application: Stale (FIXTURE)',
      CU_HELPER_TIMESTAMP_MODE: 'secure',
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
      CSC_NAME: 'Release Fixture',
      CSC_LINK: 'https://invalid.example/fixture.p12',
      CSC_KEY_PASSWORD: 'unused-fixture',
      CSC_KEYCHAIN: '/fixture/release.keychain',
      CSC_INSTALLER_LINK: 'https://invalid.example/installer.p12',
      CSC_INSTALLER_KEY_PASSWORD: 'unused-fixture',
    }
    for (const [key, value] of Object.entries(inherited)) vi.stubEnv(key, value)
    const before = { ...process.env }
    packageElectronDirectory(f.options)
    for (const call of f.run.mock.calls.slice(1)) {
      const env = call[2].env!
      expect(env).toMatchObject({
        ECHOFLOW_SIGN_IDENTITY: '-', CC_HAHA_SIGN_IDENTITY: '-', CC_HAHA_LOCAL_UNSIGNED_BUILD: '1',
        CU_HELPER_TIMESTAMP_MODE: 'none', CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      })
      for (const key of ['CSC_NAME', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_KEYCHAIN', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD']) {
        expect(env[key]).toBeUndefined()
      }
      const identity = resolveStableSigningIdentity('1) 1111111111111111111111111111111111111111 "Developer ID Application: Fixture"', env.ECHOFLOW_SIGN_IDENTITY)
      expect(identity).toBe('-')
      expect(codesignTimestampArgument(identity)).toBe('--timestamp=none')
      expect(createCuHelperBuildEnv('aarch64-apple-darwin', env)).toMatchObject({
        CC_HAHA_SIGN_IDENTITY: '-', CU_HELPER_IDENTITY: '-', CC_HAHA_LOCAL_UNSIGNED_BUILD: '1', CU_HELPER_TIMESTAMP_MODE: 'none',
      })
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Computer Use is unavailable'))
    expect(process.env).toEqual(before)
  })

  it.each([['CI', 'true'], ['CI', '1'], ['GITHUB_ACTIONS', 'true']])('does not bypass the local-only unsigned macOS policy with %s=%s', (key, value) => {
    const f = fixture('darwin')
    vi.stubEnv(key, value)
    expect(() => packageElectronDirectory(f.options)).toThrow('CI must use a signed release entrypoint')
    expect(f.run).not.toHaveBeenCalled()
  })

  it.each(['linux', 'win32'] as const)('does not apply macOS signing overrides to %s', platform => {
    const f = fixture(platform)
    vi.stubEnv('ECHOFLOW_SIGN_IDENTITY', 'release-fixture')
    vi.stubEnv('CC_HAHA_SIGN_IDENTITY', 'release-fixture')
    vi.stubEnv('CC_HAHA_LOCAL_UNSIGNED_BUILD', undefined)
    const inherited = { ...process.env }
    packageElectronDirectory(f.options)
    for (const call of f.run.mock.calls.slice(1)) expect(call[2].env ?? process.env).toEqual(inherited)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['node_modules/electron/package.json', '{'],
    ['node_modules/electron/package.json', 'null'],
    ['node_modules/electron/package.json', JSON.stringify({ name: 'electron', version: 42 })],
    ['node_modules/electron/package.json', JSON.stringify({ name: 'other', version })],
    ['node_modules/electron/package.json', JSON.stringify({ name: 'electron', version: 'latest' })],
    ['node_modules/electron/dist/version', '42.4.0'],
    ['node_modules/electron/path.txt', 'electron.exe'],
    ['node_modules/electron/path.txt', '../../outside'],
    ['package.json', JSON.stringify({ devDependencies: { electron: '^41.0.0' } })],
    ['package.json', JSON.stringify({ devDependencies: { electron: 'not-a-range' } })],
    ['package.json', JSON.stringify({ devDependencies: { electron: '^42.4.0' }, build: { electronVersion: '42.4.0' } })],
    ['package.json', '{}'],
  ])('rejects invalid or mismatched metadata in %s before any command', (file, content) => {
    const f = fixture()
    f.write(file, content)
    expect(() => packageElectronDirectory(f.options)).toThrow('offline packaging will not download a replacement')
    expect(f.run).not.toHaveBeenCalled()
  })

  it('accepts the installer version marker with a v prefix and trailing newline', () => {
    const f = fixture()
    f.write('node_modules/electron/dist/version', `v${version}\n`)
    packageElectronDirectory(f.options)
    expect(f.run).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['linux', 'electron'], ['linux', 'chrome_100_percent.pak'], ['linux', 'resources/default_app.asar'],
    ['linux', 'resources.pak'], ['linux', 'icudtl.dat'], ['linux', 'locales/en-US.pak'],
    ['win32', 'electron.exe'], ['win32', 'chrome_200_percent.pak'],
    ['darwin', 'Electron.app/Contents/Info.plist'],
    ['darwin', 'Electron.app/Contents/Resources/default_app.asar'],
  ] as const)('rejects missing %s distribution resource %s without cleaning outputs', (platform, file) => {
    const f = fixture(platform)
    rmSync(path.join(f.dist, file))
    expect(() => packageElectronDirectory(f.options)).toThrow('Installed Electron is incomplete or incompatible')
    expect(f.run).not.toHaveBeenCalled()
  })

  it.each(['empty', 'directory'])('rejects a resource replaced by an %s', kind => {
    const f = fixture()
    const file = path.join(f.dist, 'resources.pak')
    if (kind === 'empty') writeFileSync(file, '')
    else {
      rmSync(file)
      mkdirSync(file)
    }
    expect(() => packageElectronDirectory(f.options)).toThrow('Missing or empty Electron distribution file')
    expect(f.run).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('rejects a non-executable Electron binary before probing or cleaning', () => {
    const f = fixture()
    chmodSync(f.executable, 0o644)
    expect(() => packageElectronDirectory(f.options)).toThrow('offline packaging will not download a replacement')
    expect(f.run).not.toHaveBeenCalled()
  })

  it('refuses an archive that would divert builder away from the validated directory', () => {
    const f = fixture()
    f.write(`node_modules/electron/dist/electron-v${version}-linux-x64.zip`, 'archive')
    expect(() => packageElectronDirectory(f.options)).toThrow('archive that would override')
    expect(f.run).not.toHaveBeenCalled()
  })

  it.each([
    'not json', 'null', '{}',
    JSON.stringify({ version: '42.4.0', platform: 'linux', arch: 'x64' }),
    JSON.stringify({ version, platform: 'win32', arch: 'x64' }),
    JSON.stringify({ version, platform: 'linux', arch: 'arm64' }),
  ])('fails closed on incompatible runtime metadata %s', output => {
    const f = fixture()
    f.run.mockReturnValueOnce(output)
    expect(() => packageElectronDirectory(f.options)).toThrow('offline packaging will not download a replacement')
    expect(f.run).toHaveBeenCalledTimes(1)
  })

  it('propagates failed execution of the installed binary without a download fallback', () => {
    const f = fixture()
    f.run.mockImplementationOnce(() => { throw new Error('Exec format error') })
    expect(() => packageElectronDirectory(f.options)).toThrow('Exec format error')
    expect(f.run).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['freebsd', 'x64'], ['linux', 'ia32'], ['darwin', 'universal'],
  ] as const)('rejects unsupported host %s/%s before filesystem reads or commands', (platform, arch) => {
    const run = vi.fn()
    expect(() => packageElectronDirectory({ desktopRoot: '/absent', platform, arch, run })).toThrow('Unsupported host')
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['clean:electron-output', 'electron:build'])('stops after %s failure instead of packaging stale output', script => {
    const f = fixture()
    f.run.mockImplementation((command, args) => {
      if (args.includes(script)) throw new Error(`${script} failed`)
      return command === f.executable ? JSON.stringify({ version, platform: 'linux', arch: 'x64' }) : Buffer.alloc(0)
    })
    expect(() => packageElectronDirectory(f.options)).toThrow(`${script} failed`)
    expect(f.run.mock.calls.some(([command]) => command === 'node')).toBe(false)
    if (script === 'clean:electron-output') expect(f.run.mock.calls).toHaveLength(2)
  })

  it('propagates builder failure without retrying a download', () => {
    const f = fixture()
    f.run.mockImplementation((command) => {
      if (command === 'node') throw new Error('builder failed')
      return command === f.executable ? JSON.stringify({ version, platform: 'linux', arch: 'x64' }) : Buffer.alloc(0)
    })
    expect(() => packageElectronDirectory(f.options)).toThrow('builder failed')
    expect(f.run).toHaveBeenCalledTimes(4)
  })

  it('exposes the offline entrypoint and includes its regression in the native lane, without changing release signing', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'))
    expect(manifest.scripts['electron:package:dir']).toBe('bun run ./scripts/package-electron-directory.ts')
    expect(manifest.scripts['test:package:dir']).toBe('vitest run scripts/package-electron-directory.test.ts')
    expect(manifest.scripts['check:electron']).toContain('bun run test:package:dir &&')
    expect(manifest.scripts['electron:package']).toContain('prepare:cloudflared')
    expect(manifest.scripts['electron:package']).not.toContain('package-electron-directory')
    expect(manifest.scripts['build:macos-arm64']).toBe('bash ./scripts/build-macos-arm64.sh')
    expect(manifest.scripts['build:windows-x64']).toBe('powershell -ExecutionPolicy Bypass -File ./scripts/build-windows-x64.ps1')
    expect(manifest.scripts['build:linux-arm64']).toBe('LINUX_ARCH=arm64 bash ./scripts/build-linux.sh')
    expect(manifest.build.electronDist).toBeUndefined()
    expect(manifest.build.mac.notarize).toBe(true)
    expect(manifest.build.mac.identity).toBeUndefined()
    expect(manifest.build.mac.timestamp).toBeUndefined()
    expect(manifest.build.win.signAndEditExecutable).toBeUndefined()
  })
})
