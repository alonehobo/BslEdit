param(
  [string]$ReleaseId = '',
  [switch]$SkipTests,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releasesRoot = Join-Path $repoRoot 'releases'
. (Join-Path $PSScriptRoot 'release-layout.ps1')

if ([string]::IsNullOrWhiteSpace($ReleaseId)) {
  $ReleaseId = 'local-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
}
if ($ReleaseId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
  throw 'ReleaseId may contain only letters, digits, dots, underscores and hyphens.'
}
if ($ReleaseId -ieq 'Last version') {
  throw 'ReleaseId "Last version" is reserved for the stable latest-build directory.'
}

$target = Join-Path $releasesRoot $ReleaseId
$replaceTarget = Test-Path -LiteralPath $target
if ($replaceTarget) {
  if (-not $Force) { throw "Release already exists: $target. Pass -Force to replace it." }
}

New-Item -ItemType Directory -Path $releasesRoot -Force | Out-Null
$staging = Join-Path $releasesRoot ('.staging-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  Write-Host "`n== $Description =="
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

function New-Zip([string]$SourceDirectory, [string]$Destination) {
  Compress-Archive -Path (Join-Path $SourceDirectory '*') -DestinationPath $Destination -CompressionLevel Optimal
}

try {
  Push-Location $repoRoot
  try {
    $nativeDirectory = Join-Path $staging '1c-form-viewer-native-win-x64'
    Invoke-Checked 'Native MCP build' {
      powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'packages\1c-form-viewer\scripts\build-native.ps1') -Output $nativeDirectory
    }

    if (-not $SkipTests) {
      $previousNativeMcpExe = $env:NATIVE_MCP_EXE
      $env:NATIVE_MCP_EXE = Join-Path $nativeDirectory '1c-form-viewer.exe'
      try {
        Invoke-Checked 'Tests' { npm test }
      }
      finally {
        $env:NATIVE_MCP_EXE = $previousNativeMcpExe
      }
      Invoke-Checked 'Native unit tests' { & (Join-Path $repoRoot 'tools\run-tests.bat') }
    }

    $previousSkipLatestMcp = $env:TC_BSL_VIEWER_SKIP_LATEST_MCP
    $env:TC_BSL_VIEWER_SKIP_LATEST_MCP = '1'
    try {
      Invoke-Checked 'BSLView and BSLEdit build' { & (Join-Path $repoRoot 'build.bat') }
    }
    finally {
      $env:TC_BSL_VIEWER_SKIP_LATEST_MCP = $previousSkipLatestMcp
    }

    $vscodeManifestPath = Join-Path $repoRoot 'packages\1c-form-viewer-vscode\package.json'
    $mcpManifestPath = Join-Path $repoRoot 'packages\1c-form-viewer\package.json'
    $vscodeVersion = (Get-Content -Raw -LiteralPath $vscodeManifestPath | ConvertFrom-Json).version
    $mcpVersion = (Get-Content -Raw -LiteralPath $mcpManifestPath | ConvertFrom-Json).version
    $vsixName = "1c-form-viewer-vscode-$vscodeVersion-win32-x64.vsix"
    $vsixPath = Join-Path $staging $vsixName

    Push-Location (Join-Path $repoRoot 'packages\1c-form-viewer-vscode')
    try {
      Invoke-Checked 'VS Code extension package' {
        npx --yes '@vscode/vsce' package --no-dependencies --target win32-x64 --out $vsixPath
      }
    }
    finally {
      Pop-Location
    }

    if (-not $SkipTests) {
      # A source-tree or staging binary can pass while VSIX packaging embeds a
      # stale executable. Extract the finished archive and run the same native
      # contract against the binary users will actually install.
      $vsixSmokeZip = Join-Path $staging '.vsix-smoke.zip'
      $vsixSmokeDirectory = Join-Path $staging '.vsix-smoke'
      Copy-Item -LiteralPath $vsixPath -Destination $vsixSmokeZip
      Expand-Archive -LiteralPath $vsixSmokeZip -DestinationPath $vsixSmokeDirectory
      $previousNativeMcpExe = $env:NATIVE_MCP_EXE
      $env:NATIVE_MCP_EXE = Join-Path $vsixSmokeDirectory 'extension\mcp\1c-form-viewer.exe'
      try {
        Invoke-Checked 'Packaged VSIX native MCP contract' {
          npx tsx --test packages/1c-form-viewer/tests/native-contract.test.ts
        }
      }
      finally {
        $env:NATIVE_MCP_EXE = $previousNativeMcpExe
        Remove-Item -LiteralPath $vsixSmokeZip, $vsixSmokeDirectory -Recurse -Force
      }
    }

    $pluginStage = Join-Path $staging '.stage-bslview'
    $editorStage = Join-Path $staging '.stage-bsledit'
    New-Item -ItemType Directory -Path $pluginStage, $editorStage | Out-Null
    foreach ($name in @('BSLView.wlx', 'BSLView.wlx64', 'BSLView.ini', 'pluginst.inf')) {
      Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $pluginStage
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'BSLEdit.exe') -Destination $editorStage
    # Both hosts load their interface from web\ next to the binary; without it
    # the plugin falls back to IE and BSLEdit refuses to start.
    foreach ($stage in @($pluginStage, $editorStage)) {
      Copy-Item -LiteralPath (Join-Path $repoRoot 'web') -Destination (Join-Path $stage 'web') -Recurse
      if (-not (Test-Path -LiteralPath (Join-Path $stage 'web\vs\loader.js'))) {
        throw "web\vs (Monaco) is missing; run build.bat first."
      }
    }

    New-Zip $pluginStage (Join-Path $staging 'BSLView.zip')
    New-Zip $editorStage (Join-Path $staging 'BSLEdit.zip')
    New-Zip $nativeDirectory (Join-Path $staging "1c-form-viewer-native-$mcpVersion-win-x64.zip")
    Remove-Item -LiteralPath $pluginStage, $editorStage, $nativeDirectory -Recurse -Force

    $gitCommit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the Git commit.' }
    $gitDirty = -not [string]::IsNullOrWhiteSpace((& git status --porcelain) -join '')
    $releaseFiles = Get-ChildItem -LiteralPath $staging -File | Sort-Object Name
    $manifest = [ordered]@{
      releaseId = $ReleaseId
      generatedAt = (Get-Date).ToUniversalTime().ToString('o')
      gitCommit = $gitCommit
      gitDirty = $gitDirty
      versions = [ordered]@{ vscode = $vscodeVersion; mcp = $mcpVersion }
      files = @($releaseFiles | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length } })
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding UTF8

    Get-ChildItem -LiteralPath $staging -File |
      Where-Object Name -ne 'SHA256SUMS.txt' |
      Sort-Object Name |
      ForEach-Object { '{0}  {1}' -f (Get-ReleaseSha256 $_.FullName), $_.Name } |
      Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding ASCII
  }
  finally {
    Pop-Location
  }

  if ($replaceTarget) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Move-Item -LiteralPath $staging -Destination $target
  $latestTarget = Publish-LatestReleaseSnapshot `
    -VersionedReleaseDirectory $target `
    -ReleasesRoot $releasesRoot `
    -ReleaseId $ReleaseId `
    -McpVersion $mcpVersion `
    -VscodeVersion $vscodeVersion `
    -GitCommit $gitCommit `
    -GitDirty $gitDirty `
    -GeneratedAt $manifest.generatedAt
  Set-Content -LiteralPath (Join-Path $releasesRoot 'LATEST.txt') -Encoding ASCII -Value $ReleaseId
  Write-Host "`nRelease ready: $target"
  Get-ChildItem -LiteralPath $target -File | Sort-Object Name | Format-Table Name, Length
  Write-Host "`nStable latest build: $latestTarget"
  Write-Host "Stable MCP executable: $(Join-Path $latestTarget 'MCP\1c-form-viewer.exe')"
}
catch {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
  throw
}
