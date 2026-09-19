param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [switch]$Lan,
  [string]$PublicHost = "",
  # When set with -Lan, bake a fixed WS host into NEXT_PUBLIC_WS_URL (legacy).
  # Default LAN mode is IP-agnostic: the browser uses the same hostname it opened.
  [switch]$BakeWsUrl,
  # Run Next.js standalone production server instead of `next dev`.
  # Worker still uses local wrangler (Durable Objects need the CF runtime).
  [switch]$Production,
  # Force `bun run build` before production start (also rebuilds when missing).
  [switch]$ForceBuild
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$stateDir = Join-Path $root ".omx\local-dev"
$logDir = Join-Path $root ".omx\logs"
New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

$pidFile = Join-Path $stateDir "pids.json"
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$modeTag = if ($Production) { "prod" } else { "dev" }
$workerLog = Join-Path $logDir "worker-$modeTag-$runStamp.log"
$webLog = Join-Path $logDir "web-$modeTag-$runStamp.log"

function Get-ChildProcessIds([int]$ProcessId) {
  $ids = @()
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction Stop
    foreach ($child in @($children)) {
      $ids += [int]$child.ProcessId
    }
    return $ids
  } catch {
    try {
      $children = Get-WmiObject Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction Stop
      foreach ($child in @($children)) {
        $ids += [int]$child.ProcessId
      }
    } catch {
      # Windows 8.1 without CIM/WMI access: fall through.
    }
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
  $client = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect("127.0.0.1", $Port)
    return $false
  } catch {
    return $true
  } finally {
    if ($null -ne $client) {
      try { $client.Close() } catch { }
    }
  }
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

function Test-IsUsableLanIPv4([string]$Address) {
  if ([string]::IsNullOrWhiteSpace($Address)) { return $false }
  if ($Address -like "127.*") { return $false }
  if ($Address -like "169.254.*") { return $false }
  if ($Address -eq "0.0.0.0") { return $false }
  return $Address -match '^\d{1,3}(\.\d{1,3}){3}$'
}

function Get-AllLocalLanAddresses {
  $found = New-Object System.Collections.Generic.List[string]

  try {
    $netAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        (Test-IsUsableLanIPv4 $_.IPAddress) -and
        ($_.AddressState -eq "Preferred" -or -not $_.PSObject.Properties["AddressState"]) -and
        ($_.PrefixOrigin -ne "WellKnown")
      } |
      Sort-Object -Property InterfaceIndex)

    foreach ($entry in $netAddresses) {
      if (-not $found.Contains($entry.IPAddress)) {
        $found.Add($entry.IPAddress)
      }
    }
  } catch {
    # Fall through to WMI/CIM path (Windows 8 / older PowerShell modules).
  }

  if ($found.Count -eq 0) {
    try {
      $adapters = @(Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop |
        Where-Object { $_.IPEnabled -eq $true })
      foreach ($adapter in $adapters) {
        foreach ($ip in @($adapter.IPAddress)) {
          if ((Test-IsUsableLanIPv4 $ip) -and -not $found.Contains($ip)) {
            $found.Add($ip)
          }
        }
      }
    } catch {
      # Ignore and try route preference below / throw later.
    }
  }

  return @($found)
}

function Get-PreferredLanAddress([string[]]$Addresses) {
  if ($Addresses.Count -eq 0) {
    throw "Could not auto-detect a LAN IPv4 address. Pass -PublicHost, for example -PublicHost 192.168.1.10."
  }

  # Prefer the interface carrying the active default route when available.
  try {
    $defaultRoutes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
      Where-Object { $_.NextHop -ne "0.0.0.0" } |
      Sort-Object -Property RouteMetric, InterfaceMetric)

    $netAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $Addresses -contains $_.IPAddress })

    foreach ($route in $defaultRoutes) {
      $candidate = $netAddresses |
        Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } |
        Select-Object -First 1
      if ($null -ne $candidate) { return $candidate.IPAddress }
    }

    $connectedInterfaces = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.ConnectionState -eq "Connected" } |
      Sort-Object -Property InterfaceMetric, InterfaceIndex)

    foreach ($interface in $connectedInterfaces) {
      $candidate = $netAddresses |
        Where-Object { $_.InterfaceIndex -eq $interface.InterfaceIndex } |
        Select-Object -First 1
      if ($null -ne $candidate) { return $candidate.IPAddress }
    }
  } catch {
    # Route helpers may be missing on older Windows; fall back to first address.
  }

  return $Addresses[0]
}

