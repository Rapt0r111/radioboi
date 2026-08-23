# Open Windows Firewall for Radioboi LAN ports (Private profile, LocalSubnet only).
# Self-elevates via UAC when not already running as Administrator.
# Note: do not use `net session` for elevation checks — it fails when LanmanServer is stopped.
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
    throw "Administrator elevation was cancelled or failed. Right-click allow-firewall.bat -> Run as administrator."
  }

  if ($null -eq $proc) {
    throw "Administrator elevation failed (no process started)."
  }
  exit $proc.ExitCode
}

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
