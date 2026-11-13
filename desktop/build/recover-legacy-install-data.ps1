[CmdletBinding()]
param(
  [string]$PerUserInstallDir = '',
  [string]$PerMachineInstallDir = '',
  [string]$CandidateInstallDir = '',
  [string]$UserDataDir = '',
  [string]$LocalUserDataDir = '',
  [string]$RecoveryRoot = '',
  [string]$ProcessName = 'EchoFlow Code.exe',
  [string]$ActiveConfigDir = $env:CLAUDE_CONFIG_DIR,
  [string]$ActiveConfigManaged = $env:CC_HAHA_APP_PORTABLE_DIR,
  [ValidateSet('trusted-user', 'trusted-uac-outer', 'untrusted-elevated')]
  [string]$InstallerIdentitySafety = 'trusted-user',
  [switch]$SkipProcessCheck,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NoUnsupportedPathAlias {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ($Path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase) -or
      $Path.StartsWith('\\.\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Extended device or volume aliases cannot be recovered safely without a final-path helper: $Path"
  }

  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($root) -or $root -notmatch '^[A-Za-z]:\\$') {
    throw "Only a local volume drive path can be recovered safely: $Path"
  }

  $relative = $fullPath.Substring($root.Length)
  $current = $root
  foreach ($segment in $relative.Split(
      [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar),
      [StringSplitOptions]::RemoveEmptyEntries)) {
    $next = [IO.Path]::Combine($current, $segment)
    $exists = [IO.Directory]::Exists($next) -or [IO.File]::Exists($next)
    if ($exists) {
      try {
        $exactEntry = Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop |
          Where-Object { ([string]$_.Name).Equals($segment, [StringComparison]::OrdinalIgnoreCase) } |
          Select-Object -First 1
      } catch {
        throw "Path segment identity cannot be proven because its parent cannot be enumerated: $next"
      }
      if ($null -eq $exactEntry) {
        $item = Get-Item -LiteralPath $next -Force -ErrorAction SilentlyContinue
        $resolvedName = if ($null -eq $item) { '<unavailable>' } else { [string]$item.Name }
        throw "Alternate path alias cannot be recovered safely without a final-path helper: $next (resolved item name: $resolvedName)"
      }
    } elseif ($segment -match '^[^\\/:*?"<>|.~]{1,6}~[0-9]{1,6}(?:\.[^\\/:*?"<>|]{1,3})?$') {
      throw "Possible 8.3 path alias cannot be proven safe because the segment does not exist: $next"
    }
    $current = $next
  }

  $subst = Join-Path $env:SystemRoot 'System32\subst.exe'
  $substOutput = @(& $subst 2>$null)
  $substDrive = $root.Substring(0, 2)
  $substMatch = $substOutput | Where-Object {
    ([string]$_).TrimStart().StartsWith($substDrive, [StringComparison]::OrdinalIgnoreCase) -and
      ([string]$_).Contains('=>')
  } | Select-Object -First 1
  if ($LASTEXITCODE -eq 0 -and $null -ne $substMatch) {
    throw "SUBST aliases cannot be recovered safely without a final-path helper: $Path"
  }
}

function Assert-NoReparsePointInPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($root)) {
    throw "Cannot determine the path root for $Path"
  }

  $current = $root
  $rootAttributes = [IO.File]::GetAttributes($current)
  if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Path root is a reparse point and cannot be recovered safely: $current"
  }
  $relative = $fullPath.Substring($root.Length)
  $segments = $relative.Split(
    [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar),
    [StringSplitOptions]::RemoveEmptyEntries)
  foreach ($segment in $segments) {
    $current = [IO.Path]::Combine($current, $segment)
    $attributes = [IO.File]::GetAttributes($current)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Path contains a reparse point and cannot be recovered safely: $current"
    }
  }
}

function Convert-ToCanonicalVolumePathIdentity {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  $mountvol = Join-Path $env:SystemRoot 'System32\mountvol.exe'
  $output = @(& $mountvol $root /L 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw "Cannot resolve the canonical volume for $Path"
  }
  $volumeRoots = @($output |
    ForEach-Object { ([string]$_).Trim() } |
    Where-Object { $_ -match '^\\\\\?\\Volume\{[0-9A-Fa-f-]+\}\\$' })
  if ($volumeRoots.Count -ne 1) {
    throw "Cannot resolve one unambiguous canonical volume for $Path"
  }
  $relative = $fullPath.Substring($root.Length)
  return [IO.Path]::Combine($volumeRoots[0], $relative)
}

function Resolve-CanonicalPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  Assert-NoUnsupportedPathAlias -Path $Path
  $fullPath = [IO.Path]::GetFullPath($Path)
  $existingPath = $fullPath
  $missingSegments = New-Object 'System.Collections.Generic.List[string]'
  while (-not ([IO.Directory]::Exists($existingPath) -or [IO.File]::Exists($existingPath))) {
    $parent = [IO.Path]::GetDirectoryName($existingPath)
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $existingPath) {
      throw "Cannot resolve an existing ancestor for $Path"
    }
    $missingSegments.Insert(0, [IO.Path]::GetFileName($existingPath))
    $existingPath = $parent
  }

  Assert-NoReparsePointInPath -Path $existingPath
  $resolved = [IO.Path]::GetFullPath($existingPath)
  foreach ($segment in $missingSegments) {
    $resolved = [IO.Path]::Combine($resolved, $segment)
  }
  return [IO.Path]::GetFullPath($resolved)
}

function Get-CanonicalPathIdentity {
  param([Parameter(Mandatory = $true)][string]$Path)

  # Keep the DOS path for filesystem operations; use the volume GUID form only as a comparison key.
  $resolved = Resolve-CanonicalPath -Path $Path
  return Convert-ToCanonicalVolumePathIdentity -Path $resolved
}

function Test-PathAtOrBelow {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Candidate
  )

  $resolvedParent = (Get-CanonicalPathIdentity $Parent).TrimEnd('\', '/')
  $resolvedCandidate = (Get-CanonicalPathIdentity $Candidate).TrimEnd('\', '/')
  if ($resolvedCandidate.Equals($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  return $resolvedCandidate.StartsWith(
    $resolvedParent + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase)
}

function Test-LexicalPathAtOrBelow {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Candidate
  )

  Assert-NoUnsupportedPathAlias -Path $Parent
  Assert-NoUnsupportedPathAlias -Path $Candidate
  $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $fullCandidate = [IO.Path]::GetFullPath($Candidate).TrimEnd('\', '/')
  if ($fullCandidate.Equals($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  return $fullCandidate.StartsWith(
    $fullParent + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase)
}

function Test-PathMayBeDeleted {
  param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$Candidate
  )

  return (Test-LexicalPathAtOrBelow -Parent $InstallDir -Candidate $Candidate) -or
    (Test-PathAtOrBelow -Parent $InstallDir -Candidate $Candidate)
}

function Test-SamePath {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )
  return (Get-CanonicalPathIdentity $Left).TrimEnd('\', '/').Equals(
    (Get-CanonicalPathIdentity $Right).TrimEnd('\', '/'),
    [StringComparison]::OrdinalIgnoreCase)
}

function Read-AppMode {
  param([Parameter(Mandatory = $true)][string]$ConfigDir, [switch]$RequireExplicitSelection)

  $modeFile = Join-Path $ConfigDir 'app-mode.json'
  try { $attributes = [IO.File]::GetAttributes($modeFile) }
  catch [IO.FileNotFoundException] { return $null }
  catch [IO.DirectoryNotFoundException] { return $null }
  if (($attributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) -ne 0) {
    throw "Existing app mode metadata is not a regular file: $modeFile"
  }
  try {
    $parsed = Get-Content -LiteralPath $modeFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Existing app mode metadata cannot be read safely ($modeFile): $($_.Exception.Message)"
  }
  if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) {
    throw "Existing app mode metadata is not a JSON object: $modeFile"
  }

  $modeProperty = $parsed.PSObject.Properties['mode']
  if ($null -ne $modeProperty -and $modeProperty.Value -isnot [string]) {
    throw "Existing app mode metadata has an invalid mode value: $modeFile"
  }
  $mode = if ($null -ne $modeProperty) {
    ([string]$modeProperty.Value).ToLowerInvariant()
  } else {
    'default'
  }
  if ($mode -notin @('default', 'portable')) {
    throw "Existing app mode metadata has an unsupported mode '$mode': $modeFile"
  }

  $portableProperty = $parsed.PSObject.Properties['portable_dir']
  if ($null -ne $portableProperty -and
      $null -ne $portableProperty.Value -and
      $portableProperty.Value -isnot [string]) {
    throw "Existing app mode metadata has an invalid portable_dir value: $modeFile"
  }
  # Completed receipts require the explicit startup selection, not legacy default inference.
  if ($RequireExplicitSelection) {
    if ($null -eq $modeProperty -or $modeProperty.Name -cne 'mode' -or
        $modeProperty.Value -cnotin @('default', 'portable') -or
        ($modeProperty.Value -ceq 'portable' -and
          ($null -eq $portableProperty -or $portableProperty.Name -cne 'portable_dir' -or
            -not (Test-JournalAbsoluteDirectory $portableProperty.Value)))) {
      throw 'Migrated data startup configuration is invalid'
    }
  }
  $portableDir = if ($null -ne $portableProperty -and $portableProperty.Value -is [string]) {
    ([string]$portableProperty.Value).Trim()
  } else {
    $null
  }
  return [pscustomobject]@{
    Mode = $mode
    PortableDir = $portableDir
  }
}

function Test-LegacyPortableData {
  param([Parameter(Mandatory = $true)][string]$Dir)

  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
    return $false
  }
  foreach ($file in @('settings.json', '.claude.json', '.mcp.json', 'window-state.json', 'terminal-config.json')) {
    if (Test-Path -LiteralPath (Join-Path $Dir $file) -PathType Leaf) {
      return $true
    }
  }
  foreach ($childDir in @('Cache', 'EBWebView', 'projects', 'skills', 'plugins', 'cowork_plugins', 'cc-haha')) {
    if (Test-Path -LiteralPath (Join-Path $Dir $childDir) -PathType Container) {
      return $true
    }
  }
  return $false
}

function Resolve-LegacyConfiguredPath {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Source
  )

  if (-not [IO.Path]::IsPathRooted($Value)) {
    throw "Legacy custom data path is relative and cannot be recovered safely ($Source): $Value"
  }
  return [IO.Path]::GetFullPath($Value)
}

function Get-LegacyActiveSource {
  param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    $SystemMode,
    [switch]$HasTerminalJournal
  )

  $legacyDir = Join-Path $InstallDir 'CLAUDE_CONFIG_DIR'
  $legacyMode = Read-AppMode -ConfigDir $legacyDir
  $legacySource = $null
  if ($null -ne $legacyMode) {
    if ($legacyMode.Mode -eq 'portable') {
      $legacySource = if ((Test-LegacyPortableData -Dir $legacyDir) -or
          [string]::IsNullOrWhiteSpace([string]$legacyMode.PortableDir)) {
        $legacyDir
      } else {
        Resolve-LegacyConfiguredPath -Value $legacyMode.PortableDir -Source (Join-Path $legacyDir 'app-mode.json')
      }
    }
  } elseif (Test-LegacyPortableData -Dir $legacyDir) {
    $legacySource = $legacyDir
  }

  if ($null -ne $SystemMode -and $SystemMode.Mode -eq 'portable' -and
      -not [string]::IsNullOrWhiteSpace([string]$SystemMode.PortableDir)) {
    $currentSource = Resolve-LegacyConfiguredPath -Value $SystemMode.PortableDir -Source 'system app-mode.json'
    # A retained source is not authority to overwrite a later explicit selection, even on retry.
    if ($null -ne $legacySource -and (Test-Path -LiteralPath $legacySource -PathType Container) -and
        -not (Test-SamePath -Left $currentSource -Right $legacySource)) {
      throw "Current portable selection conflicts with retained legacy data. Preserve both directories and resolve the selection before upgrading: $currentSource; $legacySource"
    }
    return $currentSource
  }
  # A terminal receipt separates a later/default selection from pre-migration legacy defaults.
  if ($HasTerminalJournal -and $null -ne $legacySource -and
      (Test-Path -LiteralPath $legacySource -PathType Container)) {
    throw "Current selection conflicts with retained legacy data after migration. Preserve both directories and resolve the selection before upgrading: $legacySource"
  }
  if ($null -ne $legacyMode) { return $legacySource }
  if ($null -ne $SystemMode) {
    if ($SystemMode.Mode -eq 'portable') { return $legacyDir }
    return $null
  }
  return $legacySource
}

