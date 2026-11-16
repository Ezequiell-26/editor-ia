# Corre desde cualquier worktree/clon del repo: la raiz se deriva de la
# ubicacion de este script (scripts/win-build -> raiz del repo).
$repo   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nsis   = Join-Path $repo 'target\release\bundle\nsis'
# Acepta cualquier Olyvia_*_x64-setup.exe generado por tauri build (la version
# del nombre cambia con el crate).
$setup  = Get-ChildItem -Path $nsis -Filter 'Olyvia_*_x64-setup.exe' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
$dir    = 'C:\Users\ofici\AppData\Local\Olyvia'
$exe    = Join-Path $dir 'editor-ia-desktop.exe'

if (-not (Test-Path $setup)) { Write-Output "ERROR: no hay instalador en $setup"; exit 1 }

# 1) cerrar la instancia que abrimos nosotros (bloquea el overwrite del exe)
$run = Get-Process -Name 'editor-ia-desktop','olyvia-render-worker' -ErrorAction SilentlyContinue
if ($run) {
    $run | ForEach-Object { Write-Output "CIERRE pid=$($_.Id) $($_.ProcessName)" }
    $run | Stop-Process -Force
    Start-Sleep -Seconds 3
} else { Write-Output "CIERRE=no-había-nada-abierto" }

$antes = if (Test-Path $exe) { (Get-Item $exe).LastWriteTime.ToString('HH:mm:ss') } else { 'no-existía' }

# 2) instalar en silencio
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Write-Output "NSIS_EXIT=$($p.ExitCode)"
Start-Sleep -Seconds 2

# 3) verificar que el exe cambió
if (Test-Path $exe) {
    $it = Get-Item $exe
    $despues = $it.LastWriteTime.ToString('HH:mm:ss')
    Write-Output "EXE_antes=$antes EXE_despues=$despues MB=$([math]::Round($it.Length/1MB,1))"
    if ($despues -eq $antes) { Write-Output "AVISO: el exe no cambió de timestamp" }
} else {
    Write-Output "ERROR: no quedó exe instalado"; exit 2
}

# 4) abrir y medir
$started = Start-Process -FilePath $exe -PassThru
Write-Output "PID=$($started.Id)"
Start-Sleep -Seconds 12

$a = Get-Process -Id $started.Id -ErrorAction SilentlyContinue
if ($null -eq $a) { Write-Output 'STATUS=SE-CERRO'; exit 3 }
$ram1 = [math]::Round($a.WorkingSet64/1MB,1); $cpu1 = $a.CPU
Start-Sleep -Seconds 6
$b = Get-Process -Id $started.Id -ErrorAction SilentlyContinue
if ($null -eq $b) { Write-Output 'STATUS=SE-CERRO-EN-MEDICION'; exit 3 }
$ram2 = [math]::Round($b.WorkingSet64/1MB,1); $cpu2 = $b.CPU - $cpu1
Write-Output "STATUS=VIVO ventana='$($b.MainWindowTitle)' RAM_MB=$ram2 (antes $ram1) CPU_ultimos6s=$([math]::Round($cpu2,2))s"
