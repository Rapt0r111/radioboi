$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$pidFile = Join-Path $root ".omx\local-dev\pids.json"

if (!(Test-Path $pidFile)) {
  Write-Host "No local Radioboi PID file found."
  exit 0
}

try {
  $state = Get-Content -Raw $pidFile | ConvertFrom-Json
  foreach ($pidValue in @($state.workerLauncherPid, $state.webLauncherPid)) {
    if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped launcher PID $pidValue"
    }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Host "Radioboi local stack stopped."
} catch {
  Write-Warning "Could not stop local stack cleanly: $($_.Exception.Message)"
}
