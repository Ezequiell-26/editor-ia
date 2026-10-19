# Construye el instalador NSIS local de Editor IA con el mismo camino que CI.
# Falla si el bundle no existe: no hay verde sin instalador real.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

Write-Host '==> npm run verify'
& npm run verify
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

Write-Host '==> build del instalador Tauri'
& node scripts/rust-env.mjs -- npm --workspace @editor-ia/desktop run tauri:build
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

$bundleDir = Join-Path (Get-Location) 'target\release\bundle\nsis'
if (-not (Test-Path -LiteralPath $bundleDir)) {
  Write-Host "Fallo: no existe $bundleDir"
  exit 2
}

$installers = @(Get-ChildItem -LiteralPath $bundleDir -Filter '*.exe' -File | Where-Object { $_.Length -gt 1MB })
if ($installers.Count -eq 0) {
  Write-Host 'Fallo: el bundle NSIS no produjo un instalador de mas de 1 MB'
  exit 3
}

foreach ($item in $installers) {
  Write-Host "Instalador: $($item.FullName) ($([math]::Round($item.Length / 1MB, 1)) MB)"
}

exit 0
