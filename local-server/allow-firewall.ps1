# Open Windows Firewall for Radioboi LAN ports (Private profile, LocalSubnet only).
# Must be run as Administrator.
param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Resolve-RadioboiPaths.ps1")

$layout = Get-RadioboiLayout

if (!(Test-Path $layout.Firewall)) {
  throw "Missing firewall script: $($layout.Firewall)"
}

$fwParams = @{
  WebPort    = $WebPort
  WorkerPort = $WorkerPort
}
if ($Remove) {
  $fwParams.Remove = $true
}

& $layout.Firewall @fwParams
