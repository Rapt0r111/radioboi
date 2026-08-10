@echo off
setlocal
cd /d "%~dp0"

REM Requires Administrator. Right-click -> Run as administrator.
net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  echo This script must be run as Administrator.
  echo Right-click allow-firewall.bat -^> Run as administrator.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-firewall.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
