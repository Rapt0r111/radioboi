param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

function Test-RadioboiIsAdministrator {
  $principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-RadioboiIsAdministrator)) {
  # Self-elevate so direct calls (scripts\allow-lan-firewall.ps1) also work.
  # Avoid `net session` — it fails when the Server service is stopped (NET 2114).
  $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -WebPort $WebPort -WorkerPort $WorkerPort"
  if ($Remove) {
    $argList += " -Remove"
  }

  Write-Host "Administrator rights required. Requesting elevation (UAC)..."
  try {
    $proc = Start-Process -FilePath "powershell.exe" `
      -Verb RunAs `
      -ArgumentList $argList `
      -Wait `
      -PassThru
  } catch {
    throw "Administrator elevation was cancelled or failed. Run from an elevated PowerShell window (Run as Administrator)."
  }

  if ($null -eq $proc) {
    throw "Administrator elevation failed (no process started)."
  }
  exit $proc.ExitCode
}

$rulePrefix = "Radioboi LAN"
$ports = @($WebPort, $WorkerPort) | Sort-Object -Unique

foreach ($port in $ports) {
  $displayName = "$rulePrefix TCP $port"
  $netFirewallOk = $false
  try {
    Remove-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if (!$Remove) {
      New-NetFirewallRule `
        -DisplayName $displayName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -Profile Private `
        -RemoteAddress LocalSubnet `
        -Description "Allow Radioboi local web and WebSocket traffic from the private LAN only." |
        Out-Null
    }
    $netFirewallOk = $true
  } catch {
    $netFirewallOk = $false
  }

  if (-not $netFirewallOk) {
    # Windows 8.1 fallback when NetSecurity cmdlets are missing.
    netsh advfirewall firewall delete rule name="$displayName" > $null 2>&1
    if (!$Remove) {
      $netsh = netsh advfirewall firewall add rule name="$displayName" dir=in action=allow protocol=TCP localport=$port profile=private remoteip=localsubnet
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to add firewall rule '$displayName'. Run as Administrator. $netsh"
      }
    }
  }
}

if ($Remove) {
  Write-Host "Radioboi LAN firewall rules removed for ports $($ports -join ', ')."
} else {
  Write-Host "Radioboi LAN firewall rules enabled for Private profile and LocalSubnet on ports $($ports -join ', ')."
}
