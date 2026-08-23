@echo off
setlocal
cd /d "%~dp0"

REM Do NOT use "net session" for elevation checks: it fails with error 2114
REM when the Server (LanmanServer) service is stopped, even for true Admins.
REM allow-firewall.ps1 re-launches itself elevated via UAC when needed.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-firewall.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Firewall setup failed with code %EXIT_CODE%.
  echo If UAC was declined, right-click allow-firewall.bat -^> Run as administrator.
)
pause
exit /b %EXIT_CODE%
