@echo off
rem Started by double-click the window would vanish with the error; run the
rem build in a child and keep the window open when it fails.
setlocal
if not "%TC_BSL_BUILD_INNER%"=="1" (
    set TC_BSL_BUILD_INNER=1
    cmd /c ""%~f0" %*"
    if errorlevel 1 (echo.& echo Build failed, see the messages above.& pause& exit /b 1)
    exit /b 0
)
setlocal enabledelayedexpansion

rem Build from wherever the repository actually lives.
set SRC=%~dp0
if "%SRC:~-1%"=="\" set SRC=%SRC:~0,-1%

call "%SRC%\tools\msvc-env.bat"
if errorlevel 1 exit /b 1

if not defined WV2SDK set "WV2SDK=%SRC%\webview2sdk\build\native"
set INCLUDE=%MSVC%\include;%MSVC%\atlmfc\include;%WINSDK%\Include\%SDKVER%\ucrt;%WINSDK%\Include\%SDKVER%\um;%WINSDK%\Include\%SDKVER%\shared;%WINSDK%\Include\%SDKVER%\winrt;%WV2SDK%\include
set LIBS=ole32.lib oleaut32.lib uuid.lib shlwapi.lib shell32.lib comdlg32.lib user32.lib kernel32.lib advapi32.lib gdi32.lib crypt32.lib
set CFLAGS=/nologo /O2 /MT /std:c++17 /EHsc /W3 /wd4584 /utf-8 /D_CRT_SECURE_NO_WARNINGS /DNDEBUG /DWIN32 /D_WINDOWS
set PLUGIN_SRC="%SRC%\main.cpp" "%SRC%\bslcommon.cpp" "%SRC%\browserhost.cpp" "%SRC%\bslhighlight.cpp" "%SRC%\webview2host.cpp" "%SRC%\epfunpack.cpp" "%SRC%\gitquery.cpp"

if not exist "%WV2SDK%\include\WebView2.h" (
    echo WebView2 SDK missing, fetching...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\tools\fetch-webview2.ps1"
    if errorlevel 1 (
        echo FAILED: could not fetch the WebView2 SDK
        exit /b 1
    )
)
if not exist "%WV2SDK%\include\WebView2.h" (
    echo FAILED: WebView2 SDK not found at %WV2SDK%
    exit /b 1
)

rem web\ carries generated copies of packages\1c-preview-core, which are not in
rem git. Sync them on every build: a copy left over from an older core makes
rem BSLView/BSLEdit render differently from the MCP server and the VSIX.
echo Syncing shared preview assets from packages\1c-preview-core...
call node "%SRC%\packages\1c-preview-core\scripts\sync.mjs"
if errorlevel 1 (
    echo FAILED: could not sync packages\1c-preview-core ^(is Node.js installed?^)
    exit /b 1
)

if not exist "%SRC%\web\vs\loader.js" (
    echo Monaco assets missing, fetching...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\tools\fetch-monaco.ps1"
    if errorlevel 1 (
        echo FAILED: could not fetch Monaco
        exit /b 1
    )
)

for %%D in (obj32 obj64 objexe objgen) do if not exist "%SRC%\%%D" mkdir "%SRC%\%%D"

rem The whole interface is linked into each binary, so a release is the .wlx
rem and the .exe alone. Both still prefer a web\ directory beside them, which
rem is what keeps editing web\ in this working copy free of a rebuild.
echo Packing web\ into objgen\web-assets.bin...
call node "%SRC%\tools\pack-assets.mjs" "%SRC%\web" "%SRC%\objgen\web-assets.bin"
if errorlevel 1 (
    echo FAILED: could not pack web\
    exit /b 1
)

cd /d "%SRC%"
rem One .res for all three binaries: a resource file is machine neutral, so
rem the 32-bit plugin links the same one as the 64-bit editor.
"%WINSDK%\bin\%SDKVER%\x64\rc.exe" /nologo /fo "%SRC%\objgen\app.res" "%SRC%\app.rc"
if errorlevel 1 (
    echo FAILED: icon and interface resources
    exit /b 1
)

