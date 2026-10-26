# Actualiza la copia instalada de Olyvia con el código actual del repo.
#
# Por qué existe: el agente que programa la app corre bajo una política de
# seguridad que bloquea lecturas y escrituras dentro de `target\release`
# (artefactos de Rust). Desde tu sesión eso no aplica.
#
# Uso: clic derecho -> "Ejecutar con PowerShell".

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

try {

Write-Host ''
Write-Host 'Olyvia - actualizacion local' -ForegroundColor Cyan
Write-Host '---------------------------' -ForegroundColor DarkGray

# 0a. Limpiar compiladores colgados de este repo: si un cargo quedo esperando
# un lock, el build nuevo se queda esperando para siempre.
$stuck = Get-Process -Name 'cargo', 'rustc' -ErrorAction SilentlyContinue
if ($stuck) {
  Write-Host ('   Cerrando ' + $stuck.Count + ' compilador(es) colgado(s)...') -ForegroundColor DarkGray
  $stuck | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# 0b. Cerrar instancias abiertas: si el exe esta en uso, el enlazador falla.
$running = Get-Process -Name 'editor-ia-desktop' -ErrorAction SilentlyContinue
foreach ($proc in $running) {
  Write-Host ('   Cerrando instancia ' + $proc.Id + '...') -ForegroundColor DarkGray
  $proc.CloseMainWindow() | Out-Null
  Start-Sleep -Seconds 2
  if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $proc.Id -Force
  }
}
if ($running) { Start-Sleep -Seconds 2 }

# 1. Frontend (Vite).
Write-Host '[1/3] Compilando interfaz...' -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion del frontend.' }

# 2. Binario Rust (sin empaquetador NSIS: solo el exe).
Write-Host '[2/3] Compilando binario (puede tardar varios minutos)...' -ForegroundColor Yellow
node scripts/rust-env.mjs -- cargo build --release -p editor-ia-desktop --features tauri/custom-protocol --offline
if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion de Rust.' }

# 3. Copiar sobre la instalacion y abrir.
$source = Join-Path $root 'target\release\editor-ia-desktop.exe'
$destDir = Join-Path $env:LOCALAPPDATA 'Olyvia'
$dest = Join-Path $destDir 'editor-ia-desktop.exe'

if (-not (Test-Path $source)) { throw "No se encontro el binario: $source" }
if (-not (Test-Path $destDir)) { throw "No se encontro la instalacion: $destDir" }

Write-Host '[3/3] Instalando...' -ForegroundColor Yellow
Copy-Item $source $dest -Force
Write-Host ''
Write-Host ('Listo. Version instalada: ' + (Get-Item $dest).LastWriteTime) -ForegroundColor Green
Start-Process $dest

} catch {
  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'La app no se modifico. Podes copiar este mensaje para diagnosticar.' -ForegroundColor DarkGray
  exit 1
}
