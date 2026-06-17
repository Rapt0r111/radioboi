param(
  [switch]$SkipInstall,
  [switch]$SkipE2E
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

function Invoke-Step {
  param(
    [string]$Name,
    [string[]]$Command
  )

  Write-Host ""
  Write-Host "==> $Name"
  $args = @($Command | Select-Object -Skip 1)
  & $Command[0] @args
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Name"
  }
}

if (-not $SkipInstall) {
  Invoke-Step "Install locked dependencies" @("bun", "install", "--frozen-lockfile")
}

Invoke-Step "Lint" @("bun", "run", "lint")
Invoke-Step "Type check" @("bun", "run", "type-check")
Invoke-Step "Unit and package tests" @("bun", "run", "test")
Invoke-Step "Production build" @("bun", "run", "build")

if (-not $SkipE2E) {
  Invoke-Step "Playwright e2e" @("bun", "run", "test:e2e")
}

Write-Host ""
Write-Host "Release checks passed."
