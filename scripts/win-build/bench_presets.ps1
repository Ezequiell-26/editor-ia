$bin  = 'C:\Temp\ff90\ffmpeg-n9.0-latest-win64-gpl-shared-9.0\bin'
$ff   = Join-Path $bin 'ffmpeg.exe'
$probe = Join-Path $bin 'ffprobe.exe'
$src  = 'D:\Users\ofici\QODER-WORK\editor-ia\editor-ia-shots\olyvia-vfx-roto-export-2026-10-24.mp4'
$out  = 'C:\Temp\bench'
New-Item -ItemType Directory -Path $out -Force | Out-Null

foreach ($preset in @('ultrafast','veryfast','faster','fast','medium')) {
    $dst = Join-Path $out ("x264_{0}.mp4" -f $preset)
    if (Test-Path $dst) { Remove-Item $dst -Force }

    $ffargs = @('-hide_banner','-loglevel','error','-y',
                '-stream_loop','5','-i',$src,
                '-c:v','libx264','-preset',$preset,'-crf','20',
                '-c:a','copy',$dst)

    $err = ''
    $t = Measure-Command { $script:err = (& $ff @ffargs 2>&1 | Out-String) }
    $code = $LASTEXITCODE

    if ($code -ne 0 -or -not (Test-Path $dst)) {
        Write-Output ("PRESET={0,-10} FALLO exit=$code msg={1}" -f $preset, ($err -split "`n")[0])
        continue
    }
    $mb = [math]::Round((Get-Item $dst).Length/1MB, 2)
    $d  = & $probe -v error -show_entries format=duration -of csv=p=0 $dst
    Write-Output ("PRESET={0,-10} seg={1,7:N2} MB={2,7:N2} dur={3}" -f $preset, $t.TotalSeconds, $mb, $d)
}