rem A running BSLEdit or a plugin loaded by Total Commander locks the binaries
rem and the link fails; free them first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\tools\release-build-locks.ps1"
if errorlevel 1 (
    echo FAILED: could not free BSLEdit.exe / BSLView.wlx
    exit /b 1
)

set FAILED=0

echo ========================================
echo Building 32-bit BSLView.wlx
echo ========================================
set PATH=%MSVC%\bin\Hostx64\x86;%PATH%
set LIB=%MSVC%\lib\x86;%MSVC%\atlmfc\lib\x86;%WINSDK%\Lib\%SDKVER%\ucrt\x86;%WINSDK%\Lib\%SDKVER%\um\x86
cd /d "%SRC%\obj32"
cl.exe %CFLAGS% /D_USRDLL %PLUGIN_SRC% ^
  /Fe:"%SRC%\BSLView.wlx" ^
  /link /DLL /DEF:"%SRC%\exports.def" /IMPLIB:"%SRC%\obj32\BSLView.lib" "%SRC%\objgen\app.res" %LIBS% "%WV2SDK%\x86\WebView2LoaderStatic.lib"
if errorlevel 1 (set FAILED=1& echo FAILED: 32-bit build) else (echo SUCCESS: BSLView.wlx)

echo.
echo ========================================
echo Building 64-bit BSLView.wlx64
echo ========================================
set PATH=%MSVC%\bin\Hostx64\x64;%PATH%
set LIB=%MSVC%\lib\x64;%MSVC%\atlmfc\lib\x64;%WINSDK%\Lib\%SDKVER%\ucrt\x64;%WINSDK%\Lib\%SDKVER%\um\x64
cd /d "%SRC%\obj64"
cl.exe %CFLAGS% /D_USRDLL %PLUGIN_SRC% ^
  /Fe:"%SRC%\BSLView.wlx64" ^
  /link /DLL /DEF:"%SRC%\exports.def" /IMPLIB:"%SRC%\obj64\BSLView.lib" "%SRC%\objgen\app.res" %LIBS% "%WV2SDK%\x64\WebView2LoaderStatic.lib"
if errorlevel 1 (set FAILED=1& echo FAILED: 64-bit build) else (echo SUCCESS: BSLView.wlx64)

echo.
echo ========================================
echo Building 64-bit BSLEdit.exe
echo ========================================
cd /d "%SRC%\objexe"
cl.exe %CFLAGS% "%SRC%\bsledit.cpp" "%SRC%\bslcommon.cpp" "%SRC%\webview2host.cpp" "%SRC%\epfunpack.cpp" "%SRC%\gitquery.cpp" ^
  /Fe:"%SRC%\BSLEdit.exe" ^
  /link "%SRC%\objgen\app.res" %LIBS% "%WV2SDK%\x64\WebView2LoaderStatic.lib" /SUBSYSTEM:WINDOWS
if errorlevel 1 (set FAILED=1& echo FAILED: BSLEdit.exe build) else (echo SUCCESS: BSLEdit.exe)

cd /d "%SRC%"
echo.
if "%FAILED%"=="1" (echo Done with errors.& exit /b 1)
if not "%TC_BSL_VIEWER_SKIP_LATEST_MCP%"=="1" (
    echo.
    echo ========================================
    echo Building native MCP into stable directory
    echo ========================================
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\tools\build-latest-mcp.ps1"
    if errorlevel 1 (
        echo FAILED: native MCP stable build
        exit /b 1
    )
    echo.
    echo ========================================
    echo Building VS Code extension ^(VSIX^)
    echo ========================================
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\tools\build-latest-vsix.ps1"
    if errorlevel 1 (
        echo FAILED: VSIX build
        exit /b 1
    )
    echo.
    echo ========================================
    echo Checking that all builds share one preview core
    echo ========================================
    call node "%SRC%\tools\verify-build-parity.mjs"
    if errorlevel 1 (
        echo FAILED: builds differ from packages\1c-preview-core
        exit /b 1
    )
)
echo Done.
