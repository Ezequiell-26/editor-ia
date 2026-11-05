$dir = 'C:\Users\ofici\AppData\Local\Olyvia'
$exe = Join-Path $dir 'editor-ia-desktop.exe'

# cerrar la instancia actual
$run = Get-Process -Name 'editor-ia-desktop' -ErrorAction SilentlyContinue
if ($run) { $run | Stop-Process -Force; Start-Sleep -Seconds 3 }

# relaizar con CDP habilitado en WebView2 (el runtime de Tauri en Windows)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222 --remote-allow-origins=*'
$p = Start-Process -FilePath $exe -PassThru
Write-Output "PID=$($p.Id)"
Start-Sleep -Seconds 12

$ok = $null
try { $ok = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 5 } catch { }
if ($null -eq $ok) { Write-Output 'CDP=NO_DISPONIBLE'; exit 1 }

$json = $ok.Content | ConvertFrom-Json
Write-Output "CDP=OK browser=$($json.Browser)"
$targets = (Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json' -UseBasicParsing).Content | ConvertFrom-Json
$targets | ForEach-Object { Write-Output "TARGET type=$($_.type) title=$($_.title)" }
