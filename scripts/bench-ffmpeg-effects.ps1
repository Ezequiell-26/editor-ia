# Benchmark reproducible del motor FFmpeg con y sin efectos.
# Mide pared, CPU del proceso, pico de memoria y GPU 3D del proceso (no estimaciones).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bench-ffmpeg-effects.ps1
param(
  [string]$Ffmpeg = "",
  [int]$Seconds = 5,
  [string]$Resolution = "1920x1080"
)

$ErrorActionPreference = "Stop"
$root = Join-Path $env:TEMP ("olyvia-bench-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $root | Out-Null

if (-not $Ffmpeg) {
  $bundled = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\resources\ffmpeg\ffmpeg.exe"
  if (Test-Path $bundled) { $Ffmpeg = (Resolve-Path $bundled).Path }
  else { $Ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source }
}

$source = Join-Path $root "input.mp4"
$filter = "colorbalance=rs=0.02:gs=0:bs=-0.02," +
  "colorlevels=rimin=0.037:gimin=0.037:bimin=0.037:rimax=0.963:gimax=0.963:bimax=0.963," +
  "hue=s=1.08,unsharp=5:5:0.6:5:5:0,vignette=PI/4.5,gblur=sigma=2," +
  "noise=alls=8:allf=t+u,format=yuv420p"

& $Ffmpeg -hide_banner -v error -y -f lavfi -i "testsrc2=s=${Resolution}:r=30:d=$Seconds" `
  -f lavfi -i "sine=frequency=440:duration=$Seconds" -c:v libopenh264 -b:v 12000000 `
  -c:a aac -shortest $source
if ($LASTEXITCODE -ne 0) { throw "no se pudo generar el clip base" }

function Invoke-Case {
  param([string]$Name, [string[]]$Extra, [string]$Encoder = "cpu")
  $output = Join-Path $root "$Name.mp4"
  $stderr = Join-Path $root "$Name.log"
  $codecArgs = if ($Encoder -eq "amf") {
    @("-c:v", "h264_amf", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20", "-quality", "quality")
  } else {
    @("-c:v", "libopenh264", "-b:v", "8000000")
  }
  $ffArgs = @("-hide_banner", "-v", "error", "-y", "-i", $source) + $Extra + $codecArgs + @(
    "-c:a", "aac", "-b:a", "128k", $output
  )
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $Ffmpeg -ArgumentList $ffArgs -PassThru -NoNewWindow -RedirectStandardError $stderr
  # Get-Counter bloquea ~1-2 s por lectura: va en un job aparte para no perder
  # las muestras de CPU/RAM del bucle principal (100 ms).
  $gpuJob = $null
  if ($Encoder -eq "amf") {
    $gpuJob = Start-Job -ScriptBlock {
      param([string]$TargetId)
      $vals = @()
      while (Get-Process -Id ([int]$TargetId) -ErrorAction SilentlyContinue) {
        $counter = Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue
        if ($counter) {
          $sum3d = 0
          $sumEncode = 0
          $found3d = $false
          $foundEncode = $false
          foreach ($sample in $counter.CounterSamples) {
            if ($sample.InstanceName -match "pid_${TargetId}_") {
              if ($sample.InstanceName -like '*engtype_3d*') {
                $sum3d += $sample.CookedValue
                $found3d = $true
              } elseif ($sample.InstanceName -like '*engtype_video encode*' -or $sample.InstanceName -like '*engtype_video codec*') {
                $sumEncode += $sample.CookedValue
                $foundEncode = $true
              }
            }
          }
          if ($found3d -or $foundEncode) {
            $vals += [pscustomobject]@{
              gpu3d = if ($found3d) { [math]::Round($sum3d, 1) } else { $null }
              videoEncode = if ($foundEncode) { [math]::Round($sumEncode, 1) } else { $null }
            }
          }
        }
      }
      $vals
    } -ArgumentList ([string]$process.Id)
  }
  $peak = 0
  $cpuSeconds = 0
  while (-not $process.HasExited) {
    try {
      $process.Refresh()
      if ($process.PeakWorkingSet64 -gt $peak) { $peak = $process.PeakWorkingSet64 }
      $sample = $process.TotalProcessorTime.TotalSeconds
      if ($sample -gt $cpuSeconds) { $cpuSeconds = $sample }
    } catch { }
    Start-Sleep -Milliseconds 100
  }
  $process.WaitForExit()
  $process.Refresh()
  $watch.Stop()
  $exitCode = $process.ExitCode
  try {
    $finalCpu = $process.TotalProcessorTime.TotalSeconds
    if ($finalCpu -gt $cpuSeconds) { $cpuSeconds = $finalCpu }
  } catch { }
  $gpuSamples = @()
  if ($gpuJob) {
    $gpuSamples = @(Receive-Job -Job $gpuJob -Wait -AutoRemoveJob)
  }
  if ($null -ne $exitCode -and $exitCode -ne 0) {
    throw "$Name fallo con codigo ${exitCode}: $(Get-Content $stderr -Raw)"
  }
  if (-not (Test-Path $output)) { throw "$Name no genero la salida" }
  $gpu3d = @($gpuSamples | ForEach-Object { $_.gpu3d } | Where-Object { $null -ne $_ })
  $gpuEncode = @($gpuSamples | ForEach-Object { $_.videoEncode } | Where-Object { $null -ne $_ })
  $bytes = (Get-Item $output).Length
  $avgOf = {
    param($values)
    if ($values.Count -gt 0) {
      [math]::Round((($values | Measure-Object -Average).Average), 1)
    } else { $null }
  }
  $peakOf = {
    param($values)
    if ($values.Count -gt 0) {
      [math]::Round((($values | Measure-Object -Maximum).Maximum), 1)
    } else { $null }
  }
  [pscustomobject]@{
    case = $Name
    encoder = if ($Encoder -eq "amf") { "h264_amf" } else { "libopenh264" }
    wallSeconds = [math]::Round($watch.Elapsed.TotalSeconds, 3)
    cpuSeconds = [math]::Round($cpuSeconds, 3)
    cpuPercent = [math]::Round(($cpuSeconds / $watch.Elapsed.TotalSeconds) * 100, 1)
    peakWorkingSetMb = [math]::Round($peak / 1MB, 1)
    gpu3dPercent = & $avgOf $gpu3d
    gpu3dPeak = & $peakOf $gpu3d
    gpuEncodePercent = & $avgOf $gpuEncode
    gpuEncodePeak = & $peakOf $gpuEncode
    gpuSamples = $gpuSamples.Count
    outputBytes = $bytes
  }
}

$hasAmf = @(& $Ffmpeg -hide_banner -encoders 2>&1 | Select-String -SimpleMatch "h264_amf").Count -gt 0
$results = @(
  (Invoke-Case -Name "baseline" -Extra @()),
  (Invoke-Case -Name "effects" -Extra @("-vf", $filter))
)
if ($hasAmf) {
  $results += (Invoke-Case -Name "baseline-amf" -Extra @() -Encoder "amf")
  $results += (Invoke-Case -Name "effects-amf" -Extra @("-vf", $filter) -Encoder "amf")
}
$report = [pscustomobject]@{
  ffmpeg = $Ffmpeg
  resolution = $Resolution
  seconds = $Seconds
  hardwareEncoder = $hasAmf
  results = $results
}
$report | ConvertTo-Json -Depth 4
Remove-Item -Recurse -Force $root
