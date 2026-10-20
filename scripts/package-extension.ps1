# Package the Flow Queue extension for delivery. Chrome still installs it as an
# unpacked extension: the user unzips the archive and selects the folder.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $root 'extensions\flow-queue'
$outDir = Join-Path $root 'dist'
$zip = Join-Path $outDir 'flow-queue-0.1.0.zip'

if (-not (Test-Path (Join-Path $extension 'manifest.json'))) {
  throw "No encontré manifest.json en $extension"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("flow-queue-stage-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Copy-Item -LiteralPath (Join-Path $extension 'manifest.json') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $extension 'README.md') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $extension 'src') -Destination $stage -Recurse
  Copy-Item -LiteralPath (Join-Path $extension 'icons') -Destination $stage -Recurse
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force
}

$hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
$size = (Get-Item -LiteralPath $zip).Length
Write-Host ("Flow Queue: {0} ({1} bytes)" -f $zip, $size)
Write-Host ("SHA256: {0}" -f $hash.Hash)
