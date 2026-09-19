# Build a fully offline portable LAN server package for Windows 8.1 (build 9600).
#
# Run on a machine WITH internet (Windows 10/11, Bun installed).
# Result: local-server\offline\  - copy that entire folder to the air-gapped server.
#
# The package includes:
#   runtime\node\   Node.js 18.20.8 + Universal CRT DLLs (no Bun/wrangler)
#   app\apps\web\out                static Next export
#   app\apps\worker\dist\lan-server.cjs
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

$node18Version = "18.20.8"
$node18ZipName = "node-v$node18Version-win-x64.zip"
$node18Url = "https://nodejs.org/dist/v$node18Version/$node18ZipName"

function Install-Win81NodeRuntime([string]$Destination) {
  Write-Host "Downloading Node.js v$node18Version (last official Windows 8.1 runtime)..."
  $tmpRoot = Join-Path $env:TEMP ("radioboi-node18-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
  $zipPath = Join-Path $tmpRoot $node18ZipName
  try {
    Invoke-WebRequest -Uri $node18Url -OutFile $zipPath -UseBasicParsing
    $extractDir = Join-Path $tmpRoot "extract"
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    $tar = Get-Command tar -ErrorAction SilentlyContinue
    if ($null -ne $tar) {
      & tar -xf $zipPath -C $extractDir
    } else {
      Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    }
    $payload = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
    if ($null -eq $payload) {
      throw "Node 18 zip did not contain a directory."
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $payload.FullName -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Recurse -Force
    }

    $sys32 = Join-Path $env:SystemRoot "System32"
    # Only the VC++ runtime (PE OS 6.0). Do NOT copy Windows 10 System32
    # ucrtbase.dll — it is OS=10.0 and can fail to load on Windows 8.1.
    # Node 18.20.8 officially supports 8.1; if node.exe still needs UCRT,
    # install KB2999226 on the target PC.
    $ucrt = @(
      "vcruntime140.dll",
      "vcruntime140_1.dll",
      "msvcp140.dll",
      "concrt140.dll"
    )
    foreach ($dll in $ucrt) {
      $src = Join-Path $sys32 $dll
      if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $Destination $dll) -Force
      }
    }
  } finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  $nodeExe = Join-Path $Destination "node.exe"
  if (!(Test-Path $nodeExe)) {
    throw "Node 18 download finished but node.exe is missing at $nodeExe"
  }
  $ver = & $nodeExe --version
  Write-Host "Bundled Node runtime: $ver"
}

# ── Clean output ──────────────────────────────────────────────────────────────
if (Test-Path $OutputDir) {
  Write-Host "Removing previous package at $OutputDir ..."
  Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $appDir, $runtimeDir, $nodeRuntimeDir, $cacheDir | Out-Null

# ── Copy runtimes (Node 18.20.8 — last official Windows 8.1 / build 9600) ─────
Install-Win81NodeRuntime -Destination $nodeRuntimeDir

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

# ── Build Windows 8.1 artifacts on the packing machine (Bun + internet) ───────
# Target host runs Node 18 only: static web export + bundled lan-server.cjs.
Write-Host "Building LAN static web (Chrome 109 / Firefox 115 / Windows 8.1)..."
$env:RADIOBOI_LAN_STATIC = "1"
$env:NEXT_PUBLIC_LAN_STATIC = "1"
$env:NEXT_PUBLIC_WS_PORT = "8787"
Remove-Item Env:\NEXT_PUBLIC_WS_URL -ErrorAction SilentlyContinue

Push-Location (Join-Path $repoRoot "apps\web")
try {
  & bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "LAN static web build failed (exit $LASTEXITCODE)."
  }
} finally {
  Pop-Location
}

Write-Host "Bundling Node LAN worker..."
Push-Location (Join-Path $repoRoot "apps\worker")
try {
  & bun run build:lan
  if ($LASTEXITCODE -ne 0) {
    throw "LAN worker bundle failed (exit $LASTEXITCODE)."
  }
} finally {
  Pop-Location
}

