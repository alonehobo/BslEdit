$ErrorActionPreference = 'Stop'
# Frees the binaries build.bat is about to link. BSLEdit windows started from
# this checkout (MCP previews included) are closed; a plugin loaded by Total
# Commander is renamed aside instead, which Windows allows for a loaded DLL,
# so TC keeps running on the old copy until it is restarted.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# The checkout is reachable as both "Yandex.Disk" and "YandexDisk".
function Get-ComparablePath([string]$Path) {
  return ($Path -replace '/', '\').TrimEnd('\').ToLowerInvariant() -replace '\.', ''
}

$editor = Get-ComparablePath (Join-Path $repoRoot 'BSLEdit.exe')
$victims = @(Get-Process -Name BSLEdit -ErrorAction SilentlyContinue | Where-Object {
  $imagePath = $null
  try { $imagePath = $_.Path } catch { }
  $imagePath -and (Get-ComparablePath $imagePath) -eq $editor
})
foreach ($victim in $victims) {
  Write-Host "Stopping BSLEdit (PID $($victim.Id))"
  try { Stop-Process -Id $victim.Id -Force -ErrorAction Stop } catch { }
}
foreach ($victim in $victims) { try { $victim.WaitForExit(10000) | Out-Null } catch { } }

foreach ($name in 'BSLView.wlx', 'BSLView.wlx64', 'BSLEdit.exe') {
  $path = Join-Path $repoRoot $name
  # Copies set aside by earlier builds go once nothing holds them.
  Get-ChildItem -LiteralPath $repoRoot -Filter "$name.old-*" -File -ErrorAction SilentlyContinue |
    ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch { } }
  if (-not (Test-Path -LiteralPath $path)) { continue }
  try {
    $stream = [System.IO.File]::Open($path, 'Open', 'ReadWrite', 'None')
    $stream.Close()
  }
  catch {
    $aside = "$name.old-" + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Write-Host "$name is in use, moving it aside as $aside"
    Rename-Item -LiteralPath $path -NewName $aside
  }
}
