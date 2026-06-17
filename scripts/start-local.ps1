param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [switch]$Lan,
  [string]$PublicHost = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$stateDir = Join-Path $root ".omx\local-dev"
$logDir = Join-Path $root ".omx\logs"
New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

$pidFile = Join-Path $stateDir "pids.json"
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workerLog = Join-Path $logDir "worker-dev-$runStamp.log"
$webLog = Join-Path $logDir "web-dev-$runStamp.log"

function Stop-ProcessTree([int]$ProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in @($children)) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }

  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-ExistingFromPidFile {
  if (!(Test-Path $pidFile)) { return }
  try {
    $state = Get-Content -Raw $pidFile | ConvertFrom-Json
    foreach ($pidValue in @($state.workerLauncherPid, $state.webLauncherPid)) {
      if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
        Stop-ProcessTree -ProcessId ([int]$pidValue)
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

function Get-LogTail([string]$Path) {
  if (!(Test-Path $Path)) { return "<log file was not created>" }
  return (Get-Content $Path -Tail 40) -join [Environment]::NewLine
}

function Get-LocalLanAddress {
  $candidate = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.IPAddress -ne "0.0.0.0" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object -Property SkipAsSource, InterfaceIndex |
    Select-Object -First 1

  if ($null -eq $candidate) {
    throw "Could not auto-detect a LAN IPv4 address. Pass -PublicHost, for example -PublicHost 192.168.206.1."
  }

  return $candidate.IPAddress
}

Stop-ExistingFromPidFile

if (!(Test-PortFree $WorkerPort)) { throw "Port $WorkerPort is already in use. Stop the process or pass -WorkerPort." }
if (!(Test-PortFree $WebPort)) { throw "Port $WebPort is already in use. Stop the process or pass -WebPort." }

$workerDir = Join-Path $root "apps\worker"
$webDir = Join-Path $root "apps\web"
$bindHost = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$publicHostValue = if ($PublicHost.Trim().Length -gt 0) {
  $PublicHost.Trim()
} elseif ($Lan) {
  Get-LocalLanAddress
} else {
  "127.0.0.1"
}
$wsUrl = "ws://${publicHostValue}:$WorkerPort"

$workerCmd = "cd /d `"$workerDir`" && bun run dev -- --port $WorkerPort --ip $bindHost > `"$workerLog`" 2>&1"
$webCmd = "cd /d `"$webDir`" && set NEXT_PUBLIC_WS_URL=$wsUrl&& bun run dev -- --hostname $bindHost -p $WebPort > `"$webLog`" 2>&1"

$worker = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $workerCmd) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4

if (!(Get-Process -Id $worker.Id -ErrorAction SilentlyContinue)) {
  throw "Worker dev server exited before the web app started.$([Environment]::NewLine)$(Get-LogTail $workerLog)"
}

if (Test-PortFree $WorkerPort) {
  throw "Worker dev server did not start listening on port $WorkerPort.$([Environment]::NewLine)$(Get-LogTail $workerLog)"
}

$web = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $webCmd) -PassThru -WindowStyle Hidden

$state = [ordered]@{
  workerLauncherPid = $worker.Id
  webLauncherPid = $web.Id
  workerPort = $WorkerPort
  webPort = $WebPort
  bindHost = $bindHost
  publicHost = $publicHostValue
  wsUrl = $wsUrl
  webUrl = "http://${publicHostValue}:$WebPort"
  workerLog = $workerLog
  webLog = $webLog
  startedAt = (Get-Date).ToString("o")
}
$state | ConvertTo-Json | Set-Content -Encoding UTF8 $pidFile

Write-Host "Radioboi local stack started."
Write-Host "Web:    http://${publicHostValue}:$WebPort"
Write-Host "Worker: http://${publicHostValue}:$WorkerPort"
Write-Host "WS:     $wsUrl"
Write-Host "Bind:   $bindHost"
Write-Host "Logs:"
Write-Host "  $workerLog"
Write-Host "  $webLog"
Write-Host "Stop: bun run stop:local"
