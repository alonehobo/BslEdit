function Get-ReleaseSha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Publish-LatestReleaseSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$VersionedReleaseDirectory,
    [Parameter(Mandatory = $true)][string]$ReleasesRoot,
    [Parameter(Mandatory = $true)][string]$ReleaseId,
    [Parameter(Mandatory = $true)][string]$McpVersion,
    [Parameter(Mandatory = $true)][string]$VscodeVersion,
    [Parameter(Mandatory = $true)][string]$GitCommit,
    [Parameter(Mandatory = $true)][bool]$GitDirty,
    [Parameter(Mandatory = $true)][string]$GeneratedAt
  )

  $latestTarget = Join-Path $ReleasesRoot 'Last version'
  $latestStaging = Join-Path $ReleasesRoot ('.latest-staging-' + [guid]::NewGuid().ToString('N'))
  $latestBackup = Join-Path $ReleasesRoot ('.latest-backup-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $latestStaging | Out-Null

  try {
    foreach ($name in @('BSLView.zip', 'BSLEdit.zip')) {
      Copy-Item -LiteralPath (Join-Path $VersionedReleaseDirectory $name) -Destination $latestStaging
    }

    $versionedMcpName = "1c-form-viewer-native-$McpVersion-win-x64.zip"
    $latestMcpArchive = Join-Path $latestStaging '1c-form-viewer-native-win-x64.zip'
    Copy-Item -LiteralPath (Join-Path $VersionedReleaseDirectory $versionedMcpName) -Destination $latestMcpArchive
    Expand-Archive -LiteralPath $latestMcpArchive -DestinationPath (Join-Path $latestStaging 'MCP')

    $versionedVsixName = "1c-form-viewer-vscode-$VscodeVersion-win32-x64.vsix"
    Copy-Item -LiteralPath (Join-Path $VersionedReleaseDirectory $versionedVsixName) `
      -Destination (Join-Path $latestStaging '1c-form-viewer-vscode-win32-x64.vsix')

    $latestFiles = Get-ChildItem -LiteralPath $latestStaging -File | Sort-Object Name
    $manifest = [ordered]@{
      channel = 'latest'
      sourceReleaseId = $ReleaseId
      generatedAt = $GeneratedAt
      gitCommit = $GitCommit
      gitDirty = $GitDirty
      versions = [ordered]@{ vscode = $VscodeVersion; mcp = $McpVersion }
      stableMcpExecutable = 'MCP/1c-form-viewer.exe'
      files = @($latestFiles | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length } })
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $latestStaging 'manifest.json') -Encoding UTF8

    Get-ChildItem -LiteralPath $latestStaging -File |
      Where-Object Name -ne 'SHA256SUMS.txt' |
      Sort-Object Name |
      ForEach-Object { '{0}  {1}' -f (Get-ReleaseSha256 $_.FullName), $_.Name } |
      Set-Content -LiteralPath (Join-Path $latestStaging 'SHA256SUMS.txt') -Encoding ASCII

    $hadPreviousLatest = Test-Path -LiteralPath $latestTarget
    if ($hadPreviousLatest) {
      Move-Item -LiteralPath $latestTarget -Destination $latestBackup
    }
    try {
      Move-Item -LiteralPath $latestStaging -Destination $latestTarget
    }
    catch {
      if ($hadPreviousLatest -and (Test-Path -LiteralPath $latestBackup)) {
        Move-Item -LiteralPath $latestBackup -Destination $latestTarget
      }
      throw
    }
    if (Test-Path -LiteralPath $latestBackup) {
      Remove-Item -LiteralPath $latestBackup -Recurse -Force
    }
  }
  catch {
    if (Test-Path -LiteralPath $latestStaging) {
      Remove-Item -LiteralPath $latestStaging -Recurse -Force
    }
    throw
  }

  return $latestTarget
}
