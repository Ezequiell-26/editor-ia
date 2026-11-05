$bin  = 'C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0\bin'
$ff   = Join-Path $bin 'ffmpeg.exe'
$src  = 'D:\Users\ofici\QODER-WORK\editor-ia\editor-ia-shots\olyvia-vfx-roto-export-2026-10-24.mp4'
$out  = 'C:\Temp\bench'
New-Item -ItemType Directory -Path $out -Force | Out-Null

# referencia software
$dst = Join-Path $out 'ref_veryfast.mp4'
$ffargs = @('-hide_banner','-loglevel','error','-y','-stream_loop','5','-i',$src,'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','copy',$dst)
$t = Measure-Command { & $ff @ffargs 2>&1 | Out-Null }
Write-Output ("SOFTWARE veryfast seg={0:N2} MB={1:N2}" -f $t.TotalSeconds, [math]::Round((Get-Item $dst).Length/1MB,2))

foreach ($enc in @('h264_nvenc','h264_qsv','h264_amf','h264_mf','libopenh264')) {
    $d = Join-Path $out ("hw_{0}.mp4" -f $enc)
    if (Test-Path $d) { Remove-Item $d -Force }

    if ($enc -eq 'h264_nvenc')      { $extra = @('-preset','p6','-tune','hq','-rc','vbr','-cq','23','-b:v','0') }
    elseif ($enc -eq 'h264_amf')    { $extra = @('-rc','cqp','-qp_i','23','-qp_p','23','-quality','balanced') }
    elseif ($enc -eq 'h264_qsv')    { $extra = @('-global_quality','23','-look_ahead','0') }
    elseif ($enc -eq 'h264_mf')     { $extra = @('-rate_control','quality') }
    else                             { $extra = @('-b:v','4M') }

    $ffargs = @('-hide_banner','-loglevel','error','-y','-stream_loop','5','-i',$src,'-c:v',$enc) + $extra + @('-c:a','copy',$d)
    $err = ''
    $t2 = Measure-Command { $script:err = (& $ff @ffargs 2>&1 | Out-String) }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $d)) {
        $msg = (($err -split "`n") | Where-Object { $_ -match 'Unrecognized|not found|Unknown|error|failed|no such|init' } | Select-Object -First 1)
        Write-Output ("HW $enc -> NO DISPONIBLE :: $msg")
        continue
    }
    Write-Output ("HW $enc -> OK seg={0:N2} MB={1:N2}" -f $t2.TotalSeconds, [math]::Round((Get-Item $d).Length/1MB,2))
}
