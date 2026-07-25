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

function Wait-ForPort([int]$Port, [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (!(Test-PortFree $Port)) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Get-LogTail([string]$Path) {
  if (!(Test-Path $Path)) { return "<log file was not created>" }
  return (Get-Content $Path -Tail 40) -join [Environment]::NewLine
}

function Get-LocalLanAddress {
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.IPAddress -ne "0.0.0.0" -and
      $_.AddressState -eq "Preferred" -and
      $_.PrefixOrigin -ne "WellKnown"
    })

  if ($addresses.Count -eq 0) {
    throw "Could not auto-detect a preferred LAN IPv4 address. Pass -PublicHost, for example -PublicHost 192.168.206.1."
  }

  # Prefer the interface carrying the active default route. This avoids using
  # disconnected, tentative, VPN, or virtual-adapter addresses when several
  # 192.168.*.* interfaces exist on the machine.
  $defaultRoutes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne "0.0.0.0" } |
    Sort-Object -Property RouteMetric, InterfaceMetric)

  foreach ($route in $defaultRoutes) {
    $candidate = $addresses |
      Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } |
      Select-Object -First 1
    if ($null -ne $candidate) { return $candidate.IPAddress }
  }

  # Hotspot and isolated LAN adapters may have no default route. Prefer an
  # explicitly connected interface before falling back to interface order.
  $connectedInterfaces = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.ConnectionState -eq "Connected" } |
    Sort-Object -Property InterfaceMetric, InterfaceIndex)

  foreach ($interface in $connectedInterfaces) {
    $candidate = $addresses |
      Where-Object { $_.InterfaceIndex -eq $interface.InterfaceIndex } |
      Select-Object -First 1
    if ($null -ne $candidate) { return $candidate.IPAddress }
  }

  $candidate = $addresses | Sort-Object -Property SkipAsSource, InterfaceIndex | Select-Object -First 1

  if ($null -eq $candidate) {
    throw "Could not auto-detect a LAN IPv4 address. Pass -PublicHost, for example -PublicHost 192.168.206.1."
  }

  return $candidate.IPAddress
}

function Warn-IfLanFirewallRulesMissing([int[]]$Ports) {
  $missingPorts = @()
  foreach ($port in $Ports) {
    $rule = Get-NetFirewallRule -DisplayName "Radioboi LAN TCP $port" -ErrorAction SilentlyContinue |
      Where-Object { $_.Enabled -eq "True" -and $_.Action -eq "Allow" }
    if ($null -eq $rule) { $missingPorts += $port }
  }

  if ($missingPorts.Count -gt 0) {
    Write-Warning "Windows Firewall may block LAN clients on TCP $($missingPorts -join ', '). Run 'powershell -ExecutionPolicy Bypass -File scripts/allow-lan-firewall.ps1 -WebPort $WebPort -WorkerPort $WorkerPort' from an elevated PowerShell window."
  }
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

if ($Lan) {
  Warn-IfLanFirewallRulesMissing @($WebPort, $WorkerPort)
}

$workerCmd = "cd /d `"$workerDir`" && bun run dev -- --port $WorkerPort --ip $bindHost > `"$workerLog`" 2>&1"
$webCmd = "cd /d `"$webDir`" && set `"NEXT_PUBLIC_WS_URL=$wsUrl`" && set `"NEXT_ALLOWED_DEV_ORIGINS=$publicHostValue`" && bun run dev -- --hostname $bindHost -p $WebPort > `"$webLog`" 2>&1"

$worker = $null
$web = $null

try {
  $worker = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $workerCmd) -PassThru -WindowStyle Hidden

  if (!(Wait-ForPort $WorkerPort)) {
    throw "Worker dev server did not start listening on port $WorkerPort within 30 seconds.$([Environment]::NewLine)$(Get-LogTail $workerLog)"
  }

  $web = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $webCmd) -PassThru -WindowStyle Hidden

  if (!(Wait-ForPort $WebPort)) {
    throw "Web dev server did not start listening on port $WebPort within 30 seconds.$([Environment]::NewLine)$(Get-LogTail $webLog)"
  }
} catch {
  foreach ($process in @($web, $worker)) {
    if ($null -ne $process -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      Stop-ProcessTree -ProcessId ([int]$process.Id)
    }
  }
  throw
}

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
