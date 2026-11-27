[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArtifactsDir,
  [ValidateSet('x64')][string]$Arch = 'x64',
  [string]$BaselineInstaller = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:CI -ne 'true') {
  throw 'This installer smoke mutates Windows installer registry state and may run only on an ephemeral CI runner.'
}

# Keep evidence outside the disposable fixture; never copy configuration trees.
function Write-SmokeDiagnostic {
  param([string]$Message)
  [Console]::Out.WriteLine($Message)
  # Direct Console writes are not reliably captured by Start-Transcript.
  Add-Content -LiteralPath (Join-Path $evidenceDir 'diagnostics.log') -Value $Message -Encoding UTF8 -ErrorAction Continue
}

function Remove-SmokeFixture {
  param([int]$MaxAttempts = 31, [int]$RetryDelayMilliseconds = 1000)

  # Only the GUID fixture created by this invocation may be removed. Never
  # broaden cleanup to the runner's profile or another process's temporary tree.
  $ownedRoot = [IO.Path]::GetFullPath($testRoot)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($ownedRoot) -ne $tempRoot -or
      [IO.Path]::GetFileName($ownedRoot) -notmatch '^cc-haha-installer-smoke-[a-f0-9]{32}$' -or
      $MaxAttempts -lt 1 -or $RetryDelayMilliseconds -lt 0) {
    throw "Refusing unexpected smoke fixture cleanup path or retry budget: $ownedRoot"
  }
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    if (-not (Test-Path -LiteralPath $ownedRoot -ErrorAction Stop)) { return }
    if ((Get-Item -LiteralPath $ownedRoot -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Refusing reparse-point smoke fixture cleanup: $ownedRoot"
    }
    try {
      Remove-Item -LiteralPath $ownedRoot -Recurse -Force -ErrorAction Stop
      Write-SmokeDiagnostic ("Smoke fixture removed on attempt ${attempt}: $ownedRoot")
      return
    } catch {
      # Windows may still be releasing uninstall/background file handles. Retry
      # filesystem contention only; programming and other errors fail immediately.
      if ($_.Exception -isnot [IO.IOException] -and $_.Exception -isnot [UnauthorizedAccessException]) { throw }
      Write-SmokeDiagnostic ("Smoke fixture cleanup attempt $attempt/$MaxAttempts failed: $($_.Exception.Message)")
      if ($attempt -eq $MaxAttempts) {
        throw "Smoke fixture cleanup failed after $MaxAttempts attempts; remaining fixture: $ownedRoot; last error: $($_.Exception.Message)"
      }
      Start-Sleep -Milliseconds $RetryDelayMilliseconds
    }
  }
}

function New-SmokeResults {
  $results = [ordered]@{}
  foreach ($name in @('native-helper-regressions', 'packaged-smoke', 'legacy-profile-startup', 'packaged-profile-no-clr', 'elevated-refusal-no-clr', 'cleanup')) {
    $results[$name] = [ordered]@{ status = 'unexercised'; reason = 'Not reached.'; evidence = 'No completed assertion.' }
  }
  return $results
}

function Write-SmokeReport {
  param($Results, [string]$Directory, [string]$Failure, [string]$CleanupFailure)

  $status = if ($Failure -or $CleanupFailure) { 'failed' } else { 'passed' }
  $coverage = if (@($Results.Values | Where-Object { $_.status -eq 'unexercised' }).Count) { 'unexercised' } else { 'passed' }
  if (@($Results.Values | Where-Object { $_.status -eq 'failed' }).Count) { $coverage = 'failed' }
  $report = [ordered]@{
    schemaVersion = 1
    status = $status
    coverage = $coverage
    failure = $Failure
    cleanupFailure = $CleanupFailure
    checks = $Results
    evidenceBoundary = 'Packaged CI smoke and native function fixtures are separate evidence. Neither proves ordinary-user packaged branches on an elevated runner, interactive tray behavior, or release acceptance.'
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Directory 'result.json') -Encoding UTF8
  $lines = @('## Windows installer smoke', '', "Execution: **$status**; coverage: **$coverage**.", '', '| Check | Status | Reason | Evidence |', '| --- | --- | --- | --- |')
  foreach ($name in $Results.Keys) {
    $check = $Results[$name]
    $reason = ([string]$check.reason -replace '[\r\n]+', ' ') -replace '\|', '&#124;'
    $evidence = ([string]$check.evidence -replace '[\r\n]+', ' ') -replace '\|', '&#124;'
    $lines += "| $name | $($check.status) | $reason | $evidence |"
  }
  $lines += @('', $report.evidenceBoundary, '', "Diagnostics: $Directory")
  foreach ($errorText in @($Failure, $CleanupFailure)) {
    if ($errorText) { $lines += ('Failure: ' + (($errorText -replace '[\r\n]+', ' ') -replace '<', '&lt;')) }
  }
  $lines | Set-Content -LiteralPath (Join-Path $Directory 'summary.md') -Encoding UTF8
  if ($env:GITHUB_STEP_SUMMARY) { $lines | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Encoding UTF8 }
}

