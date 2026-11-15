import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSandboxedTestEnvironment } from './test-environment'

describe('Windows installer recovery prerequisites', () => {
  test('checks both package aliases before taking the branded-profile fast path', () => {
    const hook = readFileSync('desktop/build/installer.nsh', 'utf8').replace(/\r\n/g, '\n')
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const fastPath = hook.match(/Function CcHahaCanSkipLegacyRecovery\r?\n([\s\S]*?)FunctionEnd/)?.[1] ?? ''
    expect(hook).toContain('!include "${BUILD_RESOURCES_DIR}\\product-identity.generated.nsh"')
    for (const root of ['$R1', '$R2']) {
      for (const name of ['ECHOFLOW_PRODUCT_SLUG', 'ECHOFLOW_LEGACY_DESKTOP_PACKAGE_NAME']) {
        expect(fastPath).toContain(`Push "${root}\\\${${name}}"\n  Call CcHahaIsAbsentOrEmptyDirectory\n  Pop $R3\n  StrCmp $R3 "1" 0 cc_haha_skip_recovery_done`)
      }
    }
    expect(hook).toContain('-DesktopPackageName "${ECHOFLOW_PRODUCT_SLUG}" -LegacyDesktopPackageName "${ECHOFLOW_LEGACY_DESKTOP_PACKAGE_NAME}"')
    expect(helper).toContain('-ProfileNames @($DesktopPackageName, $LegacyDesktopPackageName)')
    expect(helper).toContain('package profile pointer was not recovered')
    expect(helper).toContain('package profile journal was bypassed')
  })

  test('resolves both profile roots and validates journals before legacy discovery', () => {
    const hook = readFileSync('desktop/build/installer.nsh', 'utf8')
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    expect(hook).toContain('ReadEnvStr $R2 LOCALAPPDATA')
    for (const root of ['$R1', '$R2']) {
      expect(hook).toContain(`IfFileExists "${root}\\\${ECHOFLOW_PRODUCT_NAME}\\data-migration-v1.json" cc_haha_skip_recovery_done`)
    }
    expect(hook).toContain('-LocalUserDataDir "$R2\\${ECHOFLOW_PRODUCT_NAME}"')
    expect(helper).toContain('function Resolve-UserDataDirectory')
    expect(helper).toContain('function Assert-MigrationJournalAllowsRecovery')
    const recovery = helper.slice(helper.indexOf('function Invoke-LegacyRecovery {'), helper.indexOf('function Assert-SelfTest {'))
    expect(recovery).toMatch(/\$UserDataDir = Resolve-UserDataDirectory[^\r\n]*[\s\S]*Assert-MigrationJournalAllowsRecovery[\s\S]*\$source = Get-UnsafeLegacySource/)
    expect(recovery).not.toMatch(/if \(Test-Path[^\r\n]*data-migration-v1\.json[^\r\n]*\) \{\s*throw/)
    expect(helper).toContain('Both Windows data directories contain user state')
    expect(helper).toContain('Finish migration recovery in the application before upgrading')
    expect(helper).toContain('Local pointer recovery did not preserve its source')
    expect(helper).toContain('dual profile roots did not fail closed')
  })

  test('keeps terminal, pending, invalid and read-only journal fixtures in Windows SelfTest', () => {
    // These are wiring assertions; only Windows SelfTest proves recovery behavior.
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const selfTest = helper.slice(helper.indexOf('function Run-SelfTest {'))
    expect(helper).toContain('function New-TestMigrationJournal')
    expect(helper).toContain('function Assert-TestRecoveryRefused')
    for (const scenario of [
      "@('completed', 'failed', 'cancelled')",
      "@('historical-selection', 'later-portable', 'later-default')",
      "@('preparing', 'quiescing', 'copying', 'verifying', 'committing', 'restarting')",
      'missing-selected-target',
      'unreadable-journal',
      'manifest-traversal',
      'invalid-credentials',
      'later-portable-without-history',
      'later-default-without-mode',
      'overlapping-identities',
      'duplicate-credentials',
      'directory-journal',
      'terminal journal bypassed install-contained discovery',
      'terminal journal bypassed shared-install protection',
      'terminal journal bypassed dual-root protection',
      'terminal journal changed historical or current state',
    ]) expect(selfTest).toContain(scenario)
    expect(helper).toContain('refusal modified journal, mode, source or staging')
    expect(helper).toContain('refusal created a recovery copy')
  })

  test('decodes BOM-less UTF-8 mode pointers and covers missing Unicode targets', () => {
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const reader = helper.slice(helper.indexOf('function Read-AppMode {'), helper.indexOf('function Test-LegacyPortableData {'))
    const writer = helper.slice(helper.indexOf('function Write-TestMode {'), helper.indexOf('function New-TestMigrationJournal {'))
    expect(reader).toContain('Get-Content -LiteralPath $modeFile -Raw -Encoding UTF8')
    expect(writer).toContain('New-Object Text.UTF8Encoding($false)')
    expect(helper).toContain('missing-selected-unicode-target')
    expect(helper).toContain('BOM-less Unicode mode pointer did not round-trip')
  })

  test('keeps current portable authority separate from retained legacy candidates', () => {
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const discovery = helper.slice(helper.indexOf('function Get-LegacyActiveSource {'), helper.indexOf('function Get-ExistingInstallDirs {'))
    expect(discovery).toContain('$currentSource = Resolve-LegacyConfiguredPath')
    expect(discovery).toContain('Test-SamePath -Left $currentSource -Right $legacySource')
    expect(discovery).toContain('Current portable selection conflicts with retained legacy data')
    expect(helper).toContain('retained-source-current-selection')
    expect(helper).toContain('retry refused to override the current recovered selection')
  })

  test('carries terminal history into legacy discovery without treating retained default data as authority', () => {
    // Linux contracts only; the complete-manifest SelfTest fixtures exercise Windows behavior.
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const discovery = helper.slice(helper.indexOf('function Get-LegacyActiveSource {'), helper.indexOf('function Get-ExistingInstallDirs {'))
    const recovery = helper.slice(helper.indexOf('function Invoke-LegacyRecovery {'), helper.indexOf('function Assert-SelfTest {'))
    expect(recovery).toContain('$hasTerminalJournal = Assert-MigrationJournalAllowsRecovery')
    expect(recovery).toContain('-HasTerminalJournal:$hasTerminalJournal')
    expect(discovery).toMatch(/\$HasTerminalJournal[\s\S]*throw "Current selection conflicts with retained legacy data after migration/)
    expect(helper).toContain('terminal-retained-default-')
    expect(helper).toContain('legacy default was not recovered')
  })

  test('requires a valid explicit completed-journal selection before accepting startup', () => {
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const gate = helper.slice(helper.indexOf('function Assert-MigrationJournalAllowsRecovery {'), helper.indexOf('function Invoke-LegacyRecovery {'))
    expect(gate).toContain('Read-AppMode -ConfigDir $UserDataDir -RequireExplicitSelection')
    expect(gate).toContain("if ($null -eq $current) { throw 'Migrated data startup configuration is unavailable' }")
    expect(helper).toContain('Existing app mode metadata is not a regular file')
    for (const scenario of ['completed-missing-mode', 'completed-directory-mode', 'completed-implicit-mode', 'completed-empty-portable', 'completed-relative-portable', 'completed-uppercase-mode']) {
      expect(helper).toContain(scenario)
    }
  })

  test('allows a populated implicit-default profile only after proving mode absence and a normal directory', () => {
    const hook = readFileSync('desktop/build/installer.nsh', 'utf8')
    const fastPath = hook.match(/Function CcHahaCanSkipLegacyRecovery\r?\n([\s\S]*?)FunctionEnd/)?.[1] ?? ''
    expect(fastPath).toContain('cc_haha_check_profile_default:')
    expect(fastPath).toContain('GetFileAttributesW(w "$R3\\${ECHOFLOW_PRODUCT_NAME}\\app-mode.json")')
    expect(fastPath).toMatch(/cc_haha_profile_mode_missing:[\s\S]*StrCmp \$R1 2 0 cc_haha_skip_recovery_done[\s\S]*IntOp \$R5 \$R5 & 0x410[\s\S]*StrCmp \$R5 16 0 cc_haha_skip_recovery_done/)
  })

  test('reports elevated profile cases as identity-only rather than profile refusal coverage', () => {
    const smoke = readFileSync('desktop/scripts/windows-installer-smoke.ps1', 'utf8')
    expect(smoke).toContain('UNEXERCISED: packaged profile-specific success and refusal branches')
    expect(smoke).toContain('Elevated identity-only refusal without CLR')
    expect(smoke).toMatch(/if \(Test-IsProcessElevated\) \{\s*Invoke-ProcessExpectFailure[^\n]*identity-only[\s\S]*\} elseif \(\$scenario -like 'default-\*'\)/)
  })

  test('persists bounded smoke diagnostics and reports coverage even after failures', () => {
    const smoke = readFileSync('desktop/scripts/windows-installer-smoke.ps1', 'utf8')
    expect(smoke).toContain('windows-installer-smoke-$Arch')
    expect(smoke).toContain("Join-Path $evidenceDir 'diagnostics.log'")
    expect(smoke).toContain("status = 'unexercised'; reason = 'Elevated runner refuses at identity gate")
    expect(smoke).toContain("$results[$script:activeCheck] = [ordered]@{ status = 'passed'")
    expect(smoke).toContain('$completedCases += 1')
    expect(smoke).not.toContain('no-CLR default reinstall, and fail-closed portable reinstall smoke passed')
    expect(smoke).toMatch(/\} finally \{\s*try \{\s*Write-SmokeReport/)
    expect(smoke).toContain('if (-not $failure) { throw }')
    expect(smoke).toContain('if (-not $failure -and -not $cleanupFailure)')
    expect(smoke).toContain("@{ source = $windowLog; name = 'window.jsonl' }")
    expect(smoke).toContain("@{ source = $hostDiagnostics; name = 'host.log' }")
    expect(smoke).not.toMatch(/Copy-Item[^\r\n]*-Recurse/)
    expect(smoke).toContain('launch-$launchNumber-$($entry.name)')
    expect(smoke).toContain(`'/currentuser', "_?=$installDir") -TimeoutSeconds 120`)
    expect(smoke).toContain('Remove-SmokeFixture')
    expect(smoke.indexOf('Copy-Item -LiteralPath $entry.source')).toBeLessThan(smoke.lastIndexOf('Remove-SmokeFixture'))
  })

  test.skipIf(process.platform !== 'win32')('writes honest smoke JSON and Actions summaries in isolated fixtures', () => {
    // Execute only the reporting functions, never the CI-only installer body.
    const smoke = readFileSync('desktop/scripts/windows-installer-smoke.ps1', 'utf8')
    const functions = ['New-SmokeResults', 'Write-SmokeReport', 'Write-SmokeDiagnostic', 'Remove-SmokeFixture'].map(name => {
      const body = smoke.match(new RegExp(`function ${name} \\{[\\s\\S]*?^\\}`, 'm'))?.[0]
      if (!body) throw new Error(`Missing reporting function ${name}`)
      return body
    }).join('\n')
    const root = mkdtempSync(path.join(tmpdir(), 'echoflow-smoke-report-'))
    try {
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const summary = path.join(root, 'actions-summary.md')
      const script = `${functions}
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:GITHUB_STEP_SUMMARY = ${quote(summary)}
foreach ($scenario in @('elevated', 'early-failure', 'cleanup-failure')) {
  $directory = Join-Path ${quote(root)} $scenario
  New-Item -ItemType Directory -Path $directory | Out-Null
  $results = New-SmokeResults
  $failure = ''
  $cleanupFailure = ''
  if ($scenario -eq 'elevated') {
    foreach ($name in @('native-helper-regressions', 'packaged-smoke', 'elevated-identity-no-clr', 'cleanup')) {
      $results[$name] = @{ status = 'passed'; reason = 'Fixture assertions completed'; evidence = 'Fixture evidence' }
    }
    $results['packaged-profile-no-clr'].reason = 'Elevated identity gate; profile branches unexercised'
  } else {
    $failure = "original | failure\nsecond line"
    $results['native-helper-regressions'] = @{ status = 'failed'; reason = $failure; evidence = 'Fixture failure' }
    if ($scenario -eq 'cleanup-failure') {
      $cleanupFailure = 'cleanup failed separately'
      $results['cleanup'] = @{ status = 'failed'; reason = $cleanupFailure; evidence = 'Fixture cleanup' }
    }
  }
  Write-SmokeReport -Results $results -Directory $directory -Failure $failure -CleanupFailure $cleanupFailure
}
# Deterministic contention: no installer, real process, or wall-clock delay.
$evidenceDir = ${quote(root)}
$cleanupProbes = @{}
function Remove-Item {
  param($LiteralPath, [switch]$Recurse, [switch]$Force, $ErrorAction)
  if ($LiteralPath -ne $testRoot) { throw 'Cleanup escaped its owned fixture' }
  $script:attempts += 1
  if ($script:cleanupScenario -eq 'permanent' -or $script:attempts -eq 1) {
    throw [IO.IOException]::new('simulated directory not empty or busy')
  }
  Microsoft.PowerShell.Management\\Remove-Item -LiteralPath $LiteralPath -Recurse -Force -ErrorAction Stop
}
foreach ($cleanupScenario in @('transient', 'permanent')) {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('cc-haha-installer-smoke-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  Set-Content -LiteralPath (Join-Path $testRoot 'sentinel.txt') -Value 'fixture-only'
  $attempts = 0
  $cleanupError = ''
  try { Remove-SmokeFixture -MaxAttempts 3 -RetryDelayMilliseconds 0 } catch { $cleanupError = $_.Exception.Message }
  $cleanupProbes[$cleanupScenario] = @{ attempts = $attempts; error = $cleanupError; remains = (Test-Path -LiteralPath $testRoot) }
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) 'not-owned-fixture'
$attempts = 0
try { Remove-SmokeFixture -MaxAttempts 3 -RetryDelayMilliseconds 0 } catch { $cleanupProbes['unowned'] = @{ attempts = $attempts; error = $_.Exception.Message } }
$cleanupProbes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path ${quote(root)} 'cleanup-probes.json') -Encoding UTF8
`
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        env: createSandboxedTestEnvironment(path.join(root, 'home')), encoding: 'utf8', timeout: 30_000,
      })
      expect(run.error, run.stderr || run.stdout).toBeUndefined()
      expect(run.status, run.stderr || run.stdout).toBe(0)
      const report = (name: string) => JSON.parse(readFileSync(path.join(root, name, 'result.json'), 'utf8').replace(/^\uFEFF/, ''))
      const probes = JSON.parse(readFileSync(path.join(root, 'cleanup-probes.json'), 'utf8').replace(/^\uFEFF/, ''))
      expect(probes.transient).toEqual({ attempts: 2, error: '', remains: false })
      expect(probes.permanent.attempts).toBe(3)
      expect(probes.permanent.remains).toBe(true)
      expect(probes.permanent.error).toContain('failed after 3 attempts; remaining fixture:')
      expect(probes.permanent.error).toContain('simulated directory not empty or busy')
      expect(probes.unowned.attempts).toBe(0)
      expect(probes.unowned.error).toContain('Refusing unexpected smoke fixture cleanup path')
      expect(readFileSync(path.join(root, 'diagnostics.log'), 'utf8')).toContain('cleanup attempt 3/3 failed')
      const elevated = report('elevated')
      expect(elevated.status).toBe('passed')
      expect(elevated.coverage).toBe('unexercised')
      expect(elevated.checks['packaged-profile-no-clr'].status).toBe('unexercised')
      expect(elevated.checks['elevated-identity-no-clr'].status).toBe('passed')
      const early = report('early-failure')
      expect(early.status).toBe('failed')
      expect(early.coverage).toBe('failed')
      expect(early.checks['packaged-smoke'].status).toBe('unexercised')
      const cleanup = report('cleanup-failure')
      expect(cleanup.failure).toBe('original | failure\nsecond line')
      expect(cleanup.cleanupFailure).toBe('cleanup failed separately')
      expect(cleanup.checks.cleanup.status).toBe('failed')
      const markdown = readFileSync(summary, 'utf8')
      expect(markdown.match(/## Windows installer smoke/g)).toHaveLength(3)
      expect(markdown).toContain('original &#124; failure second line')
      expect(markdown).toContain('ordinary-user packaged branches on an elevated runner')
      expect(readFileSync(path.join(root, 'elevated', 'summary.md'), 'utf8')).toContain('coverage: **unexercised**')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 40_000) // Allow the 30s PowerShell budget plus assertions and fixture cleanup.

  test('validates historical staging names without a mounted drive', () => {
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    expect(helper).toContain('[IO.Path]::Combine($status.targetDir, ".cc-haha-migration-$($status.id)")')
    expect(helper).not.toContain('Join-Path $status.targetDir ".cc-haha-migration-$($status.id)"')
    expect(helper).toContain('unavailable-historical-drive')
  })

  test('selects profile roots lexically and treats cache names case-sensitively', () => {
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const resolver = helper.slice(helper.indexOf('function Resolve-UserDataDirectory {'), helper.indexOf('function Assert-JournalProperties {'))
    expect(resolver).toContain('[IO.Path]::GetFullPath($Current)')
    expect(resolver).toContain('[IO.Path]::GetFullPath($Published)')
    expect(resolver).not.toContain('Test-SamePath')
    expect(resolver).toContain('$caches -cnotcontains $_.Name')
    expect(helper).toContain('unused-unc-roaming')
    expect(helper).toContain("@('logs', 'Cache', 'LOGS', 'cache')")
    expect(helper).toContain('case-variant cache bypassed dual-root protection')
  })

  test('terminal acceptance still precedes shared-install and process safety checks', () => {
    const helper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const recovery = helper.slice(helper.indexOf('function Invoke-LegacyRecovery {'), helper.indexOf('function Assert-SelfTest {'))
    expect(recovery).toMatch(/Assert-MigrationJournalAllowsRecovery[\s\S]*Get-UnsafeLegacySource[\s\S]*Assert-NoUndiscoveredLegacySources[\s\S]*untrusted-elevated[\s\S]*Assert-NoRunningApplication[\s\S]*Copy-VerifiedTree[\s\S]*Assert-NoRunningApplication[\s\S]*Write-AppModeAtomically/)
    const journalGate = helper.slice(helper.indexOf('function Assert-MigrationJournalAllowsRecovery {'), helper.indexOf('function Invoke-LegacyRecovery {'))
    expect(journalGate).not.toMatch(/Remove-Item|Copy-VerifiedTree|Write-AppModeAtomically|Assert-TreeManifestsEqual/)
    expect(helper).toContain('terminal journal bypassed process uncertainty protection')
  })

  test('selects exactly one current Windows artifact for the requested architecture', () => {
    const smoke = readFileSync('desktop/scripts/windows-installer-smoke.ps1', 'utf8')
    const config = JSON.parse(readFileSync('desktop/package.json', 'utf8'))
    expect(config.build.artifactName).toBe('EchoFlow-Code-${version}-${os}-${arch}.${ext}')
    expect(smoke).toContain('"EchoFlow-Code-*-win-$Arch.exe"')
    expect(smoke).toContain('if ($installers.Count -ne 1)')
    expect(smoke).not.toContain('Claude-Code-Haha-*-Windows-')
  })

  test('does not compile native path helpers at install time', () => {
    const recoveryHelper = readFileSync(
      'desktop/build/recover-legacy-install-data.ps1',
      'utf8',
    )

    expect(recoveryHelper).not.toContain('Add-Type')
    expect(recoveryHelper).toContain('function Assert-NoReparsePointInPath')
    expect(recoveryHelper).toContain('$rootAttributes = [IO.File]::GetAttributes($current)')
    expect(recoveryHelper).toContain(
      'contains a reparse point and cannot be recovered safely',
    )
    expect(recoveryHelper).toContain('function Get-CanonicalPathIdentity')
    expect(recoveryHelper).toContain('System32\\mountvol.exe')
    expect(recoveryHelper).toContain('SUBST aliases cannot be recovered safely')
    expect(recoveryHelper).toContain('Possible 8.3 path alias cannot be proven safe')
    expect(recoveryHelper).toContain('Alternate path alias cannot be recovered safely')
    expect(recoveryHelper).toContain('Get-ChildItem -LiteralPath $current -Force')
    expect(recoveryHelper).toContain("([string]$_.Name).Equals($segment")
    expect(recoveryHelper).toContain("Join-Path $testRoot 'project~notes'")
    expect(recoveryHelper).toContain("Join-Path $testRoot 'MISSIN~1'")
    expect(recoveryHelper).not.toContain("'PROGRA~1'")
    expect(recoveryHelper).toContain('possible 8.3 alias did not fail closed')
    expect(recoveryHelper).toContain('legal long directory name containing a tilde')
    expect(recoveryHelper).toContain('extended volume alias did not fail closed')
    expect(recoveryHelper).toContain('SUBST alias did not fail closed')
  })

  test('skips PowerShell only for a proven default per-user installation', () => {
    const installerHook = readFileSync('desktop/build/installer.nsh', 'utf8')
    const fastPathStart = installerHook.indexOf(
      'Function CcHahaCanSkipLegacyRecovery',
    )
    const recoveryCall = installerHook.indexOf(
      'UAC_AsUser_Call Function CcHahaRecoverLegacy',
    )

    expect(fastPathStart).toBeGreaterThan(-1)
    expect(fastPathStart).toBeLessThan(recoveryCall)
    expect(installerHook).toMatch(
      /Function CcHahaCanSkipLegacyRecovery[\s\S]*\$8 != "trusted-user"/,
    )
    expect(installerHook).toMatch(
      /StrCpy \$8 "trusted-user"[\s\S]*UAC_IsAdmin[\s\S]*StrCpy \$8 "untrusted-elevated"[\s\S]*UAC_IsInnerInstance[\s\S]*StrCpy \$8 "trusted-uac-outer"[\s\S]*Call CcHahaCanSkipLegacyRecovery/,
    )
    expect(installerHook).toContain(
      '$ccHahaPerUserInstallLocation == ""',
    )
    expect(installerHook).toContain(
      '$ccHahaPerMachineInstallLocation != ""',
    )
    expect(installerHook).toContain(
      '$ccHahaPerMachineUninstallString != ""',
    )
    expect(installerHook).toContain(
      'StrCmp $ccHahaPerUserInstallLocation $INSTDIR',
    )
    expect(installerHook).toContain('ReadEnvStr $R0 CLAUDE_CONFIG_DIR')
    expect(installerHook).toContain(
      'IfFileExists "$ccHahaPerUserInstallLocation\\CLAUDE_CONFIG_DIR\\*.*"',
    )
    const strictDefault = installerHook.match(/Function CcHahaIsStrictDefaultMode\r?\n([\s\S]*?)FunctionEnd/)?.[1] ?? ''
    const fastPath = installerHook.match(/Function CcHahaCanSkipLegacyRecovery\r?\n([\s\S]*?)FunctionEnd/)?.[1] ?? ''
    expect(strictDefault).toMatch(/FileOpen \$\w+ \$\w+ r/)
    expect(strictDefault).toContain('\'{$\\n\'')
    expect(strictDefault).toContain('\'  "mode": "default",$\\n\'')
    expect(strictDefault).toContain('\'  "portable_dir": null$\\n\'')
    expect(strictDefault).toContain("'}'")
    expect(strictDefault.match(/FileRead /g)).toHaveLength(5)
    expect(strictDefault).toMatch(/FileRead[^\r\n]+\s+IfErrors 0 /)
    expect(strictDefault).toMatch(/FileClose \$\w+/)
    for (const root of ['$R1', '$R2']) {
      expect(fastPath).toContain(`StrCpy $R3 ${root}`)
    }
    expect(fastPath).toContain('Push "$R3\\${ECHOFLOW_PRODUCT_NAME}\\app-mode.json"')
    expect(fastPath.match(/Call CcHahaIsStrictDefaultMode/g)).toHaveLength(1)
    expect(fastPath).not.toContain('IfFileExists "$R2\\${ECHOFLOW_PRODUCT_NAME}\\app-mode.json" cc_haha_skip_recovery_done')
    expect(installerHook).toMatch(
      /Call CcHahaCanSkipLegacyRecovery[\s\S]*No legacy data candidates found for the registered per-user installation[\s\S]*UAC_AsUser_Call Function CcHahaRecoverLegacy/,
    )
  })

  test.skipIf(process.platform !== 'win32')('executes the actual no-CLR fast path with isolated Local and Roaming fixtures', () => {
    const compiler = process.env.CC_HAHA_TEST_MAKENSIS ?? path.join(
      process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'nsis',
      'nsis-3.0.4.1-nsis-3.0.4.1', 'Bin', 'makensis.exe',
    )
    if (!existsSync(compiler)) throw new Error('Native recovery regression requires the cached NSIS compiler or CC_HAHA_TEST_MAKENSIS')
    const installer = readFileSync('desktop/build/installer.nsh', 'utf8')
    const functions = ['CcHahaIsStrictDefaultMode', 'CcHahaIsAbsentOrEmptyDirectory', 'CcHahaCanSkipLegacyRecovery']
      .map(name => {
        const body = installer.match(new RegExp(`Function ${name}\\r?\\n[\\s\\S]*?FunctionEnd`))?.[0]
        if (!body) throw new Error(`Missing native function ${name}`)
        return body
      }).join('\n')
    const root = mkdtempSync(path.join(tmpdir(), 'echoflow-nsis-recovery-'))
    const defaultMode = '{\n  "mode": "default",\n  "portable_dir": null\n}'
    const identity = JSON.parse(readFileSync('product.json', 'utf8'))
    const aliasScenarios = [identity.slug, identity.legacyDesktopPackageName].flatMap(name =>
      ['empty', 'default', 'portable', 'journal', 'file', 'junction'].map(state => `alias-${name}-${state}`))
    const scenarios = [
      'default', 'empty-other', 'absent-mode', 'implicit-default', 'implicit-default-empty-other',
      'implicit-default-dual-root', 'implicit-default-journal', 'implicit-default-legacy',
      'implicit-default-junction', 'mode-directory', 'dual-default', 'other-cache', 'other-file', 'other-junction',
      'portable', 'broken', 'crlf', 'bom', 'final-newline', 'extra-field', 'uppercase', 'truncated', 'locked-mode',
      'journal', 'other-journal', 'journal-directory', 'legacy-data', 'elevated', 'inner-uac',
      'different-install', 'machine-install', 'machine-uninstaller', 'config-env', 'managed-env',
      ...aliasScenarios,
    ]
    const executable = path.join(root, 'probe.exe')
    const trace = path.join(root, 'trace.txt')
    const expected: string[] = []
    const sections: string[] = []
    try {
      for (const kind of ['Local', 'Roaming']) {
        for (const scenario of scenarios) {
          const name = `${kind}-${scenario}`
          const fixture = path.join(root, name)
          const selected = path.join(fixture, kind, 'EchoFlow Code')
          const other = path.join(fixture, kind === 'Local' ? 'Roaming' : 'Local', 'EchoFlow Code')
          const install = path.join(fixture, 'install')
          mkdirSync(selected, { recursive: true })
          mkdirSync(install, { recursive: true })
          const modeFile = path.join(selected, 'app-mode.json')
          const modes: Record<string, string> = {
            portable: defaultMode.replace('default', 'portable'), broken: '{broken',
            crlf: defaultMode.replaceAll('\n', '\r\n'), bom: String.fromCharCode(0xfeff) + defaultMode,
            'final-newline': `${defaultMode}\n`, 'extra-field': defaultMode.replace('null\n', 'null,\n  "extra": true\n'),
            uppercase: defaultMode.replace('default', 'DEFAULT'), truncated: defaultMode.slice(0, -1),
          }
          const hasModeFile = scenario !== 'absent-mode' && !scenario.startsWith('implicit-default') && scenario !== 'mode-directory'
          if (hasModeFile) writeFileSync(modeFile, modes[scenario] ?? defaultMode)
          if (scenario === 'mode-directory') mkdirSync(modeFile)
          if (scenario.startsWith('implicit-default')) {
            writeFileSync(path.join(selected, 'preferences.json'), '{"theme":"dark"}')
            writeFileSync(path.join(selected, 'window-state.json'), '{"width":1000}')
          }
          if (scenario === 'implicit-default-junction') {
            rmSync(selected, { recursive: true })
            symlinkSync(install, selected, 'junction')
            writeFileSync(path.join(install, 'preferences.json'), '{}')
          }
          if (['empty-other', 'dual-default', 'other-cache', 'other-journal', 'implicit-default-empty-other', 'implicit-default-dual-root'].includes(scenario)) mkdirSync(other, { recursive: true })
          if (scenario === 'implicit-default-dual-root') writeFileSync(path.join(other, 'preferences.json'), '{}')
          if (scenario === 'dual-default') writeFileSync(path.join(other, 'app-mode.json'), defaultMode)
          if (scenario === 'other-cache') mkdirSync(path.join(other, 'Cache'))
          if (scenario === 'other-file') {
            mkdirSync(path.dirname(other), { recursive: true })
            writeFileSync(other, 'not a directory')
          }
          if (scenario === 'other-junction') {
            mkdirSync(path.dirname(other), { recursive: true })
            symlinkSync(install, other, 'junction')
          }
          if (['journal', 'implicit-default-journal'].includes(scenario)) writeFileSync(path.join(selected, 'data-migration-v1.json'), '{"version":1,"status":{"stage":"completed"}}')
          if (scenario === 'other-journal') writeFileSync(path.join(other, 'data-migration-v1.json'), '{}')
          if (scenario === 'journal-directory') mkdirSync(path.join(selected, 'data-migration-v1.json'))
          if (['legacy-data', 'implicit-default-legacy'].includes(scenario)) {
            mkdirSync(path.join(install, 'CLAUDE_CONFIG_DIR'))
            writeFileSync(path.join(install, 'CLAUDE_CONFIG_DIR', 'settings.json'), 'must survive')
          }
          if (scenario.startsWith('alias-')) {
            const name = [identity.slug, identity.legacyDesktopPackageName].find(name => scenario.startsWith(`alias-${name}-`))!
            const state = scenario.slice(`alias-${name}-`.length)
            const alias = path.join(fixture, kind, name)
            if (state === 'file') writeFileSync(alias, 'not a directory')
            else if (state === 'junction') symlinkSync(install, alias, 'junction')
            else {
              mkdirSync(alias, { recursive: true })
              if (state === 'journal') writeFileSync(path.join(alias, 'data-migration-v1.json'), '{broken')
              if (state === 'default' || state === 'portable') writeFileSync(path.join(alias, 'app-mode.json'), defaultMode.replace('default', state))
            }
          }
          const succeeds = ['default', 'empty-other', 'absent-mode', 'implicit-default', 'implicit-default-empty-other'].includes(scenario)
            || (scenario.startsWith('alias-') && scenario.endsWith('-empty'))
          const errorFlag = scenarios.indexOf(scenario) % 2
          expected.push(`${name}|${Number(succeeds)}|${errorFlag}|r0|r1|r2|r3|r4|r5|r6`)
          sections.push(String.raw`
  System::Call 'kernel32::SetEnvironmentVariable(w "APPDATA", w "${path.join(fixture, 'Roaming')}")'
  System::Call 'kernel32::SetEnvironmentVariable(w "LOCALAPPDATA", w "${path.join(fixture, 'Local')}")'
  System::Call 'kernel32::SetEnvironmentVariable(w "CLAUDE_CONFIG_DIR", w "${scenario === 'config-env' ? install : ''}")'
  System::Call 'kernel32::SetEnvironmentVariable(w "CC_HAHA_APP_PORTABLE_DIR", w "${scenario === 'managed-env' ? '1' : ''}")'
  StrCpy $INSTDIR "${install}"
  StrCpy $ccHahaPerUserInstallLocation "${scenario === 'different-install' ? root : install}"
  StrCpy $ccHahaPerMachineInstallLocation "${scenario === 'machine-install' ? install : ''}"
  StrCpy $ccHahaPerMachineUninstallString "${scenario === 'machine-uninstaller' ? 'uninstall.exe' : ''}"
  StrCpy $8 "${scenario === 'elevated' ? 'untrusted-elevated' : scenario === 'inner-uac' ? 'trusted-uac-outer' : 'trusted-user'}"
  ${scenario === 'locked-mode' ? `System::Call 'kernel32::CreateFileW(w "${modeFile}", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.s'\n  Pop $lockedHandle` : ''}
  StrCpy $R0 r0
  StrCpy $R1 r1
  StrCpy $R2 r2
  StrCpy $R3 r3
  StrCpy $R4 r4
  StrCpy $R5 r5
  StrCpy $R6 r6
  ${errorFlag ? 'SetErrors' : 'ClearErrors'}
  Call CcHahaCanSkipLegacyRecovery
  Pop $0
  StrCpy $1 0
  IfErrors 0 +2
    StrCpy $1 1
  ${scenario === 'locked-mode' ? "System::Call 'kernel32::CloseHandle(p $lockedHandle)'" : ''}
  ${hasModeFile ? `System::Call 'kernel32::CreateFileW(w "${modeFile}", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.s'
  Pop $2
  StrCmp $2 -1 0 +3
    SetErrorLevel 97
    Quit
  System::Call 'kernel32::CloseHandle(p r2)'` : ''}
  FileWrite $traceHandle "${name}|$0|$1|$R0|$R1|$R2|$R3|$R4|$R5|$R6$\n"
`)
        }
      }
      const source = path.join(root, 'probe.nsi')
      writeFileSync(source, String.raw`
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Isolated recovery fast-path regression"
OutFile "${executable}"
!include "LogicLib.nsh"
!include "${path.resolve('desktop/build/product-identity.generated.nsh')}"
Var ccHahaPerUserInstallLocation
Var ccHahaPerMachineInstallLocation
Var ccHahaPerMachineUninstallString
Var traceHandle
Var lockedHandle
${functions}
Section
  FileOpen $traceHandle "${trace}" w
${sections.join('\n')}
  FileClose $traceHandle
SectionEnd
`)
      const env = { ...createSandboxedTestEnvironment(path.join(root, 'home')), COMPLUS_Version: 'v0.0.0-test-invalid-clr' }
      const compiled = spawnSync(compiler, ['/V2', source], { env, encoding: 'utf8', timeout: 30_000 })
      expect(compiled.error, compiled.stderr || compiled.stdout).toBeUndefined()
      expect(compiled.status, compiled.stderr || compiled.stdout).toBe(0)
      const run = spawnSync(executable, ['/S'], { env, timeout: 30_000, windowsHide: true })
      expect(run.error).toBeUndefined()
      expect(run.status).toBe(0)
      expect(readFileSync(trace, 'utf8').trim().split(/\r?\n/)).toEqual(expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 90_000)

  test('keeps legacy-profile startup and relaunch evidence separate from external config overrides', () => {
    const smoke = readFileSync('desktop/scripts/windows-installer-smoke.ps1', 'utf8')
    expect(smoke).toContain("foreach ($launch in @('startup', 'relaunch'))")
    expect(smoke).toContain('-ExpectedPortableDir $legacyPortable')
    expect(smoke).toMatch(/if \(\$ExpectedPortableDir\) \{\s*Remove-Item Env:CLAUDE_CONFIG_DIR/)
    expect(smoke).toContain('Legacy-package profile reinstall')
    expect(smoke).toContain('created competing state')
    expect(smoke).toContain("@($windowLog, $serverStateFile)")
    expect(smoke).toContain("'legacy-profile', 'package-profile'")
  })

  test('keeps no-CLR default and portable upgrade cases in Windows smoke', () => {
    const installerSmoke = readFileSync(
      'desktop/scripts/windows-installer-smoke.ps1',
      'utf8',
    )

    expect(installerSmoke).toContain("$env:COMPLUS_Version = 'v0.0.0-test-invalid-clr'")
    expect(installerSmoke).toContain('Test-IsProcessElevated')
    expect(installerSmoke).toContain('Elevated identity-only refusal without CLR')
    expect(installerSmoke).toMatch(
      /Elevated identity-only refusal without CLR' -ExpectedExitCode 20/,
    )
    expect(installerSmoke).toContain('Trusted-user default-mode reinstall without CLR')
    expect(installerSmoke).toContain('Portable reinstall without CLR')
    expect(installerSmoke).toMatch(
      /Portable reinstall without CLR' -ExpectedExitCode 20/,
    )
    expect(installerSmoke).toContain('Invoke-ProcessExpectFailure')
    expect(installerSmoke).toContain('must-survive-failed-upgrade')
    expect(installerSmoke).toContain('Invoke-NoClrProfileSmoke')
    expect(installerSmoke).toContain('./scripts/pr/windows-installer-recovery.test.ts')
    for (const fixture of ['default-absent-other', 'default-empty-other', 'dual-root', 'other-root-content', 'portable-mode', 'bad-mode', 'journal']) {
      expect(installerSmoke).toContain(`'${fixture}'`)
    }
    expect(installerSmoke).toContain('New-Object Text.UTF8Encoding($false)')
    expect(installerSmoke).toContain('saved-profile-fixtures')
    expect(installerSmoke).toContain('Move-Item -LiteralPath (Join-Path $backupRoot $kind) -Destination $profiles[$kind]')
  })
})
