$exe = 'C:\Users\ofici\AppData\Local\Olyvia\editor-ia-desktop.exe'
if (-not (Test-Path $exe)) { Write-Output "ERROR: no existe $exe"; exit 1 }

$p = Start-Process -FilePath $exe -PassThru
Write-Output "PID=$($p.Id)"
Start-Sleep -Seconds 10

$procs = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($null -eq $procs) {
    Write-Output "STATUS=SE-CERRO (el proceso ya no existe)"
    Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2; StartTime=(Get-Date).AddMinutes(-5)} -MaxEvents 5 -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'editor-ia|olyvia' } |
        ForEach-Object { Write-Output "EVENTO: $($_.Message.Substring(0,[Math]::Min(300,$_.Message.Length)))" }
    exit 2
}

$ram = [math]::Round($procs.WorkingSet64 / 1MB, 1)
Write-Output "STATUS=VIVO RAM_MB=$ram HOURS=$([math]::Round(((Get-Date) - $procs.StartTime).TotalSeconds,1))s"
Write-Output "MAIN_WINDOW_TITLE=$($procs.MainWindowTitle)"
