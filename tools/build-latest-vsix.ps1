# Builds the VS Code extension into releases\Last version, next to the stable
# MCP, so one build.bat run leaves every host up to date.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$latestRoot = Join-Path $repoRoot 'releases\Last version'
$extensionDir = Join-Path $repoRoot 'packages\1c-form-viewer-vscode'
New-Item -ItemType Directory -Path $latestRoot -Force | Out-Null
$vsix = Join-Path $latestRoot '1c-form-viewer-vscode-win32-x64.vsix'
$staging = Join-Path $latestRoot ('.vsix-staging-' + [guid]::NewGuid().ToString('N') + '.vsix')

Push-Location $extensionDir
try {
  # vsce runs vscode:prepublish (npm run build): core sync + native MCP into ./mcp.
  & npx --yes '@vscode/vsce' package --no-dependencies --target win32-x64 --out $staging
  if ($LASTEXITCODE -ne 0) { throw "vsce package failed with exit code $LASTEXITCODE." }
}
finally {
  Pop-Location
}
Move-Item -LiteralPath $staging -Destination $vsix -Force
Write-Output $vsix
