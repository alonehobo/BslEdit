$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releasesRoot = Join-Path $repoRoot 'releases'
$latestRoot = Join-Path $releasesRoot 'Last version'
$mcpTarget = Join-Path $latestRoot 'MCP'
$staging = Join-Path $releasesRoot ('.mcp-staging-' + [guid]::NewGuid().ToString('N'))
$versionStaging = $null

New-Item -ItemType Directory -Path $releasesRoot, $latestRoot -Force | Out-Null

# The repository is reachable under more than one spelling of the same path
# (a cloud-sync folder can be linked as both "Cloud.Disk" and "CloudDisk"), so running
# processes report an image path that differs from $repoRoot character by
# character. Compare paths with separators, case and dots normalised away.
function Get-ComparablePath([string]$Path) {
  return ($Path -replace '/', '\').TrimEnd('\').ToLowerInvariant() -replace '\.', ''
}

# A long-lived MCP server keeps its own executable open, which blocks the
# cleanup of the previous install. Stop anything still running out of the
# directory we are about to replace or delete.
function Stop-McpProcesses([string]$Directory) {
  $prefix = (Get-ComparablePath $Directory) + '\'
  $victims = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $imagePath = $null
      try { $imagePath = $_.Path } catch { }
      $imagePath -and (Get-ComparablePath $imagePath).StartsWith($prefix)
    })
  if ($victims.Count -eq 0) { return }

  foreach ($victim in $victims) {
    Write-Host "Stopping $($victim.ProcessName) (PID $($victim.Id)) holding $Directory"
    try { Stop-Process -Id $victim.Id -Force -ErrorAction Stop } catch { }
  }
  foreach ($victim in $victims) {
    try { $victim.WaitForExit(10000) | Out-Null } catch { }
  }
}

# Handles can linger briefly after the owning process exits (antivirus, the
# cloud-sync agent), so give the delete a few attempts before failing.
function Remove-DirectoryWithRetry([string]$Directory) {
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-Item -LiteralPath $Directory -Recurse -Force -ErrorAction Stop
      return
    }
    catch {
      if ($attempt -eq 5) { throw }
      Stop-McpProcesses $Directory
      Start-Sleep -Milliseconds (200 * $attempt)
    }
  }
}

function Install-McpDirectory([string]$PreparedDirectory, [string]$TargetDirectory) {
  $targetParent = Split-Path -Parent $TargetDirectory
  $targetName = Split-Path -Leaf $TargetDirectory
  $backup = Join-Path $targetParent ('.' + $targetName + '-backup-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null

  $hadPrevious = Test-Path -LiteralPath $TargetDirectory
  if ($hadPrevious) {
    Stop-McpProcesses $TargetDirectory
    Move-Item -LiteralPath $TargetDirectory -Destination $backup
  }
  try {
    Move-Item -LiteralPath $PreparedDirectory -Destination $TargetDirectory
  }
  catch {
    if ($hadPrevious -and (Test-Path -LiteralPath $backup)) {
      Move-Item -LiteralPath $backup -Destination $TargetDirectory
    }
    throw
  }
  if (Test-Path -LiteralPath $backup) {
    Remove-DirectoryWithRetry $backup
  }
}

# Sweep backups left behind by earlier runs that failed on a locked executable.
function Remove-StaleBackups([string]$TargetDirectory) {
  $targetParent = Split-Path -Parent $TargetDirectory
  $targetName = Split-Path -Leaf $TargetDirectory
  if (-not (Test-Path -LiteralPath $targetParent)) { return }
  Get-ChildItem -LiteralPath $targetParent -Directory -Force -Filter ('.' + $targetName + '-backup-*') |
    ForEach-Object {
      Stop-McpProcesses $_.FullName
      try { Remove-DirectoryWithRetry $_.FullName }
      catch { Write-Warning "Could not remove stale backup $($_.FullName): $($_.Exception.Message)" }
    }
}

try {
  & powershell -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $repoRoot 'packages\1c-form-viewer\scripts\build-native.ps1') `
    -Output $staging
  if ($LASTEXITCODE -ne 0) { throw "Native MCP build failed with exit code $LASTEXITCODE." }

  $manifestPath = Join-Path $repoRoot 'packages\1c-form-viewer\package.json'
  $version = (Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).version
  $gitCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
  $gitDirty = -not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain) -join '')
  [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    version = $version
    gitCommit = $gitCommit
    gitDirty = $gitDirty
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging 'build-info.json') -Encoding UTF8

  $versionStaging = Join-Path $releasesRoot ('.mcp-version-staging-' + [guid]::NewGuid().ToString('N'))
  Copy-Item -LiteralPath $staging -Destination $versionStaging -Recurse
  $versionTarget = Join-Path (Join-Path $releasesRoot 'Versions') $version
  Install-McpDirectory $versionStaging $versionTarget
  Install-McpDirectory $staging $mcpTarget
  Remove-StaleBackups $versionTarget
  Remove-StaleBackups $mcpTarget
}
catch {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
  if ($versionStaging -and (Test-Path -LiteralPath $versionStaging)) {
    Remove-Item -LiteralPath $versionStaging -Recurse -Force
  }
  throw
}

Write-Host "Stable MCP ready: $(Join-Path $mcpTarget '1c-form-viewer.exe')"
Write-Host "Versioned MCP copy: $(Join-Path $versionTarget '1c-form-viewer.exe')"