function Get-ExistingInstallDirs {
  param([string[]]$InstallDirs)

  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $result = New-Object 'System.Collections.Generic.List[string]'
  foreach ($installDir in $InstallDirs) {
    if ([string]::IsNullOrWhiteSpace($installDir) -or -not (Test-Path -LiteralPath $installDir -PathType Container)) {
      continue
    }
    $resolved = Resolve-CanonicalPath $installDir
    $identity = Convert-ToCanonicalVolumePathIdentity $resolved
    if ($seen.Add($identity)) {
      $result.Add($resolved)
    }
  }
  return $result.ToArray()
}

function Get-PotentialInstallDirs {
  param([AllowEmptyString()][string[]]$InstallDirs)

  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $result = New-Object 'System.Collections.Generic.List[string]'
  foreach ($installDir in $InstallDirs) {
    if ([string]::IsNullOrWhiteSpace($installDir)) {
      continue
    }
    if (-not [IO.Path]::IsPathRooted($installDir)) {
      throw "Application install directory is relative and cannot be checked safely: $installDir"
    }
    Assert-NoUnsupportedPathAlias -Path $installDir
    $fullPath = [IO.Path]::GetFullPath($installDir)
    if ($seen.Add($fullPath)) {
      $result.Add($fullPath)
    }
  }
  return $result.ToArray()
}

function Get-UnsafeLegacySource {
  param(
    [Parameter(Mandatory = $true)][string[]]$InstallDirs,
    [Parameter(Mandatory = $true)][string]$UserDataDir,
    [AllowEmptyString()][string]$ActiveConfigDir,
    [AllowEmptyString()][string]$ActiveConfigManaged,
    [switch]$HasTerminalJournal
  )

  $sources = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
  $activeInsideInstall = $false
  $activeOutsideInstall = $false
  $active = $null
  if (-not [string]::IsNullOrWhiteSpace($ActiveConfigDir)) {
    if (-not [IO.Path]::IsPathRooted($ActiveConfigDir)) {
      throw "Active CLAUDE_CONFIG_DIR is relative and cannot be recovered safely: $ActiveConfigDir"
    }
    $active = [IO.Path]::GetFullPath($ActiveConfigDir)
    foreach ($installDir in $InstallDirs) {
      if (Test-PathMayBeDeleted -InstallDir $installDir -Candidate $active) {
        $activeInsideInstall = $true
        if ($ActiveConfigManaged -ne '1') {
          throw "Active CLAUDE_CONFIG_DIR is managed outside EchoFlow Code and points inside an application install directory. Move or remove that environment variable before upgrading: $active"
        }
        if (Test-SamePath -Left $installDir -Right $active) {
          throw "The active data directory is the application install root itself: $active"
        }
        if (Test-Path -LiteralPath $active -PathType Container) {
          $canonicalActive = Get-CanonicalPathIdentity $active
          if (-not $sources.ContainsKey($canonicalActive)) {
            $sources.Add($canonicalActive, $active)
          }
        }
        break
      }
    }
    if (-not $activeInsideInstall) {
      $activeOutsideInstall = $true
    }
  }

  if ($activeOutsideInstall -and $ActiveConfigManaged -eq '1') {
    # The app-managed active directory lives outside every install directory,
    # so removing the old version cannot touch it. A persisted mode that is
    # missing, stale, or unresolvable here (the mode was switched without a
    # restart, or the installer's APPDATA differs from the app's known-folder
    # view) must not block the upgrade: fall back to treating the directory as
    # externally managed. Install-contained legacy data is still guarded by
    # the external-active check below.
    $systemMode = Read-AppMode -ConfigDir $UserDataDir
    if ($null -ne $systemMode) {
      if ($systemMode.Mode -ne 'portable' -or
          [string]::IsNullOrWhiteSpace([string]$systemMode.PortableDir)) {
        $systemMode = $null
      } else {
        try {
          $persistedActive = Resolve-LegacyConfiguredPath -Value $systemMode.PortableDir -Source 'system app-mode.json'
          if (-not (Test-SamePath -Left $active -Right $persistedActive)) {
            $systemMode = $null
          }
        } catch {
          $systemMode = $null
        }
      }
    }
  } elseif ($activeOutsideInstall) {
    $systemMode = $null
  } else {
    $systemMode = Read-AppMode -ConfigDir $UserDataDir
  }
  foreach ($installDir in $InstallDirs) {
    $source = Get-LegacyActiveSource -InstallDir $installDir -SystemMode $systemMode -HasTerminalJournal:$HasTerminalJournal
    if ([string]::IsNullOrWhiteSpace([string]$source) -or
        -not (Test-Path -LiteralPath $source -PathType Container)) {
      continue
    }
    foreach ($possiblyDeletedRoot in $InstallDirs) {
      if (Test-PathMayBeDeleted -InstallDir $possiblyDeletedRoot -Candidate $source) {
        if (Test-SamePath -Left $possiblyDeletedRoot -Right $source) {
          throw "The active data directory is the application install root itself: $source"
        }
        $canonicalSource = Get-CanonicalPathIdentity $source
        if (-not $sources.ContainsKey($canonicalSource)) {
          $sources.Add($canonicalSource, $source)
        }
        break
      }
    }
  }

  if ($activeOutsideInstall) {
    if ($sources.Count -gt 0) {
      throw "External CLAUDE_CONFIG_DIR is active while install-contained legacy data still exists. Refusing to remove data that may belong to another Windows user: $($sources.Values -join ', ')"
    }
    return $null
  }
  if ($sources.Count -gt 1) {
    throw "Multiple distinct legacy data sources may be removed; refusing to guess which one is active: $($sources.Values -join ', ')"
  }
  if ($sources.Count -eq 1) {
    return @($sources.Values)[0]
  }
  return $null
}

function Assert-NoUndiscoveredLegacySources {
  param(
    [Parameter(Mandatory = $true)][string[]]$InstallDirs,
    [AllowNull()][AllowEmptyString()][string]$ActiveSource
  )

  foreach ($installDir in $InstallDirs) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($installDir)
    while ($pending.Count -gt 0) {
      $currentDir = $pending.Pop()
      foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($currentDir)) {
        $attributes = [IO.File]::GetAttributes($entry)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw "Application install tree contains a reparse point that prevents a complete legacy data scan: $entry"
        }
        if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
          $pending.Push($entry)
          continue
        }
        if (-not ([IO.Path]::GetFileName($entry)).Equals('app-mode.json', [StringComparison]::OrdinalIgnoreCase)) {
          continue
        }

        $modeDir = [IO.Path]::GetDirectoryName($entry)
        $mode = Read-AppMode -ConfigDir $modeDir
        if ($null -eq $mode -or $mode.Mode -ne 'portable') {
          continue
        }
        $candidate = if (Test-LegacyPortableData -Dir $modeDir) {
          $modeDir
        } elseif ([string]::IsNullOrWhiteSpace([string]$mode.PortableDir)) {
          $modeDir
        } else {
          Resolve-LegacyConfiguredPath -Value $mode.PortableDir -Source $entry
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
          continue
        }

        $willBeRemoved = $false
        foreach ($possiblyDeletedRoot in $InstallDirs) {
          if (Test-PathMayBeDeleted -InstallDir $possiblyDeletedRoot -Candidate $candidate) {
            $willBeRemoved = $true
            break
          }
        }
        if (-not $willBeRemoved) {
          continue
        }
        if (-not [string]::IsNullOrWhiteSpace($ActiveSource) -and
            (Test-SamePath -Left $ActiveSource -Right $candidate)) {
          continue
        }
        throw "Install-contained custom data was configured by another Windows user or an undiscovered legacy mode. Refusing to remove it: $candidate (metadata: $entry)"
      }
    }
  }
}

function Assert-NoRunningApplication {
  param(
    [Parameter(Mandatory = $true)][string[]]$InstallDirs,
    [Parameter(Mandatory = $true)][string]$ProcessName
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    try {
      $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    } catch {
      throw "Cannot verify whether the old application or one of its sidecars is still running: $($_.Exception.Message)"
    }

    $matching = New-Object 'System.Collections.Generic.List[string]'
    $hasUnknownAppPath = $false
    foreach ($process in $processes) {
      $executablePath = [string]$process.ExecutablePath
      if ([string]::IsNullOrWhiteSpace($executablePath)) {
        if (([string]$process.Name).Equals($ProcessName, [StringComparison]::OrdinalIgnoreCase)) {
          $hasUnknownAppPath = $true
        }
        continue
      }
      foreach ($installDir in $InstallDirs) {
        if (Test-PathMayBeDeleted -InstallDir $installDir -Candidate $executablePath) {
          $matching.Add($executablePath)
          break
        }
      }
    }
    if ($matching.Count -eq 0 -and -not $hasUnknownAppPath) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  if ($hasUnknownAppPath) {
    throw "Cannot verify the executable path of a running $ProcessName process. Close the app and run the installer again."
  }
  throw "An application process is still running from an installation that may contain legacy data: $($matching -join ', '). Close the app and run the installer again."
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-TreeManifest {
  param([Parameter(Mandatory = $true)][string]$Root)

  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $rootAttributes = [IO.File]::GetAttributes($rootPath)
  if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Legacy data root is a reparse point and cannot be copied without ambiguity: $rootPath"
  }

  $entries = New-Object 'System.Collections.Generic.List[string]'
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push($rootPath)
  while ($pending.Count -gt 0) {
    $currentDir = $pending.Pop()
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($currentDir)) {
      $attributes = [IO.File]::GetAttributes($entry)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Legacy data contains a reparse point and recovery must stop: $entry"
      }
      $relative = [IO.Path]::GetFullPath($entry).Substring($rootPath.Length).TrimStart('\', '/')
      if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
        $entries.Add("D|$relative")
        $pending.Push($entry)
      } else {
        $file = Get-Item -LiteralPath $entry -Force
        $entries.Add("F|$relative|$($file.Length)|$(Get-FileSha256 -Path $entry)")
      }
    }
  }
  return @($entries.ToArray() | Sort-Object)
}

function Assert-TreeManifestsEqual {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Expected,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Actual,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if ($Expected.Count -ne $Actual.Count -or
      $null -ne (Compare-Object -ReferenceObject @($Expected) -DifferenceObject @($Actual) -CaseSensitive)) {
    throw $Message
  }
}

