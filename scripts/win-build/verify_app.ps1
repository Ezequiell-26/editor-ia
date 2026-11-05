$p = Get-Process -Name editor-ia-desktop -ErrorAction SilentlyContinue
if ($null -eq $p) { Write-Output "STATUS=NO-CORRE"; exit 1 }

$totCpu = ($p | Measure-Object -Property CPU -Sum).Sum
$totRam = [math]::Round((($p | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB, 1)
Write-Output "PROCESO=VIVO instancias=$($p.Count) CPU_ACUM_s=$([math]::Round($totCpu,1)) RAM_TOTAL_MB=$totRam"

$children = Get-CimInstance Win32_Process -Filter "Name='olyvia-render-worker.exe' OR Name='ffmpeg.exe'" -ErrorAction SilentlyContinue
Write-Output "HIJOS_MEDIA=$($children.Count)"
$children | ForEach-Object { Write-Output "  - $($_.Name) pid=$($_.ProcessId)" }

$t = Get-Process -Id $p[0].Id
Start-Sleep -Seconds 6
$cpu2 = (Get-Process -Id $p[0].Id).CPU - $t.CPU
Write-Output "CPU_ULTIMOS_6s=$([math]::Round($cpu2,2))s (reposo esperado ~0)"