$evidenceDir = Join-Path ($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ArtifactsDir)) "windows-installer-smoke-$Arch\$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$results = New-SmokeResults
$failure = ''
$cleanupFailure = ''
$activeCheck = 'native-helper-regressions'
$launchNumber = 0
$transcriptStarted = $false
try {
  Start-Transcript -LiteralPath (Join-Path $evidenceDir 'transcript.log') -Force | Out-Null
  $transcriptStarted = $true
if ($BaselineInstaller) {
  # The upgrade workflow runs the native helper fixtures in a separate step.
  $results.Remove('native-helper-regressions')
} else {
  # The package step populated electron-builder's NSIS cache.
  Push-Location (Join-Path $PSScriptRoot '..\..')
  try {
    & bun test ./scripts/pr/windows-installer-process-check.test.ts ./scripts/pr/windows-installer-recovery.test.ts
    if ($LASTEXITCODE -ne 0) {
      throw 'Native installer helper write or recovery regression failed.'
    }
  } finally {
    Pop-Location
  }
  $results['native-helper-regressions'] = [ordered]@{ status = 'passed'; reason = 'Targeted native helper tests completed.'; evidence = 'Function-level fixtures only; see diagnostics.log and transcript.log.' }
}
$activeCheck = 'packaged-smoke'
$results['packaged-smoke'].reason = 'Packaged assertions have not all completed (not reached or interrupted).'

$resolvedArtifactsDir = (Resolve-Path -LiteralPath $ArtifactsDir).Path
$installers = @(Get-ChildItem -LiteralPath $resolvedArtifactsDir -File |
  Where-Object { $_.Name -like "EchoFlow-Code-*-win-$Arch.exe" })
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows $Arch installer in $resolvedArtifactsDir, found $($installers.Count)."
}
$installer = $installers[0].FullName

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "cc-haha-installer-smoke-$([Guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $testRoot '中文 安装目录\EchoFlow Code'
$appData = Join-Path $testRoot 'AppData\Roaming'
$localAppData = Join-Path $testRoot 'AppData\Local'
$userProfile = Join-Path $testRoot 'UserProfile'
$appExe = Join-Path $installDir 'EchoFlow Code.exe'
$uninstaller = Join-Path $installDir 'Uninstall EchoFlow Code.exe'
$productIdentity = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\product.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$recoveryHelper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\build\recover-legacy-install-data.ps1')).Path
$processHelper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\build\check-install-processes.ps1')).Path
$siblingProcess = $null
$installProcess = $null
$bundledHelperProcess = $null

$savedEnvironment = @{}
foreach ($name in @('APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'CC_HAHA_APP_PORTABLE_DIR', 'COMPLUS_Version')) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Invoke-ProcessExpectFailure {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$ExpectedExitCode,
    [int]$TimeoutSeconds = 180
  )

  Write-SmokeDiagnostic ("$Stage starting...")
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "$Stage timed out after $TimeoutSeconds seconds."
    }
    if ($PSBoundParameters.ContainsKey('ExpectedExitCode')) {
      if ($process.ExitCode -ne $ExpectedExitCode) {
        # 22 means "a matching process is running" and 20 means "legacy recovery
        # refused to continue". Getting 22 where 20 was expected says the
        # installer stopped before it ever reached recovery, so the process list
        # is the evidence that separates a real regression from a dirty runner.
        Write-InstallerFallbackProcessDiagnostic -Context "$Stage (expected $ExpectedExitCode, got $($process.ExitCode))"
        throw "$Stage expected process exit code $ExpectedExitCode, received $($process.ExitCode)."
      }
    } elseif ($process.ExitCode -eq 0) {
      throw "$Stage unexpectedly succeeded with process exit code 0."
    }
    Write-SmokeDiagnostic ("$Stage failed safely with process exit code $($process.ExitCode).")
  } finally {
    $process.Dispose()
  }
}

function Invoke-CheckedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$TimeoutSeconds = 180
  )

  Write-SmokeDiagnostic ("$Stage starting...")
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "$Stage timed out after $TimeoutSeconds seconds."
    }
    if ($process.ExitCode -ne 0) {
      throw "$Stage failed with process exit code $($process.ExitCode)."
    }
    Write-SmokeDiagnostic ("$Stage completed successfully.")
  } finally {
    $process.Dispose()
  }
}

function Test-IsProcessElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
  } finally {
    $identity.Dispose()
  }
}

# The exact image names installer.nsh falls back to when PowerShell is
# unavailable (see CcHahaFindInstallProcess's findstr list). Without a CLR the
# installer cannot resolve paths, so it matches on these names alone and any
# process carrying one -- whoever started it -- reads as "the app is still
# running". Keep this in sync with installer.nsh.
$installerFallbackImageNames = @(
  'EchoFlow Code.exe',
  'claude-sidecar-x86_64-pc-windows-msvc.exe',
  'claude-sidecar-aarch64-pc-windows-msvc.exe',
  'claude-sidecar.exe',
  'OpenConsole.exe',
  'winpty-agent.exe',
  'rg.exe'
)

function Get-InstallerFallbackProcesses {
  # Not $matches: that is an automatic variable holding -match results.
  $running = @()
  foreach ($imageName in $installerFallbackImageNames) {
    $processName = [IO.Path]::GetFileNameWithoutExtension($imageName)
    foreach ($process in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
      $running += $process
    }
  }
  return $running
}

# The no-CLR stages assert an exit code that says *why* the installer stopped,
# so a stray same-named process anywhere on the runner silently rewrites the
# answer. Print what the fallback would have seen; a stage that expected 22 and
# got 22 for the wrong reason looks identical to a pass without this.
function Write-InstallerFallbackProcessDiagnostic {
  param([Parameter(Mandatory = $true)][string]$Context)

  Write-SmokeDiagnostic ("--- $Context : processes matching the installer's no-CLR image-name fallback ---")
  $running = @(Get-InstallerFallbackProcesses)
  if ($running.Count -eq 0) {
    Write-SmokeDiagnostic ('  (none)')
  } else {
    foreach ($process in $running) {
      $processPath = '<path unavailable>'
      try {
        if ($process.Path) { $processPath = $process.Path }
      } catch {
        # A process owned by another user denies path access; the name is the
        # part that matters here, since the name is all the fallback matches on.
      }
      Write-SmokeDiagnostic ("  PID=$($process.Id); Name=$($process.ProcessName); Path=$processPath")
    }
  }
  Write-SmokeDiagnostic ('--- end ---')
}