function Warn-IfLanFirewallRulesMissing([int[]]$Ports) {
  $missingPorts = @()
  foreach ($port in $Ports) {
    try {
      $rule = Get-NetFirewallRule -DisplayName "Radioboi LAN TCP $port" -ErrorAction SilentlyContinue |
        Where-Object { $_.Enabled -eq "True" -and $_.Action -eq "Allow" }
      if ($null -eq $rule) { $missingPorts += $port }
    } catch {
      $missingPorts += $port
    }
  }

  if ($missingPorts.Count -gt 0) {
    Write-Warning "Windows Firewall may block LAN clients on TCP $($missingPorts -join ', '). Run 'powershell -ExecutionPolicy Bypass -File scripts/allow-lan-firewall.ps1 -WebPort $WebPort -WorkerPort $WorkerPort' from an elevated PowerShell window (or local-server\allow-firewall.bat)."
  }
}

Stop-ExistingFromPidFile

if (!(Test-PortFree $WorkerPort)) { throw "Port $WorkerPort is already in use. Stop the process or pass -WorkerPort." }
if (!(Test-PortFree $WebPort)) { throw "Port $WebPort is already in use. Stop the process or pass -WebPort." }

$workerDir = Join-Path $root "apps\worker"
$webDir = Join-Path $root "apps\web"
$bindHost = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }

$lanAddresses = @()
if ($Lan) {
  $lanAddresses = @(Get-AllLocalLanAddresses)
}

$publicHostValue = if ($PublicHost.Trim().Length -gt 0) {
  $PublicHost.Trim()
} elseif ($Lan) {
  Get-PreferredLanAddress -Addresses $lanAddresses
} else {
  "127.0.0.1"
}

# IP-agnostic LAN: do not bake a machine IP into the client bundle.
# The browser connects to ws://<page-hostname>:<worker-port>.
$useDynamicWs = $Lan -and -not $BakeWsUrl
if ($useDynamicWs) {
  $wsUrl = "ws://<same-host-as-page>:$WorkerPort"
} else {
  $wsUrl = "ws://${publicHostValue}:$WorkerPort"
}

$allowedOriginHosts = @("127.0.0.1", "localhost")
if ($publicHostValue -and ($allowedOriginHosts -notcontains $publicHostValue)) {
  $allowedOriginHosts += $publicHostValue
}
foreach ($address in $lanAddresses) {
  if ($allowedOriginHosts -notcontains $address) {
    $allowedOriginHosts += $address
  }
}
$allowedOrigins = ($allowedOriginHosts -join ",")

if ($Lan) {
  Warn-IfLanFirewallRulesMissing @($WebPort, $WorkerPort)
}

# ── Production web ────────────────────────────────────────────────────────────
# Preferred: Node LAN static export + bundled worker (Windows 8.1 / Node 18).
# Fallback: Next standalone + wrangler (Windows 10+ pack-machine / Cloudflare).
$standaloneServer = Join-Path $webDir ".next\standalone\apps\web\server.js"
$lanServer = Join-Path $workerDir "dist\lan-server.cjs"
$webOut = Join-Path $webDir "out"
$hasNodeLan = (Test-Path $lanServer) -and (Test-Path (Join-Path $webOut "index.html"))

if ($Production -and -not $hasNodeLan) {
  $needBuild = $ForceBuild -or -not (Test-Path $standaloneServer)
  if ($needBuild) {
    Write-Host "Building production web (standalone)..."
    Push-Location $root
    try {
      if ($useDynamicWs) {
        Remove-Item Env:\NEXT_PUBLIC_WS_URL -ErrorAction SilentlyContinue
        $env:NEXT_PUBLIC_WS_PORT = "$WorkerPort"
      } else {
        $env:NEXT_PUBLIC_WS_URL = $wsUrl
        Remove-Item Env:\NEXT_PUBLIC_WS_PORT -ErrorAction SilentlyContinue
      }
      bun run build
      if ($LASTEXITCODE -ne 0) {
        throw "Production build failed with exit code $LASTEXITCODE."
      }
    } finally {
      Pop-Location
    }
    if (!(Test-Path $standaloneServer)) {
      throw "Production build finished but standalone server is missing: $standaloneServer"
    }
  } else {
    Write-Host "Using existing production build: $standaloneServer"
    Write-Host "(pass -ForceBuild to rebuild with current WS settings)"
  }
}

$useNodeLan = $Production -and $hasNodeLan
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($null -ne $nodeCmd) { $nodeCmd.Source } else { "node" }

$workerCmd = "cd /d `"$workerDir`" && bun run dev -- --port $WorkerPort --ip $bindHost > `"$workerLog`" 2>&1"

