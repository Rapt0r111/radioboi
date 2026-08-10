# Stop Radioboi local/LAN stack.
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "lib\Resolve-RadioboiPaths.ps1")

$layout = Get-RadioboiLayout
Use-RadioboiRuntime -RuntimeDir $layout.RuntimeDir

if (!(Test-Path $layout.StopLocal)) {
  throw "Missing stop script: $($layout.StopLocal)"
}

& $layout.StopLocal
