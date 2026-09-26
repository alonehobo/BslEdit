<#
.SYNOPSIS
  Installs and updates BSLEdit together with the 1c-form-viewer MCP server from
  the GitHub releases of alonehobo/BslEdit.

.DESCRIPTION
  The two ship as a pair: the MCP server renders a form by handing it to BSLEdit,
  which it finds through the `bsledit:` protocol registration rather than through
  PATH. Installing therefore means unpacking both and letting the editor claim the
  protocol once (`--ensure-protocol`).

  The layout is flat and version-less, so the path a user has to configure - the
  MCP command line above all - stays the same across updates:

    %LOCALAPPDATA%\Programs\BSLEdit\BSLEdit.exe
    %LOCALAPPDATA%\Programs\BSLEdit\MCP\1c-form-viewer.exe

  An update downloads into a staging directory and swaps it in, keeping the
  previous install as a backup until the swap succeeds. Going back to an older
  build is a re-run with -Tag.

  Usage:
    iwr -useb https://raw.githubusercontent.com/alonehobo/BslEdit/main/tools/install.ps1 | iex
    powershell -ExecutionPolicy Bypass -File install.ps1 -Update
    powershell -ExecutionPolicy Bypass -File install.ps1 -Tag v1.2.0
    powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  # Release tag to install; the latest release by default.
  [string]$Tag = '',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\BSLEdit'),
  # Install only when the newest release differs from the installed one.
  [switch]$Update,
  [switch]$Uninstall,
  # Leave the user PATH alone.
  [switch]$NoPath,
  # Do not let BSLEdit claim the bsledit: protocol. The MCP server then needs
  # --editor <path> to find the editor.
  [switch]$NoRegister
)

$ErrorActionPreference = 'Stop'
$repo = 'alonehobo/BslEdit'
$stateFile = Join-Path $InstallDir 'install-state.json'
$userAgent = @{ 'User-Agent' = '1c-form-viewer-installer' }

# Each entry: the release asset (version numbers in the name are wildcarded) and
# the path inside the install directory it is unpacked into. BSLEdit sits at the
# root because its web/ directory has to stay next to the executable.
$components = @(
  [pscustomobject]@{ AssetPattern = 'BSLEdit.zip'; Subdirectory = ''; Executable = 'BSLEdit.exe' }
  [pscustomobject]@{ AssetPattern = '1c-form-viewer-native-*win-x64.zip'; Subdirectory = 'MCP'; Executable = '1c-form-viewer.exe' }
)

function Write-Step([string]$Message) { Write-Host "==> $Message" }

function Get-ComparablePath([string]$Path) {
  if ([string]::IsNullOrEmpty($Path)) { return '' }
  return ($Path -replace '/', '\').TrimEnd('\').ToLowerInvariant()
}

# The checksum file lists the artefacts under their version-less names while the
# release assets carry the version in the file name, so both are compared on the
# stripped name.
function Remove-VersionFromName([string]$Name) {
  return ($Name -replace '-\d+\.\d+\.\d+(?=[-.])', '').ToLowerInvariant()
}

function Get-Release([string]$ReleaseTag) {
  $url = if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
    "https://api.github.com/repos/$repo/releases/latest"
  } else {
    "https://api.github.com/repos/$repo/releases/tags/$([uri]::EscapeDataString($ReleaseTag))"
  }
  $headers = $userAgent.Clone()
  $headers['Accept'] = 'application/vnd.github+json'
  if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
  try { return Invoke-RestMethod -Uri $url -Headers $headers -UseBasicParsing }
  catch { throw "Cannot read the releases of ${repo}: $($_.Exception.Message)" }
}

function Get-Asset($Release, [string]$Pattern) {
  $found = @($Release.assets | Where-Object { $_.name -like $Pattern })
  if ($found.Count -eq 0) { throw "Release $($Release.tag_name) has no asset matching $Pattern." }
  # Several matches mean several versions of the same artefact; take the newest.
  return ($found | Sort-Object name -Descending)[0]
}

function Get-ExpectedHashes($Release) {
  $asset = @($Release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' })
  if ($asset.Count -eq 0) { return $null }
  # Windows PowerShell hands back a byte array for a response it does not
  # recognise as text, PowerShell 7 a string; accept both.
  $content = (Invoke-WebRequest -Uri $asset[0].browser_download_url -UseBasicParsing -Headers $userAgent).Content
  $text = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { [string]$content }
  $map = @{}
  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$') {
      $map[(Remove-VersionFromName $Matches[2])] = $Matches[1].ToLowerInvariant()
    }
  }
  return $map
}

function Save-Asset($Asset, [string]$Destination, $ExpectedHashes) {
  Write-Step "Downloading $($Asset.name) ($([math]::Round($Asset.size / 1MB, 1)) MB)"
  Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Destination -UseBasicParsing -Headers $userAgent
  if ($null -eq $ExpectedHashes) { return }
  $key = Remove-VersionFromName $Asset.name
  if (-not $ExpectedHashes.ContainsKey($key)) {
    Write-Warning "SHA256SUMS.txt has no entry for $($Asset.name); the checksum is not checked."
    return
  }
  $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedHashes[$key]) {
    throw "Checksum mismatch for $($Asset.name): expected $($ExpectedHashes[$key]), got $actual."
  }
}

# A running MCP server or editor keeps its own executable open and would block
# the replacement of the directory it runs from.
function Stop-ProcessesUnder([string]$Directory) {
  $prefix = (Get-ComparablePath $Directory) + '\'
  $victims = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $imagePath = $null
      try { $imagePath = $_.Path } catch { }
      $imagePath -and (Get-ComparablePath $imagePath).StartsWith($prefix)
    })
  foreach ($victim in $victims) {
    Write-Step "Stopping $($victim.ProcessName) (PID $($victim.Id)) from the installed copy"
    try { Stop-Process -Id $victim.Id -Force -ErrorAction Stop } catch { }
    try { $victim.WaitForExit(10000) | Out-Null } catch { }
  }
}

