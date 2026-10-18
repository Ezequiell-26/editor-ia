$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

Write-Host "Installing JavaScript workspace dependencies..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

Write-Host "Building the Windows desktop bundle..." -ForegroundColor Cyan
npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw "Tauri bundle failed with exit code $LASTEXITCODE" }

$bundle = Join-Path $PSScriptRoot "..\target\release\bundle\nsis"
$installers = @(Get-ChildItem -Path $bundle -Filter "*.exe" -File -ErrorAction SilentlyContinue)
if ($installers.Count -eq 0) { throw "Tauri build completed but no NSIS installer was found at $bundle" }
$installers | ForEach-Object { Write-Host "Installer: $($_.FullName) ($($_.Length) bytes)" }
