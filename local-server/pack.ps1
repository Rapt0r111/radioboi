# Build a fully offline portable LAN server package for Windows.
#
# Run on a machine WITH internet (Bun + Node installed).
# Result: local-server\offline\  - copy that entire folder to the air-gapped server.
#
# The package includes:
#   runtime\     bun.exe + node.exe (no system install needed on the server)
#   cache\       Bun package cache for offline install
#   app\         full monorepo source + bun.lock (node_modules created/repaired on start)
#   start.bat    etc.
param(
  [string]$OutputDir = "",
  [switch]$SkipZip,
  [switch]$KeepHostNodeModules
)

$ErrorActionPreference = "Stop"

$packageRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $packageRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $packageRoot "offline"
}
$OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)

$appDir = Join-Path $OutputDir "app"
$runtimeDir = Join-Path $OutputDir "runtime"
$nodeRuntimeDir = Join-Path $runtimeDir "node"
$cacheDir = Join-Path $OutputDir "cache"

Write-Host "=== Radioboi offline pack ==="
Write-Host "Repo:   $repoRoot"
Write-Host "Output: $OutputDir"
Write-Host ""

$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if ($null -eq $bunCmd) {
  throw "Bun is required on the packing machine. Install from https://bun.sh and re-run."
}
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
  throw "Node.js is required on the packing machine (copied into the offline runtime)."
}

# ── Clean output ──────────────────────────────────────────────────────────────
if (Test-Path $OutputDir) {
  Write-Host "Removing previous package at $OutputDir ..."
  Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $appDir, $runtimeDir, $nodeRuntimeDir, $cacheDir | Out-Null

# ── Copy runtimes ─────────────────────────────────────────────────────────────
Write-Host "Copying Bun runtime..."
$bunDir = Split-Path -Parent $bunCmd.Source
Copy-Item -LiteralPath (Join-Path $bunDir "bun.exe") -Destination (Join-Path $runtimeDir "bun.exe") -Force
$bunx = Join-Path $bunDir "bunx.exe"
if (Test-Path $bunx) {
  Copy-Item -LiteralPath $bunx -Destination (Join-Path $runtimeDir "bunx.exe") -Force
}

Write-Host "Copying Node.js runtime..."
$nodeDir = Split-Path -Parent $nodeCmd.Source
Copy-Item -LiteralPath (Join-Path $nodeDir "node.exe") -Destination (Join-Path $nodeRuntimeDir "node.exe") -Force
foreach ($extra in @("npm.cmd", "npx.cmd", "npm", "npx", "corepack.cmd", "corepack")) {
  $candidate = Join-Path $nodeDir $extra
  if (Test-Path $candidate) {
    Copy-Item -LiteralPath $candidate -Destination (Join-Path $nodeRuntimeDir $extra) -Force -ErrorAction SilentlyContinue
  }
}
Get-ChildItem -LiteralPath $nodeDir -Filter "*.dll" -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $nodeRuntimeDir $_.Name) -Force
}

# ── Copy monorepo source (without node_modules / build artifacts) ─────────────
Write-Host "Copying project source..."

$excludeDirs = @(
  ".git",
  ".omx",
  ".turbo",
  ".wrangler",
  ".open-next",
  ".next",
  "coverage",
  "dist",
  "graphify-out",
  "playwright-report",
  "test-results",
  ".agents",
  ".codex",
  ".mimocode",
  "node_modules",
  $OutputDir,
  (Join-Path $packageRoot "offline"),
  (Join-Path $packageRoot "offline-zip")
)

