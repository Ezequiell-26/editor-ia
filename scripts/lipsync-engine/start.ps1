# Arranca el adaptador local de lip-sync (Wav2Lip) para Editor IA.
#
# Uso normal:
#   powershell -ExecutionPolicy Bypass -File scripts/lipsync-engine/start.ps1
#
# Variables opcionales:
#   $env:WAV2LIP_DIR      carpeta del repo Wav2Lip
#   $env:LIPSYNC_PYTHON   intérprete con torch/opencv/librosa/face-alignment
#   $env:LIPSYNC_PORT     puerto (8765 por defecto)
param(
  [int]$Port = $(if ($env:LIPSYNC_PORT) { [int]$env:LIPSYNC_PORT } else { 8765 })
)

$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = if ($env:LIPSYNC_PYTHON) {
  $env:LIPSYNC_PYTHON
} else {
  'D:\Users\ofici\IA_CENTRAL\04_APLICACIONES_IA\LipSyncEngine\venv\Scripts\python.exe'
}
$server = Join-Path $PSScriptRoot 'server.py'

if (-not (Test-Path $python)) {
  throw "No se encontró el intérprete del motor: $python. Definí LIPSYNC_PYTHON."
}
if (-not (Test-Path $server)) {
  throw "No se encontró el adaptador: $server"
}

Write-Host "Editor IA · motor de lip-sync local" -ForegroundColor Cyan
Write-Host "Puerto: $Port · loopback únicamente"
Write-Host "Licencia: Wav2Lip es sólo para uso personal/investigación, no comercial." -ForegroundColor Yellow
Write-Host "Dejá esta ventana abierta mientras sincronizás labios en la app."

& $python $server --port $Port
