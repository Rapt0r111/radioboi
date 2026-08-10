# Repair / install node_modules using the package-local Bun cache (no registry).
# IMPORTANT: never delete node_modules under .next/standalone - that tree is
# produced by `next build` and is required for production web startup.

function Remove-RadioboiWorkspaceNodeModules {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $targets = New-Object System.Collections.Generic.List[string]
  $rootNm = Join-Path $RepoRoot "node_modules"
  if (Test-Path $rootNm) {
    $targets.Add($rootNm)
  }

  foreach ($workspaceParent in @("apps", "packages")) {
    $parent = Join-Path $RepoRoot $workspaceParent
    if (!(Test-Path $parent)) { continue }
    Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $nm = Join-Path $_.FullName "node_modules"
      if (Test-Path $nm) {
        $targets.Add($nm)
      }
    }
  }

  foreach ($path in $targets) {
    Write-Host "  removing $path"
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Write-RadioboiOfflineInstallMarker {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$CacheDir
  )

  $lock = Join-Path $RepoRoot "bun.lock"
  $marker = Join-Path $RepoRoot ".offline-install-ok"
  if (!(Test-Path $lock)) {
    throw "bun.lock missing at $lock"
  }

  $payload = [ordered]@{
    appPath   = $RepoRoot
    cacheDir  = $CacheDir
    lockHash  = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
    installed = (Get-Date).ToString("o")
  }
  $payload | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
}

function Install-RadioboiOfflineDeps {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$CacheDir,

    [string]$RuntimeDir = "",

    [switch]$Force
  )

  if (!(Test-Path $CacheDir)) {
    throw "Offline package cache is missing: $CacheDir. Re-run pack.ps1 on a machine with internet."
  }

  $marker = Join-Path $RepoRoot ".offline-install-ok"
  $lock = Join-Path $RepoRoot "bun.lock"
  $nodeModules = Join-Path $RepoRoot "node_modules"
  $standaloneServer = Join-Path $RepoRoot "apps\web\.next\standalone\apps\web\server.js"

  if (-not $Force -and (Test-Path $marker) -and (Test-Path $nodeModules)) {
    try {
      $markerData = Get-Content -Raw $marker | ConvertFrom-Json
      $lockHash = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
      if ($markerData.lockHash -eq $lockHash -and $markerData.appPath -eq $RepoRoot) {
        Write-Host "Offline dependencies OK (cache path match)."
        if (!(Test-Path $standaloneServer)) {
          Write-Warning "Production standalone server is missing. Re-run pack.ps1 or start with -ForceBuild."
        }
        return
      }
      Write-Host "Offline marker path/lock mismatch - re-linking dependencies for this location."
    } catch {
      # Fall through to reinstall.
    }
  }

  Write-Host "Installing/repairing dependencies offline (no internet required)..."
  Write-Host "  app:   $RepoRoot"
  Write-Host "  cache: $CacheDir"

  $env:BUN_INSTALL_CACHE_DIR = $CacheDir
  if (-not [string]::IsNullOrWhiteSpace($RuntimeDir) -and (Test-Path $RuntimeDir)) {
    $nodeDir = Join-Path $RuntimeDir "node"
    $env:PATH = "$RuntimeDir;$nodeDir;" + $env:PATH
  }

  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($null -eq $bun) {
    throw "bun.exe not found while installing offline deps."
  }

  Push-Location $RepoRoot
  try {
    # Drop broken absolute junctions from a previous machine path.
    # Only workspace roots - never .next/standalone/**/node_modules.
    Write-Host "Removing previous workspace node_modules (path re-link)..."
    Remove-RadioboiWorkspaceNodeModules -RepoRoot $RepoRoot

    & bun install --frozen-lockfile --offline
    if ($LASTEXITCODE -ne 0) {
      throw "bun install --offline failed with exit code $LASTEXITCODE."
    }

    if (!(Test-Path $nodeModules)) {
      throw "bun install --offline finished but node_modules is still missing."
    }

    Write-RadioboiOfflineInstallMarker -RepoRoot $RepoRoot -CacheDir $CacheDir
    Write-Host "Offline dependencies installed."

    if (!(Test-Path $standaloneServer)) {
      Write-Warning "Production standalone server is missing after install: $standaloneServer"
      Write-Warning "Pack again with pack.ps1, or start with -Production -ForceBuild (needs longer first boot)."
    }
  } finally {
    Pop-Location
  }
}
