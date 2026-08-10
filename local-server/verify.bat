@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0runtime\bun.exe" set "PATH=%~dp0runtime;%~dp0runtime\node;%PATH%"
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"

REM verify.bat              — structure + freshness only
REM verify.bat smoke        — also start/stop production smoke test

if /I "%~1"=="smoke" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify.ps1" -PackageDir "%~dp0." -StartSmoke
) else if exist "%~dp0OFFLINE_PACKAGE" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify.ps1" -PackageDir "%~dp0."
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify.ps1"
)

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Verify failed with code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)

echo Verify OK.
pause
exit /b 0
