# Verify an offline portable package (structure + optional live smoke test).
param(
  [string]$PackageDir = "",
  [switch]$StartSmoke,
  [int]$WebPort = 3000,
  [int]$WorkerPort = 8787,
  [int]$HttpTimeoutSec = 90
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PackageDir)) {
  $PackageDir = Join-Path $PSScriptRoot "offline"
}
$PackageDir = (Resolve-Path -LiteralPath $PackageDir -ErrorAction Stop).Path

. (Join-Path $PSScriptRoot "lib\Resolve-RadioboiPaths.ps1")
. (Join-Path $PSScriptRoot "lib\Install-OfflineDeps.ps1")

$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Ok([string]$Message) { Write-Host "[OK]  $Message" -ForegroundColor Green }
function Fail([string]$Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  $script:failures.Add($Message)
}
function Warn([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
  $script:warnings.Add($Message)
}

function Test-PathRequired([string]$Path, [string]$Label) {
  if (Test-Path -LiteralPath $Path) {
    Ok $Label
    return $true
  }
  Fail "$Label - missing: $Path"
  return $false
}

Write-Host "=== Radioboi offline package verify ==="
Write-Host "Package: $PackageDir"
Write-Host ""

# ── Structure ────────────────────────────────────────────────────────────────
$required = @(
  @{ Path = (Join-Path $PackageDir "OFFLINE_PACKAGE"); Label = "OFFLINE_PACKAGE marker" },
  @{ Path = (Join-Path $PackageDir "VERSION.txt"); Label = "VERSION.txt" },
  @{ Path = (Join-Path $PackageDir "start.bat"); Label = "start.bat" },
  @{ Path = (Join-Path $PackageDir "start.ps1"); Label = "start.ps1" },
  @{ Path = (Join-Path $PackageDir "stop.bat"); Label = "stop.bat" },
  @{ Path = (Join-Path $PackageDir "stop.ps1"); Label = "stop.ps1" },
  @{ Path = (Join-Path $PackageDir "lib\Resolve-RadioboiPaths.ps1"); Label = "lib/Resolve-RadioboiPaths.ps1" },
  @{ Path = (Join-Path $PackageDir "lib\Install-OfflineDeps.ps1"); Label = "lib/Install-OfflineDeps.ps1" },
  @{ Path = (Join-Path $PackageDir "runtime\bun.exe"); Label = "runtime/bun.exe" },
  @{ Path = (Join-Path $PackageDir "runtime\node\node.exe"); Label = "runtime/node/node.exe" },
  @{ Path = (Join-Path $PackageDir "cache"); Label = "cache/" },
  @{ Path = (Join-Path $PackageDir "app\package.json"); Label = "app/package.json" },
  @{ Path = (Join-Path $PackageDir "app\bun.lock"); Label = "app/bun.lock" },
  @{ Path = (Join-Path $PackageDir "app\apps\web\package.json"); Label = "app/apps/web" },
  @{ Path = (Join-Path $PackageDir "app\apps\worker\package.json"); Label = "app/apps/worker" },
  @{ Path = (Join-Path $PackageDir "app\scripts\start-local.ps1"); Label = "app/scripts/start-local.ps1" },
  @{ Path = (Join-Path $PackageDir "app\scripts\stop-local.ps1"); Label = "app/scripts/stop-local.ps1" },
  @{ Path = (Join-Path $PackageDir "app\apps\web\.next\standalone\apps\web\server.js"); Label = "production standalone server.js" }
)

foreach ($item in $required) {
  Test-PathRequired -Path $item.Path -Label $item.Label | Out-Null
}

$staticDir = Join-Path $PackageDir "app\apps\web\.next\static"
if (Test-Path $staticDir) {
  Ok "Next static assets (.next/static)"
} else {
  Warn "apps/web/.next/static missing - start-standalone copies it if present at pack time"
}

$publicDir = Join-Path $PackageDir "app\apps\web\public"
if (Test-Path $publicDir) {
  Ok "apps/web/public"
} else {
  Warn "apps/web/public missing"
}

# Portable Node resolution (failure mode: @swc/helpers after zip/move)
$swcHelpers = Join-Path $PackageDir "app\apps\web\.next\standalone\apps\web\node_modules\@swc\helpers"
$swcHelpersRoot = Join-Path $PackageDir "app\apps\web\.next\standalone\node_modules\@swc\helpers"
if ((Test-Path $swcHelpers) -or (Test-Path $swcHelpersRoot)) {
  Ok "@swc/helpers present in standalone node_modules (portable)"
} else {
  Fail "@swc/helpers missing under standalone - re-run pack.ps1 (repair-standalone step)"
}

$repairScript = Join-Path $PackageDir "app\apps\web\scripts\repair-standalone.mjs"
if (Test-Path $repairScript) {
  Ok "repair-standalone.mjs present"
} else {
  Fail "repair-standalone.mjs missing - re-run pack.ps1"
}

# ── Runtime versions ─────────────────────────────────────────────────────────
$bunExe = Join-Path $PackageDir "runtime\bun.exe"
$nodeExe = Join-Path $PackageDir "runtime\node\node.exe"
if (Test-Path $bunExe) {
  try {
    $bunVer = & $bunExe --version 2>&1
    Ok "Bun runtime runs: $bunVer"
  } catch {
    Fail "Bun runtime failed: $($_.Exception.Message)"
  }
}
if (Test-Path $nodeExe) {
  try {
    $nodeVer = & $nodeExe --version 2>&1
    Ok "Node runtime runs: $nodeVer"
  } catch {
    Fail "Node runtime failed: $($_.Exception.Message)"
  }
}

$standaloneServerForResolve = Join-Path $PackageDir "app\apps\web\.next\standalone\apps\web\server.js"
if ((Test-Path $nodeExe) -and (Test-Path $standaloneServerForResolve)) {
  $verifyScript = @'
const { createRequire } = require("module");
const serverPath = process.argv[2];
if (!serverPath) { console.error("usage: node verify.js <server.js>"); process.exit(2); }
const req = createRequire(serverPath);
const ids = ["next", "@swc/helpers/_/_interop_require_default", "react", "react-dom"];
for (const id of ids) {
  try { req.resolve(id); }
  catch (e) { console.error("MISSING " + id); process.exit(2); }
}
console.log("resolve-ok");
'@
  $tmp = Join-Path $env:TEMP "radioboi-verify-standalone.js"
  Set-Content -LiteralPath $tmp -Value $verifyScript -Encoding UTF8
  try {
    $out = & $nodeExe $tmp $standaloneServerForResolve 2>&1
    if ($LASTEXITCODE -eq 0 -and (($out | Out-String) -match "resolve-ok")) {
      Ok "Node resolves next/@swc/helpers/react from standalone"
    } else {
      Fail "Node cannot resolve standalone modules: $($out | Out-String)"
    }
  } catch {
    Fail "Standalone resolve check threw: $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

# ── Source freshness vs monorepo (when verify runs from repo) ────────────────
$repoRoot = $null
try {
  $candidate = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  if (Test-Path (Join-Path $candidate "package.json")) {
    $repoRoot = $candidate
  }
} catch { }

if ($null -ne $repoRoot) {
  $pairs = @(
    @{ Rel = "package.json"; Label = "root package.json" },
    @{ Rel = "bun.lock"; Label = "bun.lock" },
    @{ Rel = "apps\web\package.json"; Label = "web package.json" },
    @{ Rel = "apps\worker\package.json"; Label = "worker package.json" },
    @{ Rel = "apps\web\app\actions.ts"; Label = "web actions.ts (offline rooms)" },
    @{ Rel = "apps\web\src\lib\network\gameClient.ts"; Label = "gameClient WS resolve" },
    @{ Rel = "scripts\start-local.ps1"; Label = "start-local.ps1" },
    @{ Rel = "local-server\start.ps1"; Label = "start.ps1 launcher" },
    @{ Rel = "local-server\lib\Install-OfflineDeps.ps1"; Label = "Install-OfflineDeps.ps1" }
  )

  Write-Host ""
  Write-Host "Comparing package app/ to monorepo source..."
  foreach ($pair in $pairs) {
    $src = Join-Path $repoRoot $pair.Rel
    # launchers live at package root, not under app/
    $dstRel = $pair.Rel
    if ($dstRel -like "local-server\*") {
      $dst = Join-Path $PackageDir ($dstRel -replace '^local-server\\', '')
    } else {
      $dst = Join-Path $PackageDir "app\$dstRel"
    }

    if (!(Test-Path $src)) {
      Warn "Repo missing $($pair.Label): $src"
      continue
    }
    if (!(Test-Path $dst)) {
      Fail "Package missing $($pair.Label): $dst"
      continue
    }

    $srcHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
    $dstHash = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
    if ($srcHash -eq $dstHash) {
      Ok "In sync: $($pair.Label)"
    } else {
      Fail "OUTDATED vs monorepo: $($pair.Label)`n       repo=$src`n       pkg =$dst"
    }
  }
}

# ── Offline install dry check (marker / node_modules) ────────────────────────
$appDir = Join-Path $PackageDir "app"
$cacheDir = Join-Path $PackageDir "cache"
$nm = Join-Path $appDir "node_modules"
if (Test-Path $nm) {
  Ok "app/node_modules present"
} else {
  Warn "app/node_modules missing - first start will install offline from cache/"
}

$marker = Join-Path $appDir ".offline-install-ok"
if (Test-Path $marker) {
  try {
    $data = Get-Content -Raw $marker | ConvertFrom-Json
    if ($data.appPath -eq $appDir) {
      Ok "Offline install marker matches current path"
    } else {
      Warn "Offline install marker path differs (expected after copy). First start will re-link."
      Write-Host "       marker: $($data.appPath)"
      Write-Host "       actual: $appDir"
    }
  } catch {
    Warn "Offline install marker unreadable - will reinstall on start"
  }
} else {
  Warn "No .offline-install-ok marker - first start will install offline"
}

# ── Optional live smoke ──────────────────────────────────────────────────────
if ($StartSmoke) {
  Write-Host ""
  Write-Host "Starting package for smoke test (ports $WebPort / $WorkerPort)..."

  $stopScript = Join-Path $PackageDir "stop.ps1"
  if (Test-Path $stopScript) {
    & $stopScript 2>$null | Out-Null
  }

  $startScript = Join-Path $PackageDir "start.ps1"
  & $startScript -WebPort $WebPort -WorkerPort $WorkerPort -Production -SkipInstall:$false
  if ($LASTEXITCODE -ne 0) {
    Fail "start.ps1 failed with exit $LASTEXITCODE"
  } else {
    Ok "start.ps1 completed"

    $deadline = (Get-Date).AddSeconds($HttpTimeoutSec)
    $webOk = $false
    $workerOk = $false
    $lastWebErr = ""
    $lastWorkerErr = ""

    while ((Get-Date) -lt $deadline) {
      try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 5
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
          $webOk = $true
        }
      } catch {
        $lastWebErr = $_.Exception.Message
      }

      try {
        # wrangler may return 404 on / - any TCP HTTP response means up
        $resp2 = Invoke-WebRequest -Uri "http://127.0.0.1:$WorkerPort/" -UseBasicParsing -TimeoutSec 5
        $workerOk = $true
      } catch {
        $lastWorkerErr = $_.Exception.Message
        # Connection refused vs HTTP error: WebException with response = server up
        if ($_.Exception.Response) {
          $workerOk = $true
        }
      }

      if ($webOk -and $workerOk) { break }
      Start-Sleep -Seconds 2
    }

    if ($webOk) {
      Ok "Web HTTP responds on :$WebPort"
    } else {
      Fail "Web did not respond on :$WebPort within ${HttpTimeoutSec}s ($lastWebErr)"
    }

    if ($workerOk) {
      Ok "Worker HTTP responds on :$WorkerPort"
    } else {
      Fail "Worker did not respond on :$WorkerPort within ${HttpTimeoutSec}s ($lastWorkerErr)"
    }

    # Confirm production mode from pid state if present
    $pidFile = Join-Path $appDir ".omx\local-dev\pids.json"
    if (Test-Path $pidFile) {
      try {
        $state = Get-Content -Raw $pidFile | ConvertFrom-Json
        if ($state.production -eq $true) {
          Ok "PID state: production=true"
        } else {
          Fail "PID state: production is not true (got $($state.production))"
        }
        if ($state.dynamicWs -eq $true) {
          Ok "PID state: dynamicWs=true (IP-agnostic)"
        } else {
          Warn "PID state: dynamicWs=$($state.dynamicWs)"
        }
      } catch {
        Warn "Could not parse pids.json"
      }
    } else {
      Warn "pids.json not found after start"
    }

    Write-Host "Stopping smoke stack..."
    & $stopScript
    Ok "stop.ps1 completed"
  }
}

Write-Host ""
Write-Host "=== Summary ==="
Write-Host ("Failures: {0}" -f $failures.Count)
Write-Host ("Warnings: {0}" -f $warnings.Count)

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Failed checks:" -ForegroundColor Red
  foreach ($f in $failures) { Write-Host "  - $f" }
  Write-Host ""
  Write-Host "Fix: rebuild with  bun run server:pack   (or local-server\pack.ps1)"
  exit 1
}

Write-Host "Package verification passed." -ForegroundColor Green
if ($warnings.Count -gt 0) {
  Write-Host "There were warnings (usually OK after copy or before first start)."
}
exit 0
