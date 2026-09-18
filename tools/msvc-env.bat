@echo off
rem Detects a usable MSVC toolset + Windows 10 SDK and exports MSVC, WINSDK
rem and SDKVER for the caller. Call this with `call tools\msvc-env.bat`.
rem
rem Env overrides (skip autodetection when already set):
rem   MSVC    - full path to a VC\Tools\MSVC\<version> directory
rem   SDKVER  - a Windows 10 SDK version, e.g. 10.0.26100.0
rem   WINSDK  - root of the Windows Kits\10 install (default: standard path)
setlocal enabledelayedexpansion

if not defined WINSDK set "WINSDK=C:\Program Files (x86)\Windows Kits\10"

if defined MSVC if defined SDKVER (
    echo Using MSVC/SDKVER from environment: %MSVC% / %SDKVER%
    goto :export
)

rem --- Locate Visual Studio via vswhere ---
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
    echo FAILED: vswhere.exe not found at "%VSWHERE%" ^(Visual Studio Installer not present^)
    exit /b 1
)

set "VSINSTALL="
for /f "usebackq tokens=* delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "VSINSTALL=%%I"
)
if not defined VSINSTALL (
    echo FAILED: vswhere did not find a Visual Studio install with the VC.Tools.x86.x64 component
    exit /b 1
)

if not defined MSVC (
    set "VCVERFILE=%VSINSTALL%\VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt"
    if not exist "!VCVERFILE!" (
        echo FAILED: !VCVERFILE! not found
        exit /b 1
    )
    set "MSVCVER="
    for /f "usebackq delims=" %%V in ("!VCVERFILE!") do set "MSVCVER=%%V"
    if not defined MSVCVER (
        echo FAILED: could not read MSVC toolset version from !VCVERFILE!
        exit /b 1
    )
    set "MSVC=%VSINSTALL%\VC\Tools\MSVC\!MSVCVER!"
    if not exist "!MSVC!\include" (
        echo FAILED: MSVC toolset directory not found: !MSVC!
        exit /b 1
    )
)

:pick_sdk
if defined SDKVER goto :export

if not exist "%WINSDK%\Include" (
    echo FAILED: Windows Kits\10 not found at "%WINSDK%" ^(set WINSDK to override^)
    exit /b 1
)

set "BESTSDK="
for /f "delims=" %%D in ('dir /b /ad /o-n "%WINSDK%\Include\10.*" 2^>nul') do (
    if not defined BESTSDK (
        if exist "%WINSDK%\Include\%%D\um\windows.h" set "BESTSDK=%%D"
    )
)
if not defined BESTSDK (
    echo FAILED: no Windows 10 SDK with um\windows.h found under "%WINSDK%\Include"
    exit /b 1
)
set "SDKVER=%BESTSDK%"

:export
echo Using MSVC=%MSVC%
echo Using WINSDK=%WINSDK%
echo Using SDKVER=%SDKVER%

endlocal & (
    set "MSVC=%MSVC%"
    set "WINSDK=%WINSDK%"
    set "SDKVER=%SDKVER%"
)
exit /b 0