# Earlier steps in this same CI job start sidecars and helpers, and this script
# deliberately leaves probe processes running for the stages that assert on
# them. Anything still alive when a later stage runs would be attributed to that
# stage instead. Settle the field before a stage whose expected exit code
# depends on nothing matching.
function Clear-InstallerFallbackProcesses {
  param(
    [Parameter(Mandatory = $true)][string]$Context,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ($true) {
    $running = @(Get-InstallerFallbackProcesses)
    if ($running.Count -eq 0) { return }

    if ((Get-Date) -ge $deadline) {
      # Deliberately not a throw. Anything surviving this is outside the
      # script's control (a runner-owned process of the same name), and failing
      # here would replace the stage's own failure -- which now prints the same
      # process list -- with a less informative one. Report and let the stage
      # speak for itself.
      Write-SmokeDiagnostic ("WARNING: $Context could not clear $($running.Count) matching process(es) within ${TimeoutSeconds}s.")
      Write-InstallerFallbackProcessDiagnostic -Context "$Context (still present after ${TimeoutSeconds}s)"
      return
    }

    foreach ($process in $running) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 250
  }
}

function Invoke-ProcessHelperExpectExit {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][int]$ExpectedExitCode,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Write-SmokeDiagnostic ("$Stage starting...")
  & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $processHelper @Arguments
  if ($LASTEXITCODE -ne $ExpectedExitCode) {
    throw "$Stage expected exit code $ExpectedExitCode, received $LASTEXITCODE."
  }
  Write-SmokeDiagnostic ("$Stage completed with expected exit code $ExpectedExitCode.")
}

function Invoke-ProcessHelperCleanup {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Write-SmokeDiagnostic ("$Stage starting...")
  & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $processHelper @Arguments
  if ($LASTEXITCODE -notin @(0, 1)) {
    throw "$Stage expected process exit code 0 (killed) or 1 (already stopped), received $LASTEXITCODE."
  }
  Write-SmokeDiagnostic ("$Stage completed with process exit code $LASTEXITCODE.")
}

function Write-InstalledApplicationDiagnostics {
  param(
    [Parameter(Mandatory = $true)][string]$WindowLog,
    [Parameter(Mandatory = $true)][string]$HostDiagnostics
  )

  foreach ($path in @($WindowLog, $HostDiagnostics)) {
    Write-SmokeDiagnostic ("--- installed application diagnostic: $path ---")
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      foreach ($line in @(Get-Content -LiteralPath $path -Tail 80 -ErrorAction SilentlyContinue)) {
        Write-SmokeDiagnostic ([string]$line)
      }
    } else {
      Write-SmokeDiagnostic ('  (missing)')
    }
    Write-SmokeDiagnostic ('--- end ---')
  }
}

