param(
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $packageRoot '..\..')).Path
$Output = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $repoRoot 'artifacts\1c-form-viewer-native-win-x64' } else { $Output }

Remove-Item -LiteralPath $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Output -Force | Out-Null
# Callers pass relative paths (the VS Code extension builds into ./mcp) and the
# compile below runs with $Output as the working directory, so anything derived
# from it has to be absolute first.
$Output = (Resolve-Path -LiteralPath $Output).Path
$app = Join-Path $Output 'app'
New-Item -ItemType Directory -Path $app -Force | Out-Null

Push-Location $packageRoot
try {
  npm run build:assets
  if ($LASTEXITCODE -ne 0) { throw 'Native web asset build failed.' }
}
finally {
  Pop-Location
}

# The preview interface is linked into the executable instead of travelling
# beside it, so the server can be copied to another machine on its own. The
# pack also stays in build\ for tools\verify-build-parity.mjs to read.
$assetPack = Join-Path $packageRoot 'build\assets.bin'
& node (Join-Path $repoRoot 'tools\pack-assets.mjs') (Join-Path $packageRoot 'build\web') $assetPack
if ($LASTEXITCODE -ne 0) { throw 'Packing the preview interface failed.' }
Copy-Item -LiteralPath (Join-Path $packageRoot 'README.md') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'LICENSE') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'native\NATIVE-README.md') -Destination (Join-Path $Output 'README.md')

. "$PSScriptRoot/msvc-env.ps1"
$cl = Initialize-MsvcEnvironment

# The native server's version comes from package.json and is force-included
# below so a release bumps a single file.
$version = (Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($version)) { throw 'package.json has no version.' }
$versionHeader = Join-Path $Output 'native-version.h'
Set-Content -LiteralPath $versionHeader -Encoding ASCII -Value "#define ONE_C_FORM_VIEWER_VERSION `"$version`""

# 201 is kEmbeddedAssetsResourceId in mcp-server.cpp; the .rc is generated so
# the only copy of the pack's path is the line that writes it.
$assetResource = Join-Path $Output 'assets.rc'
$assetBinary = Join-Path $Output 'assets.bin'
$assetCompiled = Join-Path $Output 'assets.res'
Copy-Item -LiteralPath $assetPack -Destination $assetBinary -Force
Set-Content -LiteralPath $assetResource -Encoding ASCII -Value '201 RCDATA "assets.bin"'
& $script:MsvcRc /nologo /fo $assetCompiled $assetResource
if ($LASTEXITCODE -ne 0) { throw 'Compiling the preview interface resource failed.' }

$source = Join-Path $packageRoot 'native\mcp-server.cpp'
# BSLEdit's git reader for open_preview base_revision, with the two text
# helpers it needs from bslcommon.cpp supplied by git-shim.cpp.
$gitSource = Join-Path $repoRoot 'gitquery.cpp'
$gitShim = Join-Path $packageRoot 'native\git-shim.cpp'
Push-Location $Output
try {
  & $cl /nologo /O2 /MT /std:c++17 /utf-8 /EHsc /W3 /DUNICODE /D_UNICODE /D_CRT_SECURE_NO_WARNINGS /FI"$versionHeader" $source $gitSource $gitShim /Fe:1c-form-viewer.exe /link /SUBSYSTEM:CONSOLE assets.res shell32.lib ws2_32.lib shlwapi.lib
  if ($LASTEXITCODE -ne 0) { throw 'Native MCP server build failed.' }
}
finally {
  # Also on a failed link, or the object file and the generated header stay
  # behind in the artifact directory and end up in the next package.
  Pop-Location
  Remove-Item -LiteralPath (Join-Path $Output 'mcp-server.obj'), (Join-Path $Output 'gitquery.obj'), (Join-Path $Output 'git-shim.obj') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $versionHeader -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $assetResource, $assetBinary, $assetCompiled -Force -ErrorAction SilentlyContinue
}

Write-Output $Output