$webOutSrc = Join-Path $repoRoot "apps\web\out"
$lanServerSrc = Join-Path $repoRoot "apps\worker\dist\lan-server.cjs"
if (!(Test-Path (Join-Path $webOutSrc "index.html"))) {
  throw "Pack incomplete: missing static export $webOutSrc\index.html"
}
if (!(Test-Path $lanServerSrc)) {
  throw "Pack incomplete: missing $lanServerSrc"
}

$webOutDst = Join-Path $appDir "apps\web\out"
$lanServerDstDir = Join-Path $appDir "apps\worker\dist"
New-Item -ItemType Directory -Force -Path $webOutDst, $lanServerDstDir | Out-Null
robocopy.exe $webOutSrc $webOutDst /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
Copy-Item -LiteralPath $lanServerSrc -Destination (Join-Path $lanServerDstDir "lan-server.cjs") -Force

$env:PATH = "$nodeRuntimeDir;" + $env:PATH
$smokeNode = Join-Path $nodeRuntimeDir "node.exe"
& $smokeNode "--check" (Join-Path $lanServerDstDir "lan-server.cjs")
if ($LASTEXITCODE -ne 0) {
  throw "Bundled lan-server.cjs failed Node syntax check."
}

Write-Host "Windows 8.1 LAN artifacts ready (no Bun/wrangler on the target)."


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
# Radioboi - production offline LAN-сервер (Windows 8.1 / 10 / 11)

Каталог **самодостаточный**. Скопируйте его на ПК **без интернета** и запустите игру.
Целевая ОС сервера: **Windows 8.1 build 9600** (x64) и новее.

Подробная инструкция в monorepo: ``local-server/PRODUCTION-OFFLINE.md``
(если открываете пакет отдельно - достаточно шагов ниже).

## Состав

| Путь | Содержимое |
|------|------------|
| ``runtime\node\`` | Node.js 18.20.8 + Universal CRT (системная установка не нужна) |
| ``app\apps\web\out\`` | Статический UI (Chrome 109 / Firefox 115 ESR) |
| ``app\apps\worker\dist\lan-server.cjs`` | Игровой WebSocket-сервер на Node |
| ``start.bat`` | Запуск |
| ``stop.bat`` | Остановка |
| ``verify.bat`` | Проверка целостности пакета |
| ``allow-firewall.bat`` | Брандмауэр (от администратора) |
| ``VERSION.txt`` | Дата сборки и версия Node |

## Браузер на Windows 8.1

Последние браузеры для этой ОС: **Chrome 109** или **Firefox 115 ESR**.
IE 11 и старый EdgeHTML не поддерживаются.

## Быстрый старт на сервере без интернета

1. Скопируйте **всю** эту папку (или распакуйте zip), например в ``D:\Radioboi-LAN\``.
2. (Опционально) ``verify.bat`` - структура и runtime.
3. **Один раз** от администратора: ``allow-firewall.bat``
4. ``start.bat``
5. Откройте ``http://<IP-сервера>:3000`` с любого устройства в LAN.
6. ``stop.bat`` - остановка.

Smoke-тест (локальный HTTP): ``verify.bat smoke``

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

- Не удаляйте ``runtime`` и ``app``.
- Не нужен интернет, Bun и wrangler на сервере.
- Только **Windows x64**.
- Если node.exe не стартует: установите обновление KB2999226 (Universal C Runtime).
- Комнаты create/join работают без Cloudflare KV.
- Пакет собран ``local-server\pack.ps1`` / ``bun run server:pack`` на машине с интернетом.
"@
Set-Content -LiteralPath (Join-Path $OutputDir "README.md") -Value $offlineReadme -Encoding UTF8

$nodeVer = & (Join-Path $nodeRuntimeDir "node.exe") --version
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
$versionText = @"
Radioboi offline LAN package (Windows 8.1 build 9600)
PackedAt: $stamp
Node: $nodeVer (official last Win8.1: 18.20.8)
Source: $repoRoot
WS: IP-agnostic (page hostname + port 8787)
Web: static export (RADIOBOI_LAN_STATIC=1)
Worker: Node lan-server.cjs (no wrangler/workerd)
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