$xdArgs = @($excludeDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

$rcArgs = @(
  $repoRoot,
  $appDir,
  "/E",
  "/COPY:DAT",
  "/R:1",
  "/W:1",
  "/NFL",
  "/NDL",
  "/NJH",
  "/NJS",
  "/NP",
  "/XD"
) + $xdArgs + @(
  "/XF",
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  "*.tsbuildinfo",
  "dev-server.*.log"
)

$rc = Start-Process -FilePath "robocopy.exe" -ArgumentList $rcArgs -Wait -PassThru -NoNewWindow
if ($rc.ExitCode -ge 8) {
  throw "robocopy failed with exit code $($rc.ExitCode)."
}

$mustExist = @(
  (Join-Path $appDir "package.json"),
  (Join-Path $appDir "bun.lock"),
  (Join-Path $appDir "apps\web\package.json"),
  (Join-Path $appDir "apps\worker\package.json"),
  (Join-Path $appDir "scripts\start-local.ps1")
)
foreach ($path in $mustExist) {
  if (!(Test-Path $path)) {
    throw "Pack incomplete: missing $path"
  }
}

# ── Offline-capable dependency install into the package ───────────────────────
# Uses a package-local Bun cache so the target host can re-link node_modules
# without the registry (junctions are absolute and must be rebuilt after move).
Write-Host "Installing dependencies into package (fills local cache)..."
$env:BUN_INSTALL_CACHE_DIR = $cacheDir
$env:PATH = "$runtimeDir;$nodeRuntimeDir;" + $env:PATH

Push-Location $appDir
try {
  & (Join-Path $runtimeDir "bun.exe") install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) {
    throw "bun install failed inside offline package (exit $LASTEXITCODE)."
  }

  Write-Host "Warming wrangler/workerd..."
  Push-Location (Join-Path $appDir "apps\worker")
  try {
    & (Join-Path $runtimeDir "bun.exe") x wrangler --version
  } catch {
    Write-Warning "wrangler warm-up failed: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }

  # Verify offline install works against the local cache only.
  # Only remove workspace node_modules - never wipe .next/standalone later.
  Write-Host "Verifying offline install..."
  . (Join-Path $packageRoot "lib\Install-OfflineDeps.ps1")
  Remove-RadioboiWorkspaceNodeModules -RepoRoot $appDir

  & (Join-Path $runtimeDir "bun.exe") install --frozen-lockfile --offline
  if ($LASTEXITCODE -ne 0) {
    throw "Offline bun install verification failed (exit $LASTEXITCODE). Cache may be incomplete."
  }

  # Prebuild production standalone web so the air-gapped host can start without
  # `next dev` / Turbopack. Leave NEXT_PUBLIC_WS_URL unset for IP-agnostic LAN
  # (client uses page hostname + port 8787).
  Write-Host "Building production web (standalone, dynamic WS host)..."
  Remove-Item Env:\NEXT_PUBLIC_WS_URL -ErrorAction SilentlyContinue
  $env:NEXT_PUBLIC_WS_PORT = "8787"
  & (Join-Path $runtimeDir "bun.exe") run build
  if ($LASTEXITCODE -ne 0) {
    throw "Production build failed inside offline package (exit $LASTEXITCODE)."
  }
  $standaloneServer = Join-Path $appDir "apps\web\.next\standalone\apps\web\server.js"
  if (!(Test-Path $standaloneServer)) {
    # Next may nest under standalone\<relative-from-parent-lockfile>\... when the
    # offline app is still under the monorepo tree. Normalize to expected path.
    $standaloneBase = Join-Path $appDir "apps\web\.next\standalone"
    $found = Get-ChildItem -LiteralPath $standaloneBase -Recurse -Filter "server.js" -ErrorAction SilentlyContinue |
      Where-Object { $_.DirectoryName -match '[\\/]apps[\\/]web$' } |
      Select-Object -First 1
    if ($null -eq $found) {
      throw "Pack incomplete: missing standalone server under $standaloneBase"
    }
    Write-Warning "Standalone path was nested ($($found.FullName)); normalizing..."
    $srcWeb = $found.Directory.FullName
    $dstWeb = Join-Path $standaloneBase "apps\web"
    $parentOfApps = (Resolve-Path (Join-Path $srcWeb "..\..")).Path
    robocopy.exe $parentOfApps $standaloneBase /E /MOVE /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    $nestedJunk = Join-Path $standaloneBase "local-server"
    if (Test-Path $nestedJunk) {
      Remove-Item -LiteralPath $nestedJunk -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (!(Test-Path $standaloneServer)) {
      $nmSrc = Join-Path $parentOfApps "node_modules"
      New-Item -ItemType Directory -Force -Path $dstWeb | Out-Null
      robocopy.exe $srcWeb $dstWeb /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
      if (Test-Path $nmSrc) {
        $nmDst = Join-Path $standaloneBase "node_modules"
        robocopy.exe $nmSrc $nmDst /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
      }
    }
    if (!(Test-Path $standaloneServer)) {
      throw "Pack incomplete: could not normalize standalone server to $standaloneServer"
    }
    Write-Host "Standalone normalized to $standaloneServer"
  }

  # Bun junctions must become real files before zip/copy or the air-gapped host
  # fails with MODULE_NOT_FOUND (@swc/helpers, next, ...).
  Write-Host "Repairing standalone for portable Node (materialize + hoist)..."
  Push-Location (Join-Path $appDir "apps\web")
  try {
    & (Join-Path $runtimeDir "node\node.exe") ".\scripts\repair-standalone.mjs"
    if ($LASTEXITCODE -ne 0) {
      throw "repair-standalone.mjs failed with exit $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }

  # Verify Node can resolve critical modules WITHOUT following monorepo junctions
  # (simulate portable layout by requiring from standalone apps/web).
  Write-Host "Verifying standalone module resolution..."
  $verifyJs = @'
const { createRequire } = require("module");
const path = require("path");
const server = path.resolve("apps/web/.next/standalone/apps/web/server.js");
const req = createRequire(server);
for (const id of ["next", "@swc/helpers/_/_interop_require_default", "react", "react-dom"]) {
  try {
    console.log("OK", id, "->", req.resolve(id));
  } catch (e) {
    console.error("FAIL", id, e.message);
    process.exit(1);
  }
}
'@
  $verifyPath = Join-Path $appDir ".pack-verify-standalone.js"
  Set-Content -LiteralPath $verifyPath -Value $verifyJs -Encoding UTF8
  try {
    & (Join-Path $runtimeDir "node\node.exe") $verifyPath
    if ($LASTEXITCODE -ne 0) {
      throw "Standalone module verification failed."
    }
  } finally {
    Remove-Item -LiteralPath $verifyPath -Force -ErrorAction SilentlyContinue
  }

  # Marker so first start on the packing path skips reinstall.
  # After the folder is copied elsewhere, start.ps1 re-links and rewrites it.
  Write-RadioboiOfflineInstallMarker -RepoRoot $appDir -CacheDir $cacheDir
  Write-Host "Production web build ready."
} finally {
  Pop-Location
}

if (-not $KeepHostNodeModules) {
  # Keep node_modules from the verified offline install (correct for current path).
  # On the target server, start.ps1 re-runs offline install to repair junctions after copy.
  Write-Host "Dependencies installed and verified offline."
}

# ── Copy launcher scripts into package root ───────────────────────────────────
Write-Host "Copying launchers..."
foreach ($name in @(
    "start.ps1",
    "stop.ps1",
    "allow-firewall.ps1",
    "verify.ps1",
    "start.bat",
    "stop.bat",
    "allow-firewall.bat",
    "verify.bat"
  )) {
  $src = Join-Path $packageRoot $name
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $OutputDir $name) -Force
  }
}
$libDst = Join-Path $OutputDir "lib"
New-Item -ItemType Directory -Force -Path $libDst | Out-Null
Copy-Item -LiteralPath (Join-Path $packageRoot "lib\Resolve-RadioboiPaths.ps1") -Destination (Join-Path $libDst "Resolve-RadioboiPaths.ps1") -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "lib\Install-OfflineDeps.ps1") -Destination (Join-Path $libDst "Install-OfflineDeps.ps1") -Force
$prodDoc = Join-Path $packageRoot "PRODUCTION-OFFLINE.md"
if (Test-Path $prodDoc) {
  Copy-Item -LiteralPath $prodDoc -Destination (Join-Path $OutputDir "PRODUCTION-OFFLINE.md") -Force
}

$offlineReadme = @"
# Radioboi - production offline LAN-сервер (Windows)

Каталог **самодостаточный**. Скопируйте его на ПК **без интернета** и запустите игру.

Подробная инструкция в monorepo: ``local-server/PRODUCTION-OFFLINE.md``
(если открываете пакет отдельно - достаточно шагов ниже).

## Состав

| Путь | Содержимое |
|------|------------|
| ``runtime\`` | Bun + Node (системная установка не нужна) |
| ``cache\`` | Кэш пакетов Bun для офлайн-установки |
| ``app\`` | Исходники + ``bun.lock`` + ``node_modules`` + **production** standalone |
| ``start.bat`` | Запуск (production web + wrangler worker) |
| ``stop.bat`` | Остановка |
| ``verify.bat`` | Проверка целостности пакета |
| ``allow-firewall.bat`` | Брандмауэр (от администратора) |
| ``VERSION.txt`` | Дата сборки, версии Bun/Node |

## Быстрый старт на сервере без интернета

1. Скопируйте **всю** эту папку (или распакуйте zip), например в ``D:\Radioboi-LAN\``.
2. (Опционально) ``verify.bat`` - структура и runtime.
3. **Один раз** от администратора: ``allow-firewall.bat``
4. ``start.bat``
   - После копирования на новый путь зависимости перепривяжутся офлайн (1-3 мин).
   - Web = **production** (Next standalone), worker = локальный wrangler.
5. Откройте ``http://<IP-сервера>:3000`` с любого устройства в LAN.
6. ``stop.bat`` - остановка.

Smoke-тест (локальный HTTP): ``verify.bat smoke``

Dev-режим (не production): ``powershell -File .\start.ps1 -Dev``

## IP

Сервер слушает все интерфейсы (``0.0.0.0``).
WebSocket = **тот же хост**, что в адресной строке браузера + порт ``8787``.
IP сервера может быть любым - перенастройка не нужна.

## Порты

```bat
start.bat
start.bat 3000 8787
start.bat 3001 8788
start.bat 3000 8787 192.168.1.10
```

## Важно

- Не удаляйте ``runtime``, ``cache``, ``app``.
- Не нужен интернет и не нужен ``bun install`` вручную.
- Только **Windows x64**.
- Комнаты create/join работают **без Cloudflare KV** (локальный код комнаты).
- Пакет собран ``local-server\pack.ps1`` / ``bun run server:pack`` на машине с интернетом.
"@
Set-Content -LiteralPath (Join-Path $OutputDir "README.md") -Value $offlineReadme -Encoding UTF8

$bunVer = & (Join-Path $runtimeDir "bun.exe") --version
$nodeVer = & (Join-Path $nodeRuntimeDir "node.exe") --version
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
$versionText = @"
Radioboi offline LAN package
PackedAt: $stamp
Bun: $bunVer
Node: $nodeVer
Source: $repoRoot
Cache: package-local (BUN_INSTALL_CACHE_DIR=cache)
WS: IP-agnostic (page hostname + port 8787)
Web: production standalone prebuilt
"@
Set-Content -LiteralPath (Join-Path $OutputDir "VERSION.txt") -Value $versionText -Encoding UTF8
Set-Content -LiteralPath (Join-Path $OutputDir "OFFLINE_PACKAGE") -Value "1" -Encoding ASCII

function Get-DirSizeMB([string]$Path) {
  if (!(Test-Path $Path)) { return 0 }
  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return [math]::Round($sum / 1MB, 1)
}

Write-Host ""
Write-Host "Package ready: $OutputDir"
Write-Host ("Size app/:     {0} MB" -f (Get-DirSizeMB $appDir))
Write-Host ("Size cache/:   {0} MB" -f (Get-DirSizeMB $cacheDir))
Write-Host ("Size runtime/: {0} MB" -f (Get-DirSizeMB $runtimeDir))
Write-Host ("Size total:    {0} MB" -f (Get-DirSizeMB $OutputDir))

if (-not $SkipZip) {
  $zipDir = Join-Path $packageRoot "offline-zip"
  New-Item -ItemType Directory -Force -Path $zipDir | Out-Null
  $zipPath = Join-Path $zipDir ("Radioboi-LAN-Offline-win64-{0}.zip" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Write-Host "Creating zip: $zipPath"
  if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  $tar = Get-Command tar -ErrorAction SilentlyContinue
  if ($null -ne $tar) {
    Push-Location $OutputDir
    try {
      & tar -a -cf $zipPath *
      if ($LASTEXITCODE -ne 0) { throw "tar zip failed with exit $LASTEXITCODE" }
    } finally {
      Pop-Location
    }
  } else {
    Compress-Archive -Path (Join-Path $OutputDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
  }
  if (Test-Path $zipPath) {
    Write-Host ("Zip size: {0} MB" -f ([math]::Round((Get-Item $zipPath).Length / 1MB, 1)))
    Write-Host "Zip: $zipPath"
  }
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Copy: $OutputDir"
Write-Host "  2. On offline server: allow-firewall.bat (Admin), then start.bat"
Write-Host "Done."