if ($useNodeLan) {
  # Windows 8.1 (build 9600): one Node 18 process serves static web + game WebSocket.
  # Prefix with `cd` so cmd.exe /c does not swallow the quoted node.exe path.
  $workerCmd = "cd /d `"$workerDir`" && `"$nodePath`" `"$lanServer`" --web-port $WebPort --worker-port $WorkerPort --web-root `"$webOut`" --hostname $bindHost --allowed-origins `"$allowedOrigins`" > `"$workerLog`" 2>&1"
  $webCmd = $null
} elseif ($Production) {
  # Node standalone: HOSTNAME defaults to 0.0.0.0 in Next's server.js; set explicitly.
  $webCmd = "cd /d `"$webDir`" && set `"PORT=$WebPort`" && set `"HOSTNAME=$bindHost`" && bun run start > `"$webLog`" 2>&1"
} elseif ($useDynamicWs) {
  $webCmd = "cd /d `"$webDir`" && set `"NEXT_PUBLIC_WS_PORT=$WorkerPort`" && set `"NEXT_ALLOWED_DEV_ORIGINS=$allowedOrigins`" && bun run dev -- --hostname $bindHost -p $WebPort > `"$webLog`" 2>&1"
} else {
  $webCmd = "cd /d `"$webDir`" && set `"NEXT_PUBLIC_WS_URL=$wsUrl`" && set `"NEXT_ALLOWED_DEV_ORIGINS=$allowedOrigins`" && bun run dev -- --hostname $bindHost -p $WebPort > `"$webLog`" 2>&1"
}

$worker = $null
$web = $null
$webWaitSeconds = if ($Production) { 60 } else { 30 }

try {
  $worker = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $workerCmd) -PassThru -WindowStyle Hidden

  if (!(Wait-ForPort $WorkerPort)) {
    throw "Worker server did not start listening on port $WorkerPort within 30 seconds.$([Environment]::NewLine)$(Get-LogTail $workerLog)"
  }

  if ($null -ne $webCmd -and $webCmd.Trim().Length -gt 0) {
    $web = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $webCmd) -PassThru -WindowStyle Hidden
  } else {
    $web = $worker
  }

  if (!(Wait-ForPort -Port $WebPort -TimeoutSeconds $webWaitSeconds)) {
    throw "Web server did not start listening on port $WebPort within $webWaitSeconds seconds.$([Environment]::NewLine)$(Get-LogTail $webLog)$([Environment]::NewLine)$(Get-LogTail $workerLog)"
  }
} catch {
  foreach ($process in @($web, $worker)) {
    if ($null -ne $process -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      Stop-ProcessTree -ProcessId ([int]$process.Id)
    }
  }
  throw
}

$webPid = if ($null -ne $web) { $web.Id } else { $worker.Id }
$state = [ordered]@{
  workerLauncherPid = $worker.Id
  webLauncherPid = $webPid
  workerPort = $WorkerPort
  webPort = $WebPort
  bindHost = $bindHost
  publicHost = $publicHostValue
  lanAddresses = $lanAddresses
  dynamicWs = [bool]$useDynamicWs
  production = [bool]$Production
  wsUrl = $wsUrl
  webUrl = "http://${publicHostValue}:$WebPort"
  workerLog = $workerLog
  webLog = $webLog
  startedAt = (Get-Date).ToString("o")
}
$state | ConvertTo-Json | Set-Content -Encoding UTF8 $pidFile

Write-Host "Radioboi local stack started."
Write-Host "Bind:   $bindHost"
if ($useNodeLan) {
  $runMode = "production (Node 18 static web + Node game worker, Windows 8.1)"
} elseif ($Production) {
  $runMode = "production (standalone web + wrangler worker)"
} else {
  $runMode = "development (next dev + wrangler)"
}
Write-Host "Run:    $runMode"
if ($Lan) {
  Write-Host "Mode:   LAN (IP-agnostic WebSocket = page hostname:$WorkerPort)"
  Write-Host ""
  Write-Host "Open the game from any of these addresses on this PC or LAN clients:"
  Write-Host "  http://${publicHostValue}:$WebPort   (preferred)"
  foreach ($address in $lanAddresses) {
    if ($address -ne $publicHostValue) {
      Write-Host "  http://${address}:$WebPort"
    }
  }
  Write-Host "  http://127.0.0.1:$WebPort   (this machine only)"
  Write-Host ""
  Write-Host "WebSocket: same host as the page, port $WorkerPort"
  Write-Host "  Example: ws://${publicHostValue}:$WorkerPort"
  if ($BakeWsUrl) {
    Write-Host "  (fixed WS URL baked: $wsUrl)"
  }
} else {
  Write-Host "Web:    http://${publicHostValue}:$WebPort"
  Write-Host "Worker: http://${publicHostValue}:$WorkerPort"
  Write-Host "WS:     $wsUrl"
}
Write-Host ""
Write-Host "Logs:"
Write-Host "  $workerLog"
Write-Host "  $webLog"
Write-Host "Stop: bun run stop:local   (or local-server\stop.bat)"
