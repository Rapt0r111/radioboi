@echo off
setlocal
cd /d "%~dp0"

REM Portable LAN start (works for monorepo local-server\ and offline package).
REM Optional: start.bat [WebPort] [WorkerPort] [PreferredHost]

set "WEB_PORT=%~1"
set "WORKER_PORT=%~2"
set "PUBLIC_HOST=%~3"

if "%WEB_PORT%"=="" set "WEB_PORT=3000"
if "%WORKER_PORT%"=="" set "WORKER_PORT=8787"

REM Prefer bundled runtimes when present (offline package).
REM Node 18 first so Windows 8.1 never picks a host Node 20+/Bun.
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
if exist "%~dp0runtime\bun.exe" set "PATH=%~dp0runtime;%~dp0runtime\node;%PATH%"

echo.
echo === Radioboi LAN server ===
echo Web port:    %WEB_PORT%
echo Worker port: %WORKER_PORT%
if not "%PUBLIC_HOST%"=="" echo Preferred host: %PUBLIC_HOST%
echo.

if "%PUBLIC_HOST%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -WebPort %WEB_PORT% -WorkerPort %WORKER_PORT%
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -WebPort %WEB_PORT% -WorkerPort %WORKER_PORT% -PublicHost "%PUBLIC_HOST%"
)

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Start failed with code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)

echo Stack is running in the background.
echo Run stop.bat to stop the server.
pause
exit /b 0
