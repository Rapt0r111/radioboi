# Shared path resolution for monorepo mode vs offline portable package.
# Offline layout:
#   <package>/
#     runtime/bun.exe, node.exe
#     app/                 monorepo root with node_modules
#     start.ps1
# Monorepo layout:
#   repo/local-server/start.ps1  -> app is repo root, runtime from PATH

function Get-RadioboiLayout {
  $packageRoot = $PSScriptRoot
  if ((Split-Path -Leaf $packageRoot) -eq "lib") {
    $packageRoot = (Resolve-Path (Join-Path $packageRoot "..")).Path
  }

  $offlineApp = Join-Path $packageRoot "app"
  $offlineRuntime = Join-Path $packageRoot "runtime"
  $offlineCache = Join-Path $packageRoot "cache"
  $isOffline = (Test-Path (Join-Path $offlineApp "package.json")) -and (Test-Path (Join-Path $offlineApp "apps"))

  if ($isOffline) {
    return [pscustomobject]@{
      Mode         = "offline"
      PackageRoot  = $packageRoot
      RepoRoot     = (Resolve-Path $offlineApp).Path
      RuntimeDir   = if (Test-Path $offlineRuntime) { (Resolve-Path $offlineRuntime).Path } else { $null }
      CacheDir     = if (Test-Path $offlineCache) { (Resolve-Path $offlineCache).Path } else { $null }
      StartLocal   = Join-Path $offlineApp "scripts\start-local.ps1"
      StopLocal    = Join-Path $offlineApp "scripts\stop-local.ps1"
      Firewall     = Join-Path $offlineApp "scripts\allow-lan-firewall.ps1"
    }
  }

  $repoRoot = (Resolve-Path (Join-Path $packageRoot "..")).Path
  return [pscustomobject]@{
    Mode         = "monorepo"
    PackageRoot  = $packageRoot
    RepoRoot     = $repoRoot
    RuntimeDir   = $null
    CacheDir     = $null
    StartLocal   = Join-Path $repoRoot "scripts\start-local.ps1"
    StopLocal    = Join-Path $repoRoot "scripts\stop-local.ps1"
    Firewall     = Join-Path $repoRoot "scripts\allow-lan-firewall.ps1"
  }
}

function Use-RadioboiRuntime([string]$RuntimeDir) {
  if ([string]::IsNullOrWhiteSpace($RuntimeDir) -or !(Test-Path $RuntimeDir)) {
    return
  }

  $nodeDir = Join-Path $RuntimeDir "node"
  $pathParts = @($RuntimeDir)
  if (Test-Path $nodeDir) {
    $pathParts += $nodeDir
  }

  $env:PATH = ($pathParts -join ";") + ";" + $env:PATH
  $env:BUN_INSTALL = $RuntimeDir
  # Keep installs offline-safe if someone re-runs bun install by mistake.
  $env:BUN_CONFIG_NO_INSTALL = $null
}

function Assert-RadioboiTools {
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($null -eq $bun) {
    throw @"
bun.exe not found.

Offline package: ensure runtime\bun.exe exists next to start.ps1.
Monorepo: install Bun and reopen the terminal (https://bun.sh).
"@
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) {
    Write-Warning "node.exe not on PATH. Next.js may still work via Bun; production standalone needs Node."
  } else {
    Write-Host "Using bun:  $($bun.Source)"
    Write-Host "Using node: $($node.Source)"
  }
}