function Copy-VerifiedTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$RecoveryRoot
  )

  New-Item -ItemType Directory -Path $RecoveryRoot -Force | Out-Null
  $id = [Guid]::NewGuid().ToString('N')
  $timestamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $staging = Join-Path $RecoveryRoot ".$id.partial"
  $destination = Join-Path $RecoveryRoot "Recovered-$timestamp-$id"
  New-Item -ItemType Directory -Path $staging | Out-Null

  try {
    $before = @(Get-TreeManifest -Root $Source)
    & "$env:SystemRoot\System32\robocopy.exe" `
      $Source $staging /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
    $robocopyExitCode = $LASTEXITCODE
    if ($robocopyExitCode -ge 8) {
      throw "robocopy failed with exit code $robocopyExitCode"
    }

    $after = @(Get-TreeManifest -Root $Source)
    $copied = @(Get-TreeManifest -Root $staging)
    Assert-TreeManifestsEqual -Expected $before -Actual $after -Message 'Legacy data changed while it was being copied; close every app using it and retry.'
    Assert-TreeManifestsEqual -Expected $after -Actual $copied -Message 'The recovered copy does not exactly match the legacy data source.'

    [IO.Directory]::Move($staging, $destination)
    return $destination
  } finally {
    if (Test-Path -LiteralPath $staging) {
      Remove-Item -LiteralPath $staging -Recurse -Force
    }
  }
}

function Write-AppModeAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$UserDataDir,
    [Parameter(Mandatory = $true)][string]$CustomDir
  )

  New-Item -ItemType Directory -Path $UserDataDir -Force | Out-Null
  $target = Join-Path $UserDataDir 'app-mode.json'
  $id = [Guid]::NewGuid().ToString('N')
  $temporary = Join-Path $UserDataDir ".app-mode.$id.tmp"
  $backup = Join-Path $UserDataDir "app-mode.pre-recovery.$id.bak"
  $json = [ordered]@{
    mode = 'portable'
    portable_dir = $CustomDir
  } | ConvertTo-Json

  try {
    [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      [IO.File]::Replace($temporary, $target, $backup, $true)
    } else {
      [IO.File]::Move($temporary, $target)
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Resolve-UserDataDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Current,
    [AllowEmptyString()][string]$Published
  )

  # Profile selection matches the app's lexical comparison; recovery paths still require canonical identities.
  if ([string]::IsNullOrWhiteSpace($Published) -or
      [IO.Path]::GetFullPath($Current).TrimEnd('\', '/').Equals(
        [IO.Path]::GetFullPath($Published).TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)) {
    return $Current
  }
  # Keep this small cache-only exclusion in sync with echoFlowDataRoot.ts.
  $caches = @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'Crashpad', 'logs')
  $populated = @($Current, $Published | Where-Object {
    $directory = $_
    if (Test-Path -LiteralPath $directory) {
      if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw "The user data path is not a directory: $directory"
      }
      @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop | Where-Object { $caches -cnotcontains $_.Name }).Count -gt 0
    }
  })
  if ($populated.Count -gt 1) {
    throw "Both Windows data directories contain user state. Back up and resolve the conflict manually before upgrading: $Current; $Published"
  }
  if ($populated.Count -eq 1) { return $populated[0] }
  return $Published
}

function Assert-JournalProperties {
  param($Value, [string[]]$Names)

  if ($Value -isnot [pscustomobject]) { throw 'Expected a migration record object' }
  foreach ($name in $Names) {
    $property = $Value.PSObject.Properties[$name]
    if ($null -eq $property -or $property.Name -cne $name) { throw "Missing migration record field: $name" }
  }
}

function Test-JournalAbsoluteDirectory {
  param($Value)

  if ($Value -isnot [string] -or $Value.Contains([char]0) -or -not [IO.Path]::IsPathRooted($Value)) { return $false }
  $full = [IO.Path]::GetFullPath($Value)
  if ($full -ne [IO.Path]::GetPathRoot($full)) { $full = $full.TrimEnd('\', '/') }
  return $Value -ceq $full
}

function Test-JournalPathsOverlap {
  param([string]$Left, [string]$Right)

  $leftRoot = $Left.TrimEnd('\', '/') + '\'
  $rightRoot = $Right.TrimEnd('\', '/') + '\'
  return $leftRoot.StartsWith($rightRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $rightRoot.StartsWith($leftRoot, [StringComparison]::OrdinalIgnoreCase)
}

function Test-JournalDirectoryIdentity {
  param($Value)

  Assert-JournalProperties $Value @('canonical', 'dev', 'ino')
  return $Value -is [pscustomobject] -and (Test-JournalAbsoluteDirectory $Value.canonical) -and
    $Value.dev -is [string] -and $Value.dev -cmatch '\A[0-9]+\z' -and
    $Value.ino -is [string] -and $Value.ino -cmatch '\A[0-9]+\z'
}

function Assert-MigrationJournalAllowsRecovery {
  param([Parameter(Mandatory = $true)][string]$UserDataDir)

  $journalFile = Join-Path $UserDataDir 'data-migration-v1.json'
  try {
    try { [IO.File]::GetAttributes($journalFile) | Out-Null }
    catch [IO.FileNotFoundException] { return $false }
    catch [IO.DirectoryNotFoundException] { return $false }
    Assert-NoReparsePointInPath -Path $journalFile
    $text = [IO.File]::ReadAllText($journalFile)
    if (-not $text.TrimStart().StartsWith('{')) { throw 'Expected a journal object' }
    $journal = $text | ConvertFrom-Json
    Assert-JournalProperties $journal @('version', 'status', 'oldMode', 'stagingDir', 'manifest', 'credentials', 'createdCredentials')
    Assert-JournalProperties $journal.status @('id', 'stage', 'sourceDir', 'targetDir')
    # Match dataMigration.ts parseJournal; terminal receipts describe history, not current filesystem identities.
    if ($journal -isnot [pscustomobject] -or
        ($journal.version -isnot [int] -and $journal.version -isnot [long] -and $journal.version -isnot [double]) -or
        $journal.version -ne 1 -or $journal.status -isnot [pscustomobject]) { throw 'Unsupported migration recovery record' }
    $status = $journal.status
    if ($status.id -isnot [string] -or $status.id -cnotmatch '\A[a-zA-Z0-9_-]{1,80}\z' -or
        $status.stage -cnotin @('completed', 'failed', 'cancelled') -or
        -not (Test-JournalAbsoluteDirectory $status.sourceDir) -or
        -not (Test-JournalAbsoluteDirectory $status.targetDir) -or
        -not (Test-JournalAbsoluteDirectory $journal.stagingDir) -or
        $journal.stagingDir -cne [IO.Path]::Combine($status.targetDir, ".cc-haha-migration-$($status.id)")) {
      throw 'Unsupported or unfinished migration recovery record'
    }
    if (Test-JournalPathsOverlap $status.sourceDir $status.targetDir) { throw 'Migration recovery directories overlap' }
    if (@($journal.PSObject.Properties.Name) -ccontains 'directories') {
      Assert-JournalProperties $journal.directories @('source', 'target')
      if (-not (Test-JournalDirectoryIdentity $journal.directories.source) -or
          -not (Test-JournalDirectoryIdentity $journal.directories.target) -or
          (Test-JournalPathsOverlap $journal.directories.source.canonical $journal.directories.target.canonical)) {
        throw 'Invalid migration directory identities'
      }
    }
    if (@($journal.PSObject.Properties.Name) -ccontains 'stagingIdentity' -and
        -not (Test-JournalDirectoryIdentity $journal.stagingIdentity)) { throw 'Invalid migration staging identity' }
    if ($journal.oldMode -ne $null) {
      if ($journal.oldMode -isnot [string] -or -not $journal.oldMode.TrimStart().StartsWith('{')) { throw 'Invalid previous migration mode' }
      $oldMode = $journal.oldMode | ConvertFrom-Json
      if ($oldMode -isnot [pscustomobject]) { throw 'Invalid previous migration mode' }
    }
    if ($journal.manifest -isnot [array]) { throw 'Invalid migration manifest' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $journal.manifest) {
      Assert-JournalProperties $file @('relative', 'kind')
      if ($file.kind -ceq 'file') { Assert-JournalProperties $file @('digest') }
      if ($file.kind -ceq 'link') { Assert-JournalProperties $file @('link') }
      if ($file -isnot [pscustomobject] -or $file.relative -isnot [string] -or
          [string]::IsNullOrEmpty($file.relative) -or $file.relative.Contains([char]0) -or
          [IO.Path]::IsPathRooted($file.relative) -or
          @($file.relative -split '[\\/]' | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0 -or
          $file.kind -cnotin @('file', 'directory', 'link') -or
          ($file.kind -ceq 'file' -and ($file.digest -isnot [string] -or $file.digest -cnotmatch '\A[a-f0-9]{64}\z')) -or
          ($file.kind -ceq 'link' -and $file.link -isnot [string]) -or -not $seen.Add($file.relative)) {
        throw 'Invalid or duplicate migration manifest entry'
      }
    }
    if ($journal.credentials -isnot [array] -or $journal.createdCredentials -isnot [array]) { throw 'Invalid migration credentials' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $targetHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($status.targetDir.Normalize())))).Replace('-', '').ToLowerInvariant().Substring(0, 8)
    } finally { $sha.Dispose() }
    foreach ($property in @('credentials', 'createdCredentials')) {
      $services = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
      foreach ($receipt in $journal.$property) {
        Assert-JournalProperties $receipt @('service', 'digest')
        if ($receipt -isnot [pscustomobject] -or $receipt.service -isnot [string] -or
            $receipt.service -cnotmatch "\AClaude Code(?:-(?:custom|staging|local)-oauth)?(?:-credentials)?-$targetHash\z" -or
            $receipt.digest -isnot [string] -or $receipt.digest -cnotmatch '\A[a-f0-9]{64}\z' -or
            -not $services.Add($receipt.service)) { throw 'Invalid migration credential receipt' }
      }
    }
    if ($status.stage -ceq 'completed') {
      $current = Read-AppMode -ConfigDir $UserDataDir -RequireExplicitSelection
      if ($null -eq $current) { throw 'Migrated data startup configuration is unavailable' }
      if ($current.Mode -eq 'portable' -and
          -not [string]::IsNullOrWhiteSpace($current.PortableDir) -and
          [IO.Path]::GetFullPath($current.PortableDir).TrimEnd('\', '/').Equals($status.targetDir.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase) -and
          -not (Test-Path -LiteralPath $status.targetDir -PathType Container -ErrorAction Stop)) {
        throw 'The completed migration target is still selected but missing'
      }
    }
    return $true
  } catch {
    throw "Finish migration recovery in the application before upgrading; no installer recovery was attempted. $($_.Exception.Message)"
  }
}

function Invoke-LegacyRecovery {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$InstallDirs,
    [AllowEmptyCollection()][AllowEmptyString()][string[]]$SharedInstallDirs = @(),
    [Parameter(Mandatory = $true)][string]$UserDataDir,
    [AllowEmptyString()][string]$LocalUserDataDir = '',
    [Parameter(Mandatory = $true)][string]$RecoveryRoot,
    [Parameter(Mandatory = $true)][string]$ProcessName,
    [AllowEmptyString()][string]$ActiveConfigDir,
    [AllowEmptyString()][string]$ActiveConfigManaged = '',
    [string]$InstallerIdentitySafety = 'trusted-user',
    [switch]$SkipProcessCheck
  )

  $installDirInputs = @($InstallDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($installDirInputs.Count -eq 0) {
    return $null
  }
  $potentialInstallDirs = @(Get-PotentialInstallDirs -InstallDirs $installDirInputs)
  $existingInstallDirs = @(Get-ExistingInstallDirs -InstallDirs $potentialInstallDirs)
  if ($existingInstallDirs.Count -eq 0) {
    return $null
  }

  $UserDataDir = Resolve-UserDataDirectory -Current $UserDataDir -Published $LocalUserDataDir
  $hasTerminalJournal = Assert-MigrationJournalAllowsRecovery -UserDataDir $UserDataDir

  $source = Get-UnsafeLegacySource `
    -InstallDirs $existingInstallDirs `
    -UserDataDir $UserDataDir `
    -ActiveConfigDir $ActiveConfigDir `
    -ActiveConfigManaged $ActiveConfigManaged `
    -HasTerminalJournal:$hasTerminalJournal
  $sharedInstallDirInputs = @($SharedInstallDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $existingSharedInstallDirs = @()
  if ($sharedInstallDirInputs.Count -gt 0) {
    $potentialSharedInstallDirs = @(Get-PotentialInstallDirs -InstallDirs $sharedInstallDirInputs)
    $existingSharedInstallDirs = @(Get-ExistingInstallDirs -InstallDirs $potentialSharedInstallDirs)
  }
  if ($existingSharedInstallDirs.Count -gt 0) {
    Assert-NoUndiscoveredLegacySources -InstallDirs $existingSharedInstallDirs -ActiveSource $source
  }
  if ([string]::IsNullOrWhiteSpace([string]$source)) {
    return $null
  }
  if ($InstallerIdentitySafety -eq 'untrusted-elevated') {
    throw 'Legacy data recovery was requested from an elevated installer without the original user process. Run the installer normally (not as Administrator) so recovery is written to the correct Windows user profile.'
  }
  if (-not $SkipProcessCheck) {
    Assert-NoRunningApplication -InstallDirs $existingInstallDirs -ProcessName $ProcessName
  }

  foreach ($installDir in $potentialInstallDirs) {
    if (Test-PathMayBeDeleted -InstallDir $installDir -Candidate $UserDataDir) {
      throw "The mode metadata directory is inside an application install directory: $UserDataDir"
    }
    if (Test-PathMayBeDeleted -InstallDir $installDir -Candidate $RecoveryRoot) {
      throw "The recovery destination is inside an application install directory: $RecoveryRoot"
    }
  }

  $destination = Copy-VerifiedTree -Source $source -RecoveryRoot $RecoveryRoot
  $finalSource = @(Get-TreeManifest -Root $source)
  $finalDestination = @(Get-TreeManifest -Root $destination)
  Assert-TreeManifestsEqual `
    -Expected $finalSource `
    -Actual $finalDestination `
    -Message 'Legacy data changed after the verified recovery copy was finalized; the installer stopped before removing the old version.'
  if (-not $SkipProcessCheck) {
    Assert-NoRunningApplication -InstallDirs $existingInstallDirs -ProcessName $ProcessName
  }
  Write-AppModeAtomically -UserDataDir $UserDataDir -CustomDir $destination
  return $destination
}

function Assert-SelfTest {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (-not $Condition) {
    throw "Self-test failed: $Message"
  }
}

function Write-TestMode {
  param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)]$Value
  )
  New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $Dir 'app-mode.json'), ($Value | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

function New-TestMigrationJournal {
  param([string]$Stage, [string]$Source, [string]$Target)

  # The old v1 shape intentionally has no optional directory identities.
  return [ordered]@{
    version = 1
    status = [ordered]@{
      id = 'installer-fixture'; stage = $Stage; sourceDir = $Source; targetDir = $Target
      files = 1; totalFiles = 1; bytes = 1; totalBytes = 1
      cancellable = $Stage -notin @('committing', 'restarting', 'completed', 'failed', 'cancelled')
    }
    oldMode = '{"mode":"default","unknown":42}'
    stagingDir = [IO.Path]::Combine($Target, '.cc-haha-migration-installer-fixture')
    manifest = @(@{ relative = 'settings.json'; kind = 'file'; digest = ('a' * 64) })
    createdCredentials = @()
    credentials = @()
    unknownReceiptField = 'preserve byte for byte'
  }
}

function Assert-TestRecoveryRefused {
  param([string]$Root, [hashtable]$Arguments, [string]$Message, [string]$LockedFile = '')

  $before = @(Get-TreeManifest -Root $Root)
  $failure = ''
  $lock = $null
  try {
    if ($LockedFile) {
      $lock = [IO.File]::Open($LockedFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    }
    try {
      Invoke-LegacyRecovery @Arguments | Out-Null
    } catch {
      $failure = $_.Exception.Message
    }
  } finally {
    if ($null -ne $lock) { $lock.Dispose() }
  }
  Assert-SelfTest -Condition ($failure.Contains($Message)) -Message "expected refusal '$Message', received '$failure' ($Root)"
  Assert-TreeManifestsEqual -Expected $before -Actual @(Get-TreeManifest -Root $Root) -Message "refusal modified journal, mode, source or staging ($Root)"
  Assert-SelfTest -Condition (-not (Test-Path -LiteralPath $Arguments.RecoveryRoot)) -Message "refusal created a recovery copy ($Root)"
}

function Run-SelfTest {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) "cc-haha-storage-recovery-$([Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  $unicodeName = "$([char]0x6570)$([char]0x636E)"
  try {
    $canonicalTestRoot = Get-CanonicalPathIdentity $testRoot
    Assert-SelfTest `
      -Condition ($canonicalTestRoot.StartsWith('\\?\Volume{', [StringComparison]::OrdinalIgnoreCase)) `
      -Message 'ordinary drive path did not receive a canonical volume identity'

    $volumeAliasFailed = $false
    try {
      Resolve-CanonicalPath -Path $canonicalTestRoot | Out-Null
    } catch {
      $volumeAliasFailed = $_.Exception.Message.Contains('Extended device or volume aliases')
    }
    Assert-SelfTest -Condition $volumeAliasFailed -Message 'extended volume alias did not fail closed'

    $possibleShortAliasFailed = $false
    try {
      Resolve-CanonicalPath -Path (Join-Path $testRoot 'MISSIN~1') | Out-Null
    } catch {
      $possibleShortAliasFailed = $_.Exception.Message.Contains('8.3 path alias')
    }
    Assert-SelfTest -Condition $possibleShortAliasFailed -Message 'possible 8.3 alias did not fail closed'

    $legalTildePath = Join-Path $testRoot 'project~notes'
    New-Item -ItemType Directory -Path $legalTildePath | Out-Null
    $resolvedLegalTildePath = Resolve-CanonicalPath -Path $legalTildePath
    Assert-SelfTest `
      -Condition ($resolvedLegalTildePath.EndsWith('project~notes', [StringComparison]::OrdinalIgnoreCase)) `
      -Message 'legal long directory name containing a tilde was blocked as an 8.3 alias'

    $substDrive = $null
    foreach ($codePoint in (90..68)) {
      $candidateDrive = "$([char]$codePoint):"
      if (-not (Test-Path -LiteralPath "$candidateDrive\")) {
        $substDrive = $candidateDrive
        break
      }
    }
    Assert-SelfTest -Condition ($null -ne $substDrive) -Message 'no drive letter was available for the SUBST alias test'
    $subst = Join-Path $env:SystemRoot 'System32\subst.exe'
    & $subst $substDrive $testRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Self-test could not create SUBST alias $substDrive for $testRoot"
    }
    try {
      $substAliasFailed = $false
      try {
        Resolve-CanonicalPath -Path "$substDrive\" | Out-Null
      } catch {
        $substAliasFailed = $_.Exception.Message.Contains('SUBST aliases')
      }
      Assert-SelfTest -Condition $substAliasFailed -Message 'SUBST alias did not fail closed'
    } finally {
      & $subst $substDrive /D | Out-Null
    }

    $install = Join-Path $testRoot 'old install'
    $legacy = Join-Path $install 'CLAUDE_CONFIG_DIR'
    $userData = Join-Path $testRoot 'app data'
    $recovery = Join-Path $testRoot 'recovery'
    New-Item -ItemType Directory -Path $legacy -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $legacy 'settings.json') -Value 'legacy-v1' -NoNewline
    Write-TestMode -Dir $legacy -Value @{ mode = 'portable'; portable_dir = $null }
    Write-TestMode -Dir $userData -Value @{ mode = 'default'; portable_dir = $null }

    $first = Invoke-LegacyRecovery `
      -InstallDirs @($install) -UserDataDir $userData -RecoveryRoot $recovery `
      -ProcessName $ProcessName -ActiveConfigDir '' -SkipProcessCheck
    Assert-SelfTest -Condition (Test-Path -LiteralPath (Join-Path $first 'settings.json') -PathType Leaf) -Message 'legacy default was not recovered'
    Assert-SelfTest -Condition ((Get-Content -LiteralPath (Join-Path $first 'settings.json') -Raw) -eq 'legacy-v1') -Message 'recovered content differs'
    Assert-SelfTest -Condition (Test-Path -LiteralPath (Join-Path $legacy 'settings.json') -PathType Leaf) -Message 'source was modified'
    $firstMode = Get-Content -LiteralPath (Join-Path $userData 'app-mode.json') -Raw | ConvertFrom-Json
    Assert-SelfTest -Condition ($firstMode.mode -eq 'portable' -and $firstMode.portable_dir -eq $first) -Message 'recovery was not persisted as explicit custom mode'

    Set-Content -LiteralPath (Join-Path $legacy 'settings.json') -Value 'legacy-v2' -NoNewline
    $retryBefore = @(Get-TreeManifest -Root $testRoot)
    $retryRefused = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($install) -UserDataDir $userData -RecoveryRoot $recovery `
        -ProcessName $ProcessName -ActiveConfigDir '' -SkipProcessCheck | Out-Null
    } catch {
      $retryRefused = $_.Exception.Message.Contains('Current portable selection conflicts with retained legacy data')
    }
    Assert-SelfTest -Condition $retryRefused -Message 'retry refused to override the current recovered selection'
    Assert-TreeManifestsEqual -Expected $retryBefore -Actual @(Get-TreeManifest -Root $testRoot) -Message 'retry changed the current pointer, original data or recovered data'

    $pointerInstall = Join-Path $testRoot 'pointer install'
    $pointerLegacy = Join-Path $pointerInstall 'CLAUDE_CONFIG_DIR'
    $pointerData = Join-Path $pointerInstall 'custom data'
    $pointerUserData = Join-Path $testRoot 'pointer app data'
    New-Item -ItemType Directory -Path $pointerData -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $pointerData '.claude.json') -Value 'pointer-data' -NoNewline
    Write-TestMode -Dir $pointerLegacy -Value @{ mode = 'portable'; portable_dir = $pointerData }
    $pointerRecovered = Invoke-LegacyRecovery `
      -InstallDirs @($pointerInstall) -UserDataDir $pointerUserData -RecoveryRoot (Join-Path $testRoot 'pointer recovery') `
      -ProcessName $ProcessName -ActiveConfigDir '' -SkipProcessCheck
    Assert-SelfTest -Condition ((Get-Content -LiteralPath (Join-Path $pointerRecovered '.claude.json') -Raw) -eq 'pointer-data') -Message 'legacy custom pointer was not recovered'

    $managedInstall = Join-Path $testRoot 'managed env install'
    $managedLegacy = Join-Path $managedInstall 'CLAUDE_CONFIG_DIR'
    New-Item -ItemType Directory -Path $managedLegacy -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $managedLegacy 'settings.json') -Value 'managed-env' -NoNewline
    $unmanagedFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($managedInstall) -UserDataDir (Join-Path $testRoot 'unmanaged app data') `
        -RecoveryRoot (Join-Path $testRoot 'unmanaged recovery') -ProcessName $ProcessName `
        -ActiveConfigDir $managedLegacy -ActiveConfigManaged '' -SkipProcessCheck | Out-Null
    } catch {
      $unmanagedFailed = $_.Exception.Message.Contains('managed outside EchoFlow Code')
    }
    Assert-SelfTest -Condition $unmanagedFailed -Message 'unsafe external CLAUDE_CONFIG_DIR did not fail closed'

    $managedRecovered = Invoke-LegacyRecovery `
      -InstallDirs @($managedInstall) -UserDataDir (Join-Path $testRoot 'managed app data') `
      -RecoveryRoot (Join-Path $testRoot 'managed recovery') -ProcessName $ProcessName `
      -ActiveConfigDir $managedLegacy -ActiveConfigManaged '1' -SkipProcessCheck
    Assert-SelfTest -Condition ((Get-Content -LiteralPath (Join-Path $managedRecovered 'settings.json') -Raw) -eq 'managed-env') -Message 'app-managed active environment was not recovered'

    $elevatedFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($managedInstall) -UserDataDir (Join-Path $testRoot 'elevated app data') `
        -RecoveryRoot (Join-Path $testRoot 'elevated recovery') -ProcessName $ProcessName `
        -ActiveConfigDir $managedLegacy -ActiveConfigManaged '1' `
        -InstallerIdentitySafety 'untrusted-elevated' -SkipProcessCheck | Out-Null
    } catch {
      $elevatedFailed = $_.Exception.Message.Contains('original user process')
    }
    Assert-SelfTest -Condition $elevatedFailed -Message 'untrusted elevated recovery did not fail closed'

    $elevatedDefaultInstall = Join-Path $testRoot 'elevated default install'
    New-Item -ItemType Directory -Path $elevatedDefaultInstall -Force | Out-Null
    $elevatedDefaultResult = Invoke-LegacyRecovery `
      -InstallDirs @($elevatedDefaultInstall) `
      -UserDataDir (Join-Path $testRoot 'elevated default app data') `
      -RecoveryRoot (Join-Path $testRoot 'elevated default recovery') -ProcessName $ProcessName `
      -ActiveConfigDir '' -InstallerIdentitySafety 'untrusted-elevated' -SkipProcessCheck
    Assert-SelfTest -Condition ($null -eq $elevatedDefaultResult) -Message 'elevated default-mode reinstall was blocked without legacy data'

    $perUserInstall = Join-Path $testRoot 'per-user install'
    $perUserExternalTarget = Join-Path $testRoot 'per-user external target'
    $perUserAppPayload = Join-Path $perUserInstall 'resources\app payload'
    New-Item -ItemType Directory -Path (Join-Path $perUserInstall 'resources') -Force | Out-Null
    New-Item -ItemType Directory -Path $perUserExternalTarget -Force | Out-Null
    New-Item -ItemType Junction -Path $perUserAppPayload -Target $perUserExternalTarget | Out-Null
    $perUserResult = Invoke-LegacyRecovery `
      -InstallDirs @('', $perUserInstall, '') -SharedInstallDirs @('') `
      -UserDataDir (Join-Path $testRoot 'per-user app data') `
      -RecoveryRoot (Join-Path $testRoot 'per-user recovery') -ProcessName $ProcessName `
      -ActiveConfigDir '' -SkipProcessCheck
    Assert-SelfTest -Condition ($null -eq $perUserResult) -Message 'per-user default-mode reinstall scanned the packaged application tree'

    $wrongIdentityInstall = Join-Path $testRoot 'registered shared install'
    $wrongIdentityData = Join-Path $wrongIdentityInstall 'custom data'
    New-Item -ItemType Directory -Path $wrongIdentityData -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $wrongIdentityData 'settings.json') -Value 'other-user-data' -NoNewline
    Write-TestMode -Dir $wrongIdentityData -Value @{ mode = 'portable'; portable_dir = $wrongIdentityData }
    $wrongIdentityFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($wrongIdentityInstall) -SharedInstallDirs @($wrongIdentityInstall) `
        -UserDataDir (Join-Path $testRoot 'wrong identity app data') `
        -RecoveryRoot (Join-Path $testRoot 'wrong identity recovery') -ProcessName $ProcessName `
        -ActiveConfigDir '' -InstallerIdentitySafety 'untrusted-elevated' -SkipProcessCheck | Out-Null
    } catch {
      $wrongIdentityFailed = $_.Exception.Message.Contains('another Windows user')
    }
    Assert-SelfTest -Condition $wrongIdentityFailed -Message 'untrusted elevated installer treated invisible user metadata as safe'

    $futureInstall = Join-Path $testRoot 'future install'
    $futureRecovery = Join-Path $futureInstall 'Recovered'
    $futureFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($managedInstall, $futureInstall) `
        -UserDataDir (Join-Path $testRoot 'future app data') -RecoveryRoot $futureRecovery `
        -ProcessName $ProcessName -ActiveConfigDir $managedLegacy -ActiveConfigManaged '1' `
        -SkipProcessCheck | Out-Null
    } catch {
      $futureFailed = $_.Exception.Message.Contains('recovery destination is inside an application install directory')
    }
    Assert-SelfTest -Condition $futureFailed -Message 'missing future install root did not protect its recovery subtree'

    $sharedInstall = Join-Path $testRoot 'shared install'
    $sharedLegacy = Join-Path $sharedInstall 'CLAUDE_CONFIG_DIR'
    $activeExternal = Join-Path $testRoot 'active external'
    New-Item -ItemType Directory -Path $sharedLegacy -Force | Out-Null
    New-Item -ItemType Directory -Path $activeExternal -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $sharedLegacy 'settings.json') -Value 'shared-user-data' -NoNewline
    $sharedFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($sharedInstall) -SharedInstallDirs @($sharedInstall) `
        -UserDataDir (Join-Path $testRoot 'shared app data') `
        -RecoveryRoot (Join-Path $testRoot 'shared recovery') -ProcessName $ProcessName `
        -ActiveConfigDir $activeExternal -ActiveConfigManaged '' -SkipProcessCheck | Out-Null
    } catch {
      $sharedFailed = $_.Exception.Message.Contains('another Windows user')
    }
    Assert-SelfTest -Condition $sharedFailed -Message 'external active config hid shared install-contained data'

    $otherUserInstall = Join-Path $testRoot 'other user shared install'
    $otherUserData = Join-Path $otherUserInstall 'B-data'
    $currentUserMode = Join-Path $testRoot 'current user shared mode'
    New-Item -ItemType Directory -Path $otherUserData -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $otherUserData 'settings.json') -Value 'other-windows-user' -NoNewline
    Write-TestMode -Dir $otherUserData -Value @{ mode = 'portable'; portable_dir = $otherUserData }
    Write-TestMode -Dir $currentUserMode -Value @{ mode = 'default'; portable_dir = $null }
    $otherUserFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($otherUserInstall) -SharedInstallDirs @($otherUserInstall) `
        -UserDataDir $currentUserMode `
        -RecoveryRoot (Join-Path $testRoot 'other user recovery') -ProcessName $ProcessName `
        -ActiveConfigDir '' -SkipProcessCheck | Out-Null
    } catch {
      $otherUserFailed = $_.Exception.Message.Contains('another Windows user')
    }
    Assert-SelfTest -Condition $otherUserFailed -Message 'another Windows user custom directory was not protected'

    $managedExternalInstall = Join-Path $testRoot 'managed external install'
    $managedExternalData = Join-Path $testRoot 'managed external data'
    $managedExternalUserData = Join-Path $testRoot 'managed external app data'
    New-Item -ItemType Directory -Path $managedExternalInstall -Force | Out-Null
    New-Item -ItemType Directory -Path $managedExternalData -Force | Out-Null
    Write-TestMode -Dir $managedExternalUserData -Value @{ mode = 'portable'; portable_dir = $managedExternalData }
    $managedExternalResult = Invoke-LegacyRecovery `
      -InstallDirs @($managedExternalInstall) -UserDataDir $managedExternalUserData `
      -RecoveryRoot (Join-Path $testRoot 'managed external recovery') -ProcessName $ProcessName `
      -ActiveConfigDir $managedExternalData -ActiveConfigManaged '1' -SkipProcessCheck
    Assert-SelfTest -Condition ($null -eq $managedExternalResult) -Message 'matching app-managed external custom mode was not accepted'

    Set-Content -LiteralPath (Join-Path $managedExternalUserData 'app-mode.json') -Value '{broken-json' -NoNewline
    $managedExternalInvalidFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($managedExternalInstall) -UserDataDir $managedExternalUserData `
        -RecoveryRoot (Join-Path $testRoot 'managed external invalid recovery') -ProcessName $ProcessName `
        -ActiveConfigDir $managedExternalData -ActiveConfigManaged '1' -SkipProcessCheck | Out-Null
    } catch {
      $managedExternalInvalidFailed = $_.Exception.Message.Contains('cannot be read safely')
    }
    Assert-SelfTest -Condition $managedExternalInvalidFailed -Message 'invalid metadata bypassed app-managed external mode validation'

    $staleModeInstall = Join-Path $testRoot 'stale mode install'
    $staleModeActive = Join-Path $testRoot 'stale mode active data'
    $staleModeUserData = Join-Path $testRoot 'stale mode app data'
    New-Item -ItemType Directory -Path $staleModeInstall -Force | Out-Null
    New-Item -ItemType Directory -Path $staleModeActive -Force | Out-Null
    Write-TestMode -Dir $staleModeUserData -Value @{ mode = 'default'; portable_dir = $null }
    $staleModeResult = Invoke-LegacyRecovery `
      -InstallDirs @($staleModeInstall) -UserDataDir $staleModeUserData `
      -RecoveryRoot (Join-Path $testRoot 'stale mode recovery') -ProcessName $ProcessName `
      -ActiveConfigDir $staleModeActive -ActiveConfigManaged '1' -SkipProcessCheck
    Assert-SelfTest -Condition ($null -eq $staleModeResult) -Message 'stale persisted mode blocked an upgrade whose active data directory is outside every install directory'

    $mismatchInstall = Join-Path $testRoot 'mismatch mode install'
    $mismatchActive = Join-Path $testRoot 'mismatch active data'
    $mismatchPersisted = Join-Path $testRoot 'mismatch persisted data'
    $mismatchUserData = Join-Path $testRoot 'mismatch app data'
    New-Item -ItemType Directory -Path $mismatchInstall -Force | Out-Null
    New-Item -ItemType Directory -Path $mismatchActive -Force | Out-Null
    New-Item -ItemType Directory -Path $mismatchPersisted -Force | Out-Null
    Write-TestMode -Dir $mismatchUserData -Value @{ mode = 'portable'; portable_dir = $mismatchPersisted }
    $mismatchResult = Invoke-LegacyRecovery `
      -InstallDirs @($mismatchInstall) -UserDataDir $mismatchUserData `
      -RecoveryRoot (Join-Path $testRoot 'mismatch recovery') -ProcessName $ProcessName `
      -ActiveConfigDir $mismatchActive -ActiveConfigManaged '1' -SkipProcessCheck
    Assert-SelfTest -Condition ($null -eq $mismatchResult) -Message 'mismatched persisted custom mode blocked an upgrade whose active data directory is outside every install directory'

    $missingModeInstall = Join-Path $testRoot 'missing mode install'
    $missingModeLegacy = Join-Path $missingModeInstall 'CLAUDE_CONFIG_DIR'
    $missingModeActive = Join-Path $testRoot 'missing mode active data'
    New-Item -ItemType Directory -Path $missingModeLegacy -Force | Out-Null
    New-Item -ItemType Directory -Path $missingModeActive -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $missingModeLegacy 'settings.json') -Value 'missing-mode-data' -NoNewline
    $missingModeFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($missingModeInstall) -UserDataDir (Join-Path $testRoot 'missing mode app data') `
        -RecoveryRoot (Join-Path $testRoot 'missing mode recovery') -ProcessName $ProcessName `
        -ActiveConfigDir $missingModeActive -ActiveConfigManaged '1' -SkipProcessCheck | Out-Null
    } catch {
      $missingModeFailed = $_.Exception.Message.Contains('install-contained legacy data still exists')
    }
    Assert-SelfTest -Condition $missingModeFailed -Message 'missing persisted mode skipped the install-contained legacy data guard'

    $externalRoot = Join-Path $testRoot 'external selection with retained data'
    $externalInstall = Join-Path $externalRoot 'install'
    $externalLegacy = Join-Path $externalInstall 'CLAUDE_CONFIG_DIR'
    $externalUserData = Join-Path $externalRoot 'app data'
    $externalDir = Join-Path $externalRoot 'custom'
    New-Item -ItemType Directory -Path $externalLegacy -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $externalLegacy 'settings.json') -Value 'retained legacy data' -NoNewline
    New-Item -ItemType Directory -Path $externalDir -Force | Out-Null
    Write-TestMode -Dir $externalUserData -Value @{ mode = 'portable'; portable_dir = $externalDir }
    Assert-TestRecoveryRefused -Root $externalRoot -Arguments @{
      InstallDirs = @($externalInstall); UserDataDir = $externalUserData
      RecoveryRoot = Join-Path $externalRoot 'recovery'; ProcessName = $ProcessName
      ActiveConfigDir = ''; SkipProcessCheck = $true
    } -Message 'Current portable selection conflicts with retained legacy data'

    $secondInstall = Join-Path $testRoot 'second install'
    $secondLegacy = Join-Path $secondInstall 'CLAUDE_CONFIG_DIR'
    New-Item -ItemType Directory -Path $secondLegacy -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $secondLegacy 'settings.json') -Value 'second-source' -NoNewline
    Write-TestMode -Dir $secondLegacy -Value @{ mode = 'portable'; portable_dir = $null }
    $multipleFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($install, $secondInstall) -UserDataDir (Join-Path $testRoot 'multiple app data') `
        -RecoveryRoot (Join-Path $testRoot 'multiple recovery') -ProcessName $ProcessName `
        -ActiveConfigDir $legacy -ActiveConfigManaged '1' -SkipProcessCheck | Out-Null
    } catch {
      $multipleFailed = $_.Exception.Message.Contains('Multiple distinct legacy data sources')
    }
    Assert-SelfTest -Condition $multipleFailed -Message 'active environment hid an ambiguous dual-install source'

    $invalidInstall = Join-Path $testRoot 'invalid mode install'
    $invalidUserData = Join-Path $testRoot 'invalid mode app data'
    New-Item -ItemType Directory -Path $invalidInstall -Force | Out-Null
    New-Item -ItemType Directory -Path $invalidUserData -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $invalidUserData 'app-mode.json') -Value '{broken-json' -NoNewline
    $invalidFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($invalidInstall) -UserDataDir $invalidUserData `
        -RecoveryRoot (Join-Path $testRoot 'invalid recovery') -ProcessName $ProcessName `
        -ActiveConfigDir '' -SkipProcessCheck | Out-Null
    } catch {
      $invalidFailed = $_.Exception.Message.Contains('cannot be read safely')
    }
    Assert-SelfTest -Condition $invalidFailed -Message 'invalid existing mode metadata was treated as absent'

    $junctionInstall = Join-Path $testRoot 'junction install'
    $junctionTarget = Join-Path $testRoot 'junction external target'
    $junctionLegacy = Join-Path $junctionInstall 'CLAUDE_CONFIG_DIR'
    New-Item -ItemType Directory -Path $junctionInstall -Force | Out-Null
    New-Item -ItemType Directory -Path $junctionTarget -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $junctionTarget 'settings.json') -Value 'junction-data' -NoNewline
    New-Item -ItemType Junction -Path $junctionLegacy -Target $junctionTarget | Out-Null
    $junctionFailed = $false
    try {
      Invoke-LegacyRecovery `
        -InstallDirs @($junctionInstall) -SharedInstallDirs @($junctionInstall) `
        -UserDataDir (Join-Path $testRoot 'junction app data') `
        -RecoveryRoot (Join-Path $testRoot 'junction recovery') -ProcessName $ProcessName `
        -ActiveConfigDir '' -SkipProcessCheck | Out-Null
    } catch {
      $junctionFailed = $_.Exception.Message.Contains('reparse point')
    }
    Assert-SelfTest -Condition $junctionFailed -Message 'install-contained junction source was silently skipped'

    foreach ($profileKind in @('Local', 'Roaming')) {
      foreach ($shared in @($false, $true)) {
        $profileRoot = Join-Path $testRoot "profile-$profileKind-$shared"
        $profileInstall = Join-Path $profileRoot 'install'
        $profileSource = Join-Path $profileInstall "custom $unicodeName"
        $profileLocal = Join-Path $profileRoot 'Local'
        $profileRoaming = Join-Path $profileRoot 'Roaming'
        $selectedProfile = if ($profileKind -eq 'Local') { $profileLocal } else { $profileRoaming }
        New-Item -ItemType Directory -Path $profileSource -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $profileSource 'settings.json') -Value 'profile sentinel' -NoNewline
        Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $profileSource }
        Assert-SelfTest -Condition ([IO.File]::ReadAllBytes((Join-Path $selectedProfile 'app-mode.json'))[0] -eq 123) -Message 'mode fixture unexpectedly contains a BOM'
        Assert-SelfTest -Condition ((Read-AppMode -ConfigDir $selectedProfile).PortableDir -ceq $profileSource) -Message 'BOM-less Unicode mode pointer did not round-trip'
        $sharedProfiles = if ($shared) { @($profileInstall) } else { @() }
        $profileResult = Invoke-LegacyRecovery `
          -InstallDirs @($profileInstall) -SharedInstallDirs $sharedProfiles `
          -UserDataDir $profileRoaming -LocalUserDataDir $profileLocal `
          -RecoveryRoot (Join-Path $profileRoot 'recovery') -ProcessName $ProcessName `
          -ActiveConfigDir '' -SkipProcessCheck
        Assert-SelfTest -Condition ((Get-Content -LiteralPath (Join-Path $profileResult 'settings.json') -Raw) -eq 'profile sentinel') -Message 'Local/Roaming pointer was not recovered'
        Assert-SelfTest -Condition ((Get-Content -LiteralPath (Join-Path $profileSource 'settings.json') -Raw) -eq 'profile sentinel') -Message 'Local pointer recovery did not preserve its source'
        Assert-SelfTest -Condition ((Read-AppMode -ConfigDir $selectedProfile).PortableDir -eq $profileResult) -Message 'recovery wrote a pointer into the wrong profile'
      }
    }

    $conflictLocal = Join-Path $testRoot 'conflict Local'
    $conflictRoaming = Join-Path $testRoot 'conflict Roaming'
    Write-TestMode -Dir $conflictLocal -Value @{ mode = 'default'; portable_dir = $null }
    Write-TestMode -Dir $conflictRoaming -Value @{ mode = 'portable'; portable_dir = $managedLegacy }
    $conflictFailed = $false
    try {
      Resolve-UserDataDirectory -Current $conflictRoaming -Published $conflictLocal | Out-Null
    } catch {
      $conflictFailed = $_.Exception.Message.Contains('Both Windows data directories')
    }
    Assert-SelfTest -Condition $conflictFailed -Message 'dual profile roots did not fail closed'

    & {
      $caseRoot = Join-Path $testRoot 'unused-unc-roaming'
      $caseInstall = Join-Path $caseRoot 'install'
      $caseLocal = Join-Path $caseRoot 'Local'
      $unusedUnc = '\\unused.invalid\profile\EchoFlow Code'
      New-Item -ItemType Directory -Path $caseInstall -Force | Out-Null
      Write-TestMode -Dir $caseLocal -Value @{ mode = 'default'; portable_dir = $null }
      # Model an absent redirected profile without contacting a network share.
      function Test-Path {
        [CmdletBinding()]
        param([string]$LiteralPath, [string]$PathType)
        if ($LiteralPath -eq $unusedUnc) { return $false }
        return Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
      }
      $before = @(Get-TreeManifest -Root $caseRoot)
      $result = Invoke-LegacyRecovery -InstallDirs @($caseInstall) `
        -UserDataDir $unusedUnc -LocalUserDataDir $caseLocal `
        -RecoveryRoot (Join-Path $caseRoot 'recovery') -ProcessName $ProcessName -ActiveConfigDir '' -SkipProcessCheck
      Assert-SelfTest -Condition ($null -eq $result) -Message 'unused UNC Roaming prevented Local profile selection'
      Assert-TreeManifestsEqual -Expected $before -Actual @(Get-TreeManifest -Root $caseRoot) -Message 'unused UNC selection changed Local data'
    }

    foreach ($profileKind in @('Local', 'Roaming')) {
      foreach ($cacheName in @('logs', 'Cache', 'LOGS', 'cache')) {
        $caseRoot = Join-Path $testRoot "cache-case-$profileKind-$cacheName"
        # Use distinct fixture parents on case-insensitive Windows filesystems.
        $caseRoot += if ($cacheName -cin @('logs', 'Cache')) { '-known' } else { '-unknown' }
        $caseInstall = Join-Path $caseRoot 'install'
        $caseLocal = Join-Path $caseRoot 'Local'
        $caseRoaming = Join-Path $caseRoot 'Roaming'
        $selectedProfile = if ($profileKind -eq 'Local') { $caseLocal } else { $caseRoaming }
        $otherProfile = if ($profileKind -eq 'Local') { $caseRoaming } else { $caseLocal }
        New-Item -ItemType Directory -Path $caseInstall, (Join-Path $otherProfile $cacheName) -Force | Out-Null
        Write-TestMode -Dir $selectedProfile -Value @{ mode = 'default'; portable_dir = $null }
        $arguments = @{
          InstallDirs = @($caseInstall); UserDataDir = $caseRoaming; LocalUserDataDir = $caseLocal
          RecoveryRoot = Join-Path $caseRoot 'recovery'; ProcessName = $ProcessName
          ActiveConfigDir = ''; SkipProcessCheck = $true
        }
        if ($cacheName -cin @('logs', 'Cache')) {
          $before = @(Get-TreeManifest -Root $caseRoot)
          $result = Invoke-LegacyRecovery @arguments
          Assert-SelfTest -Condition ($null -eq $result) -Message 'known cache-only root blocked selection'
          Assert-TreeManifestsEqual -Expected $before -Actual @(Get-TreeManifest -Root $caseRoot) -Message 'cache-only root selection changed data'
        } else {
          try {
            Assert-TestRecoveryRefused -Root $caseRoot -Arguments $arguments -Message 'Both Windows data directories'
          } catch { throw "case-variant cache bypassed dual-root protection: $($_.Exception.Message)" }
        }
      }
    }

    $unavailableDrive = $null
    foreach ($codePoint in (90..68)) {
      $driveName = [string][char]$codePoint
      if (-not (Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue)) {
        $unavailableDrive = "$driveName`:\"
        break
      }
    }
    Assert-SelfTest -Condition ($null -ne $unavailableDrive) -Message 'no unmounted drive was available for historical journal fixtures'
    foreach ($profileKind in @('Local', 'Roaming')) {
      foreach ($stage in @('completed', 'failed', 'cancelled')) {
        foreach ($selection in (@('historical-selection', 'later-portable', 'later-default') + @('later-portable-without-history', 'later-default-without-mode', 'unavailable-historical-drive'))) {
          $caseRoot = Join-Path $testRoot "terminal-$profileKind-$stage-$selection"
          $caseInstall = Join-Path $caseRoot 'install'
          $oldSource = Join-Path $caseRoot 'historical source'
          $oldTarget = Join-Path $caseRoot 'historical target'
          if ($selection -eq 'unavailable-historical-drive') {
            $oldSource = [IO.Path]::Combine($unavailableDrive, 'historical source')
            $oldTarget = [IO.Path]::Combine($unavailableDrive, 'historical target')
          }
          $currentTarget = Join-Path $caseRoot 'later selection'
          $caseLocal = Join-Path $caseRoot 'Local'
          $caseRoaming = Join-Path $caseRoot 'Roaming'
          $selectedProfile = if ($profileKind -eq 'Local') { $caseLocal } else { $caseRoaming }
          $journal = New-TestMigrationJournal -Stage $stage -Source $oldSource -Target $oldTarget
          New-Item -ItemType Directory -Path $caseInstall, $selectedProfile -Force | Out-Null
          if ($selection -eq 'historical-selection') {
            New-Item -ItemType Directory -Path $oldSource -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $oldSource 'settings.json') -Value 'source must survive' -NoNewline
          }
          if ($selection -in @('historical-selection', 'later-portable')) {
            New-Item -ItemType Directory -Path $journal.stagingDir -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $journal.stagingDir 'keep') -Value 'historical staging is not installer-owned' -NoNewline
            # A terminal receipt must not revalidate old manifest hashes after normal app writes.
            Set-Content -LiteralPath (Join-Path $oldTarget 'settings.json') -Value 'edited after migration' -NoNewline
          } else {
            # These historical identities no longer name live directories after a later mode change.
            $journal.directories = @{
              source = @{ canonical = $oldSource; dev = '1'; ino = '2' }
              target = @{ canonical = $oldTarget; dev = '1'; ino = '3' }
            }
            $journal.stagingIdentity = @{ canonical = $journal.stagingDir; dev = '1'; ino = '4' }
          }
          if ($selection -like 'later-portable*' -or $selection -eq 'unavailable-historical-drive') {
            $journal.oldMode = $null
            New-Item -ItemType Directory -Path $currentTarget -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $currentTarget 'settings.json') -Value 'new selection' -NoNewline
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $currentTarget }
          } elseif ($selection -eq 'historical-selection' -and $stage -eq 'completed') {
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $oldTarget }
          } elseif ($selection -eq 'historical-selection') {
            [IO.File]::WriteAllText((Join-Path $selectedProfile 'app-mode.json'), $journal.oldMode)
          } elseif ($selection -ne 'later-default-without-mode') {
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'default'; portable_dir = $null; laterPreference = 'keep' }
          }
          if ($selection -eq 'later-default-without-mode') {
            $journal.manifest = @()
          }
          if ($selection -eq 'later-portable-without-history') {
            $journal.manifest += @(@{ relative = 'empty'; kind = 'directory' }, @{ relative = 'link'; kind = 'link'; link = 'old destination' })
            $sha = [Security.Cryptography.SHA256]::Create()
            try {
              $targetHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($oldTarget.Normalize())))).Replace('-', '').ToLowerInvariant().Substring(0, 8)
            } finally { $sha.Dispose() }
            $journal.credentials = @(@{ service = "Claude Code-credentials-$targetHash"; digest = ('b' * 64) })
            $journal.createdCredentials = $journal.credentials
          }
          $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $selectedProfile 'data-migration-v1.json') -Encoding UTF8
          if ($stage -eq 'completed' -and $selection -eq 'later-default-without-mode') {
            Assert-TestRecoveryRefused -Root $caseRoot -Arguments @{
              InstallDirs = @($caseInstall); UserDataDir = $caseRoaming; LocalUserDataDir = $caseLocal
              RecoveryRoot = Join-Path $caseRoot 'recovery'; ProcessName = $ProcessName
              ActiveConfigDir = ''; SkipProcessCheck = $true
            } -Message 'Migrated data startup configuration is unavailable'
            continue
          }
          $before = @(Get-TreeManifest -Root $caseRoot)
          $result = Invoke-LegacyRecovery -InstallDirs @($caseInstall) `
            -UserDataDir $caseRoaming -LocalUserDataDir $caseLocal `
            -RecoveryRoot (Join-Path $caseRoot 'recovery') -ProcessName $ProcessName -ActiveConfigDir '' -SkipProcessCheck
          Assert-SelfTest -Condition ($null -eq $result) -Message "terminal journal unnecessarily recovered external data ($caseRoot)"
          Assert-TreeManifestsEqual -Expected $before -Actual @(Get-TreeManifest -Root $caseRoot) -Message "terminal journal changed historical or current state ($caseRoot)"
        }

        foreach ($selection in @('default', 'missing', 'empty-portable')) {
          $caseRoot = Join-Path $testRoot "terminal-retained-default-$profileKind-$stage-$selection"
          $caseInstall = Join-Path $caseRoot 'install'
          $caseSource = Join-Path $caseInstall 'CLAUDE_CONFIG_DIR'
          $oldTarget = Join-Path $caseRoot 'old target'
          $caseLocal = Join-Path $caseRoot 'Local'
          $caseRoaming = Join-Path $caseRoot 'Roaming'
          $selectedProfile = if ($profileKind -eq 'Local') { $caseLocal } else { $caseRoaming }
          Write-TestMode -Dir $caseSource -Value @{ mode = 'portable'; portable_dir = $null }
          Set-Content -LiteralPath (Join-Path $caseSource 'settings.json') -Value 'retained legacy bytes' -NoNewline
          $journal = New-TestMigrationJournal -Stage $stage -Source $caseSource -Target $oldTarget
          New-Item -ItemType Directory -Path $selectedProfile, $journal.stagingDir -Force | Out-Null
          Set-Content -LiteralPath (Join-Path $selectedProfile 'settings.json') -Value 'current default data' -NoNewline
          Set-Content -LiteralPath (Join-Path $oldTarget 'settings.json') -Value 'historical target edited' -NoNewline
          Set-Content -LiteralPath (Join-Path $journal.stagingDir 'keep') -Value 'historical staging bytes' -NoNewline
          if ($selection -eq 'default') {
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'default'; portable_dir = $null; laterPreference = 'keep' }
          } elseif ($selection -eq 'empty-portable') {
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $null }
          }
          $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $selectedProfile 'data-migration-v1.json') -Encoding UTF8
          $expected = if ($stage -eq 'completed' -and $selection -ne 'default') {
            'Migrated data startup configuration'
          } else {
            'Current selection conflicts with retained legacy data after migration'
          }
          Assert-TestRecoveryRefused -Root $caseRoot -Arguments @{
            InstallDirs = @($caseInstall); UserDataDir = $caseRoaming; LocalUserDataDir = $caseLocal
            RecoveryRoot = Join-Path $caseRoot 'recovery'; ProcessName = $ProcessName
            ActiveConfigDir = ''; SkipProcessCheck = $true
          } -Message $expected
        }

        $caseRoot = Join-Path $testRoot "terminal-discovery-$profileKind-$stage"
        $caseInstall = Join-Path $caseRoot 'install'
        $caseSource = Join-Path $caseInstall 'custom data'
        $caseLocal = Join-Path $caseRoot 'Local'
        $caseRoaming = Join-Path $caseRoot 'Roaming'
        $selectedProfile = if ($profileKind -eq 'Local') { $caseLocal } else { $caseRoaming }
        New-Item -ItemType Directory -Path $caseSource -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $caseSource 'settings.json') -Value 'install-contained sentinel' -NoNewline
        Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $caseSource }
        $journalTarget = if ($stage -eq 'completed') { $caseSource } else { Join-Path $caseRoot 'old target' }
        $journal = New-TestMigrationJournal -Stage $stage -Source (Join-Path $caseRoot 'old source') -Target $journalTarget
        $journalFile = Join-Path $selectedProfile 'data-migration-v1.json'
        $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $journalFile -Encoding UTF8
        $journalHash = Get-FileSha256 -Path $journalFile
        $sourceBefore = @(Get-TreeManifest -Root $caseSource)
        $modeHash = Get-FileSha256 -Path (Join-Path $selectedProfile 'app-mode.json')
        $result = Invoke-LegacyRecovery -InstallDirs @($caseInstall) `
          -UserDataDir $caseRoaming -LocalUserDataDir $caseLocal `
          -RecoveryRoot (Join-Path $caseRoot 'recovery') -ProcessName $ProcessName -ActiveConfigDir '' -SkipProcessCheck
        Assert-SelfTest -Condition (-not [string]::IsNullOrWhiteSpace($result)) -Message 'terminal journal bypassed install-contained discovery'
        Assert-TreeManifestsEqual -Expected $sourceBefore -Actual @(Get-TreeManifest -Root $result) -Message 'terminal recovery did not copy current source bytes'
        Assert-TreeManifestsEqual -Expected $sourceBefore -Actual @(Get-TreeManifest -Root $caseSource) -Message 'terminal recovery changed its source'
        Assert-SelfTest -Condition ((Get-FileSha256 -Path $journalFile) -eq $journalHash) -Message 'terminal recovery rewrote its journal'
        Assert-SelfTest -Condition ((Read-AppMode -ConfigDir $selectedProfile).PortableDir -eq $result) -Message 'terminal recovery wrote the wrong current selection'
        $backups = @(Get-ChildItem -LiteralPath $selectedProfile -Filter 'app-mode.pre-recovery.*.bak')
        Assert-SelfTest -Condition ($backups.Count -eq 1 -and (Get-FileSha256 -Path $backups[0].FullName) -eq $modeHash) -Message 'terminal recovery did not preserve the previous mode'

        foreach ($guard in @('shared-install', 'external-active', 'dual-root', 'retained-source-current-selection', 'process-uncertainty')) {
          $caseRoot = Join-Path $testRoot "terminal-$guard-$profileKind-$stage"
          $caseInstall = Join-Path $caseRoot 'install'
          $caseSource = Join-Path $caseInstall 'CLAUDE_CONFIG_DIR'
          $caseTarget = Join-Path $caseRoot 'selected external data'
          $caseLocal = Join-Path $caseRoot 'Local'
          $caseRoaming = Join-Path $caseRoot 'Roaming'
          $selectedProfile = if ($profileKind -eq 'Local') { $caseLocal } else { $caseRoaming }
          $otherProfile = if ($profileKind -eq 'Local') { $caseRoaming } else { $caseLocal }
          New-Item -ItemType Directory -Path $caseSource, $caseTarget -Force | Out-Null
          Set-Content -LiteralPath (Join-Path $caseSource 'settings.json') -Value 'protected other-user source' -NoNewline
          Set-Content -LiteralPath (Join-Path $caseTarget 'settings.json') -Value 'current data' -NoNewline
          Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $caseTarget }
          $journal = New-TestMigrationJournal -Stage $stage -Source (Join-Path $caseRoot 'old source') -Target $caseTarget
          $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $selectedProfile 'data-migration-v1.json') -Encoding UTF8
          $arguments = @{
            InstallDirs = @($caseInstall); UserDataDir = $caseRoaming; LocalUserDataDir = $caseLocal
            RecoveryRoot = Join-Path $caseRoot 'recovery'; ProcessName = $ProcessName
            ActiveConfigDir = ''; SkipProcessCheck = $true
          }
          if ($guard -eq 'shared-install') {
            # The legacy default location is inactive; only the shared-tree scan can discover this custom directory.
            Move-Item -LiteralPath $caseSource -Destination (Join-Path $caseInstall 'another users data')
            $caseSource = Join-Path $caseInstall 'another users data'
            Write-TestMode -Dir $caseSource -Value @{ mode = 'portable'; portable_dir = $caseSource }
            $arguments.SharedInstallDirs = @($caseInstall)
            $expected = 'another Windows user'
            $guardMessage = 'terminal journal bypassed shared-install protection'
          } elseif ($guard -eq 'external-active') {
            Write-TestMode -Dir $caseSource -Value @{ mode = 'portable'; portable_dir = $caseSource }
            $arguments.ActiveConfigDir = $caseTarget
            $arguments.ActiveConfigManaged = '1'
            $expected = 'Current portable selection conflicts with retained legacy data'
            $guardMessage = 'terminal journal bypassed install-contained discovery'
          } elseif ($guard -eq 'retained-source-current-selection') {
            Write-TestMode -Dir $caseSource -Value @{ mode = 'portable'; portable_dir = $caseSource }
            $journal.status.sourceDir = $caseSource
            New-Item -ItemType Directory -Path $journal.stagingDir -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $journal.stagingDir 'keep') -Value 'historical staging must survive' -NoNewline
            $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $selectedProfile 'data-migration-v1.json') -Encoding UTF8
            Set-Content -LiteralPath (Join-Path $caseTarget 'settings.json') -Value 'current data edited after migration' -NoNewline
            $expected = 'Current portable selection conflicts with retained legacy data'
            $guardMessage = 'terminal journal overrode current selection with retained source'
          } elseif ($guard -eq 'process-uncertainty') {
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $caseSource }
            $arguments.SkipProcessCheck = $false
            $expected = 'Cannot verify whether the old application'
            $guardMessage = 'terminal journal bypassed process uncertainty protection'
          } else {
            Write-TestMode -Dir $otherProfile -Value @{ mode = 'default'; portable_dir = $null }
            # Conflict must win even over an invalid journal in either root.
            [IO.File]::WriteAllText((Join-Path $otherProfile 'data-migration-v1.json'), '{broken')
            $expected = 'Both Windows data directories'
            $guardMessage = 'terminal journal bypassed dual-root protection'
          }
          try {
            if ($guard -eq 'process-uncertainty') {
              & {
                function Get-CimInstance { throw 'fixture process query uncertainty' }
                Assert-TestRecoveryRefused -Root $caseRoot -Arguments $arguments -Message $expected
              }
            } else {
              Assert-TestRecoveryRefused -Root $caseRoot -Arguments $arguments -Message $expected
            }
          } catch { throw "$guardMessage`: $($_.Exception.Message)" }
        }
      }

      $pendingStages = @('preparing', 'quiescing', 'copying', 'verifying', 'committing', 'restarting')
      $invalidRecords = @(
        'broken-json', 'null-record', 'array-record', 'missing-version', 'unknown-version', 'string-version',
        'missing-status', 'stage-only', 'unknown-stage', 'uppercase-stage', 'unsafe-id', 'relative-source',
        'relative-target', 'overlapping-paths', 'wrong-staging', 'missing-old-mode', 'invalid-old-mode',
        'array-old-mode', 'missing-manifest', 'manifest-not-array', 'manifest-traversal', 'manifest-duplicate',
        'manifest-bad-digest', 'credentials-not-array', 'invalid-credentials', 'invalid-directory-identity',
        'invalid-staging-identity', 'unreadable-journal', 'missing-selected-target', 'missing-stage', 'missing-id',
        'missing-source', 'missing-target', 'missing-staging', 'missing-credentials', 'missing-created-credentials',
        'null-credentials', 'manifest-absolute', 'manifest-empty-segment', 'manifest-invalid-kind', 'manifest-missing-link',
        'null-directory-identities', 'overlapping-identities', 'null-staging-identity', 'invalid-credential-digest',
        'duplicate-credentials', 'directory-journal', 'case-mismatched-field', 'missing-selected-unicode-target',
        'completed-missing-mode', 'completed-directory-mode', 'completed-implicit-mode',
        'completed-empty-portable', 'completed-relative-portable', 'completed-uppercase-mode'
      )
      foreach ($scenario in @($pendingStages) + @($invalidRecords)) {
        $caseRoot = Join-Path $testRoot "journal-refusal-$profileKind-$scenario"
        $caseInstall = Join-Path $caseRoot 'install'
        $caseSource = Join-Path $caseInstall 'custom data'
        $caseTarget = Join-Path $caseRoot 'target'
        if ($scenario -eq 'missing-selected-unicode-target') {
          $caseTarget = Join-Path $caseRoot "missing-$unicodeName"
        }
        $caseLocal = Join-Path $caseRoot 'Local'
        $caseRoaming = Join-Path $caseRoot 'Roaming'
        $selectedProfile = if ($profileKind -eq 'Local') { $caseLocal } else { $caseRoaming }
        New-Item -ItemType Directory -Path $caseSource -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $caseSource 'settings.json') -Value 'source must survive refusal' -NoNewline
        Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $caseSource }
        $journal = New-TestMigrationJournal -Stage 'completed' -Source $caseSource -Target $caseTarget
        if ($scenario -notin @('missing-selected-target', 'missing-selected-unicode-target')) {
          New-Item -ItemType Directory -Path $journal.stagingDir -Force | Out-Null
          Set-Content -LiteralPath (Join-Path $journal.stagingDir 'keep') -Value 'staging must survive refusal' -NoNewline
        }
        if ($scenario -in $pendingStages) {
          $journal = New-TestMigrationJournal -Stage $scenario -Source $caseSource -Target $caseTarget
        }
        switch ($scenario) {
          'completed-missing-mode' { Remove-Item -LiteralPath (Join-Path $selectedProfile 'app-mode.json') }
          'completed-directory-mode' {
            Remove-Item -LiteralPath (Join-Path $selectedProfile 'app-mode.json')
            New-Item -ItemType Directory -Path (Join-Path $selectedProfile 'app-mode.json') | Out-Null
          }
          'completed-implicit-mode' { Write-TestMode -Dir $selectedProfile -Value @{ unknown = 'keep' } }
          'completed-empty-portable' { Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $null } }
          'completed-relative-portable' { Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = 'relative' } }
          'completed-uppercase-mode' { Write-TestMode -Dir $selectedProfile -Value @{ mode = 'DEFAULT'; portable_dir = $null } }
          'missing-version' { $journal.Remove('version') }
          'case-mismatched-field' { $journal.Remove('version'); $journal.Version = 1 }
          'missing-stage' { $journal.status.Remove('stage') }
          'missing-id' { $journal.status.Remove('id') }
          'missing-source' { $journal.status.Remove('sourceDir') }
          'missing-target' { $journal.status.Remove('targetDir') }
          'missing-staging' { $journal.Remove('stagingDir') }
          'missing-credentials' { $journal.Remove('credentials') }
          'missing-created-credentials' { $journal.Remove('createdCredentials') }
          'null-credentials' { $journal.credentials = $null }
          'manifest-absolute' { $journal.manifest[0].relative = $caseSource }
          'manifest-empty-segment' { $journal.manifest[0].relative = 'nested\\settings.json' }
          'manifest-invalid-kind' { $journal.manifest[0].kind = 'socket' }
          'manifest-missing-link' { $journal.manifest = @(@{ relative = 'link'; kind = 'link' }) }
          'null-directory-identities' { $journal.directories = $null }
          'overlapping-identities' {
            $journal.directories = @{
              source = @{ canonical = $caseSource; dev = '1'; ino = '2' }
              target = @{ canonical = (Join-Path $caseSource 'nested'); dev = '1'; ino = '3' }
            }
          }
          'null-staging-identity' { $journal.stagingIdentity = $null }
          { $_ -in @('invalid-credential-digest', 'duplicate-credentials') } {
            $sha = [Security.Cryptography.SHA256]::Create()
            try {
              $targetHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($caseTarget.Normalize())))).Replace('-', '').ToLowerInvariant().Substring(0, 8)
            } finally { $sha.Dispose() }
            $receipt = @{ service = "Claude Code-credentials-$targetHash"; digest = ('a' * 64) }
            $journal.credentials = @($receipt)
            if ($scenario -eq 'duplicate-credentials') { $journal.credentials += $receipt }
            else { $receipt.digest = 'invalid' }
          }
          'unknown-version' { $journal.version = 2 }
          'string-version' { $journal.version = '1' }
          'missing-status' { $journal.Remove('status') }
          'stage-only' { $journal = @{ version = 1; status = @{ stage = 'completed' } } }
          'unknown-stage' { $journal.status.stage = 'unknown' }
          'uppercase-stage' { $journal.status.stage = 'COMPLETED' }
          'unsafe-id' { $journal.status.id = '../escape' }
          'relative-source' { $journal.status.sourceDir = 'relative source' }
          'relative-target' { $journal.status.targetDir = 'relative target' }
          'overlapping-paths' {
            $journal.status.targetDir = Join-Path $caseSource 'nested'
            $journal.stagingDir = Join-Path $journal.status.targetDir '.cc-haha-migration-installer-fixture'
          }
          'wrong-staging' { $journal.stagingDir = $caseTarget }
          'missing-old-mode' { $journal.Remove('oldMode') }
          'invalid-old-mode' { $journal.oldMode = '{broken' }
          'array-old-mode' { $journal.oldMode = '[]' }
          'missing-manifest' { $journal.Remove('manifest') }
          'manifest-not-array' { $journal.manifest = @{} }
          'manifest-traversal' { $journal.manifest[0].relative = '..\settings.json' }
          'manifest-duplicate' { $journal.manifest += @{ relative = 'SETTINGS.JSON'; kind = 'file'; digest = ('a' * 64) } }
          'manifest-bad-digest' { $journal.manifest[0].digest = 'not a sha256' }
          'credentials-not-array' { $journal.credentials = @{} }
          'invalid-credentials' { $journal.createdCredentials = @(@{ service = 'Claude Code'; digest = ('a' * 64) }) }
          'invalid-directory-identity' { $journal.directories = @{ source = @{ canonical = $caseSource; dev = 1; ino = '2' } } }
          'invalid-staging-identity' { $journal.stagingIdentity = @{ canonical = 'relative'; dev = '1'; ino = '2' } }
          { $_ -in @('missing-selected-target', 'missing-selected-unicode-target') } {
            Write-TestMode -Dir $selectedProfile -Value @{ mode = 'portable'; portable_dir = $caseTarget }
          }
        }
        $journalText = $journal | ConvertTo-Json -Depth 12
        switch ($scenario) {
          'broken-json' { $journalText = '{broken' }
          'null-record' { $journalText = 'null' }
          'array-record' { $journalText = "[$journalText]" }
        }
        $journalFile = Join-Path $selectedProfile 'data-migration-v1.json'
        if ($scenario -eq 'directory-journal') { New-Item -ItemType Directory -Path $journalFile | Out-Null }
        else { [IO.File]::WriteAllText($journalFile, $journalText) }
        $arguments = @{
          InstallDirs = @($caseInstall); UserDataDir = $caseRoaming; LocalUserDataDir = $caseLocal
          RecoveryRoot = Join-Path $caseRoot 'recovery'; ProcessName = $ProcessName
          ActiveConfigDir = ''; SkipProcessCheck = $true
        }
        $lockedFile = if ($scenario -eq 'unreadable-journal') { $journalFile } else { '' }
        Assert-TestRecoveryRefused -Root $caseRoot -Arguments $arguments -Message 'Finish migration recovery' -LockedFile $lockedFile
      }
    }

    [Console]::Out.WriteLine('Legacy install data recovery self-test passed.')
  } finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  if ($SelfTest) {
    Run-SelfTest
    exit 0
  }

  $result = Invoke-LegacyRecovery `
    -InstallDirs @($PerUserInstallDir, $PerMachineInstallDir, $CandidateInstallDir) `
    -SharedInstallDirs @($PerMachineInstallDir) `
    -UserDataDir $UserDataDir `
    -LocalUserDataDir $LocalUserDataDir `
    -RecoveryRoot $RecoveryRoot `
    -ProcessName $ProcessName `
    -ActiveConfigDir $ActiveConfigDir `
    -ActiveConfigManaged $ActiveConfigManaged `
    -InstallerIdentitySafety $InstallerIdentitySafety `
    -SkipProcessCheck:$SkipProcessCheck
  if (-not [string]::IsNullOrWhiteSpace([string]$result)) {
    [Console]::Out.WriteLine("Recovered legacy data to $result")
  }
  exit 0
} catch {
  $message = ([string]$_.Exception.Message) -replace '[\r\n]+', ' '
  [Console]::Out.WriteLine("Legacy recovery error: $message")
  exit 20
}
