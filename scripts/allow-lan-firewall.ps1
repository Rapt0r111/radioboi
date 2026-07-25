param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell window (Run as Administrator)."
}

$rulePrefix = "Radioboi LAN"
$ports = @($WebPort, $WorkerPort) | Sort-Object -Unique

foreach ($port in $ports) {
  $displayName = "$rulePrefix TCP $port"
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
}

if ($Remove) {
  Write-Host "Radioboi LAN firewall rules removed for ports $($ports -join ', ')."
} else {
  Write-Host "Radioboi LAN firewall rules enabled for Private profile and LocalSubnet on ports $($ports -join ', ')."
}
