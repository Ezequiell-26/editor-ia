# Construye el instalador NSIS local de Editor IA con el mismo camino que CI.
# Falla si el bundle no existe: no hay verde sin instalador real.
#
# -Provision: antes del build descarga/genera los recursos pesados que el repo
# no versiona (FFmpeg estático, yt-dlp, ONNX Runtime, Piper, DLLs dev de
# FFmpeg y SFX). Sin el switch, el preflight estático falla listando qué falta
# y qué comando lo provee.

param([switch]$Provision)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

Write-Host '==> npm run verify'
& npm run verify
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

Write-Host '==> build del concat-worker (release)'
& node scripts/rust-env.mjs -- cargo build --release --manifest-path apps/concat-worker/Cargo.toml
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

if ($Provision) {
  Write-Host '==> provisiona recursos del bundle (-Provision)'
  & node scripts/setup-ffmpeg-dev.mjs --quiet
  $code = $LASTEXITCODE
  if ($code -ne 0) { exit $code }
  & bash scripts/ci-bundle-resources.sh
  $code = $LASTEXITCODE
  if ($code -ne 0) { exit $code }
}

Write-Host '==> genera efectos de sonido (sintesis determinista)'
& node scripts/generate-sfx.mjs
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

Write-Host '==> verificacion estatica de recursos declarados en tauri.conf.json'
& node scripts/check-bundle-resources.mjs
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

Write-Host '==> build del instalador Tauri (sin firma: no hay certificado local)'
& node scripts/rust-env.mjs -- npm --workspace @editor-ia/desktop run tauri:build -- --no-sign
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
