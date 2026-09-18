<#
    Downloads the WebView2 SDK nupkg from nuget.org and unpacks it into
    webview2sdk\.

    The SDK is gitignored, so a fresh clone has no copy of it and build.bat
    used to stop with "WebView2 SDK not found". Only build\native is needed:
    the headers plus the static loader for x86 and x64.
#>
[CmdletBinding()]
param(
    [string] $Version = '1.0.4191.47',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot  = Split-Path -Parent $PSScriptRoot
$sdkDir    = Join-Path $repoRoot 'webview2sdk'
$nativeDir = Join-Path $sdkDir 'build\native'
$stampFile = Join-Path $sdkDir '.version'
$stamp     = "webview2=$Version"

# Files build.bat links against; an install missing any of them is unusable.
$required = @(
    (Join-Path $nativeDir 'include\WebView2.h'),
    (Join-Path $nativeDir 'x86\WebView2LoaderStatic.lib'),
    (Join-Path $nativeDir 'x64\WebView2LoaderStatic.lib')
)

function Test-Sdk { return -not ($required | Where-Object { -not (Test-Path -LiteralPath $_) }) }

if (-not $Force -and (Test-Sdk) -and (Test-Path $stampFile) -and
    ((Get-Content $stampFile -Raw).Trim() -eq $stamp)) {
    Write-Host "WebView2 SDK $Version already present in webview2sdk (use -Force to refresh)."
    exit 0
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("webview2-fetch-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

try {
    # Expand-Archive only accepts a .zip extension, so the package cannot be
    # unpacked under its own .nupkg name even though it is an ordinary zip.
    $zip = Join-Path $work 'webview2.zip'
    Write-Host "Downloading Microsoft.Web.WebView2@$Version ..."
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$Version" `
                      -OutFile $zip -UseBasicParsing

    Write-Host 'Extracting ...'
    $unpacked = Join-Path $work 'sdk'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force

    foreach ($item in $required) {
        $probe = Join-Path $unpacked ($item.Substring($sdkDir.Length).TrimStart('\'))
        if (-not (Test-Path -LiteralPath $probe)) {
            throw "The downloaded package is missing $probe"
        }
    }

    if (Test-Path $sdkDir) { Remove-Item $sdkDir -Recurse -Force }
    Move-Item -LiteralPath $unpacked -Destination $sdkDir

    Set-Content -Path $stampFile -Value $stamp -Encoding ASCII
    Write-Host "Done. WebView2 SDK $Version ready in webview2sdk\build\native"
}
finally {
    if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
