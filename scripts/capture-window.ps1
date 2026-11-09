Add-Type -AssemblyName System.Drawing
Add-Type '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r); public struct RECT { public int Left, Top, Right, Bottom; }' -Name U32 -Namespace W
$p = Get-Process editor-ia-desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'NO_WINDOW'; exit 1 }
$r = New-Object 'W.U32+RECT'
[W.U32]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -lt 100 -or $h -lt 100) { Write-Output "BAD_RECT $w x $h"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$out = 'D:\Users\ofici\QODER-WORK\editor-ia-architecture\deliverables\final\screenshot-app.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "OK ${w}x${h} pid=$($p.Id) title=$($p.MainWindowTitle)"
