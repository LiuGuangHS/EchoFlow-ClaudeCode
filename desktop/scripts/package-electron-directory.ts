import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { resolveHostTriple } from '../electron/services/sidecarManager'

const executablePaths = {
  linux: 'electron',
  win32: 'electron.exe',
  darwin: 'Electron.app/Contents/MacOS/Electron',
} as const

function requiredResources(platform: keyof typeof executablePaths) {
  // shortcut: check stable startup resources, use native package smoke for complete artifact validation.
  return platform === 'darwin'
    ? ['Electron.app/Contents/Info.plist', 'Electron.app/Contents/Resources/default_app.asar']
    : ['resources/default_app.asar', 'resources.pak', 'icudtl.dat', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'locales/en-US.pak']
}

export function packageElectronDirectory({
  desktopRoot = path.resolve(import.meta.dirname, '..'),
  platform = process.platform,
  arch = process.arch,
  run = execFileSync,
}: {
  desktopRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  run?: (command: string, args: readonly string[], options: ExecFileSyncOptions) => string | Buffer
} = {}) {
  if (!(platform in executablePaths) || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error(`[package-electron-directory] Unsupported host: ${platform}/${arch}`)
  }
  const hostTriple = resolveHostTriple(platform, arch)
  // Match build-sidecars' precedence; lower-priority overrides may be intentionally masked.
  const targetTriple = process.env.SIDECAR_TARGET_TRIPLE || process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || hostTriple
  if (targetTriple !== hostTriple) {
    throw new Error(`[package-electron-directory] Effective sidecar target ${targetTriple} does not match host ${hostTriple}; use release entrypoints for cross-platform packaging`)
  }
  if (platform === 'darwin' && (process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true')) {
    throw new Error('[package-electron-directory] Offline macOS directory packaging is local unsigned only; CI must use a signed release entrypoint')
  }
  // The CLI reloads this from its cwd after env scrubbing, before choosing ad-hoc signing.
  const builderEnv = path.join(desktopRoot, 'electron-builder.env')
  if (lstatSync(builderEnv, { throwIfNoEntry: false })) {
    throw new Error(`[package-electron-directory] Offline directory packaging refuses ${builderEnv}; use a checkout without electron-builder.env or a release entrypoint`)
  }
  const hostPlatform = platform as keyof typeof executablePaths
  const electronRoot = path.join(desktopRoot, 'node_modules', 'electron')
  const electronDist = path.join(electronRoot, 'dist')
  const executablePath = executablePaths[hostPlatform]
  const executable = path.join(electronDist, executablePath)
  let version: string

  // Validate before cleaning output or building; never repair/download implicitly.
  try {
    const manifest = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))
    const installed = JSON.parse(readFileSync(path.join(electronRoot, 'package.json'), 'utf8'))
    const requested = manifest.devDependencies?.electron ?? manifest.dependencies?.electron
    const distVersion = readFileSync(path.join(electronDist, 'version'), 'utf8').trim().replace(/^v/, '')
    if (installed.name !== 'electron' || typeof installed.version !== 'string' || !semver.valid(installed.version)
      || typeof requested !== 'string' || !semver.satisfies(installed.version, requested)
      || distVersion !== installed.version
      || (manifest.build?.electronVersion != null && manifest.build.electronVersion !== installed.version)) {
      throw new Error('Electron package, distribution and requested versions must match')
    }
    version = installed.version
    if (readFileSync(path.join(electronRoot, 'path.txt'), 'utf8').trim() !== executablePath) {
      throw new Error(`Electron path.txt does not match ${platform}`)
    }
    for (const relativePath of [executablePath, ...requiredResources(hostPlatform)]) {
      const file = path.join(electronDist, relativePath)
      const stat = statSync(file)
      if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or empty Electron distribution file: ${file}`)
      accessSync(file, constants.R_OK)
    }
    accessSync(executable, platform === 'win32' ? constants.R_OK : constants.X_OK)
    // Builder prefers a matching ZIP over the unpacked directory when both exist.
    if (existsSync(path.join(electronDist, `electron-v${version}-${platform}-${arch}.zip`))) {
      throw new Error('Electron dist contains an archive that would override the validated unpacked distribution')
    }
    const runtime = JSON.parse(run(executable, [
      '-p', 'JSON.stringify({version:process.versions.electron,platform:process.platform,arch:process.arch})',
    ], {
      cwd: desktopRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    }).toString())
    if (runtime?.version !== version || runtime?.platform !== platform || runtime?.arch !== arch) {
      throw new Error(`Electron runtime must match ${version}/${platform}/${arch}`)
    }
  } catch (cause) {
    throw new Error(
      `[package-electron-directory] Installed Electron is incomplete or incompatible; offline packaging will not download a replacement. Prepare matching desktop dependencies first. ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }

  const env = { ...process.env }
  if (platform === 'darwin') {
    // The sidecar uses the current name; native/cu-helper/build.sh still uses the legacy name.
    env.ECHOFLOW_SIGN_IDENTITY = '-'
    env.CC_HAHA_SIGN_IDENTITY = '-'
    env.CC_HAHA_LOCAL_UNSIGNED_BUILD = '1'
    env.CU_HELPER_TIMESTAMP_MODE = 'none'
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    // Builder can import/download a certificate even with mac.identity=-.
    for (const key of ['CSC_NAME', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_KEYCHAIN', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD']) {
      delete env[key]
    }
    console.warn('[package-electron-directory] Local ad-hoc package: Computer Use is unavailable without a shared signing certificate; attestation remains enforced.')
  }
  const options = { cwd: desktopRoot, stdio: 'inherit' as const, env }
  run('bun', ['run', 'clean:electron-output'], options)
  run('bun', ['run', 'electron:build'], options)
  run('node', [
    './node_modules/electron-builder/out/cli/cli.js',
    '--dir', '--publish', 'never',
    `--${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'}`, `--${arch}`,
    `--config.electronDist=${electronDist}`, `--config.electronVersion=${version}`,
    // Smoke packages use only local signing; release entrypoints keep their signing policy.
    ...(platform === 'darwin' ? ['--config.mac.identity=-', '--config.mac.notarize=false', '--config.mac.timestamp=none'] : []),
    ...(platform === 'win32' ? ['--config.win.signAndEditExecutable=false'] : []),
  ], options)
}

if (import.meta.main) {
  if (process.argv.length > 2) throw new Error('electron:package:dir accepts no arguments; use release entrypoints for cross-platform packaging')
  packageElectronDirectory()
}
