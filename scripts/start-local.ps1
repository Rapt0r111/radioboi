param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$stateDir = Join-Path $root ".omx\local-dev"
$logDir = Join-Path $root ".omx\logs"
New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

$pidFile = Join-Path $stateDir "pids.json"
$workerLog = Join-Path $logDir "worker-dev.log"
$webLog = Join-Path $logDir "web-dev.log"

function Stop-ExistingFromPidFile {
  if (!(Test-Path $pidFile)) { return }
  try {
    $state = Get-Content -Raw $pidFile | ConvertFrom-Json
    foreach ($pidValue in @($state.workerLauncherPid, $state.webLauncherPid)) {
      if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Warning "Could not read previous PID file: $($_.Exception.Message)"
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

function Test-PortFree([int]$Port) {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -eq $listeners
}

Stop-ExistingFromPidFile

if (!(Test-PortFree $WorkerPort)) { throw "Port $WorkerPort is already in use. Stop the process or pass -WorkerPort." }
if (!(Test-PortFree $WebPort)) { throw "Port $WebPort is already in use. Stop the process or pass -WebPort." }

Remove-Item $workerLog, $webLog -ErrorAction SilentlyContinue

$workerDir = Join-Path $root "apps\worker"
$webDir = Join-Path $root "apps\web"
$wsUrl = "ws://127.0.0.1:$WorkerPort"

$workerCmd = "cd /d `"$workerDir`" && bun run dev -- --port $WorkerPort --ip 127.0.0.1 > `"$workerLog`" 2>&1"
$webCmd = "cd /d `"$webDir`" && set NEXT_PUBLIC_WS_URL=$wsUrl&& bun run dev -- --hostname 127.0.0.1 -p $WebPort > `"$webLog`" 2>&1"

$worker = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $workerCmd) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
$web = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $webCmd) -PassThru -WindowStyle Hidden

$state = [ordered]@{
  workerLauncherPid = $worker.Id
  webLauncherPid = $web.Id
  workerPort = $WorkerPort
  webPort = $WebPort
  wsUrl = $wsUrl
  webUrl = "http://127.0.0.1:$WebPort"
  workerLog = $workerLog
  webLog = $webLog
  startedAt = (Get-Date).ToString("o")
}
$state | ConvertTo-Json | Set-Content -Encoding UTF8 $pidFile

Write-Host "Radioboi local stack started."
Write-Host "Web:    http://127.0.0.1:$WebPort"
Write-Host "Worker: http://127.0.0.1:$WorkerPort"
Write-Host "WS:     $wsUrl"
Write-Host "Logs:"
Write-Host "  $workerLog"
Write-Host "  $webLog"
Write-Host "Stop: bun run stop:local"