# Handles can linger after the owning process exits (antivirus, a sync agent),
# so give the delete a few attempts before failing.
function Remove-DirectoryWithRetry([string]$Directory) {
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-Item -LiteralPath $Directory -Recurse -Force -ErrorAction Stop
      return
    }
    catch {
      if ($attempt -eq 5) { throw }
      Stop-ProcessesUnder $Directory
      Start-Sleep -Milliseconds (200 * $attempt)
    }
  }
}

function Set-UserPathEntry([string]$Directory, [switch]$Remove) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @()
  if ($current) { $parts = @($current -split ';' | Where-Object { $_ -ne '' }) }
  $normalized = $Directory.TrimEnd('\')
  $kept = @($parts | Where-Object { $_.TrimEnd('\') -ine $normalized })
  if ($Remove) {
    if ($kept.Count -eq $parts.Count) { return $false }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
    return $true
  }
  if ($kept.Count -ne $parts.Count) { return $false }
  [Environment]::SetEnvironmentVariable('Path', (@($parts + $normalized) -join ';'), 'User')
  return $true
}

function Get-InstalledTag {
  if (-not (Test-Path -LiteralPath $stateFile)) { return '' }
  try { return (Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json).tag }
  catch { return '' }
}

$editorPath = Join-Path $InstallDir 'BSLEdit.exe'
$serverPath = Join-Path $InstallDir 'MCP\1c-form-viewer.exe'

if ($Uninstall) {
  if (Test-Path -LiteralPath $editorPath) {
    Write-Step 'Releasing the bsledit: registration'
    try { & $editorPath --unregister | Out-Null } catch { Write-Warning $_.Exception.Message }
  }
  foreach ($directory in @($InstallDir, (Join-Path $InstallDir 'MCP'))) {
    if (Set-UserPathEntry $directory -Remove) { Write-Step "Removed from the user PATH: $directory" }
  }
  if (Test-Path -LiteralPath $InstallDir) {
    Stop-ProcessesUnder $InstallDir
    Remove-DirectoryWithRetry $InstallDir
  }
  Write-Host 'Uninstalled. Remove the server entry from the MCP client configuration by hand.'
  return
}

$release = Get-Release $Tag
$tagName = $release.tag_name

if ($Update -and (Get-InstalledTag) -eq $tagName -and (Test-Path -LiteralPath $editorPath)) {
  Write-Host "Already on the newest release: $tagName."
  return
}

$parent = Split-Path -Parent $InstallDir
$leaf = Split-Path -Leaf $InstallDir
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$staging = Join-Path $parent ('.' + $leaf + '-staging-' + [guid]::NewGuid().ToString('N'))
$backup = Join-Path $parent ('.' + $leaf + '-backup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
  $expectedHashes = Get-ExpectedHashes $release
  if ($null -eq $expectedHashes) { Write-Warning "Release $tagName publishes no SHA256SUMS.txt; the downloads are not verified." }

  foreach ($component in $components) {
    $asset = Get-Asset $release $component.AssetPattern
    $archive = Join-Path $parent $asset.name
    try {
      Save-Asset $asset $archive $expectedHashes
      $target = if ($component.Subdirectory) { Join-Path $staging $component.Subdirectory } else { $staging }
      Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
    }
    finally {
      if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $target $component.Executable))) {
      throw "$($asset.name) does not contain $($component.Executable)."
    }
  }
}
catch {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  throw
}

# Swap only once everything is downloaded, verified and unpacked: a failure
# above leaves the previous install untouched.
$hadPrevious = Test-Path -LiteralPath $InstallDir
if ($hadPrevious) {
  Stop-ProcessesUnder $InstallDir
  Move-Item -LiteralPath $InstallDir -Destination $backup
}
try {
  Move-Item -LiteralPath $staging -Destination $InstallDir
}
catch {
  if ($hadPrevious -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $InstallDir }
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  throw
}
if (Test-Path -LiteralPath $backup) {
  try { Remove-DirectoryWithRetry $backup }
  catch { Write-Warning "The previous install could not be removed: $backup" }
}

if ($NoRegister) {
  Write-Step 'Protocol registration skipped; pass --editor to the server so it can find the editor'
}
else {
  # This registration, not PATH, is what lets the server find the editor.
  Write-Step 'Registering the bsledit: protocol for the installed editor'
  & $editorPath --ensure-protocol | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "BSLEdit --ensure-protocol exited with code $LASTEXITCODE." }
}

if (-not $NoPath) {
  foreach ($directory in @($InstallDir, (Join-Path $InstallDir 'MCP'))) {
    if (Set-UserPathEntry $directory) { Write-Step "Added to the user PATH: $directory" }
  }
}

[ordered]@{
  tag = $tagName
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  editor = $editorPath
  server = $serverPath
} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

Write-Host ''
Write-Host "Installed $tagName"
Write-Host "  editor: $editorPath"
Write-Host "  server: $serverPath"
Write-Host ''
Write-Host 'Add this to the MCP client configuration (the path stays the same across updates):'
Write-Host ''
Write-Host (([ordered]@{ mcpServers = [ordered]@{ '1c-form-viewer' = [ordered]@{ command = $serverPath; args = @('--stdio') } } }) | ConvertTo-Json -Depth 5)
Write-Host ''
Write-Host 'Update later with:  powershell -ExecutionPolicy Bypass -File install.ps1 -Update'
Write-Host 'Go back to an older build with:  powershell -ExecutionPolicy Bypass -File install.ps1 -Tag <tag>'
