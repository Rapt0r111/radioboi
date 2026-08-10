# Radioboi LAN server entrypoint (Windows 8/10/11).
# Works in monorepo mode and in the offline portable package (app/ + runtime/ + cache/).
param(
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [string]$PublicHost = "",
  [switch]$BakeWsUrl,
  [switch]$SkipInstall,
  [switch]$ForceOfflineInstall,
  # Production standalone web (default on for offline packages when a build exists).
  [switch]$Production,
  [switch]$Dev,
  [switch]$ForceBuild
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Resolve-RadioboiPaths.ps1")
. (Join-Path $PSScriptRoot "lib\Install-OfflineDeps.ps1")

$layout = Get-RadioboiLayout
Use-RadioboiRuntime -RuntimeDir $layout.RuntimeDir
Assert-RadioboiTools

if (!(Test-Path $layout.StartLocal)) {
  throw "Missing start script: $($layout.StartLocal)"
}

Write-Host "Mode: $($layout.Mode)"
Write-Host "App:  $($layout.RepoRoot)"

Push-Location $layout.RepoRoot
try {
  if ($layout.Mode -eq "offline") {
    if ([string]::IsNullOrWhiteSpace($layout.CacheDir)) {
      throw "Offline package is missing cache\. Re-run pack.ps1 on a machine with internet."
    }
    if (-not $SkipInstall) {
      Install-RadioboiOfflineDeps `
        -RepoRoot $layout.RepoRoot `
        -CacheDir $layout.CacheDir `
        -RuntimeDir $layout.RuntimeDir `
        -Force:$ForceOfflineInstall
    }
    $env:BUN_INSTALL_CACHE_DIR = $layout.CacheDir
    $env:BUN_INSTALL_OFFLINE = "1"
  } else {
    $nodeModules = Join-Path $layout.RepoRoot "node_modules"
    if (!(Test-Path $nodeModules)) {
      if ($SkipInstall) {
        throw "node_modules missing and -SkipInstall was set."
      }
      Write-Host "Installing dependencies (first monorepo run)..."
      bun install --frozen-lockfile
    }
  }

  $standaloneServer = Join-Path $layout.RepoRoot "apps\web\.next\standalone\apps\web\server.js"
  $useProduction = $false
  if ($Dev) {
    $useProduction = $false
  } elseif ($Production) {
    $useProduction = $true
  } elseif ($layout.Mode -eq "offline" -and (Test-Path $standaloneServer)) {
    # Offline packages ship a prebuilt standalone server when pack.ps1 ran build.
    $useProduction = $true
  }

  $startParams = @{
    Lan        = $true
    WebPort    = $WebPort
    WorkerPort = $WorkerPort
  }
  if ($PublicHost.Trim().Length -gt 0) {
    $startParams.PublicHost = $PublicHost.Trim()
  }
  if ($BakeWsUrl) {
    $startParams.BakeWsUrl = $true
  }
  if ($useProduction) {
    $startParams.Production = $true
  }
  if ($ForceBuild) {
    $startParams.ForceBuild = $true
  }

  if ($useProduction) {
    Write-Host "Web mode: production (standalone)"
  } else {
    Write-Host "Web mode: development (next dev)"
  }

  & $layout.StartLocal @startParams
} finally {
  Pop-Location
}
