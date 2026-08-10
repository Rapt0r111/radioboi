@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0runtime\bun.exe" set "PATH=%~dp0runtime;%~dp0runtime\node;%PATH%"
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
