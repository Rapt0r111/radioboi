$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$pidFile = Join-Path $root ".omx\local-dev\pids.json"

function Get-ChildProcessIds([int]$ProcessId) {
  $ids = @()
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction Stop
    foreach ($child in @($children)) { $ids += [int]$child.ProcessId }
    return $ids
  } catch {
    try {
      $children = Get-WmiObject Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction Stop
      foreach ($child in @($children)) { $ids += [int]$child.ProcessId }
    } catch { }
  }
  return $ids
}

function Stop-ProcessTree([int]$ProcessId) {
  foreach ($childId in @(Get-ChildProcessIds -ProcessId $ProcessId)) {
    Stop-ProcessTree -ProcessId $childId
  }

  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (!(Test-Path $pidFile)) {
  Write-Host "No local Radioboi PID file found."
  exit 0
}

try {
  $state = Get-Content -Raw $pidFile | ConvertFrom-Json
  foreach ($pidValue in @($state.workerLauncherPid, $state.webLauncherPid)) {
    if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
      Stop-ProcessTree -ProcessId ([int]$pidValue)
      Write-Host "Stopped launcher PID $pidValue"
    }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Host "Radioboi local stack stopped."
} catch {
  Write-Warning "Could not stop local stack cleanly: $($_.Exception.Message)"
}
