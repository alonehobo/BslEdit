@echo off
setlocal

set SRC=%~dp0..

call "%~dp0msvc-env.bat"
if errorlevel 1 exit /b 1

set INCLUDE=%MSVC%\include;%WINSDK%\Include\%SDKVER%\ucrt;%WINSDK%\Include\%SDKVER%\um;%WINSDK%\Include\%SDKVER%\shared
set LIB=%MSVC%\lib\x64;%WINSDK%\Lib\%SDKVER%\ucrt\x64;%WINSDK%\Lib\%SDKVER%\um\x64
set PATH=%MSVC%\bin\Hostx64\x64;%PATH%

if not exist "%SRC%\objtest" mkdir "%SRC%\objtest"
cd /d "%SRC%\objtest"

cl.exe /nologo /O2 /MT /std:c++17 /EHsc /W3 /utf-8 /D_CRT_SECURE_NO_WARNINGS ^
  "%SRC%\tools\test_bslcommon.cpp" "%SRC%\bslcommon.cpp" ^
  /Fe:"%SRC%\objtest\test_bslcommon.exe" ^
  /link kernel32.lib
if errorlevel 1 (
    echo FAILED: test build
    exit /b 1
)

"%SRC%\objtest\test_bslcommon.exe"
exit /b %errorlevel%