function Invoke-InstalledApplicationSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$IsolatedUserProfile,
    [switch]$LegacyProfile,
    [int]$TimeoutSeconds = 60
  )

  # 0.7.7 writes server readiness in the shared Claude profile.
  $configDir = if ($LegacyProfile) { Join-Path $IsolatedUserProfile '.claude' } else { Join-Path $localAppData $productIdentity.name }
  $diagnosticNamespace = if ($LegacyProfile) { 'cc-haha' } else { $productIdentity.configDir }
  $serverStateFile = Join-Path $configDir 'desktop-server-state.json'
  $windowLog = Join-Path $testRoot 'electron-window-smoke.jsonl'
  $hostDiagnostics = Join-Path (Join-Path $configDir $diagnosticNamespace) 'diagnostics\electron-host.log'
  $smokeEnvironmentNames = @(
    'CLAUDE_CONFIG_DIR',
    'CC_HAHA_ELECTRON_WINDOW_SMOKE_LOG',
    'HOME',
    'CI',
    'NO_PROXY',
    'no_proxy'
  )
  $savedSmokeEnvironment = @{}
  foreach ($name in $smokeEnvironmentNames) {
    $savedSmokeEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }

  $script:launchNumber += 1
  $application = $null
  try {
    Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
    # Each launch must supply its own readiness evidence, not a previous launch's files.
    foreach ($stale in @($windowLog, $serverStateFile)) {
      if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force }
    }
    $env:CC_HAHA_ELECTRON_WINDOW_SMOKE_LOG = $windowLog
    $env:HOME = $IsolatedUserProfile
    Remove-Item Env:CI -ErrorAction SilentlyContinue
    $env:NO_PROXY = '127.0.0.1,localhost,::1'
    $env:no_proxy = '127.0.0.1,localhost,::1'

    Write-SmokeDiagnostic ("Installed application Unicode-path smoke starting: $FilePath")
    $application = Start-Process -FilePath $FilePath -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastFailure = 'waiting for the Electron window, server state, and loopback responses'

    while ((Get-Date) -lt $deadline) {
      if ($application.HasExited) {
        throw "Installed application exited before readiness with process exit code $($application.ExitCode)."
      }

      $windowReady = (Test-Path -LiteralPath $windowLog -PathType Leaf) -and
        (Select-String -LiteralPath $windowLog -SimpleMatch '"reason":"after-final-show"' -Quiet)
      if (-not $windowReady) {
        $lastFailure = 'Electron did not record after-final-show'
        Start-Sleep -Milliseconds 250
        continue
      }

      if (-not (Test-Path -LiteralPath $serverStateFile -PathType Leaf)) {
        $lastFailure = "server state file is missing: $serverStateFile"
        Start-Sleep -Milliseconds 250
        continue
      }

      try {
        $serverState = Get-Content -LiteralPath $serverStateFile -Raw | ConvertFrom-Json
        $port = [int]$serverState.lastPort
        if ($port -lt 1 -or $port -gt 65535) {
          throw "invalid server port $port"
        }
        $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
        $healthPayload = $health.Content | ConvertFrom-Json
        if ($health.StatusCode -ne 200 -or $healthPayload.status -ne 'ok') {
          throw "health returned HTTP $($health.StatusCode): $($health.Content)"
        }
        $root = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 2
        if ($root.StatusCode -ne 200 -or $root.Content -notmatch '<html') {
          throw "application root returned HTTP $($root.StatusCode) without HTML"
        }
        Write-SmokeDiagnostic (
          "Installed application Unicode-path smoke passed (window shown; /health and / served from port $port).")
        return
      } catch {
        $lastFailure = ([string]$_.Exception.Message) -replace '[\r\n]+', ' '
      }

      Start-Sleep -Milliseconds 250
    }

    throw "Installed application Unicode-path smoke timed out after $TimeoutSeconds seconds: $lastFailure"
  } catch {
    Write-InstalledApplicationDiagnostics -WindowLog $windowLog -HostDiagnostics $hostDiagnostics
    throw
  } finally {
    try {
      if ($null -ne $application) {
        try {
          Invoke-ProcessHelperCleanup `
            -Stage 'Installed application Unicode-path smoke cleanup' `
            -Arguments @(
              '-InstallDir', $InstallDirectory,
              '-ProcessName', 'EchoFlow Code.exe',
              '-Action', 'KillForce',
              '-InstallerPid', [string]$PID
            )
        } finally {
          if (-not $application.WaitForExit(30000)) {
            Stop-Process -Id $application.Id -Force -ErrorAction SilentlyContinue
            throw 'Installed application did not exit after Unicode-path smoke cleanup.'
          }
          $application.Dispose()
        }
      }
    } finally {
      # Preserve this launch before the next launch removes its readiness log.
      foreach ($entry in @(@{ source = $windowLog; name = 'window.jsonl' }, @{ source = $hostDiagnostics; name = 'host.log' })) {
        if (Test-Path -LiteralPath $entry.source -PathType Leaf) {
          Copy-Item -LiteralPath $entry.source -Destination (Join-Path $evidenceDir "launch-$launchNumber-$($entry.name)") -ErrorAction Continue
        }
      }
      foreach ($name in $smokeEnvironmentNames) {
        $value = $savedSmokeEnvironment[$name]
        if ($null -eq $value) {
          [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        } else {
          [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process')
        }
      }
    }
  }
}

function Invoke-LegacyRecoveryDiagnostic {
  $packagedBridge = Join-Path $installDir 'resources\installer-recovery\installer-storage-recovery-x86_64-pc-windows-msvc.exe'
  if (-not (Test-Path -LiteralPath $packagedBridge -PathType Leaf)) {
    throw 'Packaged installer storage recovery runtime is missing'
  }
  $recoveryBridge = Join-Path $testRoot 'installer-storage-recovery.exe'
  Copy-Item -LiteralPath $packagedBridge -Destination $recoveryBridge
  $source = Join-Path $installDir 'CLAUDE_CONFIG_DIR'
  $settings = Join-Path $source 'settings.json'
  $ownership = Join-Path $source 'app.json'
  $target = Join-Path $localAppData $productIdentity.name
  $location = Join-Path $userProfile '.echoflow-storage\active-root.sqlite'
  if (Test-Path -LiteralPath $target) { throw 'The recovery diagnostic requires an absent destination.' }
  New-Item -ItemType Directory -Path $source | Out-Null
  [IO.File]::WriteAllText($settings, '{"installerRecoveryFixture":true}')
  [IO.File]::WriteAllText($ownership, (@{ owner = $productIdentity.name; appId = $productIdentity.appId; schemaVersion = 1 } | ConvertTo-Json -Compress))
  $protectedFiles = @($settings, $ownership, $appExe, $uninstaller)
  $hasLocation = Test-Path -LiteralPath $location
  if ($hasLocation) { $protectedFiles += $location }
  $originalHashes = @{}
  foreach ($file in $protectedFiles) { $originalHashes[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @(
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $recoveryHelper,
    '-PerUserInstallDir',
    $installDir,
    '-CandidateInstallDir',
    $installDir,
    '-UserDataDir',
    (Join-Path $appData $productIdentity.name),
    '-LocalUserDataDir',
    (Join-Path $localAppData $productIdentity.name),
    '-DesktopPackageName',
    $productIdentity.slug,
    '-LegacyDesktopPackageName',
    $productIdentity.legacyDesktopPackageName,
    '-RecoveryBridge',
    $recoveryBridge,
    '-ProcessName',
    'EchoFlow Code.exe',
    '-InstallerIdentitySafety',
    'trusted-user'
  )

  Write-SmokeDiagnostic ('Packaged legacy recovery refusal diagnostic starting...')
  $output = @(& $windowsPowerShell @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  foreach ($line in $output) {
    Write-SmokeDiagnostic ([string]$line)
  }
  $expectedStop = 'Shared installer storage recovery blocked (exit 20): Installer storage recovery stopped: Storage migration blocked: Windows native'
  if ($exitCode -ne 20 -or ($output -join ' ') -notlike "*$expectedStop*") {
    throw "Packaged legacy recovery did not report a Windows native inventory refusal (helper exit $exitCode)."
  }
  foreach ($file in $protectedFiles) {
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $originalHashes[$file]) {
      throw "Packaged legacy recovery changed a protected fixture file before refusing: $file"
    }
  }
  if (@(Get-ChildItem -LiteralPath $source -Force).Count -ne 2 -or (Test-Path -LiteralPath $target) -or
      (!$hasLocation -and (Test-Path -LiteralPath $location))) {
    throw 'Packaged legacy recovery created source, destination, or startup receipt state before refusing.'
  }
  Write-SmokeDiagnostic ('Packaged installer recovery refused at the Windows native inventory gate and preserved the install-contained source. Installed files, destination and startup receipt retained their original state.')
  Remove-Item -LiteralPath $settings, $ownership -Force
  Remove-Item -LiteralPath $source
}

function Invoke-NoClrProfileSmoke {
  $profiles = [ordered]@{
    Local = Join-Path $localAppData 'EchoFlow Code'
    Roaming = Join-Path $appData 'EchoFlow Code'
    LocalPackage = Join-Path $localAppData $productIdentity.slug
    RoamingPackage = Join-Path $appData $productIdentity.slug
    LocalLegacy = Join-Path $localAppData $productIdentity.legacyDesktopPackageName
    RoamingLegacy = Join-Path $appData $productIdentity.legacyDesktopPackageName
  }
  $backupRoot = Join-Path $testRoot 'saved-profile-fixtures'
  New-Item -ItemType Directory -Path $backupRoot | Out-Null
  $savedProfiles = @()
  $fixtureProfiles = @()
  $savedClr = $env:COMPLUS_Version
  try {
    foreach ($kind in $profiles.Keys) {
      if (Test-Path -LiteralPath $profiles[$kind]) {
        Move-Item -LiteralPath $profiles[$kind] -Destination (Join-Path $backupRoot $kind)
        $savedProfiles += $kind
      }
    }
    $fixtureProfiles = @($profiles.Values)
    # Match JSON.stringify(value, null, 2): LF, UTF-8 without BOM, no final newline.
    $defaultMode = "{`n  `"mode`": `"default`",`n  `"portable_dir`": null`n}"
    $utf8 = New-Object Text.UTF8Encoding($false)
    $elevated = Test-IsProcessElevated
    if ($elevated) {
      $results['packaged-profile-no-clr'] = [ordered]@{ status = 'unexercised'; reason = 'Elevated runner cannot qualify the profile-specific branches.'; evidence = 'Native NSIS fixtures are function-level evidence, not packaged trusted-user validation.' }
      $script:activeCheck = 'elevated-refusal-no-clr'
    } else {
      $results['elevated-refusal-no-clr'] = [ordered]@{ status = 'unexercised'; reason = 'Runner is not elevated.'; evidence = 'This run exercises packaged trusted-user profile branches instead.' }
      $script:activeCheck = 'packaged-profile-no-clr'
    }
    $completedCases = 0
    if ($elevated) {
      Write-SmokeDiagnostic ('UNEXERCISED: packaged profile-specific success and refusal branches on this elevated runner. These cases verify installer refusal and preservation of the fixture files; native NSIS fixtures are separate function-level evidence, not packaged trusted-user validation.')
    }
    foreach ($kind in @('Local', 'Roaming')) {
      foreach ($scenario in @('default-absent-other', 'default-empty-other', 'default-implicit', 'default-implicit-empty-other', 'dual-root', 'other-root-content', 'portable-mode', 'bad-mode', 'journal', 'legacy-profile', 'package-profile')) {
        foreach ($profile in $fixtureProfiles) {
          if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
        }
        $selected = $profiles[$kind]
        $other = if ($kind -eq 'Local') { $profiles.Roaming } else { $profiles.Local }
        New-Item -ItemType Directory -Path $selected -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $selected 'app-mode.json'), $defaultMode, $utf8)
        [IO.File]::WriteAllText((Join-Path $selected 'sentinel.txt'), 'must-survive-failed-upgrade', $utf8)
        switch ($scenario) {
          'default-empty-other' { New-Item -ItemType Directory -Path $other -Force | Out-Null }
          { $_ -in @('default-implicit', 'default-implicit-empty-other') } {
            Remove-Item -LiteralPath (Join-Path $selected 'app-mode.json')
            [IO.File]::WriteAllText((Join-Path $selected 'preferences.json'), '{"theme":"dark"}', $utf8)
            [IO.File]::WriteAllText((Join-Path $selected 'window-state.json'), '{"width":1000}', $utf8)
            if ($scenario -eq 'default-implicit-empty-other') { New-Item -ItemType Directory -Path $other -Force | Out-Null }
          }
          { $_ -in @('legacy-profile', 'package-profile') } {
            $suffix = if ($scenario -eq 'legacy-profile') { 'Legacy' } else { 'Package' }
            $alias = $profiles["$kind$suffix"]
            New-Item -ItemType Directory -Path $alias -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $alias 'app-mode.json'), $defaultMode, $utf8)
          }
          'dual-root' {
            New-Item -ItemType Directory -Path $other -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $other 'app-mode.json'), $defaultMode, $utf8)
          }
          'other-root-content' {
            New-Item -ItemType Directory -Path (Join-Path $other 'Cache') -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $other 'Cache\keep'), 'not provably empty', $utf8)
          }
          'portable-mode' { [IO.File]::WriteAllText((Join-Path $selected 'app-mode.json'), '{"mode":"portable","portable_dir":null}', $utf8) }
          'bad-mode' { [IO.File]::WriteAllText((Join-Path $selected 'app-mode.json'), '{broken', $utf8) }
          'journal' { [IO.File]::WriteAllText((Join-Path $selected 'data-migration-v1.json'), '{"version":1,"status":{"stage":"completed"}}', $utf8) }
        }
        $before = @(Get-ChildItem -LiteralPath @($fixtureProfiles | Where-Object { Test-Path -LiteralPath $_ }) -Recurse -File -Force -ErrorAction Stop | ForEach-Object {
          "$($_.FullName)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
        } | Sort-Object)
        $exeHash = (Get-FileHash -LiteralPath $appExe -Algorithm SHA256).Hash
        Clear-InstallerFallbackProcesses -Context "Before no-CLR $kind-only $scenario reinstall"
        Write-SmokeDiagnostic ("No-CLR profile fixture: $kind-only $scenario")
        $env:COMPLUS_Version = 'v0.0.0-test-invalid-clr'
        if (Test-IsProcessElevated) {
          Invoke-ProcessExpectFailure -FilePath $installer -Stage 'Elevated installer refusal without CLR' -ExpectedExitCode 20 -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
        } elseif ($scenario -like 'default-*') {
          Invoke-CheckedProcess -FilePath $installer -Stage 'Trusted-user default-mode reinstall without CLR' -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
        } else {
          Invoke-ProcessExpectFailure -FilePath $installer -Stage "No-CLR $kind $scenario refusal" -ExpectedExitCode 20 -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
        }
        $env:COMPLUS_Version = $savedClr
        $after = @(Get-ChildItem -LiteralPath @($fixtureProfiles | Where-Object { Test-Path -LiteralPath $_ }) -Recurse -File -Force -ErrorAction Stop | ForEach-Object {
          "$($_.FullName)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
        } | Sort-Object)
        if ($before.Count -ne $after.Count -or $null -ne (Compare-Object $before $after -CaseSensitive)) {
          throw "No-CLR $kind $scenario changed profile fixtures or sentinels."
        }
        if (-not (Test-Path -LiteralPath $appExe -PathType Leaf) -or (Get-FileHash -LiteralPath $appExe -Algorithm SHA256).Hash -ne $exeHash) {
          throw "Reinstall removed the application executable or changed its bytes: $appExe"
        }
        $completedCases += 1
      }
    }
    $results[$script:activeCheck] = [ordered]@{ status = 'passed'; reason = "All $completedCases Local/Roaming cases completed."; evidence = 'Expected installer exit codes, unchanged fixture hashes and executable hash; see diagnostics.log and transcript.log.' }
    $script:activeCheck = 'packaged-smoke'
  } finally {
    $env:COMPLUS_Version = $savedClr
    foreach ($profile in $fixtureProfiles) {
      if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
    }
    foreach ($kind in $savedProfiles) {
      Move-Item -LiteralPath (Join-Path $backupRoot $kind) -Destination $profiles[$kind]
    }
  }
}

try {
  New-Item -ItemType Directory -Path $appData, $localAppData, $userProfile -Force | Out-Null
  $env:APPDATA = $appData
  $env:LOCALAPPDATA = $localAppData
  $env:USERPROFILE = $userProfile
  Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:CC_HAHA_APP_PORTABLE_DIR -ErrorAction SilentlyContinue

  if ($BaselineInstaller) {
    $activeCheck = 'version-upgrade'
    foreach ($check in @('packaged-smoke', 'legacy-profile-startup', 'packaged-profile-no-clr', 'elevated-refusal-no-clr')) {
      $results.Remove($check)
    }
    $results[$activeCheck] = [ordered]@{ status = 'unexercised'; reason = 'Upgrade assertions are in progress.'; evidence = 'See diagnostics.log.' }
    Write-SmokeDiagnostic "Candidate commit: $env:GITHUB_SHA; elevated: $(Test-IsProcessElevated)"
    Write-SmokeDiagnostic "Baseline SHA-256: $((Get-FileHash -LiteralPath $BaselineInstaller -Algorithm SHA256).Hash)"
    Write-SmokeDiagnostic "Candidate SHA-256: $((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash)"

    Invoke-CheckedProcess -FilePath $BaselineInstaller -Stage 'Install official v0.7.7' -Arguments @('/S', '/currentuser', "/D=$installDir")
    $baselineVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe).FileVersion
    Write-SmokeDiagnostic "Installed baseline file version: $baselineVersion"
    if ($baselineVersion -ne '0.7.7') {
      throw "Expected baseline file version 0.7.7, found '$baselineVersion'."
    }
    Invoke-InstalledApplicationSmoke -FilePath $appExe -InstallDirectory $installDir -IsolatedUserProfile $userProfile -LegacyProfile

    # The default 0.7.7 sidecar uses the user's shared .claude directory.
    $legacyRoot = Join-Path $userProfile '.claude'
    $legacyProject = Join-Path $legacyRoot 'projects\upgrade-fixture'
    New-Item -ItemType Directory -Path $legacyProject -Force | Out-Null
    $legacySettings = Join-Path $legacyRoot 'settings.json'
    $legacyTranscript = Join-Path $legacyProject '77000000-0000-4000-8000-000000000078.jsonl'
    [IO.File]::WriteAllText($legacySettings, '{"env":{"ECHOFLOW_UPGRADE_FIXTURE":"keep"}}')
    [IO.File]::WriteAllText($legacyTranscript, '{"type":"user","message":{"role":"user","content":"Windows upgrade fixture"}}' + "`n")
    $files = @($legacySettings, $legacyTranscript)
    $before = @($files | Get-FileHash -Algorithm SHA256 | ForEach-Object Hash)

    try {
      Invoke-CheckedProcess -FilePath $installer -Stage 'Upgrade to v0.7.8' -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
      $candidateVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe).FileVersion
      Write-SmokeDiagnostic "Installed candidate file version: $candidateVersion"
      if ($candidateVersion -ne '0.7.8') {
        throw "Expected candidate file version 0.7.8, found '$candidateVersion'."
      }
      foreach ($phase in @('first launch', 'relaunch')) {
        Invoke-InstalledApplicationSmoke -FilePath $appExe -InstallDirectory $installDir -IsolatedUserProfile $userProfile
        $after = @($files | Get-FileHash -Algorithm SHA256 | ForEach-Object Hash)
        if ($after.Count -ne $before.Count -or (Compare-Object $before $after -SyncWindow 0)) {
          throw "Upgrade changed the shared settings or transcript during $phase."
        }
      }
    } catch {
      $after = @($files | Get-FileHash -Algorithm SHA256 -ErrorAction SilentlyContinue | ForEach-Object Hash)
      $preserved = $after.Count -eq $before.Count -and -not (Compare-Object $before $after -SyncWindow 0)
      Write-SmokeDiagnostic "After failed upgrade, both shared fixture hashes matched: $preserved"
      throw
    }
    $results[$activeCheck] = [ordered]@{ status = 'passed'; reason = 'Official 0.7.7 installed and upgraded in place to 0.7.8.'; evidence = 'Both versions launched, 0.7.8 relaunched, and shared settings and transcript hashes matched.' }
    return
  }

  # Baseline before anything here starts a process. Whatever this prints was put
  # there by earlier steps of the job or by the runner image, and it is exactly
  # what the no-CLR stages would misattribute to themselves.
  Write-InstallerFallbackProcessDiagnostic -Context 'Runner baseline before fresh install'

  Invoke-CheckedProcess -FilePath $installer -Stage 'Fresh install' -Arguments @('/S', '/currentuser', "/D=$installDir")
  if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) {
    throw "Fresh install did not create the application executable: $appExe"
  }
  Invoke-InstalledApplicationSmoke `
    -FilePath $appExe `
    -InstallDirectory $installDir `
    -IsolatedUserProfile $userProfile
  $freshStorage = Join-Path $localAppData $productIdentity.name
  $freshSentinel = Join-Path $freshStorage 'fresh-profile-sentinel.txt'
  [IO.File]::WriteAllText($freshSentinel, 'fresh-profile-must-survive')
  Invoke-InstalledApplicationSmoke `
    -FilePath $appExe `
    -InstallDirectory $installDir `
    -IsolatedUserProfile $userProfile
  if ([IO.File]::ReadAllText($freshSentinel) -cne 'fresh-profile-must-survive') {
    throw 'The fresh install changed its default profile sentinel on second launch.'
  }
  Write-SmokeDiagnostic ('Fresh default profile retained its sentinel on second launch.')
  Move-Item -LiteralPath $freshStorage -Destination (Join-Path $testRoot 'fresh-storage')
  Invoke-LegacyRecoveryDiagnostic

  $legacyProfile = Join-Path $appData $productIdentity.legacyDesktopPackageName
  $legacyPortable = Join-Path $userProfile 'legacy portable data'
  New-Item -ItemType Directory -Path $legacyProfile, $legacyPortable -Force | Out-Null
  $legacyModeFile = Join-Path $legacyProfile 'app-mode.json'
  [IO.File]::WriteAllText($legacyModeFile, (@{ mode = 'portable'; portable_dir = $legacyPortable } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  $legacyModeHash = (Get-FileHash -LiteralPath $legacyModeFile -Algorithm SHA256).Hash
  $legacySentinelFile = Join-Path $legacyPortable 'profile-sentinel.txt'
  [IO.File]::WriteAllText($legacySentinelFile, 'legacy-profile-must-survive')

  Invoke-CheckedProcess -FilePath $installer -Stage 'Legacy-package profile reinstall' -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
  if ((Get-FileHash -LiteralPath $legacyModeFile -Algorithm SHA256).Hash -ne $legacyModeHash -or
      [IO.File]::ReadAllText($legacySentinelFile) -ne 'legacy-profile-must-survive') {
    throw 'Legacy-package profile reinstall changed its persisted pointer or sentinel.'
  }
  foreach ($profileRoot in @($appData, $localAppData)) {
    foreach ($name in @($productIdentity.name, $productIdentity.slug, $productIdentity.legacyDesktopPackageName)) {
      $candidate = Join-Path $profileRoot $name
      if ($candidate -ne $legacyProfile -and (Test-Path -LiteralPath $candidate)) {
        $state = @(Get-ChildItem -LiteralPath $candidate -Force | Where-Object { $_.Name -cnotin @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'Crashpad', 'logs') })
        if ($state.Count -gt 0) { throw "Legacy-package profile reinstall created competing state: $candidate" }
      }
    }
  }
  $results['legacy-profile-startup'] = [ordered]@{ status = 'unexercised'; reason = 'Windows native per-PID inventory is not qualified for legacy migration. The unmarked portable fixture also lacks ownership evidence.'; evidence = 'Packaged reinstall preserved the pointer and sentinel.' }
  Write-SmokeDiagnostic ('UNEXERCISED: legacy-package profile startup and relaunch require portable-root ownership and qualified Windows native inventory. Packaged reinstall preserved the pointer and sentinel.')

  $processProbeSource = Join-Path $env:SystemRoot 'System32\ping.exe'
  $siblingDir = "$installDir Tools"
  $siblingProbe = Join-Path $siblingDir 'EchoFlow Code.exe'
  New-Item -ItemType Directory -Path $siblingDir -Force | Out-Null
  Copy-Item -LiteralPath $processProbeSource -Destination $siblingProbe
  $siblingProcess = Start-Process -FilePath $siblingProbe -ArgumentList @('-t', '127.0.0.1') -PassThru
  Start-Sleep -Milliseconds 500
  Invoke-CheckedProcess -FilePath $installer -Stage 'Sibling-prefix process reinstall' -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
  if ($siblingProcess.HasExited) {
    throw 'Sibling-prefix process was mistaken for an install-directory process.'
  }
  Write-SmokeDiagnostic ('Sibling-prefix process remains running after reinstall.')

  $installProbe = Join-Path $installDir 'install-process-probe.exe'
  Copy-Item -LiteralPath $processProbeSource -Destination $installProbe
  $installProcess = Start-Process -FilePath $installProbe -ArgumentList @('-t', '127.0.0.1') -PassThru
  Start-Sleep -Milliseconds 500
  Invoke-ProcessHelperExpectExit `
    -Stage 'Install-directory process detection' `
    -ExpectedExitCode 0 `
    -Arguments @(
      '-InstallDir', $installDir,
      '-ProcessName', 'EchoFlow Code.exe',
      '-Action', 'Find',
      '-InstallerPid', [string]$PID
    )
  Invoke-CheckedProcess -FilePath $installer -Stage 'Install-directory process reinstall' -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
  if (-not $installProcess.HasExited) {
    throw 'Install-directory process was not terminated before reinstall.'
  }

  Stop-Process -Id $siblingProcess.Id -Force
  $siblingProcess.WaitForExit()
  $siblingProcess.Dispose()
  $siblingProcess = $null

  $bundledHelperProbe = Join-Path $siblingDir 'OpenConsole.exe'
  Copy-Item -LiteralPath $processProbeSource -Destination $bundledHelperProbe
  $bundledHelperProcess = Start-Process -FilePath $bundledHelperProbe -ArgumentList @('-t', '127.0.0.1') -PassThru
  Start-Sleep -Milliseconds 500
  $env:COMPLUS_Version = 'v0.0.0-test-invalid-clr'
  Invoke-ProcessExpectFailure -FilePath $installer -Stage 'No-CLR external bundled-helper process reinstall' -ExpectedExitCode 22 -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
  if ($bundledHelperProcess.HasExited) {
    throw 'No-CLR exact-image fallback terminated an external bundled-helper process.'
  }
  Remove-Item Env:COMPLUS_Version -ErrorAction SilentlyContinue
  Stop-Process -Id $bundledHelperProcess.Id -Force
  $bundledHelperProcess.WaitForExit()
  $bundledHelperProcess.Dispose()
  $bundledHelperProcess = $null

  Invoke-NoClrProfileSmoke

  $legacyDir = Join-Path $installDir 'CLAUDE_CONFIG_DIR'
  $legacySentinel = Join-Path $legacyDir 'settings.json'
  New-Item -ItemType Directory -Path $legacyDir -Force | Out-Null
  Set-Content -LiteralPath $legacySentinel -Value 'must-survive-failed-upgrade' -NoNewline
  # Same reason as the stage above: this one also expects 20, so it has to start
  # from a field where nothing matches the name list. The preceding installer run
  # can leave its own uninstaller helper behind briefly.
  Clear-InstallerFallbackProcesses -Context 'Before no-CLR portable reinstall'
  $env:COMPLUS_Version = 'v0.0.0-test-invalid-clr'
  Invoke-ProcessExpectFailure -FilePath $installer -Stage 'Portable reinstall without CLR' -ExpectedExitCode 20 -Arguments @('--updated', '/S', '/currentuser', "/D=$installDir")
  Remove-Item Env:COMPLUS_Version -ErrorAction SilentlyContinue
  if ((Get-Content -LiteralPath $legacySentinel -Raw) -ne 'must-survive-failed-upgrade') {
    throw 'Portable reinstall without CLR modified legacy data instead of failing closed.'
  }

  $results['packaged-smoke'] = [ordered]@{ status = 'passed'; reason = 'All reached packaged smoke assertions completed.'; evidence = 'Two default-profile Unicode-path launches with fresh loopback readiness, sentinel preservation, and process/refusal checks. Profile-specific no-CLR coverage is reported separately.' }
  Write-SmokeDiagnostic ('Windows installer smoke execution passed; consult result.json for passed/failed/unexercised coverage.')
} catch {
  $failure = [string]$_.Exception.Message
  $results[$activeCheck] = [ordered]@{ status = 'failed'; reason = $failure; evidence = 'See diagnostics.log and transcript.log and available launch logs; later assertions were not reached.' }
  throw
} finally {
  try {
  foreach ($probeProcess in @($installProcess, $siblingProcess, $bundledHelperProcess)) {
    if ($null -ne $probeProcess) {
      if (-not $probeProcess.HasExited) {
        Stop-Process -Id $probeProcess.Id -Force -ErrorAction SilentlyContinue
      }
      $probeProcess.Dispose()
    }
  }
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
    # NSIS _?= runs the uninstaller in place instead of returning after spawning
    # a temporary copy. It must be the last argument, with its path unquoted;
    # the fixture cleanup below removes the uninstaller left behind in place.
    Invoke-CheckedProcess -FilePath $uninstaller -Stage 'Cleanup uninstall' -Arguments @('/S', '/KEEP_APP_DATA', '/currentuser', "_?=$installDir") -TimeoutSeconds 120
  }
  } catch {
    $cleanupFailure = [string]$_.Exception.Message
    $results['cleanup'] = [ordered]@{ status = 'failed'; reason = $cleanupFailure; evidence = 'See diagnostics.log and transcript.log; original smoke failure is retained separately.' }
    if (-not $failure) { throw }
  } finally {
    try {
      foreach ($name in $savedEnvironment.Keys) {
        $value = $savedEnvironment[$name]
        if ($null -eq $value) {
          [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        } else {
          [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process')
        }
      }
      Remove-SmokeFixture
      if (-not $cleanupFailure) {
        $results['cleanup'] = [ordered]@{ status = 'passed'; reason = 'Probe disposal, uninstall, environment restoration and fixture removal completed.'; evidence = 'See diagnostics.log and transcript.log.' }
      }
    } catch {
      $priorCleanupFailure = $cleanupFailure
      $cleanupFailure = (@($cleanupFailure, [string]$_.Exception.Message) | Where-Object { $_ }) -join '; '
      $results['cleanup'] = [ordered]@{ status = 'failed'; reason = $cleanupFailure; evidence = 'Fixture/environment cleanup failed; diagnostics remain outside the fixture.' }
      if (-not $failure -and -not $priorCleanupFailure) { throw }
    }
  }
}
} catch {
  if (-not $failure -and -not $cleanupFailure) {
    $failure = [string]$_.Exception.Message
    $results[$activeCheck] = [ordered]@{ status = 'failed'; reason = $failure; evidence = 'See diagnostics.log and transcript.log; later checks were not reached.' }
  }
  throw
} finally {
  try {
    Write-SmokeReport -Results $results -Directory $evidenceDir -Failure $failure -CleanupFailure $cleanupFailure
  } finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
    Write-SmokeDiagnostic ("Windows installer smoke evidence: $evidenceDir")
  }
}
